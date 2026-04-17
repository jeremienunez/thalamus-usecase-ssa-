import type { FindingView } from "@interview/shared";
import type {
  FindingRow,
  FindingDetailRow,
  EdgeRow,
} from "../types/finding.types";
import { mapFindingStatus, parseFindingId } from "./finding-status.transformer";
import { entityRef } from "./kg-view.transformer";

export function extractFindingIds(items: FindingView[]): bigint[] {
  return items
    .map((i) => parseFindingId(i.id))
    .filter((id): id is bigint => id !== null);
}

export function attachLinkedEntityIds(
  items: FindingView[],
  edgeRows: EdgeRow[],
): FindingView[] {
  const edgeMap = new Map<string, string[]>();
  for (const e of edgeRows) {
    const key = `f:${e.finding_id}`;
    const linked = entityRef(e.entity_type, e.entity_id);
    if (!edgeMap.has(key)) edgeMap.set(key, []);
    edgeMap.get(key)!.push(linked);
  }
  for (const f of items) f.linkedEntityIds = edgeMap.get(f.id) ?? [];
  return items;
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
