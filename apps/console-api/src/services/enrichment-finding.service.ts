// apps/console-api/src/services/enrichment-finding.service.ts
import type Redis from "ioredis";
import type { EnrichmentCycleRepository } from "../repositories/enrichment-cycle.repository";
import type { FindingRepository } from "../repositories/finding.repository";
import type { ResearchEdgeRepository } from "../repositories/research-edge.repository";

export type EmitArgs = {
  kind: "knn" | "mission";
  satelliteId: string;
  field: string;
  value: string | number;
  confidence: number;
  source: string;
  neighbourIds?: string[];
  cosSim?: number;
};

export class EnrichmentFindingService {
  constructor(
    private readonly cycles: EnrichmentCycleRepository,
    private readonly findings: FindingRepository,
    private readonly edges: ResearchEdgeRepository,
    private readonly redis: Redis,
  ) {}

  async emit(args: EmitArgs): Promise<void> {
    const cycleId = await this.cycles.getOrCreate();
    const satBig = BigInt(args.satelliteId);
    const title = `${args.kind === "knn" ? "KNN" : "Mission"} fill · ${args.field}=${args.value}`;
    const summary =
      args.kind === "knn"
        ? `${args.field} propagated to satellite #${args.satelliteId} from ${args.neighbourIds?.length ?? 0} semantically similar payloads (cos_sim=${args.cosSim?.toFixed(3) ?? "?"}).`
        : `${args.field} written to satellite #${args.satelliteId} from web-search source (confidence=${args.confidence.toFixed(2)}).`;
    const evidence =
      args.kind === "knn"
        ? [
            {
              source: "knn",
              data: {
                field: args.field,
                value: args.value,
                cosSim: args.cosSim,
                neighbours: args.neighbourIds ?? [],
              },
              weight: args.confidence,
            },
          ]
        : [
            {
              source: "web",
              data: { field: args.field, value: args.value, url: args.source },
              weight: args.confidence,
            },
          ];
    const reasoning =
      args.kind === "knn"
        ? `Zero-LLM propagation: median consensus of K=${args.neighbourIds?.length ?? 0} nearest payloads in Voyage halfvec(2048) space.`
        : `Web-mission 2-vote corroboration: two independent nano calls agreed on this value from ${args.source}.`;

    const findingId = await this.findings.insert({
      cycleId,
      cortex: "data_auditor",
      findingType: "insight",
      urgency: "low",
      title,
      summary,
      evidence,
      reasoning,
      confidence: args.confidence,
      impactScore: 0.3,
    });

    await this.edges.insert({
      findingId,
      entityType: "satellite",
      entityId: satBig,
      relation: "about",
      weight: 1.0,
      context: { field: args.field, value: String(args.value) },
    });

    if (args.kind === "knn" && args.neighbourIds?.length) {
      for (const nid of args.neighbourIds.slice(0, 10)) {
        await this.edges.insert({
          findingId,
          entityType: "satellite",
          entityId: BigInt(nid),
          relation: "similar_to",
          weight: args.cosSim ?? 0.8,
          context: { role: "knn_neighbour", cosSim: args.cosSim ?? null },
        });
      }
    }

    await this.redis.lpush(
      "sweep:feedback",
      JSON.stringify({
        category: "enrichment",
        wasAccepted: true,
        reviewerNote: `${args.kind}-fill: ${args.field}=${args.value}`,
        operatorCountryName:
          args.kind === "knn" ? "knn-propagation" : "web-mission",
      }),
    );
    await this.redis.ltrim("sweep:feedback", 0, 199);
  }
}
