# Plan 6 — Sweep five-layer + sim↔sweep boundary

## 0. Context recap

- Branch `refactor/sim-agnostic` landed Plans 1 & 2.
- **Plan 1** made `packages/sweep/` a generic kernel with 6 ports (`FindingDomainSchema`, `DomainAuditProvider`, `SweepPromotionAdapter`, `FindingRoutingPolicy`, `ResolutionHandlerRegistry`, `IngestionSourceProvider`) — impls in `apps/console-api/src/agent/ssa/sweep/`.
- **Plan 2** moved the SSA sim pack alongside (10 sim ports), but the sim↔sweep promotion glue still sits in `packages/sweep/src/sim/promote.ts` (592 LOC; SRP-violating god file) and in `packages/sweep/src/config/container.ts` (the `simHook.cb` closure at [container.ts:159-267](/home/jerem/interview-thalamus-sweep/packages/sweep/src/config/container.ts#L159)).
- **Console-api** already uses the canonical 5-layer stack (`routes/ → controllers/ → services/ → repositories/ → types/` with `transformers/` + `schemas/` + `utils/`). The sweep kernel has **no** such layering — it mixes services/repos/jobs/sim freely.

**Goal of Plan 6:** Extend the console-api 5-layer contract across the sweep kernel + the sim↔sweep boundary, so responsibilities stop leaking. Result: each file answers one question ("who owns sweep_audit writes?", "who owns KG writes?", "who decides sim→sweep promotion?") with exactly one name.

---

## 1. Layer definitions (recap + sweep examples)

| Layer                  | Purpose                                                              | Sweep example today                                                                                                                | Sweep example after Plan 6                                                                                                                        |
| ---------------------- | -------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------- |
| `types/`               | Pure types / DTO interfaces; no runtime deps                         | `transformers/sweep.dto.ts` (zod schemas + `SweepCategory/Severity`)                                                               | Same + extracted sim-promotion DTO types                                                                                                          |
| `repositories/`        | Storage I/O only (Redis, Postgres, BullMQ queues). No business rules | `SweepRepository` (Redis)                                                                                                          | `SweepRepository` + a **`ResearchKgRepository`** (Postgres `research_cycle/finding/edge` writes lifted out of `promote.ts`)                       |
| `services/`            | Business logic, orchestration, pure functions                        | `NanoSweepService`, `SweepResolutionService`, `FindingRouterService`, `MessagingService` (kernel); `SweepSuggestionsService` (app) | `SweepResolutionService` (orchestration), **`SweepPromotionService`** (audit+KG+confidence compose), **`SimPromotionService`** (modal→suggestion) |
| `controllers/`         | HTTP request/reply adapters only                                     | `sweep-suggestions.controller`, `sweep-mission.controller` (in console-api)                                                        | Same (zero kernel-side controllers — `admin-sweep.controller` was deleted in Plan 1 task 6.1)                                                     |
| `routes/`              | Fastify URL binding                                                  | `apps/console-api/src/routes/sweep.routes.ts`                                                                                      | Same                                                                                                                                              |
| `workers/` (auxiliary) | BullMQ job entrypoints; thin, delegate to services                   | `sweep.worker`, `sim-turn.worker`, `swarm-fish.worker`, `swarm-aggregate.worker`                                                   | Same, but aggregate worker delegates via the new **`SimPromotionService`** port instead of an inline closure                                      |

**Supporting layers** (same status as console-api):

- `transformers/` → DTO ↔ domain mappers (already exists in sweep: `transformers/sweep.dto.ts`)
- `ports/` → DIP boundary contracts (already exists: 6 sweep ports + 10 sim ports + 1 sim-promotion port)
- `config/` → DI container composition root
- `utils/` → pure helpers (already exists: `llm-json-parser`, `sql-helpers`, `controller-error-handler`)

**The load-bearing rule for Plan 6:** the kernel must not contain SSA-shaped code, and the SSA pack must not contain BullMQ or Postgres writes except through repositories. `promote.ts` breaks both.

---

## 2. Current-state audit — SRP violations by file

### 2.1 `packages/sweep/src/sim/promote.ts` (592 L) — SEVEN responsibilities in ONE file

| Resp. | LOC                                                                                                                                                                        | What it does                                                                                                                                                                                  | Layer it belongs in                                                                                                                    |
| ----- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------- |
| A     | [promote.ts:38-60](/home/jerem/interview-thalamus-sweep/packages/sweep/src/sim/promote.ts#L38) (`isKgPromotable`, `isTerminal`, `loadSimTurn`)                             | Pure predicates + a trivial Postgres read                                                                                                                                                     | Split: predicates → `utils/` (kernel), `loadSimTurn` → `SimRunRepository`                                                              |
| B     | [promote.ts:82-294](/home/jerem/interview-thalamus-sweep/packages/sweep/src/sim/promote.ts#L82) (`emitSuggestionFromModal`)                                                | UC3 end-to-end: resolve operator context, **open `research_cycle`**, **insert `research_finding`**, **insert `research_edge`**, **update `sim_swarm`**, **insert `sweep_suggestion`** (Redis) | Services in the SSA **sim pack** (`SimPromotionService`), composing `ResearchKgRepository` + `SweepRepository` + `SsaPromotionAdapter` |
| C     | [promote.ts:301-367](/home/jerem/interview-thalamus-sweep/packages/sweep/src/sim/promote.ts#L301) (`actionTarget`, `composeTitle`, `composeDescription`, `describeAction`) | Pure formatting / mapping                                                                                                                                                                     | `transformers/` in SSA sim pack                                                                                                        |
| D     | [promote.ts:369-379](/home/jerem/interview-thalamus-sweep/packages/sweep/src/sim/promote.ts#L369) (`safeEmbed`)                                                            | Optional embedder wrapper                                                                                                                                                                     | `utils/` in SSA sim pack                                                                                                               |
| E     | [promote.ts:406-543](/home/jerem/interview-thalamus-sweep/packages/sweep/src/sim/promote.ts#L406) (`emitTelemetrySuggestions`)                                             | UC_TELEMETRY: read 8 NULL columns, compute severity, build per-scalar suggestions, Redis insert                                                                                               | Services in SSA sim pack (second `SimPromotionService` method or sister service)                                                       |
| F     | [promote.ts:545-561](/home/jerem/interview-thalamus-sweep/packages/sweep/src/sim/promote.ts#L545) (`findNullTelemetryColumns`)                                             | Raw SQL                                                                                                                                                                                       | `SatelliteTelemetryRepository` in console-api (new)                                                                                    |
| G     | [promote.ts:568-587](/home/jerem/interview-thalamus-sweep/packages/sweep/src/sim/promote.ts#L568) (`scoreScalar`)                                                          | Pure scoring                                                                                                                                                                                  | `utils/` in SSA sim pack                                                                                                               |

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

**SRP violation:** the container holds a `simHook` mutable closure that reaches into `ConfidenceService`. This is business logic (confidence promotion rule), **not wiring**. After Plan 6 the closure moves into `SimPromotionService.onUpdateFieldAccepted`, and the container passes only dependencies.

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

All files below are already service-shaped. They implement kernel ports.

| File                         | Layer role                                     |
| ---------------------------- | ---------------------------------------------- |
| `finding-schema.ssa.ts`      | Transformer (implements `FindingDomainSchema`) |
| `audit-provider.ssa.ts`      | Service (implements `DomainAuditProvider`)     |
| `promotion.ssa.ts`           | Service (implements `SweepPromotionAdapter`)   |
| `finding-routing.ssa.ts`     | Service (implements `FindingRoutingPolicy`)    |
| `resolution-handlers.ssa.ts` | Service registry (5 handlers)                  |
| `doctrine-parser.ssa.ts`     | Util                                           |
| `ingesters/*`                | Services (implement `IngestionSource`)         |

### 3.3 SSA sim pack (`apps/console-api/src/agent/ssa/sim/`) — **the sim→sweep boundary lives here**

| File                                                                                                | Role post-Plan 6                                                                                                                                                                                                                                                  |
| --------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `promotion.ts`                                                                                      | **Service: `SsaSimPromotionAdapter`** — implement `promote()` (today = throw TODO B.9). Receives `SimPromoteInput` (from swarm-aggregate worker), composes `ResearchKgRepository.insertCycle/Finding/Edge` + `SweepRepository.insertOne` + `SsaPromotionAdapter`. |
| `swarms/telemetry.ts`, `swarms/pc.ts`                                                               | Services — swarm launchers                                                                                                                                                                                                                                        |
| `aggregators/pc.ts`                                                                                 | Service (PC aggregation + suggestion shape)                                                                                                                                                                                                                       |
| `bus-datasheets/loader.ts`                                                                          | Repository-like (reads a JSON asset)                                                                                                                                                                                                                              |
| `action-schema.ts`, `persona-composer.ts`, `prompt-renderer.ts`, `perturbation-pack.ts`, etc.       | Services / transformers                                                                                                                                                                                                                                           |
| `kind-guard.ts`, `aggregation-strategy.ts`, `cortex-selector.ts`, `fleet-provider.ts`, `targets.ts` | Services (port implementations)                                                                                                                                                                                                                                   |

### 3.4 New files to create in console-api (Plan 6 scope)

```
apps/console-api/src/
  repositories/
    research-kg.repository.ts       # research_cycle/finding/edge writes (lifted from promote.ts)
    satellite-telemetry.repository.ts # findNullTelemetryColumns (lifted from promote.ts:545)
    sim-run.repository.ts           # loadSimTurn (lifted from promote.ts:51)
  services/
    sim-promotion.service.ts        # UC3 modal → suggestion + UC_TELEMETRY scalar → suggestions
    confidence-promotion.service.ts # SIM_UNCORROBORATED → OSINT_CORROBORATED rule (from container.ts simHook)
  transformers/
    sim-suggestion.transformer.ts   # composeTitle/Description/describeAction/actionTarget
  utils/
    sim-predicates.ts               # isKgPromotable, isTerminal, scoreScalar
```

### 3.5 End-to-end flow: UC3 sim → reviewer accept → KG write

Expressed in 5-layer terms (post-Plan 6):

1. **Route** `POST /api/sweep/suggestions/:id/review` in `routes/sweep.routes.ts`.
2. **Controller** `sweepReviewController` parses params + body → calls `SweepSuggestionsService.review(id, accept, reason)`.
3. **Service** `SweepSuggestionsService.review` calls `SweepRepository.review(id, accept, reason)` (Redis flag). If `accept`, calls `SweepResolutionService.resolve(id)`.
4. **Service** `SweepResolutionService.resolve` → loads row via `SweepRepository.getGeneric`, parses payload, dispatches each action to `ResolutionHandlerRegistry` (SSA handlers, e.g., `update_field` → `SatelliteRepository.updateField`). On success: calls `SweepPromotionAdapter.promote(...)`.
5. **Service** (SSA) `SsaPromotionAdapter.promote` → `SweepAuditRepository.insertResolutionAudit` + (optional) `ConfidencePromotionService.onUpdateFieldAccepted`.
6. **Repository** `SatelliteRepository.updateField` and `SweepAuditRepository.insertResolutionAudit` — DB writes.

**The sim side of the loop** (swarm → suggestion, runs _before_ step 1):

1. **Worker** `swarm-aggregate.worker` fires when all fish drained.
2. **Service** `AggregatorService.aggregate(swarmId)` → returns `SwarmAggregate`.
3. **Service** `SimPromotionService.promote(swarmId, aggregate)` (via the **`SimPromotionAdapter` port**, not via inline closure):
   - UC3 path: `ResearchKgRepository.insertCycle` → `insertFinding` → `insertEdge` → `SimRunRepository.updateSwarmOutcome` → `SweepRepository.insertOne`.
   - UC_TELEMETRY path: `SatelliteTelemetryRepository.findNullColumns` → loop over scalars → `SweepRepository.insertOne` per scalar.
4. **Repository** writes land in Postgres + Redis.

Each layer has **one** reason to change.

---

## 4. Dismantling `promote.ts`

Per-LOC mapping (copy this table into the PR description):

| Source (packages/sweep/src/sim/promote.ts)     | Destination (apps/console-api/src/...)                                 | Layer       |
| ---------------------------------------------- | ---------------------------------------------------------------------- | ----------- |
| L38-44 `isKgPromotable`, `isTerminal`          | `utils/sim-predicates.ts`                                              | utils       |
| L51-60 `loadSimTurn`                           | `repositories/sim-run.repository.ts#loadSimTurn`                       | repo        |
| L82-294 `emitSuggestionFromModal`              | `services/sim-promotion.service.ts#promoteModal`                       | service     |
| L134-154 `researchCycle.insert`                | `repositories/research-kg.repository.ts#insertCycle`                   | repo        |
| L169-203 `researchFinding.insert`              | `repositories/research-kg.repository.ts#insertFinding`                 | repo        |
| L209-221 `researchEdge.insert`                 | `repositories/research-kg.repository.ts#insertEdge`                    | repo        |
| L228-232 `simSwarm.update`                     | `repositories/sim-run.repository.ts#setSwarmOutcomeFindingId`          | repo        |
| L266-279 `sweepRepo.insertOne`                 | stays — called from `SimPromotionService`                              | repo call   |
| L301-317 `actionTarget`                        | `transformers/sim-suggestion.transformer.ts`                           | transformer |
| L319-346 `composeTitle` / `composeDescription` | `transformers/sim-suggestion.transformer.ts`                           | transformer |
| L348-367 `describeAction`                      | `transformers/sim-suggestion.transformer.ts`                           | transformer |
| L369-379 `safeEmbed`                           | `utils/embed-safe.ts` (or inline)                                      | util        |
| L406-543 `emitTelemetrySuggestions`            | `services/sim-promotion.service.ts#promoteTelemetry`                   | service     |
| L545-561 `findNullTelemetryColumns`            | `repositories/satellite-telemetry.repository.ts#findNullScalarColumns` | repo        |
| L568-587 `scoreScalar`                         | `utils/sim-predicates.ts`                                              | util        |
| L589-591 `round`                               | `utils/math.ts` (or inline)                                            | util        |

After Plan 6: `packages/sweep/src/sim/promote.ts` → **deleted**. Its exports (`isKgPromotable`, `isTerminal`, `loadSimTurn`, `emitSuggestionFromModal`, `emitTelemetrySuggestions`, `EmitSuggestionDeps`, `EmitTelemetrySuggestionsDeps`) are removed from [packages/sweep/src/index.ts:88-94](/home/jerem/interview-thalamus-sweep/packages/sweep/src/index.ts#L88).

The `swarm-aggregate` worker stops taking `emitSuggestion` / `emitTelemetrySuggestions` callbacks and takes a single `SimPromotionAdapter` port instead. Its e2e test ([apps/console-api/tests/e2e/swarm-uc3.e2e.spec.ts:157-162](/home/jerem/interview-thalamus-sweep/apps/console-api/tests/e2e/swarm-uc3.e2e.spec.ts#L157)) wires the new adapter.

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
| `swarm-aggregate.worker.ts` | `AggregatorService.aggregate` → `SimPromotionService.promote` (single port call, replacing today's 2 optional callbacks) |

---

## 6. Phased migration

### Phase A — Port formalization (LOW risk, zero behavior change)

Goal: give names to things already half-named, and delete the "optional callback" DI pattern from the aggregate worker.

- A.1 Promote `SimPromotionAdapter` from scaffold to used port. Rewire `createSwarmAggregateWorker` to take `simPromotion: SimPromotionAdapter` instead of `emitSuggestion` + `emitTelemetrySuggestions`. Inside the worker, `await simPromotion.promote({ swarmId, aggregate, kind })`.
- A.2 Temporarily route `simPromotion` to a pass-through adapter that calls today's `emitSuggestionFromModal` / `emitTelemetrySuggestions`. `promote.ts` untouched.
- A.3 Update `apps/console-api/tests/e2e/swarm-uc3.e2e.spec.ts` to pass the new adapter. Green-bar check.

**Risk gate:** UC3 e2e green + `pnpm -r typecheck` clean.

### Phase B — Repository extraction (LOW risk, pure moves)

Goal: move Postgres writes out of `promote.ts` and the `simHook` closure into named repositories that the SSA sim pack depends on.

- B.1 Create `apps/console-api/src/repositories/research-kg.repository.ts` with `insertCycle`, `insertFinding`, `insertEdge`. Tests: unit (mock db) + integration (real schema).
- B.2 Create `apps/console-api/src/repositories/sim-run.repository.ts` with `loadSimTurn`, `setSwarmOutcomeFindingId`.
- B.3 Create `apps/console-api/src/repositories/satellite-telemetry.repository.ts` with `findNullScalarColumns(satelliteId)`.
- B.4 Fix the post-build patch at [apps/console-api/src/container.ts:217-221](/home/jerem/interview-thalamus-sweep/apps/console-api/src/container.ts#L217) by passing a `() => sweepRepo.loadPastFeedback()` thunk in `SsaAuditDeps` (or deferring to a late-bound provider).

**Risk gate:** all unit specs + UC3 e2e green. Zero runtime behavior change — `promote.ts` still calls the old inline SQL; the new repos are additive.

### Phase C — Service extraction (MEDIUM risk, real behavior move)

Goal: replace the pass-through `SsaSimPromotionAdapter` from Phase A with a real implementation composed of the new repositories + transformers.

- C.1 Create `apps/console-api/src/transformers/sim-suggestion.transformer.ts` (lift `composeTitle` / `composeDescription` / `describeAction` / `actionTarget` from `promote.ts:301-367`).
- C.2 Create `apps/console-api/src/utils/sim-predicates.ts` (lift `isKgPromotable`, `isTerminal`, `scoreScalar`).
- C.3 Create `apps/console-api/src/services/sim-promotion.service.ts` with `promoteModal(swarmId, aggregate)` and `promoteTelemetry(aggregate)`. Compose: `ResearchKgRepository` + `SimRunRepository` + `SatelliteTelemetryRepository` + `SweepRepository` + `SsaPromotionAdapter` + transformers.
- C.4 Create `apps/console-api/src/services/confidence-promotion.service.ts` — encapsulate the `simHook` rule from [packages/sweep/src/config/container.ts:249-266](/home/jerem/interview-thalamus-sweep/packages/sweep/src/config/container.ts#L249) (`telemetryEdgeId` derivation + `confidenceService.promote`). Exposed method: `onUpdateFieldAccepted(event)`.
- C.5 Extend `SsaPromotionAdapter` so it calls `confidencePromotion.onUpdateFieldAccepted` when the action is `update_field` with sim provenance. Remove the confidence stub branch at [apps/console-api/src/agent/ssa/sweep/promotion.ssa.ts:73-81](/home/jerem/interview-thalamus-sweep/apps/console-api/src/agent/ssa/sweep/promotion.ssa.ts#L73).
- C.6 Wire the real `SsaSimPromotionAdapter` in `apps/console-api/src/container.ts`, replacing the pass-through from A.2.
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

1. **Container construction cycle.** `SsaPromotionAdapter` wants `ConfidencePromotionService`, which wants `ConfidenceService` from the sweep container, which is built after `SsaPromotionAdapter` today. Mitigation: build `ConfidenceService` in console-api's container _before_ `buildSweepContainer` and pass it both into `SsaPromotionAdapter` and the sweep container as `opts.confidenceService` (new field). This inverts today's ownership cleanly.
2. **Test fixtures couple to the god file.** `apps/console-api/tests/e2e/swarm-uc3.e2e.spec.ts` imports `emitSuggestionFromModal` directly. Phase A.3 rewires first; Phase D must confirm no other test pins the symbol.
3. **BullMQ job payload drift.** `SwarmAggregateJobPayload` is fine today; workers only change in how they dispatch (new port). Do not alter payload shape in Phase A (it would force a queue drain migration).
4. **ConfidenceService key collisions.** `telemetryEdgeId` synthesises an FNV-1a over `${satelliteId}:${field}`. Moving to `ConfidencePromotionService` preserves the derivation verbatim; do not "clean it up". Pin with a unit test.
5. **Redis TTL on suggestions.** `SweepRepository` uses `TTL_SECS = 90 days` ([sweep.repository.ts:26](/home/jerem/interview-thalamus-sweep/packages/sweep/src/repositories/sweep.repository.ts#L26)). Suggestions promoted from sim still go through `insertOne` — TTL unchanged in Plan 6.
6. **Legacy sweep-internal CLI fallbacks.** CLI was explicitly deferred to Plan 3. Phase D must not break CLI `boot.ts` — double-check `sweepC.resolutionService.resolve(id)` still works by grepping the `packages/cli/src` tree before removing any container fallback.
7. **Two suggestion sources, one audit trail.** Both UC3 modal promotion and reviewer-accept promotion write to `sweep_audit` via `SweepAuditRepository.insertResolutionAudit`. Verify we do not double-insert when a sim suggestion is later reviewer-accepted. Write an integration test covering this path in Phase C.

---

## 8. Success criteria

- `promote.ts` deleted.
- `SimPromotionAdapter` is the single sim→sweep contract (one port, one impl, one call-site in `swarm-aggregate.worker`).
- `apps/console-api/src/container.ts` has zero post-build patches.
- `packages/sweep/src/config/container.ts` has zero business-rule closures (no `simHook`, no `telemetryEdgeId`).
- Every file under `packages/sweep/src/` and `apps/console-api/src/agent/ssa/` answers to exactly one layer tag (`types` | `repositories` | `services` | `controllers` | `routes` | `transformers` | `ports` | `utils` | `workers` | `config`).
- `pnpm -r typecheck` clean; `cd packages/sweep && pnpm exec vitest run tests/e2e/swarm-uc3.e2e.spec.ts` green; `cd apps/console-api && pnpm exec vitest run` green.
