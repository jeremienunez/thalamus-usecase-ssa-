# Architecture audit — 2026-04-19

Source: superpowers:code-reviewer deep audit against `CLAUDE.md` invariants (single-contract, no private bypass, kernel agnosticity, SOLID).

**Verdict:** structurally ambitious hexagonal skeleton — ports, adapters, HTTP in-process transport, centralized composition root — but **not refactor-complete** per `CLAUDE.md §6`: four Critical `§3.2` / `§1-2` / agnosticity breaches remain.

See [INDEX.md](./INDEX.md) for broader refactor landscape.

---

## Strengths (confirmed)

- Centralized composition root — every `new *Repository(...)` confined to [apps/console-api/src/container.ts#L169-L276](../../apps/console-api/src/container.ts#L169-L276).
- In-process HTTP transport via `app.inject` — [apps/console-api/src/infra/sim-route-transport.ts](../../apps/console-api/src/infra/sim-route-transport.ts). True single-contract for the sim boundary.
- 15 sim ports + 8 HTTP adapters in [packages/sweep/src/sim/ports/](../../packages/sweep/src/sim/ports). Textbook ISP + OCP.
- Zero `packages/* → apps/*` static imports (grep-verified).
- `ConfigProvider<T>` DIP pattern — [packages/thalamus/src/explorer/nano-swarm.ts#L43-L50](../../packages/thalamus/src/explorer/nano-swarm.ts#L43-L50).
- 30+ narrow `*Port` interfaces declared on consumer side (e.g. [knn-propagation.service.ts](../../apps/console-api/src/services/knn-propagation.service.ts), [reflexion.service.ts](../../apps/console-api/src/services/reflexion.service.ts)) — textbook Hexagonal.
- `Pick<Repository, "methodA" | "methodB">` narrowing — [sim-turn.service.ts#L8-L24](../../apps/console-api/src/services/sim-turn.service.ts#L8-L24).
- Sweep kernel is fully domain-agnostic — zero `satellite|conjunction|orbit|norad` hits in `packages/sweep/src/`.

---

## 🚨 CRITICAL — blocks "refactor complete" per CLAUDE.md §6

### C1. Triple write path to thalamus-owned tables (CLAUDE.md §3.2 — "no second contract")

`research_finding`, `research_edge`, `research_cycle` are written by **three** independent code paths:

| Writer              | File                                                                                                                                         | Lines                                                                                                               |
| ------------------- | -------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------- |
| Kernel (legitimate) | [packages/thalamus/src/repositories/research-finding.repository.ts](../../packages/thalamus/src/repositories/research-finding.repository.ts) | whole file (309 L)                                                                                                  |
| App-side parallel   | [apps/console-api/src/repositories/finding.repository.ts](../../apps/console-api/src/repositories/finding.repository.ts)                     | `insert` L142-162, `updateStatus` L46-57                                                                            |
| App-side parallel   | [apps/console-api/src/repositories/research-edge.repository.ts](../../apps/console-api/src/repositories/research-edge.repository.ts)         | `insert` L96-102                                                                                                    |
| Raw-DB god-service  | [apps/console-api/src/services/sim-promotion.service.ts](../../apps/console-api/src/services/sim-promotion.service.ts)                       | L125-145, L159-193, L201-204, L215-218 — direct `this.deps.db.insert(researchCycle\|researchFinding\|researchEdge)` |

**Fix — option A (fast):** delete `FindingRepository.insert`/`.updateStatus` + `ResearchEdgeRepository.insert`; route app writes through the kernel `ResearchFindingRepository` / `ResearchEdgeRepository` accessed via the already-injected `ThalamusContainer`.

**Fix — option B (clean, preferred per §1):** expose `POST /api/findings` + `PATCH /api/findings/:id/status` + `POST /api/research-edges`; have kernel + app + CLI all go through HTTP.

### C2. `sim-promotion.service.ts` — 511-line god-service with raw DB handle

[apps/console-api/src/services/sim-promotion.service.ts](../../apps/console-api/src/services/sim-promotion.service.ts):

- **SRP**: promotes swarms + creates cycles + creates findings + creates edges + links swarm outcomes + emits sweep suggestions + runs telemetry-specific aggregation. ≥4 reasons to change.
- **DIP**: takes `db: NodePgDatabase<typeof schema>` as constructor dep (L52) and calls `.insert(researchCycle)`, `.insert(researchFinding)`, `.insert(researchEdge)`, `.update(researchCycle)` inline.

**Fix:** inject `CyclesPort`, `FindingsWritePort`, `EdgesWritePort`, `SuggestionsPort`. No raw `db` handle. Split internals into `SwarmOutcomePromoter` + `ModalPromotionComposer` + `TelemetryScalarPromoter` along the 3 promotion flavors.

### C3. Thalamus ships dead Fastify routes (CLAUDE.md §1-2 — "app owns HTTP")

[packages/thalamus/src/controllers/thalamus.controller.ts](../../packages/thalamus/src/controllers/thalamus.controller.ts) (188 L) + [packages/thalamus/src/routes/thalamus.routes.ts](../../packages/thalamus/src/routes/thalamus.routes.ts) (81 L) declare a full HTTP surface: `/research`, `/findings`, `/findings/:id`, `/cycles`, `/knowledge-graph`, `/graph/:type/:id`, DELETE `/findings/:id`.

**Exported** from [packages/thalamus/src/index.ts#L72-L73](../../packages/thalamus/src/index.ts#L72-L73). **Never mounted** in [apps/console-api/src/server.ts](../../apps/console-api/src/server.ts) or [apps/console-api/src/routes/index.ts](../../apps/console-api/src/routes/index.ts).

**Fix:** pure delete. Remove `controllers/`, `routes/` directories and their barrel exports. Zero behavior change.

### C4. Thalamus kernel is **not** domain-agnostic (breaks "base agnostique pas absente")

Hard-coded SSA/space domain inside the kernel:

- [packages/thalamus/src/utils/satellite-entity-patterns.ts](../../packages/thalamus/src/utils/satellite-entity-patterns.ts) — NORAD / COSPAR / Falcon / LEO / GEO / ESA / JAXA regex. Imported **inside the core crawler** at [explorer/nano-swarm.ts#L26-L28](../../packages/thalamus/src/explorer/nano-swarm.ts#L26-L28), used L279 + L304.
- [packages/thalamus/src/cortices/sources/](../../packages/thalamus/src/cortices/sources) — 13 domain-specific fetchers: `fetcher-celestrak`, `fetcher-ntrs`, `fetcher-orbit-regime`, `fetcher-space-weather`, `fetcher-launch-market`, `fetcher-bus-archetype`, `fetcher-spectra`, `fetcher-seesat`, `fetcher-spacetrack-diff`, …
- [packages/thalamus/src/prompts/opacity-scout.prompt.ts](../../packages/thalamus/src/prompts/opacity-scout.prompt.ts) — "opacity" is an SSA concept.

Setter ports (`setNanoSwarmProfile`, `setCuratorPrompt`) exist but are undermined by direct imports of `extractSatelliteEntities` inside the same kernel module.

**Fix:**

1. Move `utils/satellite-entity-patterns.ts` + all `cortices/sources/fetcher-*.ts` + `prompts/opacity-scout.prompt.ts` to `apps/console-api/src/agent/ssa/thalamus-pack/`.
2. Introduce `EntityExtractorPort` in thalamus, injected from console-api at boot (follow the `setNanoSwarmProfile` pattern).
3. Replace direct calls in `nano-swarm.ts:279,304` with port calls.

---

## 🔴 IMPORTANT

### I1. `sim-swarm-store.service.ts` mixes raw `db` writes with repo reads

[apps/console-api/src/services/sim-swarm-store.service.ts#L56-L71](../../apps/console-api/src/services/sim-swarm-store.service.ts#L56-L71) uses `this.db.transaction()` + `db.update(simSwarm)` directly despite `SimSwarmRepository` being a dep. L102-112 does `db.execute(sql\`UPDATE sim_swarm ...\`)`. L135-138 does `db.update(simSwarm)`. Same DIP leak as C2 at smaller scale.

**Fix:** promote these mutations to `SimSwarmRepository` / `SimRunRepository` methods; remove the raw `db` handle from the service.

### I2. CLI `boot.ts` opens a private DB contract parallel to console-api

[packages/cli/src/boot.ts#L270-L279, L385-L405, L415-L423](../../packages/cli/src/boot.ts#L270-L279) reads `research_edge`, `research_finding`, `research_cycle`, `source_item` directly via Drizzle. `candidates.propose` (L342-354) already routes through console-api HTTP — partial migration.

**Fix:** finish migration. Delete direct Drizzle usage; route `graph.neighbourhood`, `why.build`, and the `runCycle` write path through `/api/findings`, `/api/kg/neighbourhood`, `/api/why`.

### I3. Post-build runtime port mutation in container (composition-root smell)

[apps/console-api/src/container.ts#L340-L342](../../apps/console-api/src/container.ts#L340-L342):

```ts
(
  ssaAuditProvider as unknown as {
    deps: { sweepRepo: { loadPastFeedback: () => Promise<unknown[]> } };
  }
).deps.sweepRepo.loadPastFeedback = () => sweep.sweepRepo.loadPastFeedback();
```

Double-cast patching dep post-construction → evades type safety, signals wiring-order problem.

**Fix:** either a lazy `SweepRepoProvider` getter port, or reshape `buildSweepContainer` to return `sweepRepo` first so it can be passed via constructor. No casts.

### I4. Deep-path imports of kernel internals from the app

Kernel internals reached via non-barrel paths:

- [apps/console-api/src/container.ts#L20, L22-L25](../../apps/console-api/src/container.ts#L20) — `@interview/thalamus/explorer/nano-caller`, `@interview/thalamus/explorer/nano-swarm`, `@interview/thalamus/explorer/curator`
- [apps/console-api/src/services/satellite-sweep-chat.service.ts#L56](../../apps/console-api/src/services/satellite-sweep-chat.service.ts#L56)
- [apps/console-api/src/prompts/nano-swarm-ssa.prompt.ts#L10-L11](../../apps/console-api/src/prompts/nano-swarm-ssa.prompt.ts#L10-L11)

Each path is a private-API pinhole that couples the app to the kernel's internal file layout.

**Fix:** promote `setNanoConfigProvider`, `setNanoSwarmConfigProvider`, `setNanoSwarmProfile`, `setCuratorPrompt`, `DEFAULT_NANO_SWARM_PROFILE`, `ExplorationQuery` to `packages/thalamus/src/index.ts`; delete deep paths.

### I5. Kernel→kernel coupling: sweep depends on thalamus

[packages/sweep/src/config/container.ts#L15, L48, L203](../../packages/sweep/src/config/container.ts#L15) + [packages/sweep/src/sim/turn-runner-dag.ts#L21-L22](../../packages/sweep/src/sim/turn-runner-dag.ts#L21-L22) + [packages/sweep/src/sim/turn-runner-sequential.ts#L11-L12](../../packages/sweep/src/sim/turn-runner-sequential.ts#L11-L12) import `CortexRegistry`, `ConfidenceService`, `callNanoWithMode`, `extractJsonObject` from `@interview/thalamus`.

`CortexRegistry` + `callNanoWithMode` are legit per §4. `ConfidenceService` being `new`ed inside `buildSweepContainer` is questionable — sweep shouldn't own a confidence scorer.

Not a CLAUDE.md violation, but shape issue: sweep cannot be reasoned about independently of thalamus.

**Fix (optional, deferred):** either merge thalamus+sweep into one kernel, or extract a third agnostic `cortex-kernel` package with `CortexRegistry` + nano caller + confidence algebra.

### I6. Duplicate port declarations across services

`CyclesPort`, `FindingsWritePort`, `EdgesWritePort` declared identically in both [enrichment-finding.service.ts#L15-L25](../../apps/console-api/src/services/enrichment-finding.service.ts#L15-L25) and [reflexion.service.ts#L47-L57](../../apps/console-api/src/services/reflexion.service.ts#L47-L57). `SatellitesReadPort` declared with **different shapes** in [satellite-view.service.ts#L5](../../apps/console-api/src/services/satellite-view.service.ts#L5) and [sweep-task-planner.service.ts#L13](../../apps/console-api/src/services/sweep-task-planner.service.ts#L13) — namespace-collision smell.

**Fix:** extract to `apps/console-api/src/services/ports/` for shared ports; keep single-consumer ports co-located.

---

## 🟡 MINOR

### M1. `stats.repository.ts` reads thalamus-owned table with raw SQL

[apps/console-api/src/repositories/stats.repository.ts#L18](../../apps/console-api/src/repositories/stats.repository.ts#L18) — `SELECT count(*) FROM research_cycle`. Read-only, not a write-path violation. Goes away once C1 collapses to a single repo.

### M2. Thalamus has no dedicated `ports/` directory

Only [packages/thalamus/src/ports/web-search.port.ts](../../packages/thalamus/src/ports/web-search.port.ts) exists. `CortexDataProvider`, `DomainConfig`, `CortexExecutionStrategy` are clearly ports but live under `cortices/types.ts` and `cortices/strategies/`. Inconsistent with sweep's discipline.

### M3. God-files approaching the limit

- [apps/console-api/src/repositories/satellite.repository.ts](../../apps/console-api/src/repositories/satellite.repository.ts) — 609 L. Wide query surface OK per §4, but review for duplication.
- [packages/thalamus/src/services/research-graph.service.ts](../../packages/thalamus/src/services/research-graph.service.ts) — 513 L. Does finding CRUD + semantic search + KG assembly + entity queries + archive. Split 4-way.
- [apps/console-api/src/repositories/traffic-forecast.repository.ts](../../apps/console-api/src/repositories/traffic-forecast.repository.ts) — 469 L.

### M4. `simLauncher` closure wiring in container

[apps/console-api/src/container.ts#L493-L504](../../apps/console-api/src/container.ts#L493-L504) — ad-hoc `launcher` with `startTelemetrySwarm` / `startPcEstimatorSwarm` closures. Consider promoting to a `SimLauncherService` with an explicit port.

---

## Execution order (impact ÷ effort)

1. **C3** — delete [packages/thalamus/src/controllers/](../../packages/thalamus/src/controllers/) + [packages/thalamus/src/routes/](../../packages/thalamus/src/routes/) + barrel exports. Pure delete, zero risk. **DONE 2026-04-19**
2. **I4** — promote setters to thalamus barrel, delete deep paths. Mechanical. **DONE 2026-04-19**
3. **I3** — kill post-build cast in `container.ts`.
4. **C1** — collapse triple-write to one writer per table (Option A or B).
5. **C2** — refactor `sim-promotion.service.ts` with proper ports, split god-service.
6. **I1, I2** — finish `sim-swarm-store` + CLI `boot.ts` repo/HTTP routing.
7. **C4** — move SSA pack out of thalamus. Largest move; plan separately.
8. **I5, I6, M1-M4** — absorb into normal iteration.

---

# Pass 2 — dead-code / async / barrels / config (2026-04-19 later)

Complementary audit after Pass 1 landed C3+I4. Two sources: Claude code-reviewer subagent (dead-code/async/barrels) + manual exploration (config/layer discipline). Zero overlap with Pass 1 items.

## 🚨 CRITICAL — Pass 2

### C5. `satellite-sweep-chat` stack (639 LOC) silently dead in console-api

Commit `1ccc31b` ("refactor: move satellite-sweep-chat stack to console-api") moved 7 files from `packages/sweep/` → `apps/console-api/` as Plan 1 Task 5.1. The plan explicitly required `app.register(satelliteSweepChatRoutes, { prefix: "/api" })` in `server.ts`. **That wiring never landed.** Feature is silently disabled since the refactor.

Dead files (zero construction in `container.ts`, zero mount in `routes/index.ts` or `server.ts`, zero frontend references):

- [apps/console-api/src/routes/satellite-sweep-chat.routes.ts](../../apps/console-api/src/routes/satellite-sweep-chat.routes.ts) (38 L)
- [apps/console-api/src/controllers/satellite-sweep-chat.controller.ts](../../apps/console-api/src/controllers/satellite-sweep-chat.controller.ts) (55 L)
- [apps/console-api/src/services/satellite-sweep-chat.service.ts](../../apps/console-api/src/services/satellite-sweep-chat.service.ts) (316 L)
- [apps/console-api/src/repositories/satellite-sweep-chat.repository.ts](../../apps/console-api/src/repositories/satellite-sweep-chat.repository.ts) (138 L)
- [apps/console-api/src/transformers/satellite-sweep-chat.dto.ts](../../apps/console-api/src/transformers/satellite-sweep-chat.dto.ts) (28 L)
- [apps/console-api/src/types/satellite-sweep-chat.types.ts](../../apps/console-api/src/types/satellite-sweep-chat.types.ts) (38 L)
- [apps/console-api/src/prompts/satellite-sweep-chat.prompt.ts](../../apps/console-api/src/prompts/satellite-sweep-chat.prompt.ts) (26 L)

**Fix (decision required):**

- Remount: add `registerSatelliteSweepChatRoutes(app, s.satelliteSweepChat)` to [apps/console-api/src/routes/index.ts](../../apps/console-api/src/routes/index.ts); construct the controller+service+repo chain in [apps/console-api/src/container.ts](../../apps/console-api/src/container.ts).
- Delete the whole stack if the feature is no longer in scope.

### C6. SSE handler leaks LLM work on client disconnect

[apps/console-api/src/controllers/repl.controller.ts#L25](../../apps/console-api/src/controllers/repl.controller.ts#L25) streams via a `for await` over `service.handleStream()`. No subscription to `req.raw.on('close')` / `reply.raw` close, so when the browser navigates away, the async generator keeps running — cortex execution, nano calls, embeddings — silently burning tokens.

(Subagent also flagged the same pattern in `satellite-sweep-chat.controller.ts:34`, but that whole stack is dead — see C5 — so the leak is dormant there.)

**Fix:** thread an `AbortSignal` from `req.raw` into `ReplChatService.handleStream`; cortex/LLM call sites already accept `AbortSignal` — just plumb it.

### C7. `setInterval` timers are never cleaned on Fastify close

[apps/console-api/src/services/mission.service.ts#L80](../../apps/console-api/src/services/mission.service.ts#L80) and [apps/console-api/src/services/autonomy.service.ts#L72](../../apps/console-api/src/services/autonomy.service.ts#L72) set intervals that only stop via explicit `.stop()`. Neither `createApp().close()` nor `server.ts` around L240 calls `missionService.stop()` / `autonomyService.stop()`. Impact:

- Vitest suites that boot/teardown repeatedly accumulate open handles (the hanging-process message seen during tests is likely from this).
- Hot-reload in dev leaks timers that keep `tick()` firing against torn-down DB/Redis.

**Fix:** `app.addHook('onClose', async () => { missionService.stop(); autonomyService.stop(); })` in `server.ts`. 20 min.

## 🔴 IMPORTANT — Pass 2

### I7. `MissionService.tick()` has `try/finally` without `catch` → unhandled rejection

[apps/console-api/src/services/mission.service.ts#L95-L115](../../apps/console-api/src/services/mission.service.ts#L95-L115) — `runTask` errors bubble up as unhandled promise rejections because the caller is `void this.tick()` inside `setInterval`. Node ≥15 default is to crash the process.

Compare with [autonomy.service.ts#L97-L135](../../apps/console-api/src/services/autonomy.service.ts#L97-L135) which has a proper `try/catch` with logging — mirror that.

### I8. Kernel packages read `process.env` in 20+ locations (DIP violation)

Despite the established `ConfigProvider<T>` pattern (used for nano-caller), the kernel bypasses it in:

- [packages/thalamus/src/explorer/crawler.ts#L138, L243](../../packages/thalamus/src/explorer/crawler.ts#L138) — `OPENAI_API_KEY`
- [packages/thalamus/src/explorer/nano-caller.ts#L197, L275, L288, L389](../../packages/thalamus/src/explorer/nano-caller.ts#L197) — `OPENAI_API_KEY`, `THALAMUS_MODE`, `FIXTURES_FALLBACK`
- [packages/thalamus/src/utils/voyage-embedder.ts#L27](../../packages/thalamus/src/utils/voyage-embedder.ts#L27) — `VOYAGE_API_KEY`
- [packages/thalamus/src/config/enrichment.ts#L14-L41](../../packages/thalamus/src/config/enrichment.ts#L14-L41) — 10 env reads (Kimi, OpenAI fallback, local LLM)
- [packages/thalamus/src/cortices/sources/fetcher-celestrak.ts#L42](../../packages/thalamus/src/cortices/sources/fetcher-celestrak.ts#L42), `fetcher-launch-market.ts#L17`, `fetcher-spectra.ts#L17` — third-party API tokens

Console-api cannot inject/test/override these configs. Each read is also an NaN risk (see `codex-security.md` I-series).

**Fix:** extend the `setNanoConfigProvider` / `ConfigProvider<T>` pattern to cover: Voyage key, Kimi/OpenAI fallback block, per-fetcher API tokens, `THALAMUS_MODE`. Wire from `apps/console-api/src/container.ts` at boot.

### I9. Race on `SwarmService.onFishComplete` — check-then-enqueue

[packages/sweep/src/sim/swarm.service.ts#L143-L153](../../packages/sweep/src/sim/swarm.service.ts#L143-L153) — two fish completing concurrently can both observe `accounted >= swarm.size` and both call `enqueueSwarmAggregate`. BullMQ's fixed `jobId: swarm-${id}-aggregate` dedupes today, so the bug is latent — but the contract is enforced by the queue, not the data layer. If BullMQ dedup semantics ever change, duplicate aggregation silently corrupts promotion.

**Fix:** move the gate to an atomic `INCR` / `SETNX` on Redis or a Postgres `UPDATE sim_swarm SET aggregated=true WHERE id=$1 AND aggregated=false RETURNING *` — the contract lives where the state lives.

### I10. Unbounded `Promise.all` over embed calls

- [packages/sweep/src/sim/memory.service.ts#L84](../../packages/sweep/src/sim/memory.service.ts#L84) (`writeMany`)
- [packages/sweep/src/sim/aggregator.service.ts#L185](../../packages/sweep/src/sim/aggregator.service.ts#L185)

No concurrency cap. A 50-row turn batch fans out to 50 simultaneous OpenAI/Voyage embed calls, blowing through rate limits and rate-limit cost amplification. Contrast with [nano-swarm.ts#L221](../../packages/thalamus/src/explorer/nano-swarm.ts#L221) which is wave-bounded.

**Fix:** `p-limit(8)` around the embed calls, or use the provider's native batch endpoint via a port method.

### I11. `packages/sweep/src/index.ts` barrel bloat (fan-out 56, ~25 unused public exports)

Already partially flagged in `graph-health.md §4.1`. Pass-2 verified via grep `from "@interview/sweep"` across the repo — **zero external imports** for:

- `cosineKMeans`, `rngFromSeed`, `applyPerturbation`, `buildSimAgent` (+ opts)
- `SequentialTurnRunner`, `DagTurnRunner`
- `MemoryService` (+ 5 type aliases), `AggregatorService`
- `FindingRouterService` + `FindingRouterDeps`
- `MessagingService`, `NanoSweepService`
- `createSimTurnWorker` + `SimTurnWorkerDeps`, `createSwarmFishWorker`, `createSwarmAggregateWorker`
- `isKgPromotable`, `isTerminal`
- `SimOrchestrator` (class; only `type SimOrchestrator` is imported externally)

~25 of 56 exports exist solely for package-internal use → public API bloat → every `@interview/sweep` consumer pays the typecheck cost.

**Fix:** move the 25 internal-only symbols to a new `packages/sweep/src/internal.ts` that `config/container.ts` imports. Barrel stays at ~20 (container, ports, DTOs, HTTP adapters, queues, worker factories, sim-http types).

### I12. Frontend refetch storms on idle dashboards

- [apps/console/src/lib/queries.ts#L77](../../apps/console/src/lib/queries.ts#L77) — `useMissionStatus` polls every 2.5 s regardless of running state.
- [apps/console/src/lib/queries.ts#L105](../../apps/console/src/lib/queries.ts#L105) — `useAutonomyStatus` polls every 3 s.

When no mission is active, every open tab still triggers `MissionService.publicState()` on the backend 24× per minute.

**Fix:** `refetchInterval: (q) => q.state.data?.running ? 2500 : false`.

## 🟡 MINOR — Pass 2

### M5. `research-edge.repository.ts:29-38` — `void <import>` tree-shake hack

8 `void satellite;` / `void operator;` / ... lines at [packages/thalamus/src/repositories/research-edge.repository.ts#L31-L38](../../packages/thalamus/src/repositories/research-edge.repository.ts#L31-L38) with comment "so tree-shaking can't drop them". These tables are only referenced via raw SQL strings — `tsc` doesn't tree-shake imports; bundlers drop side-effect-free imports anyway. Either use `sql\`${tableName}\`` with the schema imports, or drop the imports entirely. Also a fresh instance of **C4** (thalamus kernel knows SSA tables).

### M6. Composition root mutates `process.env` at boot

[apps/console-api/src/server.ts#L43](../../apps/console-api/src/server.ts#L43) — `process.env.SIM_KERNEL_SHARED_SECRET ??= "interview-local-kernel-secret"` sets a dev default by mutating `process.env` globally. Side-effect in composition root. Should live in the config object, not `process.env`.

### M7. Transformers importing service types (mild layer skip)

- [apps/console-api/src/transformers/sim-fleet.transformer.ts#L1](../../apps/console-api/src/transformers/sim-fleet.transformer.ts#L1) — `import type { SimAgentSubjectSnapshot } from "../services/sim-fleet.service"`
- [apps/console-api/src/transformers/sim-target.transformer.ts#L5](../../apps/console-api/src/transformers/sim-target.transformer.ts#L5) — same pattern.

Transformers should consume domain/repo types, not service types. Move the types to `types/`.

### M8. `SweepRepository.getStats` / `list` unbounded Redis scan

[packages/sweep/src/repositories/sweep.repository.ts#L179, L362](../../packages/sweep/src/repositories/sweep.repository.ts#L179). `zrevrange(IDX_ALL, 0, -1)` pulls every suggestion id before pipeline-hgetall. Fine at hundreds; catastrophic at 10k+. Apply `opts.limit` to `zrevrange` when `reviewed !== false`; sample for `getStats`.

### M9. `SimMemoryRepository.writeMany` N+1 inside a transaction

[apps/console-api/src/repositories/sim-memory.repository.ts#L50-L71](../../apps/console-api/src/repositories/sim-memory.repository.ts#L50-L71) — loops `.insert().values(single).returning()` inside the transaction. 50-memory turn = 50 round-trips. Replace with `.insert(simAgentMemory).values(inserts).returning()`.

### M10. `packages/cli/src/boot.ts:155-156` swallows shutdown errors silently

`.catch(() => undefined)` on close paths is fine in tests, but prod shutdown should at minimum log at warn level — silent pool/Redis close failures hide connection-pool bugs.

## Pass-2 execution order (impact ÷ effort)

1. **C7** (20 min) — `onClose` hook for `missionService.stop()` + `autonomyService.stop()` in `server.ts`.
2. **I7** (10 min) — add `catch` to `MissionService.tick()`, mirror `autonomy.service.ts` pattern.
3. **C5** (decision + execution) — decide: remount sweep-chat stack or delete 639 LOC.
4. **I12** (20 min) — gated `refetchInterval` on console queries.
5. **C6** (30 min) — `AbortSignal` through `repl.controller.ts` into `ReplChatService`.
6. **I10** (20 min) — `p-limit(8)` on memory/aggregator embed `Promise.all`.
7. **I11** (1 h) — split `packages/sweep/src/index.ts` into `internal.ts` + lean public barrel.
8. **I9** (45 min) — move fish-aggregate gate to atomic Redis/PG.
9. **I8** (larger) — extend `ConfigProvider<T>` to cover kernel `process.env` reads; tackle along with **I4** barrel work.
10. **M5–M10** — absorb into normal iteration.
