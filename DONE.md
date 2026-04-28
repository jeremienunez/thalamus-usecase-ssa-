# DONE

Items verified as fully implemented. Audited 2026-04-19 against the live tree;
TODO trim updated 2026-04-28.

Sister files: [TODO.md](TODO.md) (open), [TO-REVIEW.md](TO-REVIEW.md) (partial).

---

## Sprint closures - 2026-04-25

### Sprint 0 - Spec gate implementation

- [x] **Spec gate enforces tri-layer evidence.** `scripts/spec-check.ts` now
      ignores LaTeX preambles/templates, parses AC trace rows with
      `unit` / `integration` / `e2e` layers, requires every enforced
      `APPROVED` / `IMPLEMENTED` AC to cite all three layers, and verifies both
      referenced files and test names. Covered by
      `packages/test-kit/tests/spec-check.spec.ts`.
- [x] **Spec validation CI landed.** `.github/workflows/spec-validation.yml`
      runs `pnpm spec:check`, unit tests, migrations, integration tests, e2e
      tests, and a `spec-build` job that builds PDFs under `docs/specs/`.
- [x] **Strategic proof tests landed.** Added labelled Thalamus planner ->
      executor -> graph write proof, labelled Sweep suggestion -> accept ->
      resolution/audit proof, and deterministic sim aggregate replay coverage.

### Sprint 1 - Fish runtime closed items

- [x] **SIM-F1 fish timeout and cancellation.** `swarm-fish.worker.ts` now
      enforces `perFishTimeoutMs`, propagates `AbortSignal` into turn runners
      and nano calls, marks timed-out fish as `timeout`, and still notifies
      aggregation so quorum cannot hang on a dead fish.
- [x] **SIM-F2 closed as architecture rejection.** Per-swarm executable LLM
      tuning is intentionally not implemented. Fish LLM tuning remains in the
      centralized `sim.fish` / Thalamus config path; sim launch/run config now
      rejects provider/model/reasoning/token/temperature knobs at the API and
      sweep schema boundaries.
- [x] **SIM-F3 fish concurrency is real.** Swarm launch now creates fish as
      pending rows, atomically claims pending fish up to `fishConcurrency`, marks
      claimed fish running, and enqueues only claimed jobs. Completion claims the
      next pending fish before aggregation. Covered by swarm runtime unit tests,
      service mapping tests, and repository integration coverage.
- [x] **SIM-F4 specialized fish selection uses rich hints.** Turn runners pass
      scenario/subject hints into `SimCortexSelector`, and the SSA selector also
      routes by `simKind` for telemetry and PC swarms. Covered by selector and
      turn-runner unit tests.
- [x] **SIM-F5 baseline/control fish policy is explicit.** `launchSwarm()`
      requires fish 0 to be `{ kind: "noop" }`; telemetry and PC launchers keep
      requested fish count as total count and reserve index 0 for the baseline.
      Covered by launcher and swarm runtime tests.
- [x] **SIM-F6 fixture-backed smoke command landed.** `pnpm sim:smoke` and
      `make sim-smoke` run fixture-backed telemetry, PC, and UC3 swarm e2e
      coverage without live cloud spend.

### Sprint 2 - Fish Operator API

- [x] **Operator HTTP surface landed.** Added `/api/sim/operator/swarms`,
      status, SSE events, fish timeline, aggregate-backed clusters, trace
      export, Q&A, and evidence routes under the existing authenticated sim
      route group.
- [x] **Review evidence is durable and isolated.** Added
      `sim_review_evidence` with Drizzle schema/migration and repository
      coverage. Q&A writes only this table and is rejected until the swarm is
      terminal.
- [x] **No duplicated sim logic.** Operator reads reuse `SimSwarmRepository`,
      `SimRunRepository`, `SimTurnRepository`, `SimTerminalRepository`, stored
      aggregate snapshots, and the centralized Thalamus LLM transport.
- [x] **Operator traces and observability are covered.** Fish timelines expose
      actions, rationales, observable summaries, and LLM cost fields where
      present. Aggregator, swarm service, and promotion paths now emit
      `stepLog` events.
- [x] **Exit checks passed.** `swarm-uc3.e2e.spec.ts` launches a fixture swarm
      and reads operator list/status/SSE/timeline/clusters/NDJSON trace.
      Q&A persistence/no-memory-write behavior is covered by operator service
      unit tests and `sim_review_evidence` integration coverage.

## Sprint closures - 2026-04-28

### Sprint 3 - Fish Operator UI implementation slice

- [x] **SIM-F7 implementation landed.** The `/fish` route is lazy-loaded and
      backed by the R3F Fish operator surface: full-bleed `<Canvas>`,
      instanced/pickable fish scene, deterministic layout, OrbitControls,
      status/cluster filters, HUD/inspector/evidence panels, and scoped
      swarm/cluster/fish Q&A via review evidence.
- [x] **3D bundle containment landed.** `vendor-3d`, `vendor-graph`, and
      `vendor-shell` manual chunks are wired for the console build so the 3D
      operator dependencies stay scoped to the operator surface.
- [x] **DOM smoke coverage landed.** Fish operator tests cover 200/300-fish
      render, sampling, and instance-id picking in the Vitest DOM harness.
      Real browser/WebGL Playwright exit checks remain open in `TODO.md`.

### Sprint 5 - Core Architecture Debt

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
- [x] **M1 - stats repository reads kernel-owned tables through views.**
      `StatsRepository` reads through `vw_research_stats_counts`,
      `vw_research_findings_by_status`, and
      `vw_research_findings_by_cortex`; migration `0015` is wired through the
      repo migration runner and has been applied locally.
- [x] **M2 - finish thalamus ports cleanup.** Cortex data provider, domain
      config, and execution strategy ports live under
      `packages/thalamus/src/ports/`.
- [x] **M3 - split `packages/thalamus/src/services/research-graph.service.ts`.**
      Old service deleted; finding-store, kg-query, archive, and shared graph
      types now own the former responsibilities.
- [x] **M4 - promote the inline sim launcher closure.**
      `SimLauncherService` now owns telemetry/PC launch orchestration.
- [x] **M8 - bound Redis pagination in `packages/sweep/src/repositories/sweep.repository.ts`.**
      Legacy all-index scans now page through bounded batches.

### Evaluation protocol closures

- [x] **EVAL-1 - real eval corpus locked.** `docs/evals/real-eval-manifest.json`
      and `data/evals/_manifest-lock.json` pin the real eval assets. The
      acquisition driver lives in `scripts/acquire-real-evals.ts` with
      `evals:list`, `evals:fetch:smoke`, and `evals:fetch:full` scripts.
- [x] **EVAL-9 - multimodal honesty documented.**
      `docs/evals/evaluation-protocol.md` and
      `docs/evals/drafts/cost-observability-protocol.md` document the current
      runtime as text-first and explicitly state that multimodal is not yet an
      executable runtime path in this repo.

### Temporal Hypothesis Layer implementation slice

- [x] **Product framing and spec landed.**
      `docs/specs/2026-04-27-temporal-hypothesis-layer.md` defines THL as a
      separate hypothesis layer: temporal episode mining with STDP-like decay,
      correlation-only outputs, read-only consumers, no KG fact writes, and
      anti-contamination through `seeded_by_pattern_id`.
- [x] **Pure deterministic temporal package landed.**
      `packages/temporal` owns canonical signatures, stable sorting,
      closed-window episode mining, negative evidence, STDP-like scoring,
      deterministic pattern hashes, and DoD edge-case coverage. Architecture
      tests keep the package free of DB, app, KG, and network imports.
- [x] **Temporal schema and migration landed.**
      `packages/db-schema/src/schema/temporal.ts` plus
      `packages/db-schema/migrations/0013_busy_avengers.sql` introduce
      `temporal_projection_run`, `temporal_event`,
      `temporal_learning_run`, `temporal_pattern_hypothesis`, steps, edges,
      examples, reviews, seeded-run links, query logs, and evaluation tables.
- [x] **Console API temporal services landed.**
      Projection, learning, and memory services project canonical events from
      closed windows, persist pattern hypotheses, and expose
      `GET /api/cortex/temporal-patterns` as a read-only cortex route. The
      response carries `hypothesis: true` and `decisionAuthority: false`.
- [x] **Shadow run endpoint landed.**
      `POST /api/temporal/shadow-runs` runs projection then learning over a
      bounded closed window and returns a summary with `kgWriteAttempted: false`
      and `actionAuthority: false`.
- [x] **Temporal review route landed.**
      `POST /api/temporal/patterns/:id/review` records a review row and updates
      hypothesis status transactionally. Acceptance is blocked unless the
      pattern has positive examples plus negative evidence or counterexamples;
      mixed-domain patterns cannot be accepted without a domain breakdown.
- [x] **FollowUp consumes THL as read-only evidence.**
      The follow-up planner queries accepted temporal hypotheses, filters out
      unaccepted patterns in normal mode, and can attach accepted THL evidence to
      PC/telemetry/Fish follow-ups without granting decision authority.
- [x] **Fish seeding anti-contamination landed.**
      PC and telemetry swarm seeds carry `seeded_by_pattern_id` when launched
      from THL evidence, and `SimRunService` persists an idempotent
      `temporal_pattern_seeded_run` link for numeric pattern IDs.
- [x] **Seeded simulations stay isolated.**
      The scorer excludes `simulation_seeded` events from production learning
      and can score them only in the `simulation_seeded` domain. Unit and
      integration tests cover the separation and the seeded-run persistence
      path.

## Migrated from TODO - 2026-04-25 trim

These entries were removed from `TODO.md` because the live tree shows the work
is already done or the original TODO is now stale. Remaining open variants were
rewritten in `TODO.md` with current file paths and current behavior.

### Runtime and architecture hardening

- [x] **HNSW telemetry TODO closed as stale.** The old `telemetry_14d` vector
      column no longer exists in the active path. `searchByTelemetry()` now
      searches `satellite.embedding`, `0014_satellite_embedding.sql` adds the
      `satellite.embedding` halfvec column and HNSW index, and the integration
      spec covers nearest-neighbor search from live satellite embeddings.
- [x] **M5 void-import hack removed.** `packages/thalamus/src/repositories/research-edge.repository.ts`
      no longer contains the 8-line `void <import>` tree-shake workaround.
- [x] **C4 file moves completed.** The specific files named by the old TODO
      (`satellite-entity-patterns`, domain fetchers, opacity prompt) now live on
      the app side under `apps/console-api/src/agent/ssa/**`. Remaining C4 work
      is only the generic cleanup of comments/defaults, now tracked separately
      in `TODO.md`.

### Sweep sim cleanup

- [x] **Legacy `packages/sweep/src/sim/promote.ts` monolith collapsed.** The
      file is now a 13-line helper module (`isKgPromotable`, `isTerminal`), not
      the former SQL/Redis/KG/embedding owner.
- [x] **`PLAN2_DEFERRED_ALLOWLIST` cleanup done.** No symbol named
      `PLAN2_DEFERRED_ALLOWLIST` remains in the repo.
- [x] **Sim arch guard unskipped.** `packages/sweep/tests/arch-guard-package.spec.ts`
      runs the real dependency-cruiser sweep check, and `pnpm test:policy`
      passes with no forbidden `describe.skip`.
- [x] **Sim source-class promotion consolidated.** The old in-package
      `simHook` chain is gone; promotion flows through `SweepPromotionAdapter`
      and the SSA implementation `SsaPromotionAdapter`.
- [x] **`packages/sweep/src/sim/types.ts` SSA cleanup done.** The current file
      only re-exports generic sim/db-schema types and local sim interfaces; no
      SSA-specific references remain.

### Repository split cleanup

- [x] **Legacy satellite repository removed.** No `satellite.repository.ts`
      remains under `apps/` or `packages/`.
- [x] **Satellite read split landed.** The old `satellite-view.repository.ts`
      target methods now live in split repositories:
      `satellite-view.repository.ts`, `satellite-dimension.repository.ts`,
      `satellite-null-audit.repository.ts`,
      `satellite-field-enrichment.repository.ts`, and
      `satellite-sweep-stats.repository.ts`.
- [x] **Package-side legacy satellite repository not alive.** The conditional
      TODO to split `packages/sweep/src/repositories/satellite.repository.ts`
      is closed because that file does not exist.

### REPL content quality

- [x] **REPL summariser prompt upgraded.** `summariserPrompt()` now reads
      `findingType` / `urgency`, prioritizes strategist/risk findings, cites
      only names present in payload, and de-prioritizes data/classification
      auditors outside audit mode.

---

## Migrated from TODO — 2026-04-23 housekeeping

Items below were previously tracked as checked `[x]` inside `TODO.md` and
are now folded here so `TODO.md` shows only genuinely open work. Each
entry preserves the verification note written when the item was closed.

### Coverage — top 10 winners (closed 2026-04-23)

Real current coverage from `pnpm test:coverage` on `apps/**/src` +
`packages/**/src`: `lines 71.45%` · `statements 70.61%` ·
`functions 67.06%` · `branches 63.97%`.

The 10 highest-leverage slices from the `2026-04-22` audit were all
closed to `100%` on their own files. The coverage command still exits
non-zero because the repo enforces per-file `100%` thresholds on
remaining lower-priority files outside these slices.

- [x] **Coverage winner 1 (DONE 2026-04-23)** - `packages/db-schema/src/seed/**`
      (`15` files, `1265` uncovered lines in the `2026-04-22` baseline,
      est. `+9.38` pts global lines).
- [x] **Coverage winner 2 (DONE 2026-04-23)** - `apps/console/src/features/ops/**`
      (`21` files, `724` uncovered lines, est. `+5.37` pts).
- [x] **Coverage winner 3 (DONE 2026-04-23)** - `apps/console-api/src/agent/ssa/sweep/**`
      (`18` files, `343` uncovered lines, est. `+2.54` pts).
- [x] **Coverage winner 4 (DONE 2026-04-23)** - `apps/console-api/src/agent/ssa/sources/**`
      (`16` files, `283` uncovered lines, est. `+2.10` pts).
- [x] **Coverage winner 5 (DONE 2026-04-23)** - `packages/thalamus/src/services/**`
      (`8` files, `217` uncovered lines, est. `+1.61` pts).
- [x] **Coverage winner 6 (DONE 2026-04-23)** - `apps/console/src/shared/ui/**`
      (`15` files, `209` uncovered lines, est. `+1.55` pts).
- [x] **Coverage winner 7 (DONE 2026-04-23)** - `packages/cli/src/boot.ts` +
      `packages/cli/src/app.tsx` + `packages/cli/src/components/**` +
      `packages/cli/src/renderers/**` (`15` files, `206` uncovered
      lines, est. `+1.53` pts).
- [x] **Coverage winner 8 (DONE 2026-04-23)** - `apps/console/src/features/repl/**`
      (`21` files, `170` uncovered lines, est. `+1.26` pts).
- [x] **Coverage winner 9 (DONE 2026-04-23)** - `packages/thalamus/src/transports/**`
      (`12` files, `160` uncovered lines, est. `+1.19` pts).
- [x] **Coverage winner 10 (DONE 2026-04-23)** - `apps/console/src/features/thalamus/**`
      (`4` files, `147` uncovered lines, est. `+1.09` pts).

### Runtime config registry + admin UI follow-ups — 2026-04-22

- [x] **Wire `sim.swarm` (DONE 2026-04-22, commit a200cbf)** — runtime
      `defaultQuorumPct` / `defaultFishConcurrency` now read via
      `readQuorumPct` / `readPositiveInt` in
      `sim-orchestrator.service.ts:104,106`. Covered by
      `packages/sweep/tests/unit/sim-runtime-config.spec.ts`.
- [x] **Wire `sim.embedding.embedConcurrency` (DONE 2026-04-22, commit a200cbf)** —
      `readEmbedConcurrency(config.embedConcurrency)` is called in
      `memory.service.ts:89` and `aggregator.service.ts:193`; the old
      hardcoded `EMBED_CONCURRENCY = 8` is gone.

### Console front 5-layer — god-component internals (follow-up)

- [x] **OpsEntry RTL (DONE 2026-04-23)** — the frontend ops slice now has
      a DOM-first harness for the 3D layer: `Entry.test.tsx`,
      `OpsDrawer.test.tsx`, and `ops-3d.test.tsx` mock
      `@react-three/fiber` and cover the main interaction paths plus
      edge cases for the scene / drawer / orbit trail stack.

### REPL verification / follow-up — 2026-04-19 / 2026-04-23

- [x] **Package de-domainization landed** — `packages/thalamus` now emits
      only generic verification signals (`reasonCodes` + entity hints),
      and `packages/shared` no longer exposes SSA-specific follow-up
      target fields. SSA follow-up kinds live only in
      `apps/console-api/src/agent/ssa/followup/`.
- [x] **Front render of `followup.*` events (DONE 2026-04-23)** — the
      console REPL now renders child follow-ups under the parent turn
      via `FollowUpPlanView`, `FollowUpTurnView`, `TurnView`, and the
      `reducer.followups` flow, with RTL coverage on the stream event
      sequence.

### Architecture audit 2026-04-19 — Pass 1 closures

- [x] **C3 (DONE 2026-04-19)** — removed `packages/thalamus/src/controllers/` + `packages/thalamus/src/routes/` directories + exports from `packages/thalamus/src/index.ts:71-73`. Verified: `pnpm -r typecheck` green (7/7), 332 package unit tests + 314 console-api unit tests passing, zero regression.
- [x] **I1 (DONE 2026-04-22)** — moved raw `db.transaction()` / `db.update(simSwarm)` / `db.execute(sql)` out of `apps/console-api/src/services/sim-swarm-store.service.ts` into `SimSwarmRepository.abortSwarm`, `SimSwarmRepository.snapshotAggregate`, and `SimSwarmRepository.closeSwarm`. Added repo integration coverage for the atomic abort cascade and config snapshot writes.
- [x] **I2 (DONE 2026-04-22, commits c11223f / 0493211 / 19eda38 / c9cbb2c)** — `/api/kg/neighbourhood` and `/api/why` routes were added, then the CLI graph and why reads were moved onto `packages/cli/src/adapters/thalamus.http.ts`. `packages/cli/src/boot.ts` no longer contains any direct Drizzle reads of `research_edge`, `research_finding`, `research_cycle`, or `source_item` (grep clean).
- [x] **I3 (DONE 2026-04-19)** — replaced the `as unknown as {...}` double-cast in `apps/console-api/src/container.ts` with a typed `sweepRepoHolder: { loadPastFeedback: () => Promise<SuggestionFeedbackRow[]> }`. Same object ref is passed to `SsaAuditProvider` and rebound after `buildSweepContainer` resolves — no private-field reach, no casts. Pre-wire call throws a clear error so the cycle mistake is loud in dev.
- [x] **I4 (DONE 2026-04-19)** — promoted `setNanoConfigProvider`, `setNanoSwarmConfigProvider`, `setNanoSwarmProfile`, `setCuratorPrompt`, `DEFAULT_NANO_SWARM_PROFILE`, `Lens`, `NanoSwarmProfile`, `ExplorationQuery`, `NanoRequest`, `NanoResponse` to `packages/thalamus/src/index.ts` barrel. Migrated all 4 consumers (`container.ts`, `satellite-sweep-chat.service.ts`, `nano-swarm-ssa.prompt.ts`, `audit-provider.ssa.ts`) to barrel imports. Verified: zero `@interview/thalamus/...` deep paths in `**/src/**`, typecheck 7/7, 332+314 unit tests pass.

### Architecture audit 2026-04-19 — Pass 2 closures

- [x] **C5 (DONE 2026-04-19 — chose remount)** — sweep-chat stack rewired in `apps/console-api/src/container.ts` (`SatelliteSweepChatRepository` + `SatelliteSweepChatService` + `SatelliteSweepChatController` construction, `VizService`+`SatelliteService` stubs injected); `apps/console-api/src/routes/index.ts` mounts via `app.register(async scope => satelliteSweepChatRoutes(scope, s.satelliteSweepChat), {prefix:"/api/satellites"})`. Routes exposed: `POST /api/satellites/:id/sweep-chat` (SSE stream) + `GET /api/satellites/:id/sweep-chat/state`. Auth scoped (`authenticate` + `requireTier`) inside the sub-plugin — no leakage to sibling routes. **Follow-up TODO**: (1) front-end UI (no `useSweepChat` query exists yet in `apps/console`), (2) C6 AbortSignal plumbing also applies to this controller's SSE loop.
- [x] **C6 (DONE 2026-04-19)** — `apps/console-api/src/controllers/repl.controller.ts` and `.../satellite-sweep-chat.controller.ts` both wire an `AbortController` subscribed to `reply.raw.on("close")`. `ReplChatService.handleStream` and `SatelliteSweepChatService.chat` now accept `signal?: AbortSignal`, check `aborted()` before every new LLM/cortex/embed call and at every yield boundary. Result: a client disconnect stops new token spend within one generator step. Updated `tests/unit/controllers/repl.controller.test.ts` to assert the 3rd `AbortSignal` arg.
- [x] **C7 (DONE 2026-04-19)** — added `app.addHook("onClose", ...)` in `apps/console-api/src/server.ts` after `registerAllRoutes` (L237-243) that calls `container.services.mission.stop()` + `container.services.autonomy.stop()`. Timers now cleared on Fastify shutdown.
- [x] **I7 (DONE 2026-04-19)** — `apps/console-api/src/services/mission.service.ts` tick() now has `catch (err)` block that increments `errorCount` and logs `{err, suggestionId, satelliteId}` via the injected Fastify logger. No more unhandled rejections from `runTask` failures.
- [x] **I8 (DONE 2026-04-22)** — eliminated `process.env` reads from `packages/thalamus/src/**` by adding a dedicated `ThalamusTransportConfig` provider (`packages/thalamus/src/config/transport-config.ts`) and seeding it from `apps/console-api/src/server.ts` into the container at boot. `nano-caller`, fixture/mode-aware transports, and provider backends now read injected config instead of env globals; grep confirms zero `process.env` references remain under `packages/thalamus/src`.
- [x] **I9 (DONE 2026-04-22)** — `SwarmService.onFishComplete` now claims aggregation atomically via Redis `SETNX` (`packages/sweep/src/sim/swarm-aggregate-gate.ts`) before enqueueing the BullMQ aggregate job. The guard is reset at swarm launch to avoid stale keys when tests recreate a fresh DB but reuse Redis, and released on enqueue failure so a retry can still succeed.
- [x] **I10 (DONE 2026-04-19)** — added `mapWithConcurrency<T,R>` helper in `packages/shared/src/utils/concurrency.ts` (order-preserving, cap-respecting, 6 unit tests covering edge cases). Replaced unbounded `Promise.all` at `packages/sweep/src/sim/memory.service.ts:writeMany` and `packages/sweep/src/sim/aggregator.service.ts` batch-embed with `mapWithConcurrency(..., 8, ...)`. No new npm dep.
- [x] **I11 (DONE 2026-04-22)** — split `packages/sweep/src/internal.ts` out of the root barrel and moved sweep/sim execution internals there: orchestrators, workers, queues, aggregation/runtime helpers, and monorepo-only helpers like `isKgPromotable`. `@interview/sweep` now stays focused on ports/DTOs/adapters/config, while `apps/console-api` and the sweep e2e harness import infra-only symbols from `@interview/sweep/internal`.
- [x] **I12 (DONE 2026-04-19)** — `useMissionStatus` + `useAutonomyStatus` in `apps/console/src/lib/queries.ts` now use `refetchInterval: (q) => q.state.data?.running ? <ms> : false`. Idle dashboards poll 0× per minute (was 24 + 20).
- [x] **M6 (DONE 2026-04-22)** — `apps/console-api/src/server.ts` no longer mutates global `process.env` to seed the sim kernel secret. `readServerEnv()` now applies the default inside the returned config object, the sim route auth middleware receives that value explicitly, and the e2e swarm harness reads the same constant instead of relying on boot-time env mutation.
- [x] **M7 (DONE 2026-04-22)** — sim fleet/target shape types moved into `apps/console-api/src/types/` and both transformers now import those shared type modules instead of depending on service-layer files. `SimFleetService`, `SimTargetService`, and `SatelliteFleetRepository` were rewired to consume the same shared types.
- [x] **M9 (DONE 2026-04-22)** — `apps/console-api/src/repositories/sim-memory.repository.ts` now batch-inserts memory rows with one `.insert(...).values(inserts).returning(id)` call instead of looping per row inside a transaction. The repository keeps the same row mapping and returns ids in insert order while removing the N+1 write path.
- [x] **M10 (DONE 2026-04-22)** — `packages/cli/src/boot.ts` now logs owned Redis shutdown failures at `warn` instead of swallowing them. `packages/cli/tests/boot.spec.ts` covers the rejected `quit()` path so the CLI keeps its best-effort shutdown while exposing real close failures.

### console-api 5-layer — code-review follow-ups closed 2026-04-23

- [x] **Redact error messages from `asyncHandler` in prod** — the
      handler at `apps/console-api/src/utils/async-handler.ts` logs the
      raw error through `req.log.error` but sends
      `{ error: "internal error" }` back to the client whenever
      `NODE_ENV === "production"` and the error carries no explicit
      `statusCode`. Explicit statuses still pass their message through.
- [x] **Tighten `satellitesController` regime validation** —
      `apps/console-api/src/schemas/satellites.schema.ts:6` now declares
      `regime: RegimeSchema.optional()` (strict enum). The controller
      at `controllers/satellites.controller.ts` runs the query through
      `parseOrReply(..., SatellitesQuerySchema, reply)` before calling
      `service.list({ limit, regime })`, so invalid regimes short-circuit
      with a 400 before touching the service.
- [x] **Reshape `ConjunctionViewService.list(minPc)` to options-object** —
      `services/conjunction-view.service.ts:39` now accepts
      `{ minPc }: { minPc: number }`, matching the options-object
      convention used by the sibling view services.
- [x] **Split `findingDecisionController` error reporting** — the
      controller at `controllers/findings.controller.ts:37` runs
      `parseOrReply(req.params, FindingIdParamsSchema, reply)` and then
      `parseOrReply(req.body, FindingDecisionBodySchema, reply)`
      separately. Each Zod failure returns a distinct 400 payload,
      replacing the old single `"invalid"` sentinel.
- [x] **De-dup `entityRef`** — `transformers/finding-view.transformer.ts`
      now imports `entityRef` from `./kg-view.transformer` (single
      source at `kg-view.transformer.ts:59`) instead of redefining it.

### console-api — test surface gaps closed 2026-04-23

- [x] **Unit test `ReflexionService` (DONE 2026-04-23)** — covered in
      `apps/console-api/tests/unit/services/reflexion.service.test.ts`.
- [x] **Unit test `MissionService` (DONE 2026-04-23)** — covered in
      `apps/console-api/tests/unit/services/mission.service.test.ts`.
- [x] **Unit test `KnnPropagationService` (DONE 2026-04-23)** — covered in
      `apps/console-api/tests/unit/services/knn-propagation.service.test.ts`.
- [x] **Integration spec repos (DONE 2026-04-23)** — live Postgres specs
      exist for `finding.repository`, `research-edge.repository`,
      `reflexion.repository`, and `stats.repository`.
- [x] Remaining services previously called out as missing unit tests are
      now covered: `KgViewService`, `StatsService`,
      `EnrichmentFindingService`, `NanoResearchService`,
      `ReplChatService`, `ReplTurnService`, `SweepSuggestionsService`,
      and `AutonomyService`.
- [x] Schema tests (DONE 2026-04-23) — `apps/console-api/tests/unit/schemas/**`
      now cover strict rejection, clamp acceptance, and `.finite()`
      rejection paths for the route-layer schemas.
- [x] Controller-layer tests (DONE 2026-04-23) — route/controller
      contracts are covered in `apps/console-api/tests/unit/controllers/**`
      with mocked services.
- [x] `pnpm test:coverage` + report (DONE 2026-04-23) — the command and
      HTML/JSON coverage reports exist, and the repo is now at `71.45%`
      lines / `70.61%` statements / `67.06%` functions / `63.97%`
      branches. Remaining work is threshold/config cleanup, not the
      absence of coverage reporting.

---

## Console front — SOLID compression + DRY pass — 2026-04-19 (session 4)

Two follow-up commits on top of the 5-layer landing. Closes every
"god-component internals" item from the earlier TODO. Full write-up in
`CHANGELOG.md` top entry "Console front — SOLID compression + DRY pass +
jscpd".

- [x] **`features/thalamus/Entry.tsx`** — 762 → 367 LOC (-52%) via
      `useThalamusGraph` + `adapters/graph/` port (graphology + sigma +
      ForceAtlas2 extracted) + `selectKgNode` dedup.
- [x] **`features/ops/SatelliteField.tsx`** — 583 → 378 LOC (-35%) via
      `adapters/renderer/orbit-geometry.ts` (BufferGeometry assembly
      promoted to adapter; 141 LOC dedup).
- [x] **`features/ops/Entry.tsx`** — 463 → 377 LOC (-19%) via
      `useTimeControl`, `useRegimeFilter`, `useThreatBoard` view-model
      hooks; `MetricTile` lifted to `shared/ui`.
- [x] **`features/config/Entry.tsx`** — 568 → 208 LOC (-63%) via generic
      `useDraft<T>` hook absorbing form draft/dirty/errors/diff.
- [x] **`features/thalamus/FindingReadout.tsx`** — 428 → 367 LOC (-14%);
      consumes canonical `STATUS_COLOR` from `shared/types/graph-colors`
      and `KV` gains optional color prop (kills DataRow dup).
- [x] **`features/ops/OrbitTrails.tsx`** — 360 → 258 LOC (-28%) via the
      orbit-geometry adapter.
- [x] **DIP — graph adapter** — `adapters/graph/{graph-builder,sigma-renderer}.ts` + `GraphContext.tsx` wired through `AppProviders`. Thalamus no
      longer touches graphology / sigma / FA2 directly.
- [x] **DIP — renderer orbit-geometry** —
      `adapters/renderer/orbit-geometry.ts` ships
      `buildFullRingsGeometry`, `buildTailsGeometry`, `clearRingCache`.
- [x] **SRP primitives** — `shared/ui/{HudPanel,MetricTile}.tsx`,
      `shared/util/aggregate.ts` (countBy/topN/maxCount), 5 hooks
      (`useDrawerA11y`, `useDraft`, `useTimeControl`, `useRegimeFilter`,
      `useThreatBoard`).
- [x] **OCP widening** — `KV.color`, `sparkline.blockBar`, `palette.ringColor`.
- [x] **DRY** — `selectKgNode` (thalamus drawer routing), `parsePc()`
      (units.fmtPc / fmtPcCompact). jscpd clone density 0.31 % → 0.11 %.
- [x] **jscpd integration** — `jscpd` devDep + `.jscpd.json` (10 LOC /
      80 tokens / strict / ignores tests-fixtures-migrations-docs) +
      3 npm scripts (`dup:report`, `dup:check`, `dup:report:full`).
      `.reports/` git-ignored.
- [x] **Test infra DRY** — global `vi.mock("sigma")` +
      `vi.mock("graphology-layout-forceatlas2")` in
      `apps/console/tests/setup.ts`; per-file mocks removed from the
      thalamus test.

**Verification**: 48/48 tests · 0 dep-cruiser violations · jscpd 0.11 %.

## Console front 5-layer — 2026-04-19

`apps/console/src/**` refactored to a 5-layer architecture on
`feature/console-front-5l` (15 commits, all pre-commit gates green).
Mirrors the backend layering vocabulary with React-idiomatic names.
Full write-up in `CHANGELOG.md` top entry "Console front 5-layer
architecture". Spec: `docs/superpowers/specs/2026-04-19-console-front-five-layer-design.md`.
Plan: `docs/superpowers/plans/2026-04-19-console-front-five-layer.md`.

- [x] **Phase 0** — vitest + `@testing-library/react` + jsdom infra;
      `apps/console/vitest.config.ts` registered in workspace; 5-layer
      folder scaffold; 6 dep-cruiser rules staged (4 error-level + 2 info).
- [x] **Phase 1** — 9 domain API adapters (satellites, conjunctions, kg,
      findings, stats, cycles, sweep, mission, autonomy) on top of
      `ApiFetcher` port + fetch impl; `createApiClient()` aggregate
      factory; 18 adapter tests.
- [x] **Phase 2** — SSE adapter (`SseClient` + REPL stream parser moved
      from `lib/repl-stream.ts`); renderer adapter (textures + palette
      extracted from `SatelliteField`); propagator adapter (SGP4 + Kepler
      moved from `lib/orbit.ts`); `shared/types/satellite-classification`
      table-driven (replaces 40-entry `startsWith` chain).
- [x] **Phase 3** — 4 React Contexts (`ApiClientContext`,
      `SseClientContext`, `RendererContext`, `PropagatorContext`) + 2
      test scenarios per; `AppProviders` cascade + `buildDefaultAdapters()`
      bootstrap factory; `shared/types/entity-id` single-source-of-truth
      `entityKind()`.
- [x] **Phase 4** — 10 UI primitives moved to `shared/ui/` + barrel;
      generic hooks to `hooks/`; `lib/queries.ts` dissolved into 16
      `usecases/*.ts` consuming `useApiClient()` via Context; `main.tsx`
      wraps router with `AppProviders`.
- [x] **Phase 5** — god-components relocated to `features/*`:
      `ThalamusMode` (763 LOC) → `features/thalamus/Entry`, `OpsMode` + `SatelliteField` + 11 siblings → `features/ops/*`, sweep 6 files
      → `features/sweep/*`, repl → `features/repl/*`, autonomy/config
      → own features. Routes rewired. SweepEntry RTL (3 scenarios) +
      ThalamusEntry smoke.
- [x] **Phase 6** — scoped `uiStore` in `shared/ui/` (rail + drawer are
      the only genuinely cross-feature UI state); bootstrap wiring
      verified.
- [x] **Phase 7** — `lib/` folder deleted (4 shims + 8 utility files
      redistributed); `modes/` and `components/` folders gone;
      dep-cruiser rules flipped to `error` severity;
      `apps/console/README.md` written (layer map + how-to-add guides +
      skill reference).

**Skill** — `~/.claude/skills/coding-feature-vertical-slice/SKILL.md`
landed as the frontend sibling of `coding-route-vertical-slice` (13-step
vertical slice). Auto-memory pointer in
`~/.claude/projects/-home-jerem-interview-thalamus-sweep/memory/`.

**Tests**: 48 passing across 17 files. Zero dep-cruiser violations (666
modules, 2094 edges). Build clean.

## Runtime config registry + 4 LLM providers — 2026-04-19

Previously tracked under TODO "Runtime config registry + admin UI";
phases 1-7 shipped. Remaining knobs tracked in TODO under the same
heading.

- [x] Phase 1 — `RuntimeConfigService` refactored to registry pattern
      (OCP). Schemas no longer live in the service — each package ships
      its own registrar.
- [x] Phase 2 — 6 new domains declared (`thalamus.{planner,cortex,reflexion}`,
      `sim.{swarm,fish,embedding}`).
- [x] Phase 3 — all 4 LLM providers (Local, Kimi, MiniMax, OpenAI) read
      `LlmProviderCallOpts` overrides + honour `preferredProvider` chain
      reordering.
- [x] Phase 4 — MiniMax provider added to the chain.
- [x] Phase 5 — `<think>` leak closed across every provider + `callNano`.
- [x] Phase 6 — Admin `/config` tab with typed field renderers, model
      dropdown with provider auto-sync, left-rail jump-links, scroll
      container.
- [x] Phase 7 — 5 cortex skill `description:` frontmatter rewritten in
      analyst-intent voice so the Kimi planner has a chance to dispatch
      them (Tier 1 of planner-bias fix).

## PG functions pass — 2026-04-19

All 4 steps shipped. Write-up in `CHANGELOG.md` top entry "PG functions:
4 param-drop bugs fixed + conjunction KNN + fleet rollup dedup".

- [x] Step 1 — `ef_search = <ef>` wired into
      `apps/console-api/src/repositories/satellite.repository.ts:114`
      `knnNeighboursForField` (parity with `findKnnCandidates`).
- [x] Step 2 — `packages/db-schema/migrations/0012_orbital_analytics_fns.sql`
      creates `fn_plan_orbit_slots`, `fn_analyze_orbital_traffic`,
      `fn_forecast_debris`, `fn_list_launch_manifest`. Each honest about
      which branches honor `regimeId` via a `branch_filter_applied`
      column. Dead params dropped from Zod + service + repo.
- [x] Step 3 — `packages/db-schema/migrations/0013_conjunction_knn_fn.sql`
      creates `fn_conjunction_candidates_knn` in PL/pgSQL with
      transaction-local `set_config('hnsw.ef_search', …, true)`.
- [x] Step 4 — shared SQL builder
      `apps/console-api/src/repositories/queries/operator-fleet-rollup.ts`
      backs both `FleetAnalysisRepository.analyzeOperatorFleet` and
      `SatelliteFleetRepository.getOperatorFleetSnapshot`. Unified mix
      shape: `Array<{key, count}>` sorted desc, top-5. Dropped dead
      `userId` param.

---

## Sweep agnostic refactor — Plan 1 — 2026-04-18

23 tasks / 7 phases shipped on `refactor/sim-agnostic`. `packages/sweep/` is now a generic sweep/finding engine; all SSA business logic lives in `apps/console-api/src/agent/ssa/sweep/` + console-api's 5-layer stack.

- [x] **Phase 0** — 6 ports in `packages/sweep/src/ports/`, arch-guard skeleton, `BuildSweepOpts.ports?` widened.
- [x] **Phase 1** — SSA pack impls in `apps/console-api/src/agent/ssa/sweep/` (finding-schema, promotion, 5 resolution handlers, audit provider, finding-routing, doctrine-parser, 6 ingesters + provider).
- [x] **Phase 2** — kernel façades: SweepRepository dual API, NanoSweepService.sweep delegates to DomainAuditProvider, SweepResolutionService.resolve delegates to ResolutionHandlerRegistry + SweepPromotionAdapter, IngestionRegistry accepts providers[], FindingRouterService.
- [x] **Phase 3** — console-api wires all 6 ports through buildSweepContainer.
- [x] **Phase 4** — folded 4 audit queries from sweep's SatelliteRepository into console-api's SatelliteRepository; SSA pack rewired.
- [x] **Phase 5** — moved satellite-sweep-chat stack (5 files) + viz stub + satellite-ephemeris.service to console-api.
- [x] **Phase 6** — deleted dead AdminSweepController + admin.routes + stripped sweep index.ts.
- [x] **Phase 7** — arch-guard green (with Plan 2 allowlist), CHANGELOG + TODO updated.

**Full test count**: 652 passing · 23 todo · 0 skipped · 0 failing.

## Sim agnostic refactor — Plan 2 — 2026-04-18 (B.1–B.11 shipped)

- [x] **Scaffolding** — 10 port stubs + SSA sim pack dirs + sim arch-guard.
- [x] **B.1** SimFleetProvider.
- [x] **B.2** SimTurnTargetProvider.
- [x] **B.3** SimAgentPersonaComposer.
- [x] **B.4** SimPromptComposer + SimCortexSelector.
- [x] **B.5** SimActionSchemaProvider.
- [x] **B.6** SimPerturbationPack.
- [x] **B.8** SimAggregationStrategy.
- [x] **B.9** SimKindGuard.
- [x] **B.10** Moved telemetry-swarm + pc-swarm + pc-aggregator + bus-datasheets to console-api SSA pack.
- [x] **B.11** Sim ports required; 7 legacy adapters deleted.

**Newly verified (2026-04-19):**

- [x] `aggregator-telemetry.ts` moved — evidence: `apps/console-api/src/agent/ssa/sim/aggregators/telemetry.ts` exists; source gone from kernel.
- [x] `god-channel.service.ts` moved + `legacy-ssa-schema.ts` + `legacy-ssa-perturbation-pack.ts` deleted — evidence: `apps/console-api/src/services/sim-god-channel.service.ts` present; kernel files absent.

## Thalamus deep audit — 2026-04-17

- [x] Bug #1 — all findings attributed to `plan.nodes[0]`. Fix: `sourceCortex` field stamped in `normalizeFinding`, read by `findingCortex()`. Migration re-tagged 286 historical rows.
- [x] Bug #2 — user-scoped cortices burning DAG slots when no user. Fix: `stripUserScoped()` + `hasUser` threading.
- [x] Bug #3 L1 — silent cortices invisible. Fix: `buildDataGapFinding()` emits `Anomaly` meta-finding when LLM returns 0 from non-empty data.
- [x] Bug #4 — runaway iterations. Coverage metric reads `sourceCortex`; gap-plateau circuit-breaker added.

## Thalamus reliability sweep #2 — 2026-04-17

- [x] Bug #5 — `listLaunchManifest` horizon param never used in SQL + wrong ORDER BY.
- [x] Bug #6 — `listLaunchManifest` UNION column-count mismatch after ITU ingester.
- [x] Bug #7 — planner param-name mismatch. Added `pickNumber()` alias resolver at cortex-data-provider.
- [x] Bug #8 — `findByCycleId(N)` missed re-emissions. Fix: new `research_cycle_finding` junction (migration 0011).
- [x] Bug #9 — semantic dedup collapsed per-launch findings. Fix: skip dedup on entityId=0; require matching findingType.
- [x] Bug #10 — `maxFindings: 5` hardcoded. Now `clamp(authoritativeData.length, 5, 30)`.
- [x] Bug #11 — `repl-chat.service.ts` sliced cycle findings at 8. Bumped to 25.
- [x] Bug #12 — StandardStrategy merged SQL + web-search. Fix: two-tier payload AUTHORITATIVE/WEB CONTEXT.
- [x] Bug #13 — LLM hallucinated mission names. Added MISSION NAME FIDELITY + OPERATOR VS CUSTOMER clauses.
- [x] Bug #14 — NUMERIC FIDELITY rule extended to temporal projections.

## Phase 1 — L2 skill rewrites

- [x] launch-scout.md — one-per-row pattern, confidence tiers.
- [x] debris-forecaster.md — density 0.7, paper/news lower-tier, empty sentinel 0.7.
- [x] apogee-tracker.md — satellite snapshot 0.7, slope-based rules.
- [x] Verified end-to-end: cycle 299 produced 15 findings vs 0 in cycle 298.

## Phase 2 — L3 ingestion worker harness

- [x] `ingestionQueue` + `ingestionQueueEvents` added.
- [x] `ingestion.worker.ts` dispatcher.
- [x] `IngestionRegistry` + `createIngestionRegistry()`.
- [x] `schedulers.ts` extended with `ingestion-noop` cron.
- [x] Worker booted from `container.ts`; `IngestionService` exposed.
- [x] `routes/ingestion.routes.ts` — `POST /api/ingestion/run/:jobName` + `GET /api/ingestion/jobs`.
- [x] Verified: `GET /api/ingestion/jobs` → `{"jobs":["noop"]}`; `POST /api/ingestion/run/noop` → enqueue + 2 ms worker.

## Phase 3 — L3 ingesters (3a–3f all shipped)

- [x] **3a** TLE history time-series — `tle_history` table (migration 0005), 40 CelesTrak GP groups every 6 h, 2369 TLEs on first run.
- [x] **3b** Space weather — NOAA SWPC + GFZ Potsdam + SIDC/STCE into `space_weather_forecast` table (migration 0006), 59 rows first fetch.
- [x] **3c** Launch manifest enrichment — Launch Library 2 every 12 h, 100 launches from 9 countries on first fetch.
- [x] **3d** NOTAMs — FAA TFR every 6 h, 90 TFRs ingested on first run.
- [x] **3e** Fragmentation events — curated seed of 20 major events, 4 operator countries.
- [x] **3f** ITU filings — curated seed of 15 mega-constellations, 416,150 total planned sats.

## Extraction

- [x] pnpm workspace + 4 packages (shared, db-schema, thalamus, sweep).
- [x] Extracted shared (utils, types, enums, normalizers, observability).
- [x] Extracted db-schema (Drizzle + query helpers).
- [x] Extracted thalamus (cortices, orchestrator, explorer/nano-swarm, 20 skills).
- [x] Extracted sweep (nano-sweep, resolution, editorial copilot, admin routes).
- [x] Rewrote imports to `@interview/*`.
- [x] Stubbed downstream services.
- [x] Stubbed Redis, auth, messaging, DI infra.
- [x] Trimmed admin routes to sweep-only.
- [x] Trimmed BullMQ queues/schedulers to sweep-only.
- [x] Sanitized client-specific identifiers.
- [x] README with CortAIx + Threat Intel transposition.

## Spec-first workflow

- [x] LaTeX scaffolding (preamble, template, Makefile).
- [x] Custom envs + Given/When/Then/And macros.
- [x] 24 retroactive specs written by 10 parallel opus agents.
- [x] Preamble compilation fixes.
- [x] All 24 PDFs compile.

## console-api 5-layer refactor — done 2026-04-16

- [x] Decompose `server.ts` 2001 → 61 lines — routes/controllers/services/repositories/types/utils/prompts.
- [x] Hoist shared DTO helpers to `packages/shared/src/ssa/`.
- [x] Tighten repository id signatures to `bigint`.
- [x] `StatsService.snapshot` parallelises 3 count queries.
- [x] Composition root in `container.ts` (134 lines).
- [x] vitest workspace picks up `packages/*/src/**/*.test.ts`.
- [x] All 4 integration specs green. Final: 385 passed / 23 todo.
- [x] Transformers layer — 5 modules, 51 new pure-function tests.

## Domain pivot to SSA — done 2026-04-13

- [x] Rename schema (wine.ts → satellite.ts).
- [x] Rewrite 22 cortex skill prompts.
- [x] Rename sql-helpers + 7 source fetchers.
- [x] Orchestrator: cortex registry, executor, guardrails, dynamic SQL_HELPER_MAP, 30 SSA RSS feeds.
- [x] Thalamus services/utils/explorer rewritten.
- [x] Sweep package: wine* → satellite*; editorial → briefing; cdc → doctrine.
- [x] `grape-profile.schema.ts` → `payload-profile.schema.ts`.
- [x] Removed 3 compat shims.
- [x] Zero wine/grape/vintage/appellation/terroir references remain.

## Priority 1 — CLI foundation — DONE 2026-04-14

Shipped as `@interview/cli` via 22-task TDD plan. 46 specs green.

- [x] `pnpm run ssa` entrypoint — two-lane router.
- [x] Commands: query, telemetry, logs, graph, accept, explain.
- [x] Source-class color bar + confidence sparkline + cost dial + rolling ETA.
- [x] Animated emoji logs + ASCII satellite loader.
- [x] 6 renderers.
- [x] Memory buffer + palace (`sim_agent_memory` HNSW).
- [x] `analyst_briefing` + `interpreter` cortex skills.
- [x] E2E happy-path test.

## Priority 4 — Debris ingestion — DONE 2026-04-15

504 payloads → **33,564 objects**. Voyage embeddings + HNSW cosine index. KNN-based conjunction candidate cortex wired.

- [x] `satellite.object_class` text + CHECK constraint.
- [x] `seed/populate-space-catalog.ts` — CelesTrak SATCAT ingestion.
- [x] `seed/enrich-gcat.ts` — 20.5k mass + 20.2k bus backfilled.
- [x] `seed/screen-broadphase.ts` — 542 M pairs → 145 M in 32 s.
- [x] `seed/screen-narrow-phase.ts` — SGP4 + Foster-1992 Pc.
- [x] `seed/embed-catalog.ts` — 33,564 objects in 3 m 39 s ($0.08).
- [x] `thalamus/cortices/queries/conjunction-candidates.ts` + skill — auto-discovered (28 skills).
- [x] CLI `/candidates <norad>` — 55/55 tests green.

## Priority 6 — OPS globe — done 2026-04-16

- [x] `packages/shared/src/ssa/conjunction-view.ts` — Zod schema + helpers.
- [x] `GET /api/conjunctions` joins satellite rows, derives regime/covarianceQuality/action.
- [x] `conjunctions.spec.ts` — integration test.
- [x] `apps/console/src/lib/orbit.ts` — `orbitRing(s, n=128)` sampler.
- [x] `OrbitTrails.tsx` — hybrid renderer.
- [x] `ConjunctionMarkers.tsx` — severity sprites + info card portal.
- [x] Hover wiring in `ConjunctionArcs.tsx`.
- [x] `apps/` unignored.

## Priority 5 — Enrichment pipeline + KG bridge — done 2026-04-16

### Sweep mission — hardened

- [x] Structured-outputs JSON schema on gpt-5.4-nano `/v1/responses`.
- [x] Hedging-token post-hoc blocklist.
- [x] Source validation against `web_search` URL list.
- [x] Range guards per column.
- [x] Unit mismatch check.
- [x] 2-vote corroboration ±10 %.
- [x] `object_class='payload'` filter.
- [x] Per-satellite granularity.

### KNN propagation — zero-LLM

- [x] `POST /api/sweep/mission/knn-propagate`.
- [x] Consensus rule: numeric median ±10 %, text mode ≥⅔.
- [x] Range guards on neighbour values.
- [x] UI: LAUNCH FISH MISSION button.

### Enrichment findings — KG bridge

- [x] `emitEnrichmentFinding()` from both fill paths.
- [x] `research_edge` rows (about + similar_to).
- [x] Feedback loop: enrichment push to `sweep:feedback`.
- [x] Lazy long-running cycle persists findings.
- [x] Every PG param cast explicitly.

### Orbital reflexion pass

- [x] `POST /api/sweep/reflexion-pass` — 2 SQL cross-tabs.
- [x] MIL-lineage name-match.
- [x] Emits anomaly finding with urgency=high when MIL-peers ≥ 1.
- [x] Live verified on FENGYUN 3A.

### Autonomy controller

- [x] `POST /api/autonomy/start|stop|status`.
- [x] UI topbar AUTONOMY pill + FEED panel.
- [x] Briefing mode dropped from rotation.

### Catalog gap-fill — heuristic

- [x] `seed/fill-catalog-gaps.ts` — 500/504 regime, 504/504 tier, 504/504 experimental.

### REPL chat → real Thalamus dispatch

- [x] `/api/repl/chat` classifier dispatches Thalamus on cycle intent.
- [x] Command palette bare text falls through to REPL chat.

### Tests — 13/13 integration specs green

- [x] `sweep-mission.spec.ts` (6).
- [x] `knn-propagation.spec.ts` (5).
- [x] `enrichment-findings.spec.ts` (1).
- [x] `sweep:index:pending` snapshot/restore isolation.

## Multi-agent simulation swarm — Phases 1–7

Newly verified (2026-04-19): `packages/db-schema/src/schema/sim.ts` has sim_swarm/sim_run/sim_agent/sim_turn/sim_agent_memory tables; routes + services + swarms + aggregators shipped; `swarm-uc3.e2e.spec.ts` exists.

- [x] Phase 1 — DB schema.
- [x] Phase 2 — Types, Zod schemas, agent-builder, memory service.
- [x] Phase 3 — Shared `sim_operator_agent` cortex + DAG + Sequential drivers.
- [x] Phase 4 — Per-fish orchestrator.
- [x] Phase 4.5 — Swarm service + perturbation generators + aggregator + quorum.
- [x] Phase 5 — `sim_reporter` + `sim_swarm_reporter` skills + promotion to suggestion.
- [x] Phase 6 — Auto-spawn from conjunction findings, `/admin/swarm/*` routes, chat scope.
- [x] Phase 7 — Demos `swarm-uc3.ts` / `swarm-uc1.ts` + Makefile + fixtures.

## Pre-commit + CI — native hook

- [x] `.githooks/pre-commit` — blocks `.env*` staged → typecheck → spec:check → test. Installed via `pnpm hooks:install`.

## Build cleanup

- [x] Added `packages/sweep/package.json` + `tsconfig.json`.
- [x] `pnpm -r typecheck` passes on 7 workspace projects.
- [x] Drizzle `using/op` index resolved via raw SQL migration (0001_hnsw_index.sql, 0002_embedding_2048.sql).
- [x] **(2026-04-19)** Removed unused `csv-reader.ts` / `pdf-table-reader.ts` from shared — neither file exists in `packages/shared/src/`.

## Docs (base set)

- [x] README.md — system overview + CortAIx framing + Threat Intel transposition.
- [x] TODO.md maintained.
- [x] CHANGELOG.md — extraction history.
- [x] `docs/specs/` — 24 LaTeX specs.

## Strategic tests — shared (verified 2026-04-19)

- [x] `tryAsync` tuple semantics.
- [x] `AppError` hierarchy + structured-cause serialization.
- [x] Domain normalizers — edge cases.
- [x] `completeness-scorer` adaptive weight normalization.

Evidence: all four specs in `packages/shared/tests/`.

## Spec tests — shared / db-schema / thalamus (verified 2026-04-19)

### shared

- [x] `tests/try-async.spec.ts` — SPEC-SH-001.
- [x] `tests/app-error.spec.ts` — SPEC-SH-002.
- [x] `tests/completeness-scorer.spec.ts` — SPEC-SH-003.
- [x] `tests/domain-normalizer.spec.ts` — SPEC-SH-004.
- [x] `tests/logger.spec.ts` + `tests/metrics.spec.ts` — SPEC-SH-005.

### db-schema

- [x] `tests/schema-contract.spec.ts` — SPEC-DB-001.
- [x] `tests/typed-repos.spec.ts` — SPEC-DB-002.

### thalamus

- [x] `tests/orchestrator.spec.ts` — SPEC-TH-001.
- [x] `tests/cortex-registry.spec.ts` — SPEC-TH-002.
- [x] `tests/cortex-pattern.spec.ts` — SPEC-TH-003.
- [x] `tests/nano-swarm.spec.ts` — SPEC-TH-010.
- [x] `tests/source-fetchers.spec.ts` — SPEC-TH-011.
- [x] `tests/curator.spec.ts` — SPEC-TH-012.
- [x] `tests/guardrails.spec.ts` — SPEC-TH-020.
- [x] `tests/knowledge-graph-write.spec.ts` — SPEC-TH-030.
- [x] `tests/skills-as-files.spec.ts` — SPEC-TH-031.
- [x] `tests/dual-stream-confidence.spec.ts` — SPEC-TH-040.
- [x] `tests/field-correlation.spec.ts` — SPEC-TH-041.
