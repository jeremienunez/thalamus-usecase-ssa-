# TODO

Portfolio-readiness checklist for Thalamus + Sweep.

**Trimmed 2026-04-25** - verified-done and stale entries moved to
[DONE.md](DONE.md#migrated-from-todo--2026-04-25-trim). Sprint 0 and the
closed Sprint 1 runtime items are also tracked in
[DONE.md](DONE.md#sprint-closures--2026-04-25). This file now tracks confirmed
open work only. `tasks/todo.md` is historical: all 59 items are done.

**Re-audited 2026-04-27** by six parallel verification agents. Headline
deltas vs the 2026-04-25 trim:

- Sprint 2 (Operator API) closed; Sprint 3 (3D Fish UI) is in progress with
  the R3F squid scene, HUD, Q&A panel, manual chunks, and lazy `/fish` route
  landed (commits 6665966, 58149f8). Only Playwright/WebGL exit checks remain.
- `EVAL-1` (real eval corpus + lock) and `EVAL-9` (multimodal honesty) are
  done.
- `/metrics` endpoint already exists on the API port (`server.ts:347-350`);
  the open work is the five named instrumentation metrics, not the endpoint
  itself.
- `C2` sim-promotion grew to ~564 LOC; `M3` research-graph grew to ~577 LOC.
  Architecture debt is moving in the wrong direction and should not be
  deferred again.

Roll-up: ~10 closures, ~18 partials, ~58 still open across the backlog.

Current fast checks from the trim pass:

- `pnpm test:policy` - green, 307 files scanned, 0 grandfather casts.
- `pnpm spec:check` - green, but 39 specs are still DRAFT/REVIEW and 0 are
  enforced.
- `pnpm sim:smoke` - green for fixture-backed telemetry, PC, and UC3 swarms.
- Sim LLM config boundary tests are green: sim launch/run config rejects
  provider/model/reasoning/token/temperature knobs; executable fish LLM tuning
  stays in the centralized `sim.fish` / Thalamus config path.

---

## Sprint Roadmap

This is the execution order. The detailed backlog remains below; sprint entries
reference the named items in the backlog. Do not start a downstream UI/eval
sprint until the runtime/API exit checks from the earlier sprint are green.
`TO-REVIEW.md` is treated as review intake: actionable items are mapped into
this sprint roadmap, while stale/resolved review notes stay there as archive.

### Sprint 0 - Done - Spec Gate Implementation

Goal: turn the documentation surface into enforceable contracts instead of
reader-only PDFs.

Status: implementation closed 2026-04-25. The gate, CI jobs, strategic proof
tests, and preamble/template exclusions moved to
[DONE.md](DONE.md#sprint-closures--2026-04-25). Converting every current spec
to APPROVED/IMPLEMENTED remains open under "Spec, Test, And CI Gaps".

Scope:

- `SPEC-GATE`, tri-layer traceability, spec validation CI, and DRAFT -> REVIEW
  -> APPROVED policy.
- `scripts/spec-check.ts` preamble exclusion and spec-build CI.
- Minimum sweep/spec smoke coverage needed before any spec is called validated.
- TO-REVIEW strategic-test gaps: labelled Thalamus query -> executor -> graph
  write proof, labelled Sweep trigger -> finding -> reviewer accept -> audit
  proof, and seeded sim determinism assertion.

Exit checks:

- `pnpm spec:check`
- `make -C docs/specs all`
- `pnpm test:unit`
- `pnpm test:integration`
- `pnpm test:e2e`

### Sprint 1 - Fish Runtime Truth

Goal: make Fish behavior match the architecture we want to present.

Status: closed 2026-04-25. `SIM-F2` is closed as an architecture rejection:
per-swarm LLM tuning is not allowed; `sim.fish` / Thalamus remains the unique
executable LLM source of truth. `SIM-F3` through `SIM-F6` are implemented and
moved to [DONE.md](DONE.md#sprint-closures--2026-04-25).

Scope:

- `SIM-F1` fish timeout and cancellation. Done.
- `SIM-F2` per-swarm LLM config. Rejected/reframed: add guards, do not
  duplicate `model`, `temperature`, `reasoningEffort`, or token knobs in sim
  launch/run config.
- `SIM-F3` real or explicitly removed fish concurrency semantics.
- `SIM-F4` rich selector hints for specialized fish skills.
- `SIM-F5` baseline/control fish policy.
- `SIM-F6` fixture-backed sim smoke commands.

Exit checks:

- Fixture swarm launches and reaches aggregation without live cloud spend. Done
  for current e2e fixture coverage.
- Timed-out fish become `timeout` and still unblock aggregation. Done.
- Telemetry/PC swarms select specialized skills when the seed exposes targets.
  Done.
- `fishConcurrency` is implemented as a real per-swarm claim/enqueue
  constraint. Done.
- Baseline/control fish policy is explicit: fish 0 must be `{ kind: "noop" }`.
  Done.
- Runnable sim smoke commands exist for fixture-backed telemetry, PC, and
  conjunction swarms. Done: `pnpm sim:smoke` / `make sim-smoke`.

### Sprint 2 - Fish Operator API

Goal: expose enough backend surface for an operator to inspect and interrogate a
swarm without touching DB internals.

Status: closed 2026-04-25. The operator API now exposes swarm list/status/SSE,
fish timelines, aggregate-backed clusters, trace export, and terminal post-run
Q&A through durable review evidence. It reuses existing sim read models and the
central Thalamus LLM transport; no private DB shortcut or duplicate clustering
path was introduced. Closure details moved to
[DONE.md](DONE.md#sprint-2---fish-operator-api).

Scope:

- Swarm list/status stream. Done.
- Fish turn timeline API. Done.
- Terminal cluster API. Done.
- Per-fish trace export. Done.
- Read-only post-run Q&A endpoint. Done.
- Aggregator / swarm-service / promotion `stepLog` emission. Done.
- Fish/provider/model/cost metadata in traces where available. Done where the
  current turn rows expose provider/cost metadata.

Exit checks:

- One API-level test launches a fixture swarm and reads status, timeline,
  clusters, and trace export. Done:
  `apps/console-api/tests/e2e/swarm-uc3.e2e.spec.ts`.
- Q&A is persisted as review evidence and does not mutate fish memory unless a
  promotion path explicitly does so. Done: `sim_review_evidence` integration
  coverage plus operator service unit coverage for terminal-only Q&A and
  no memory writes.

### Sprint 3 - 3D Fish Operator UI

Goal: build the operator-facing 3D murmuration view for watching and questioning
Fish swarms.

Status: in progress as of 2026-04-27. Frontend R3F surface landed in commits
6665966 and 58149f8. `apps/console/src/features/fish-operator/FishSwarmPlot.tsx`
ships a full-bleed `<Canvas>` with `<instancedMesh>`, GLB squid model loader,
deterministic beeswarm layout, OrbitControls, frustum culling, and a 300-fish
sampling cap; `event.instanceId` is mapped back to `FishSceneNode.fishIndex`
for picking. `FishOperatorHud.tsx` houses `FishFiltersPanel`,
`FishInspectorPanel`, `FishEvidencePanel`, and `FishAskPanel`, with the latter
calling `useSimReviewQuestionMutation` for swarm/cluster/fish scopes.
`apps/console/src/routes/fish.tsx` registers `/fish` via `React.lazy`, and the
`vendor-3d` / `vendor-graph` / `vendor-shell` manual chunks are wired through
`apps/console/manual-chunks.ts` and `vite.config.ts`. Vitest DOM smoke covers
200/300-fish render, instance-id picking, and sampling. Remaining: Playwright
is not yet installed and there are no real WebGL exit checks (desktop/mobile
screenshots, nonblank canvas pixel, real picking, camera control, 200-fish
FPS). Fly camera mode is not implemented and is treated as optional.

Scope:

- `SIM-F7` full-bleed Three.js/R3F swarm scene. Done.
- Instanced/pickable fish meshes or particles. Done.
- Orbit camera, timeline scrubber, cluster/status filters. Done. Fly mode is
  not implemented (treat as optional).
- Fish/cluster/swarm interrogation panel. Done.
- Bundle split so 3D dependencies stay scoped to the operator surface. Done.
- TO-REVIEW bundle-size warning: route-level lazy loading and manual chunks
  for 3D, graph, and base-shell dependencies. Done.

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

- `EVAL-1` through `EVAL-10`.
- Real eval corpus lock and manifest.
- Paired runner, frozen baselines, nondeterminism statistics.
- SSA + HRM metrics, provider telemetry, budget tiers, reports.

Exit checks:

- `$25` smoke run produces JSONL plus aggregate report.
- Report includes commit SHA, manifest hash, model config, costs, scores, and
  residual risks.

### Sprint 5 - Core Architecture Debt

Goal: reduce package-boundary ambiguity before expanding more product surface.

Plan figé 2026-04-27 in [tasks/sprint5-architecture-debt-plan.md](tasks/sprint5-architecture-debt-plan.md).
Order is non-negotiable: writer unification (Phases 1-5) lands before any
god-service split (Phases 6-7), because splitting before unification is what
made `C2` grow +53 LOC and `M3` grow +11 LOC since Pass 1.

Scope (in execution order):

1. `I6` — dedupe app-side ports + rename divergent `SatellitesReadPort`.
2. `M2` — relocate thalamus ports to `packages/thalamus/src/ports/`.
3. `C1` step A — app-owned `ResearchWriteService` with business DTOs only
   (no `$inferInsert` exposed to services).
4. `C1` step B — kernel-only HTTP routes:
   `POST /api/research/cycles`,
   `POST /api/research/finding-emissions`,
   `POST /api/research/cycles/:id/increment-findings`,
   `POST /api/research/edges` (only if a real standalone caller survives).
5. Migrate callers + **delete** (not privatize) the public write methods on
   app-side `finding.repository.ts` / `research-edge.repository.ts`.
6. `C2` — split `sim-promotion.service.ts` into outcome / modal-suggestion /
   telemetry-suggestion services + two pure helpers, all consuming
   `ResearchWritePort`. Old service deleted, no façade.
7. `M3` — split `research-graph.service.ts` into finding-store / kg-query /
   finding-lifecycle / finding-events. Imports migrated in the same PR; no
   committed façade.
8. `M1`, `M4`, `M8` — small items. **DONE 2026-04-28**.
9. `I5`, `C4` — kernel / domain decoupling (sweep stops importing thalamus;
   SSA tokens stripped from thalamus kernel).

Exit checks:

- Research KG writes go through one approved writer surface (HTTP routes +
  one business writer; greps in the plan's Definition of Done all return
  zero hits outside the writer).
- Sim promotion and research-graph are deleted as monolithic services; new
  split services exist with per-service unit tests.
- Sweep/Thalamus coupling is removed from `packages/sweep/src` and
  `packages/sweep/package.json`.
- Redis full-list reads are bounded.

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

---

## TO-REVIEW Intake Map

`TO-REVIEW.md` is ignored by Git, so the active mapping is tracked here. Use this
section when draining old review notes into the sprint roadmap.

- Bundle size warning -> Sprint 3 / Sprint 7 bundle split and lazy route
  loading.
- Zustand drawer concern -> Sprint 7 and "Shared drawer routing review".
- SGP4 cache -> Sprint 7 and "SGP4 cache LRU".
- FindingReadout / FindingsPanel duplication -> Sprint 7 and "Finding card
  extraction trigger".
- REPL follow-up gaps -> Sprint 7, "Live browser SSE sanity check", and
  "Broaden targeted sweep auto-runs beyond `operator_country`".
- Plan 5 / Plan 6 sim-kernel notes -> mostly resolved or superseded by C1/C2/M4
  plus Sprint 1 Fish runtime work.
- CLI Plan 3 leftovers -> Sprint 7 and "CLI Plan 3 cleanup".
- Remaining strategic sweep gaps -> Sprint 6 and the strategic test backlog.
- Fish quick-wins -> `SIM-F8`.

---

## Detailed Backlog

---

## Immediate Architecture Debt

- [x] **C1 - collapse writes to `research_*` tables behind one writer.**
      `db.insert(research*)` is isolated to
      `apps/console-api/src/services/research-write.service.ts`, dormant
      app-side write repos are deleted, and kernel-only HTTP endpoints use Zod
      business DTO parsing plus route e2e coverage.
- [x] **C2 - split `apps/console-api/src/services/sim-promotion.service.ts`.**
      Old service deleted; outcome, modal suggestion, telemetry scalar, helper,
      and shared port files now own the former responsibilities.
- [x] **C4 - finish thalamus kernel de-domainization.** Targeted kernel files no
      longer carry SSA/satellite/orbit/conjunction defaults or prompt text.
- [x] **I5 - sweep -> thalamus coupling.** `packages/sweep/src` and
      `packages/sweep/package.json` no longer import or depend on
      `@interview/thalamus`.
- [x] **I6 - extract duplicate app service ports.** Research write ports live in
      `apps/console-api/src/services/ports/`, and the divergent satellite read
      ports have explicit names.
- [x] **M1 - stats repository reads kernel-owned tables directly.**
      Stats now reads through `vw_research_stats_counts`,
      `vw_research_findings_by_status`, and
      `vw_research_findings_by_cortex`.
- [x] **M2 - finish thalamus ports cleanup.** Cortex data provider, domain
      config, and execution strategy ports live under
      `packages/thalamus/src/ports/`.
- [x] **M3 - split `packages/thalamus/src/services/research-graph.service.ts`.**
      Old service deleted; finding-store, kg-query, archive, and shared graph
      types now own the former responsibilities.
- [x] **M4 - promote the inline sim launcher closure.**
      `SimLauncherService` now owns telemetry/Pc launch orchestration.
- [x] **M8 - bound Redis pagination in `packages/sweep/src/repositories/sweep.repository.ts`.**
      Legacy all-index scans now page through bounded batches.

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
      follow-up stack can launch current narrow targeted audits; add more target
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
not documentation promises. `SIM-F3` through `SIM-F6` are closed and moved to
DONE; only open candidates remain below.

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

- [x] **EVAL-1 - closed 2026-04-27.** Real eval corpus locked at
      `docs/evals/real-eval-manifest.json` (270 lines, 8 datasets covering ESA
      Kelvins CDM gold data, CelesTrak SATCAT/GP/SOCRATES, NOAA SWPC,
      ARC-AGI-2, Sapient Sudoku Extreme, Sapient Maze 30x30, Sapient HRM
      reference code) and `data/evals/_manifest-lock.json` (sha256 + md5 per
      asset, profile `full`). Driver: `scripts/acquire-real-evals.ts` plus
      `evals:list` / `evals:fetch:smoke` / `evals:fetch:full` package scripts.
      Move to DONE.md on next trim.
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
- [x] **EVAL-9 - closed 2026-04-27.** Multimodal honesty captured in
      `docs/evals/evaluation-protocol.md` (lines 240-265) and
      `docs/evals/drafts/cost-observability-protocol.md` (lines 130-174):
      runtime is documented as text-first (kimi-k2-turbo-preview,
      gpt-5.4-nano, gpt-5.4-mini, gpt-5-nano, MiniMax-M2.7, local Gemma,
      voyage-4-lite/large) with an explicit "le multimodal n'est pas encore
      un chemin runtime explicite dans ce repo" caveat. Re-open if a
      multimodal adapter is added. Move to DONE.md on next trim.
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

Manual SQL migrations 0012 and 0013 are raw SQL functions and are not
drizzle-generated. Apply with:

```sh
psql "$DATABASE_URL" -f packages/db-schema/migrations/0012_orbital_analytics_fns.sql
psql "$DATABASE_URL" -f packages/db-schema/migrations/0013_conjunction_knn_fn.sql
```
