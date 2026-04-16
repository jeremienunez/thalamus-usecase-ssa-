## 1) Worker hygiene

- `sim-turn.worker.ts` contains domain orchestration, not just BullMQ glue:
  - Loads `sim_run` state from DB and applies run-state policy in worker ([sim-turn.worker.ts](/home/jerem/interview-thalamus-sweep/packages/sweep/src/jobs/workers/sim-turn.worker.ts#L42), [sim-turn.worker.ts](/home/jerem/interview-thalamus-sweep/packages/sweep/src/jobs/workers/sim-turn.worker.ts#L57)).
  - Routes by simulation kind and decides terminal semantics ([sim-turn.worker.ts](/home/jerem/interview-thalamus-sweep/packages/sweep/src/jobs/workers/sim-turn.worker.ts#L65)).
  - This should move behind one service call (worker = deserialize + call + return).
- `swarm-fish.worker.ts` is heavily business-logic-bearing:
  - Inline turn loop with UC-specific semantics ([swarm-fish.worker.ts](/home/jerem/interview-thalamus-sweep/packages/sweep/src/jobs/workers/swarm-fish.worker.ts#L76)).
  - Status transitions (`done`/`failed`) and failure policy are in worker ([swarm-fish.worker.ts](/home/jerem/interview-thalamus-sweep/packages/sweep/src/jobs/workers/swarm-fish.worker.ts#L101), [swarm-fish.worker.ts](/home/jerem/interview-thalamus-sweep/packages/sweep/src/jobs/workers/swarm-fish.worker.ts#L118)).
  - `onFishComplete` signaling in `finally` is domain policy ([swarm-fish.worker.ts](/home/jerem/interview-thalamus-sweep/packages/sweep/src/jobs/workers/swarm-fish.worker.ts#L122)).
- `swarm-aggregate.worker.ts` has aggregator-domain policy inline:
  - Kind-based routing + telemetry path selection ([swarm-aggregate.worker.ts](/home/jerem/interview-thalamus-sweep/packages/sweep/src/jobs/workers/swarm-aggregate.worker.ts#L67), [swarm-aggregate.worker.ts](/home/jerem/interview-thalamus-sweep/packages/sweep/src/jobs/workers/swarm-aggregate.worker.ts#L75)).
  - Modal threshold policy and suggestion emission rules ([swarm-aggregate.worker.ts](/home/jerem/interview-thalamus-sweep/packages/sweep/src/jobs/workers/swarm-aggregate.worker.ts#L30), [swarm-aggregate.worker.ts](/home/jerem/interview-thalamus-sweep/packages/sweep/src/jobs/workers/swarm-aggregate.worker.ts#L107)).
  - Swarm close-out status logic and telemetry close-out procedure are also in worker ([swarm-aggregate.worker.ts](/home/jerem/interview-thalamus-sweep/packages/sweep/src/jobs/workers/swarm-aggregate.worker.ts#L125), [swarm-aggregate.worker.ts](/home/jerem/interview-thalamus-sweep/packages/sweep/src/jobs/workers/swarm-aggregate.worker.ts#L162)).
- `sweep.worker.ts` is mostly glue but has DI leak:
  - Lazily imports and instantiates `NanoSweepService` inside worker ([sweep.worker.ts](/home/jerem/interview-thalamus-sweep/packages/sweep/src/jobs/workers/sweep.worker.ts#L17), [sweep.worker.ts](/home/jerem/interview-thalamus-sweep/packages/sweep/src/jobs/workers/sweep.worker.ts#L25)).
  - This wiring belongs in container/bootstrap, not worker.
- `helpers.ts` is clean infra abstraction (good): standardized worker creation + event logging ([helpers.ts](/home/jerem/interview-thalamus-sweep/packages/sweep/src/jobs/workers/helpers.ts#L20)).

## 2) Cross-worker duplication (N>=2, >=5 lines)

- Major repeated blocks exist in `sim-turn` + `swarm-fish`:
  - `sim_run` load + status gate + `kind` dispatch + unknown-kind error ([sim-turn.worker.ts](/home/jerem/interview-thalamus-sweep/packages/sweep/src/jobs/workers/sim-turn.worker.ts#L42), [swarm-fish.worker.ts](/home/jerem/interview-thalamus-sweep/packages/sweep/src/jobs/workers/swarm-fish.worker.ts#L51)).
- I would **not** put that into `workers/helpers.ts` because it is business logic. Per your rule, move it into domain services (e.g., runner/orchestrator service methods), then workers call a single method.
- Existing glue duplication (queue connection/event logging) is already centralized in [helpers.ts](/home/jerem/interview-thalamus-sweep/packages/sweep/src/jobs/workers/helpers.ts#L20).

## 3) Queue registration coupling

- `queues.ts` defines queue singletons and close logic centrally ([queues.ts](/home/jerem/interview-thalamus-sweep/packages/sweep/src/jobs/queues.ts#L12), [queues.ts](/home/jerem/interview-thalamus-sweep/packages/sweep/src/jobs/queues.ts#L108)).
- No worker directly imports queue singletons and mutates queue state (good). `sim-turn.worker` imports only a type from queues ([sim-turn.worker.ts](/home/jerem/interview-thalamus-sweep/packages/sweep/src/jobs/workers/sim-turn.worker.ts#L20)).
- Worker-to-worker enqueue chains are routed through orchestrators/services, not direct worker spaghetti:
  - `sim-turn.worker` -> `orchestrator.scheduleNext()` -> enqueue sim-turn ([sim-turn.worker.ts](/home/jerem/interview-thalamus-sweep/packages/sweep/src/jobs/workers/sim-turn.worker.ts#L82), [sim-orchestrator.service.ts](/home/jerem/interview-thalamus-sweep/packages/sweep/src/sim/sim-orchestrator.service.ts#L293)).
  - `swarm-fish.worker` -> `swarmService.onFishComplete()` -> enqueue aggregate ([swarm-fish.worker.ts](/home/jerem/interview-thalamus-sweep/packages/sweep/src/jobs/workers/swarm-fish.worker.ts#L125), [swarm.service.ts](/home/jerem/interview-thalamus-sweep/packages/sweep/src/sim/swarm.service.ts#L186)).
- Note: current file has 5 queue singletons (`sweep`, `satellite`, `sim-turn`, `swarm-fish`, `swarm-aggregate`) and 4 `QueueEvents`, not 6.

## 4) Test coverage gap

- `sim-turn.worker.ts`: no direct unit or integration test coverage found.
- `sweep.worker.ts`: no direct worker coverage found.
- `swarm-fish.worker.ts`: indirectly covered by E2E swarm test booting fish worker ([swarm-uc3.e2e.spec.ts](/home/jerem/interview-thalamus-sweep/packages/sweep/tests/e2e/swarm-uc3.e2e.spec.ts#L114)).
- `swarm-aggregate.worker.ts`: indirectly covered by same E2E ([swarm-uc3.e2e.spec.ts](/home/jerem/interview-thalamus-sweep/packages/sweep/tests/e2e/swarm-uc3.e2e.spec.ts#L121)).
- Telemetry-specific branches in fish/aggregate workers appear untested at worker level (`uc_telemetry_inference` path); existing telemetry unit test mocks `SwarmService` and does not boot BullMQ ([telemetry-swarm.spec.ts](/home/jerem/interview-thalamus-sweep/packages/sweep/tests/unit/telemetry-swarm.spec.ts#L6)).

## 5) Payload type drift

- No runtime field mismatch found in current code:
  - `SimTurnJobPayload` in queues matches worker destructuring (`simRunId`, `turnIndex`) ([queues.ts](/home/jerem/interview-thalamus-sweep/packages/sweep/src/jobs/queues.ts#L44), [sim-turn.worker.ts](/home/jerem/interview-thalamus-sweep/packages/sweep/src/jobs/workers/sim-turn.worker.ts#L40)).
  - Swarm payload fields also currently align (`swarmId`, `simRunId`, `fishIndex`; `swarmId`) ([queues.ts](/home/jerem/interview-thalamus-sweep/packages/sweep/src/jobs/queues.ts#L62), [swarm.service.ts](/home/jerem/interview-thalamus-sweep/packages/sweep/src/sim/swarm.service.ts#L33)).
- Drift risk is real because payload types are duplicated (`*Wire` in `queues.ts` vs service-local interfaces in `swarm.service.ts`), and workers use the service-local types.

## 6) Feature-folder question

- I would keep workers in `jobs/workers/` for now.
- Moving them into `sim/` does not reduce complexity if workers still contain domain logic; it just moves infra concerns into domain folders.
- Better complexity reduction path: keep workers as infra adapters, move current inline domain logic into sim-domain services, and have workers call one service method each. This aligns with your rule and reduces import graph pressure more effectively.
