# TODO

Portfolio-readiness checklist for Thalamus + Sweep.

**Trimmed 2026-04-25** - verified-done and stale entries moved to
[DONE.md](DONE.md#migrated-from-todo--2026-04-25-trim). This file now tracks
confirmed open work only. `tasks/todo.md` is historical: all 59 items are done.

Current fast checks from the trim pass:

- `pnpm test:policy` - green, 294 files scanned, 0 grandfather casts.
- `pnpm spec:check` - green, but 40 specs are still DRAFT/REVIEW and 0 are
  enforced.

---

## Immediate Architecture Debt

- [ ] **C1 - collapse writes to `research_*` tables behind one writer.**
      Current writers still include:
      - kernel repositories in `packages/thalamus/src/repositories/research-*.repository.ts`
      - app-side write paths in
        `apps/console-api/src/repositories/finding.repository.ts` and
        `apps/console-api/src/repositories/research-edge.repository.ts`
      - sim-promotion store adapter in `apps/console-api/src/container.ts`
        (`createCycle`, `createFinding`, `linkCycleFinding`, `createEdge`,
        `updateCycleFindingsCount`)
      Fix by routing app/sim writes through kernel repos or through a single
      HTTP/write-port surface.
- [ ] **C2 - split `apps/console-api/src/services/sim-promotion.service.ts`.**
      The service is still large (~526 LOC) and still knows the `research*`
      table insert shapes through `SimPromotionStorePort`, though it no longer
      takes a raw DB handle directly. Split into outcome promotion, modal
      suggestion composition, telemetry scalar promotion, and shared write
      ports.
- [ ] **C4 - finish thalamus kernel de-domainization.** The old file-move work
      is closed, but SSA-flavored defaults/comments remain in the kernel
      (`thalamus-planner.service.ts`, `thalamus.service.ts`, `guardrails.ts`,
      `cortices/config.ts`, prompt comments). Make defaults generic and inject
      domain language from the app pack.
- [ ] **I5 - sweep -> thalamus coupling.** `packages/sweep` still imports
      `CortexRegistry`, `ConfidenceService`, and `callNanoWithMode` from
      `@interview/thalamus`. Either merge the packages or extract a third
      agnostic `cortex-kernel` package.
- [ ] **I6 - extract duplicate app service ports.** Move duplicate
      `CyclesPort` / `FindingsWritePort` / `EdgesWritePort` from
      `enrichment-finding.service.ts` and `reflexion.service.ts` into
      `apps/console-api/src/services/ports/`. Reconcile the divergent
      `SatellitesReadPort` shapes in `satellite-view.service.ts` and
      `sweep-task-planner.service.ts`.
- [ ] **M1 - stats repository reads kernel-owned tables directly.**
      `apps/console-api/src/repositories/stats.repository.ts` still counts
      `research_cycle`, `research_finding`, and `research_edge` directly.
      Revisit after C1.
- [ ] **M2 - finish thalamus ports cleanup.** `packages/thalamus/src/ports/`
      exists, but `CortexDataProvider`, `DomainConfig`, and
      `CortexExecutionStrategy` still live under `cortices/*`.
- [ ] **M3 - split `packages/thalamus/src/services/research-graph.service.ts`.**
      It is still ~566 LOC and owns finding CRUD, semantic search, KG assembly,
      entity queries, archive/expiry, and callbacks.
- [ ] **M4 - promote the inline sim launcher closure.**
      Move the inline closure in `apps/console-api/src/container.ts` into a
      `SimLauncherService` with an explicit port.
- [ ] **M8 - bound Redis pagination in `packages/sweep/src/repositories/sweep.repository.ts`.**
      `zrevrange(IDX_ALL, 0, -1)` is still used for full-list reads.

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
- [ ] Bundle split - `build.rollupOptions.output.manualChunks` per mode
      (3D libs for ops only, sigma/graphology for thalamus only) plus lazy
      TanStack Router file routes per mode.
- [ ] SGP4 cache LRU - `apps/console/src/adapters/propagator/sgp4.ts`
      still keeps `satrecByLine1` in an unbounded `Map`; add a small LRU
      (10,000 entries is ample).
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

- [ ] Move specs from DRAFT -> REVIEW -> APPROVED as contracts are validated.
- [ ] Add `spec-build` CI job - run `make all` in `docs/specs/` and publish
      PDFs as artifacts.
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
- [ ] Strategic sweep tests:
      - `nano-sweep.service` emits the finding shape expected by finding routing
      - `resolution.service` applies accepted suggestions in a transaction and
        writes an audit row
      - reject feedback appears in the next-run prompt
      - rate-limit + dedupe in the chat repository
- [ ] Unit tests for `applySatelliteFieldUpdate` + `applyKnnFill` (DB UPDATE +
      audit row write).
- [ ] Fixture-mode fabrication-rejection test - go beyond the current detector
      unit and prove a recorded nano response containing `typically...` is
      blocked in fixture mode.

---

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

## Docs, CLI, And Observability

- [ ] `docs/architecture.md` - cortex pattern deep-dive with diagrams.
- [ ] `docs/sweep-feedback-loop.md` - how reviewer rationale is persisted and
      reused by later audit prompts.
- [ ] `docs/threat-intel-mapping.md` - detailed walkthrough of the
      transposition.
- [ ] Per-package `README.md` for thalamus and sweep.
- [ ] `buildRealAdapters` in `packages/cli/src/boot.ts` - wire
      thalamus/telemetry/graph/resolution/why to real services.
- [ ] `analyst_briefing` end-to-end in `runCycle` output.
- [ ] Aggregator / swarm-service / promotion `stepLog` emission.
- [ ] HTTP `/metrics` endpoint on port 8080 serving `registry.metrics()`
      (`prom-client` text format).
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

Manual SQL migrations 0012 and 0013 are raw SQL functions and are not
drizzle-generated. Apply with:

```sh
psql "$DATABASE_URL" -f packages/db-schema/migrations/0012_orbital_analytics_fns.sql
psql "$DATABASE_URL" -f packages/db-schema/migrations/0013_conjunction_knn_fn.sql
```
