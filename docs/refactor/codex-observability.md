1. [metrics.ts](/home/jerem/interview-thalamus-sweep/packages/shared/src/observability/metrics.ts#L8), [server.ts](/home/jerem/interview-thalamus-sweep/apps/console-api/src/server.ts#L10)  
Severity: **High**  
Gap: Metrics collector exists but is not wired anywhere; only `/health` exists, no `/metrics` scrape endpoint.  
One-line fix: Instantiate one `MetricsCollector` per service, expose `/metrics`, and emit counters/histograms in LLM calls, queue workers, and DB repositories.

2. [llm-chat.ts](/home/jerem/interview-thalamus-sweep/packages/thalamus/src/transports/llm-chat.ts#L141), [llm-chat.ts](/home/jerem/interview-thalamus-sweep/packages/thalamus/src/transports/llm-chat.ts#L201), [voyage-embedder.ts](/home/jerem/interview-thalamus-sweep/packages/thalamus/src/utils/voyage-embedder.ts#L45)  
Severity: **High**  
Gap: Kimi/OpenAI fallback transport and Voyage embedding calls use `fetch` without request timeouts, so a hung provider can stall cycle progress.  
One-line fix: Add `AbortSignal.timeout(...)` on all external provider calls and log explicit timeout error type with provider/model context.

3. [queues.ts](/home/jerem/interview-thalamus-sweep/packages/sweep/src/jobs/queues.ts#L108), [helpers.ts](/home/jerem/interview-thalamus-sweep/packages/sweep/src/jobs/workers/helpers.ts#L20), [telemetry-swarm.ts](/home/jerem/interview-thalamus-sweep/packages/sweep/src/demo/telemetry-swarm.ts#L209)  
Severity: **High**  
Gap: Queue/worker close logic exists but is only exercised in demo code; no SIGTERM/SIGINT drain path is wired for real worker processes.  
One-line fix: Add process signal handlers in worker entrypoints to `pause` intake, `await worker.close()`, `closeQueues()`, and close DB/Redis with bounded shutdown timeout.

4. [thalamus.controller.ts](/home/jerem/interview-thalamus-sweep/packages/thalamus/src/controllers/thalamus.controller.ts#L49), [thalamus.service.ts](/home/jerem/interview-thalamus-sweep/packages/thalamus/src/services/thalamus.service.ts#L72), [helpers.ts](/home/jerem/interview-thalamus-sweep/packages/sweep/src/jobs/workers/helpers.ts#L26)  
Severity: **High**  
Gap: Request/cycle/swarm correlation is incomplete; early cycle logs lack `cycleId`, and worker event logs only include `jobId/jobName` (not job payload keys like `swarmId/simRunId`).  
One-line fix: Generate/propagate a correlation object (`requestId`, `cycleId`, `swarmId`, `simRunId`) and use child loggers at API entry + worker processor + queue events.

5. [steps.ts](/home/jerem/interview-thalamus-sweep/packages/shared/src/observability/steps.ts#L1), [turn-runner-sequential.ts](/home/jerem/interview-thalamus-sweep/packages/sweep/src/sim/turn-runner-sequential.ts#L251), [aggregator.service.ts](/home/jerem/interview-thalamus-sweep/packages/sweep/src/sim/aggregator.service.ts#L67), [sweep-resolution.service.ts](/home/jerem/interview-thalamus-sweep/packages/sweep/src/services/sweep-resolution.service.ts#L73)  
Severity: **Medium**  
Gap: Step registry defines many lifecycle events (`fish.memory.read`, `aggregator`, `suggestion.emit`, `kg.write`, etc.) that are not emitted in corresponding hot paths.  
One-line fix: Add `stepLog(start/done/error)` around memory reads, aggregation, suggestion emission, and sweep resolution dispatch/write phases.

6. [satellite-sweep-chat.controller.ts](/home/jerem/interview-thalamus-sweep/packages/sweep/src/controllers/satellite-sweep-chat.controller.ts#L26), [thalamus.routes.ts](/home/jerem/interview-thalamus-sweep/packages/thalamus/src/routes/thalamus.routes.ts#L11), [god-channel.service.ts](/home/jerem/interview-thalamus-sweep/packages/sweep/src/sim/god-channel.service.ts#L52)  
Severity: **Medium**  
Gap: Real-time operator visibility is narrow: SSE exists for satellite chat only; thalamus cycle and swarm/god-channel progress are log-only/polling.  
One-line fix: Add SSE (or websocket) streams for cycle/swarm/god events with correlation IDs and step lifecycle payloads.

7. [orchestrator.ts](/home/jerem/interview-thalamus-sweep/packages/thalamus/src/explorer/orchestrator.ts#L34), [messaging.service.ts](/home/jerem/interview-thalamus-sweep/packages/sweep/src/services/messaging.service.ts#L29), [viz.service.ts](/home/jerem/interview-thalamus-sweep/packages/sweep/src/services/viz.service.ts#L23)  
Severity: **Medium**  
Gap: Structured logging is inconsistent; multiple logs are plain string markers or use string-first/object-second calls that weaken queryability.  
One-line fix: Standardize on object-first logs (`logger.info({ ...context }, "event")`) and require event names + typed fields for all operational logs.

8. [helpers.ts](/home/jerem/interview-thalamus-sweep/packages/sweep/src/jobs/workers/helpers.ts#L33), [swarm-fish.worker.ts](/home/jerem/interview-thalamus-sweep/packages/sweep/src/jobs/workers/swarm-fish.worker.ts#L112), [thalamus-executor.service.ts](/home/jerem/interview-thalamus-sweep/packages/thalamus/src/services/thalamus-executor.service.ts#L74), [satellite-sweep-chat.controller.ts](/home/jerem/interview-thalamus-sweep/packages/sweep/src/controllers/satellite-sweep-chat.controller.ts#L40)  
Severity: **Medium**  
Gap: Error logs often lose debuggability (stringified errors, missing stack, or missing business context like satellite/user/cycle/swarm IDs).  
One-line fix: Always log raw `Error` under `err` plus operation context (`satelliteId`, `swarmId`, `cycleId`, `action`, `attempt`) in every catch/fail path.

9. [nano-caller.ts](/home/jerem/interview-thalamus-sweep/packages/thalamus/src/explorer/nano-caller.ts#L194), [llm-chat.ts](/home/jerem/interview-thalamus-sweep/packages/thalamus/src/transports/llm-chat.ts#L66), [async-handler.ts](/home/jerem/interview-thalamus-sweep/packages/shared/src/utils/async-handler.ts#L89)  
Severity: **Medium**  
Gap: Retry policy is uneven: nano wave calls are single-attempt, while shared retry defaults to retrying everything unless `shouldRetry` is manually passed.  
One-line fix: Define centralized retry classes (timeout/429/5xx retriable; 4xx terminal) and apply them uniformly to nano, transport, and queue-facing operations.

10. [server.ts](/home/jerem/interview-thalamus-sweep/apps/console-api/src/server.ts#L10), [thalamus.routes.ts](/home/jerem/interview-thalamus-sweep/packages/thalamus/src/routes/thalamus.routes.ts#L8), [queues.ts](/home/jerem/interview-thalamus-sweep/packages/sweep/src/jobs/queues.ts#L93)  
Severity: **Medium**  
Gap: Health/readiness is shallow (timestamp-only health in one app), and queue depth/lag is not exposed for operations.  
One-line fix: Add `live`/`ready` endpoints that check DB+Redis+queue connectivity and expose BullMQ depth/lag gauges per queue.

11. [CommandPalette.tsx](/home/jerem/interview-thalamus-sweep/apps/console/src/components/CommandPalette.tsx#L24), [index.ts](/home/jerem/interview-thalamus-sweep/packages/cli/src/index.ts#L3), [step-logger.ts](/home/jerem/interview-thalamus-sweep/packages/shared/src/observability/step-logger.ts#L34)  
Severity: **Low**  
Gap: Residual `console.*` calls remain in app/CLI/shared paths, bypassing structured logger standards.  
One-line fix: Replace `console.*` with `createLogger` usage (or intentional ESLint-approved CLI-only output wrappers) and include consistent context fields.
