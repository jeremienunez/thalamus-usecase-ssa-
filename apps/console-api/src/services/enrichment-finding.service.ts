// apps/console-api/src/services/enrichment-finding.service.ts
import {
  toEnrichmentFindingInsert,
  toSweepFeedbackEntry,
} from "../transformers/enrichment-finding.transformer";
import type { EmitArgs, SweepFeedbackEntry } from "../types/sweep.types";
import type {
  FindingInsertInput,
  EdgeInsertInput,
} from "../types/finding.types";

export type { EmitArgs } from "../types/sweep.types";

// ── Ports (structural — repos satisfy these by duck typing) ────────
export interface CyclesPort {
  getOrCreate(): Promise<bigint>;
}

export interface FindingsWritePort {
  insert(input: FindingInsertInput): Promise<bigint>;
}

export interface EdgesWritePort {
  insert(input: EdgeInsertInput): Promise<void>;
}

export interface SweepFeedbackPort {
  push(entry: SweepFeedbackEntry): Promise<void>;
}

export class EnrichmentFindingService {
  constructor(
    private readonly cycles: CyclesPort,
    private readonly findings: FindingsWritePort,
    private readonly edges: EdgesWritePort,
    private readonly feedback: SweepFeedbackPort,
  ) {}

  async emit(args: EmitArgs): Promise<void> {
    const cycleId = await this.cycles.getOrCreate();
    const satBig = BigInt(args.satelliteId);

    const findingId = await this.findings.insert(
      toEnrichmentFindingInsert(args, cycleId),
    );

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

    await this.feedback.push(toSweepFeedbackEntry(args));
  }
}
