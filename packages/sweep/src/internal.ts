// Internal monorepo surface for sweep/sim execution internals.
// Keep `src/index.ts` focused on the public kernel contract.

// Services
export { NanoSweepService } from "./services/nano-sweep.service";
export { MessagingService } from "./services/messaging.service";
export { FindingRouterService } from "./services/finding-router.service";
export type { FindingRouterDeps } from "./services/finding-router.service";

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
  auditTargetQueue,
  ingestionQueue,
  sweepQueueEvents,
  ingestionQueueEvents,
  closeQueues,
  simTurnQueue,
  simTurnQueueEvents,
  swarmFishQueue,
  swarmFishQueueEvents,
  swarmAggregateQueue,
  swarmAggregateQueueEvents,
} from "./jobs/queues";
export type { SimTurnJobPayload } from "./jobs/queues";
export type { Queue as BullQueue } from "bullmq";
export { registerSchedulers } from "./jobs/schedulers";

// Sim engine internals
export { buildSimAgent } from "./sim/agent-builder";
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
export {
  isKgPromotable,
  isTerminal,
} from "./sim/promote";
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
export { createSimTurnWorker } from "./jobs/workers/sim-turn.worker";
export type { SimTurnWorkerDeps } from "./jobs/workers/sim-turn.worker";
export { createSwarmFishWorker } from "./jobs/workers/swarm-fish.worker";
export type { SwarmFishWorkerDeps } from "./jobs/workers/swarm-fish.worker";
export { createSwarmAggregateWorker } from "./jobs/workers/swarm-aggregate.worker";
export type { SwarmAggregateWorkerDeps } from "./jobs/workers/swarm-aggregate.worker";
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
  SwarmStatus as SimSwarmStatus2,
  SwarmFishJobPayload,
  SwarmAggregateJobPayload,
} from "./sim/swarm.service";
export { rngFromSeed, applyPerturbation } from "./sim/perturbation";
export type { Rng } from "./sim/perturbation";
export {
  average,
  clamp,
  mostFrequent,
  percentile,
  sampleStddev,
} from "./sim/utils/stats";
