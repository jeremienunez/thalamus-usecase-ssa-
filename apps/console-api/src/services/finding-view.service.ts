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

export type WhySourceClass = "field" | "osint" | "sim" | "derived";

export type WhyNode = {
  id: string;
  label: string;
  kind: "finding" | "edge" | "source_item";
  sha256?: string;
  sourceClass?: WhySourceClass;
  children: WhyNode[];
};

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

  async buildWhyTree(idRaw: string): Promise<WhyNode> {
    const fid = parseFindingId(idRaw);
    if (fid === null) throw HttpError.badRequest("invalid id");
    const row = await this.findings.findById(fid);
    if (!row) throw HttpError.notFound("finding not found");
    const edgeRows = await this.edges.findByFindingId(fid, 20);

    const evidence: WhyNode[] = Array.isArray(row.evidence)
      ? (
          row.evidence as Array<{
            source?: string;
            data?: { url?: string; uri?: string; snippet?: string };
          }>
        ).map((entry, index) => {
          const source = String(entry.source ?? "derived").toLowerCase();
          const sourceClass: WhySourceClass =
            source === "field"
              ? "field"
              : source === "osint"
                ? "osint"
                : source === "sim"
                  ? "sim"
                  : "derived";
          return {
            id: `source_item:${fid}:${index}`,
            label: entry.data?.url ?? entry.data?.uri ?? "—",
            kind: "source_item" as const,
            sourceClass,
            children: [] as WhyNode[],
          };
        })
      : [];

    const edges: WhyNode[] = edgeRows.map((edge, index) => ({
      id: `edge:${fid}:${index}`,
      label: `${edge.entity_type}:${edge.entity_id}`,
      kind: "edge" as const,
      children: [] as WhyNode[],
    }));

    if (edges.length === 0) {
      return {
        id: `finding:${row.id}`,
        label: row.title,
        kind: "finding",
        children: evidence,
      };
    }

    evidence.forEach((sourceItem, index) => {
      edges[index % edges.length]!.children.push(sourceItem);
    });

    return {
      id: `finding:${row.id}`,
      label: row.title,
      kind: "finding",
      children: edges,
    };
  }
}
