// Container
export { buildThalamusContainer } from "./config/container";
export type { ThalamusContainer, BuildThalamusOpts } from "./config/container";

// Runtime config — registrar + per-consumer provider setters
export { registerThalamusConfigDomains } from "./config/register-runtime-config";
export {
  setPlannerConfigProvider,
  setCortexConfigProvider,
  setReflexionConfigProvider,
  getPlannerConfig,
  getCortexConfig,
  getReflexionConfig,
} from "./config/runtime-config";

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
  setNanoConfigProvider,
  BAS_NIVEAU_LOGIT_BIAS,
  NANO_MODEL,
} from "./explorer/nano-caller";
export type { NanoRequest, NanoResponse } from "./explorer/nano-caller";
export {
  setNanoSwarmConfigProvider,
  setNanoSwarmProfile,
  setEntityExtractor,
} from "./explorer/nano-swarm";
export type {
  CrawlerExtraction,
  EntityExtractorFn,
} from "./explorer/nano-swarm";
// TEMP bridge (Task 3.3d → 3.3e): kernel still hosts the SSA entity
// patterns file (satellite-entity-patterns.ts). Export the two symbols
// the SSA bridge needs so apps/console-api can build without reaching
// into kernel internals. Task 3.3e moves the file and drops this export.
export {
  extractSatelliteEntities,
  DATA_POINT_RE,
} from "./utils/satellite-entity-patterns";
export { setCuratorPrompt } from "./explorer/curator";
export type { ExplorationQuery } from "./explorer/scout";

// Domain profile types (injected from consumers at boot)
export type {
  Lens,
  NanoSwarmProfile,
} from "./prompts/nano-swarm.prompt";
export { DEFAULT_NANO_SWARM_PROFILE } from "./prompts/nano-swarm.prompt";

// Transports
export { createLlmTransport } from "./transports/llm-chat";
export { createLlmTransportWithMode } from "./transports/factory";
export type { LlmChatConfig, LlmResponse, LlmTransport } from "./transports/types";
export {
  OpenAIWebSearchAdapter,
  NullWebSearchAdapter,
} from "./transports/openai-web-search.adapter";

// Ports
export type { WebSearchPort } from "./ports/web-search.port";
export type {
  EntityCatalogPort,
  EntityRef,
} from "./ports/entity-catalog.port";
export { NoopEntityCatalog } from "./entities/noop-entity-catalog";
export type {
  SourceFetcherPort,
  SourceResult,
} from "./ports/source-fetcher.port";
export { NoopSourceFetcher } from "./entities/noop-source-fetcher";

// Cortex execution strategies (extension points)
export {
  StandardStrategy,
  StrategistStrategy,
} from "./cortices/strategies";
export type { CortexExecutionStrategy } from "./cortices/strategies";

// Repositories
export { ResearchFindingRepository } from "./repositories/research-finding.repository";
export { ResearchEdgeRepository } from "./repositories/research-edge.repository";
export { ResearchCycleRepository } from "./repositories/research-cycle.repository";

// Utils
export { VoyageEmbedder } from "./utils/voyage-embedder";
export * from "./utils/llm-json-parser";
