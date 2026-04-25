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

## Doc-Demoted Fish / Sim Features

These were removed or softened in the architecture docs because the current
code does not fully implement them yet. They are real implementation candidates,
not documentation promises.

- [ ] **SIM-F1 - enforce `perFishTimeoutMs` for swarm fish.** `sim_swarm.config`
      stores `perFishTimeoutMs`, but `swarm-fish.worker.ts` currently drains the
      inline turn loop without a wall-clock timeout. Wrap the fish run with
      cancellation/timeout semantics, propagate `AbortSignal` into turn runners
      and nano calls, mark timed-out runs as `timeout`, and still call
      `onFishComplete()` so quorum/aggregation progresses.
- [ ] **SIM-F2 - make swarm launch LLM config executable, not just metadata.**
      `llmMode` and `nanoModel` are persisted on `sim_swarm` / `sim_run`, but
      turn execution currently uses global `sim.fish` runtime config plus the
      global Thalamus transport mode. Thread run/swarm config into
      `callTurnAgent()` / `callNanoWithMode()` so fixture, record, cloud, model,
      reasoning effort, output-token, and temperature choices are reproducible
      per swarm.
- [ ] **SIM-F3 - apply `fishConcurrency` as a real launch constraint.**
      `swarm-fish.worker.ts` uses process-level worker concurrency
      (`deps.concurrency ?? 8`), while launch config stores `fishConcurrency`.
      Decide whether this should create per-swarm queue groups, a semaphore, or
      remain process-level only; if kept, expose it as runtime worker config and
      remove the per-launch field.
- [ ] **SIM-F4 - pass rich selector hints for specialized fish skills.**
      `SimCortexSelector` can choose telemetry/PC-specific skills, but the turn
      runner only passes `hasScenarioContext` unless callers provide stronger
      hints. Thread sim kind, seed target hints, telemetry target, PC target, and
      subject context into `pickCortexName()` so telemetry and PC swarms do not
      silently fall back to `sim_operator_agent` when a specialized skill exists.
- [ ] **SIM-F5 - define baseline/control fish policy.** Some generators include
      `{ kind: "noop" }`, but `launchSwarm()` does not inject a control fish.
      Decide whether every counterfactual swarm must have fish 0 as a baseline,
      or whether baseline is caller-owned. Then enforce it in launch validation,
      perturbation generation, aggregation labels, and eval reporting.
- [ ] **SIM-F6 - add runnable sim smoke commands only after the runtime contract
      is real.** The docs no longer promise `/admin/sim` or `make sim-uc`.
      Reintroduce a CLI/Make smoke path only when it can launch UC telemetry,
      PC, and conjunction swarms against fixture data and assert terminal
      aggregation without live cloud spend.
- [ ] **SIM-F7 - build a 3D operator Fish UI.** Add a dedicated Three.js/R3F UI
      for launching, watching, and interrogating a fish swarm. The primary view
      should be a full-bleed 3D murmuration: each fish is an instanced/pickable
      particle or lightweight mesh; motion/position/color encode status,
      divergence, cluster, confidence, and terminal action. The operator can
      orbit/fly the camera, scrub time, filter by cluster/status, click a fish
      to inspect its seed, perturbation, persona, timeline, memory snippets,
      provider/model metadata, and terminal rationale, then ask follow-up
      questions to one fish, a selected cluster, or the whole swarm. Persist
      question/answer as review evidence without contaminating fish memory unless
      explicitly promoted. Required backend surfaces: swarm list/status stream,
      fish turn timeline, terminal clusters, per-fish trace export, and a
      read-only Q&A endpoint for post-run interrogation. Required frontend
      checks: desktop/mobile screenshots, nonblank canvas pixel check, picking
      test, camera control test, and stable performance for at least 200 fish.

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

- [ ] **SPEC-GATE - no spec is validated without unit + integration + e2e
      proof.** A spec may move to `APPROVED` / `IMPLEMENTED` only when every
      acceptance criterion has all three traceability rows:
      `unit`, `integration`, and `e2e`. The referenced test files and test
      names must exist, and the matching `pnpm test:unit`,
      `pnpm test:integration`, and `pnpm test:e2e` runs must be green. If any
      layer is missing or red, the spec remains `DRAFT` / `REVIEW`; it is not
      validated.
- [ ] Upgrade `scripts/spec-check.ts` so enforced specs require the three
      evidence layers per AC instead of a single generic test row. The checker
      must fail when a trace row is missing `unit`, `integration`, or `e2e`,
      when a referenced test is absent, or when the test name is not present.
- [ ] Add a spec validation CI path that runs, in order:
      `pnpm spec:check`, `pnpm test:unit`, `pnpm test:integration`, and
      `pnpm test:e2e`. This path is the only way to mark a spec validated.
- [ ] Move specs from DRAFT -> REVIEW -> APPROVED only after the tri-layer
      validation above passes for that spec.
- [ ] Spec validation backlog - add unit + integration + e2e traceability for
      every current contract spec before approving it:
      - `SPEC-SH-001` `docs/specs/shared/try-async.tex`
      - `SPEC-SH-002` `docs/specs/shared/app-error.tex`
      - `SPEC-SH-003` `docs/specs/shared/completeness-scorer.tex`
      - `SPEC-SH-004` `docs/specs/shared/domain-normalizer.tex`
      - `SPEC-SH-005` `docs/specs/shared/observability.tex`
      - `SPEC-DB-001` `docs/specs/db-schema/schema-contract.tex`
      - `SPEC-DB-002` `docs/specs/db-schema/typed-repos.tex`
      - `SPEC-TH-001` `docs/specs/thalamus/orchestrator.tex`
      - `SPEC-TH-002` `docs/specs/thalamus/cortex-registry.tex`
      - `SPEC-TH-003` `docs/specs/thalamus/cortex-pattern.tex`
      - `SPEC-TH-010` `docs/specs/thalamus/nano-swarm.tex`
      - `SPEC-TH-011` `docs/specs/thalamus/source-fetchers.tex`
      - `SPEC-TH-012` `docs/specs/thalamus/curator.tex`
      - `SPEC-TH-020` `docs/specs/thalamus/guardrails.tex`
      - `SPEC-TH-030` `docs/specs/thalamus/knowledge-graph-write.tex`
      - `SPEC-TH-031` `docs/specs/thalamus/skills-as-files.tex`
      - `SPEC-TH-040` `docs/specs/thalamus/dual-stream-confidence.tex`
      - `SPEC-TH-041` `docs/specs/thalamus/field-correlation.tex`
      - `SPEC-SW-001` `docs/specs/sweep/nano-sweep.tex`
      - `SPEC-SW-002` `docs/specs/sweep/finding-routing.tex`
      - `SPEC-SW-003` `docs/specs/sweep/resolution.tex`
      - `SPEC-SW-006` `docs/specs/sweep/multi-agent-sim.tex`
      - `SPEC-SW-010` `docs/specs/sweep/feedback-loop.tex`
      - `SPEC-SW-011` `docs/specs/sweep/editorial-copilot.tex`
      - `SPEC-SW-012` `docs/specs/sweep/chat-rate-limit.tex`
- [ ] Overview docs are not validated specs until converted to AC-bearing
      specs with the same unit + integration + e2e traceability:
      `SPEC-ARCH-01` through `SPEC-ARCH-14`. Until then, keep them as
      `OVERVIEW` and do not count them as passed specs.
- [ ] Must-have architecture spec backlog - convert the reader-facing
      architecture PDFs advertised in `README.md` into AC-bearing contract specs:
      - `SPEC-ARCH-01` `docs/specs/architecture/01-ontology.tex` - vocabulary,
        artifact ownership, and hard boundaries between Thalamus, Sweep, fish,
        findings, suggestions, and promotions.
      - `SPEC-ARCH-02` `docs/specs/architecture/02-design-stance.tex` -
        design principles, LLM-as-kernel constraints, and acceptable analogy
        boundaries.
      - `SPEC-ARCH-03` `docs/specs/architecture/03-layout.tex` - workspace
        layout, app/package ownership, and five-layer backend convention.
      - `SPEC-ARCH-04` `docs/specs/architecture/04-thalamus.tex` - orchestration
        sequence, cortex anatomy, explorer/nano swarm, KG write cycle, and
        reflexion loop.
      - `SPEC-ARCH-05` `docs/specs/architecture/05-sweep.tex` - suggestion
        lifecycle, resolution state machine, locks, handlers, adapters, and
        audit trail.
      - `SPEC-ARCH-06` `docs/specs/architecture/06-ssa-primary-build.tex` -
        SSA dual-stream fusion, confidence propagation, cortices, and entity
        model.
      - `SPEC-ARCH-07` `docs/specs/architecture/07-transpositions.tex` -
        domain-pack transposition rules for threat intel, pharmacovigilance,
        IUU maritime, and regulatory review.
      - `SPEC-ARCH-08` `docs/specs/architecture/08-three-swarms.tex` -
        retrieval, audit, and counterfactual swarm contracts, including fish
        isolation and aggregation semantics.
      - `SPEC-ARCH-09` `docs/specs/architecture/09-shared-foundation.tex` -
        shared utilities, db-schema contracts, and package-level five-layer
        responsibilities.
      - `SPEC-ARCH-10` `docs/specs/architecture/10-design-choices.tex` -
        architectural decision records with invariants and regression tests.
      - `SPEC-ARCH-11` `docs/specs/architecture/11-running-locally.tex` -
        local run modes, fixture/cloud behavior, required services, and command
        contracts.
      - `SPEC-ARCH-12` `docs/specs/architecture/12-consoles.tex` - CLI REPL,
        operator console, API contracts, and expected UI/backend coupling.
      - `SPEC-ARCH-13` `docs/specs/architecture/13-references.tex` - reference
        bibliography, claim provenance, and citation hygiene.
      - `SPEC-ARCH-14` `docs/specs/architecture/14-package-onboarding.tex` -
        package onboarding, dependency graph, import boundaries, and allowed
        extension points.
- [ ] Exclude `docs/specs/architecture/preamble-arch.tex` from
      `scripts/spec-check.ts`; it is a LaTeX preamble, not a spec contract.
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
