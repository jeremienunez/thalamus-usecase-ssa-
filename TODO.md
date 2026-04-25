# TODO

Portfolio-readiness checklist for Thalamus + Sweep.

**Audited 2026-04-19** — the old 823-line list was split three ways:

- [DONE.md](DONE.md) — shipped & verified (149 `[x]` items + 8 newly-verified unchecked)
- [TO-REVIEW.md](TO-REVIEW.md) — partially landed, needs human triage
- This file — genuinely open + non-code interview prep

---

## Coverage — top 10 winners

Moved to [DONE.md](DONE.md#coverage--top-10-winners-closed-2026-04-23).
Current repo coverage: `lines 71.45%` / `statements 70.61%` /
`functions 67.06%` / `branches 63.97%`. Remaining work is per-file
threshold/config cleanup on lower-priority files, not the absence of
coverage on these 10 slices.

## 🔎 Review checklist — 2026-04-19 session (9 fixes to commit)

Archived. This checklist was merged to `main`; keep the audit details in
`docs/refactor/architecture-audit-2026-04-19.md` and the shipped state in
`CHANGELOG.md` / `DONE.md`, not here.

### Runtime config registry + admin UI — 2026-04-19 (session 3)

Phases 1-7 shipped — moved to [DONE.md](DONE.md#runtime-config-registry--4-llm-providers--2026-04-19).

**Still open from this pass** (sim.swarm + sim.embedding.embedConcurrency
wiring items moved to [DONE.md](DONE.md#runtime-config-registry--admin-ui-follow-ups--2026-04-22)):

- [ ] Per-query cortex filter UI — REPL-level checkbox panel
      (include/exclude per turn) + extend `POST /api/repl/turn` body
      with `{cortexFilter?: {include?: [], exclude?: []}}`. Backend
      already supports it at config level (`forcedCortices` /
      `disabledCortices`); per-query just needs the plumbing.
- [ ] Tier 2 planner-bias fix — bucketed catalog + few-shots in
      `planner.prompt.ts` if the Tier 1 description rewrite proves
      insufficient after live testing.
- [ ] Env keys — document `MINIMAX_API_KEY`, `MINIMAX_API_URL`,
      `MINIMAX_MODEL`, `LOCAL_LLM_URL`, `LOCAL_LLM_MODEL` in
      `.env.example`.

---

### Console front 5-layer — god-component internals (follow-up)

The 3 monolith splits + DRY pass shipped in session 4 — see
[DONE.md](DONE.md#console-front--solid-compression--dry-pass--2026-04-19-session-4).
OpsEntry RTL coverage now also lives in
[DONE.md](DONE.md#console-front-5-layer--god-component-internals-follow-up).
Two items remain open from this section.

- [ ] **Bundle split** — `build.rollupOptions.output.manualChunks`
      per mode (3D libs for ops only, sigma/graphology for thalamus
      only); lazy TanStack Router file routes per mode. Today the
      single bundle is 1.6MB (gzip 449KB) — warning noted in
      TO-REVIEW.
- [ ] **SGP4 cache LRU** — `adapters/propagator/sgp4.ts:121`
      `satrecByLine1` grows unbounded; add small LRU (10_000 entries
      is ample).

---

### PG functions pass — 2026-04-19 (session 2)

Steps 1-4 shipped — moved to [DONE.md](DONE.md#pg-functions-pass--2026-04-19).

**Manual apply reminder** — migrations 0012 and 0013 are raw SQL
(functions), not drizzle-generated. Apply via:

```
psql "$DATABASE_URL" -f packages/db-schema/migrations/0012_orbital_analytics_fns.sql
psql "$DATABASE_URL" -f packages/db-schema/migrations/0013_conjunction_knn_fn.sql
```

Drizzle-kit push does not pick them up (same as 0001_hnsw_index.sql,
0003_sim_memory_hnsw.sql, 0011_source_item_trgm_gin.sql). A
migration-runner that applies raw SQL alongside drizzle migrations is
tracked separately.

**Still open from this pass**:

- [ ] Step 5 — extract read-only views for `satellite-audit`
      (`auditDataCompleteness`, `auditClassification` at
      `apps/console-api/src/repositories/satellite-audit.repository.ts:20-175`).
      Pure projection, low risk, ~130 LOC saved.
- [ ] Step 6 — `user-fleet.repository.ts:9-180` → two
      jsonb-returning SQL functions (`fn_user_mission_portfolio`,
      `fn_user_fleet_windows`). Blocked on `safe_mission_window` UDF
      (referenced at `satellite.repository.ts:288` and
      `user-fleet.repository.ts:52` but not present in any migration).
      Either ship the UDF as part of this step or stub it.
- [ ] HNSW index on `satellite_enrichment.telemetry_14d` — blocked
      on the `telemetry_14d` column itself not existing in
      `packages/db-schema/src/schema/satellite.ts`. Latent bug in
      `searchByTelemetry` referenced in earlier audit.
- [ ] Skill prompt cleanup — `debris-forecaster.md`,
      `orbit-slot-optimizer.md` still mention `horizonYears` in
      templates. Zod strips the unknowns so no runtime crash; the
      cortex-provider normalisation layer absorbs LLM drift. Update when
      the specs get their next pass.

---

**Still open after this session** (in ordered priority below):

- Critical: C1 triple-write (collapse to one writer) · C2 sim-promotion god-service · C4 thalamus agnosticity (entity patterns + 13 fetchers + opacity prompt)
- Important: I5 sweep→thalamus coupling · I6 duplicate port declarations
- Minor: M1–M5 / M8 (M6, M7, M9, M10 shipped)

---

## REPL verification / follow-up — 2026-04-19

Package de-domainization + front render of `followup.*` events moved to
[DONE.md](DONE.md#repl-verification--follow-up--2026-04-19--2026-04-23).

- [ ] **Live browser SSE sanity check** — record one end-to-end REPL run
      where the parent summary is emitted first, then child follow-up
      events, with no stream contract mismatch in the UI.
- [ ] **Keep the kernel generic** — if follow-up logic expands, extend
      generic contracts only; do not move SSA policy/execution back into
      a package unless a second pack genuinely needs the same semantics.

---

## 🚨 Architecture audit 2026-04-19 — CLAUDE.md breaches

Full details + file:line refs in [docs/refactor/architecture-audit-2026-04-19.md](docs/refactor/architecture-audit-2026-04-19.md). Ordered by impact ÷ effort.

### Critical

C3 shipped — see [DONE.md](DONE.md#architecture-audit-2026-04-19--pass-1-closures).

- [ ] **C1 — collapse triple-write to thalamus tables**. `research_finding`, `research_edge`, `research_cycle` are written from three places:
  - kernel `packages/thalamus/src/repositories/research-*.repository.ts`
  - app-parallel `apps/console-api/src/repositories/finding.repository.ts` (insert L142-162, updateStatus L46-57) + `research-edge.repository.ts` (insert L96-102)
  - raw `db.insert()` in `apps/console-api/src/services/sim-promotion.service.ts:125-218`
  - Fix option A: delete app-parallel repos; route through kernel repos via `ThalamusContainer`.
  - Fix option B (preferred per §1): expose `POST /api/findings`, `PATCH /api/findings/:id/status`, `POST /api/research-edges`; kernel + app + CLI all go through HTTP.
- [ ] **C2 — refactor `apps/console-api/src/services/sim-promotion.service.ts` (511 L)**. Takes `db: NodePgDatabase<typeof schema>` directly (L52) and does `.insert(researchCycle|researchFinding|researchEdge)` inline. Split into `SwarmOutcomePromoter` + `ModalPromotionComposer` + `TelemetryScalarPromoter`. Inject `CyclesPort`, `FindingsWritePort`, `EdgesWritePort`, `SuggestionsPort`. No raw `db` handle.
- [ ] **C4 — finish thalamus kernel de-domainization**. The REPL verification
      contract is now generic again; remaining SSA leakage is elsewhere.
      Move `packages/thalamus/src/utils/satellite-entity-patterns.ts`,
      all `packages/thalamus/src/cortices/sources/fetcher-*.ts`, and
      `packages/thalamus/src/prompts/opacity-scout.prompt.ts` into
      `apps/console-api/src/agent/ssa/thalamus-pack/`. Introduce
      `EntityExtractorPort` in thalamus; inject from console-api at boot
      (same pattern as `setNanoSwarmProfile`). Replace direct calls in
      `packages/thalamus/src/explorer/nano-swarm.ts:279,304`.

### Important

I1 / I2 / I3 / I4 shipped — see [DONE.md](DONE.md#architecture-audit-2026-04-19--pass-1-closures).

- [ ] **I5 (deferred, not a CLAUDE.md breach)** — sweep→thalamus coupling (`CortexRegistry`, `ConfidenceService`, `callNanoWithMode`). Either merge packages or extract a third agnostic `cortex-kernel` package.
- [ ] **I6** — extract duplicate `CyclesPort` / `FindingsWritePort` / `EdgesWritePort` (defined in both `apps/console-api/src/services/enrichment-finding.service.ts:15-25` and `reflexion.service.ts:47-57`) to `apps/console-api/src/services/ports/`. Reconcile `SatellitesReadPort` divergence between `satellite-view.service.ts:5` and `sweep-task-planner.service.ts:13`.

### Minor

- [ ] **M1** — `apps/console-api/src/repositories/stats.repository.ts:18` — `SELECT count(*) FROM research_cycle` raw SQL on kernel-owned table; goes away once C1 lands.
- [ ] **M2** — create `packages/thalamus/src/ports/` and move `CortexDataProvider`, `DomainConfig`, `CortexExecutionStrategy` out of `cortices/types.ts` and `cortices/strategies/` for consistency with sweep.
- [ ] **M3** — split 4-way: `packages/thalamus/src/services/research-graph.service.ts` (513 L — finding CRUD + semantic search + KG assembly + entity queries + archive).
- [ ] **M4** — promote `apps/console-api/src/container.ts:493-504` inline `simLauncher` closure into a `SimLauncherService` with explicit port.

## 🚨 Architecture audit 2026-04-19 — Pass 2 (dead-code / async / barrels / config)

Full details in [docs/refactor/architecture-audit-2026-04-19.md#Pass-2](docs/refactor/architecture-audit-2026-04-19.md). Subagent + manual pass after C3/I4 landed.

### Critical

C5 / C6 / C7 shipped — see [DONE.md](DONE.md#architecture-audit-2026-04-19--pass-2-closures).

### Important

I7 / I8 / I9 / I10 / I11 / I12 shipped — see
[DONE.md](DONE.md#architecture-audit-2026-04-19--pass-2-closures).

### Minor

M6 / M7 / M9 / M10 shipped — see
[DONE.md](DONE.md#architecture-audit-2026-04-19--pass-2-closures).

- [ ] **M5** — `packages/thalamus/src/repositories/research-edge.repository.ts:31-38` — 8-line `void <import>` tree-shake hack. Either use `sql\`${tableName}\`` with imports or drop the imports (tsc doesn't tree-shake; bundler drops side-effect-free imports anyway). Also another C4 instance (thalamus knows SSA tables).
- [ ] **M8** — `packages/sweep/src/repositories/sweep.repository.ts:179,362` — `zrevrange(IDX_ALL, 0, -1)` unbounded. Apply `opts.limit` to the range call when `reviewed !== false`; sample for `getStats`.

---

## Sim / sweep kernel debt (Plan 5 D + Plan 6 B/C/D follow-ups)

- [ ] Delete `packages/sweep/src/sim/promote.ts` (still 592 L, owns SQL + Redis + KG + embeddings + formatting). See **Plan 6** Phase B + C + D.
- [ ] Drop the 5 entries from `PLAN2_DEFERRED_ALLOWLIST` in the arch-guard (Plan 6 Phase D).
- [ ] Unskip the sim arch-guard (Plan 2 Task C.1) — currently `describe.skip` because promote.ts still in kernel.
- [ ] Clean `packages/sweep/src/sim/types.ts` — remove SSA type references (Plan 5 Phase D.5).
- [ ] Consolidate sim source-class promotion through `SsaPromotionAdapter` (Plan 6 Phase C — removes the `simHook.cb` bridge).

## Repository split (post-Plan-2)

- [ ] `satellite-view.repository.ts` ← listWithOrbital, findByIdFull, listByOperator, listMissionWindows, findPayloadNamesByIds
- [ ] `satellite-audit.repository.ts` (exists) ← absorb nullScanByColumn, findSatelliteIdsWithNullColumn, listNullCandidatesForField, discoverNullableScalarColumns
- [ ] `satellite-enrichment.repository.ts` (exists) ← absorb knnNeighboursForField, updateField, getOperatorCountrySweepStats
- [ ] Delete monolithic `satellite.repository.ts` once all callers migrate; update container + controllers.
- [ ] Parallel split on `packages/sweep/src/repositories/satellite.repository.ts` (the legacy one on PLAN2 allowlist) if still alive post-Plan-2.

Rationale: one SQL responsibility per file.

## Spec workflow

- [ ] Move specs from DRAFT → REVIEW → APPROVED status as contracts are validated.
- [ ] Add `spec-build` CI job — run `make all` in `docs/specs/`, publish PDFs as artifacts.

## Spec tests — sweep (none exist yet)

- [ ] `tests/unit/nano-sweep.{batching,parser,callbacks,cost,cap}.spec.ts` + `tests/integration/nano-sweep.readonly.spec.ts` — SPEC-SW-001
- [ ] `tests/finding-routing.spec.ts` — SPEC-SW-002
- [ ] `tests/resolution.spec.ts` — SPEC-SW-003
- [ ] `tests/feedback-loop.spec.ts` — SPEC-SW-010
- [ ] `tests/editorial-copilot.spec.ts` — SPEC-SW-011
- [ ] `tests/chat-rate-limit.spec.ts` — SPEC-SW-012

## CI pipeline

- [ ] Extend the current GitHub Actions set (`test.yml`,
      `arch-check.yml`, `build-push.yml`) so CI also runs workspace
      typecheck + coverage + docs/spec build in a single required path.
- [ ] 100% coverage gate on `shared`; pyramidal 70/25/5 on thalamus + sweep.
- [ ] Coverage artifacts published per PR.

## Build cleanup

- [ ] `pnpm -r build` passes (only `apps/console/package.json` has a build script today).

## console-api 5-layer — code-review follow-ups

5 of 6 items shipped — see
[DONE.md](DONE.md#console-api-5-layer--code-review-follow-ups-closed-2026-04-23).

- [ ] `MissionService` start/stop race — add generation counter to prevent concurrent ticks from rapid start/stop cycles.

## console-api — test surface gaps

Unit, integration, schema, controller, and `test:coverage` items shipped
2026-04-23 — see
[DONE.md](DONE.md#console-api--test-surface-gaps-closed-2026-04-23).

- [ ] e2e gap (narrowed 2026-04-23 — the smoke suite + autonomy-budget /
      enrichment-findings / sweep-mission / runtime-config / swarm / telemetry
      specs already cover `/api/kg/{nodes,edges,graph,neighbourhood}`,
      `/api/findings`, `/api/why/:id`, `/api/stats`, `/api/autonomy/*`,
      `/api/cycles/run`, `/api/sweep/mission/*`, `/api/conjunctions/*`,
      `/api/sim/telemetry/start`, `/api/config/runtime/*`): still missing
      smoke specs for `/api/satellites`, `/api/sweep/suggestions`,
      `/api/sweep/reflexion-pass`, `/api/repl/*`.

## Strategic tests — db-schema

- [ ] Typed query helpers against a fresh pg instance (smoke).
- [ ] Schema migration round-trip.

## Strategic tests — sweep

- [ ] `nano-sweep.service` emits findings shape expected by `finding-routing`.
- [ ] `resolution.service` applies accepted suggestion in a transaction, writes audit row.
- [ ] Feedback loop: reject → next-run prompt includes rejection signal.
- [ ] Rate-limit + dedupe in the chat repository.

## Production-Grade Evaluation Protocol

- [ ] **EVAL-1 - lock the real eval corpus.** Keep
      `docs/evals/real-eval-manifest.json` as the source of truth and require
      `data/evals/_manifest-lock.json` for every scored run. The full profile
      must include ESA Kelvins CDM gold data, CelesTrak SATCAT/GP/SOCRATES,
      NOAA SWPC, ARC-AGI-2, Sapient Sudoku Extreme, Sapient Maze 30x30, and
      Sapient HRM reference code.
- [ ] **EVAL-2 - build the paired eval runner.** Add one runner that executes
      agentic and baseline strategies on the same cases, same data snapshot,
      same seeds, and same budget caps. Output JSONL per call plus one
      aggregate report per run.
- [ ] **EVAL-3 - freeze baselines before tuning.** Define:
      Thalamus agentic loop vs single-pass/retrieval-only baseline, Sweep nano
      audit vs deterministic null-scan, Sim swarm vs one-fish verdict, and HRM
      agentic solver vs direct model call.
- [ ] **EVAL-4 - use nondeterminism correctly.** Run paired seeds, then report
      mean delta, median delta, win rate, bootstrap confidence interval, and
      one-sided sign-test p-value. Never compare unrelated random samples.
- [ ] **EVAL-5 - implement SSA metrics.** Track entity-id exact recall,
      numeric-fidelity error rate, citation/source coverage, hallucinated-ID
      rate, ESA CDM final-risk MAE/RMSE, high-risk AUPRC, maneuver-decision F1,
      and Sim Brier/calibration/cluster coverage.
- [ ] **EVAL-6 - implement HRM metrics.** Track ARC exact accuracy/pass@2,
      Sudoku exact solution and invalid-grid rates, Maze exact/valid path rate,
      shortest-path optimality gap, latency, cost, and failure taxonomy.
- [ ] **EVAL-7 - add cost and provider telemetry.** Log provider, model,
      prompt/output/reasoning token estimates or real usage, web-search calls,
      Voyage embedding calls, retries, timeout, provider failure, parsed-output
      status, cost estimate, latency, and budget stop reason for every call.
- [ ] **EVAL-8 - define budget tiers.** Support a `$25` smoke proof, `$50`
      minimum defensible benchmark, `$100` comfortable internal benchmark, and
      `$250+` paper-grade pass. Each tier must pin case counts, seeds, model
      choices, and max web-search usage.
- [ ] **EVAL-9 - document multimodal status honestly.** Current runtime config
      is text-first (`kimi-k2-turbo-preview`, `gpt-5.4-nano`,
      `gpt-5.4-mini`, `MiniMax-M2.7`, local Gemma, Voyage). If image-based
      ARC/HRM or visual SSA eval is added, introduce an explicit multimodal
      adapter and separate cost estimator instead of implying it exists.
- [ ] **EVAL-10 - publish eval artifacts.** Commit protocol docs and example
      reports, but keep downloaded datasets under ignored `data/evals/`. Each
      report must include commit SHA, manifest hash, runtime config, model
      versions, score tables, costs, and residual risks.

---

## Docs

- [ ] `docs/architecture.md` — cortex pattern deep-dive with diagrams.
- [ ] `docs/sweep-feedback-loop.md` — how rejection signals feed back into prompts.
- [ ] `docs/threat-intel-mapping.md` — detailed walkthrough of the transposition.
- [ ] Per-package `README.md` for thalamus and sweep.

## CLI — real adapters

- [ ] `buildRealAdapters` in `cli/src/boot.ts` — wire thalamus/telemetry/graph/resolution/why to real services.
- [ ] `analyst_briefing` end-to-end in `runCycle` output (skill exists).
- [ ] Aggregator / swarm-service / promote `stepLog` emission.

## Grafana / Prometheus (~1h)

- [ ] HTTP `/metrics` endpoint on port 8080 serving `registry.metrics()` (prom-client text format).
- [ ] Instrumentation at 5 points: `thalamus_cycles_total{status}`, `thalamus_cortex_duration_seconds{cortex}` (histogram), `thalamus_cycle_cost_usd` (counter), `sweep_fish_duration_seconds{kind}` (histogram), `sweep_suggestions_emitted_total{source_class,severity}` (counter).
- [ ] `docker-compose.yml` — add prometheus + grafana.
- [ ] `infra/grafana/dashboards/ssa.json` — 8 panels.

## Debris ingestion — follow-ups

- [ ] Promote `object_class` to a dedicated `space_object` table (true schema separation).
- [ ] `conjunctions-cli.ts` → `conjunctions-knn-cli.ts` — drive narrow-phase SGP4 off `queryConjunctionCandidatesKnn` survivors.
- [ ] Debris decay forecaster cortex (P2 quick-win) — K fish estimate remaining lifetime with live NOAA F10.7 + altitude. Top-20 "likely decay next 30d".

## Priority 5 — follow-ups

- [ ] Unit tests for `applySatelliteFieldUpdate` + `applyKnnFill` (DB UPDATE + audit row write).
- [ ] Fixture-mode fabrication-rejection test — prove `typically…` in a recorded nano response gets blocked.
- [ ] UI button for `/reflexion-pass <norad>` in the console (currently CLI-only via curl).
- [ ] CLI `/reflexion <norad>` verb — colour-coded by MIL-lineage / co-plane / belt.
- [ ] Reflexion ground-track propagation — satellite.js SGP4 to detect over-fly patterns vs current RAAN-based co-plane.
- [ ] Operator-country fix — FENGYUN 3A tagged Other/Unknown despite being CMA/China. Add ChatGPT-based operator-resolver cortex.

## Priority 6 — Thalamus content quality (post-SSE)

Discovered cycle 264 diagnostic. Three root causes: dedup tax (~40%), web-search fallback without payoff, budget exhausted mid-cycle.

- [ ] **(a)** Pimp summariser prompt — `apps/console-api/src/prompts/repl-chat.prompt.ts` `summariserPrompt()` to privilege `findingType=strategy` + `urgency=high` + cite satellite names. ~30 min. Biggest visible win in REPL.
- [ ] **(c)** Bump `maxCost` for user-triggered cycles to $0.25 (vs $0.10 daemon default). Config in `packages/thalamus/src/cortices/config.ts` → `THALAMUS_CONFIG` / `ITERATION_BUDGETS`. ~2 min.
- [ ] **(b)** Planner cortex filter by intent — strip `data_auditor` / `classification_auditor` from cortex pool when query is not an audit request. Touches `thalamus-planner.service.ts`. ~1 h.

### Underlying (Priority 7, future)

- [ ] Enrich the seed so `data_auditor` stops dominating. Join more CelesTrak SATCAT fields (`operator`, `mass`, `country`, `platform_class`) into `seed/populate-space-catalog.ts`.

### Repo hygiene — conditional

- [ ] **If sharing repo externally**: purge git history of earlier framing refs via `git filter-repo` + force-push all 7 branches. Only needed before making repo public or inviting external collaborators. HEAD is already clean; private-repo browsing by owner alone doesn't require this.
