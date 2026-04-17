import type { FindingView } from "@interview/shared";
import {
  parseFindingId,
  toDbStatus,
} from "../transformers/finding-status.transformer";
import {
  toFindingDetailView,
  toFindingListView,
  attachLinkedEntityIds,
  extractFindingIds,
} from "../transformers/finding-view.transformer";
import type {
  FindingRow,
  FindingDetailRow,
  EdgeRow,
} from "../types/finding.types";
import { HttpError } from "../utils/http-error";

// ── Ports (structural — repos satisfy these by duck typing) ────────
export interface FindingsPort {
  list(filters: {
    status?: string;
    cortex?: string;
  }): Promise<FindingRow[]>;
  findById(id: bigint): Promise<FindingDetailRow | null>;
  updateStatus(
    id: bigint,
    status: "active" | "archived" | "invalidated",
  ): Promise<boolean>;
}

export interface EdgesReadPort {
  findByFindingIds(ids: bigint[]): Promise<EdgeRow[]>;
  findByFindingId(
    id: bigint,
    limit: number,
  ): Promise<Array<{ entity_type: string; entity_id: string }>>;
}

const KNOWN_DTO_STATUSES = new Set([
  "pending",
  "accepted",
  "rejected",
  "in-review",
]);

export class FindingViewService {
  constructor(
    private readonly findings: FindingsPort,
    private readonly edges: EdgesReadPort,
  ) {}

  async list(filters: {
    status?: string;
    cortex?: string;
  }): Promise<{ items: FindingView[]; count: number }> {
    const dbStatus =
      filters.status && KNOWN_DTO_STATUSES.has(filters.status)
        ? toDbStatus(filters.status)
        : undefined;
    const rows = await this.findings.list({
      status: dbStatus,
      cortex: filters.cortex,
    });
    const items = rows.map(toFindingListView);
    if (items.length > 0) {
      const edgeRows = await this.edges.findByFindingIds(extractFindingIds(items));
      attachLinkedEntityIds(items, edgeRows);
    }
    return { items, count: items.length };
  }

  async findById(idRaw: string): Promise<FindingView> {
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
