// Ports — kernel ↔ pack contracts
export * from "./ports";

// Runtime config registrar + per-consumer providers
export { registerSweepConfigDomains } from "./config/register-runtime-config";
export {
  setSimFishConfigProvider,
  getSimFishConfig,
} from "./config/sim-fish-config";
export {
  setSimSwarmConfigProvider,
  getSimSwarmConfig,
} from "./config/sim-swarm-config";
export {
  setSimEmbeddingConfigProvider,
  getSimEmbeddingConfig,
} from "./config/sim-embedding-config";

// Services
export { SweepResolutionService } from "./services/sweep-resolution.service";

// Repositories
export { SweepRepository } from "./repositories/sweep.repository";
export type {
  SuggestionFeedbackRow,
} from "./repositories/sweep.repository";

// (AdminSweepController + admin.routes.ts deleted in Plan 1 Task 6.1 —
// dead code superseded by console-api's sweep-suggestions.controller +
// sweep-mission.controller.)

// Jobs
export type {
  IngestionRegistry,
  IngestionContext,
  IngestionResult,
  IngestionFetcher,
  IngestionRegistryDeps,
} from "./jobs/ingestion-registry";
export type { Queue as BullQueue } from "bullmq";

// Transformers / DTOs
export * from "./dto/sweep.dto";

// Config helpers
export { redis, getRedis, setRedisClient } from "./config/redis";
export { buildSweepContainer } from "./config/container";
export type {
  SweepContainer,
  BuildSweepOpts,
  SimServices,
} from "./config/container";

// Sim engine (SPEC-SW-006)
export * from "./sim/types";
export * from "./sim/schema";
export * from "./sim/ports";
export * from "./sim/http";

// Aggregator + swarm service
export type {
  Cluster,
  SwarmAggregate,
} from "./sim/aggregator.service";
