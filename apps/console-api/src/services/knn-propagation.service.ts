// apps/console-api/src/services/knn-propagation.service.ts
import type { EnrichmentFindingService } from "./enrichment-finding.service";
import { toKnnSampleFillView } from "../transformers/knn-propagation.transformer";
import type {
  AuditInsertInput,
  KnnSampleFillView,
} from "../types/sweep.types";
import { MISSION_WRITABLE_COLUMNS, inRange } from "../utils/field-constraints";

export type PropagateInput = {
  field: string;
  k: number;
  minSim: number;
  limit: number;
  dryRun: boolean;
};

export type PropagateStats = {
  field: string;
  k: number;
  minSim: number;
  attempted: number;
  filled: number;
  disagree: number;
  tooFar: number;
  outOfRange: number;
  sampleFills: KnnSampleFillView[];
};

// ── Ports (structural — repos satisfy by duck typing) ────────────
export interface SatellitesKnnPort {
  listNullCandidatesForField(
    field: string,
    limit: number,
  ): Promise<{ id: string; name: string }[]>;
  knnNeighboursForField(
    targetId: bigint,
    field: string,
    k: number,
  ): Promise<
    Array<{ id: string; value: string | number | null; cos_distance: number }>
  >;
  updateField(
    satelliteId: bigint,
    field: string,
    value: string | number,
  ): Promise<void>;
}

export interface SweepAuditWritePort {
  insertEnrichmentSuccess(input: AuditInsertInput): Promise<void>;
}

export class KnnPropagationService {
  constructor(
    private readonly satellites: SatellitesKnnPort,
    private readonly audit: SweepAuditWritePort,
    private readonly enrichment: EnrichmentFindingService,
  ) {}

  async propagate(input: PropagateInput): Promise<PropagateStats> {
    const kind = MISSION_WRITABLE_COLUMNS[input.field]!;
    const maxDist = 1 - input.minSim;
    const targets = await this.satellites.listNullCandidatesForField(
      input.field,
      input.limit,
    );

    const stats: PropagateStats = {
      field: input.field,
      k: input.k,
      minSim: input.minSim,
      attempted: 0,
      filled: 0,
      disagree: 0,
      tooFar: 0,
      outOfRange: 0,
      sampleFills: [],
    };

    for (const t of targets) {
      stats.attempted++;
      const neighbours = await this.satellites.knnNeighboursForField(
        BigInt(t.id),
        input.field,
        input.k,
      );
      if (neighbours.length < 3) {
        stats.tooFar++;
        continue;
      }
      const nearest = neighbours[0]!;
      if (nearest.cos_distance > maxDist) {
        stats.tooFar++;
        continue;
      }

      const values: Array<string | number> = [];
      for (const n of neighbours) {
        if (n.value == null) continue;
        if (kind === "numeric") {
          const num =
            typeof n.value === "number"
              ? n.value
              : Number.parseFloat(String(n.value));
          if (!Number.isFinite(num) || !inRange(input.field, num)) {
            stats.outOfRange++;
            continue;
          }
          values.push(num);
        } else {
          values.push(String(n.value).trim().toLowerCase());
        }
      }
      if (values.length < 3) {
        stats.tooFar++;
        continue;
      }

      let consensus: string | number | null = null;
      if (kind === "numeric") {
        const nums = (values as number[]).slice().sort((a, b) => a - b);
        const median = nums[Math.floor(nums.length / 2)]!;
        const denom = Math.max(Math.abs(median), 1e-9);
        if (nums.every((v) => Math.abs(v - median) / denom <= 0.1))
          consensus = median;
      } else {
        const freq = new Map<string, number>();
        for (const v of values)
          freq.set(String(v), (freq.get(String(v)) ?? 0) + 1);
        let top: [string, number] | null = null;
        for (const [val, n] of freq) if (!top || n > top[1]) top = [val, n];
        if (top && top[1] / values.length >= 0.66) consensus = top[0];
      }

      if (consensus == null) {
        stats.disagree++;
        continue;
      }

      const cosSim = 1 - nearest.cos_distance;
      const neighbourIds = neighbours.map((n) => n.id);

      if (!input.dryRun) {
        await this.applyFill(
          t.id,
          input.field,
          consensus,
          neighbourIds,
          cosSim,
        );
      }
      stats.filled++;
      if (stats.sampleFills.length < 10) {
        stats.sampleFills.push(
          toKnnSampleFillView({
            id: t.id,
            name: t.name,
            value: consensus,
            neighbourIds,
            cosSim,
          }),
        );
      }
    }

    return stats;
  }

  private async applyFill(
    satelliteId: string,
    field: string,
    value: string | number,
    neighbourIds: string[],
    cosSim: number,
  ): Promise<void> {
    const kind = MISSION_WRITABLE_COLUMNS[field];
    const coerced = kind === "numeric" ? Number(value) : String(value);
    await this.satellites.updateField(BigInt(satelliteId), field, coerced);

    const source = `knn_propagation:k=${neighbourIds.length},cosSim=${cosSim.toFixed(3)},neighbours=[${neighbourIds.slice(0, 5).join(",")}]`;
    await this.audit.insertEnrichmentSuccess({
      suggestionId: `knn:${satelliteId}:${field}`,
      operatorCountryName: "knn-propagation",
      title: `KNN-fill ${field}=${coerced} on satellite ${satelliteId}`,
      description: "",
      suggestedAction: `UPDATE satellite SET ${field}=${coerced} (knn)`,
      affectedSatellites: 1,
      webEvidence: source,
      resolutionPayload: {
        field,
        value: coerced,
        source,
        neighbourIds,
        cosSim,
      },
    });
    await this.enrichment.emit({
      kind: "knn",
      satelliteId,
      field,
      value: coerced,
      confidence: Math.max(0.5, Math.min(0.95, cosSim)),
      source,
      neighbourIds,
      cosSim,
    });
  }
}
