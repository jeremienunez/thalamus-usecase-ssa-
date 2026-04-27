// apps/console-api/src/services/sweep-task-planner.service.ts
import type { MissionTask } from "../types";
import type { SatelliteNameRow } from "../types/satellite.types";
import { MISSION_WRITABLE_COLUMNS } from "../utils/field-constraints";

export type SweepListRow = {
  id: string;
  operatorCountryName: string | null;
  resolutionPayload: string | null;
};

// ── Port ────────────────────────────────────────────────────────────
export interface SatellitePayloadNameReadPort {
  findPayloadNamesByIds(ids: bigint[]): Promise<SatelliteNameRow[]>;
}

export type SatellitesReadPort = SatellitePayloadNameReadPort;

/**
 * Pure planner: parses sweep `resolutionPayload` rows, validates the
 * `update_field` action, resolves satellite name rows, and emits one
 * `MissionTask` per (suggestion, satellite) pair ready for the worker.
 */
export class SweepTaskPlanner {
  constructor(private readonly satellites: SatellitePayloadNameReadPort) {}

  async buildTasks(
    sweepRows: SweepListRow[],
    cap: number,
  ): Promise<MissionTask[]> {
    const tasks: MissionTask[] = [];

    for (const r of sweepRows) {
      if (!r.resolutionPayload) continue;
      if (
        !r.operatorCountryName ||
        r.operatorCountryName.toLowerCase().includes("unknown")
      )
        continue;
      try {
        const p = JSON.parse(r.resolutionPayload) as {
          actions?: Array<{
            kind?: string;
            field?: string;
            value?: unknown;
            satelliteIds?: string[];
          }>;
        };
        const action = p.actions?.[0];
        if (!action || action.kind !== "update_field" || !action.field)
          continue;
        if (!MISSION_WRITABLE_COLUMNS[action.field]) continue;
        if (action.value !== null && action.value !== undefined) continue;
        const satIds = (action.satelliteIds ?? []).slice(0, cap);
        if (satIds.length === 0) continue;
        const satRows = await this.satellites.findPayloadNamesByIds(
          satIds.map((i) => BigInt(i)),
        );
        for (const s of satRows) {
          tasks.push({
            suggestionId: r.id,
            satelliteId: s.id,
            satelliteName: s.name,
            noradId: s.norad_id ? Number(s.norad_id) : null,
            field: action.field,
            operatorCountry: r.operatorCountryName,
            status: "pending",
            value: null,
            confidence: 0,
            source: null,
          });
        }
      } catch {
        // skip malformed payload
      }
    }

    return tasks;
  }
}
