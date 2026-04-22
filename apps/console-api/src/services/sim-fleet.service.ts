/**
 * SimFleetService — server-side metier translator for the "agent subject"
 * concept over sim's HTTP contract.
 *
 * Consumers (server-side only):
 *   - `controllers/sim.controller.ts` → `GET /api/sim/ssa/agent-subject`
 *     and `POST /api/sim/ssa/author-labels` (§5.7 of the HTTP contract).
 *
 * Dispatches on `kind`; today only "operator" is supported (SSA domain).
 * Future kinds add a new branch here without changing the contract or the
 * kernel's AgentSubjectSnapshotDto shape.
 *
 * Follows the console-api convention: defines its own narrow ports; the
 * concrete `SatelliteFleetRepository` satisfies them by duck typing at
 * container-wire time.
 *
 * Introduced: Plan 5 Task 1.B.7 (DIP-refactored by 1.B cleanup).
 */

import type {
  OperatorFleetSnapshot,
  SimAgentSubjectSnapshot,
} from "../types/sim-fleet.types";

// ── Ports (structural — repos satisfy these by duck typing) ─────────

export interface OperatorFleetReadPort {
  getOperatorFleetSnapshot(operatorId: number): Promise<OperatorFleetSnapshot>;
  getSimAgentAuthorLabels(agentIds: number[]): Promise<Map<number, string>>;
}

export class SimFleetService {
  constructor(private readonly fleetRepo: OperatorFleetReadPort) {}

  async getAgentSubject(ref: {
    kind: string;
    id: number;
  }): Promise<SimAgentSubjectSnapshot> {
    if (ref.kind !== "operator") {
      throw new Error(
        `SimFleetService: only supports kind="operator", got "${ref.kind}"`,
      );
    }
    const snapshot = await this.fleetRepo.getOperatorFleetSnapshot(ref.id);
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

  async getAuthorLabels(
    agentIds: number[],
  ): Promise<Record<string, string>> {
    const labels = await this.fleetRepo.getSimAgentAuthorLabels(agentIds);
    const out: Record<string, string> = {};
    for (const [id, label] of labels) {
      out[String(id)] = label;
    }
    return out;
  }
}
