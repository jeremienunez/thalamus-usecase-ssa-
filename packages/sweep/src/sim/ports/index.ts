/**
 * Sim kernel ports barrel — 10 ports that bridge the generic sim engine
 * (packages/sweep/src/sim/) and a domain pack (apps/console-api/src/agent/ssa/sim/).
 *
 * Introduced: Plan 2 Task A.1 (scaffolds) / B.1-B.9 (implementations).
 */

export * from "./action-schema.port";
export * from "./fleet.port";
export * from "./target.port";
export * from "./persona.port";
export * from "./prompt.port";
export * from "./cortex-selector.port";
export * from "./perturbation-pack.port";
export * from "./aggregation-strategy.port";
export * from "./kind-guard.port";
export * from "./promotion.port";
