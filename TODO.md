# TODO

Portfolio-readiness checklist for Thalamus + Sweep.

**Trimmed 2026-04-28** - completed sprint work moved to [DONE.md](DONE.md).
This file tracks confirmed open work only. `tasks/todo.md` is historical: all
59 items are done.

Current state after the Sprint 5 close and the first Temporal Hypothesis Layer
slice:

- Sprints 0, 1, and 2 are archived in
  [DONE.md](DONE.md#sprint-closures--2026-04-25); Sprint 5 is archived in
  [DONE.md](DONE.md#sprint-closures--2026-04-28).
- Sprint 3 implementation landed; only real Playwright/WebGL exit checks remain.
- Sprint 4 has `EVAL-1` and `EVAL-9` closed; `EVAL-2` through `EVAL-8` and
  `EVAL-10` remain open.
- Temporal Hypothesis Layer foundation is in `main`: spec, pure scorer,
  temporal schema, closed-window shadow run route, read-only cortex query,
  review route, FollowUp seeding, and seeded Fish run persistence are archived in
  [DONE.md](DONE.md#temporal-hypothesis-layer-implementation-slice).
- `/metrics` already exists on the API port (`server.ts:347-350`); the open
  work is named product instrumentation, not the endpoint itself.
- Research stats views are wired through the repo migration runner and were
  applied locally via `pnpm tsx scripts/test-db-migrate.ts`.

Current fast checks from the trim pass:

- Latest pre-commit on `e618afc` passed `pnpm test:policy`, typecheck,
  `pnpm spec:check`, and `pnpm test` (1802 tests passed, 10 skipped).
- DB migration runner passed against local Postgres; the research stats views
  are present and queryable.
- `pnpm sim:smoke` remains the fixture-backed sim smoke command for telemetry,
  PC, and UC3 swarms.

---

## Sprint Roadmap

This is the current portfolio roadmap. Closed sprint sections are summaries;
open work is tracked in the detailed backlog below. `TO-REVIEW.md` is treated
as review intake: actionable items are mapped into this sprint roadmap, while
stale/resolved review notes stay there as archive.

### Sprint 0 - Done - Spec Gate Implementation

Closed 2026-04-25. Closure details live in
[DONE.md](DONE.md#sprint-closures--2026-04-25). Remaining spec hardening work
is tracked under "Spec, Test, And CI Gaps".

### Sprint 1 - Done - Fish Runtime Truth

Closed 2026-04-25. Closure details live in
[DONE.md](DONE.md#sprint-closures--2026-04-25). Fixture sim smoke remains
available through `pnpm sim:smoke` / `make sim-smoke`.

### Sprint 2 - Done - Fish Operator API

Closed 2026-04-25. Closure details live in
[DONE.md](DONE.md#sprint-2---fish-operator-api).

### Sprint 3 - 3D Fish Operator UI

Goal: build the operator-facing 3D murmuration view for watching and questioning
Fish swarms.

Status: implementation landed and archived in
[DONE.md](DONE.md#sprint-closures--2026-04-28). The only remaining work is real
browser/WebGL verification; Vitest DOM smoke already covers 200/300-fish render,
instance-id picking, and sampling.

Exit checks:

- Desktop and mobile Playwright screenshots. Open: Playwright not installed
  in `apps/console/package.json`.
- Nonblank canvas pixel check. Open: requires real WebGL.
- Picking test. Open at WebGL level (covered by Vitest DOM smoke only).
- Camera control test. Open.
- Stable performance with at least 200 fish. Open at WebGL level (Vitest DOM
  smoke renders 200/300 fish but cannot measure FPS).

### Sprint 4 - Evaluation Protocol

Goal: prove the architecture with paired, reproducible evals instead of anecdotal
demos.

Scope:

- `EVAL-2` through `EVAL-8`, plus `EVAL-10`.
- Paired runner, frozen baselines, nondeterminism statistics.
- SSA + HRM metrics, provider telemetry, budget tiers, reports.

Exit checks:

- `$25` smoke run produces JSONL plus aggregate report.
- Report includes commit SHA, manifest hash, model config, costs, scores, and
  residual risks.

### Sprint 5 - Done - Core Architecture Debt

Closed 2026-04-28. Closure details live in
[DONE.md](DONE.md#sprint-closures--2026-04-28), and the frozen execution plan is
kept in [tasks/sprint5-architecture-debt-plan.md](tasks/sprint5-architecture-debt-plan.md).

### Sprint 6 - Runtime Hardening And Coverage

Goal: close the remaining correctness and regression gaps.

Scope:

- Safe entity IDs.
- Sweep feedback reproducibility payload.
- `NanoSweepService` nullable/optional metrics.
- Kimi limiter/queue policy.
- Guardrail docs/tests.
- Coverage policy, Vitest alias drift, CI coverage artifacts.
- e2e smoke coverage, db-schema fresh-PG smoke, migration round-trip, strategic
  sweep tests.

Exit checks:

- `pnpm test:policy`
- `pnpm test`
- `pnpm -r build`
- Required CI path publishes coverage and spec artifacts.

### Sprint 7 - Product, Docs, And Domain Polish

Goal: finish the portfolio-grade edges once contracts, Fish runtime, and evals
are grounded.

Scope:

- Per-query cortex filter UI and API plumbing.
- TO-REVIEW frontend polish: decide whether the shared drawer should become
  route-driven, add a shared `FindingCard` only if a third consumer appears, and
  keep feature shells separate until then.
- TO-REVIEW CLI cleanup: finish `telemetry.start` over HTTP, shrink
  `packages/cli/src/boot.ts`, remove unnecessary heavy CLI infra deps, and add a
  CLI arch-guard.
- Planner-bias follow-ups and seed enrichment.
- Env key documentation.
- SGP4 cache LRU.
- PG read-view/function follow-ups.
- Skill prompt cleanup and SSE browser sanity check.
- Broaden targeted Sweep auto-runs beyond the narrow `operator_country` path.
- MissionService generation counter and user-triggered Thalamus budget decision.
- Docs/CLI/observability tasks and domain follow-ups.

Exit checks:

- Updated docs link to the implemented flows.
- One clean browser/operator walkthrough exercises REPL, Sweep suggestions,
  reflexion, and Fish UI without known stream/API mismatch.

### Sprint 8 - Temporal Hypothesis Layer Productization

Goal: turn the THL foundation into a reviewed predictive evidence loop without
contaminating KG facts or production scores.

Status: foundation landed and archived in
[DONE.md](DONE.md#temporal-hypothesis-layer-implementation-slice). The open
work is now review, evaluation, UI, and richer projection coverage.

Scope:

- Sweep automated review workflow for temporal patterns.
- Production-grade canonical projection/backfill beyond the initial shadow
  fixtures.
- Temporal evaluation harness with frequency, HNSW-only, THL-only, HNSW+THL,
  THL+Sweep, and THL+Fish baselines.
- Temporal Pattern Explorer for sequence, score, evidence, counterexamples,
  domain breakdown, and seeded-run links.
- Query logging and usage reports that stay isolated from learning.

Exit checks:

- Accepted patterns require positive examples, counterexamples or negative
  evidence, and review history.
- Fish runs launched from THL always carry `seeded_by_pattern_id` and never
  enter the production score.
- A strict temporal split report shows precision@k, lift, lead time, false
  positives, and pattern acceptance rate.

---

## TO-REVIEW Intake Map

`TO-REVIEW.md` is ignored by Git, so the active mapping is tracked here. Use this
section when draining old review notes into the sprint roadmap.

- Bundle size warning -> Sprint 7 remaining bundle split and lazy route
  follow-ups. The Fish `/fish` route and 3D manual chunks are already done.
- Zustand drawer concern -> Sprint 7 and "Shared drawer routing review".
- SGP4 cache -> Sprint 7 and "SGP4 cache LRU".
- FindingReadout / FindingsPanel duplication -> Sprint 7 and "Finding card
  extraction trigger".
- REPL follow-up gaps -> Sprint 7, "Live browser SSE sanity check", and
  "Broaden targeted sweep auto-runs beyond `operator_country`".
- Plan 5 / Plan 6 sim-kernel notes -> resolved by Sprint 5 plus Sprint 1 Fish
  runtime work.
- CLI Plan 3 leftovers -> Sprint 7 and "CLI Plan 3 cleanup".
- Remaining strategic sweep gaps -> Sprint 6 and the strategic test backlog.
- Fish quick-wins -> `SIM-F8`.

---

## Detailed Backlog

---

## Temporal Hypothesis Layer Follow-Ups

- [ ] Sweep automated temporal auditor - wire Sweep policy to the existing
      `POST /api/temporal/patterns/:id/review` path so automated audits can
      accept, reject, deprecate, or request more evidence without bypassing the
      THL review service.
- [ ] Production projection/backfill - expand canonical projection beyond the
      initial `sim_review_evidence` + terminal `sim_run` shadow slice. Keep
      event types whitelisted, quarantine invalid/future timestamps, preserve
      source provenance, and document retention.
- [ ] Temporal evaluation harness - compare frequency, manual rules, HNSW-only,
      THL-only, HNSW+THL, THL+Sweep, and THL+Fish on a strict train/validation/
      test temporal split. Report precision@k, recall@k, lift, lead time, false
      positives, pattern churn, and acceptance rate.
- [ ] Temporal Pattern Explorer - build an audit UI for sequence steps, score
      components, positive examples, counterexamples, source-domain breakdown,
      reviews, and `temporal_pattern_seeded_run` links.
- [ ] Query logging and usage isolation - wire `temporal_pattern_query_log` for
      read-only consultations and seed usage reports. Query logs must never
      influence learning or pattern scores.
- [ ] HNSW coherence enrichment - add optional semantic-neighbor context for
      audit and evaluation only. Keep temporal score and semantic similarity in
      separate fields.

---

## Runtime And Product Follow-Ups

- [ ] Per-query cortex filter UI - REPL-level checkbox panel
      (include/exclude per turn) plus `POST /api/repl/turn` body support for
      `{ cortexFilter?: { include?: string[]; exclude?: string[] } }`.
      Runtime config already supports `forcedCortices` / `disabledCortices`;
      per-query plumbing is missing.
- [ ] Tier 2 planner-bias fix - bucketed catalog + few-shots in the planner
      prompt if the current description rewrite proves insufficient after live
      testing.
- [ ] Env keys - document `MINIMAX_API_KEY`, `MINIMAX_API_URL`,
      `MINIMAX_MODEL`, `LOCAL_LLM_URL`, and `LOCAL_LLM_MODEL` in
      `.env.example`.
- [ ] Bundle split follow-up - Fish `/fish` lazy loading and 3D manual chunks
      are done. Finish any remaining per-mode manual chunks and lazy TanStack
      Router file routes outside the Fish operator surface.
- [ ] Fish operator WebGL exit checks - add Playwright coverage for desktop and
      mobile screenshots, nonblank canvas pixel, real instance picking, orbit
      camera control, and a 200-fish performance sanity check.
- [ ] Shared drawer routing review - `shared/ui/uiStore.ts` currently owns a
      cross-feature `drawerId` used by Ops, Thalamus, and Sweep. Decide whether
      drawer state should become route-driven for back/forward/deep-link support,
      or split into per-feature drawers behind a route-level state machine.
- [ ] SGP4 cache LRU - `apps/console/src/adapters/propagator/sgp4.ts`
      still keeps `satrecByLine1` in an unbounded `Map`; add a small LRU
      (10,000 entries is ample).
- [ ] Finding card extraction trigger - `FindingReadout` and `FindingsPanel`
      still duplicate outer card chrome around severity, evidence, and decision
      footer. Keep feature-specific shells for now; extract a presentational
      `shared/ui/finding/FindingCard` only when a third consumer appears.
- [ ] PG Step 5 - extract read-only views for `satellite-audit`
      (`auditDataCompleteness`, `auditClassification`) from
      `apps/console-api/src/repositories/satellite-audit.repository.ts`.
- [ ] PG Step 6 - `user-fleet.repository.ts` -> two jsonb-returning SQL
      functions (`fn_user_mission_portfolio`, `fn_user_fleet_windows`).
      Blocked on missing `safe_mission_window` UDF, now referenced by
      `satellite-view.repository.ts` and `user-fleet.repository.ts`.
- [ ] Skill prompt cleanup - `debris-forecaster.md` and
      `orbit-slot-optimizer.md` still mention `horizonYears`. Zod strips the
      unknowns, so this is prompt/spec cleanup rather than a runtime crash.
- [ ] Live browser SSE sanity check - record one end-to-end REPL run where the
      parent summary is emitted first, child follow-up events follow, and the UI
      stream contract has no mismatch.
- [ ] Broaden targeted sweep auto-runs beyond `operator_country`. The REPL
      follow-up stack can launch current narrow targeted audits, and THL already
      seeds accepted temporal hypotheses into Fish follow-ups. Add more target
      policies only when each has deterministic fixture coverage and reviewer
      outcome traces.
- [ ] Keep the kernel generic as follow-up logic expands. Extend generic
      contracts only; keep SSA policy/execution in the app pack unless a second
      pack needs the same semantics.
- [ ] `MissionService` start/stop race - add a generation counter to prevent
      concurrent ticks from rapid start/stop cycles.
- [ ] User-triggered Thalamus budget - decide whether to bump user-cycle
      `maxCost` to `$0.25`. Defaults still cap deep budgets at `0.1`; runtime
      config can override, but the default policy has not changed.
- [ ] Planner cortex filter by intent - strip `data_auditor` /
      `classification_auditor` from the planner cortex pool when the query is
      not an audit request.
- [ ] Enrich the seed so `data_auditor` stops dominating. Join more CelesTrak
      SATCAT fields (`operator`, `mass`, `country`, `platform_class`) into
      `packages/db-schema/src/seed/populate-space-catalog.ts`.

---

## Doc-Demoted Fish / Sim Features

These were removed or softened in the architecture docs because the current
code does not fully implement them yet. They are real implementation candidates,
not documentation promises. `SIM-F3` through `SIM-F7` are closed and moved to
DONE; only open candidates remain below.

- [ ] **SIM-F8 - convert Fish quick-wins into scoped product specs.** The
      `TO-REVIEW.md` quick-win list is valuable but too broad to implement as
      one lump. Split into specs for: maneuver cost estimator with Pareto front,
      why/provenance button from `research_edge`, anomaly triage micro-swarms,
      operator posture inference, "dig into" follow-up micro-swarm, debris decay
      forecaster, and what-if SSO deployment scenario.

---

## Runtime Hardening Still Open

- [ ] Safe entity IDs - `packages/thalamus/src/cortices/strategies/helpers.ts`
      still normalizes finding edge IDs with `Number(e.entityId) || 0`.
      Preserve large DB IDs as validated decimal strings or `bigint` to avoid
      precision loss.
- [ ] Sweep feedback payload - `SuggestionFeedbackRow` still stores only
      `wasAccepted`, `reviewerNote`, and `domainFields`. Add reproducibility
      context: suggestion id, domain, resolution payload/status, created/reviewed
      timestamps, source run, model/provider when available.
- [ ] `NanoSweepService` metrics - `totalCalls`, `successCalls`, and
      `estimatedCost` are still zero-filled when provider metrics are unknown.
      Use nullable/optional fields so dashboards do not read "unknown" as zero.
- [ ] Kimi rate limiter - `KimiProvider` still uses a static 2s global spacing.
      Replace with a provider/API-key scoped limiter or queue if concurrency
      becomes material.
- [ ] Guardrail docs - the sanitizer is regex/heuristic based. Comments/tests
      should describe it as heuristic sanitization, not comprehensive prompt
      injection protection.
- [ ] Coverage policy - `vitest.config.ts` still has per-file 100% thresholds.
      Replace with tiered coverage or changed-files coverage while preserving
      strong kernel coverage.
- [ ] Vitest alias drift - aliases are still duplicated manually instead of
      deriving from `tsconfig.base.json`.

---

## Spec, Test, And CI Gaps

- [ ] Keep specs in DRAFT / REVIEW until their unit + integration + e2e
      traceability rows pass under `pnpm spec:check` and the matching test
      suites are green.
- [ ] Spec validation backlog - add unit + integration + e2e traceability for
      every current contract spec before approving it: - `SPEC-SH-001` `docs/specs/shared/try-async.tex` - `SPEC-SH-002` `docs/specs/shared/app-error.tex` - `SPEC-SH-003` `docs/specs/shared/completeness-scorer.tex` - `SPEC-SH-004` `docs/specs/shared/domain-normalizer.tex` - `SPEC-SH-005` `docs/specs/shared/observability.tex` - `SPEC-DB-001` `docs/specs/db-schema/schema-contract.tex` - `SPEC-DB-002` `docs/specs/db-schema/typed-repos.tex` - `SPEC-TH-001` `docs/specs/thalamus/orchestrator.tex` - `SPEC-TH-002` `docs/specs/thalamus/cortex-registry.tex` - `SPEC-TH-003` `docs/specs/thalamus/cortex-pattern.tex` - `SPEC-TH-010` `docs/specs/thalamus/nano-swarm.tex` - `SPEC-TH-011` `docs/specs/thalamus/source-fetchers.tex` - `SPEC-TH-012` `docs/specs/thalamus/curator.tex` - `SPEC-TH-020` `docs/specs/thalamus/guardrails.tex` - `SPEC-TH-030` `docs/specs/thalamus/knowledge-graph-write.tex` - `SPEC-TH-031` `docs/specs/thalamus/skills-as-files.tex` - `SPEC-TH-040` `docs/specs/thalamus/dual-stream-confidence.tex` - `SPEC-TH-041` `docs/specs/thalamus/field-correlation.tex` - `SPEC-SW-001` `docs/specs/sweep/nano-sweep.tex` - `SPEC-SW-002` `docs/specs/sweep/finding-routing.tex` - `SPEC-SW-003` `docs/specs/sweep/resolution.tex` - `SPEC-SW-006` `docs/specs/sweep/multi-agent-sim.tex` - `SPEC-SW-010` `docs/specs/sweep/feedback-loop.tex` - `SPEC-SW-011` `docs/specs/sweep/editorial-copilot.tex` - `SPEC-SW-012` `docs/specs/sweep/chat-rate-limit.tex`
- [ ] Overview docs are not validated specs until converted to AC-bearing
      specs with the same unit + integration + e2e traceability:
      `SPEC-ARCH-01` through `SPEC-ARCH-14`. Until then, keep them as
      `OVERVIEW` and do not count them as passed specs.
- [ ] Must-have architecture spec backlog - convert the reader-facing
      architecture PDFs advertised in `README.md` into AC-bearing contract specs: - `SPEC-ARCH-01` `docs/specs/architecture/01-ontology.tex` - vocabulary,
      artifact ownership, and hard boundaries between Thalamus, Sweep, fish,
      findings, suggestions, and promotions. - `SPEC-ARCH-02` `docs/specs/architecture/02-design-stance.tex` -
      design principles, LLM-as-kernel constraints, and acceptable analogy
      boundaries. - `SPEC-ARCH-03` `docs/specs/architecture/03-layout.tex` - workspace
      layout, app/package ownership, and five-layer backend convention. - `SPEC-ARCH-04` `docs/specs/architecture/04-thalamus.tex` - orchestration
      sequence, cortex anatomy, explorer/nano swarm, KG write cycle, and
      reflexion loop. - `SPEC-ARCH-05` `docs/specs/architecture/05-sweep.tex` - suggestion
      lifecycle, resolution state machine, locks, handlers, adapters, and
      audit trail. - `SPEC-ARCH-06` `docs/specs/architecture/06-ssa-primary-build.tex` -
      SSA dual-stream fusion, confidence propagation, cortices, and entity
      model. - `SPEC-ARCH-07` `docs/specs/architecture/07-transpositions.tex` -
      domain-pack transposition rules for threat intel, pharmacovigilance,
      IUU maritime, and regulatory review. - `SPEC-ARCH-08` `docs/specs/architecture/08-three-swarms.tex` -
      retrieval, audit, and counterfactual swarm contracts, including fish
      isolation and aggregation semantics. - `SPEC-ARCH-09` `docs/specs/architecture/09-shared-foundation.tex` -
      shared utilities, db-schema contracts, and package-level five-layer
      responsibilities. - `SPEC-ARCH-10` `docs/specs/architecture/10-design-choices.tex` -
      architectural decision records with invariants and regression tests. - `SPEC-ARCH-11` `docs/specs/architecture/11-running-locally.tex` -
      local run modes, fixture/cloud behavior, required services, and command
      contracts. - `SPEC-ARCH-12` `docs/specs/architecture/12-consoles.tex` - CLI REPL,
      operator console, API contracts, and expected UI/backend coupling. - `SPEC-ARCH-13` `docs/specs/architecture/13-references.tex` - reference
      bibliography, claim provenance, and citation hygiene. - `SPEC-ARCH-14` `docs/specs/architecture/14-package-onboarding.tex` -
      package onboarding, dependency graph, import boundaries, and allowed
      extension points.
- [ ] Sweep spec tests still missing as spec-named coverage:
      `nano-sweep.{batching,parser,callbacks,cost,cap}`,
      `nano-sweep.readonly`, `finding-routing`, `resolution`, `feedback-loop`,
      `editorial-copilot`, and `chat-rate-limit`.
- [ ] Extend GitHub Actions (`test.yml`, `arch-check.yml`, `build-push.yml`) so
      CI also runs workspace typecheck, coverage, and docs/spec build in one
      required path.
- [ ] 100% coverage gate on `shared`; pyramidal 70/25/5 on thalamus + sweep.
- [ ] Coverage artifacts published per PR.
- [ ] `pnpm -r build` passes. Today only `apps/console/package.json` has a
      build script.
- [ ] e2e smoke gap - still missing e2e smoke specs for `/api/satellites`,
      `/api/sweep/suggestions`, `/api/sweep/reflexion-pass`, and `/api/repl/*`.
      Unit/controller coverage exists for several of these; the gap is full
      HTTP/e2e smoke coverage.
- [ ] db-schema fresh-PG typed helper smoke beyond the current static
      `typed-repos.spec.ts`.
- [ ] Schema migration round-trip.
- [ ] Strategic sweep tests still missing beyond the closed labelled resolution
      proof: - `nano-sweep.service` emits the finding shape expected by finding routing - reject feedback appears in the next-run prompt - rate-limit + dedupe in the chat repository
- [ ] Unit tests for `applySatelliteFieldUpdate` + `applyKnnFill` (DB UPDATE +
      audit row write).
- [ ] Fixture-mode fabrication-rejection test - go beyond the current detector
      unit and prove a recorded nano response containing `typically...` is
      blocked in fixture mode.

---

## Production-Grade Evaluation Protocol

- [ ] **EVAL-2 - build the paired eval runner.** Add one runner that executes
      agentic and baseline strategies on the same cases, same data snapshot,
      same seeds, and same budget caps. Output JSONL per call plus one
      aggregate report per run.
- [ ] **EVAL-3 - freeze baselines before tuning.** Baselines are described
      in `docs/evals/evaluation-protocol.md` lines 109-140 (Thalamus
      single-pass, Sweep null-scan, Sim single-fish, HRM direct call) but no
      `baseline.config.json` or strategy registry exists in code. Define
      Thalamus agentic loop vs single-pass/retrieval-only baseline, Sweep nano
      audit vs deterministic null-scan, Sim swarm vs one-fish verdict, and HRM
      agentic solver vs direct model call.
- [ ] **EVAL-4 - use nondeterminism correctly.** Stats are spec'd in
      `docs/evals/evaluation-protocol.md` lines 217-238 and
      `docs/evals/drafts/hrm-statistics-protocol.md` (mean/median delta, win
      rate, bootstrap CI 95% with 5000-10000 resamples, one-sided sign-test).
      No statistical implementation exists in source. Run paired seeds, then
      report mean delta, median delta, win rate, bootstrap confidence
      interval, and one-sided sign-test p-value. Never compare unrelated
      random samples.
- [ ] **EVAL-5 - implement SSA metrics.** Track entity-id exact recall,
      numeric-fidelity error rate, citation/source coverage, hallucinated-ID
      rate, ESA CDM final-risk MAE/RMSE, high-risk AUPRC, maneuver-decision F1,
      and Sim Brier/calibration/cluster coverage.
- [ ] **EVAL-6 - implement HRM metrics.** Track ARC exact accuracy/pass@2,
      Sudoku exact solution and invalid-grid rates, Maze exact/valid path rate,
      shortest-path optimality gap, latency, cost, and failure taxonomy.
- [ ] **EVAL-7 - add cost and provider telemetry.** JSONL fields are spec'd
      in `docs/evals/evaluation-protocol.md` lines 268-289 and
      `docs/evals/drafts/cost-observability-protocol.md`. Production telemetry
      already exists for runtime cycles but is not wired to a per-call
      `calls.jsonl` / `provider-model-usage.json` writer for evals. Log
      provider, model, prompt/output/reasoning token estimates or real usage,
      web-search calls, Voyage embedding calls, retries, timeout, provider
      failure, parsed-output status, cost estimate, latency, and budget stop
      reason for every call.
- [ ] **EVAL-8 - define budget tiers.** Tiers $25 / $50 / $100 / $250+ are
      described in `docs/evals/evaluation-protocol.md` lines 252-261 with
      per-phase case counts at lines 367-391. No tier profile config files
      and no tier flag in any runner. Support a `$25` smoke proof, `$50`
      minimum defensible benchmark, `$100` comfortable internal benchmark,
      and `$250+` paper-grade pass. Each tier must pin case counts, seeds,
      model choices, and max web-search usage.
- [ ] **EVAL-10 - publish eval artifacts.** Protocol docs are committed
      (`docs/evals/README.md`, `evaluation-protocol.md`,
      `real-eval-manifest.json`, drafts) and `data/evals/` is correctly
      ignored. No example report directory or sample run with commit SHA,
      manifest hash, scores, or costs has been committed yet. Commit protocol
      docs and example reports, but keep downloaded datasets under ignored
      `data/evals/`. Each report must include commit SHA, manifest hash,
      runtime config, model versions, score tables, costs, and residual
      risks.

---

## Docs, CLI, And Observability

- [ ] `docs/architecture.md` - cortex pattern deep-dive with diagrams.
- [ ] `docs/sweep-feedback-loop.md` - how reviewer rationale is persisted and
      reused by later audit prompts.
- [ ] `docs/threat-intel-mapping.md` - detailed walkthrough of the
      transposition.
- [ ] Per-package `README.md` for thalamus and sweep.
- [ ] CLI Plan 3 cleanup - `buildRealAdapters` now wires runCycle, graph, why,
      resolution, and candidate reads, but `telemetry.start` is still disabled.
      Finish `POST /api/sim/telemetry/start` wiring, shrink
      `packages/cli/src/boot.ts`, remove unnecessary heavy infra deps from
      `packages/cli/package.json`, and add `packages/cli/tests/arch-guard.spec.ts`.
- [ ] `analyst_briefing` end-to-end in `runCycle` output.
- [ ] HTTP `/metrics` endpoint - already wired at
      `apps/console-api/src/server.ts:347-350` on the API port (4000) using
      `prom-client`. Decide whether to keep it on the API port or expose it
      on a dedicated 8080 listener; today only generic `http_requests_total`
      / `http_request_duration` are scraped.
- [ ] Instrumentation at five points:
      `thalamus_cycles_total{status}`,
      `thalamus_cortex_duration_seconds{cortex}`,
      `thalamus_cycle_cost_usd`,
      `sweep_fish_duration_seconds{kind}`,
      `sweep_suggestions_emitted_total{source_class,severity}`.
- [ ] `docker-compose.yml` - add prometheus + grafana.
- [ ] `infra/grafana/dashboards/ssa.json` - 8 panels.

---

## Domain Follow-Ups

- [ ] Promote `object_class` to a dedicated `space_object` table.
- [ ] `conjunctions-cli.ts` -> `conjunctions-knn-cli.ts`; drive narrow-phase
      SGP4 off `queryConjunctionCandidatesKnn` survivors.
- [ ] Debris decay forecaster cortex - K fish estimate remaining lifetime with
      live NOAA F10.7 + altitude. Top-20 likely decay next 30 days.
- [ ] UI button for `/reflexion-pass <norad>` in the console (currently
      CLI/curl/controller only).
- [ ] CLI `/reflexion <norad>` verb - color-coded by MIL-lineage / co-plane /
      belt.
- [ ] Reflexion ground-track propagation - satellite.js SGP4 over-fly patterns
      instead of current RAAN-based co-plane heuristic.
- [ ] Operator-country fix - FENGYUN 3A tagged Other/Unknown despite being
      CMA/China; add an operator-resolver cortex.

---

## Conditional Hygiene

- [ ] If sharing the repo externally, purge git history of earlier framing refs
      via `git filter-repo` + force-push all branches. HEAD is already clean;
      this is only needed before making the repo public or inviting external
      collaborators.

---

## Operational Reminder

Raw SQL functions/views are wired into the repo migration runner. Apply database
migrations through the Drizzle path:

```sh
DATABASE_URL=postgres://thalamus:thalamus@localhost:5433/thalamus pnpm tsx scripts/test-db-migrate.ts
```

Do not apply individual migration files manually except while debugging one
migration in isolation.
