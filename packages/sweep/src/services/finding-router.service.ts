/**
 * FindingRouterService — domain-agnostic tier resolver.
 *
 * Plan 1 Task 2.5. Generic engine service that consumes the
 * FindingRoutingPolicy port. The SSA cortex→tier map previously lived
 * inline in packages/sweep/src/services/finding-routing.ts; it moved to
 * apps/console-api/src/agent/ssa/sweep/finding-routing.ssa.ts in Task 1.5.
 *
 * Callers (Plan 1 scope: messaging wiring, future inbox routing) ask
 * `tiersForFinding({kind, name})` and get a list of tier slugs. Empty
 * means "admin-only path" by convention — the admin recipient set is
 * derived elsewhere.
 */

import type { FindingRoutingPolicy, FindingTier, FindingSource } from "../ports";

export interface FindingRouterDeps {
  policy: FindingRoutingPolicy;
}

export class FindingRouterService {
  constructor(private readonly deps: FindingRouterDeps) {}

  tiersForFinding(source: FindingSource): FindingTier[] {
    return this.deps.policy.tiersForSource(source);
  }
}
