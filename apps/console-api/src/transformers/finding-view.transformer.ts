import type { FindingView } from "@interview/shared";
import type {
  FindingRow,
  FindingDetailRow,
} from "../repositories/finding.repository";
import { mapFindingStatus } from "./finding-status.transformer";

export function entityRef(type: string, id: string): string {
  if (type === "satellite") return `sat:${id}`;
  if (type === "operator") return `op:${id}`;
  return `${type}:${id}`;
}

export function toFindingListView(f: FindingRow): FindingView {
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

export function toFindingDetailView(
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
