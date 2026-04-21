/**
 * SSA sweep domain pack — implementations of the 6 sweep kernel ports.
 *
 *   - SsaFindingSchema            (finding-schema.ssa.ts, Task 1.1)
 *   - SsaPromotionAdapter         (promotion.ssa.ts, Task 1.2)
 *   - createSsaResolutionRegistry (resolution-handlers.ssa.ts, Task 1.3)
 *   - SsaAuditProvider            (audit-provider.ssa.ts, Task 1.4)
 *   - SsaFindingRoutingPolicy     (finding-routing.ssa.ts, Task 1.5)
 *   - createSsaIngestionProvider  (ingesters/, factory)
 *
 * Consumed by apps/console-api/src/container.ts (Task 3.1) to supply the
 * 6 ports to buildSweepContainer.
 */

export { ssaFindingSchema } from "./finding-schema.ssa";
export {
  parseSsaFindingPayload,
} from "./finding-schema.ssa";
export type { SsaFindingPayload } from "./finding-schema.ssa";

export {
  ssaResolutionPayloadSchema,
} from "./resolution-schema.ssa";
export type {
  UpdateFieldAction,
  LinkPayloadAction,
  UnlinkPayloadAction,
  ReassignOperatorCountryAction,
  EnrichAction,
  SsaResolutionPayload,
} from "./resolution-schema.ssa";

export { SsaPromotionAdapter } from "./promotion.ssa";
export type { SsaPromotionDeps } from "./promotion.ssa";

export {
  createSsaResolutionRegistry,
  createUpdateFieldHandler,
  createLinkPayloadHandler,
  createUnlinkPayloadHandler,
  createReassignOperatorCountryHandler,
  createEnrichHandler,
} from "./resolution-handlers.ssa";
export type { SsaHandlerDeps, OnSimUpdateAccepted } from "./resolution-handlers.ssa";

export { SsaAuditProvider } from "./audit-provider.ssa";
export type {
  SsaAuditDeps,
  AuditSatellitePort,
  AuditFeedbackPort,
  NullScanRow,
  OperatorCountrySweepStatsRow,
} from "./audit-provider.ssa";

export {
  type CitationResolver,
  type CitationStrategy,
  CompositeCitationResolver,
  createDefaultCitationResolver,
  gcatStrategy,
  celestrakStrategy,
  privateTelemetryStrategy,
  defaultFallbackStrategy,
} from "./citation-resolver.ssa";

export { SsaFindingRoutingPolicy } from "./finding-routing.ssa";

export { createSsaIngestionProvider } from "./ingesters";
