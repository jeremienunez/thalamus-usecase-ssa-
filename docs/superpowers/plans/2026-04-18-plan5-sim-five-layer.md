# Plan 5 — Sim HTTP-contract boundary

> **Revised 2026-04-18 (session 2).** The first draft of this file proposed
> kernel ports implemented by directly-injected repositories. That is the
> backdoor pattern that collapses the kernel/app boundary to a cosmetic
> refactor. This revision replaces the architecture with a **single HTTP
> contract** as the only integration channel between the sim kernel and the
> Postgres/BullMQ layer.

> **For agentic workers:** REQUIRED SUB-SKILL: superpowers:subagent-driven-development
> (recommended) or superpowers:executing-plans. **Depends on Plan 1 (SSA
> sweep pack) + Plan 2 (10 pack-side domain ports) merged.** **Absorbs Plan 3**
> — Plan 3's CLI HTTP rewrite becomes a client of the same contract defined here.

---

## 1. The rule (absolute)

`packages/sweep/src/sim/**` (the sim kernel) **MUST NOT import**:

- `@interview/db-schema` — contains metier tables (satellite, conjunction_event, operator, doctrine, …); any import leaks metier into the kernel
- `drizzle-orm`, `drizzle-orm/node-postgres`, `pg`
- `bullmq`
- `fastify` (kernel is not a web server)
- `apps/console-api/**` (kernel is not application code)
- `apps/console/**`

The sim kernel's **only integration channel** with Postgres / BullMQ /
application state is an **HTTP fetch** against routes exposed by
`apps/console-api`.

There is **no "faster private path" in parallel**. A port implementation is
either (a) pure in-kernel logic or (b) a fetch client hitting the HTTP
contract. A constructor-injected repo is forbidden.

An arch-guard test enforces this and is RED on commit until Phase 3 ends.

## 2. Why (what this buys us)

1. **Single contractual truth** — the HTTP API is the one surface. No drift between a "direct" path and an "HTTP" path.
2. **Uniform cross-cutting** — validation, auth, quotas, tracing, errors, serialization all live at the HTTP boundary. A bypass breaks equivalence.
3. **No hidden coupling** — without this, the kernel stays glued to `apps/console-api/src/*` and the refactor is cosmetic.
4. **A complete public API** — if a route is missing, the public API isn't done. Not "a small internal tweak".
5. **Real deployability** — thalamus / sweep / sim become consumers of a stable boundary, not pieces of a monolith with backdoors.

## 3. Current violations

Every file listed below currently imports `@interview/db-schema` and/or
`drizzle-orm` and/or `bullmq`; Phase 3 removes every such import.

| File                                                 | Forbidden imports today                                                                                                                  |
| ---------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------- |
| `packages/sweep/src/sim/swarm.service.ts`            | `drizzle-orm` (`and`, `eq`, `sql`), `bullmq` (`Queue`), `@interview/db-schema` (`Database`, `simRun`, `simSwarm`)                        |
| `packages/sweep/src/sim/sim-orchestrator.service.ts` | `drizzle-orm`, `bullmq`, db-schema (`Database`, `NewSimRun`, `NewSimSwarm`, `NewSimTurn`, `simRun`, `simSwarm`, `simTurn`)               |
| `packages/sweep/src/sim/memory.service.ts`           | `drizzle-orm` (`and`, `desc`, `eq`, `gt`, `sql`), db-schema (`Database`, `MemoryKind`, `NewSimAgentMemory`, `simAgentMemory`, `simTurn`) |
| `packages/sweep/src/sim/aggregator.service.ts`       | `drizzle-orm` (`sql`), db-schema (`Database`, `TurnAction`)                                                                              |
| `packages/sweep/src/sim/aggregator-telemetry.ts`     | `drizzle-orm`, db-schema (`Database`, `TelemetryScalarKey`, `TurnAction`, `TELEMETRY_SCALAR_KEYS`)                                       |
| `packages/sweep/src/sim/turn-runner-dag.ts`          | `drizzle-orm`, db-schema (`simAgent`, `simRun`, `simTurn`, `NewSimTurn`)                                                                 |
| `packages/sweep/src/sim/turn-runner-sequential.ts`   | idem                                                                                                                                     |
| `packages/sweep/src/sim/agent-builder.ts`            | db-schema (`Database`, `NewSimAgent`, `simAgent`)                                                                                        |
| `packages/sweep/src/sim/promote.ts`                  | massive: drizzle + db-schema across `research_cycle`, `research_finding`, `research_edge`, `sim_swarm`, `sweep_suggestion`, `satellite`  |
| `packages/sweep/src/sim/god-channel.service.ts`      | `./legacy-ssa-schema` (Zod parse of SSA event shape — domain leak)                                                                       |
| `packages/sweep/src/sim/types.ts`                    | re-exports SSA-shaped types (`FleetSnapshot`, `TelemetryTarget`, `PcEstimatorTarget`) via a TEMPORARY COMPAT block                       |
| `packages/sweep/src/sim/legacy-ssa-*.ts`             | domain fallbacks shipped inside the "agnostic" kernel                                                                                    |

The SSA pack (`apps/console-api/src/agent/ssa/sim/*`) is **outside** the
kernel and is allowed to touch db-schema + drizzle. It becomes pure
server-side metier translation — it's not injected into the kernel at
runtime anymore.

## 4. Target architecture

```
packages/sweep/src/sim/                       # KERNEL — pure logic + HTTP client
  ports/                                      # Interfaces; DTOs only; zero db-schema
    run.port.ts                               # run lifecycle
    swarm.port.ts                             # swarm lifecycle + status
    turn.port.ts                              # turn persistence + god events
    memory.port.ts                            # sim_agent_memory
    terminal.port.ts                          # cross-cutting aggregator reads
    queue.port.ts                             # enqueue sim-turn / swarm-fish / swarm-aggregate
    (Plan 2 pack-side ports unchanged — fleet/target/persona/prompt/cortex/schema/pertpack/aggstrat/kindguard/promotion)
  types/
    wire.ts                                   # DTO shapes exchanged over HTTP
  adapters/http/                              # Port impls = fetch clients
    run.adapter.ts
    swarm.adapter.ts
    turn.adapter.ts
    memory.adapter.ts
    terminal.adapter.ts
    queue.adapter.ts
    fleet.adapter.ts                          # replaces in-process SsaFleetProvider
    target.adapter.ts                         # replaces in-process SsaTurnTargetProvider
    …one per Plan 2 domain port that hits DB
  http/
    client.ts                                 # shared fetch wrapper (baseURL, auth, tracing, retries, fixture mode)
  perturbation.ts                             # already pure, stays
  schema.ts                                   # buildTurnResponseSchema — pure, stays
  types.ts                                    # slimmed: generic types only, no SSA compat
  agent-builder.ts                            # slimmed: calls fleet/persona ports, no drizzle
  memory.service.ts                           # slimmed: wraps EmbedFn + calls memory port
  sim-orchestrator.service.ts                 # slimmed: state machine; calls run/swarm/turn/queue ports
  swarm.service.ts                            # DELETE (moves to app)
  aggregator.service.ts                       # slimmed: cosine-kmeans + calls terminal/swarm ports
  aggregator-telemetry.ts                     # slimmed: stats + calls terminal/swarm ports
  turn-runner-dag.ts                          # slimmed: calls turn/memory/target ports
  turn-runner-sequential.ts                   # slimmed: same
  promote.ts                                  # DELETE (moves to app)
  god-channel.service.ts                      # DELETE (moves to app)
  legacy-ssa-*.ts                             # DELETE
  utils/cosine-kmeans.ts                      # extracted pure math
  index.ts                                    # re-exports slim surface

apps/console-api/src/                         # METIER + SQL + HTTP — FLAT LAYERED
  repositories/                               # flat, alongside existing entity repos
    sim-swarm.repository.ts                   # NEW
    sim-run.repository.ts                     # NEW
    sim-turn.repository.ts                    # NEW
    sim-agent.repository.ts                   # NEW
    sim-memory.repository.ts                  # NEW
    sim-terminal.repository.ts                # NEW
    satellite.repository.ts                   # EXTEND — findByIdFull gains busName; add findNullTelemetryColumns
    conjunction.repository.ts                 # EXTEND — add findByIdWithSatellites
  services/                                   # flat, alongside existing entity services
    sim-launch.service.ts                     # NEW — absorbs swarm.service.ts::launchSwarm + ssa/sim/swarms/*
    sim-orchestrator.service.ts               # NEW — server-side orchestrator (separate from kernel's state-machine)
    sim-promotion.service.ts                  # NEW — absorbs promote.ts
    sim-god-channel.service.ts                # NEW — absorbs kernel's god-channel.service.ts
    sim-pc-aggregator.service.ts              # NEW
    sim-telemetry-aggregator.service.ts       # NEW
    sim-worker-hooks.service.ts               # NEW — onFishComplete, onSwarmAggregated
    sim-fleet.service.ts                      # NEW — metier translator for /ssa/agent-subject route
    sim-target.service.ts                     # NEW — metier translator for /runs/:id/targets route
  controllers/
    sim.controller.ts                         # NEW — 1 handler per route; ≤20 lines per handler
  routes/
    sim.routes.ts                             # NEW — auth-gated; mounts via registerAllRoutes
  schemas/
    sim.schema.ts                             # NEW — Zod request/response envelopes
  types/
    sim.types.ts                              # NEW — server-only DTO shapes mirroring wire.ts
  agent/ssa/sim/                              # unchanged; server-side metier adapter, NEVER injected into kernel
  infra/
    sim-queue.ts                              # NEW — BullMQ wrapping called BY the HTTP route (kernel never imports bullmq)
    sim-workers.ts                            # NEW — Inline BullMQ workers that instantiate the kernel with HTTP adapters
```

## 5. HTTP contract inventory

Every current SQL call in the kernel + pack has a route. The table below
freezes the contract; Phase 0 produces the full Zod schemas alongside.

### 5.1 Run lifecycle

| Port method               | Method + Path                            | Request                                                         | Response      |
| ------------------------- | ---------------------------------------- | --------------------------------------------------------------- | ------------- |
| `RunPort.create`          | `POST /api/sim/runs`                     | `{swarmId, fishIndex, kind, seedApplied, perturbation, config}` | `{simRunId}`  |
| `RunPort.findById`        | `GET /api/sim/runs/:id`                  | —                                                               | `SimRunDto`   |
| `RunPort.updateStatus`    | `PATCH /api/sim/runs/:id/status`         | `{status, completedAt?}`                                        | `{}`          |
| `RunPort.countAgents`     | `GET /api/sim/runs/:id/agent-count`      | —                                                               | `{count}`     |
| `RunPort.countAgentTurns` | `GET /api/sim/runs/:id/agent-turn-count` | —                                                               | `{count}`     |
| `RunPort.getSeedApplied`  | `GET /api/sim/runs/:id/seed`             | —                                                               | `SeedRefsDto` |

### 5.2 Swarm lifecycle

| Port method                   | Method + Path                         | Request                             | Response             |
| ----------------------------- | ------------------------------------- | ----------------------------------- | -------------------- |
| `SwarmPort.create`            | `POST /api/sim/swarms`                | `NewSimSwarmDto`                    | `{swarmId}`          |
| `SwarmPort.findById`          | `GET /api/sim/swarms/:id`             | —                                   | `SimSwarmDto`        |
| `SwarmPort.countFishByStatus` | `GET /api/sim/swarms/:id/fish-counts` | —                                   | `SwarmFishCountsDto` |
| `SwarmPort.markDone`          | `POST /api/sim/swarms/:id/done`       | —                                   | `{}`                 |
| `SwarmPort.markFailed`        | `POST /api/sim/swarms/:id/failed`     | —                                   | `{}`                 |
| `SwarmPort.linkOutcome`       | `PATCH /api/sim/swarms/:id/outcome`   | `{reportFindingId?, suggestionId?}` | `{}`                 |

### 5.3 Turn persistence

| Port method                        | Method + Path                                         | Request                        | Response               |
| ---------------------------------- | ----------------------------------------------------- | ------------------------------ | ---------------------- |
| `TurnPort.insertAgentTurn`         | `POST /api/sim/runs/:simRunId/turns`                  | `NewSimTurnDto`                | `{simTurnId}`          |
| `TurnPort.persistTurnBatch`        | `POST /api/sim/runs/:simRunId/turns/batch`            | `{agentTurns[], memoryRows[]}` | `{simTurnIds[]}`       |
| `TurnPort.insertGodTurn`           | `POST /api/sim/runs/:simRunId/god-turns`              | `NewSimTurnDto`                | `{simTurnId}`          |
| `TurnPort.listGodEventsAtOrBefore` | `GET /api/sim/runs/:simRunId/god-events?beforeTurn=X` | —                              | `SimGodEventDto[]`     |
| `TurnPort.lastTurnCreatedAt`       | `GET /api/sim/runs/:simRunId/last-turn-at`            | —                              | `{at: string \| null}` |

### 5.4 Memory

| Port method                   | Method + Path                                                | Request               | Response                 |
| ----------------------------- | ------------------------------------------------------------ | --------------------- | ------------------------ |
| `MemoryPort.writeMany`        | `POST /api/sim/runs/:simRunId/memory/batch`                  | `SimMemoryWriteDto[]` | `{ids[]}`                |
| `MemoryPort.topKByVector`     | `POST /api/sim/runs/:simRunId/memory/search`                 | `{agentId, vec, k}`   | `SimMemoryRowDto[]`      |
| `MemoryPort.topKByRecency`    | `GET /api/sim/runs/:simRunId/memory/recent?agentId=X&k=Y`    | —                     | `SimMemoryRowDto[]`      |
| `MemoryPort.recentObservable` | `GET /api/sim/runs/:simRunId/observable?sinceTurn=X&limit=Y` | —                     | `SimObservableTurnDto[]` |

Embedding is computed kernel-side (via `EmbedFn`) before the write.
Vectors travel as `number[]` on the wire — compact enough for Voyage-3-lite
(512-dim) and under payload limits.

### 5.5 Terminal (aggregator reads)

| Port method                                | Method + Path                                   | Request | Response                     |
| ------------------------------------------ | ----------------------------------------------- | ------- | ---------------------------- |
| `TerminalPort.listTerminalsForSwarm`       | `GET /api/sim/swarms/:swarmId/terminals`        | —       | `SimFishTerminalDto[]`       |
| `TerminalPort.listTerminalActionsForSwarm` | `GET /api/sim/swarms/:swarmId/terminal-actions` | —       | `SimFishTerminalActionDto[]` |

### 5.6 Queue

| Port method                       | Method + Path                         | Request                                  | Response |
| --------------------------------- | ------------------------------------- | ---------------------------------------- | -------- |
| `QueuePort.enqueueSimTurn`        | `POST /api/sim/queue/sim-turn`        | `{simRunId, turnIndex, jobId?}`          | `{}`     |
| `QueuePort.enqueueSwarmFish`      | `POST /api/sim/queue/swarm-fish`      | `{swarmId, simRunId, fishIndex, jobId?}` | `{}`     |
| `QueuePort.enqueueSwarmAggregate` | `POST /api/sim/queue/swarm-aggregate` | `{swarmId, jobId?}`                      | `{}`     |

### 5.7 Domain ports (replace in-process SSA pack impls)

Plan 2 introduced 10 pack-side domain ports; today their impls reach into
console-api repos directly — that's the backdoor. Pure ports stay pure;
ports that need DB or SSA metier become HTTP adapters on the kernel side.
Route handlers invoke the SSA pack server-side.

| Port                                   | Kind | Method + Path (if HTTP)                         | Response                                 |
| -------------------------------------- | ---- | ----------------------------------------------- | ---------------------------------------- |
| `SimFleetProvider.getAgentSubject`     | HTTP | `GET /api/sim/ssa/agent-subject?kind=X&id=Y`    | `AgentSubjectSnapshotDto`                |
| `SimFleetProvider.getAuthorLabels`     | HTTP | `POST /api/sim/ssa/author-labels`               | `{labels: Record<string,string>}`        |
| `SimTurnTargetProvider.loadTargets`    | HTTP | `GET /api/sim/runs/:simRunId/targets`           | `{telemetryTarget?, pcEstimatorTarget?}` |
| `SimPromotionAdapter.emitFromModal`    | HTTP | `POST /api/sim/ssa/promotion/from-modal`        | `PromotionResultDto`                     |
| `SimPromotionAdapter.emitTelemetry`    | HTTP | `POST /api/sim/ssa/promotion/telemetry-scalars` | `PromotionResultDto[]`                   |
| `SimAgentPersonaComposer.compose`      | pure | —                                               | —                                        |
| `SimPromptComposer.render`             | pure | —                                               | —                                        |
| `SimCortexSelector.pickCortexName`     | pure | —                                               | —                                        |
| `SimActionSchemaProvider.actionSchema` | pure | —                                               | —                                        |
| `SimPerturbationPack.*`                | pure | —                                               | —                                        |
| `SimAggregationStrategy.*`             | pure | —                                               | —                                        |
| `SimKindGuard.*`                       | pure | —                                               | —                                        |

### 5.8 Launcher / lifecycle routes (Plan 3 absorbed)

| Intent                         | Method + Path                          | Request                                | Response                   |
| ------------------------------ | -------------------------------------- | -------------------------------------- | -------------------------- |
| Start telemetry swarm          | `POST /api/sim/telemetry/start`        | `{satelliteId, fishCount?, config?}`   | `LaunchSwarmResultDto`     |
| Start Pc estimator swarm       | `POST /api/sim/pc/start`               | `{conjunctionId, fishCount?, config?}` | `LaunchSwarmResultDto`     |
| Start standalone (admin/debug) | `POST /api/sim/standalone/start`       | `StartStandaloneDto`                   | `StartStandaloneResultDto` |
| Inject god event               | `POST /api/sim/runs/:id/inject`        | `GodEventDto`                          | `{simTurnId}`              |
| Pause                          | `POST /api/sim/runs/:id/pause`         | —                                      | `{}`                       |
| Resume                         | `POST /api/sim/runs/:id/resume`        | —                                      | `{}`                       |
| Schedule next                  | `POST /api/sim/runs/:id/schedule-next` | —                                      | `{scheduled, reason?}`     |
| Run status                     | `GET /api/sim/runs/:id/status`         | —                                      | `SimStatusDto`             |
| Swarm status                   | `GET /api/sim/swarms/:id/status`       | —                                      | `SwarmStatusDto`           |
| Abort swarm                    | `POST /api/sim/swarms/:id/abort`       | —                                      | `{}`                       |

## 6. Phased migration

Each phase ends with a **risk gate**: `pnpm -r typecheck` clean + UC3 E2E
green + telemetry unit green + the arch-guard red-count strictly
decreasing toward 0.

### Phase 0 — Contract freeze (docs only; zero code)

- [ ] **0.1** Produce `docs/superpowers/plans/2026-04-18-plan5-sim-http-contract.md` with the full Zod schema for every route in §5 (request body, response body, error envelope). Single source of truth.
- [ ] **0.2** Decide the base URL + auth scheme (re-use console-api's existing JWT preHandler; in-process kernel→localhost flow uses a shared-secret header read from env).
- [ ] **0.3** Decide the fixture-mode contract: how the kernel's HTTP client captures `(method, path, body) → hash → replay`.

Risk gate 0: plan + contract doc reviewed and approved by the user before
any code lands. §2 point 4 says missing routes mean the refactor isn't
finished; we must enumerate them first.

### Phase 1 — Console-api API surface

**1.A Repositories (SQL owner; flat — alongside existing entity repos)**

- [ ] **1.A.1** `repositories/sim-swarm.repository.ts` — every SQL shape §5.2 needs; object-level; narrow methods.
- [ ] **1.A.2** `repositories/sim-run.repository.ts` — §5.1.
- [ ] **1.A.3** `repositories/sim-turn.repository.ts` — §5.3, including the tx-atomic `persistTurnBatch({agentTurns, memoryRows})`.
- [ ] **1.A.4** `repositories/sim-agent.repository.ts` — agent insert + list by run.
- [ ] **1.A.5** `repositories/sim-memory.repository.ts` — §5.4; pgvector `<=>` stays in SQL, embedding passed as `number[]` from controller.
- [ ] **1.A.6** `repositories/sim-terminal.repository.ts` — §5.5; cross-cutting read over sim_run + sim_turn + sim_agent.
- [ ] **1.A.7** Extend existing `repositories/satellite.repository.ts`: add `busName` to `findByIdFull` (object-level reuse); add `findNullTelemetryColumns(satelliteId)` for promotion.
- [ ] **1.A.8** Extend existing `repositories/conjunction.repository.ts`: add `findByIdWithSatellites(conjunctionId)` (conjunction + both satellites + both buses — the object both §5.7 `target` and §5.8 `pc/start` consume).

**1.B Services (app-side orchestration; flat — alongside existing entity services)**

- [ ] **1.B.1** `services/sim-launch.service.ts` — absorbs `swarm.service.ts::launchSwarm` + `agent/ssa/sim/swarms/telemetry.ts` + `pc.ts`. Uses `SimKindGuard` pack helper server-side.
- [ ] **1.B.2** `services/sim-orchestrator.service.ts` — server-side of the standalone flow.
- [ ] **1.B.3** `services/sim-promotion.service.ts` — absorbs `promote.ts::emitSuggestionFromModal` + `emitTelemetrySuggestions`.
- [ ] **1.B.4** `services/sim-god-channel.service.ts` — absorbs kernel's god-channel.
- [ ] **1.B.5** `services/sim-pc-aggregator.service.ts` + `services/sim-telemetry-aggregator.service.ts` — DB-backed orchestrators; kernel keeps the math (cosine-kmeans, stats).
- [ ] **1.B.6** `services/sim-worker-hooks.service.ts` — onFishComplete + onSwarmAggregated.
- [ ] **1.B.7** `services/sim-fleet.service.ts` + `services/sim-target.service.ts` — metier translators called by §5.7 route handlers.

**1.C Controllers**

- [ ] **1.C.1** `controllers/sim.controller.ts` — one handler per route. Each handler: Zod-parse, delegate to one service method, map to status code. ≤20 lines per handler.

**1.D Routes**

- [ ] **1.D.1** `routes/sim.routes.ts` — registers every route in §5; attaches auth preHandler.
- [ ] **1.D.2** Mount in `routes/index.ts::registerAllRoutes`. Extend `AppServices` type.

**1.E Schemas**

- [ ] **1.E.1** `schemas/sim.schema.ts` — Zod envelopes exported so tests + adapters share shapes.

**1.F Integration tests (real HTTP)**

- [ ] **1.F.1** `tests/e2e/sim-http-contract.spec.ts` — one `it()` per route; boots server with `startServer(0)`; asserts 201/200 on happy path + 400 on bad body + 404 on missing id.

Risk gate 1: `pnpm -C apps/console-api test` green; `pnpm -C apps/console-api dev` + `curl` each route returns expected shape; arch-guard still RED (kernel hasn't changed — expected).

### Phase 2 — Kernel-side wire types + port interfaces + HTTP adapters

- [ ] **2.A.1** `packages/sweep/src/sim/types/wire.ts` — every DTO referenced in §5. **Zero imports** from `@interview/db-schema` or drizzle.
- [ ] **2.A.2** `packages/sweep/src/sim/ports/{run,swarm,turn,memory,terminal,queue}.port.ts` — 6 new ports speaking DTOs from `wire.ts`. Plan 2 pack-side port files updated to drop any db-schema type refs.
- [ ] **2.A.3** `packages/sweep/src/sim/http/client.ts` — shared fetch wrapper. Responsibilities: base URL, auth header, retries (idempotent GETs + POST-with-jobId only), structured error parsing (uniform error envelope from §7), OpenTelemetry span start/end, fixture-mode record/replay hook.
- [ ] **2.A.4** `packages/sweep/src/sim/adapters/http/*.adapter.ts` — one file per port; each adapter is a thin fetch wrapper. ~150 lines per adapter max (mostly DTO passthrough).
- [ ] **2.A.5** Unit tests under `packages/sweep/tests/sim/adapters/*.test.ts`: mock the fetch wrapper, assert the adapter formats URL + body + parses response per contract. No network.

Risk gate 2: `pnpm -C packages/sweep typecheck` green; kernel has **no new** forbidden imports added in this phase (the old ones still exist — Phase 3 removes them).

### Phase 3 — Kernel cutover

The load-bearing phase. For each kernel file, replace direct DB/queue
access with port calls; end-state = zero forbidden imports in
`packages/sweep/src/sim/**`.

- [ ] **3.1** `memory.service.ts` — `EmbedFn` + `MemoryPort` only; delete drizzle + db-schema imports.
- [ ] **3.2** `aggregator.service.ts` — cluster math + `TerminalPort` + `SwarmPort` only; delete SQL.
- [ ] **3.3** `aggregator-telemetry.ts` — stats + `TerminalPort` + `SwarmPort` only.
- [ ] **3.4** `turn-runner-dag.ts` — `MemoryPort`, `TurnPort`, `TargetPort`, `PromptPort`, `CortexSelector`, `ActionSchemaProvider`; no `db.transaction` — the tx becomes one `TurnPort.persistTurnBatch` call.
- [ ] **3.5** `turn-runner-sequential.ts` — same shape.
- [ ] **3.6** `agent-builder.ts` — `FleetProvider` + `PersonaComposer` pack ports only; the sim_agent write moves to `RunPort.createAgent` or the launcher service does it server-side and the kernel receives the agent id.
- [ ] **3.7** `sim-orchestrator.service.ts` — kernel side becomes the state machine only; app-side mirror (§1.B.2) drives DB writes via `RunPort`. Kernel's `createFish`, `scheduleNext`, `pause`, `resume`, `inject`, `status` all go through ports.
- [ ] **3.8** `swarm.service.ts` — **DELETED** from kernel. `SimLaunchService` in console-api owns the flow.
- [ ] **3.9** `promote.ts` — **DELETED** from kernel. `SimPromotionService` in console-api owns it; pure helpers (`isKgPromotable`, `describeAction`, `composeTitle`, `composeDescription`, `scoreScalar`) extracted to `apps/console-api/src/agent/ssa/sim/promotion-policy.ts` (server-side metier helpers).
- [ ] **3.10** `god-channel.service.ts` — **DELETED** from kernel; app-side service calls `TurnPort.insertGodTurn` + `ActionSchemaProvider` for Zod parse.
- [ ] **3.11** `types.ts` — delete TEMPORARY COMPAT block, delete SSA-shaped re-exports. Kernel types become wire DTOs only (moved to `types/wire.ts` where sensible).
- [ ] **3.12** Delete `legacy-ssa-perturbation-pack.ts`, `legacy-ssa-schema.ts`, `sim-ssa-types-temp.ts` (if present).
- [ ] **3.13** `packages/sweep/src/index.ts` — trim exports: ports types, `buildTurnResponseSchema`, `swarmConfigSchema`, `applyPerturbation`, `rngFromSeed`, `cosineKMeans` util, `DagTurnRunner`, `SequentialTurnRunner`, `MemoryService`.
- [ ] **3.14** `buildSweepContainer` — drop the `opts.sim` branch entirely. Sim is no longer a sub-container of sweep. Console-api wires sim in its own container.

Risk gate 3: **arch-guard goes GREEN**. `packages/sweep/src/sim/**` has **zero** matches for `@interview/db-schema`, `drizzle-orm`, `pg`, `bullmq`, `fastify`, `apps/console-api`. UC3 E2E still passes — it boots the HTTP server, kernel talks to it over localhost.

### Phase 4 — Arch-guard + legacy cleanup

- [ ] **4.1** New test: `packages/sweep/tests/arch-guard-sim-kernel-http.spec.ts` — walks `packages/sweep/src/sim/**.ts`, parses imports via `ts-morph` or regex; asserts zero matches for the forbidden list. **Must exist from Phase 2 onward and be RED until end of Phase 3; Phase 4 flips it GREEN and removes any allowlist.**
- [ ] **4.2** Delete `apps/console-api/src/agent/ssa/sim/swarms/*` (replaced by §1.B.1).
- [ ] **4.3** Plan 2 `PLAN2_DEFERRED_ALLOWLIST` — drop entries that Plan 5 just made moot.
- [ ] **4.4** Un-skip `packages/sweep/tests/arch-guard-sim-layers.spec.ts` (Plan 2 Task C.1).
- [ ] **4.5** CHANGELOG + TODO.md update.

### Phase 5 — Cross-cutting uniformity

- [ ] **5.1** Auth preHandler attached to every `/api/sim/*` route — matches existing `/api/autonomy/*` pattern.
- [ ] **5.2** Error envelope: `{error: {code, message, details?}}` — uniform across all sim routes; `asyncHandler` shared helper already does this for console-api entities.
- [ ] **5.3** OpenTelemetry span per route with `sim.run_id`, `sim.swarm_id`, `sim.turn_index` attributes.
- [ ] **5.4** Rate limits — deferred; note in TODO.
- [ ] **5.5** Request validation errors surface the Zod issue path — no silent 500s.

## 7. Worker placement

Workers run inline in the console-api process (preserving Plan 5 v1 Phase
E.1 decision). They load the sim kernel, which talks **HTTP over
localhost** back to the same process. Loopback overhead ~<1ms per request;
UC3 E2E completes in comparable wall time.

Kernel source has no awareness of whether it's inline or remote. A future
`apps/worker-sim` extraction is a copy-paste, not a redesign.

## 8. Determinism

Fixture-mode prompt cache keys on `sha256(system+user)` and must not
drift. Phase 3 moves context assembly to port calls, so fixture capture
moves to the HTTP client:

- `SIM_HTTP_FIXTURES=record` — captures `(method, path, body) → response` to `fixtures/sim-http/<hash>.json`.
- `SIM_HTTP_FIXTURES=replay` — serves from disk; fail loudly on miss.
- UC3 E2E runs in `replay` by default so CI doesn't need a live DB per kernel test.

Any diff in captured fixtures between `main` and the refactor branch fails
the build — byte-level regression check.

## 9. Risks + explicit callouts

1. **Performance** — N HTTP roundtrips per turn. Mitigation: `persistTurnBatch` bundles (agentTurns + memoryRows) into one call; `GET /swarms/:id/terminals` returns all fish in one call. Hot path bounded.
2. **BullMQ payload compatibility** — job shapes must stay wire-stable across the cutover so in-flight jobs survive. Contract test: `tests/unit/worker-contract.spec.ts` pins the JSON shape of the three job payloads.
3. **Test rewiring** — UC3 E2E today constructs kernel with direct deps (`swarm-uc3.e2e.spec.ts:150,157`). Phase 3 rewires it to boot the HTTP server first, then instantiate the kernel with HTTP adapters pointing at `http://localhost:<port>`. One commit so the test never sees a half-broken intermediate.
4. **SSA pack relocation (domain ports)** — Today's in-process `SsaFleetProvider` / `SsaTurnTargetProvider` / etc. are app-side but constructor-injected into the kernel. After Phase 3 they split: HTTP adapter on kernel side, server-side metier translator inside console-api. This is the single biggest conceptual move.
5. **`buildSweepContainer` breaking change** — `opts.sim` dropped. CLI / any external consumer must migrate. In-repo `grep -rn "buildSweepContainer"` today = 5 matches, all in-repo; document as "Breaking" in CHANGELOG.
6. **Determinism** — covered by §8. Without it, the fixture-mode prompt cache silently breaks.
7. **Phase 0 is not optional** — skipping to repo-writing means missing routes surface as Phase 3 regressions.

## 10. Explicit non-goals

- We do not split `@interview/db-schema` into kernel/metier packages. Larger effort; Plan 5 accepts current shape and forbids the kernel from importing it.
- We do not extract a separate `packages/sim/` package. Sim kernel stays inside `packages/sweep/src/sim/`; future extraction is trivial once the HTTP boundary is clean.
- We do not collapse `SimKindGuard` + `SimCortexSelector` + `SimAggregationStrategy` into a single port. Plan-6 concern.
- We do not touch thalamus. Thalamus already has its own 5-layer cake inside `packages/thalamus`; orthogonal to this plan.

---

### Critical files this plan rewrites

- `packages/sweep/src/sim/sim-orchestrator.service.ts`
- `packages/sweep/src/sim/swarm.service.ts`
- `packages/sweep/src/sim/promote.ts`
- `packages/sweep/src/sim/memory.service.ts`
- `packages/sweep/src/sim/aggregator.service.ts`
- `packages/sweep/src/sim/aggregator-telemetry.ts`
- `packages/sweep/src/sim/turn-runner-dag.ts`
- `packages/sweep/src/sim/turn-runner-sequential.ts`
- `packages/sweep/src/sim/agent-builder.ts`
- `packages/sweep/src/sim/god-channel.service.ts`
- `packages/sweep/src/sim/types.ts`
- `apps/console-api/src/container.ts`
- `apps/console-api/src/server.ts`
- `apps/console-api/src/routes/index.ts`

### Critical files this plan creates

- `docs/superpowers/plans/2026-04-18-plan5-sim-http-contract.md` (Phase 0)
- `packages/sweep/src/sim/types/wire.ts`
- `packages/sweep/src/sim/ports/{run,swarm,turn,memory,terminal,queue}.port.ts`
- `packages/sweep/src/sim/http/client.ts`
- `packages/sweep/src/sim/adapters/http/*.adapter.ts`
- `apps/console-api/src/repositories/{sim-swarm,sim-run,sim-turn,sim-agent,sim-memory,sim-terminal}.repository.ts`
- `apps/console-api/src/services/sim-{launch,orchestrator,promotion,god-channel,pc-aggregator,telemetry-aggregator,worker-hooks,fleet,target}.service.ts` (9 files; `sim-*` prefix keeps them grouped visually inside the flat services/ dir)
- `apps/console-api/src/controllers/sim.controller.ts`
- `apps/console-api/src/routes/sim.routes.ts`
- `apps/console-api/src/schemas/sim.schema.ts`
- `apps/console-api/src/infra/{sim-queue,sim-workers}.ts`
- `packages/sweep/tests/arch-guard-sim-kernel-http.spec.ts`
