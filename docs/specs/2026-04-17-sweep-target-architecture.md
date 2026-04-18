# Target Architecture — `packages/sweep/` agnostic + SSA consolidation

**Date:** 2026-04-17
**Status:** proposal (awaiting approval)
**Supersedes in part:** `docs/superpowers/plans/2026-04-17-sim-agnostic-refactor.md` (merged into Plan 2 below)

## Intent

Turn `packages/sweep/` into a **generic sweep engine** (no SSA business logic), with all SSA concrete implementations, services, controllers, ingesters, routes, and types living in `apps/console-api/` alongside the existing agent/ssa pack. `packages/sweep/src/sim/` becomes an agnostic subkernel of that engine. `packages/cli/` becomes a pure Ink/React TUI talking to console-api over HTTP.

### Three principles

1. **Kernel packages (`packages/*`) own mechanisms, not domain.** Ports + interfaces only. Zero knowledge of "satellite", "operator", "conjunction", "regime", etc.
2. **SSA vocabulary lives in `apps/console-api/`.** Services, repositories, controllers, routes, ingesters, DTOs, types — the whole 5-layer stack for SSA.
3. **`packages/cli/` is presentation only.** No DB client, no queue client, no SSA concept. Fetches HTTP routes; renders Ink components.

Ports are the contracts between kernel and SSA. They live in `packages/<pkg>/src/ports/`. Implementations (`*.pg.ts`, `*.ssa.ts`) live in console-api.

---

## Target package boundaries

### `packages/sweep/` — post-refactor

```
packages/sweep/src/
  config/
    container.ts         # port-injecting: accepts all SSA providers as required opts
    redis.ts             # unchanged
  ports/                 # NEW — kernel contracts
    finding-schema.port.ts           # FindingDomainSchema — validates domain payload of a suggestion
    nano-audit.port.ts               # DomainAuditProvider — emits candidate findings per domain
    promotion.port.ts                # SweepPromotionAdapter — applies an accepted suggestion (KG write, etc.)
    finding-routing.port.ts          # FindingRoutingPolicy — decides which tier sees which finding
    resolution-handlers.port.ts      # ResolutionHandlerRegistry — maps resolution action.kind → handler
    ingestion-registry.port.ts       # IngestionSourceProvider — pack registers its fetchers
    index.ts
  repositories/
    sweep.repository.ts  # generic over TSuggestion shape; Redis schema stores { domain, attributes, summary, severity }
  services/
    nano-sweep.service.ts        # generic wave-caller; delegates prompt + result parsing to DomainAuditProvider port
    sweep-resolution.service.ts  # generic review/audit flow; delegates action handlers to ResolutionHandlerRegistry
    finding-router.service.ts    # generic routing; consumes FindingRoutingPolicy port
    messaging.service.ts         # stays (stub)
  sim/                   # agnostic kernel — see Plan 2
    ports/ …
    …
  jobs/
    ingestion-registry.ts        # port-driven: pack registers fetchers; registry is a dispatcher
    queues.ts
    schedulers.ts
    workers/
      helpers.ts
      ingestion.worker.ts        # generic — pulls spec from registry
      sweep.worker.ts            # generic
      sim-turn.worker.ts         # agnostic sim turn driver
      swarm-fish.worker.ts       # generic swarm runner
      swarm-aggregate.worker.ts  # generic; promotion via SimPromotionAdapter port
  middleware/
    auth.middleware.ts   # generic
  utils/
    llm-json-parser.ts   # generic
    controller-error-handler.ts  # generic
    sql-helpers.ts       # kept if generic; else moved (audit content first)
    # doctrine-parser.ts MOVES — SSA
  transformers/
    shared.dto.ts        # generic DTOs if any remain
    # sweep.dto.ts SPLITS — see mapping
    # satellite-sweep-chat.dto.ts MOVES
  types/
    geojson.d.ts         # generic (tolerated — geo is generic enough)
    # satellite.types.ts MOVES
  index.ts               # exports engine surface only
```

Forbidden imports in `packages/sweep/**`: `satellite`, `operator`, `operator_country`, `orbit_regime`, `platform_class`, `satellite_bus`, `conjunction_event`, `TELEMETRY_SCALAR_KEYS` from `@interview/db-schema`; any SSA-named types/services from own source.

### `apps/console-api/` — post-refactor

```
apps/console-api/src/
  agent/
    ssa/                 # existing + sim + sweep domain pack
      cortex-data-provider.ts  # existing
      cortex-classifications.ts
      daemon-dags.ts
      domain-config.ts
      pre-summarize.ts
      vocabulary.ts
      web-search-prompt.ts
      skills/ …
      sim/                           # Plan 2 output
        fleet-provider.pg.ts
        targets.pg.ts
        persona-composer.ts
        prompt-renderer.ts
        cortex-selector.ts
        perturbation-pack.ts
        action-schema.ts
        aggregation-strategy.ts
        kind-guard.ts
        promotion.ts
        bus-datasheets/{loader.ts,datasheets.json}
        swarms/{telemetry.ts,pc.ts}
        aggregators/{telemetry.ts,pc.ts}
        index.ts
      sweep/                         # Plan 1 output — NEW
        finding-schema.ssa.ts        # SSA InsertSuggestion/SweepSuggestionRow → generic {domain,attributes} serializer
        audit-provider.ssa.ts        # ex-nano-sweep.service.ts body (satellite-catalog audit logic)
        promotion.ssa.ts             # ex-sweep-resolution handlers (update_field, link_payload, reassign_op_country, enrich)
        finding-routing.ssa.ts       # ex-finding-routing.ts
        resolution-handlers.ssa.ts   # SSA action dispatcher
        doctrine-parser.ssa.ts       # ex-utils/doctrine-parser.ts
        ingesters/                   # 6 fetchers
          tle-history-fetcher.ts
          itu-filings-fetcher.ts
          launch-manifest-fetcher.ts
          fragmentation-events-fetcher.ts
          notam-fetcher.ts
          space-weather-fetcher.ts
          index.ts                   # registers all with IngestionSourceProvider
        index.ts

  controllers/
    # existing + NEW:
    sim.controller.ts                # Plan 3 — telemetry/pc swarm routes
    why.controller.ts                # Plan 3
    admin-sweep.controller.ts        # MOVED from sweep (generic) — uses services from console-api + sweep ports
    satellite-sweep-chat.controller.ts  # MOVED from sweep (SSA)
    kg-graph.controller.ts           # Plan 3
    repl-interpret.controller.ts     # Plan 3

  routes/
    # existing + NEW:
    sim.routes.ts                    # Plan 3
    why.routes.ts                    # Plan 3
    admin-sweep.routes.ts            # MOVED (ex-routes/admin.routes.ts in sweep)
    satellite-sweep-chat.routes.ts   # MOVED
    (extend) kg.routes.ts            # add /graph/:id
    (extend) sweep.routes.ts         # add /resolve
    (extend) repl.routes.ts          # add /interpret

  services/
    # existing + NEW:
    satellite.service.ts             # MOVED from sweep (SSA — catalog queries)
    satellite-sweep-chat.service.ts  # MOVED (SSA)
    # (NanoSweepService, SweepResolutionService STAY in sweep as generic engines;
    #  console-api wires them with SSA providers)

  repositories/
    # existing has lots already (satellite.repository.ts etc. already here!)
    satellite-sweep-chat.repository.ts  # MOVED
    # satellite.repository.ts: console-api ALREADY HAS ONE.
    # Decision: merge the sweep version into console-api's existing one (see mapping §).
    # sweep-suggestion data stays Redis-backed via SweepRepository<SsaSuggestion>
    # wired in console-api container with the SSA schema.

  transformers/
    # existing + NEW:
    satellite-sweep-chat.dto.ts      # MOVED
    sweep-ssa.dto.ts                 # ex-sweep.dto.ts SSA portion (SweepCategory/Severity/ResolutionPayload union)

  types/
    # existing + NEW:
    satellite-sweep.types.ts         # MOVED from sweep types/satellite.types.ts

  container.ts                        # extended: wires ALL ssa providers (thalamus + sim + sweep)
```

### `packages/cli/` — post-refactor

```
packages/cli/src/
  app.tsx
  boot.ts              # ~80 lines, only HTTP + UI wiring
  index.ts
  components/ …
  renderers/ …
  router/ …
  memory/ …
  adapters/
    http.ts            # NEW — fetch wrapper
    telemetry.ts       # fetch client
    pcEstimator.ts     # fetch client
    resolution.ts      # fetch client
    graph.ts           # fetch client
    why.ts             # fetch client
    logs.ts            # local pino ring buffer (UI concern)
    thalamus.ts        # fetch client (already HTTP today)
  util/ …
```

Forbidden deps: `@interview/sweep`, `@interview/thalamus`, `@interview/db-schema`, `drizzle-orm`, `pg`, `ioredis`.

---

## Complete file mapping

### `packages/sweep/src/config/`

| File           | Action        | Notes                                                                                                                              |
| -------------- | ------------- | ---------------------------------------------------------------------------------------------------------------------------------- |
| `container.ts` | STAY, rewrite | `BuildSweepOpts` extends with ALL ports (schema, audit, promotion, routing, handlers, ingestion). Validates presence; no defaults. |
| `redis.ts`     | STAY          | Unchanged.                                                                                                                         |

### `packages/sweep/src/controllers/`

| File                                 | Action | Destination                                                           | Notes                                                                                                                                                                      |
| ------------------------------------ | ------ | --------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `admin-sweep.controller.ts`          | MOVE   | `apps/console-api/src/controllers/admin-sweep.controller.ts`          | Generic over suggestion shape; console-api owns its HTTP surface. Import-fixes: `NanoSweepService` + `SweepRepository` + `SweepResolutionService` from `@interview/sweep`. |
| `satellite-sweep-chat.controller.ts` | MOVE   | `apps/console-api/src/controllers/satellite-sweep-chat.controller.ts` | SSA.                                                                                                                                                                       |

### `packages/sweep/src/routes/`

| File                             | Action        | Destination                                                  |
| -------------------------------- | ------------- | ------------------------------------------------------------ |
| `admin.routes.ts`                | MOVE → rename | `apps/console-api/src/routes/admin-sweep.routes.ts`          |
| `satellite-sweep-chat.routes.ts` | MOVE          | `apps/console-api/src/routes/satellite-sweep-chat.routes.ts` |

### `packages/sweep/src/services/`

| File                              | Action | Destination                                                                                                                                                                                    | Notes                                                                                                                                                                                                                                                         |
| --------------------------------- | ------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `nano-sweep.service.ts`           | SPLIT  | generic part STAYS in sweep; SSA audit body → `apps/console-api/src/agent/ssa/sweep/audit-provider.ssa.ts`                                                                                     | Generic service drives the wave-caller; injected `DomainAuditProvider` port supplies prompt, batching strategy, result schema, feedback mining. Remove direct `SatelliteRepository` and `operator-country` batching — those belong to the SSA audit provider. |
| `sweep-resolution.service.ts`     | SPLIT  | generic flow STAYS; SSA handlers (`update_field`, `link_payload`, `unlink_payload`, `reassign_operator_country`, `enrich`) → `apps/console-api/src/agent/ssa/sweep/resolution-handlers.ssa.ts` | Generic service accepts `ResolutionHandlerRegistry` port (`handle(actionKind, payload)`), orchestrates retries/audit/KG-log. SSA handlers register themselves.                                                                                                |
| `finding-routing.ts`              | MOVE   | `apps/console-api/src/agent/ssa/sweep/finding-routing.ssa.ts`                                                                                                                                  | SSA-hardcoded cortex→tier map. Replaced in sweep by a `FindingRoutingPolicy` port consumer.                                                                                                                                                                   |
| `messaging.service.ts`            | STAY   | —                                                                                                                                                                                              | Stub, generic.                                                                                                                                                                                                                                                |
| `satellite.service.ts`            | MOVE   | `apps/console-api/src/services/satellite.service.ts`                                                                                                                                           | SSA — catalog queries. If console-api already has overlapping satellite.service.ts, merge behavior there.                                                                                                                                                     |
| `satellite-sweep-chat.service.ts` | MOVE   | `apps/console-api/src/services/satellite-sweep-chat.service.ts`                                                                                                                                | SSA.                                                                                                                                                                                                                                                          |
| `viz.service.ts`                  | MOVE   | `apps/console-api/src/services/viz.service.ts`                                                                                                                                                 | Currently a stub consumed only by `satellite-sweep-chat`; moves with it.                                                                                                                                                                                      |

### `packages/sweep/src/repositories/`

| File                                 | Action            | Destination                                                            | Notes                                                                                                                                                                                                                                                                                                                                                                                                              |
| ------------------------------------ | ----------------- | ---------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `sweep.repository.ts`                | GENERALIZE + STAY | —                                                                      | Becomes `SweepRepository<TSuggestion>` generic over a serializer `FindingDomainSchema`. The Redis keys (`sweep:suggestions:{id}`, `sweep:index:pending`, `sweep:index:all`, `sweep:counter`, `sweep:feedback`) remain. The fields `operatorCountryId/operatorCountryName/affectedSatellites/category/severity` move to a Hash attribute blob serialized by the SSA schema. TTL + sorted-set indexing stay generic. |
| `satellite.repository.ts`            | MOVE (merge)      | `apps/console-api/src/repositories/satellite.repository.ts`            | console-api already has a file by this name — merge behaviors; check for symbol collisions first.                                                                                                                                                                                                                                                                                                                  |
| `satellite-sweep-chat.repository.ts` | MOVE              | `apps/console-api/src/repositories/satellite-sweep-chat.repository.ts` | SSA.                                                                                                                                                                                                                                                                                                                                                                                                               |

### `packages/sweep/src/transformers/`

| File                          | Action | Destination                                                                                                                                                                                                                                                               | Notes                                                                                                       |
| ----------------------------- | ------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------- |
| `sweep.dto.ts`                | SPLIT  | generic portion STAYS as `transformers/sweep-generic.dto.ts` (pagination, reviewer notes schemas); SSA portion → `apps/console-api/src/transformers/sweep-ssa.dto.ts` (`SweepCategory`, `SweepSeverity`, `ResolutionPayload` discriminated union and all Action subtypes) | ResolutionPayload is purely SSA (update_field, link_payload, reassign_operator_country…) — moves wholesale. |
| `satellite-sweep-chat.dto.ts` | MOVE   | `apps/console-api/src/transformers/satellite-sweep-chat.dto.ts`                                                                                                                                                                                                           | SSA.                                                                                                        |
| `shared.dto.ts`               | STAY   | —                                                                                                                                                                                                                                                                         | Generic.                                                                                                    |

### `packages/sweep/src/types/`

| File                 | Action | Destination                                                                                               |
| -------------------- | ------ | --------------------------------------------------------------------------------------------------------- |
| `satellite.types.ts` | MOVE   | `apps/console-api/src/types/satellite-sweep.types.ts` (merge with existing satellite.types.ts if overlap) |
| `geojson.d.ts`       | STAY   | Generic.                                                                                                  |

### `packages/sweep/src/utils/`

| File                          | Action | Destination                                                   | Notes                                                                                                              |
| ----------------------------- | ------ | ------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------ |
| `doctrine-parser.ts`          | MOVE   | `apps/console-api/src/agent/ssa/sweep/doctrine-parser.ssa.ts` | SSA (regulatory doctrine).                                                                                         |
| `llm-json-parser.ts`          | STAY   | —                                                             | Generic.                                                                                                           |
| `controller-error-handler.ts` | STAY   | —                                                             | Generic.                                                                                                           |
| `sql-helpers.ts`              | AUDIT  | sweep                                                         | Open the file; if it contains SSA column names, split. If only generic helpers (`camelToSnake`, `paginate`), stay. |

### `packages/sweep/src/jobs/`

| File                                        | Action              | Destination                                                             | Notes                                                                                                                                                                                                |
| ------------------------------------------- | ------------------- | ----------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `ingestion-registry.ts`                     | REWRITE             | sweep                                                                   | Becomes port-driven: exposes `register(source: IngestionSource)` + `dispatch(jobName, ctx)`. The pack calls `register(…)` with its fetchers.                                                         |
| `queues.ts`                                 | STAY                | —                                                                       | If it hardcodes `satelliteQueue`, rename generic + let pack register queues. But low-risk — single file, 20 lines likely; keep as-is with a sweep/telemetry/ingestion queue triad if generic enough. |
| `schedulers.ts`                             | AUDIT + likely STAY | sweep                                                                   | Cron schedulers — if they reference SSA cortex names, split. Otherwise keep generic.                                                                                                                 |
| `workers/ingestion.worker.ts`               | STAY, rewire        | —                                                                       | Loads source by id from registry port, executes.                                                                                                                                                     |
| `workers/sweep.worker.ts`                   | STAY                | —                                                                       | Already mostly generic. Rewire with port-based audit/promotion.                                                                                                                                      |
| `workers/sim-turn.worker.ts`                | STAY                | —                                                                       | Plan 2 makes it consume sim ports.                                                                                                                                                                   |
| `workers/swarm-fish.worker.ts`              | STAY                | —                                                                       | Generic orchestrator of fish turns.                                                                                                                                                                  |
| `workers/swarm-aggregate.worker.ts`         | STAY, rewire        | —                                                                       | Plan 2 injects `SimPromotionAdapter` port.                                                                                                                                                           |
| `workers/helpers.ts`                        | AUDIT               | —                                                                       | Probably generic — keep.                                                                                                                                                                             |
| `ingesters/tle-history-fetcher.ts`          | MOVE                | `apps/console-api/src/agent/ssa/sweep/ingesters/tle-history-fetcher.ts` |
| `ingesters/itu-filings-fetcher.ts`          | MOVE                | same dir                                                                |
| `ingesters/launch-manifest-fetcher.ts`      | MOVE                | same dir                                                                |
| `ingesters/fragmentation-events-fetcher.ts` | MOVE                | same dir                                                                |
| `ingesters/notam-fetcher.ts`                | MOVE                | same dir                                                                |
| `ingesters/space-weather-fetcher.ts`        | MOVE                | same dir                                                                |

### `packages/sweep/src/middleware/`

| File                 | Action | Notes                         |
| -------------------- | ------ | ----------------------------- |
| `auth.middleware.ts` | STAY   | Generic — any auth principal. |

### `packages/sweep/src/sim/` — see Plan 2

Full mapping covered in plan `2026-04-17-sim-agnostic-refactor.md` Phase B. Target: 10 ports in `sim/ports/`, SSA pack in `apps/console-api/src/agent/ssa/sim/`.

### `packages/sweep/src/index.ts`

Post-refactor public surface:

```ts
// Generic engine
export { buildSweepContainer } from "./config/container";
export type {
  SweepContainer,
  BuildSweepOpts,
  SimServices,
} from "./config/container";
export { redis, getRedis, setRedisClient } from "./config/redis";

// Ports — all of them
export * from "./ports";
export * from "./sim/ports";

// Repositories (generic)
export { SweepRepository } from "./repositories/sweep.repository";
export type {} from /* generic types only */ "./repositories/sweep.repository";

// Services (generic engines)
export { NanoSweepService } from "./services/nano-sweep.service";
export { SweepResolutionService } from "./services/sweep-resolution.service";
export { FindingRouterService } from "./services/finding-router.service";
export { MessagingService } from "./services/messaging.service";

// Jobs
export { createSweepWorker } from "./jobs/workers/sweep.worker";
export { createIngestionWorker } from "./jobs/workers/ingestion.worker";
export {
  IngestionRegistry,
  createIngestionRegistry,
} from "./jobs/ingestion-registry";
export type {} from /* port-facing types */ "./jobs/ingestion-registry";
export {
  sweepQueue,
  satelliteQueue,
  ingestionQueue,
  closeQueues,
  sweepQueueEvents,
  ingestionQueueEvents,
} from "./jobs/queues";
export { registerSchedulers } from "./jobs/schedulers";

// Transformers (generic)
export * from "./transformers/shared.dto";
export * from "./transformers/sweep-generic.dto";

// Sim — agnostic kernel
export * from "./sim/types";
export * from "./sim/schema";
export { buildSimAgent } from "./sim/agent-builder";
export { MemoryService } from "./sim/memory.service";
export { AggregatorService, cosineKMeans } from "./sim/aggregator.service";
export { SwarmService } from "./sim/swarm.service";
export { SimOrchestrator } from "./sim/sim-orchestrator.service";
export { GodChannelService } from "./sim/god-channel.service";
export {
  SequentialTurnRunner,
  DagTurnRunner,
} from "./sim/turn-runner-sequential";
export { rngFromSeed, applyPerturbation } from "./sim/perturbation";
export {
  createSimTurnWorker,
  createSwarmFishWorker,
  createSwarmAggregateWorker,
} from "./jobs/workers";

// Middleware
export * from "./middleware/auth.middleware";

// Utils
export * from "./utils/llm-json-parser";
export * from "./utils/controller-error-handler";
```

Removed from public surface (moved to console-api): `buildOperatorAgent`/`RiskProfile`, `renderTurnPrompt`, `emitSuggestionFromModal`, `emitTelemetrySuggestions`, `TelemetryAggregatorService`, `startTelemetrySwarm`/`TelemetrySwarmOpts`, `lookupBusPrior`/`lookupBusEntry`/`listBusNames`, `GOD_EVENT_TEMPLATES`, `generateDefaultPerturbations`, `SatelliteRepository`, `SatelliteSweepChatService`/`Controller`/`Repository`, `AdminSweepController`, `registerAdminSweepRoutes`, `satelliteSweepChatRoutes`, `getTiersForCortex`/`wireSweepNotifications`, `*.dto` SSA symbols.

---

## Ports introduced

### Sweep engine ports (`packages/sweep/src/ports/`)

| Port                        | Consumed by                           | Implemented by                                               |
| --------------------------- | ------------------------------------- | ------------------------------------------------------------ |
| `FindingDomainSchema`       | `SweepRepository`, `NanoSweepService` | `apps/console-api/src/agent/ssa/sweep/finding-schema.ssa.ts` |
| `DomainAuditProvider`       | `NanoSweepService.runAudit`           | `audit-provider.ssa.ts`                                      |
| `SweepPromotionAdapter`     | `SweepResolutionService.resolve`      | `promotion.ssa.ts`                                           |
| `FindingRoutingPolicy`      | `FindingRouterService`                | `finding-routing.ssa.ts`                                     |
| `ResolutionHandlerRegistry` | `SweepResolutionService`              | `resolution-handlers.ssa.ts`                                 |
| `IngestionSourceProvider`   | `IngestionRegistry`                   | `agent/ssa/sweep/ingesters/index.ts`                         |

### Sim kernel ports (`packages/sweep/src/sim/ports/`) — Plan 2

`SimActionSchemaProvider`, `SimFleetProvider`, `SimTurnTargetProvider`, `SimAgentPersonaComposer`, `SimPromptComposer`, `SimCortexSelector`, `SimPerturbationPack`, `SimAggregationStrategy`, `SimKindGuard`, `SimPromotionAdapter`.

---

## New controllers / routes in console-api (HTTP surface delta)

For Plan 3 (CLI → HTTP) and for routes migrated from sweep.

| Route                           | Controller                                | Notes                    |
| ------------------------------- | ----------------------------------------- | ------------------------ |
| `POST /api/sim/telemetry/start` | `sim.controller`                          | CLI telemetry launcher   |
| `POST /api/sim/pc/start`        | `sim.controller`                          | CLI pc launcher          |
| `POST /api/sweep/resolve`       | `sweep-suggestions.controller` (extend)   | CLI resolution           |
| `GET /api/kg/graph/:id`         | `kg-graph.controller`                     | CLI graph adapter        |
| `GET /api/why/:findingId`       | `why.controller`                          | CLI why adapter          |
| `POST /api/repl/interpret`      | `repl-interpret.controller`               | CLI LLM router           |
| `/api/admin/sweep/*`            | `admin-sweep.controller` (moved)          | Admin console            |
| `/api/satellite-sweep-chat/*`   | `satellite-sweep-chat.controller` (moved) | Existing console feature |

---

## Execution plans

Three plans land in this order. Each is independent in principle but the branch mirrors this sequence for clean review.

### Plan 1 — `packages/sweep/` becomes agnostic (except sim internals)

**Document:** `docs/superpowers/plans/2026-04-17-plan1-sweep-agnostic.md` (to be written)

Scope:

- Create all sweep ports (`packages/sweep/src/ports/`)
- Move SSA services, controllers, routes, repositories, transformers, types, ingesters, doctrine-parser to `apps/console-api/`
- Generalize `NanoSweepService`, `SweepResolutionService`, `SweepRepository`, `IngestionRegistry` behind ports
- Wire SSA providers into `apps/console-api/src/container.ts`
- Strip SSA exports from `packages/sweep/src/index.ts`
- Add sweep arch-guard test (red until plan complete, green at end)
- `packages/sweep/src/sim/` unchanged (still SSA internally — Plan 2 handles it)

Risk gates: UC3 E2E green, `pnpm -r typecheck` clean between every task.

### Plan 2 — `packages/sweep/src/sim/` becomes agnostic

**Document:** `docs/superpowers/plans/2026-04-17-plan2-sim-agnostic.md` (derived from the current draft; focus narrowed to sim-only)

Scope: 10 sim ports + SSA pack in `apps/console-api/src/agent/ssa/sim/`. The plan currently saved is mostly this, minus Phases C/D which migrate to Plan 3.

### Plan 3 — CLI → HTTP

**Document:** `docs/superpowers/plans/2026-04-17-plan3-cli-http.md`

Scope:

- HTTP client helper
- New routes on console-api (sim/telemetry, sim/pc, sweep/resolve, kg/graph, why, repl/interpret)
- CLI adapters rewritten as fetch clients
- `boot.ts` shrinks; `@interview/sweep`/`thalamus`/`db-schema` dropped
- CLI arch-guard green

---

## Decisions that need user confirmation before writing plans

1. **Is this file-mapping table accurate?** Specifically flagged:
   - `satellite.repository.ts` — sweep package has one, console-api already has one. Merge into console-api's existing file? Or keep two and console-api picks the right one per query?
   - `satellite.service.ts` — same question.
   - `sql-helpers.ts` — audit content; is it generic? (Haven't read it yet.)
   - `schedulers.ts` and `queues.ts` — may reference SSA cortex/queue names in strings.

2. **SweepRepository generalization approach** — option **A (encapsulation)** in prior discussion was accepted: the Redis keys stay, the value becomes `{ domain: "ssa", attributes: {...}, summary, severity, … }` serialized by a `FindingDomainSchema` port. Confirms: no Redis data migration, existing sweep_suggestion rows survive.

3. **Admin sweep routes** — currently mounted via `packages/sweep/src/routes/admin.routes.ts`. Post-refactor they live in `apps/console-api/src/routes/admin-sweep.routes.ts`. Console-api already has an admin-sweep-like concept via `sweep-suggestions.controller` + `sweep-mission.controller` — do we merge the moved file with those (one unified admin route file), or keep them separate? Recommend: merge — single source of truth for admin sweep HTTP surface.

4. **`finding-routing.ts` cortex tier map** is SSA (named cortices). Moves wholesale. Console-api consumes via `FindingRoutingPolicy` port implementation. OK?

5. **The CLI's current `thalamus.runCycle` already goes over HTTP** (see [boot.ts:156-157](../../packages/cli/src/boot.ts#L156-L157)). We trust this path and don't change it.

Awaiting confirmation on #1–#5 before writing Plan 1.
