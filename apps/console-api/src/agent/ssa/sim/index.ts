/**
 * SSA sim domain pack — implementations of the 10 sim kernel ports.
 *
 * Introduced: Plan 2. Consumed by apps/console-api/src/container.ts (Task
 * B.11) to supply the 10 ports to buildSweepContainer.sim.*.
 *
 * Port                      → impl                               (task)
 *   SimActionSchemaProvider  → SsaActionSchemaProvider            (B.5)
 *   SimFleetProvider         → SsaFleetProvider                   (B.1)
 *   SimTurnTargetProvider    → SsaTurnTargetProvider              (B.2)
 *   SimAgentPersonaComposer  → SsaPersonaComposer                 (B.3)
 *   SimPromptComposer        → SsaPromptRenderer                  (B.4)
 *   SimCortexSelector        → SsaCortexSelector                  (B.4)
 *   SimPerturbationPack      → SsaPerturbationPack                (B.6)
 *   SimAggregationStrategy   → SsaAggregationStrategy             (B.8)
 *   SimKindGuard             → SsaKindGuard                       (B.9)
 *   SimPromotionAdapter      → SsaSimPromotionAdapter             (B.9)
 *
 * B.10 relocates from packages/sweep/src/sim:
 *   - swarms/telemetry.ts        (ex telemetry-swarm.service.ts)
 *   - swarms/pc.ts               (ex pc-swarm.service.ts)
 *   - aggregators/telemetry.ts   (ex aggregator-telemetry.ts)
 *   - aggregators/pc.ts          (ex aggregator-pc.ts)
 *   - bus-datasheets/loader.ts   (ex bus-datasheets.ts)
 *   - bus-datasheets/datasheets.json
 */

export { SsaActionSchemaProvider } from "./action-schema";
export { SsaFleetProvider } from "./fleet-provider";
export type { SsaFleetDeps } from "./fleet-provider";
export { SsaTurnTargetProvider } from "./targets";
export type { SsaTurnTargetDeps } from "./targets";
export { SsaPersonaComposer } from "./persona-composer";
export { SsaPromptRenderer } from "./prompt-renderer";
export { SsaCortexSelector } from "./cortex-selector";
export { SsaPerturbationPack } from "./perturbation-pack";
export { SsaAggregationStrategy } from "./aggregation-strategy";
export { SsaKindGuard } from "./kind-guard";
export { SsaSimPromotionAdapter } from "./promotion";
export {
  emitSuggestionFromModal,
  emitTelemetrySuggestions,
} from "./promotion";
export type {
  SsaSimPromotionDeps,
  EmitSuggestionDeps,
  EmitTelemetrySuggestionsDeps,
} from "./promotion";

// Plan 2 · B.10 — swarm launchers + aggregators + bus-datasheets
export { startTelemetrySwarm } from "./swarms/telemetry";
export type { TelemetrySwarmOpts } from "./swarms/telemetry";
export { startPcEstimatorSwarm } from "./swarms/pc";
export type { PcEstimatorSwarmOpts } from "./swarms/pc";
export {
  PcAggregatorService,
  computePcAggregate,
  aggregateToSuggestion,
  severityFromMedian,
} from "./aggregators/pc";
export type {
  PcAggregate,
  PcAggregatorDeps,
  PcCluster,
  PcSeverity,
  PcSweepSuggestion,
} from "./aggregators/pc";
export { TelemetryAggregatorService } from "./aggregators/telemetry";
export type {
  TelemetryAggregate,
  TelemetryAggregatorDeps,
  TelemetryScalarStats,
} from "./aggregators/telemetry";
export {
  lookupBusPrior,
  lookupBusEntry,
  listBusNames,
} from "./bus-datasheets/loader";
