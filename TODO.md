# TODO

Interview-readiness checklist for Thalamus + Sweep — **target interview: CortAIx (Thales AI division)**.

## Extraction (done)

- [x] Init pnpm workspace + 4 packages (`shared`, `db-schema`, `thalamus`, `sweep`)
- [x] Extract `shared` (utils, types, enums, normalizers, observability)
- [x] Extract `db-schema` (Drizzle schema + query helpers)
- [x] Extract `thalamus` (cortices, orchestrator, explorer/nano-swarm, 20 skills)
- [x] Extract `sweep` (nano-sweep, resolution, editorial copilot, admin routes)
- [x] Rewrite import paths to `@interview/*` namespace
- [x] Stub downstream services to isolate sweep from original domain complexity
- [x] Stub Redis, auth, messaging, DI infra layers
- [x] Trim admin routes to sweep-only endpoints
- [x] Trim BullMQ queues and schedulers to sweep-only jobs
- [x] Sanitize client-specific identifiers from code and docs
- [x] README with CortAIx framing + Threat Intelligence transposition mapping

## Spec-first workflow (done)

- [x] LaTeX scaffolding: `docs/specs/preamble.tex`, `template.tex`, `Makefile`, `README.md`
- [x] Custom environments (`invariant`, `scenario`, `ac`, `nongoal`) + Given/When/Then/And macros
- [x] 24 retroactive specs written by 10 parallel opus agents:
  - shared (5): try-async, app-error, completeness-scorer, domain-normalizer, observability
  - db-schema (2): schema-contract, typed-repos
  - thalamus (11): orchestrator, cortex-registry, cortex-pattern, nano-swarm, source-fetchers, curator, guardrails, knowledge-graph-write, skills-as-files, dual-stream-confidence, field-correlation
  - sweep (6): nano-sweep, finding-routing, resolution, feedback-loop, editorial-copilot, chat-rate-limit
- [x] Preamble compilation fixes (`\And` collision, `fancyhdr` in `\makeatletter`, `amsmath`/`amssymb`, `lstlisting` UTF-8 literate)
- [x] All 24 PDFs compile via `make` in `docs/specs/`

### Spec work remaining

- [ ] Move specs from `DRAFT` → `REVIEW` → `APPROVED` status as contracts are validated
- [ ] `scripts/spec-check.ts` — CI gate: walk test files, extract `@spec` tags, assert each AC has a matching test and vice versa
- [ ] Add `spec-build` CI job — run `make all` in `docs/specs/`, publish PDFs as artifacts

## Tests tracing to Acceptance Criteria

Every spec has a Traceability table; tests must land at those paths and the `describe` block must carry the AC id. Below is the consolidated list per package.

### `@interview/shared`

- [ ] `tests/try-async.spec.ts` — SPEC-SH-001 (AC-1..n)
- [ ] `tests/app-error.spec.ts` — SPEC-SH-002
- [ ] `tests/completeness-scorer.spec.ts` — SPEC-SH-003
- [ ] `tests/domain-normalizer.spec.ts` — SPEC-SH-004
- [ ] `tests/logger.spec.ts` + `tests/metrics.spec.ts` — SPEC-SH-005

### `@interview/db-schema`

- [ ] `tests/schema-contract.spec.ts` — SPEC-DB-001
- [ ] `tests/typed-repos.spec.ts` — SPEC-DB-002

### `@interview/thalamus`

- [ ] `tests/orchestrator.spec.ts` — SPEC-TH-001
- [ ] `tests/cortex-registry.spec.ts` — SPEC-TH-002
- [ ] `tests/cortex-pattern.spec.ts` — SPEC-TH-003
- [ ] `tests/nano-swarm.spec.ts` — SPEC-TH-010
- [ ] `tests/source-fetchers.spec.ts` — SPEC-TH-011
- [ ] `tests/curator.spec.ts` — SPEC-TH-012
- [ ] `tests/guardrails.spec.ts` — SPEC-TH-020 (5 invariants × AC)
- [ ] `tests/knowledge-graph-write.spec.ts` — SPEC-TH-030 (sha256 provenance)
- [ ] `tests/skills-as-files.spec.ts` — SPEC-TH-031
- [ ] `tests/dual-stream-confidence.spec.ts` — SPEC-TH-040 (confidence bands, FIELD dominance)
- [ ] `tests/field-correlation.spec.ts` — SPEC-TH-041 (p99 SLO, `LatencyBreach`, no drop)

### `@interview/sweep`

- [ ] `tests/unit/nano-sweep.{batching,parser,callbacks,cost,cap}.spec.ts` + `tests/integration/nano-sweep.readonly.spec.ts` — SPEC-SW-001
- [ ] `tests/finding-routing.spec.ts` — SPEC-SW-002
- [ ] `tests/resolution.spec.ts` — SPEC-SW-003
- [ ] `tests/feedback-loop.spec.ts` — SPEC-SW-010
- [ ] `tests/editorial-copilot.spec.ts` — SPEC-SW-011
- [ ] `tests/chat-rate-limit.spec.ts` — SPEC-SW-012

## Pre-commit + CI (spec-oriented)

- [ ] `husky` + `lint-staged` pre-commit: typecheck, lint, format, unit tests on staged files
- [ ] CI pipeline: `pnpm -r typecheck` → `pnpm -r lint` → `pnpm -r test --coverage` → `make -C docs/specs all` → `tsx scripts/spec-check.ts`
- [ ] 100% coverage gate on `shared` (pure functions, no excuse); pyramidal target 70% unit / 25% integration / 5% e2e on thalamus + sweep
- [ ] Coverage artifacts published per PR

## Build cleanup (in progress)

- [ ] Add `packages/sweep/package.json` and `packages/sweep/tsconfig.json` (currently missing)
- [ ] Remove unused `csv-reader.ts` / `pdf-table-reader.ts` from `shared` (missing `csv-parse` / `pdf-parse` deps, not used by thalamus or sweep)
- [ ] `pnpm -r typecheck` passes cleanly across all four packages
- [ ] `pnpm -r build` passes (if/when build scripts are added)
- [ ] Drizzle `using`/`op` index error in schema (bump drizzle-orm or drop the GIN index)

## Domain pivot to SSA (Space Situational Awareness) — done 2026-04-13

The repo was pivoted from its original commercial domain to SSA (collision avoidance, dual-stream OSINT × classified radar, HITL = mission operator). Mapping is schema-level, not cosmetic: `satellite / operator / operator_country / payload / orbit_regime / platform_class / satellite_bus / satellite_payload` are the canonical entities. Cortices are now SSA-native: `catalog / observations / conjunction-analysis / correlation / maneuver-planning` (core 5) plus 13 analysts / auditors.

- [x] Rename schema (`schema/wine.ts` → `schema/satellite.ts`) + entity types
- [x] Rewrite cortex skill prompts (22 files: 5 new core SSA + 12 renames + 5 rewritten in place)
- [x] Rename sql-helpers (6 files) + source fetchers (7 files) to SSA vocabulary
- [x] Orchestrator layer: cortex registry, executor, guardrails (`SSA_KEYWORDS`), `SQL_HELPER_MAP` made dynamic, storage seeds (30 SSA RSS feeds)
- [x] Thalamus services / utils / explorer rewritten (nano-swarm prompts, crawler/curator/scout SSA lenses)
- [x] Sweep package: wine* files → satellite*, editorial-copilot → briefing-copilot, cdc → doctrine
- [x] `shared/schemas/grape-profile.schema.ts` → `payload-profile.schema.ts` (new SSA fields: radiometric, optical, rf, thermal, reliability, spaceWeatherSensitivity)
- [x] Remove all 3 compat shims (db-schema/schema/wine.ts, shared/schemas/grape-profile.schema.ts, thalamus/utils/wine-entity-patterns.ts)
- [x] Zero wine/grape/vintage/appellation/terroir references remain in the repo

## Strategic tests

Targeted coverage, not exhaustive — tests picked to demonstrate design intent to a reviewer.

### shared

- [ ] `tryAsync` tuple semantics (success / caught / rethrow)
- [ ] `AppError` hierarchy + structured-cause serialization
- [ ] Domain normalizers — edge cases that break naive string matching
- [ ] `completeness-scorer` adaptive weight normalization when fields are missing

### db-schema

- [ ] Typed query helpers against a fresh pg instance (smoke)
- [ ] Schema migration round-trip

### thalamus

- [ ] `orchestrator.executor` dispatches to the right cortex by query shape
- [ ] `nano-swarm` parallelism + curator dedup (mock `nano-caller`)
- [ ] `guardrails` enforces depth and cost caps, surfaces partial results on breach
- [ ] One end-to-end cortex path: query → plan → explore → entity write (LLM mocked)

### sweep

- [ ] `nano-sweep.service` emits findings shape expected by `finding-routing`
- [ ] `resolution.service` applies an accepted suggestion in a transaction, writes audit row
- [ ] Feedback loop: reject → next-run prompt includes the rejection signal
- [ ] Rate-limit + dedupe in the chat repository

### e2e

- [ ] Thalamus: one end-to-end query routed through executor, LLM mocked, graph write verified
- [ ] Sweep: trigger → finding → reviewer accept → DB write + audit row (all in-memory/redis-mock)

## Docs

- [x] README.md — system overview + CortAIx framing + Threat Intel transposition table
- [x] TODO.md (this file)
- [x] CHANGELOG.md — extraction history
- [x] `docs/specs/` — 24 LaTeX specs (see "Spec-first workflow" above)
- [ ] `docs/architecture.md` — cortex pattern deep-dive with diagrams
- [ ] `docs/sweep-feedback-loop.md` — how rejection signals feed back into prompts
- [ ] `docs/threat-intel-mapping.md` — detailed walkthrough of the transposition (per cortex, per fetcher, per skill)
- [ ] Per-package `README.md` for thalamus and sweep

## Interview prep — CortAIx / Thales

### Narrative (Olivier)

- [ ] Write first-person pitch (5–7 min): problem → system shape → why cortex pattern → why nano swarm → guardrails → transposition to threat intel → tradeoffs
- [ ] Open with the honest framing: "built on a commercial domain, pattern is domain-agnostic, here's the mapping"
- [ ] Close with "what I'd change to ship this at Thales" (sovereign models on classified cortices, STIX/TAXII source fetchers, CERT-FR/ANSSI feeds)

### Code walkthrough

- [ ] One file per package picked and rehearsed:
  - [ ] `thalamus/src/orchestrators/executor.ts` — orchestration + guardrails
  - [ ] `sweep/src/services/nano-sweep.service.ts` — swarm + finding routing
  - [ ] `db-schema/src/schema/` — typed repo contract
  - [ ] `shared/src/utils/try-async.ts` — error discipline
- [ ] Diagram ready for each (whiteboard-able)

### Anticipated questions — have answers ready

- [ ] **Sovereignty**: how would you deploy this on classified data? (sovereign models per cortex, air-gapped source fetchers, on-prem pgvector)
- [ ] **Cost control**: how do you cap runaway agents? (budget per cortex, depth cap, partial-result surfacing on breach)
- [ ] **Hallucination on IOCs**: hallucinated IOC = security incident. How do you prevent it? (structured-only outputs via Zod, source-reliability scoring, reviewer gate on Sweep before DB write)
- [ ] **Multi-provider**: what if OpenAI is blocked? (model selection is per-step config, nano swarm is the only OpenAI-leaning layer — swap for Mistral/LLaMA)
- [ ] **Human-in-the-loop boundaries**: when does the agent write autonomously? (never into source-of-truth; only into pending Redis buffer until reviewer accepts)
- [ ] **Observability**: prove a cortex was cost-effective last week (Prometheus counters per cortex/source/skill, query → histogram)
- [ ] **Testability**: how do you test an LLM-in-the-loop system? (mock at the `nano-caller` / `SourceFetcher` boundary, unit-test cortices and services, integration-test executor with fakes)
- [ ] **Failure modes**: what breaks at scale? (Redis memory growth on findings, rate-limit contention on nano swarm, audit-row volume — each has an answer)

### Panel identified (see memory/project_cortaix_panel.md)

- **Olivier Albiez** — Software Architect CortAIx Factory, DDD / hexagonal / Strasbourg. **Primary tech interviewer.**
- **Fleur Saillofest** — Engineering Delivery Manager, ex-OCTO, ex-beNext coach. **Craftsmanship / agile / delivery posture.**
- **Mélanie Grondin** — Head of Operations CortAIx Factory. **Low panel probability — budget/authority.**
- Chain: Olivier (technical) → Fleur (delivery) → Mélanie (authority).
- Mission context: CortAIx Factory SAS, 11 Bd Gallieni Issy-les-Moulineaux, freelance 8 mois (31/04 → 31/12/2026), tech lead + craftsmanship + CI/CD + mentoring.

### Use cases — Factory framing

Primary build pitched as **Space Situational Awareness** (orbital collision avoidance). One-step transposition to **Threat Intelligence**. Three other transpositions kept in reserve.

- [ ] **Space Situational Awareness** (primary): dual-stream OSINT × classified radar, HITL = mission operator, threshold P(collision) ≥ 10⁻⁴, `Maneuver` audit ledger. Every Thales BL operating space assets has a variant — Factory promise pitch in one sentence.
- [ ] **Threat Intelligence** (one-step transposition): schema rename + fetcher swap, nothing else. Show the mapping table live.
- [ ] Plan B transpositions (mention only if asked): **pharmacovigilance**, **IUU fishing / maritime surveillance**, **regulatory & export-control**.

### Opening pitch (30 sec)

> "J'ai bâti un **pattern** d'agent multi-cortex avec swarm parallèle et sweep HITL audité. Le domaine du build initial est commercial — ce qui compte c'est que la même plateforme produit 11 cortices aujourd'hui, et que n'importe quelle BL Thales peut brancher son domaine sans toucher l'orchestrateur, les guardrails, ni le workflow HITL. Je vous montre le pattern sur un cas d'usage critique — **évitement de collision orbitale** — puis je le transpose en une étape au Threat Intelligence. C'est une **Factory d'agents**, pas un agent."

### SSA build — talking points (3 min)

- [ ] Draw the loop: OSINT (TLE publics, observateurs amateurs) → catalog cortex → correlation cortex ← Field (radars classifiés, télémétrie opérateur) → ConjunctionEvent → seuil P ≥ 10⁻⁴ → Sweep finding → operator accept → Maneuver + audit row
- [ ] Show the cortices: `catalog`, `observations`, `conjunction-analysis`, `correlation`, `maneuver-planning`
- [ ] Confidence bands: OSINT edges [0.2–0.5], field-corroborated [0.85–1.0], uncorroborated stays flagged with provenance breakdown
- [ ] Guardrail in code: hypothesis conjunction cannot promote to actionable without field corroboration — enforced by `field-correlation` cortex per SPEC-TH-040
- [ ] Economic framing: false positive = delta-v burned = quantifiable cost; false negative = Kessler-class incident. Confidence metadata is not instrumentation, it drives the go/no-go.

### Transposition to Threat Intel (1 min, live on whiteboard)

- [ ] Replace `catalog` → `vulnerability-catalog`, `observations` → `ioc-normalization`, `correlation` → `dual-stream-correlation`
- [ ] Replace TLE / radar → NVD/STIX/CERT-FR / tactical data-link
- [ ] Replace `ConjunctionEvent` → `ThreatEvent`, `Maneuver` → `Response`
- [ ] **Stay generic — don't name their systems**: "tactical data-link", "sensor-fusion bus", "mission debrief", "C2 feed". Let them recognize their own stack and volunteer the names.
- [ ] Land the punch: "**same code, new domain**. That's the Factory promise — ship the platform once, plug a domain per BL."

### Architecture additions to prototype (post-interview, if they bite)

- [ ] `thalamus/src/cortices/{catalog,observations,conjunction-analysis,correlation,maneuver-planning}/` — SSA cortex stubs with skill `.md` prompts
- [ ] `thalamus/src/cortices/sources/osint/` — `TLEFetcher`, `AmateurObsFetcher`, `SpacePressFetcher`
- [ ] `thalamus/src/cortices/sources/field/` — generic `ClassifiedRadarFetcher`, `OperatorTelemetryFetcher` (stubbed, mockable)
- [ ] `thalamus/src/transports/tactical-bus.ts` — generic Kafka / ZeroMQ / MQTT abstraction (used by field fetchers)
- [ ] `db-schema` — `Satellite`, `Debris`, `Observation`, `ConjunctionEvent`, `Maneuver` entities; every edge table carries `confidence` + `source_class`
- [ ] Sweep rule: `ConjunctionEvent` with P ≥ 10⁻⁴ and no field corroboration > N hours → priority finding
- [ ] One end-to-end demo script: synthetic TLE + synthetic radar track → conjunction detected → operator accept in Playwright → `Maneuver` row + audit

### The 4 Olivier axes to hit explicitly

- [ ] **Souveraineté** — multi-provider, per-step model selection, nothing tied to a vendor
- [ ] **Contrôle** — bounded agents, guardrails in code not in prompts, cost/depth caps, rogue-agent story as contrast
- [ ] **Human-in-the-loop** — Sweep never writes blind, every mutation audited and reversible
- [ ] **Testabilité** — 5-layer arch, typed repos, vitest workspace with unit/integration/e2e ready to show

### Live-demo readiness

- [ ] `pnpm -r typecheck` green
- [ ] `pnpm test` green
- [ ] Repo browsable with clickable file links in README
- [ ] One cortex skill file opened and explained (`cortices/skills/*.md`)

## Multi-agent simulation swarm (NEW — MiroFish-inspired)

Spec: [docs/specs/sweep/multi-agent-sim.tex](docs/specs/sweep/multi-agent-sim.tex) (SPEC-SW-006)
Plan: [tasks/sweep-sim-plan.md](tasks/sweep-sim-plan.md) — 9 phases, ~6h total

**Core idea:** many cheap small-model "fish" cover the possibility space. A swarm of K fish, each perturbed (god-event, persona, constraints), produces an outcome distribution. Single runs = size-1 swarm. Nano model per fish, ~$0.01/fish.

Use cases:

- **UC1 swarm** — operator behaviour under perturbation; 50 fish, DAG driver, coverage over operator decisions
- **UC3 swarm** — conjunction negotiation; 30 fish, Sequential driver, modal resolution → `sweep_suggestion` with distribution metadata

- [ ] Phase 1 — DB schema (`sim_swarm`, `sim_run`, `sim_agent`, `sim_turn`, `sim_agent_memory` + HNSW)
- [ ] Phase 2 — Types incl. `PerturbationSpec`/`SwarmConfig`, Zod schemas, agent-builder, memory service
- [ ] Phase 3 — Shared `sim_operator_agent` cortex + two drivers (DAG for UC1 parallel, Sequential for UC3 alternation)
- [ ] Phase 4 — Per-fish orchestrator (internal: `scheduleNext`, `pause/resume/inject`)
- [ ] Phase 4.5 — **Swarm service** + perturbation generators + fan-out worker + aggregator (k-means on terminal embeddings) + quorum logic
- [ ] Phase 5 — `sim_reporter` (single fish) + `sim_swarm_reporter` (coverage) cortex skills + promotion to suggestion
- [ ] Phase 6 — Swarm auto-spawn from conjunction findings, `/admin/swarm/*` routes, chat scope (`simRunId`/`swarmId`)
- [ ] Phase 7 — Demos `swarm-uc3.ts` / `swarm-uc1.ts` + Makefile targets + fixture recording
- [ ] Phase 8 — Unit + integration tests (quorum fail-soft, determinism, cross-fish isolation) + final anti-pattern sweep

Exit criteria: `make swarm-uc3` < 180s fixtures-mode (30 fish), `make swarm-uc1` < 300s (50 fish), deterministic aggregator output, one suggestion per swarm max, thalamus→sweep import direction preserved.

## Next up — conversational CLI + fish quick wins

Interactive CLI that captures logs, accepts queries, and delivers briefings
readable by a non-technical reviewer. Each fish quick-win reuses the SPEC-SW-006
sim-swarm infrastructure (already shipped) so impact >> effort.

### Priority 1 — CLI foundation (DONE 2026-04-14)

Shipped as `@interview/cli` via 22-task TDD plan (see
[docs/superpowers/plans/2026-04-14-conversational-cli.md](docs/superpowers/plans/2026-04-14-conversational-cli.md)).
46 specs green.

- [x] `pnpm run ssa` entrypoint — two-lane router (slash grammar +
      `interpreter` cortex emitting Zod `RouterPlan`)
- [x] Commands: `query`, `telemetry`, `logs`, `graph`, `accept`, `explain`
- [x] Source-class color bar + confidence sparkline, cost dial, rolling ETA
- [x] Animated emoji logs (6 fps) + ASCII satellite loader with p50/p95 ETA
- [x] 6 renderers (briefing, telemetry, logTail, graphTree, whyTree, clarify)
- [x] Memory buffer + palace (`sim_agent_memory` HNSW, 200k token threshold)
- [x] `analyst_briefing` + `interpreter` cortex skills
- [x] E2E happy-path test

Deferred (non-blocking for the demo):

- [ ] `buildRealAdapters` in `cli/src/boot.ts` — wire thalamus/telemetry/
      graph/resolution/why to real services (needs shared DB+Redis+LLM
      bootstrap). CLI boots in stub mode; `logs` is real.
- [ ] `analyst_briefing` end-to-end in `runCycle` output (skill exists)
- [ ] Aggregator / swarm-service / promote `stepLog` emission

### Priority 2 — Fish quick-wins (ranked by pitch value)

Each reuses `startInvestigationSwarm(query, targetEntity, K)` — generalised
from `startTelemetrySwarm`.

- [ ] **Conjunction Pc probabilistic estimator (~45 min)** — take a
      `conjunction_event`, K fish estimate Pc with perturbed assumptions
      (hard-body radius 5 / 10 / 20 m, covariance tight / loose). Aggregator
      → median + sigma + dissent clusters. Fixes the "all Pc = 1e-2
      algorithmic default" gap flagged by the earlier demo cycle.
- [ ] **Maneuver cost estimator (~60 min)** — K fish propose burns (dV,
      timing, post-maneuver re-screen). Aggregator finds the Pareto front
      over cost x residual-risk. Reviewer accepts the Pareto-efficient pick
      → `sweep_suggestion` with `kind: "maneuver"` payload.
- [ ] **Why? button (~30 min)** — on any finding, traces provenance via
      `research_edge` back to the source_item + skill sha256. ASCII tree
      render in the CLI. Instant explainability for a non-tech reviewer.
- [ ] **Anomaly triage (~60 min)** — suspect low-confidence finding → K fish
      each propose 3-5 explanation hypotheses (pipeline bug / real event /
      sensor error / data gap). Aggregator clusters hypotheses, reviewer
      picks. Demonstrates "system knows when it doesn't know".
- [ ] **Operator posture inference (~45 min)** — K fish impersonate
      doctrines (commercial / institutional / military-like), vote on the
      operator's actual posture based on fleet mass / regime / cadence.
      Fills an `operator.posture` field never publicly disclosed.
- [ ] **"Dig into" follow-up (~30 min)** — in the CLI, follow-up query
      relaunches a micro-swarm scoped to the previous finding's entity +
      accumulated context. Conversational drilldown.
- [ ] **Debris decay forecaster (~75 min)** — requires debris ingestion
      first (see P4). K fish estimate remaining orbital lifetime per
      catalogued debris using live NOAA F10.7 + altitude. Top-20 "likely
      decay next 30d" as findings.
- [ ] **What-if scenario (~90 min)** — "what if operator X launches 100
      sats in SSO next month?" → K fish simulate impact on conjunction
      rate, congestion, operator reactions. Aggregator = distribution of
      plausibility outcomes.

### Priority 3 — Grafana / Prometheus (~1h)

- [ ] HTTP `/metrics` endpoint on port 8080 serving `registry.metrics()`
      (prom-client text format)
- [ ] Instrumentation at 5 points: `thalamus_cycles_total{status}`,
      `thalamus_cortex_duration_seconds{cortex}` (histogram),
      `thalamus_cycle_cost_usd` (counter),
      `sweep_fish_duration_seconds{kind}` (histogram),
      `sweep_suggestions_emitted_total{source_class,severity}` (counter)
- [ ] `docker-compose.yml` — add prometheus (scrape `:8080/metrics`) +
      grafana (port 3000, provision `dashboard.json` at boot)
- [ ] `infra/grafana/dashboards/ssa.json` — 8 panels: cycle rate,
      findings/cycle, cost/cycle, cortex p50/p99, swarm quorum, conjunction
      rate by regime, fish dispersion, source_class distribution

### Priority 4 — Debris ingestion (~45 min)

Probability of collision sat x debris >> sat x sat in LEO. GCAT catalogues
~60k objects; we currently seed 1500 active payloads only.

- [ ] Extend `satellite` table OR add `space_object` table — field
      `object_class enum('payload','rocket_stage','debris','unknown')`
- [ ] `seed/debris.ts` — filter GCAT `Type ∈ {R, D, ?}` where `DDate IS NULL`
      (not decayed), upsert with same regime classification
- [ ] Extend `conjunctions-cli.ts` to screen `payload x any` pairs (not just
      payload x payload). Expect ~20x more conjunction candidates in LEO.

### Bottom line — interview pitch combo (~2h15)

CLI + interpreter cortex (P1) + **Pc estimator + maneuver Pareto + Why button**
(first three P2) = decision-support under uncertainty with auditable
provenance, live. Matches the README pitch. Everything else is polish.
