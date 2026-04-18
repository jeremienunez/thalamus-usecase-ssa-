# Plan 5 — Sim five-layer integration

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans. **Depends on Plans 1 + 2 merged** (SSA sweep pack + 10 sim ports). **Complements Plan 3** (adds the routes/controllers/services that Plan 3 calls).

**Goal:** Retire the ad-hoc sim stack (kernel services orchestrating SQL, SSA pack leaking SQL + BullMQ wiring, launchers eating controller responsibilities) and fold sim into the 5-layer console-api architecture defined in `2026-04-16-console-api-layered-refactor.md` (routes → controllers → services → repositories → types), with **`utils/` for server-only helpers** and the **`agent/ssa/sim/` pack demoted to "pure functions + ports only"** (no SQL, no BullMQ, no DB).

**User framing:** "les deux parties ne sont pas SOLID, les responsabilités sont mélangées". This plan names the violations file-by-file and re-homes every responsibility.

**Strangler fig:** Every public entrypoint keeps its signature during the migration. `SwarmService.launchSwarm`, `SimOrchestrator.startStandalone`, `DagTurnRunner.runTurn`, `SequentialTurnRunner.runTurn`, `AggregatorService.aggregate`, `GodChannelService.*`, `startTelemetrySwarm`, `startPcEstimatorSwarm`. Internals re-route through the new layer cake; external callers are untouched until the final phase removes the shims.

**Branch:** continuation of `refactor/sim-agnostic` after Plans 2 + 3 land.

**Risk gates (between every task):**

- `pnpm -r typecheck` clean
- UC3 E2E: `cd apps/console-api && pnpm exec vitest run tests/e2e/swarm-uc3.e2e.spec.ts`
- Telemetry swarm unit: `pnpm exec vitest run tests/unit/telemetry-swarm.spec.ts`
- Sim arch-guard (Plan 2) stays green
- New Plan 5 arch-guards: `apps/console-api/tests/unit/arch-guard-sim-layers.spec.ts`
  - `agent/ssa/sim/**` imports **no** `drizzle-orm`, no `bullmq`, no `repositories/**`
  - `services/sim/**` and `repositories/sim/**` never import `agent/ssa/sim/**` (pack depends on layers, not the other way round)
  - `controllers/sim*.ts` must not import `@interview/sweep/sim/**` directly — only via services

---

## 1. Layer ontology (the rule used throughout)

Crystallised from `apps/console-api/src/{controllers,services,repositories,transformers,schemas,types}/` + the 2026-04-16 plan:

| Layer                   | Responsibility                                                                                        | Existing exemplar                                                                                                  | Forbidden from                                          |
| ----------------------- | ----------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------- |
| **routes/**             | URL pattern + method → controller; no logic                                                           | `apps/console-api/src/routes/sweep.routes.ts:15`                                                                   | Zod, DB, business branching                             |
| **controllers/**        | Zod-parse the HTTP envelope, delegate to one service, map to status code                              | `apps/console-api/src/controllers/satellites.controller.ts:7`                                                      | DB, SQL, cross-service composition, domain logic        |
| **services/**           | Business logic; orchestrates repositories + other services + the pack via ports                       | `apps/console-api/src/services/mission.service.ts`, `apps/console-api/src/services/satellite-audit.service.ts:132` | `req`/`reply`, SQL strings, BullMQ `Queue.add`          |
| **repositories/**       | Drizzle / raw SQL; one table-cluster per file                                                         | `apps/console-api/src/repositories/satellite-fleet.repository.ts:24`                                               | Zod, Fastify types, cross-repo composition              |
| **transformers/**       | Pure row → DTO (or pack-shape → DB-shape) functions                                                   | `apps/console-api/src/transformers/conjunction-view.transformer.ts`                                                | I/O of any kind                                         |
| **schemas/**            | Zod request/response envelopes only                                                                   | `apps/console-api/src/schemas/sweep.schema.ts`                                                                     | Domain enums (those live in `@interview/shared`)        |
| **types/**              | Server-only TS types                                                                                  | `apps/console-api/src/types/mission.types.ts`                                                                      | Zod, SQL                                                |
| **utils/**              | Server-only helpers                                                                                   | `apps/console-api/src/utils/async-handler.ts`                                                                      | Domain assumptions                                      |
| **agent/ssa/sim/**      | **After this plan:** pure pack implementations of ports. No DB, no BullMQ. Pack ↔ layers via DI.      | (new shape; current layout documented in §2)                                                                       | `drizzle-orm`, `bullmq`, anything under `repositories/` |
| **packages/sweep/sim/** | Domain-agnostic kernel: generic types, RNG, cluster math, port definitions, `buildTurnResponseSchema` | `packages/sweep/src/sim/perturbation.ts:47` (`applyPerturbation`)                                                  | SSA symbols, DB, BullMQ                                 |

The five layers are what the user called them. `agent/ssa/` and `packages/sweep/sim/` are not layers — they are **pack** and **kernel**, both sitting **outside** the cake and injected into it via `container.ts`.

---

## 2. Current state audit — SRP/ISP/DIP violations

### 2.1 Kernel (`packages/sweep/src/sim/`) — still too much SQL + BullMQ for an "agnostic kernel"

The B.x tasks hoisted the SSA-flavoured pieces out but left the kernel **married to Drizzle + pgvector + BullMQ**. That's acceptable on the technology axis (kernel targets our stack) but it conflates three distinct responsibilities that belong on different floors of a 5-layer cake.

| File                                                                                             | Responsibilities tangled                                                                          | SOLID break                                             |
| ------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------- | ------------------------------------------------------- |
| `packages/sweep/src/sim/sim-orchestrator.service.ts:121,204,331,344,363,391,421,430,437,446`     | Creates sim_run + agents (service), writes sim_swarm/sim_turn (repo), calls `simTurnQueue.add`    | SRP: service + repo + job dispatcher in one class       |
| `packages/sweep/src/sim/swarm.service.ts:79,167,186,204,228,255`                                 | Inserts sim_swarm, drives perturbation → fish insert, enqueues BullMQ, counts fish status         | SRP: orchestration + repo + queue                       |
| `packages/sweep/src/sim/turn-runner-dag.ts:151,399,423` (tx over simTurn/simAgentMemory/simRun)  | LLM call + Zod parse + multi-table tx + sim_turn SQL                                              | SRP; DIP (couples to Drizzle directly)                  |
| `packages/sweep/src/sim/turn-runner-sequential.ts` (mirrors the DAG file)                        | Same as DAG                                                                                       | Same                                                    |
| `packages/sweep/src/sim/memory.service.ts:83,106,126,153,187,237`                                | pgvector SQL + ORM queries + fleet-port call for author labels                                    | SRP: embedder + repo + composer in one service          |
| `packages/sweep/src/sim/aggregator.service.ts:70,163,242` + `cosineKMeans` (line 337)            | Clustering math + sim_swarm/sim_turn/sim_agent SQL                                                | SRP: repo + pure math                                   |
| `packages/sweep/src/sim/aggregator-telemetry.ts:53,71` (SQL reads)                               | Aggregate + DB reads                                                                              | SRP                                                     |
| `packages/sweep/src/sim/promote.ts:82,101,134,169,209,223,229,266,406,419,451,510,545` (massive) | research_cycle + research_finding + research_edge + sim_swarm + sweep_suggestion + satellite SQL  | SRP + OCP (one god-function for 2 very different paths) |
| `packages/sweep/src/sim/god-channel.service.ts:14,18` (imports `./legacy-ssa-schema`)            | Zod parse of SSA event shape inside "kernel"                                                      | DIP leak — kernel pulls SSA Zod                         |
| `packages/sweep/src/sim/types.ts:7,30,87,107,156` + the "TEMPORARY COMPAT" block                 | Kernel types still re-export SSA shapes (`FleetSnapshot`, `TelemetryTarget`, `PcEstimatorTarget`) | ISP — kernel knows fat domain types                     |
| `packages/sweep/src/sim/legacy-ssa-*.ts` (460 lines)                                             | Fallback SSA impls still shipped in the "agnostic" package                                        | OCP: two code paths for the same thing                  |

### 2.2 SSA pack (`apps/console-api/src/agent/ssa/sim/`) — still doing SQL + launching swarms

The pack is supposed to be pure functions that implement ports. Today it **launches swarms over `SwarmService`**, **issues SQL**, and **loads JSON files from disk** — all responsibilities that belong in the 5-layer cake, not in a pack.

| File                                                                                                             | Responsibilities tangled                                                                                                                  | SOLID break                                           |
| ---------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------- |
| `apps/console-api/src/agent/ssa/sim/swarms/telemetry.ts:46,54,77` (loads sat + calls `swarmService.launchSwarm`) | It's a service/use-case, not a pack utility                                                                                               | SRP: pack + service in one                            |
| `apps/console-api/src/agent/ssa/sim/swarms/pc.ts:31,62` (same pattern)                                           | Same                                                                                                                                      | Same                                                  |
| `apps/console-api/src/agent/ssa/sim/targets.ts:69,84,100,150,166`                                                | Raw SQL for sim_run.seed_applied + satellite + conjunction_event                                                                          | DIP: pack depends on Drizzle                          |
| `apps/console-api/src/agent/ssa/sim/aggregators/pc.ts:153,159,166`                                               | Pure math (computePcAggregate) + DB-backed orchestrator in same file                                                                      | SRP                                                   |
| `apps/console-api/src/agent/ssa/sim/bus-datasheets/loader.ts:18,38` (`readFileSync`)                             | Disk I/O inside pack code; cache is process-global                                                                                        | SRP + testability                                     |
| `apps/console-api/src/agent/ssa/sim/promotion.ts:30` (TODO throws)                                               | Port is still a stub — sim promotion remains in `packages/sweep/src/sim/promote.ts`                                                       | Plan 2 debt; today the port doesn't actually delegate |
| `apps/console-api/src/agent/ssa/sim/fleet-provider.ts:47` (calls `fleetRepo.getSimAgentAuthorLabels`)            | Pack reaches into `repositories/` — correct direction for DIP but couples pack-impl to a narrow repo; acceptable if the repo stays narrow | Acceptable today; flagged to stay narrow              |

### 2.3 Cross-cutting gaps

1. **No controller for sim, no routes file.** Plan 3 Task A.1 is blocked on those files not existing — §5 Phase B creates them.
2. **No sim service layer.** Business flow "caller asks for a UC_TELEMETRY swarm" today goes directly from a launcher (`agent/ssa/sim/swarms/telemetry.ts`) to `SwarmService` (kernel). There is no place for composition such as "check feedback loop first, de-dup a swarm already running for this satellite, enqueue confidence bookkeeping". §5 Phase C introduces `SimLaunchService`.
3. **No sim repositories.** SQL over `sim_swarm`, `sim_run`, `sim_turn`, `sim_agent`, `sim_agent_memory` is sprayed across the kernel, the pack (`targets.ts`), and `promote.ts`. §5 Phase D consolidates under `repositories/sim/*.repository.ts`.
4. **BullMQ workers aren't booted anywhere in production.** `createSimTurnWorker` / `createSwarmFishWorker` / `createSwarmAggregateWorker` are exported from `packages/sweep/src/index.ts:128-132` but only the E2E test instantiates them (`apps/console-api/tests/e2e/swarm-uc3.e2e.spec.ts:150,157`). `container.ts` wires the Queues but no Worker. §5 Phase E explicitly designs the **worker placement** decision (inline-in-console-api vs new `apps/worker-sim`).
5. **Determinism contract is implicit.** `agent-builder.ts:10-11` comment says "Determinism is load-bearing"; `perturbation.ts:9-11` reiterates. Nothing enforces it. §5 adds an arch-guard item: `services/sim/**` and pack code must not import `Math.random`, `Date.now`, `node:crypto.randomBytes` without explicit whitelisting.

---

## 3. Target state — where every responsibility lands

### 3.1 Complete file→layer map

| Source (today)                                                                                                                                                                                      | Target layer                                                 | Target file                                                                                                                                                                                           | Notes                                                                                         |
| --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------- | ------ | ----------------------------------------- |
| `packages/sweep/src/sim/perturbation.ts` (RNG + applyPerturbation)                                                                                                                                  | **kernel**                                                   | unchanged                                                                                                                                                                                             | Already pure; stays.                                                                          |
| `packages/sweep/src/sim/schema.ts` (`buildTurnResponseSchema`)                                                                                                                                      | **kernel**                                                   | unchanged                                                                                                                                                                                             | Already generic.                                                                              |
| `packages/sweep/src/sim/types.ts` (generic types)                                                                                                                                                   | **kernel**                                                   | trimmed — delete the TEMPORARY COMPAT block + `sim-ssa-types-temp.ts`                                                                                                                                 | Plan 2 Task B.7 originally planned this; Plan 5 finishes it.                                  |
| `packages/sweep/src/sim/ports/*`                                                                                                                                                                    | **kernel**                                                   | unchanged                                                                                                                                                                                             | Plan 2 asset.                                                                                 |
| `packages/sweep/src/sim/aggregator.service.ts::cosineKMeans` (line 337-445)                                                                                                                         | **kernel utils**                                             | `packages/sweep/src/sim/utils/cosine-kmeans.ts`                                                                                                                                                       | Pure function — extract so it's reusable + independently testable.                            |
| `packages/sweep/src/sim/memory.service.ts::safelyEmbed`                                                                                                                                             | **kernel**                                                   | stays                                                                                                                                                                                                 | Pure wrapper around `EmbedFn`.                                                                |
| `packages/sweep/src/sim/memory.service.ts` — all SQL (topK, writeMany, recentObservable)                                                                                                            | **console-api repository**                                   | `apps/console-api/src/repositories/sim/sim-memory.repository.ts`                                                                                                                                      | The service keeps only the embedder orchestration; SQL moves out.                             |
| `packages/sweep/src/sim/aggregator.service.ts` — SQL (`loadSwarm`, `loadTerminals`)                                                                                                                 | **console-api repository**                                   | `apps/console-api/src/repositories/sim/sim-terminal.repository.ts`                                                                                                                                    | Clustering math stays in the service.                                                         |
| `packages/sweep/src/sim/aggregator-telemetry.ts` — SQL (`loadSwarmMeta`, `loadTerminalActions`)                                                                                                     | **console-api repository**                                   | `apps/console-api/src/repositories/sim/sim-terminal.repository.ts` (same file, distinct methods)                                                                                                      | One file per table-cluster; sim_swarm + sim_run + sim_turn terminals are one cluster.         |
| `apps/console-api/src/agent/ssa/sim/aggregators/pc.ts::PcAggregatorService::aggregate` SQL                                                                                                          | **console-api repository**                                   | same                                                                                                                                                                                                  | `computePcAggregate` (pure) stays in pack.                                                    |
| `apps/console-api/src/agent/ssa/sim/targets.ts` — SQL for sim_run + satellite + conjunction_event                                                                                                   | **console-api repository** (SQL) + **pack** (shape assembly) | `apps/console-api/src/repositories/sim/sim-target.repository.ts`                                                                                                                                      | `SsaTurnTargetProvider` keeps the `loadTargets` port method, delegates to the repo.           |
| `packages/sweep/src/sim/sim-orchestrator.service.ts` — SQL writes + `loadRun/countAgents/countAgentTurns`                                                                                           | **console-api repository**                                   | `apps/console-api/src/repositories/sim/sim-run.repository.ts`                                                                                                                                         | Service keeps `startStandalone`/`createFish`/`pause`/`resume`/`inject`/`status` logic.        |
| `packages/sweep/src/sim/sim-orchestrator.service.ts::enqueueTurn` + `scheduleNext`                                                                                                                  | **console-api service + infra utility**                      | service delegates to `apps/console-api/src/infra/sim-queue.ts` (thin wrapper around `simTurnQueue.add`)                                                                                               | Isolates BullMQ behind a port-sized seam.                                                     |
| `packages/sweep/src/sim/swarm.service.ts` — SQL inserts + SQL counts                                                                                                                                | **console-api repository**                                   | `apps/console-api/src/repositories/sim/sim-swarm.repository.ts`                                                                                                                                       |                                                                                               |
| `packages/sweep/src/sim/swarm.service.ts::launchSwarm` orchestration                                                                                                                                | **console-api service**                                      | `apps/console-api/src/services/sim/sim-launch.service.ts`                                                                                                                                             | Validates kind, inserts sim_swarm row, calls orchestrator.createFish, enqueues BullMQ jobs.   |
| `packages/sweep/src/sim/swarm.service.ts::onFishComplete`                                                                                                                                           | **console-api service**                                      | `apps/console-api/src/services/sim/sim-worker-hooks.service.ts`                                                                                                                                       | Called by the fish worker after each fish closes.                                             |
| `packages/sweep/src/sim/turn-runner-dag.ts` — LLM call + Zod parse (pure)                                                                                                                           | **kernel** (`.run` + `.callAgent`)                           | slimmed                                                                                                                                                                                               | No SQL; reads via repo (injected); writes via repo (injected).                                |
| `packages/sweep/src/sim/turn-runner-dag.ts` — persistence tx (line 151) + god-events SQL (line 399) + agent load (line 423)                                                                         | **console-api repository**                                   | `apps/console-api/src/repositories/sim/sim-turn.repository.ts` + `sim-run.repository.ts`                                                                                                              | Turn runner becomes a function of `(ctxBuilder, llmCall, turnRepo)`.                          |
| `packages/sweep/src/sim/turn-runner-sequential.ts` — same cut lines                                                                                                                                 | same as DAG                                                  | same                                                                                                                                                                                                  |                                                                                               |
| `packages/sweep/src/sim/promote.ts::isKgPromotable, isTerminal, describeAction, composeTitle, composeDescription, scoreScalar, percentile-less helpers, actionTarget, round`                        | **pack**                                                     | `apps/console-api/src/agent/ssa/sim/promotion-policy.ts` (pure)                                                                                                                                       | These are SSA domain judgements (`maneuver                                                    | launch | retire` is "promotable" — that's domain). |
| `packages/sweep/src/sim/promote.ts::loadSimTurn`                                                                                                                                                    | **console-api repository**                                   | `sim-turn.repository.ts` method                                                                                                                                                                       |                                                                                               |
| `packages/sweep/src/sim/promote.ts::emitSuggestionFromModal` (UC3 → suggestion + KG + audit)                                                                                                        | **console-api service**                                      | `apps/console-api/src/services/sim/sim-promotion.service.ts` (reuses existing `SsaPromotionAdapter` from Plan 1)                                                                                      | Finally fills the `SsaSimPromotionAdapter::promote` TODO (`agent/ssa/sim/promotion.ts:32`).   |
| `packages/sweep/src/sim/promote.ts::emitTelemetrySuggestions` + `findNullTelemetryColumns` + `scoreScalar`                                                                                          | **console-api service + repository**                         | service: `sim-promotion.service.ts`; SQL: `apps/console-api/src/repositories/satellite.repository.ts` gets `findNullTelemetryColumns(satelliteId)`                                                    | The scoring judgement (`sourceClass = SIM_UNCORROBORATED`) is domain → stays in pack policy.  |
| `packages/sweep/src/sim/god-channel.service.ts`                                                                                                                                                     | **console-api service**                                      | `apps/console-api/src/services/sim/god-channel.service.ts`                                                                                                                                            | Service gets the orchestrator + a `SimActionSchemaProvider` port for Zod parse.               |
| `packages/sweep/src/sim/legacy-ssa-perturbation-pack.ts` + `legacy-ssa-schema.ts`                                                                                                                   | **DELETE**                                                   | —                                                                                                                                                                                                     | Plan 2 · B.11 already made ports required; the fallbacks are dead code.                       |
| `apps/console-api/src/agent/ssa/sim/swarms/telemetry.ts` (launcher)                                                                                                                                 | **controller + service**                                     | controller: `apps/console-api/src/controllers/sim.controller.ts`; service: `SimLaunchService.startTelemetry`; the SQL that reads satellite+bus becomes `SatelliteRepository.getTelemetrySwarmContext` | Today this file is both a "use case" and a launcher — split it.                               |
| `apps/console-api/src/agent/ssa/sim/swarms/pc.ts`                                                                                                                                                   | **controller + service**                                     | same — `SimLaunchService.startPcEstimator`; `ConjunctionRepository.getPcSwarmContext`                                                                                                                 |                                                                                               |
| `apps/console-api/src/agent/ssa/sim/bus-datasheets/loader.ts` + `datasheets.json`                                                                                                                   | **pack, cleaner**                                            | stays in pack but `readFileSync` hidden behind a `BusDatasheetCatalogue` class with an explicit `ready()` method                                                                                      | Caller (`SimLaunchService.startTelemetry`) asks the pack for a prior; pack owns I/O details.  |
| `apps/console-api/src/agent/ssa/sim/aggregators/pc.ts::computePcAggregate, aggregateToSuggestion, severityFromMedian, percentile, stddev`                                                           | **pack, pure**                                               | stays in pack                                                                                                                                                                                         | Pure math is OK in a pack.                                                                    |
| `apps/console-api/src/agent/ssa/sim/aggregators/pc.ts::PcAggregatorService`                                                                                                                         | **console-api service**                                      | `apps/console-api/src/services/sim/pc-aggregator.service.ts` — reads via `SimTerminalRepository.listActionsForSwarm`, calls pack `computePcAggregate`                                                 | This is the DB-backed orchestrator from the file's own comment (`aggregators/pc.ts:146-147`). |
| `apps/console-api/src/agent/ssa/sim/targets.ts`                                                                                                                                                     | **pack (port impl) + repository (SQL)**                      | `SsaTurnTargetProvider` wraps repo; SQL in `repositories/sim/sim-target.repository.ts`                                                                                                                |                                                                                               |
| `apps/console-api/src/agent/ssa/sim/fleet-provider.ts, persona-composer.ts, prompt-renderer.ts, cortex-selector.ts, action-schema.ts, perturbation-pack.ts, aggregation-strategy.ts, kind-guard.ts` | **pack** (no change)                                         | unchanged                                                                                                                                                                                             | These are already pure port impls.                                                            |
| `apps/console-api/src/agent/ssa/sim/promotion.ts` (stub)                                                                                                                                            | **pack thin adapter**                                        | delegates to `SimPromotionService` (new)                                                                                                                                                              | Real logic lives in the service; pack just maps `SimPromoteInput` → service call.             |

### 3.2 Answers to the required questions

1. **Cortex selection** — **pack** (pure string dispatch; no I/O). Already correct in `agent/ssa/sim/cortex-selector.ts`.
2. **Swarm launch** — split between **controller** (`sim.controller.ts` Zod-parse + status mapping) and **service** (`SimLaunchService.startTelemetry|startPcEstimator|launchGeneric`). Today's `apps/console-api/src/agent/ssa/sim/swarms/telemetry.ts` body goes to the service.
3. **Turn persistence** — **repository**: new `repositories/sim/sim-turn.repository.ts`. Consumes two methods: `insertAgentTurnsAndMemories(tx-like-input)` and `listGodEventsAtOrBefore`.
4. **Run-scheduling state machine** — **service** (`SimOrchestrator`) + **repository** (`sim-run.repository.ts`). BullMQ hidden behind `infra/sim-queue.ts`.
5. **10 ports placement** — **port interfaces stay in kernel** (`packages/sweep/src/sim/ports/*`). **Port impls stay in the pack** — **except** the one whose impl is materially a service: `SimPromotionAdapter`. Its pack wrapper (`agent/ssa/sim/promotion.ts`) delegates to the new `SimPromotionService`.
   - Redundancy review after layering: **SimKindGuard** and **SimCortexSelector** and **SimAggregationStrategy** are all "tiny pure functions" that could collapse into a single `SimPolicyPort` in a future plan — but not in Plan 5. Explicit non-goal.
6. **How does sim consume sweep?** — Through `SimPromotionService`, which is instantiated in `container.ts` with the existing `SsaPromotionAdapter` from Plan 1 injected. The boundary is:
   - Sim side owns the **rendering** of modal → `AcceptedSuggestionInput` (domain knowledge: what is a "modal", how to summarise clusters, severity rules).
   - Sweep side (already in place) owns the **write** path: `research_cycle` + `research_finding` + `research_edge` + `sweep_suggestion` + reviewer-inbox routing. Zero duplication of `sweep_suggestion` writes in the sim stack.
7. **HTTP routes from Plan 3** — `routes/sim.routes.ts` with:
   - `POST /api/sim/telemetry/start` → `simTelemetryStartController` → `SimLaunchService.startTelemetry`
   - `POST /api/sim/pc/start` → `simPcStartController` → `SimLaunchService.startPcEstimator`
   - Plus (Plan 5 new, derived from existing `SimOrchestrator` surface): `POST /api/sim/runs/:id/inject`, `POST /api/sim/runs/:id/pause`, `POST /api/sim/runs/:id/resume`, `GET /api/sim/runs/:id/status`, `GET /api/sim/swarms/:id/status`. These wrap surfaces that exist today on `SimOrchestrator` / `SwarmService` but aren't reachable over HTTP.

### 3.3 Target file tree

```
packages/sweep/src/sim/                            # KERNEL — generic only
  ports/                                           # unchanged
  turn-runner-dag.ts                               # slim (no SQL)
  turn-runner-sequential.ts                        # slim (no SQL)
  memory.service.ts                                # embedder orchestration only
  sim-orchestrator.service.ts                      # state machine only; SQL + Queue injected
  swarm.service.ts                                 # DELETE — moved to console-api
  aggregator.service.ts                            # split: cluster math stays; SQL goes to console-api
  aggregator-telemetry.ts                          # split: stats math stays; SQL goes to console-api
  promote.ts                                       # DELETE — moved to console-api
  god-channel.service.ts                           # DELETE — moved to console-api
  legacy-ssa-perturbation-pack.ts                  # DELETE
  legacy-ssa-schema.ts                             # DELETE
  types.ts                                         # purged of compat block
  schema.ts                                        # unchanged
  perturbation.ts                                  # unchanged
  utils/cosine-kmeans.ts                           # NEW (extracted)

apps/console-api/src/
  controllers/
    sim.controller.ts                              # NEW — 7 handlers
  routes/
    sim.routes.ts                                  # NEW
    index.ts                                       # mount
  services/sim/                                    # NEW FOLDER
    sim-launch.service.ts                          # startTelemetry / startPcEstimator / launchGeneric
    sim-promotion.service.ts                       # modal → AcceptedSuggestionInput; telemetry scalars → per-scalar suggestion
    pc-aggregator.service.ts                       # DB-backed orchestrator
    telemetry-aggregator.service.ts                # DB-backed orchestrator
    god-channel.service.ts                         # moved
    sim-worker-hooks.service.ts                    # onFishComplete, onSwarmAggregated — called by workers
  repositories/sim/                                # NEW FOLDER
    sim-swarm.repository.ts                        # sim_swarm rows
    sim-run.repository.ts                          # sim_run rows
    sim-turn.repository.ts                         # sim_turn + god turns + terminal turn query
    sim-memory.repository.ts                       # sim_agent_memory (pgvector)
    sim-agent.repository.ts                        # sim_agent insert + list
    sim-terminal.repository.ts                     # cross-cutting read for aggregator (sim_run+sim_turn+sim_agent)
    sim-target.repository.ts                       # seed_applied + satellite + conjunction_event lookups
  agent/ssa/sim/                                   # PACK — thinned
    action-schema.ts                               # unchanged
    fleet-provider.ts                              # unchanged
    targets.ts                                     # port impl only; SQL via SimTargetRepository
    persona-composer.ts                            # unchanged
    prompt-renderer.ts                             # unchanged
    cortex-selector.ts                             # unchanged
    perturbation-pack.ts                           # unchanged
    aggregation-strategy.ts                        # unchanged
    kind-guard.ts                                  # unchanged
    promotion.ts                                   # maps SimPromoteInput → SimPromotionService call
    promotion-policy.ts                            # NEW — pure domain judgements extracted from promote.ts
    aggregators/pc.ts                              # only computePcAggregate + helpers; DB orchestrator moved
    bus-datasheets/
      loader.ts                                    # wrapped in BusDatasheetCatalogue class
      datasheets.json                              # unchanged
    swarms/                                        # DELETE both files — replaced by SimLaunchService
  infra/
    sim-queue.ts                                   # NEW — wraps simTurnQueue/swarmFishQueue/swarmAggregateQueue
  schemas/
    sim.schema.ts                                  # NEW — Zod for routes
  types/
    sim.types.ts                                   # NEW — DTO shapes for controllers/routes
  transformers/
    sim-swarm.transformer.ts                       # NEW — row → SimSwarmStatusView
```

---

## 4. Phased migration

Each task is TDD with the same green-bar loop as the 2026-04-16 plan: failing test → minimal change → pass → commit.

### Phase A — Sim repositories (pull SQL out of kernel + pack)

**Goal:** every SQL statement under `packages/sweep/src/sim/**` and `apps/console-api/src/agent/ssa/sim/**` is gone, replaced by method calls on `repositories/sim/*.repository.ts`.

- [ ] **A.1** Create `repositories/sim/sim-swarm.repository.ts`. Port the sim_swarm SQL from `packages/sweep/src/sim/swarm.service.ts:98-110,228-253,255-267` and `aggregator.service.ts:152-160` and `aggregator-telemetry.ts::loadSwarmMeta` (line 53-71). Methods: `insert`, `findById`, `countFishByStatus`, `markDone/Failed`, `markTelemetryAggregateSnapshot`, `markAggregateSnapshot`. Unit test: round-trip one insert + one update.
- [ ] **A.2** Create `repositories/sim/sim-run.repository.ts`. Port from `sim-orchestrator.service.ts:204-224,421-443` and `turn-runner-dag.ts:449-459` (`maybeCloseRun`). Methods: `insert`, `findById`, `updateStatus`, `countAgents`, `countAgentTurns`.
- [ ] **A.3** Create `repositories/sim/sim-agent.repository.ts`. Port from `agent-builder.ts:73-79` and `turn-runner-dag.ts:423-442`. Methods: `insert`, `listByRun`.
- [ ] **A.4** Create `repositories/sim/sim-turn.repository.ts`. Port from `sim-orchestrator.service.ts:400-414,446-469`, `turn-runner-dag.ts:151-208,399-421`, and `promote.ts:51-60`. Methods: `insertAgentTurn`, `insertMany`, `insertGodTurn`, `findById`, `listGodEventsAtOrBefore`.
- [ ] **A.5** Create `repositories/sim/sim-memory.repository.ts`. Port all SQL from `memory.service.ts:74-111,121-176,183-222`. Keep the method names identical (`topK`, `recentObservable`, `writeOne`, `writeMany`) so `MemoryService` becomes a thin wrapper.
- [ ] **A.6** Create `repositories/sim/sim-terminal.repository.ts`. Port `aggregator.service.ts::loadTerminals` (line 163-236) and `aggregator-telemetry.ts::loadTerminalActions` and `aggregators/pc.ts::aggregate` rows block (line 159-176). Method: `listTerminalsForSwarm(swarmId)` + `listTerminalActionsForSwarm(swarmId)`.
- [ ] **A.7** Create `repositories/sim/sim-target.repository.ts`. Port the two SQL queries in `agent/ssa/sim/targets.ts:84-148` + `150-246`. Methods: `getTelemetryTargetContext(simRunId)`, `getPcTargetContext(simRunId)`.
- [ ] **A.8** Extend `repositories/satellite.repository.ts`: add `findNullTelemetryColumns(satelliteId)` and `getTelemetrySwarmContext(satelliteId)` (currently the two ad-hoc SQL blobs in `swarms/telemetry.ts:46-75` and `promote.ts:449-470,545-560`). Extend `conjunction.repository.ts` with `getPcSwarmContext(conjunctionId)` (replaces `swarms/pc.ts:31-45` SQL).
- [ ] **A.9** Arch-guard: forbid `drizzle-orm` imports and ``sql` `` template literals in `packages/sweep/src/sim/**` and `apps/console-api/src/agent/ssa/sim/**`. Guard goes RED on commit, drives the A.1-A.8 extraction.

**Risk gate A:** UC3 E2E green, telemetry unit green.

### Phase B — Routes + controllers + schemas + types (HTTP seam for sim)

- [ ] **B.1** Create `schemas/sim.schema.ts` (Zod bodies for telemetry/pc start, god inject, pause, resume) + `types/sim.types.ts` (`SimSwarmStatusView`, `SimRunStatusView`, etc.).
- [ ] **B.2** Create `controllers/sim.controller.ts` with 7 handlers (telemetry-start, pc-start, inject, pause, resume, run-status, swarm-status). Each is ≤ 20 lines, delegates to one service method.
- [ ] **B.3** Create `routes/sim.routes.ts` and mount in `routes/index.ts`. Update `AppServices` type with `simLaunch: SimLaunchService`, `simOrchestrator: SimOrchestrator`, `simStatus: SimStatusService` (or fold status into launch). Tests: `tests/unit/routes/sim.spec.ts` (buildApp → 201/422/409 cases per route with fixture mode).
- [ ] **B.4** Arch-guard: controllers never import `@interview/sweep`, never call `drizzle-orm`.

**Risk gate B:** Plan 3's acceptance test for `POST /api/sim/telemetry/start` goes from "NEW" to green.

### Phase C — Services (consolidate launch + promotion + god-channel)

- [ ] **C.1** Create `services/sim/sim-launch.service.ts`. Inject `SimOrchestrator`, `SimSwarmRepository`, `SatelliteRepository`, `ConjunctionRepository`, `BusDatasheetCatalogue`, `SimKindGuard` port, `SimQueue` infra, `logger`. Port in the bodies of `agent/ssa/sim/swarms/telemetry.ts` and `swarms/pc.ts` + `packages/sweep/src/sim/swarm.service.ts::launchSwarm`. Public API: `startTelemetry({satelliteId,fishCount})`, `startPcEstimator({conjunctionEventId,fishCount})`, `launchGeneric(LaunchSwarmInput)`.
- [ ] **C.2** Create `services/sim/sim-promotion.service.ts`. Inject `SsaPromotionAdapter` (Plan 1), `SatelliteRepository`, `ConfidenceService`, `SimSwarmRepository`, `logger`. Port in the bodies of `promote.ts::emitSuggestionFromModal` and `promote.ts::emitTelemetrySuggestions`. Pure domain helpers (`isKgPromotable`, `describeAction`, `composeTitle`, `composeDescription`, `scoreScalar`) import from the pack's `promotion-policy.ts` (created in C.4). Finally fills the `SsaSimPromotionAdapter::promote` stub (`agent/ssa/sim/promotion.ts:32`).
- [ ] **C.3** Create `services/sim/god-channel.service.ts`. Wraps `SimOrchestrator.inject` with a Zod parse that consumes the `SimActionSchemaProvider` port for the event envelope. Delete `packages/sweep/src/sim/god-channel.service.ts` + `legacy-ssa-schema.ts`.
- [ ] **C.4** Create `agent/ssa/sim/promotion-policy.ts` — extract pure SSA domain rules from `packages/sweep/src/sim/promote.ts` (the `isKgPromotable`, `isTerminal`, `describeAction`, `actionTarget`, `scoreScalar`, `composeTitle`, `composeDescription` functions).
- [ ] **C.5** Create `services/sim/sim-worker-hooks.service.ts`. Owns `onFishComplete` (from `swarm.service.ts:167-184`) and `onSwarmAggregated` (new — bundles the worker's close-out logic currently inside `swarm-aggregate.worker.ts`).
- [ ] **C.6** Create `services/sim/pc-aggregator.service.ts` and `services/sim/telemetry-aggregator.service.ts` — DB-backed orchestrators that call pure math in pack / kernel.
- [ ] **C.7** Slim `packages/sweep/src/sim/swarm.service.ts` into a **re-export shim** for one release: `export class SwarmService { constructor(private launcher: SimLaunchService) {} launchSwarm(o) { return this.launcher.launchGeneric(o) } }`. Delete in Phase F.

**Risk gate C:** all sim unit + integration tests pass with services-as-main-orchestrator.

### Phase D — Kernel slim-down (inject repos everywhere)

- [ ] **D.1** `MemoryService` constructor takes `SimMemoryRepository` + `EmbedFn`. All SQL gone.
- [ ] **D.2** `SimOrchestrator` constructor takes `SimRunRepository`, `SimSwarmRepository`, `SimTurnRepository`, `SimAgentRepository`, `SimQueue`, `SimFleetProvider`, `SimAgentPersonaComposer`, `SimPerturbationPack`. All SQL gone.
- [ ] **D.3** `DagTurnRunner` + `SequentialTurnRunner` constructors take `SimRunRepository`, `SimTurnRepository`, `SimMemoryRepository`, `MemoryService`, `cortexRegistry`, `llmMode`, `targets`, `prompt`, `cortexSelector`, `schemaProvider`. The multi-table tx (DAG lines 151-208) becomes one repo method: `SimTurnRepository.persistTurn({agentTurns, memoryRows})`.
- [ ] **D.4** `AggregatorService` becomes pure-ish: takes `SimTerminalRepository` for the read, uses `cosine-kmeans.ts` util for math, calls `SimAggregationStrategy` for labels. `cosineKMeans` function (`aggregator.service.ts:337-445`) extracted verbatim to `packages/sweep/src/sim/utils/cosine-kmeans.ts` with unit tests.
- [ ] **D.5** Delete `packages/sweep/src/sim/types.ts` TEMPORARY COMPAT block + `sim-ssa-types-temp.ts`. Delete `legacy-ssa-*.ts`. Update Plan 2 arch-guard allowlist: remove `types.ts` entry.
- [ ] **D.6** Delete `packages/sweep/src/sim/swarm.service.ts` shim (from C.7). Update `packages/sweep/src/index.ts` to drop `SwarmService` / `SwarmServiceDeps`. Update any remaining sweep-external callers to import from `apps/console-api/src/services/sim/*`.
- [ ] **D.7** `buildSweepContainer` loses its `opts.sim` branch entirely — sim is no longer a sub-container of sweep. It becomes a sibling constellation wired in `apps/console-api/src/container.ts`. Pure simplification.

**Risk gate D:** The 6321-line sim stack is now roughly **-1200 lines** of SQL/orchestration duplication, and `packages/sweep/src/sim/` is pure kernel.

### Phase E — Worker placement + BullMQ seam

Today: `createSimTurnWorker` / `createSwarmFishWorker` / `createSwarmAggregateWorker` are **exported but never instantiated** outside the E2E test (`swarm-uc3.e2e.spec.ts:150,157`). Phase E commits to a decision.

- [ ] **E.1** **Decision: workers live in `apps/console-api`**, not a new `apps/worker-sim` process. Rationale: Plan 3 CLI already expects the HTTP start endpoint to run the swarm "end-to-end" against a running console-api (Plan 3 B's acceptance: "`pnpm -C packages/cli start` connects to a running console-api and executes at least one command end-to-end"). A separate worker process would require docker-compose changes out of scope for this refactor. Document the decision with an explicit escape hatch: `infra/sim-queue.ts` + the worker factories stay single-import away from being moved, so a future `apps/worker-sim` is a no-design-change refactor.
- [ ] **E.2** Create `apps/console-api/src/infra/sim-workers.ts` — a composer that calls the three `create*Worker` factories with dependencies pulled from `AppServices`. Inline-boot guarded by an env var (`SIM_WORKERS=inline`, default on in dev, off in `NODE_ENV=test` so vitest doesn't spin workers twice).
- [ ] **E.3** Move the aggregate worker's inline body (`swarm-aggregate.worker.ts:64-150` and `runTelemetryPath`) to `services/sim/sim-worker-hooks.service.ts::onSwarmAggregated`. The worker factory becomes a 5-line adapter (`processor: (job) => service.onSwarmAggregated(job.data.swarmId)`).
- [ ] **E.4** Same treatment for `swarm-fish.worker.ts` and `sim-turn.worker.ts`: the kind-routing and turn-driver choice already live in `sim-turn.worker.ts:65-80` — hoist that into `SimOrchestrator.runTurnByKind(simRunId, turnIndex)` so the worker is a thin queue listener.
- [ ] **E.5** Arch-guard: workers never import `drizzle-orm` directly.

**Risk gate E:** `pnpm -C apps/console-api dev` boots and a `POST /api/sim/telemetry/start` actually completes a swarm (end-to-end, not just returns 201).

### Phase F — Cleanup + ports consolidation review

- [ ] **F.1** Delete `packages/sweep/src/sim/swarm.service.ts` shim (if still present).
- [ ] **F.2** Update `packages/sweep/src/index.ts`: stop re-exporting `SwarmService`, `SimOrchestrator`, `AggregatorService`, etc. from `apps/console-api`. Kernel re-exports reduce to: port types, `buildTurnResponseSchema`, `swarmConfigSchema`, `applyPerturbation`, `rngFromSeed`, `cosineKMeans`, `DagTurnRunner`, `SequentialTurnRunner`, `MemoryService`.
- [ ] **F.3** Plan 2 arch-guard tightening: add `apps/console-api/src/agent/ssa/sim/**` allow-list for `drizzle-orm` = empty (should already be empty post-A.7).
- [ ] **F.4** Documentation: update `TODO.md` to mark the SOLID-debt entries complete, link to this plan. Record the "10 ports collapse" note for a hypothetical Plan 6.

---

## 5. Risks + explicit callouts

1. **Determinism (load-bearing)** — `agent-builder.ts:10-11` and `perturbation.ts:9-11` comments state that the fixture-mode prompt cache keys on `sha256(system+user)`. Phase D's reshuffle of the turn runner's context assembly must not reorder any field. Mitigation: add a fixture snapshot test in Phase D that replays the UC3 E2E's cached prompts byte-for-byte before + after the refactor — any drift fails the run.
2. **Worker placement** — If product later wants to scale fish concurrency past what a single console-api process can handle, Phase E's inline workers become a bottleneck. Mitigation is pre-designed: `infra/sim-workers.ts` is one file; extracting to `apps/worker-sim` is a copy-paste, not a redesign.
3. **BullMQ job payload compatibility** — Moving `onFishComplete` / `onSwarmAggregated` from workers to services must keep job payloads unchanged so in-flight jobs on a deployed queue survive the cutover. Mitigation: Phase E adds a contract test (`tests/unit/worker-contract.spec.ts`) that pins the JSON shape of `SwarmFishJobPayload`, `SwarmAggregateJobPayload`, `SimTurnJobPayload` (all three still defined in `packages/sweep/src/jobs/queues.ts`, unchanged by this plan).
4. **Sweep container no longer owns sim** — Downstream: `buildSweepContainer` signature changes (Phase D.7). Anything outside the monorepo that imports it (none today; verified via `grep -rn "buildSweepContainer"` = 5 in-repo matches only) would break. Mitigation: document in CHANGELOG under "Breaking".
5. **Test fixture location** — UC3 E2E (`apps/console-api/tests/e2e/swarm-uc3.e2e.spec.ts`) instantiates both workers + passes 10 sim ports. Its `buildSweepContainer({...,sim:{...}})` call shape changes twice (Phase C shim, Phase D removal). Keep the test as the single canonical end-to-end, re-point its imports one task at a time.
6. **Redundant ports after layering** — `SimKindGuard` (58 L), `SimCortexSelector` (29 L), and part of `SimAggregationStrategy` are three tiny pure dispatchers. They are **not** collapsed in Plan 5 — the framing is layer migration, not port rationalisation. A follow-up Plan 6 should consider folding them into a single `SimDomainPolicy` port (ISP lean — today's interfaces are too narrow to warrant 3 files).
7. **`promote.ts` is 592 lines of god function** — Splitting it into `sim-promotion.service.ts` + `promotion-policy.ts` + `SatelliteRepository.findNullTelemetryColumns` is the largest individual move. Do it as a single task (C.2 + C.4) so the repo's tests don't see a half-broken intermediate. TDD target: unit test that `SimPromotionService.emitFromModal(aggregate)` produces the same `sweep_suggestion` row as the pre-refactor path, using a golden fixture captured before the refactor starts.
8. **`emitSuggestionFromModal` writes to 4 tables in sequence without a transaction** (`promote.ts:134,169,209,223,229,266`). That's a pre-existing bug — Plan 5 refactors around it but doesn't fix it. Explicit follow-up: add a TODO in `SimPromotionService` to wrap the sequence in `db.transaction`. Out of scope here to keep the behaviour-preservation contract clean.
9. **Disk-read in pack** (`bus-datasheets/loader.ts:18`) — Wrapping in a class doesn't fix the "process-global cache" concern. Acceptable for Plan 5 because the JSON is static + checked into the repo. If datasheets ever become DB-backed, the `BusDatasheetCatalogue` is the seam to swap.
10. **Confidence cycle** — `container.ts:183-186` today can't wire `ConfidenceService` into `SsaPromotionAdapter` because of a build-order cycle. Phase C.2 creates `SimPromotionService` which _does_ need `ConfidenceService` (for sim-source-class bookkeeping). Verify in a small dependency-graph spike during Phase C that we don't reintroduce a cycle. If we do, resolve by wiring confidence through a setter (same technique as `simHook.cb` in `packages/sweep/src/config/container.ts:159`).

---

### Critical Files for Implementation

- /home/jerem/interview-thalamus-sweep/packages/sweep/src/sim/sim-orchestrator.service.ts
- /home/jerem/interview-thalamus-sweep/packages/sweep/src/sim/swarm.service.ts
- /home/jerem/interview-thalamus-sweep/packages/sweep/src/sim/promote.ts
- /home/jerem/interview-thalamus-sweep/apps/console-api/src/agent/ssa/sim/swarms/telemetry.ts
- /home/jerem/interview-thalamus-sweep/apps/console-api/src/container.ts
