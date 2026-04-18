# Plan 6 — Sweep five-layer + sim↔sweep boundary

## 0. Context recap

- Branch `refactor/sim-agnostic` landed Plans 1 & 2.
- **Plan 1** made `packages/sweep/` a generic kernel with 6 ports (`FindingDomainSchema`, `DomainAuditProvider`, `SweepPromotionAdapter`, `FindingRoutingPolicy`, `ResolutionHandlerRegistry`, `IngestionSourceProvider`) — impls in `apps/console-api/src/agent/ssa/sweep/`.
- **Plan 2** moved the SSA sim pack alongside (10 sim ports), but the sim↔sweep promotion glue still sits in `packages/sweep/src/sim/promote.ts` (592 LOC; SRP-violating god file) and in `packages/sweep/src/config/container.ts` (the `simHook.cb` closure at [container.ts:159-267](/home/jerem/interview-thalamus-sweep/packages/sweep/src/config/container.ts#L159)).
- **Console-api** already uses the canonical 5-layer stack (`routes/ → controllers/ → services/ → repositories/ → types/` with `transformers/` + `schemas/` + `utils/`). The sweep kernel has **no** such layering — it mixes services/repos/jobs/sim freely.
- `apps/console-api/src/agent/ssa/{sweep,sim}/` are **adapter packs**, not first-class horizontal layers. Plan 6 must keep that distinction clear: domain-specific SSA rules stay in the pack, while storage / HTTP / queue concerns live in the 5-layer app or in kernel ports.

**Goal of Plan 6:** Extend the console-api 5-layer contract across the sweep kernel + the sim↔sweep boundary, so responsibilities stop leaking without introducing reverse `packages/* -> apps/*` dependencies. The refactor is only considered complete once **application consumers** reach thalamus / sweep / sim through the console-api HTTP boundary instead of in-process package imports. Result: each file answers one question ("who owns sweep_audit writes?", "who owns KG writes?", "who decides sim→sweep promotion?") with exactly one name.

---

## 1. Layer definitions (recap + sweep examples)

| Layer                  | Purpose                                                                     | Sweep example today                                                                                                                | Sweep example after Plan 6                                                                                                                        |
| ---------------------- | --------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------- |
| `types/`               | Pure TS contracts / DTO interfaces; no runtime deps                        | No dedicated folder today; types are still mixed into `transformers/sweep.dto.ts`                                                 | Add extracted sim-promotion DTO types where needed                                                                                                |
| `repositories/`        | Storage I/O only (Redis, Postgres). No business rules                       | `SweepRepository` (Redis)                                                                                                          | `SweepRepository` + `ResearchKgRepository` + `SatelliteTelemetryRepository` + sim repositories                                                   |
| `services/`            | Business logic and orchestration over repos / ports / adapter-pack helpers  | `NanoSweepService`, `SweepResolutionService`, `FindingRouterService`, `MessagingService` (kernel); `SweepSuggestionsService` (app) | `SweepResolutionService` (orchestration), `ConfidencePromotionService`, `SimPromotionService`                                                    |
| `controllers/`         | HTTP request/reply adapters only                                     | `sweep-suggestions.controller`, `sweep-mission.controller` (in console-api)                                                        | Same (zero kernel-side controllers — `admin-sweep.controller` was deleted in Plan 1 task 6.1)                                                     |
| `routes/`              | Fastify URL binding                                                  | `apps/console-api/src/routes/sweep.routes.ts`                                                                                      | Same                                                                                                                                              |
| `workers/` (auxiliary) | BullMQ job entrypoints; thin, delegate to services or ports          | `sweep.worker`, `sim-turn.worker`, `swarm-fish.worker`, `swarm-aggregate.worker`                                                   | Same, but aggregate worker delegates via the `SimPromotionAdapter` port instead of two inline callbacks                                           |
| `infra/` / `jobs/`     | Queue handles, schedulers, process wiring                              | `jobs/queues.ts`, `jobs/schedulers.ts`                                                                                              | Same; queue handles stay infra, not repositories                                                                                                  |

**Supporting layers** (same status as console-api):

- `transformers/` → DTO ↔ domain mappers (already exists in sweep: `transformers/sweep.dto.ts`)
- `ports/` → DIP boundary contracts (already exists: 6 sweep ports + 10 sim ports + 1 sim-promotion port)
- `config/` → DI container composition root
- `utils/` → pure helpers (already exists: `llm-json-parser`, `sql-helpers`, `controller-error-handler`)

**The load-bearing rule for Plan 6:** the kernel must not contain SSA-shaped code, and the SSA adapter packs must not own raw SQL, Redis writes, or BullMQ wiring. They may depend on injected repository/service interfaces, but persistence and queue mechanics remain outside the pack. `promote.ts` breaks both.

---

## 2. Current-state audit — SRP violations by file

### 2.1 `packages/sweep/src/sim/promote.ts` (592 L) — SEVEN responsibilities in ONE file

| Resp. | LOC                                                                                                                                                                        | What it does                                                                                                                                                                                  | Layer it belongs in                                                                                                                    |
| ----- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------- |
| A     | [promote.ts:38-60](/home/jerem/interview-thalamus-sweep/packages/sweep/src/sim/promote.ts#L38) (`isKgPromotable`, `isTerminal`, `loadSimTurn`)                             | Pure predicates + a trivial Postgres read                                                                                                                                                     | Split: predicates → `agent/ssa/sim/promotion-policy.ts`, `loadSimTurn` → `SimTurnRepository`                                          |
| B     | [promote.ts:82-294](/home/jerem/interview-thalamus-sweep/packages/sweep/src/sim/promote.ts#L82) (`emitSuggestionFromModal`)                                                | UC3 end-to-end: resolve operator context, **open `research_cycle`**, **insert `research_finding`**, **insert `research_edge`**, **update `sim_swarm`**, **insert `sweep_suggestion`** (Redis) | `SimPromotionService` in console-api + sim/sweep repos + thin SSA adapter wrapper                                                        |
| C     | [promote.ts:301-367](/home/jerem/interview-thalamus-sweep/packages/sweep/src/sim/promote.ts#L301) (`actionTarget`, `composeTitle`, `composeDescription`, `describeAction`) | Pure formatting / mapping                                                                                                                                                                     | `agent/ssa/sim/promotion-policy.ts` (adapter-pack pure helper)                                                                           |
| D     | [promote.ts:369-379](/home/jerem/interview-thalamus-sweep/packages/sweep/src/sim/promote.ts#L369) (`safeEmbed`)                                                            | Optional embedder wrapper                                                                                                                                                                     | `SimPromotionService` local helper or adapter-pack util                                                                                  |
| E     | [promote.ts:406-543](/home/jerem/interview-thalamus-sweep/packages/sweep/src/sim/promote.ts#L406) (`emitTelemetrySuggestions`)                                             | UC_TELEMETRY: read 8 NULL columns, compute severity, build per-scalar suggestions, Redis insert                                                                                               | `SimPromotionService` in console-api + telemetry repo + thin SSA adapter wrapper                                                         |
| F     | [promote.ts:545-561](/home/jerem/interview-thalamus-sweep/packages/sweep/src/sim/promote.ts#L545) (`findNullTelemetryColumns`)                                             | Raw SQL                                                                                                                                                                                       | `SatelliteTelemetryRepository` in console-api (new)                                                                                    |
| G     | [promote.ts:568-587](/home/jerem/interview-thalamus-sweep/packages/sweep/src/sim/promote.ts#L568) (`scoreScalar`)                                                          | Pure scoring                                                                                                                                                                                  | `agent/ssa/sim/promotion-policy.ts`                                                                                                    |

**SRP verdict:** this file owns _domain rules_ (what is promotable), _DB writes_ across two domains (Redis + KG), _formatting_, _embedding_, _persistence scoring_. It is the single worst violation in the refactor branch.

### 2.2 `packages/sweep/src/services/sweep-resolution.service.ts` ([sweep-resolution.service.ts:187-201](/home/jerem/interview-thalamus-sweep/packages/sweep/src/services/sweep-resolution.service.ts#L187))

Plan 1 already reduced this to ~230 L of pure orchestration. **One remaining smell:** lines 186-201 still hard-code the promotion-on-success branch. Post-Plan 6 the adapter should be a proper service that the resolution service can also call on _partial_ or _failed_ status (e.g., to emit rejection audit). Keep the smell logged; do not touch in Plan 6 scope unless Phase D picks it up.

### 2.3 `packages/sweep/src/services/finding-router.service.ts` (27 L)

Already clean ([finding-router.service.ts:21-27](/home/jerem/interview-thalamus-sweep/packages/sweep/src/services/finding-router.service.ts#L21)): one method, delegates to a port. Keep as a service.

### 2.4 `packages/sweep/src/services/messaging.service.ts` (37 L)

Stub — kept for contract. Service-layer; no action.

### 2.5 `packages/sweep/src/services/nano-sweep.service.ts`

Since Plan 1 task 2.2, split into:

- `NanoSweepService` façade (`sweep(limit, mode)` delegates to `DomainAuditProvider`) — **service** ✓
- `LegacyNanoSweepAuditProvider` (434 L of SSA audit pipeline) — **should be deleted** in Phase D once console-api is the sole wiring path. Plan 1 left it as fallback.

### 2.6 `packages/sweep/src/config/container.ts` ([container.ts:159-267](/home/jerem/interview-thalamus-sweep/packages/sweep/src/config/container.ts#L159))

**SRP violation:** the container holds a `simHook` mutable closure that reaches into `ConfidenceService`. This is business logic (confidence promotion rule), **not wiring**. After Plan 6 the closure moves into `ConfidencePromotionService`, and the container passes only dependencies.

### 2.7 `packages/sweep/src/jobs/workers/swarm-aggregate.worker.ts` ([swarm-aggregate.worker.ts:107-123](/home/jerem/interview-thalamus-sweep/packages/sweep/src/jobs/workers/swarm-aggregate.worker.ts#L107) + [:204-213](/home/jerem/interview-thalamus-sweep/packages/sweep/src/jobs/workers/swarm-aggregate.worker.ts#L204))

Worker takes two optional callbacks `emitSuggestion` / `emitTelemetrySuggestions`. This is the current sim→sweep boundary — unnamed, optional callbacks passed as DI. Must become a first-class port (`SimPromotionAdapter`, already scaffolded at [sim/ports/promotion.port.ts:29](/home/jerem/interview-thalamus-sweep/packages/sweep/src/sim/ports/promotion.port.ts#L29) but TODO Plan 2 · B.9 per [apps/.../sim/promotion.ts:35](/home/jerem/interview-thalamus-sweep/apps/console-api/src/agent/ssa/sim/promotion.ts#L35)).

### 2.8 `apps/console-api/src/agent/ssa/sweep/promotion.ssa.ts` ([promotion.ssa.ts:73-81](/home/jerem/interview-thalamus-sweep/apps/console-api/src/agent/ssa/sweep/promotion.ssa.ts#L73))

Confidence branch is a stub. Plan 6 Phase C lands the full impl.

### 2.9 `apps/console-api/src/container.ts` ([container.ts:217-221](/home/jerem/interview-thalamus-sweep/apps/console-api/src/container.ts#L217))

Post-build patch (`(ssaAuditProvider as unknown as ...).deps.sweepRepo.loadPastFeedback = ...`) breaks the invariant "services are immutable after construction". Symptom of the audit provider receiving a service dep that only exists after `buildSweepContainer`. Plan 6 Phase B fixes by passing `sweepRepo` as a late-bound provider (thunk), not a post-patch.

---

## 3. Target state — mapping table

### 3.1 Sweep kernel (`packages/sweep/src/`)

| File / class today                                         | Layer target                   | Notes                                                      |
| ---------------------------------------------------------- | ------------------------------ | ---------------------------------------------------------- |
| `SweepRepository`                                          | `repositories/` ✓              | Generic row shape via `FindingDomainSchema` port           |
| `SatelliteRepository` (sweep)                              | `repositories/` but **DELETE** | Plan 1 already folded into console-api; keep until Phase D |
| `NanoSweepService`                                         | `services/` ✓                  | Stays as façade                                            |
| `SweepResolutionService`                                   | `services/` ✓                  | Stays; orchestration-only post-Plan 1                      |
| `FindingRouterService`                                     | `services/` ✓                  | Stays                                                      |
| `MessagingService`                                         | `services/` ✓                  | Stub stays                                                 |
| `LegacyNanoSweepAuditProvider`                             | —                              | **Delete** in Phase D                                      |
| `LegacySsaPromotionAdapter`                                | —                              | **Delete** in Phase D                                      |
| `LegacySsaResolutionRegistry`                              | —                              | **Delete** in Phase D                                      |
| `MemoryService` (sim)                                      | `services/` ✓                  | Already service-shaped                                     |
| `SequentialTurnRunner`, `DagTurnRunner`                    | `services/`                    | Turn execution orchestration                               |
| `SimOrchestrator`                                          | `services/`                    | DI around queues + runners                                 |
| `AggregatorService`, `TelemetryAggregatorService`          | `services/`                    | Pure aggregation + DB read                                 |
| `SwarmService`                                             | `services/`                    | Launch + status                                            |
| `GodChannelService`                                        | `services/`                    |                                                            |
| `sim/promote.ts`                                           | —                              | **Dismantle entirely** (see §4)                            |
| `jobs/queues.ts`, `schedulers.ts`, `ingestion-registry.ts` | `infra/` (or `jobs/`)          | Keep as infra; not services                                |
| `jobs/workers/*.ts`                                        | **"workers" sub-layer**        | See §5 below                                               |
| `transformers/sweep.dto.ts`                                | `transformers/` ✓              |                                                            |
| `ports/`                                                   | `ports/` ✓                     |                                                            |
| `config/container.ts`                                      | composition root               | Remove business logic (simHook)                            |
| `utils/`                                                   | `utils/` ✓                     |                                                            |

### 3.2 SSA sweep pack (`apps/console-api/src/agent/ssa/sweep/`)

This folder is an **app-side adapter pack**. It implements kernel ports and contains SSA-specific parsing/policy, but it is not a horizontal layer like `services/` or `repositories/`.

| File                         | Layer role                                     |
| ---------------------------- | ---------------------------------------------- |
| `finding-schema.ssa.ts`      | Adapter / transformer (implements `FindingDomainSchema`) |
| `audit-provider.ssa.ts`      | Adapter (implements `DomainAuditProvider`)              |
| `promotion.ssa.ts`           | Adapter (implements `SweepPromotionAdapter`)            |
| `finding-routing.ssa.ts`     | Adapter (implements `FindingRoutingPolicy`)             |
| `resolution-handlers.ssa.ts` | Adapter registry (5 handlers)                           |
| `doctrine-parser.ssa.ts`     | Pack util                                               |
| `ingesters/*`                | Adapter implementations of `IngestionSource`            |

### 3.3 SSA sim pack (`apps/console-api/src/agent/ssa/sim/`) — **the sim→sweep boundary lives here**

Like the sweep pack, this is an adapter pack, not a second service layer. Plan 5 owns the launcher cleanup (`swarms/*`, SQL-in-pack, etc.); Plan 6 only touches the sim↔sweep promotion boundary and the pieces that still violate it.

| File                                                                                                | Role post-Plan 6                                                                                                                                                                                                                                                  |
| --------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `promotion.ts`                                                                                      | **Adapter: `SsaSimPromotionAdapter`** — implement `SimPromotionAdapter`; delegate inward to `SimPromotionService`                                                                                                                                                |
| `swarms/telemetry.ts`, `swarms/pc.ts`                                                               | Out of Plan 6 scope; Plan 5 moves these launchers into `services/sim/*`                                                                                                                                                                                           |
| `aggregators/pc.ts`                                                                                 | Keep only pure pack helpers / policy; DB-backed orchestration belongs in app services                                                                                                                                                                              |
| `bus-datasheets/loader.ts`                                                                          | Static asset loader / catalogue, not a repository                                                                                                                                                                                                                 |
| `action-schema.ts`, `persona-composer.ts`, `prompt-renderer.ts`, `perturbation-pack.ts`, etc.     | Pack helpers and port implementations                                                                                                                                                                                                                              |
| `kind-guard.ts`, `aggregation-strategy.ts`, `cortex-selector.ts`, `fleet-provider.ts`, `targets.ts` | Adapter implementations of kernel ports; `targets.ts` must delegate SQL to a repo if Plan 5 has landed                                                                                                                                                           |

### 3.4 New files to create in console-api (Plan 6 scope)

```
apps/console-api/src/
  repositories/
    research-kg.repository.ts         # research_cycle/finding/edge writes (lifted from promote.ts)
    satellite-telemetry.repository.ts # findNullTelemetryColumns (lifted from promote.ts:545)
    sim-turn.repository.ts            # loadSimTurn (lifted from promote.ts:51)
    sim-swarm.repository.ts           # outcomeReportFindingId update
  services/
    sim-promotion.service.ts          # UC3 modal → suggestion + UC_TELEMETRY scalar → suggestions
    confidence-promotion.service.ts   # SIM_UNCORROBORATED → OSINT_CORROBORATED rule (from container.ts simHook)
  agent/ssa/sim/
    promotion-policy.ts               # isKgPromotable, isTerminal, scoreScalar, composeTitle, describeAction, actionTarget
```

### 3.5 End-to-end flow: UC3 sim → reviewer accept → KG write

Expressed in 5-layer terms (post-Plan 6):

1. **Route** `POST /api/sweep/suggestions/:id/review` in `routes/sweep.routes.ts`.
2. **Controller** `sweepReviewController` parses params + body → calls `SweepSuggestionsService.review(id, accept, reason)`.
3. **Service** `SweepSuggestionsService.review` calls `SweepRepository.review(id, accept, reason)` (Redis flag). If `accept`, calls `SweepResolutionService.resolve(id)`.
4. **Service** `SweepResolutionService.resolve` → loads row via `SweepRepository.getGeneric`, parses payload, dispatches each action to `ResolutionHandlerRegistry` (SSA handlers, e.g., `update_field` → `SatelliteRepository.updateField`). On success: calls `SweepPromotionAdapter.promote(...)`.
5. **Adapter** (SSA) `SsaPromotionAdapter.promote` → `SweepAuditRepository.insertResolutionAudit` + (optional) `ConfidencePromotionService.onUpdateFieldAccepted`.
6. **Repository** `SatelliteRepository.updateField` and `SweepAuditRepository.insertResolutionAudit` — DB writes.

**The sim side of the loop** (swarm → suggestion, runs _before_ step 1):

1. **Worker** `swarm-aggregate.worker` fires when all fish drained.
2. **Service** `AggregatorService.aggregate(swarmId)` → returns `SwarmAggregate`.
3. **Adapter** `SsaSimPromotionAdapter.promote(...)` (called via the **`SimPromotionAdapter` port**) delegates to **service** `SimPromotionService`.
   - UC3 path: `ResearchKgRepository.insertCycle` → `insertFinding` → `insertEdge` → `SimSwarmRepository.setOutcomeReportFindingId` → `SweepRepository.insertOne`.
   - UC_TELEMETRY path: `SatelliteTelemetryRepository.findNullColumns` → loop over scalars → `SweepRepository.insertOne` per scalar.
4. **Repository** writes land in Postgres + Redis.

Each layer has **one** reason to change.

---

## 4. Dismantling `promote.ts`

Per-LOC mapping (copy this table into the PR description):

| Source (packages/sweep/src/sim/promote.ts)     | Destination (apps/console-api/src/...)                                 | Layer       |
| ---------------------------------------------- | ---------------------------------------------------------------------- | ----------- |
| L38-44 `isKgPromotable`, `isTerminal`          | `agent/ssa/sim/promotion-policy.ts`                                    | adapter pack |
| L51-60 `loadSimTurn`                           | `repositories/sim-turn.repository.ts#loadSimTurn`                      | repo        |
| L82-294 `emitSuggestionFromModal`              | `services/sim-promotion.service.ts#promoteModal`                       | service     |
| L134-154 `researchCycle.insert`                | `repositories/research-kg.repository.ts#insertCycle`                   | repo        |
| L169-203 `researchFinding.insert`              | `repositories/research-kg.repository.ts#insertFinding`                 | repo        |
| L209-221 `researchEdge.insert`                 | `repositories/research-kg.repository.ts#insertEdge`                    | repo        |
| L228-232 `simSwarm.update`                     | `repositories/sim-swarm.repository.ts#setOutcomeReportFindingId`       | repo        |
| L266-279 `sweepRepo.insertOne`                 | stays — called from `SimPromotionService`                              | repo call   |
| L301-317 `actionTarget`                        | `agent/ssa/sim/promotion-policy.ts`                                    | adapter pack |
| L319-346 `composeTitle` / `composeDescription` | `agent/ssa/sim/promotion-policy.ts`                                    | adapter pack |
| L348-367 `describeAction`                      | `agent/ssa/sim/promotion-policy.ts`                                    | adapter pack |
| L369-379 `safeEmbed`                           | `utils/embed-safe.ts` (or inline)                                      | util        |
| L406-543 `emitTelemetrySuggestions`            | `services/sim-promotion.service.ts#promoteTelemetry`                   | service     |
| L545-561 `findNullTelemetryColumns`            | `repositories/satellite-telemetry.repository.ts#findNullScalarColumns` | repo        |
| L568-587 `scoreScalar`                         | `agent/ssa/sim/promotion-policy.ts`                                    | adapter pack |
| L589-591 `round`                               | `utils/math.ts` (or inline)                                            | util        |

After Plan 6: `packages/sweep/src/sim/promote.ts` → **deleted**. Its exports (`isKgPromotable`, `isTerminal`, `loadSimTurn`, `emitSuggestionFromModal`, `emitTelemetrySuggestions`, `EmitSuggestionDeps`, `EmitTelemetrySuggestionsDeps`) are removed from [packages/sweep/src/index.ts:88-94](/home/jerem/interview-thalamus-sweep/packages/sweep/src/index.ts#L88).

The `swarm-aggregate` worker stops taking `emitSuggestion` / `emitTelemetrySuggestions` callbacks and takes a single `SimPromotionAdapter` port instead. Because the current scaffolded port shape is too narrow for UC_TELEMETRY (one `suggestionId` vs many), Phase A explicitly widens it to carry either modal or telemetry promotion input and return `suggestionIds: string[]` plus optional `findingId`.

---

## 5. BullMQ worker placement — callout

**Not a 6th layer.** Workers are _thin job entrypoints_ that translate a BullMQ job into one service call, then return a result for BullMQ to store. They belong alongside services under a `workers/` sub-folder (same peer as `controllers/` — both are "adapters" into the services layer, one for HTTP, one for queues).

Concrete rule:

```
controllers/ → translate HTTP  → service
workers/     → translate job   → service
```

Enforcement:

- A worker file may import from `services/`, `ports/`, `types/`.
- A worker file may **not** import from `repositories/` (go through a service).
- A worker file may **not** contain business logic (today `swarm-aggregate.worker.ts:107-123` inlines the UC3 promotion branch — this is a violation that Phase C fixes).

Target worker bodies (post-Plan 6):

| Worker                      | Delegates to                                                                                                             |
| --------------------------- | ------------------------------------------------------------------------------------------------------------------------ |
| `sweep.worker.ts`           | `NanoSweepService.sweep()` ✓ (already clean)                                                                             |
| `ingestion.worker.ts`       | `IngestionRegistry.dispatch(jobName)` ✓                                                                                  |
| `sim-turn.worker.ts`        | `SequentialTurnRunner.runTurn` / `DagTurnRunner.runTurn` + `SimOrchestrator.scheduleNext` ✓                              |
| `swarm-fish.worker.ts`      | `SwarmService.runFish` (already thin)                                                                                    |
| `swarm-aggregate.worker.ts` | `AggregatorService.aggregate` → `SimPromotionAdapter.promote(...)` (SSA impl delegates to `SimPromotionService`) |

---

## 6. Phased migration

### Phase A — Port formalization (LOW risk, zero behavior change)

Goal: give names to things already half-named, fix the too-narrow sim-promotion port, and delete the "optional callback" DI pattern from the aggregate worker.

- A.1 Widen `packages/sweep/src/sim/ports/promotion.port.ts` so the port can express both UC3 modal promotion and UC_TELEMETRY multi-suggestion promotion. Use a discriminated input (`kind: "modal" | "telemetry"`) and return `suggestionIds: string[]` plus optional `findingId`.
- A.2 Rewire `createSwarmAggregateWorker` to take `simPromotion: SimPromotionAdapter` instead of `emitSuggestion` + `emitTelemetrySuggestions`.
- A.3 Temporarily route `simPromotion` to a pass-through adapter that calls today's `emitSuggestionFromModal` / `emitTelemetrySuggestions`. `promote.ts` untouched.
- A.4 Update `apps/console-api/tests/e2e/swarm-uc3.e2e.spec.ts` to pass the new adapter. Green-bar check.

**Risk gate:** UC3 e2e green + `pnpm -r typecheck` clean.

### Phase B — Repository extraction (LOW risk, pure moves)

Goal: move Postgres writes out of `promote.ts` and the `simHook` closure into named repositories / services that console-api and the SSA adapters depend on.

- B.1 Create `apps/console-api/src/repositories/research-kg.repository.ts` with `insertCycle`, `insertFinding`, `insertEdge`. Tests: unit (mock db) + integration (real schema).
- B.2 Create `apps/console-api/src/repositories/sim-turn.repository.ts` with `loadSimTurn`; create or extend `apps/console-api/src/repositories/sim-swarm.repository.ts` with `setOutcomeReportFindingId`.
- B.3 Create `apps/console-api/src/repositories/satellite-telemetry.repository.ts` with `findNullScalarColumns(satelliteId)`.
- B.4 Fix the post-build patch at [apps/console-api/src/container.ts:217-221](/home/jerem/interview-thalamus-sweep/apps/console-api/src/container.ts#L217) by passing a `() => sweepRepo.loadPastFeedback()` thunk in `SsaAuditDeps` (or deferring to a late-bound provider).

**Risk gate:** all unit specs + UC3 e2e green. Zero runtime behavior change — `promote.ts` still calls the old inline SQL; the new repos are additive.

### Phase C — Service extraction (MEDIUM risk, real behavior move)

Goal: replace the pass-through `SsaSimPromotionAdapter` from Phase A with a real adapter that delegates to a console-api service composed of the new repositories + pack helpers.

- C.1 Create `apps/console-api/src/agent/ssa/sim/promotion-policy.ts` (lift `composeTitle` / `composeDescription` / `describeAction` / `actionTarget` / `isKgPromotable` / `isTerminal` / `scoreScalar` from `promote.ts`).
- C.2 Create `apps/console-api/src/services/sim-promotion.service.ts` with `promoteModal(swarmId, aggregate)` and `promoteTelemetry(aggregate)`. Compose: `ResearchKgRepository` + `SimTurnRepository` + `SimSwarmRepository` + `SatelliteTelemetryRepository` + `SweepRepository` + `promotion-policy.ts`.
- C.3 Implement the real `SsaSimPromotionAdapter` in `apps/console-api/src/agent/ssa/sim/promotion.ts`: accept the widened `SimPromoteInput`, dispatch to `SimPromotionService`, return normalized `suggestionIds` / `findingId`.
- C.4 Create `apps/console-api/src/services/confidence-promotion.service.ts` — encapsulate the `simHook` rule from [packages/sweep/src/config/container.ts:249-266](/home/jerem/interview-thalamus-sweep/packages/sweep/src/config/container.ts#L249) (`telemetryEdgeId` derivation + `confidenceService.promote`). Exposed method: `onUpdateFieldAccepted(event)`.
- C.5 Extend `SsaPromotionAdapter` so it calls `confidencePromotion.onUpdateFieldAccepted` when the action is `update_field` with sim provenance. Remove the confidence stub branch at [apps/console-api/src/agent/ssa/sweep/promotion.ssa.ts:73-81](/home/jerem/interview-thalamus-sweep/apps/console-api/src/agent/ssa/sweep/promotion.ssa.ts#L73).
- C.6 Wire the real `SsaSimPromotionAdapter` in `apps/console-api/src/container.ts`, replacing the pass-through from A.3. The adapter should depend on `SimPromotionService`, not on repositories directly.
- C.7 Remove the `simHook` closure from `packages/sweep/src/config/container.ts` (kernel loses all knowledge of confidence promotion). Delete the `onSimUpdateAccepted` option from `createLegacySsaResolutionRegistry` inputs.

**Risk gate:** UC3 e2e green + UC_TELEMETRY e2e green + unit specs green. Snapshot the `sweep_suggestion` rows produced by a fixture swarm before + after the phase; diff must be empty modulo timestamps + UUIDs.

### Phase D — Kernel deletion (HIGH risk, one-way door)

Goal: remove the duplication and the legacy fallbacks.

- D.1 Delete `packages/sweep/src/sim/promote.ts` and its re-exports from `packages/sweep/src/index.ts`.
- D.2 Delete `packages/sweep/src/services/nano-sweep.service.ts#LegacyNanoSweepAuditProvider` (the 434-line body; keep only `NanoSweepService`).
- D.3 Delete `packages/sweep/src/services/legacy-ssa-promotion.ts` and `packages/sweep/src/services/legacy-ssa-resolution.ts`.
- D.4 Delete `packages/sweep/src/repositories/satellite.repository.ts` (already folded into console-api per Plan 1 task 4.1).
- D.5 In `buildSweepContainer`, make `opts.ports` required instead of optional for `audit`, `promotion`, `resolutionHandlers`. Callers that don't supply them now fail fast.
- D.6 Rename `packages/sweep/src/jobs/workers/` → keep as-is (workers ARE a real sub-layer, §5).
- D.7 Optional: split `packages/sweep/src/sim/` into `packages/sweep/src/services/sim/` (keep) vs. remove all the ssa-legacy fossils (`legacy-ssa-*.ts`, `legacy-ssa-schema.ts`, `legacy-ssa-perturbation-pack.ts`).

**Risk gate:** all specs green; grep for `emitSuggestionFromModal`, `emitTelemetrySuggestions`, `LegacyNanoSweepAuditProvider`, `LegacySsaPromotionAdapter`, `LegacySsaResolutionRegistry` → zero hits outside of CHANGELOG + this plan.

---

## 7. Risks

1. **Container construction cycle.** `SsaPromotionAdapter` wants `ConfidencePromotionService`, which wants `ConfidenceService`, which is currently created in the sweep container's sim block. Mitigation: create `ConfidenceService` in `apps/console-api/src/container.ts` first, inject it into `ConfidencePromotionService`, then pass the finished adapter/service graph into `buildSweepContainer` via existing port wiring. No new `opts.confidenceService` field should be needed on the kernel container.
2. **Test fixtures couple to the god file.** `apps/console-api/tests/e2e/swarm-uc3.e2e.spec.ts` imports `emitSuggestionFromModal` directly. Phase A.3 rewires first; Phase D must confirm no other test pins the symbol.
3. **BullMQ job payload drift.** `SwarmAggregateJobPayload` is fine today; workers only change in how they dispatch (new port). Do not alter payload shape in Phase A (it would force a queue drain migration).
4. **ConfidenceService key collisions.** `telemetryEdgeId` synthesises an FNV-1a over `${satelliteId}:${field}`. Moving to `ConfidencePromotionService` preserves the derivation verbatim; do not "clean it up". Pin with a unit test.
5. **Redis TTL on suggestions.** `SweepRepository` uses `TTL_SECS = 90 days` ([sweep.repository.ts:26](/home/jerem/interview-thalamus-sweep/packages/sweep/src/repositories/sweep.repository.ts#L26)). Suggestions promoted from sim still go through `insertOne` — TTL unchanged in Plan 6.
6. **Legacy sweep-internal CLI fallbacks.** CLI was explicitly deferred to Plan 3. Phase D must not break CLI `boot.ts` — double-check `sweepC.resolutionService.resolve(id)` still works by grepping the `packages/cli/src` tree before removing any container fallback.
7. **Two suggestion sources, one audit trail.** Both UC3 modal promotion and reviewer-accept promotion write to `sweep_audit` via `SweepAuditRepository.insertResolutionAudit`. Verify we do not double-insert when a sim suggestion is later reviewer-accepted. Write an integration test covering this path in Phase C.

---

## 8. Success criteria

- `promote.ts` deleted.
- `SimPromotionAdapter` is the single sim→sweep contract (one port, one SSA impl, one call-site in `swarm-aggregate.worker`).
- `apps/console-api/src/container.ts` has zero post-build patches.
- `packages/sweep/src/config/container.ts` has zero business-rule closures (no `simHook`, no `telemetryEdgeId`).
- External/application consumers reach thalamus / sweep / sim through console-api HTTP routes; no presentation-layer caller imports sweep/sim package internals directly.
- Every file under `packages/sweep/src/` and `apps/console-api/src/agent/ssa/` answers to exactly one role tag (`types` | `repositories` | `services` | `controllers` | `routes` | `transformers` | `ports` | `utils` | `workers` | `config` | `adapter-pack`).
- `pnpm -r typecheck` clean; `cd packages/sweep && pnpm exec vitest run tests/e2e/swarm-uc3.e2e.spec.ts` green; `cd apps/console-api && pnpm exec vitest run` green.
