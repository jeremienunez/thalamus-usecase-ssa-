# Changelog

All notable changes to the interview extraction of Thalamus + Sweep.

## [Unreleased]

### console-api 5-layer architecture refactor — 2026-04-16

Decomposed the monolithic `apps/console-api/src/server.ts` (2001 lines) into a
layered Fastify backend:

```
src/
  server.ts          # boot only — 61 lines (was 2001)
  container.ts       # DI composition root — 134 lines
  routes/            # 12 route registrars + index barrel (registerAllRoutes)
  controllers/       # 13 controllers — thin req/reply adapters, asyncHandler-wrapped
  services/          # 13 services — business logic, orchestration, state
  repositories/      # 9 repositories — raw SQL, bigint-typed ids
  types/             # 5 server-only types (mission, autonomy, cycle, reflexion, knn)
  prompts/           # 3 LLM prompts (mission-research, repl-chat, autonomy-queries)
  utils/             # 7 server-only helpers (async-handler, regime, classification,
                     #   finding-status, fabrication-detector, field-constraints, sql-field)
```

Shared DTOs hoisted to [packages/shared/src/ssa/](packages/shared/src/ssa/):

- `satellite-view.ts` — `SatelliteView` + `normaliseRegime` / `regimeFromMeanMotion`
  / `smaFromMeanMotion` / `classificationTier` (moved from console-api).
- `finding-view.ts` — `FindingView` + `FindingStatus`.
- `kg-view.ts` — `KgNode`, `KgEdge`, `KgEntityClass`.
- `conjunction-view.ts` — added `deriveAction(pc)` next to existing
  `deriveCovarianceQuality(sigmaKm)`. Unit tests land next to the types.

Rule applied end-to-end: anything that does not share semantics with the
console frontend stays server-local in `apps/console-api/src/utils/`;
anything consumed by both frontend and backend lives in
`packages/shared/src/ssa/`.

Behaviour preserved except for three intentional improvements:

- `SatelliteRepository.findPayloadNamesByIds` / `updateField` /
  `knnNeighboursForField` tightened from `string`-valued ids to `bigint[]`,
  eliminating a latent `SyntaxError` on malformed input.
- `ResearchEdgeRepository.findByFindingIds` tightened from `string[]` to
  `bigint[]` with `::bigint[]` cast, enabling PK index usage.
- `StatsService.snapshot` now runs its 3 count queries in `Promise.all`
  parallelism (was sequential in the inline server.ts).

Workspace test discipline — [vitest.workspace.ts](vitest.workspace.ts): the
`unit` project now picks up `packages/*/src/**/*.test.ts` (co-located tests),
not just `packages/*/tests/**/*.spec.ts`. This surfaced 20 previously-dead
shared DTO tests.

Workflow — subagent-driven-development with two-stage review (spec + code
quality) per task. 6 feature branches merged back into a single refactor
branch:

- `api-reads` — health + satellites + conjunctions + kg + findings + stats.
- `api-enrichment-infra` — enrichment-cycle + sweep-audit repos +
  enrichment-finding + nano-research services.
- `api-mission-orchestration` — mission + knn-propagation + reflexion
  (service + controller + routes for each; reflexion repo).
- `api-ops-orchestration` — cycle-runner + autonomy + repl-chat
  (service + controller + routes for each).

All 4 integration specs green throughout (conjunctions, enrichment-findings,
knn-propagation, sweep-mission). Full repo suite: 385 passed / 23 todo.

### Per-event conjunction cortex + Foster Pc covariance columns — 2026-04-16

Closes the gap between the SGP4 propagator (which produced min-range + TCA) and
the cortex output (which was emitting data-quality meta-findings instead of
concrete per-event screens). After this change, `conjunction_analysis` emits
one finding per NORAD pair with miss distance, TCA, and calibrated Pc in the
title — the intended contract of the cortex.

Schema — [packages/db-schema/src/schema/conjunction.ts](packages/db-schema/src/schema/conjunction.ts):

- `primary_sigma_km`, `secondary_sigma_km`, `combined_sigma_km` (real) — 1σ
  position uncertainty at TCA for each object and the RSS combination.
- `hard_body_radius_m` (real, default 20) — sum of spherical hardbodies
  (≈ 10 m per object).
- `pc_method` (text) — methodology marker, currently `"foster-gaussian-1d"`.
- Columns added NULLable so existing events survive; re-seed overwrites.

Propagator — [packages/db-schema/src/seed/conjunctions.ts](packages/db-schema/src/seed/conjunctions.ts):

- `sigmaKmFor(regime, ageAtEpochDays, propagationDays)` — regime-conditioned
  baseline + growth rate. LEO/SSO 0.5 km + 0.15 km/day, MEO 1.0 + 0.05, GTO
  2.0 + 0.1, HEO 2.5 + 0.1, GEO 4.0 + 0.02. Plausible for OSINT-derived TLEs.
- **Foster-1992 1D Gaussian Pc** over the miss-distance distribution:
  `Pc ≈ (HBR² / 2σc²) · exp(−d² / 2σc²)` where `σc = √(σp² + σs²)`.
  Clamped to [1e-12, 0.5]. Replaces the previous flat `exp(-minRange/10)`
  heuristic that clipped everything to 1e-2.
- Result: Pc distribution spans 9 orders of magnitude (1e-4 → <1e-12). Top
  event CHUANGXIN 1-02 × 1-03 @ 2.27 km σ=1.93 km → Pc = 2.7e-5 (HIGH).

Helper — [packages/thalamus/src/cortices/queries/conjunction.ts](packages/thalamus/src/cortices/queries/conjunction.ts):

- `ConjunctionScreenRow` extended with `primarySigmaKm`, `secondarySigmaKm`,
  `combinedSigmaKm`, `hardBodyRadiusM`, `pcMethod`. Cortex receives the full
  covariance context, not just Pc.

Prompt tuning — strict per-event contract:

- [skills/conjunction-analysis.md](packages/thalamus/src/cortices/skills/conjunction-analysis.md)
  rewritten. Hard rules: **one finding per DATA row**, never invent NORAD IDs,
  never emit data-quality meta-findings when events are present (that's the
  `data_auditor` cortex's job). Title format mandatory:
  `"NORAD 28252 × 38332 — 2.1 km miss, 2026-04-17T14:12Z, Pc=1.8e-04"`.
- Severity ladder — `findingType`: `alert` (Pc≥1e-4) / `forecast` (1e-6…1e-4)
  / `insight`. `urgency`: critical (≥1e-3) / high (≥1e-4) / medium (≥1e-6) /
  low. `confidence = 0.75` default (OSINT-only), lifts to `0.9` with field
  corroboration per the `dual-stream-confidence` spec.
- Pc interpretation table embedded in the skill: ≥1e-3 → wake ops,
  1e-4…1e-3 → NASA threshold, 1e-6…1e-4 → watch, <1e-6 → archive.
- [skills/traffic-spotter.md](packages/thalamus/src/cortices/skills/traffic-spotter.md)
  rewritten to one-finding-per-regime (density rows) + one-per-news-item.
  Bans generic "we have RSS data" meta.

Verified end-to-end: re-run of `THALAMUS_MODE=record make thalamus-cycle`
produces 57 findings / 30 persisted / 75 edges (vs 13 / 5 / 25 before
tuning), with per-event NORAD titles and operator names surfaced on the
top-5 Pc sample.

### Orbit trails + conjunction markers on the OPS globe — 2026-04-16

Ships the "satellite positions" view that matches real SSA console aesthetics:
hybrid orbital trails behind every catalog object and severity-colored ✕
markers at every conjunction's TCA, with a full-SSA info card on hover.

- `/api/conjunctions` extended with `regime`, `covarianceQuality`, `action`,
  `computedAt` — joined from `satellite` (primary mean-motion) and derived
  server-side from `combined_sigma_km` / `probability_of_collision`. No mocks.
- Shared `ConjunctionViewSchema` (Zod) in `packages/shared/src/ssa/` — single
  DTO source of truth for frontend + future CLI consumers.
- `apps/console` + `apps/console-api` moved out of `.gitignore` and tracked
  (they are part of the portfolio tree now).
- `OrbitTrails.tsx` — full orbit rings per regime (merged BufferGeometry, 4
  draw calls across ~1215 sats) + fading 60-sample tails. Tri-state toggle
  `off | tails | full` folded into `RegimeFilter`.
- `ConjunctionMarkers.tsx` — one sprite per conjunction, hidden by default,
  revealed on arc hover with severity palette (green < 1e-6, yellow < 1e-4,
  red ≥ 1e-4) and an info card portal with the 10 SSA fields.
- `orbit.ts` Kepler propagator now exposes `orbitRing(s, n)` — closed-loop
  geometry sampler used by both the trails and the `orbit.test.ts`
  closure/period unit tests (5/5 passing).
- Integration test `tests/conjunctions.spec.ts` parses live `/api/conjunctions`
  against `ConjunctionViewSchema` — guards the API shape against drift.

Verified end-to-end: 13/13 console-api tests, 5/5 console tests, live ISS ↔
POISK conjunction rendering as a red ✕ with `covarianceQuality: MED`,
`action: maneuver_candidate`.

Plan: `docs/specs/2026-04-15-orbit-trails-conjunction-markers.plan.md`
Spec: `docs/specs/2026-04-15-orbit-trails-conjunction-markers.md`

### Sweep enrichment pipeline + KNN propagation + orbital reflexion — 2026-04-16

Closes the loop between catalog enrichment and Thalamus reasoning. Every value
written to the catalog (by web mission or KNN propagation) now emits a
`research_finding` with `research_edge`s — so cortices can cite, trace, and
reason on factual fills rather than treating the DB as a mute oracle. Pitch:
"Null plutôt que plausible" — the system refuses fabrications at decode time
and cites its provenance in the knowledge graph.

Sweep mission pipeline — hardened:

- Structured-outputs JSON schema on gpt-5.4-nano `/v1/responses` (strict)
  forces `{value, unit, confidence, source}` with `source` regex `^https://…`.
  No prose slot = no hedging narrative possible at decode time.
- Hedging-token post-hoc blocklist (typical / approx / around / unknown / …)
  catches any residual narrative that slips through.
- Source validation: the returned URL must appear in the builtin `web_search`
  URL list — rejects invented citations.
- **Range guards per column**: `lifetime ∈ [0.1, 50]`, `launch_year ∈ [1957,
2035]`, `mass_kg ∈ [0.1, 30 000]`, `power ∈ [0.1, 30 000]`. Values outside
  → unobtainable (no DB write).
- **Unit mismatch check**: `lifetime` rejects `hours/days/months`;
  `launch_year` rejects `BC/month/day`.
- **2-vote corroboration**: two independent nano calls with different angles
  (operator docs / eoPortal-Wikipedia), accept iff numeric values agree within
  ±10 % of median (text: exact normalised match). Confidence boosted +0.15 on
  agreement.
- **Object-class filter**: mission only processes `object_class='payload'`
  (debris and rocket stages have no meaningful `lifetime`/`variant`/`power`).
- **Per-satellite granularity**: each suggestion (operator × field) expands to
  N per-satellite tasks with `satelliteName` + `noradId` in the prompt (vs the
  old operator-level question that always returned null).

KNN propagation — zero-LLM enrichment:

- `POST /api/sweep/mission/knn-propagate {field, k, minSim, limit, dryRun}`
  — for each payload missing a field, finds K nearest embedded neighbours
  (Voyage halfvec cosine) that have the field set and propagates their
  consensus value. Consensus rule: numeric = all within ±10 % of median;
  text = mode covers ≥ ⅔ of neighbours. Nearest-neighbour `cos_sim ≥ minSim`.
- Range guards applied to neighbour values too (no garbage in → garbage out).
- 10× cheaper than web mission (pure SQL + HNSW), covers the semantic long
  tail the mission can't afford to hit one-by-one.

Enrichment findings (mission + KNN) — bridge to Thalamus KG:

- New `emitEnrichmentFinding()` called from both fill paths. Writes a
  `research_finding` (`cortex=data_auditor`, `finding_type=insight`) carrying
  the field / value / confidence / source in `evidence` JSONB + a
  `reasoning` string explaining method (KNN propagation vs 2-vote).
- `research_edge` rows: `about` → target sat, `similar_to` → every neighbour
  that voted (KNN) or supporting source URL (mission). Provenance is now
  navigable in the KG, not hidden in a log.
- Feedback loop: each fill pushes an `enrichment` entry to `sweep:feedback`
  so the next nano-sweep can de-prioritise fields that self-heal via KNN.
- Lazy-created long-running cycle `trigger_source='catalog-enrichment'`
  carries every enrichment finding across sessions.
- Every PG parameter cast explicitly (`::bigint`, `::real`, `::jsonb`,
  `::entity_type`, `::relation`, enum types) — `pg@8.x` does not infer these
  via driver and silently drops INSERTs otherwise.

Orbital reflexion pass — factual anomaly detection:

- `POST /api/sweep/reflexion-pass {noradId, dIncMax, dRaanMax, dMmMax}`
  runs **two orbital cross-tabs** on the existing `telemetry_summary`
  (`inclination`, `raan`, `meanMotion`, `meanAnomaly`):
  1. **Strict co-plane companions** — same (inc, raan, meanMotion) within
     tight tolerance, with along-track phase lag in minutes (`Δma / 360 ×
period`). This is the tandem-imaging / SIGINT-pair test.
  2. **Inclination-belt peers** — same inclination regardless of RAAN,
     cross-tabulated by `operator_country × classification_tier ×
object_class`. The "who lives in your SSO neighbourhood" test.
- MIL-lineage name-match (`YAOGAN%`, `COSMOS%`, `NROL%`, `LACROSSE%`,
  `TOPAZ%`, `SHIYAN%`, …) surfaces explicit military platforms hiding in
  the belt.
- Emits an `anomaly` finding (`cortex=classification_auditor`,
  `urgency=high` when MIL-peers ≥ 1, else `medium`) with every cited peer
  traced via `similar_to` edges. Zero LLM, 100 % SQL.
- Live case: FENGYUN 3A (32958, "civilian weather") returned `urgency=high`
  with 3 MIL peers (YAOGAN-11, SHIYAN-3, SHIYAN-4) + SUOMI NPP strict
  co-plane at 54 min phase lag. The orbital fingerprint reveals what the
  declared classification doesn't.

Autonomy controller — continuous Thalamus + Sweep rotation:

- `POST /api/autonomy/start {intervalSec}` / `stop` / `GET /status`. Rotates
  between Thalamus cycles (6 rotating SSA queries: detect suspicious
  behaviour, audit conjunction risk, correlate OSINT feeds…) and Sweep
  nullScan passes. Each tick emits findings live. 3 s refetch front-side so
  the operator sees the catalogue move.
- Briefing mode dropped from rotation (returned 0 operator-countries once
  the catalogue is fully null-scanned) — kept thalamus ↔ sweep-nullscan.

Catalog gap-fill (zero-LLM heuristic):

- `packages/db-schema/src/seed/fill-catalog-gaps.ts` — deterministic filler
  for the three columns that were 100 % NULL: `g_orbit_regime_description`
  (from meanMotion + eccentricity + inclination), `classification_tier`
  (operator name / country heuristic: military → restricted, dual-use →
  sensitive, rest → unclassified), `is_experimental` (mass < 10 kg or
  bus/name signals like CUBESAT / TESTBED / DEMOSAT). Result: 500/504
  regime, 504/504 tier, 504/504 experimental, all traceable to a rule.

Mission-UI — operator-visible state:

- `apps/console/src/components/AutonomyControl.tsx` — topbar pill shows live
  tick count + pulse, toggles the loop on / off. FEED panel below streams
  recent ticks (action · query · `+N findings` · elapsed) + 3 live
  counters (findings / suggestions / KG edges).
- `apps/console/src/modes/sweep/SweepSuggestions.tsx` — LAUNCH FISH MISSION
  button + running banner with completed / filled / unobtainable / errors +
  scrollable recent-tasks feed with clickable source hosts.
- `apps/console/src/components/CommandPalette.tsx` — bare free-text that
  matches no action falls through to REPL chat automatically.
- `/api/repl/chat` — classifier → run_cycle vs plain chat. On run_cycle
  intent it actually dispatches a Thalamus cycle, loads findings, and
  summarises them with satellite names cited. No fixtures, real pipeline.

SQL constraint — cosine-distance threshold:

- Mass-gap KNN propagation over 50 JILIN-1 payloads produced 6 fills at
  `cos_sim ∈ [0.89, 0.92]` converging on 42 kg, 44 others rejected on
  consensus disagreement. Illustrates that "Null rather than plausible" is
  the operating contract, not the exception.

Tests — 13/13 integration specs green:

- `apps/console-api/tests/sweep-mission.spec.ts` (6) — queue expansion,
  Other / Unknown skip, non-writable skip, idempotency, cap,
  double-start-refused.
- `apps/console-api/tests/knn-propagation.spec.ts` (5) — field whitelist
  (400), shape contract, `k`/`minSim` clamping, sampleFills trail,
  `tooFar` monotonicity under `minSim` ↑.
- `apps/console-api/tests/enrichment-findings.spec.ts` (1) — every KNN
  fill emits a `research_finding` with ≥ 1 `about` + ≥ 1 `similar_to`
  edge.
- Snapshot/restore of `sweep:index:pending` between tests — isolated from
  the 163 live pending suggestions, no cross-test contamination.

### SSA catalog expansion + Voyage embeddings + KNN cortex — 2026-04-15

From 504 payloads to a **33,564-object operational catalog** (debris + rocket
stages included), embedded end-to-end with Voyage `voyage-4-large` halfvec(2048)
and served through a new KNN-based conjunction candidate cortex. Pitch: "SSA
doctrine learned by cosine similarity, not coded by hand."

Schema:

- `packages/db-schema/src/schema/satellite.ts` — `objectClass` text column with
  CHECK constraint (`payload`/`rocket_stage`/`debris`/`unknown`). First step
  toward a dedicated `space_object` table; inline for now so the screening
  pipeline can filter without another schema migration.
- `satellite.embedding halfvec(2048)` + `embedding_model` + `embedded_at`
  columns. HNSW cosine index (m=16, ef_construction=64) at
  `satellite_embedding_hnsw`.

Seed pipeline (all idempotent, all in `packages/db-schema/src/seed/`):

- `populate-space-catalog.ts` — CelesTrak SATCAT (`celestrak.org/pub/satcat.csv`,
  ~6 MB, 68k rows). Filters `DECAY_DATE=''` → 33,560 alive objects (18,556
  payloads + 12,544 debris + 2,397 rocket stages + 63 unknown). UPSERT by
  `norad_id`. Apogee / perigee / inclination / RCS / ops_status stashed in
  `metadata` JSONB. 24h disk cache at `/tmp/celestrak-satcat.csv`.
- `enrich-gcat.ts` — switched NORAD source from `telemetry_summary->>'noradId'`
  (legacy JSON field) to the dedicated `norad_id` column. Enrichment pass now
  hits the whole 33k catalog, not just the 504 legacy payloads. Result: 20,556
  mass backfills + 20,213 bus backfills against GCAT (~63% coverage).
- `screen-broadphase.ts` — sweep-line O(n log n + k) pruner with bounded top-K
  max-heap (memory-safe). Stages: naive (542 M pairs) → regime bucketing (385 M)
  → radial overlap @ ±50 km (145 M candidates, **4× pruning in 32 s**). Cross-
  class mix surfaced: 29.5 M payload×debris, 6.7 M debris×rocket_stage.
- `screen-narrow-phase.ts` — SGP4 pipeline: re-runs broad-phase → fetches TLEs
  from CelesTrak `gp.php?CATNR=…` (disk-cached at `/tmp/tle-cache/`) → satellite.js
  propagation → Foster-1992 isotropic Pc with regime-conditioned sigma →
  UPSERT `conjunction_event` by (primary, secondary, epoch).
- `embed-catalog.ts` — Voyage voyage-4-large document embedder. Batches of 128,
  halfvec(2048) literal via `${literal}::halfvec(2048)` cast. One line of
  structured text per object (name, object_class, regime, altitude band,
  inclination, operator, bus, launch year, mass). **33,564/33,564 embedded in
  3m39s, zero failures, ~$0.08 total cost.** Inline Voyage caller avoids the
  circular dep with `@interview/thalamus`.
- `build-embedding-index.sql` — HNSW cosine index + secondary composite index
  on `(metadata->>'apogeeKm', object_class)`.

Cortex (`packages/thalamus/src/cortices/`):

- `queries/conjunction-candidates.ts::queryConjunctionCandidatesKnn` —
  pre-narrow-phase candidate proposer. Combines (a) HNSW cosine KNN on the
  halfvec embedding, (b) radial altitude overlap `[perigee − Δ, apogee + Δ]`,
  (c) `excludeSameFamily` regex to suppress constellation self-clustering.
  Session-scoped `hnsw.ef_search` set per query via a sanitised literal.
  Latency: 100–170 ms on 33k catalog.
- `skills/conjunction-candidate-knn.md` — cortex skill. One finding per KNN
  survivor. Severity: `forecast` if `cos < 0.30 ∧ overlap > 15 km`, `insight`
  otherwise. Explicitly forbidden from asserting Pc — that's the job of
  `conjunction_analysis` downstream. Emits `recommendations: propagate_sgp4`
  with narrow-phase params.
- `queries/index.ts` — barrel re-export of `./conjunction-candidates` so
  `SQL_HELPER_MAP` picks up `queryConjunctionCandidatesKnn` via the existing
  `import * as sqlHelpers from "./queries"` pattern in `executor.ts`.
- Public API: `queryConjunctionCandidatesKnn` + `ConjunctionCandidateKnn` /
  `ConjunctionCandidatesKnnOpts` types exported from `@interview/thalamus`.

KNN sanity (hand-picked validations):

- ISS (NORAD 25544) nearest neighbours (debris-only, excludeSameFamily): 10×
  `FREGAT DEB` at 336-425 km perigee, cos 0.326-0.339. These are the Fregat
  upper-stage fragmentation debris that actually threaten the ISS altitude
  band — the embedding reproduced the DOD watchlist without any rule.
- HST (20580) nearest rocket bodies: `DELTA 2 R/B`, `H-2 R/B`, `SL-8 R/B`,
  `ARIANE 42P R/B` — exactly the clutter Hubble operators track.
- `COSMOS 2251 DEB` KNN: 10 × `COSMOS 2251 DEB` fragments (ASAT-1 cluster
  recovered end-to-end from the name + altitude + regime embedding).

CLI (`packages/cli/`):

- `/candidates <norad> [class=debris] [limit=N]` — new slash verb. Parser
  validates integer NORAD + optional flags; schema discriminated-union entry
  for `action: "candidates"`; dispatch wires to a new `candidates` adapter;
  boot-level real adapter calls `queryConjunctionCandidatesKnn` with `knnK=300`,
  `marginKm=20`, `excludeSameFamily=true`.
- `renderers/candidates.tsx` — colour-coded table (debris red, rocket_stage
  yellow, payload cyan; cos<0.30 green / <0.40 yellow / else gray). Columns:
  cos · ovl · class · alt · regime · name (+ NORAD).
- `tests/router/dispatch.spec.ts` — extended `makeAdapters()` with a mocked
  `candidates.propose`; added a `candidates` dispatch case. **55/55 green,
  `pnpm -r typecheck` clean across 7 packages.**

Bug fixes in the seed path:

- `enrich-gcat.ts` was silently no-op after the NORAD-id migration — the
  source field had moved from `telemetry_summary.noradId` to a dedicated
  column, so 99 % of the catalog was being skipped.
- `embed-catalog.ts` type hygiene: `db.execute<Row>` generic dropped (TS
  rejected `Row` as an index signature), replaced with explicit `as unknown
as Row[]` cast at the call site.

### Conversational CLI (`@interview/cli`) — 2026-04-14

Interactive Ink-based REPL (`pnpm run ssa`) for the SSA console: two-lane
router (slash grammar + interpreter cortex), animated emoji lifecycle
logs, ASCII satellite loader with rolling p50/p95 ETA, pretext-flavored
editorial rendering.

Shared:

- `packages/shared/src/observability/steps.ts` — `StepName` union of 19
  lifecycle steps + `STEP_REGISTRY` (frames + terminal + error emoji per
  step). Discriminated union on `StepEntry` enforces instantaneous vs
  animated at compile time.
- `packages/shared/src/observability/step-logger.ts` — `stepLog(logger,
step, phase, extra?)` emits structured `StepEvent` to pino. Unknown
  steps fall back to `❔` with a dev-mode warning.

Thalamus & sweep retrofit:

- `thalamus.service.ts`, `thalamus-planner.service.ts`,
  `thalamus-executor.service.ts`, `thalamus-reflexion.service.ts`,
  `cortex-llm.ts` emit `stepLog` at `cycle`, `planner`, `cortex`,
  `nano.call`, `reflexion` lifecycle boundaries (start/done/error).
- `telemetry-swarm.service.ts`, `turn-runner-dag.ts`,
  `turn-runner-sequential.ts` emit `swarm`, `fish.turn`,
  `fish.memory.write`.

Package `@interview/cli`:

- Router: slash-grammar parser (`parser.ts`) + Zod `RouterPlanSchema`
  (7 discriminants incl. `clarify`) + `interpreter` cortex skill +
  `dispatch` loop mapping steps to adapters.
- Adapters: `thalamus`, `telemetry`, `logs` (pino ring buffer),
  `graph` (BFS over research_edge), `resolution`, `why` (provenance
  tree) — all thin wrappers.
- Memory: `ConversationBuffer` (token-counted ring) + `MemoryPalace`
  (sim_agent_memory HNSW) with 200k token threshold.
- Utilities: `CostMeter` (per-turn + session), `EtaStore` (rolling
  p50/p95 persisted to `~/.cache/ssa-cli/eta.json`), source-class
  colors (`FIELD` green / `OSINT` yellow / `SIM` gray), sparkline bar.
- Ink components: `Prompt`, `StatusFooter`, `ScrollView`,
  `AnimatedEmoji` (6 fps frame cycler with terminal freeze on
  done/error), `SatelliteLoader` (ASCII sprite + subtitle + ETA band
  green/yellow/red).
- Renderers: `briefing`, `telemetry`, `logTail`, `graphTree`,
  `whyTree`, `clarify`.
- Cortex skills: `interpreter.md` (router) + `analyst-briefing.md`
  (briefing).
- Boot: `boot.ts` + `index.ts` — stubbed adapters in the default path,
  injectable via `BootDeps` for tests. `LogsAdapter` is wired end-to-end
  via pino ring buffer.
- Tests: 46 specs — schema (5), parser (10), interpreter (3), memory
  (7), cost/eta (4), adapters (8), dispatch (2), components (5),
  briefing renderer (1), e2e REPL (1).

Known gaps (deferred):

- `buildRealAdapters` in `boot.ts` still throws for
  thalamus/telemetry/graph/resolution/why — real infra wiring (DB +
  Redis + LLM transport) pending.
- Aggregator / swarm-service / promote `stepLog` emission deferred
  (Task 3 scoped to 4 files).

### sim-fish telemetry inference pipeline — 2026-04-14

End-to-end multi-agent inference of operator-private 14D telemetry scalars,
grounded in public bus datasheets, routed through reviewer-in-the-loop with
SPEC-TH-040 confidence bands.

Data:

- `packages/sweep/src/sim/bus-datasheets.json` — 26 bus archetypes (Maxar SSL-1300,
  Airbus Eurostar 3000, Lockheed A2100, Boeing BSS-702HP, Starlink v1.5 / v2-Mini,
  Iridium NEXT, GPS III / IIF, Galileo, Uragan, GOES-R, Sentinel-1 / 2, Prisma,
  Spacebus 4000, HS-601, DFH-3 / 4, Milstar / DSCS III, TDRS, SSTL-100, CubeSat
  1U / 3U, Microstar, Strela-3). Each entry has `published` (citable ranges with
  URLs) + `inferred` (bus-class engineering typicals with explicit confidence) +
  `context` (design life, mass, battery). Covers ~65% of the catalog via
  `aliases[]` (e.g. A2100 ↔ A2100AX ↔ A2100M ↔ LM2100).

Pipeline:

- `bus-datasheets.ts` loader — resolves a free-form bus name (case / separator
  insensitive, alias fallback) to a flattened prior in the
  `SeedRefs.busDatasheetPrior` shape. Unknown buses return honest null; inferred
  typicals that have no published range get a ±30% envelope.
- `prompt.ts` — injects a "Telemetry inference target" block into the fish user
  prompt when `AgentContext.telemetryTarget` is populated. Shows regime, launch
  year, and the full `[min, typical, max] unit` table so the fish MUST stay
  within ±10% per the `telemetry_inference_agent` skill.
- `load-telemetry-target.ts` — shared between both turn runners; reads
  `sim_run.seed_applied.telemetryTargetSatelliteId` and joins the satellite's
  NORAD id / regime / bus name. Null for UC1 / UC3 fish (non-telemetry swarms).
- `turn-runner-dag.ts` + `turn-runner-sequential.ts` — `pickCortexName(ctx)`
  swaps the skill from `sim_operator_agent` to `telemetry_inference_agent` when
  `ctx.telemetryTarget` is set.
- `telemetry-swarm.service.ts` — `startTelemetrySwarm({ satelliteId })` resolves
  target → operator → bus → prior and launches a K-fish swarm (default K=30)
  with `kind: "uc_telemetry_inference"` and persona perturbations spanning
  `conservative` / `balanced` / `aggressive`. Fish concurrency is clamped to 16
  to stay under the OpenAI nano RPM tier.
- `swarm-fish.worker.ts` — routes `uc_telemetry_inference` through the DAG
  runner (single-agent single-turn) with `terminal = true` after one infer.
- `swarm-aggregate.worker.ts` — branches by `sim_swarm.kind`. Telemetry swarms
  use `TelemetryAggregatorService` (per-scalar median / σ / n + `simConfidence`
  clamped to the `SIM_UNCORROBORATED` band [0.10, 0.35]) and emit K suggestions
  via `emitTelemetrySuggestions`.
- `promote.ts::emitTelemetrySuggestions` — one `sweep_suggestion` per scalar
  with severity graduated by the coefficient of variation: tight consensus
  (cv < 20% + n ≥ 5 + simConfidence ≥ 0.20) → warning (accept candidate); high
  dispersion (cv ≥ 50% + n ≥ 5) → warning (dissent); else info. Never emits
  critical — SPEC-TH-040 I-4 reserves critical for FIELD corroboration.
- `container.ts` — wires `resolutionService.setOnSimUpdateAccepted` to
  `ConfidenceService.promote({ kind: "reviewer-accept" })` via a stable
  FNV-1a `telemetryEdgeId(satelliteId, field)` hash. Accept of a sim-swarm
  suggestion bumps the edge from SIM_UNCORROBORATED → OSINT_CORROBORATED.

Confidence invariants (SPEC-TH-040 extension):

- `SourceClass` grew with `SIM_UNCORROBORATED` [0.10, 0.35] and
  `SIM_CORROBORATED` [0.30, 0.55] — strictly below OSINT_CORROBORATED.
- `EdgeProvenanceEvent.actor` gains `"sim-fish"`; `PromoteEdgeInput.evidence`
  gains `"sim-inference"` (fishCount + dispersion) and `"reviewer-accept"`
  (analystId + citation).
- I-1 preserved: `sim-inference` never promotes over FIELD\_\* or
  OSINT_CORROBORATED (field + reviewer dominance). 18/18 non-regression green.

Demo:

- `pnpm --filter @interview/sweep demo-telemetry` — boots workers, launches
  K=30 swarm on a NIMIQ 5 (SSL-1300), polls to completion, prints the 8-scalar
  distribution table. Live ~8s wall time. Example output at K=30:
  ```
  scalar             median        σ        cv%   severity
  powerDraw         11,000 W       3,412    31%   info
  dataRate           152 Mbps        159   105%   warning (dissent)
  eclipseRatio        2.5 %         3.59   144%   warning (dissent)
  pointingAccuracy  182.5 arcsec     39    22%   info   ← matches SSL-1300 0.05° spec
  ```
- BullMQ 5.x ↔ ioredis 5.x close ordering emits `ERR_OUT_OF_RANGE` on
  `setMaxListeners`; swallowed during demo teardown — purely cosmetic, the
  swarm has already persisted.

Tests: 19 new (14 loader + 5 startTelemetrySwarm).

### TDD pass — `packages/shared` (70/70 tests) — 2026-04-13

All five shared specs covered before touching downstream code. Vitest workspace simplified (`tests/**/*.spec.ts` at package root; `integration/` and `e2e/` as subfolders).

- SPEC-SH-001 `try-async` — 11 tests against existing implementation.
- SPEC-SH-002 `app-error` — 13 tests against existing implementation.
- SPEC-SH-003 `completeness-scorer` — 15 tests. Implementation written from the tests (`src/utils/completeness-scorer.ts`).
- SPEC-SH-004 `domain-normalizer` — 16 tests (NFD diacritic fold, separator normalization, idempotence). Implementation written from the tests (`src/utils/domain-normalizer.ts`). Test examples use SSA vocabulary (Sentinel-2A, Cosmos 2553, ISS Zarya, ENVISAT).
- SPEC-SH-005 `observability` — 15 tests across logger (base bindings, silent in test, dev/prod level, Loki opt-in, redaction) and metrics (default labels, registry isolation, Prometheus text). `pino-pretty` + `pino-loki` added to `@interview/shared` deps.

### SSA (Space Situational Awareness) domain pivot — 2026-04-13

Repo pivoted from its original commercial domain to SSA. Motivation: the CortAIx interview is defense-flavored; SSA is the cleanest critical-system use case that exhibits the full system pattern (dual-stream OSINT × field, HITL, budgeted agents, audit trail, Kessler-cascade consequences).

- **Schema** — `schema/wine.ts` removed. `schema/satellite.ts` is the canonical source: `satellite, operator, operator_country, payload, orbit_regime, platform_class, satellite_bus, satellite_payload` with typed relations. Enum `ResearchCortex` gained 21 SSA keys; `ResearchEntityType` covers satellite / payload / orbit regime / conjunction event / maneuver.
- **Cortices** — 5 new core SSA cortices (`catalog`, `observations`, `conjunction-analysis`, `correlation`, `maneuver-planning`) + 13 analysts/auditors. 4 wine-only skills dropped (sommelier-pairing, seo-strategist, deal-scanner, social-media). `SSA_KEYWORDS` replaces `WINE_KEYWORDS` in guardrails; `SQL_HELPER_MAP` made dynamic.
- **SQL helpers** — 6 renamed (`wine → satellite`, `grape-profiler → payload-profiler`, `terroir → orbit-regime`, `price-context → launch-cost-context`, `user-cellar → user-fleet`, `user-portfolio → user-mission-portfolio`). Audit queries reshaped around regime-mismatch, mass-anomaly, mission-class-inconsistency.
- **Source fetchers** — 6 renamed (ampelography → bus-archetype, chemistry → spectra, climate → space-weather, market → launch-market, terroir → orbit-regime, vintage → celestrak). Storage seed: 30 SSA RSS feeds (CelesTrak, CNEOS, IADC, arxiv astro-ph).
- **Nano-swarm** — 50 researcher lenses remapped to SSA (18SDS, LeoLabs, ESA SDO, BryceTech, SpaceX/OneWeb/Intelsat, Pc/Kp/F10.7). Architecture untouched.
- **Sweep** — wine* files → satellite*, editorial-copilot → briefing-copilot, cdc parser → doctrine parser. Redis prefix `sweep:` unchanged; Redis-key tokens migrated to `satellite-sweep:`.
- **Shared** — `grape-profile.schema.ts` → `payload-profile.schema.ts` with SSA fields (radiometric / optical / rf / thermal / reliability / spaceWeatherSensitivity). `CardCategory` union updated.
- **Result** — zero wine / grape / vintage / appellation / terroir references anywhere in the repo. `packages/shared` tests (70) still green. `packages/db-schema` and `packages/shared` typecheck clean; `packages/thalamus` retains the pre-existing baseline errors tracked under "Build cleanup".

### Specifications — spec-first workflow

Infrastructure:

- `docs/specs/preamble.tex` — shared LaTeX preamble (custom environments: `invariant`, `scenario`, `ac`, `nongoal`; Given/When/Then/And macros; status lifecycle: DRAFT / REVIEW / APPROVED / IMPLEMENTED).
- `docs/specs/template.tex` — reference template for new specs.
- `docs/specs/Makefile` — `make` / `make clean` / `make watch` / `make list` via `latexmk`.
- `docs/specs/README.md` — workflow rules: every module has a spec, every AC has a test, every test carries `@spec <path>` tag, CI gate planned on traceability.

Retroactive specs written in parallel by 10 opus agents (24 total):

`shared/` (5):

- SPEC-SH-001 `try-async` — error-as-value control flow contract.
- SPEC-SH-002 `app-error` — error hierarchy and serialization.
- SPEC-SH-003 `completeness-scorer` — data completeness scoring function.
- SPEC-SH-004 `domain-normalizer` — domain-agnostic string/identifier normalization.
- SPEC-SH-005 `observability` — Pino logger + Prometheus metrics contract (redaction invariant, per-collector registry isolation).

`db-schema/` (2):

- SPEC-DB-001 `schema-contract` — schema stability invariants.
- SPEC-DB-002 `typed-repos` — typed repository pattern.

`thalamus/` (11):

- SPEC-TH-001 `orchestrator` — plan → dispatch → aggregate lifecycle.
- SPEC-TH-002 `cortex-registry` — registration + resolution contract.
- SPEC-TH-003 `cortex-pattern` — invariants every cortex must satisfy.
- SPEC-TH-010 `nano-swarm` — bounded parallel retrieval (≤ 50 × `gpt-5.4-nano`).
- SPEC-TH-011 `source-fetchers` — typed fetcher interface.
- SPEC-TH-012 `curator` — synthesis + deduplication contract.
- SPEC-TH-020 `guardrails` — 5 invariants: non-bypassable, monotonic cost, depth-bounded-by-construction, breach-observable, unverifiable-quarantined.
- SPEC-TH-030 `knowledge-graph-write` — provenance propagation (skill `sha256` carried edge-side).
- SPEC-TH-031 `skills-as-files` — skills as versioned markdown files.
- SPEC-TH-040 `dual-stream-confidence` — OSINT × Field fusion, `source_class ∈ {FIELD_HIGH, FIELD_LOW, OSINT_CORROBORATED, OSINT_UNCORROBORATED}`, confidence bands.
- SPEC-TH-041 `field-correlation` — sub-second p99 SLO (critical 500 ms / routine 2 s / background 10 s), budget split, `LatencyBreach` observable, no drop.

`sweep/` (6):

- SPEC-SW-001 `nano-sweep` — bounded swarm DB audit producer.
- SPEC-SW-002 `finding-routing` — pending buffer dispatch.
- SPEC-SW-003 `resolution` — reviewer-driven HITL apply/reject.
- SPEC-SW-010 `feedback-loop` — reject signals feed back into next-run prompt.
- SPEC-SW-011 `editorial-copilot` — reviewer-assist flow.
- SPEC-SW-012 `chat-rate-limit` — chat repository rate limits.

Compilation fixes applied to the preamble:

- `\And` collision with other packages — guarded via `\providecommand{\And}{}` + `\renewcommand`.
- `fancyhdr` `\@specID` references moved inside `\makeatletter` / `\makeatother`.
- Added `amsmath` + `amssymb` for `\lceil`, `\rceil`, `\text{}`.
- `lstlisting` UTF-8 handling via `\lstset{inputencoding=utf8, extendedchars=true, literate=...}` covering em-dash, quotes, accented Latin-1, math symbols (`→`, `←`, `×`, `≥`, `≤`, `≠`, `∈`, `⌈`, `⌉`, `∞`, `α`, `β`).
- `observability.tex`: math-mode `\lvert\lvert` inside `\texttt{}` replaced by literal `||`.

Result: all 24 PDFs compile cleanly via `make` in `docs/specs/`.

### Build cleanup

- `tsconfig.base.json` relaxed to match originating monorepo's strictness (`noUncheckedIndexedAccess: false`) — the code was written without that assumption and re-tightening it belongs to a post-interview hardening pass.
- `packages/sweep` missing `package.json` + `tsconfig.json` (to add).
- `packages/shared/src/utils/csv-reader.ts` and `pdf-table-reader.ts` reference missing deps (`csv-parse`, `pdf-parse`) and are unused outside `shared` — slated for removal.
- `packages/db-schema/src/schema/satellite.ts` GIN index uses Drizzle API not present in pinned version — to bump or drop.

## [0.1.0] — 2026-04-13

Initial extraction from a larger production monorepo, trimmed for interview review (Cortex / Thales).

### Added

- pnpm workspace with four packages: `shared`, `db-schema`, `thalamus`, `sweep`
- Root `tsconfig.base.json` with `@interview/*` path aliases
- `vitest.workspace.ts` with unit / integration / e2e projects

### Extracted — `@interview/shared`

- Error primitives: `AppError`, `ValidationError`, `SystemError`, `tryAsync`
- Async/collection/string/JSON utilities
- Domain-agnostic normalizers and HTML entity handling
- Data processing: `column-mapper`, `data-sanitizer`, `completeness-scorer`, `batch-processor`
- Observability: `createLogger`, `MetricsCollector`
- Barrel exports via `src/index.ts`

### Extracted — `@interview/db-schema`

- Drizzle ORM schema (entities, users, research graph, sweep findings, content)
- Typed query helpers kept alongside the schema

### Extracted — `@interview/thalamus`

- Orchestrator + executor (cortex dispatch)
- 11 cortices, each owning skills and SQL helpers
- Explorer subsystem: nano swarm (up to 50 × `gpt-5.4-nano`), scout, curator, crawler
- 20 skill prompts as versioned markdown (`cortices/skills/*.md`)
- 8 typed source fetchers behind a common interface
- Guardrails: cost caps, depth limits, hallucination checks
- Namespace migration: all internal imports rewritten to `@interview/*`

### Extracted — `@interview/sweep`

- Services: `nano-sweep`, `resolution`, `editorial-copilot`, `chat`, `finding-routing`
- Stubs for domain-specific downstream services (decoupled from the original product)
- Controllers: `admin-sweep`, `editorial-copilot`, `chat`
- Admin routes trimmed to sweep-only endpoints
- BullMQ queues, schedulers, workers trimmed to sweep-only jobs
- Redis finding repository with feedback-loop persistence
- Rate-limited chat repository with finding history

### Changed

- Domain-specific identifiers removed from code, docs, and config
- All `@/*` and relative cross-package imports rewritten to `@interview/*`

### Infrastructure stubs

- Redis client stub
- Auth middleware stub
- Messaging (email/notification) stub
- Dependency injection container scaffolding
