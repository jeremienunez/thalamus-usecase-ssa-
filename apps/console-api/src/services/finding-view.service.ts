import type { FindingView } from "@interview/shared";
import {
  parseFindingId,
  toDbStatus,
} from "../transformers/finding-status.transformer";
import {
  entityRef,
  toFindingDetailView,
  toFindingListView,
} from "../transformers/finding-view.transformer";
import { FindingRepository } from "../repositories/finding.repository";
import { ResearchEdgeRepository } from "../repositories/research-edge.repository";

export class FindingViewService {
  constructor(
    private readonly findings: FindingRepository,
    private readonly edges: ResearchEdgeRepository,
  ) {}

  async list(filters: {
    status?: string;
    cortex?: string;
  }): Promise<{ items: FindingView[]; total: number }> {
    const rows = await this.findings.list(filters);
    const items: FindingView[] = rows.map(toFindingListView);
    if (items.length > 0) {
      const ids = items.map((i) => BigInt(i.id.slice(2)));
      const edgeRows = await this.edges.findByFindingIds(ids);
      const edgeMap = new Map<string, string[]>();
      for (const e of edgeRows) {
        const key = `f:${e.finding_id}`;
        const linked = entityRef(e.entity_type, e.entity_id);
        if (!edgeMap.has(key)) edgeMap.set(key, []);
        edgeMap.get(key)!.push(linked);
      }
      for (const f of items) f.linkedEntityIds = edgeMap.get(f.id) ?? [];
    }
    return { items, total: items.length };
  }

  async findById(idRaw: string): Promise<FindingView | null | "invalid"> {
    const fid = parseFindingId(idRaw);
    if (fid === null) return "invalid";
    const row = await this.findings.findById(fid);
    if (!row) return null;
    const edgeRows = await this.edges.findByFindingId(fid, 20);
    return toFindingDetailView(row, edgeRows);
  }

  async updateDecision(
    idRaw: string,
    decision: string,
  ): Promise<FindingView | null | "invalid"> {
    const fid = parseFindingId(idRaw);
    if (fid === null) return "invalid";
    if (!["accepted", "rejected", "pending", "in-review"].includes(decision))
      return "invalid";
    const ok = await this.findings.updateStatus(fid, toDbStatus(decision));
    if (!ok) return null;
    return this.findById(idRaw);
  }
}
