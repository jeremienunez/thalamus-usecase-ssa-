import type { FindingView } from "@interview/shared";
import {
  parseFindingId,
  toDbStatus,
} from "../transformers/finding-status.transformer";
import {
  toFindingDetailView,
  toFindingListView,
} from "../transformers/finding-view.transformer";
import { entityRef } from "../transformers/kg-view.transformer";
import { FindingRepository } from "../repositories/finding.repository";
import { ResearchEdgeRepository } from "../repositories/research-edge.repository";
import { HttpError } from "../utils/http-error";

export class FindingViewService {
  constructor(
    private readonly findings: FindingRepository,
    private readonly edges: ResearchEdgeRepository,
  ) {}

  async list(filters: {
    status?: string;
    cortex?: string;
  }): Promise<{ items: FindingView[]; count: number }> {
    // Translate DTO status vocab ("pending"|"accepted"|"rejected"|"in-review") to
    // DB enum ("active"|"archived"|"invalidated"). If the incoming status isn't
    // a known DTO value, drop it (don't let arbitrary strings reach the DB enum).
    const KNOWN_DTO_STATUSES = new Set([
      "pending",
      "accepted",
      "rejected",
      "in-review",
    ]);
    const dbStatus =
      filters.status && KNOWN_DTO_STATUSES.has(filters.status)
        ? toDbStatus(filters.status)
        : undefined;
    const rows = await this.findings.list({
      status: dbStatus,
      cortex: filters.cortex,
    });
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
    return { items, count: items.length };
  }

  async findById(idRaw: string): Promise<FindingView> {
    // Controller validates id via FindingIdParamsSchema; the re-check is
    // defense-in-depth for programmatic callers that bypass the controller.
    const fid = parseFindingId(idRaw);
    if (fid === null) throw HttpError.badRequest("invalid id");
    const row = await this.findings.findById(fid);
    if (!row) throw HttpError.notFound("finding not found");
    const edgeRows = await this.edges.findByFindingId(fid, 20);
    return toFindingDetailView(row, edgeRows);
  }

  async updateDecision(
    idRaw: string,
    decision: string,
  ): Promise<FindingView> {
    const fid = parseFindingId(idRaw);
    if (fid === null) throw HttpError.badRequest("invalid id");
    if (!["accepted", "rejected", "pending", "in-review"].includes(decision))
      throw HttpError.badRequest("invalid decision");
    const ok = await this.findings.updateStatus(fid, toDbStatus(decision));
    if (!ok) throw HttpError.notFound("finding not found");
    return this.findById(idRaw);
  }
}
