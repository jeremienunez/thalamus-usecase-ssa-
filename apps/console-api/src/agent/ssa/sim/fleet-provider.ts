/**
 * SsaFleetProvider — SSA implementation of SimFleetProvider.
 *
 * Plan 2 · B.1. Delegates to the narrow SatelliteFleetRepository (console-api).
 * Zero new SQL: the SQL bodies moved verbatim from
 *   packages/sweep/src/sim/agent-builder.ts (loadFleetSnapshot) and
 *   packages/sweep/src/sim/memory.service.ts (lookupAuthorLabels)
 * into apps/console-api/src/repositories/satellite-fleet.repository.ts.
 *
 * The port consumes kind="operator" only. Non-operator kinds throw — the sim
 * kernel has no domain knowledge of what "subject" means; only this pack does.
 */

import type {
  SimSubjectProvider,
  SimSubjectRef,
  SimSubjectSnapshot,
} from "@interview/sweep";
import type { OperatorFleetSnapshot } from "../../../types/sim-fleet.types";

export interface SsaFleetDeps {
  fleetRepo: SsaFleetReadPort;
}

export interface SsaFleetReadPort {
  getOperatorFleetSnapshot(operatorId: number): Promise<OperatorFleetSnapshot>;
  getSimAgentAuthorLabels(agentIds: number[]): Promise<Map<number, string>>;
}

export class SsaFleetProvider implements SimSubjectProvider {
  constructor(private readonly deps: SsaFleetDeps) {}

  async getSubject(ref: SimSubjectRef): Promise<SimSubjectSnapshot> {
    if (ref.kind !== "operator" && ref.kind !== "subject") {
      throw new Error(
        `SsaFleetProvider: only supports kind="operator", got "${ref.kind}"`,
      );
    }
    const snapshot = await this.deps.fleetRepo.getOperatorFleetSnapshot(ref.id);
    return {
      displayName: snapshot.operatorName,
      attributes: {
        operatorCountry: snapshot.operatorCountry,
        satelliteCount: snapshot.satelliteCount,
        regimeMix: snapshot.regimeMix,
        platformMix: snapshot.platformMix,
        avgLaunchYear: snapshot.avgLaunchYear,
      },
    };
  }

  async getAuthorLabels(agentIds: number[]): Promise<Map<number, string>> {
    return this.deps.fleetRepo.getSimAgentAuthorLabels(agentIds);
  }
}
