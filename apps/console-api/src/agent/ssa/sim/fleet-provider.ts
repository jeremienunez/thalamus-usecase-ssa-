/**
 * SsaFleetProvider — SSA subject = operator. Delegates to SatelliteAuditService
 * + SatelliteRepository. ZERO new SQL (Plan 1 folded satellite audit queries
 * into SatelliteAuditService).
 *
 * TODO(Plan 2 · B.1): implement getAgentSubject / getAuthorLabels by calling
 *   SatelliteAuditService.listByOperator + SatelliteRepository.findOperatorCountry.
 *   If SatelliteAuditService lacks an aggregate method (regime mix / platform
 *   mix / avgLaunchYear), extend it IN THE SAME COMMIT (Plan 1 rule:
 *   "extend existing service, don't duplicate").
 *
 * Move bodies from packages/sweep/src/sim/agent-builder.ts (loadFleetSnapshot)
 * and packages/sweep/src/sim/memory.service.ts (lookupAuthorLabels).
 */

import type {
  SimFleetProvider,
  AgentSubjectRef,
  AgentSubjectSnapshot,
} from "@interview/sweep";

export interface SsaFleetDeps {
  // TODO(B.1): satelliteAudit: SatelliteAuditService;
  // TODO(B.1): satelliteRepo: SatelliteRepository;
  _placeholder?: never;
}

export class SsaFleetProvider implements SimFleetProvider {
  constructor(private readonly _deps: SsaFleetDeps = {}) {}

  async getAgentSubject(_ref: AgentSubjectRef): Promise<AgentSubjectSnapshot> {
    // TODO(B.1): implement via SatelliteAuditService + SatelliteRepository.
    throw new Error("SsaFleetProvider.getAgentSubject: TODO Plan 2 · B.1");
  }

  async getAuthorLabels(_agentIds: number[]): Promise<Map<number, string>> {
    // TODO(B.1): implement via operator lookup.
    throw new Error("SsaFleetProvider.getAuthorLabels: TODO Plan 2 · B.1");
  }
}
