# Changelog

All notable changes to the interview extraction of Thalamus + Sweep.

## [Unreleased]

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
