// Ports — kernel ↔ pack contracts (consumed by apps/console-api/src/agent/ssa/)
export * from "./ports";

// Services
export { NanoSweepService } from "./services/nano-sweep.service";
export { SweepResolutionService } from "./services/sweep-resolution.service";
export type { OnSimUpdateAccepted } from "./services/sweep-resolution.service";
export { MessagingService } from "./services/messaging.service";
export { FindingRouterService } from "./services/finding-router.service";
export type { FindingRouterDeps } from "./services/finding-router.service";

// Repositories
export { SweepRepository } from "./repositories/sweep.repository";
export type {
  InsertSuggestion,
  PastFeedback,
  SweepSuggestionRow,
} from "./repositories/sweep.repository";
export { SatelliteRepository } from "./repositories/satellite.repository";

// (AdminSweepController + admin.routes.ts deleted in Plan 1 Task 6.1 —
// dead code superseded by console-api's sweep-suggestions.controller +
// sweep-mission.controller.)

// Jobs
export { createSweepWorker } from "./jobs/workers/sweep.worker";
export { createIngestionWorker } from "./jobs/workers/ingestion.worker";
export {
  IngestionRegistry,
  createIngestionRegistry,
} from "./jobs/ingestion-registry";
export type {
  IngestionContext,
  IngestionResult,
  IngestionFetcher,
  IngestionRegistryDeps,
} from "./jobs/ingestion-registry";
export {
  sweepQueue,
  satelliteQueue,
  ingestionQueue,
  sweepQueueEvents,
  ingestionQueueEvents,
  closeQueues,
} from "./jobs/queues";
export type { Queue as BullQueue } from "bullmq";
export { registerSchedulers } from "./jobs/schedulers";

// Transformers / DTOs
export * from "./transformers/sweep.dto";

// Config helpers
export { redis, getRedis, setRedisClient } from "./config/redis";
export { buildSweepContainer } from "./config/container";
export type {
  SweepContainer,
  BuildSweepOpts,
  SimServices,
} from "./config/container";

// (auth.middleware stubs kept in-tree for legacy sweep-internal use but no
// longer re-exported — console-api carries its own copy compatible with
// its Fastify v5 types.)

// Sim engine (SPEC-SW-006)
export * from "./sim/types";
export * from "./sim/schema";
export { buildOperatorAgent } from "./sim/agent-builder";
export type {
  BuildAgentOpts,
  BuildAgentResult,
  RiskProfile,
} from "./sim/agent-builder";
export { MemoryService } from "./sim/memory.service";
export type {
  EmbedFn,
  MemoryRow,
  ObservableTurnRow,
  WriteMemoryInput,
  TopKOpts,
  RecentObservableOpts,
} from "./sim/memory.service";
export { renderTurnPrompt } from "./sim/prompt";
export {
  isKgPromotable,
  isTerminal,
  loadSimTurn,
  emitSuggestionFromModal,
  emitTelemetrySuggestions,
} from "./sim/promote";
export type { EmitSuggestionDeps, EmitTelemetrySuggestionsDeps } from "./sim/promote";
export { TelemetryAggregatorService } from "./sim/aggregator-telemetry";
export type {
  TelemetryAggregate,
  TelemetryAggregatorDeps,
  TelemetryScalarStats,
} from "./sim/aggregator-telemetry";
export { startTelemetrySwarm } from "./sim/telemetry-swarm.service";
export type { TelemetrySwarmOpts } from "./sim/telemetry-swarm.service";
export {
  lookupBusPrior,
  lookupBusEntry,
  listBusNames,
} from "./sim/bus-datasheets";
export { SequentialTurnRunner } from "./sim/turn-runner-sequential";
export type {
  SequentialRunnerDeps,
  RunTurnOpts,
  RunTurnResult,
} from "./sim/turn-runner-sequential";
export { DagTurnRunner } from "./sim/turn-runner-dag";
export type {
  DagRunnerDeps,
  DagRunTurnOpts,
  DagRunTurnResult,
} from "./sim/turn-runner-dag";
export { SimOrchestrator } from "./sim/sim-orchestrator.service";
export type {
  OrchestratorDeps,
  CreateFishOpts,
  CreateFishResult,
  StartStandaloneOpts,
  StartStandaloneResult,
  GodEventInput,
  SimStatus,
} from "./sim/sim-orchestrator.service";
export { GodChannelService, GOD_EVENT_TEMPLATES } from "./sim/god-channel.service";
export { createSimTurnWorker } from "./jobs/workers/sim-turn.worker";
export type { SimTurnWorkerDeps } from "./jobs/workers/sim-turn.worker";
export { createSwarmFishWorker } from "./jobs/workers/swarm-fish.worker";
export type { SwarmFishWorkerDeps } from "./jobs/workers/swarm-fish.worker";
export { createSwarmAggregateWorker } from "./jobs/workers/swarm-aggregate.worker";
export type { SwarmAggregateWorkerDeps } from "./jobs/workers/swarm-aggregate.worker";
export {
  simTurnQueue,
  simTurnQueueEvents,
  swarmFishQueue,
  swarmFishQueueEvents,
  swarmAggregateQueue,
  swarmAggregateQueueEvents,
} from "./jobs/queues";
export type { SimTurnJobPayload } from "./jobs/queues";

// Aggregator + swarm service
export { AggregatorService, cosineKMeans } from "./sim/aggregator.service";
export type {
  AggregatorDeps,
  FishTerminal,
  Cluster,
  SwarmAggregate,
} from "./sim/aggregator.service";
export { SwarmService } from "./sim/swarm.service";
export type {
  SwarmServiceDeps,
  LaunchSwarmOpts,
  LaunchSwarmResult,
  SwarmStatus as SimSwarmStatus2, // avoid collision with db-schema re-export
  SwarmFishJobPayload,
  SwarmAggregateJobPayload,
} from "./sim/swarm.service";
export {
  rngFromSeed,
  applyPerturbation,
  generateDefaultPerturbations,
} from "./sim/perturbation";
export type { Rng } from "./sim/perturbation";
