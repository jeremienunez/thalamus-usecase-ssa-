// Container
export { buildThalamusContainer } from "./config/container";
export type { ThalamusContainer, BuildThalamusOpts } from "./config/container";

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
  BAS_NIVEAU_LOGIT_BIAS,
  NANO_MODEL,
} from "./explorer/nano-caller";

// Transports
export { createLlmTransport } from "./transports/llm-chat";
export { createLlmTransportWithMode } from "./transports/factory";
export type { LlmChatConfig, LlmResponse, LlmTransport } from "./transports/types";

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
