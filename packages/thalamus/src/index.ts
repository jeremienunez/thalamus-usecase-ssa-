// Services
export { ThalamusService } from "./services/thalamus.service";
export { ThalamusPlanner } from "./services/thalamus-planner.service";
export { ThalamusDAGExecutor } from "./services/thalamus-executor.service";
export { ResearchGraphService } from "./services/research-graph.service";

// Cortices
export { CortexExecutor } from "./cortices/executor";
export { CortexRegistry } from "./cortices/registry";
export * from "./cortices/types";
export { ConfidenceService, InvalidPromotion } from "./cortices/confidence";
export type {
  SourceClass,
  EdgeConfidence,
  EdgeProvenanceEvent,
  PromoteEdgeInput,
  DemoteEdgeInput,
  QueryFilter,
} from "./cortices/confidence";
export { FieldCorrelator, LATENCY_BUDGET_MS } from "./cortices/field-correlation";
export type {
  Priority,
  FieldEvent,
  CorrelationResult,
  LatencyBreach,
  MetricsSink,
  FieldCorrelatorOptions,
  CandidateLookup,
} from "./cortices/field-correlation";

// Explorer
export { ExplorerOrchestrator } from "./explorer/orchestrator";
export {
  callNano,
  callNanoStream,
  callNanoWaves,
  callNanoWithMode,
  NANO_MODEL,
} from "./explorer/nano-caller";

// Transports
export { createLlmTransport, createLlmTransportWithMode } from "./transports/llm-chat";

// Repositories
export { ResearchFindingRepository } from "./repositories/research-finding.repository";
export { ResearchEdgeRepository } from "./repositories/research-edge.repository";
export { ResearchCycleRepository } from "./repositories/research-cycle.repository";

// Controllers/routes
export { ThalamusController } from "./controllers/thalamus.controller";
export { thalamusRoutes } from "./routes/thalamus.routes";

// Utils
export { VoyageEmbedder } from "./utils/voyage-embedder";
export * from "./utils/llm-json-parser";
