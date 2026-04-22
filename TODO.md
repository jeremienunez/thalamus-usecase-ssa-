# TODO

Portfolio-readiness checklist for Thalamus + Sweep.

**Audited 2026-04-19** — the old 823-line list was split three ways:

- [DONE.md](DONE.md) — shipped & verified (149 `[x]` items + 8 newly-verified unchecked)
- [TO-REVIEW.md](TO-REVIEW.md) — partially landed, needs human triage (7 items)
- This file — genuinely open + non-code interview prep

---

## 🔎 Review checklist — 2026-04-19 session (9 fixes to commit)

Audit + quick-wins landed. All changes non-destructive, typecheck 7/7, 652 unit tests passing. Review checklist before commit/PR:

- [ ] **Read** `docs/refactor/architecture-audit-2026-04-19.md` (Pass 1 + Pass 2) — the full audit with file:line refs. Entry in `docs/refactor/INDEX.md` #0 + new "Architecture audit" section.
- [ ] **Read** `CHANGELOG.md` top entry "Architecture audit 2026-04-19 + 9 fixes landed".
- [ ] **Diff** the following files (grouped by concern):

**Dead-code surgery (C3):**

- `packages/thalamus/src/index.ts` — removed 2 re-exports L71-73 + fixed `ver` typo L1
- `packages/thalamus/src/controllers/` — directory deleted (1 file, 188 L)
- `packages/thalamus/src/routes/` — directory deleted (1 file, 81 L)

**Dead stack remount (C5):**

- `apps/console-api/src/container.ts` — 6 new imports + `SatelliteSweepChatRepository` → `Service` → `Controller` chain constructed; `satelliteSweepChat` added to `AppServices`
- `apps/console-api/src/routes/index.ts` — `app.register` wrapper for `satelliteSweepChatRoutes` with `{prefix:"/api/satellites"}`

**Barrel hygiene (I4):**

- `packages/thalamus/src/index.ts` — promoted 10 symbols (setters + Nano\* types + Lens/Profile/ExplorationQuery/DEFAULT_NANO_SWARM_PROFILE)
- `apps/console-api/src/container.ts` + `services/satellite-sweep-chat.service.ts` + `prompts/nano-swarm-ssa.prompt.ts` + `agent/ssa/sweep/audit-provider.ssa.ts` — 4 consumers migrated off deep-paths

**Composition root cleanup (I3):**

- `apps/console-api/src/container.ts` — `sweepRepoHolder` replaces the `as unknown as` double-cast (~L265 + L280)

**SSE safety (C6):**

- `apps/console-api/src/controllers/repl.controller.ts` — AbortController + `reply.raw.on("close")` + `off` cleanup
- `apps/console-api/src/controllers/satellite-sweep-chat.controller.ts` — same
- `apps/console-api/src/services/repl-chat.service.ts` — `signal?: AbortSignal` param + `aborted()` checks at 6 points
- `apps/console-api/src/services/satellite-sweep-chat.service.ts` — same, 7 checkpoints
- `apps/console-api/tests/unit/controllers/repl.controller.test.ts` — 2 assertions updated for 3rd `AbortSignal` arg

**Lifecycle (C7 + I7):**

- `apps/console-api/src/server.ts` — new `app.addHook("onClose", ...)` stopping mission + autonomy timers
- `apps/console-api/src/services/mission.service.ts` — added `catch(err)` with logger.error in `tick()`

**Frontend polling (I12):**

- `apps/console/src/lib/queries.ts` — `useMissionStatus` + `useAutonomyStatus` `refetchInterval` gated on `q.state.data?.running`

**Concurrency cap (I10):**

- `packages/shared/src/utils/concurrency.ts` — new `mapWithConcurrency<T,R>` helper
- `packages/shared/src/utils/index.ts` — export
- `packages/shared/tests/concurrency.spec.ts` — 6 unit tests
- `packages/sweep/src/sim/memory.service.ts` + `packages/sweep/src/sim/aggregator.service.ts` — consume the helper with `EMBED_CONCURRENCY = 8`

**Verification command to re-run before commit:**

```
pnpm -r typecheck && pnpm test:unit && (cd apps/console-api && npx vitest run tests/unit)
```

### Runtime config registry + admin UI — 2026-04-19 (session 3)

Phases 1-7 shipped — moved to [DONE.md](DONE.md#runtime-config-registry--4-llm-providers--2026-04-19).

**Still open from this pass**:

- [ ] Wire `sim.swarm` into `packages/sweep/src/sim/swarm.service.ts`
      (`defaultFishConcurrency`, `defaultQuorumPct` currently ignored
      — only the zod schema on swarmConfigSchema reads analogous
      defaults). Touch point: `sim-orchestrator.service.ts:100-104`
      where `quorumPct: 1.0` / `fishConcurrency: 1` are hardcoded.
- [ ] Wire `sim.embedding.embedConcurrency` into
      `packages/sweep/src/sim/memory.service.ts:21` and
      `aggregator.service.ts:23` where `const EMBED_CONCURRENCY = 8`
      is still hardcoded.
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
Three items remain open from this section.

- [ ] **OpsEntry RTL** — global `vi.mock("sigma")` +
      `vi.mock("graphology-layout-forceatlas2")` already in
      `tests/setup.ts`; need the equivalent for `@react-three/fiber`
      (or adopt `@react-three/test-renderer`) + cover the golden path + one edge case per feature.
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
- Important: I1 sim-swarm-store raw db · I2 CLI boot.ts direct Drizzle · I5 sweep→thalamus coupling · I6 duplicate port declarations · I8 20+ env reads in kernel · I9 swarm race · I11 `@interview/sweep` barrel split
- Minor: M1–M10 (absorb into normal iteration)

---

## REPL verification / follow-up — 2026-04-19

- [x] **Package de-domainization landed** — `packages/thalamus` now emits
      only generic verification signals (`reasonCodes` + entity hints),
      and `packages/shared` no longer exposes SSA-specific follow-up
      target fields. SSA follow-up kinds live only in
      `apps/console-api/src/agent/ssa/followup/`.
- [ ] **Front render of `followup.*` events** — wire the console REPL UI to
      attach child follow-ups under the parent turn and render
      `followup.plan`, `followup.started`, `followup.step`,
      `followup.finding`, `followup.summary`, `followup.done`.
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

- [x] **C3 (DONE 2026-04-19)** — removed `packages/thalamus/src/controllers/` + `packages/thalamus/src/routes/` directories + exports from `packages/thalamus/src/index.ts:71-73`. Verified: `pnpm -r typecheck` green (7/7), 332 package unit tests + 314 console-api unit tests passing, zero regression.
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

- [x] **I1 (DONE 2026-04-22)** — moved raw `db.transaction()` / `db.update(simSwarm)` / `db.execute(sql)` out of `apps/console-api/src/services/sim-swarm-store.service.ts` into `SimSwarmRepository.abortSwarm`, `SimSwarmRepository.snapshotAggregate`, and `SimSwarmRepository.closeSwarm`. Added repo integration coverage for the atomic abort cascade and config snapshot writes.
- [ ] **I2** — `packages/cli/src/boot.ts:270-279, 385-405, 415-423` — finish migration; delete direct Drizzle reads of `research_edge`, `research_finding`, `research_cycle`, `source_item`; route through `/api/findings`, `/api/kg/neighbourhood`, `/api/why`.
- [x] **I3 (DONE 2026-04-19)** — replaced the `as unknown as {...}` double-cast in `apps/console-api/src/container.ts` with a typed `sweepRepoHolder: { loadPastFeedback: () => Promise<SuggestionFeedbackRow[]> }`. Same object ref is passed to `SsaAuditProvider` and rebound after `buildSweepContainer` resolves — no private-field reach, no casts. Pre-wire call throws a clear error so the cycle mistake is loud in dev.
- [x] **I4 (DONE 2026-04-19)** — promoted `setNanoConfigProvider`, `setNanoSwarmConfigProvider`, `setNanoSwarmProfile`, `setCuratorPrompt`, `DEFAULT_NANO_SWARM_PROFILE`, `Lens`, `NanoSwarmProfile`, `ExplorationQuery`, `NanoRequest`, `NanoResponse` to `packages/thalamus/src/index.ts` barrel. Migrated all 4 consumers (`container.ts`, `satellite-sweep-chat.service.ts`, `nano-swarm-ssa.prompt.ts`, `audit-provider.ssa.ts`) to barrel imports. Verified: zero `@interview/thalamus/...` deep paths in `**/src/**`, typecheck 7/7, 332+314 unit tests pass.
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

- [x] **C5 (DONE 2026-04-19 — chose remount)** — sweep-chat stack rewired in `apps/console-api/src/container.ts` (`SatelliteSweepChatRepository` + `SatelliteSweepChatService` + `SatelliteSweepChatController` construction, `VizService`+`SatelliteService` stubs injected); `apps/console-api/src/routes/index.ts` mounts via `app.register(async scope => satelliteSweepChatRoutes(scope, s.satelliteSweepChat), {prefix:"/api/satellites"})`. Routes exposed: `POST /api/satellites/:id/sweep-chat` (SSE stream) + `GET /api/satellites/:id/sweep-chat/state`. Auth scoped (`authenticate` + `requireTier`) inside the sub-plugin — no leakage to sibling routes. **Follow-up TODO**: (1) front-end UI (no `useSweepChat` query exists yet in `apps/console`), (2) C6 AbortSignal plumbing also applies to this controller's SSE loop.
- [x] **C6 (DONE 2026-04-19)** — `apps/console-api/src/controllers/repl.controller.ts` and `.../satellite-sweep-chat.controller.ts` both wire an `AbortController` subscribed to `reply.raw.on("close")`. `ReplChatService.handleStream` and `SatelliteSweepChatService.chat` now accept `signal?: AbortSignal`, check `aborted()` before every new LLM/cortex/embed call and at every yield boundary. Result: a client disconnect stops new token spend within one generator step. Updated `tests/unit/controllers/repl.controller.test.ts` to assert the 3rd `AbortSignal` arg.
- [x] **C7 (DONE 2026-04-19)** — added `app.addHook("onClose", ...)` in `apps/console-api/src/server.ts` after `registerAllRoutes` (L237-243) that calls `container.services.mission.stop()` + `container.services.autonomy.stop()`. Timers now cleared on Fastify shutdown.

### Important

- [x] **I7 (DONE 2026-04-19)** — `apps/console-api/src/services/mission.service.ts` tick() now has `catch (err)` block that increments `errorCount` and logs `{err, suggestionId, satelliteId}` via the injected Fastify logger. No more unhandled rejections from `runTask` failures.
- [x] **I8 (DONE 2026-04-22)** — eliminated `process.env` reads from `packages/thalamus/src/**` by adding a dedicated `ThalamusTransportConfig` provider (`packages/thalamus/src/config/transport-config.ts`) and seeding it from `apps/console-api/src/server.ts` into the container at boot. `nano-caller`, fixture/mode-aware transports, and provider backends now read injected config instead of env globals; grep confirms zero `process.env` references remain under `packages/thalamus/src`.
- [ ] **I9 — race on `SwarmService.onFishComplete`** — `packages/sweep/src/sim/swarm.service.ts:143-153` check-then-enqueue. BullMQ `jobId` dedup masks it today but contract lives in queue, not data. Move gate to atomic Redis `INCR`/`SETNX` or PG `UPDATE sim_swarm SET aggregated=true WHERE id=$1 AND aggregated=false RETURNING *`.
- [x] **I10 (DONE 2026-04-19)** — added `mapWithConcurrency<T,R>` helper in `packages/shared/src/utils/concurrency.ts` (order-preserving, cap-respecting, 6 unit tests covering edge cases). Replaced unbounded `Promise.all` at `packages/sweep/src/sim/memory.service.ts:writeMany` and `packages/sweep/src/sim/aggregator.service.ts` batch-embed with `mapWithConcurrency(..., 8, ...)`. No new npm dep.
- [ ] **I11 — `packages/sweep/src/index.ts` barrel bloat (fan-out 56, ~25 unused externally)** — grep-verified zero external imports for: `cosineKMeans`, `rngFromSeed`, `applyPerturbation`, `buildSimAgent`, `SequentialTurnRunner`, `DagTurnRunner`, `MemoryService`, `AggregatorService`, `FindingRouterService`, `MessagingService`, `NanoSweepService`, worker factories, `isKgPromotable`, `isTerminal`, `SimOrchestrator` class. Move to `packages/sweep/src/internal.ts` consumed by `config/container.ts`; barrel stays ~20.
- [x] **I12 (DONE 2026-04-19)** — `useMissionStatus` + `useAutonomyStatus` in `apps/console/src/lib/queries.ts` now use `refetchInterval: (q) => q.state.data?.running ? <ms> : false`. Idle dashboards poll 0× per minute (was 24 + 20).

### Minor

- [ ] **M5** — `packages/thalamus/src/repositories/research-edge.repository.ts:31-38` — 8-line `void <import>` tree-shake hack. Either use `sql\`${tableName}\`` with imports or drop the imports (tsc doesn't tree-shake; bundler drops side-effect-free imports anyway). Also another C4 instance (thalamus knows SSA tables).
- [ ] **M6** — `apps/console-api/src/server.ts:43` — `process.env.SIM_KERNEL_SHARED_SECRET ??= "interview-local-kernel-secret"` mutates global `process.env` at boot. Move default to config object.
- [ ] **M7** — `apps/console-api/src/transformers/sim-fleet.transformer.ts:1` + `sim-target.transformer.ts:5` — transformers import service-layer types. Move types to `types/` to clean the layer.
- [ ] **M8** — `packages/sweep/src/repositories/sweep.repository.ts:179,362` — `zrevrange(IDX_ALL, 0, -1)` unbounded. Apply `opts.limit` to the range call when `reviewed !== false`; sample for `getStats`.
- [ ] **M9** — `apps/console-api/src/repositories/sim-memory.repository.ts:50-71` — N+1 inside transaction: loop of single-row `.insert().values().returning()`. Replace with batch `.insert(table).values(inserts).returning()`.
- [ ] **M10** — `packages/cli/src/boot.ts:155-156` — `.catch(() => undefined)` on shutdown swallows pool/Redis close errors silently in prod. Log at warn.

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

- [ ] `pnpm -r typecheck` → `pnpm -r lint` → `pnpm -r test --coverage` → `make -C docs/specs all` → `tsx scripts/spec-check.ts` — only `arch-check.yml` exists today.
- [ ] 100% coverage gate on `shared`; pyramidal 70/25/5 on thalamus + sweep.
- [ ] Coverage artifacts published per PR.

## Build cleanup

- [ ] `pnpm -r build` passes (only `apps/console/package.json` has a build script today).

## console-api 5-layer — code-review follow-ups

- [ ] Redact error messages from `asyncHandler` before sending to client in prod.
- [ ] Tighten `satellitesController` to validate `regime` via `RegimeSchema.safeParse`.
- [ ] Reshape `ConjunctionViewService.list(minPc)` to options-object for symmetry.
- [ ] Split `findingDecisionController`'s `"invalid"` sentinel into `"invalid-id"` vs `"invalid-decision"`.
- [ ] De-dup `entityRef` between `kg-view.transformer` and `finding-view.transformer` (import the kg-view one from finding-view).
- [ ] `MissionService` start/stop race — add generation counter to prevent concurrent ticks from rapid start/stop cycles.

## console-api — test surface gaps

- [ ] **Unit test `ReflexionService`** (299 L) — two emit branches, 4 SQL call sites, HttpError throw paths.
- [ ] **Unit test `MissionService`** (266 L) — state machine; cover publicState, start/stop idempotence, tick advancement, runTask 2-vote consensus, applyFill range-guard rejection.
- [ ] **Unit test `KnnPropagationService`** (186 L) — median-within-10% numeric consensus, mode-≥2/3 text consensus, tooFar / disagree / outOfRange bucket accounting, dryRun short-circuit.
- [ ] **Integration spec repos** against live Postgres: `finding.repository.spec.ts`, `research-edge.repository.spec.ts`, `reflexion.repository.spec.ts`, `stats.repository.spec.ts`.
- [ ] Remaining services without unit tests: `KgViewService`, `StatsService`, `EnrichmentFindingService`, `NanoResearchService`, `ReplChatService`, `ReplTurnService`, `SweepSuggestionsService` (verify), `AutonomyService` (verify clamp/NaN).
- [ ] e2e gap: add smoke specs for `/api/satellites`, `/api/kg/{nodes,edges}`, `/api/findings`, `/api/stats`, `/api/sweep/suggestions`, `/api/sweep/reflexion-pass`, `/api/autonomy/*`, `/api/cycles/*`, `/api/repl/*`.
- [ ] Schema tests — `schemas/*.schema.ts` — assert strict rejection, clamp acceptance, `.finite()` rejections.
- [ ] Controller-layer tests — 0 exist today. Parse→service→response contract with mocked services.
- [ ] Add `pnpm test:coverage` + codecov-style report; target ≥80% services/transformers/utils, ≥70% overall.

## Strategic tests — db-schema

- [ ] Typed query helpers against a fresh pg instance (smoke).
- [ ] Schema migration round-trip.

## Strategic tests — sweep

- [ ] `nano-sweep.service` emits findings shape expected by `finding-routing`.
- [ ] `resolution.service` applies accepted suggestion in a transaction, writes audit row.
- [ ] Feedback loop: reject → next-run prompt includes rejection signal.
- [ ] Rate-limit + dedupe in the chat repository.

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
