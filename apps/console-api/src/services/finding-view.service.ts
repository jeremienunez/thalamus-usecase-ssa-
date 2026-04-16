import type { FindingView } from "@interview/shared";
import {
  mapFindingStatus,
  parseFindingId,
  toDbStatus,
} from "../transformers/finding-status.transformer";
import {
  FindingRepository,
  type FindingRow,
  type FindingDetailRow,
} from "../repositories/finding.repository";
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
    const items: FindingView[] = rows.map(toListView);
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
    return toDetailView(row, edgeRows);
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

function entityRef(type: string, id: string): string {
  if (type === "satellite") return `sat:${id}`;
  if (type === "operator") return `op:${id}`;
  return `${type}:${id}`;
}

function toListView(f: FindingRow): FindingView {
  return {
    id: `f:${f.id}`,
    title: f.title,
    summary: f.summary,
    cortex: f.cortex,
    status: mapFindingStatus(f.status),
    priority: Math.round(f.confidence * 100),
    createdAt: (f.created_at instanceof Date
      ? f.created_at
      : new Date(f.created_at)
    ).toISOString(),
    linkedEntityIds: [],
    evidence: [],
  };
}

function toDetailView(
  f: FindingDetailRow,
  edgeRows: Array<{ entity_type: string; entity_id: string }>,
): FindingView {
  const linkedEntityIds = edgeRows.map((e) =>
    entityRef(e.entity_type, e.entity_id),
  );
  const evidence = Array.isArray(f.evidence)
    ? (
        f.evidence as Array<{
          source?: string;
          data?: { url?: string; uri?: string; snippet?: string };
        }>
      ).map((e) => {
        const d = e.data ?? {};
        const src = String(e.source ?? "derived").toLowerCase();
        const kind =
          src === "field"
            ? ("field" as const)
            : src === "osint"
              ? ("osint" as const)
              : ("derived" as const);
        return { kind, uri: d.url ?? d.uri ?? "—", snippet: d.snippet ?? "" };
      })
    : [];
  return {
    id: `f:${f.id}`,
    title: f.title,
    summary: f.summary,
    cortex: f.cortex,
    status: mapFindingStatus(f.status),
    priority: Math.round(f.confidence * 100),
    createdAt: (f.created_at instanceof Date
      ? f.created_at
      : new Date(f.created_at)
    ).toISOString(),
    linkedEntityIds,
    evidence,
  };
}
