// apps/console-api/src/transformers/repl-chat.transformer.ts
//
// Pure mapping functions from a finding row (as returned by
// findingRepo.findByCycleId) to REPL chat view shapes. Extracted to
// eliminate duplicated inline mapping in repl-chat.service.ts.
//
// NOTE: FindingRow is inlined here (not imported from repl-chat.service)
// to avoid a circular dependency. It must stay in sync with the shape
// declared on ThalamusChatDep.findingRepo.findByCycleId in the service.

import type {
  ReplFindingStreamView,
  ReplFindingSummaryView,
} from "../types/repl-chat.types";

type FindingRow = {
  id: bigint | string;
  title?: string;
  summary?: string;
  cortex?: string;
  findingType?: string;
  urgency?: string;
  confidence?: number | null;
};

function resolveTitle(f: FindingRow): string {
  return f.title ?? f.summary?.slice(0, 80) ?? "(no title)";
}

export function toReplFindingStreamView(f: FindingRow): ReplFindingStreamView {
  return {
    id: String(f.id),
    title: resolveTitle(f),
    summary: f.summary?.slice(0, 300) ?? null,
    cortex: f.cortex ?? null,
    urgency: f.urgency ?? null,
    confidence: Number(f.confidence ?? 0),
  };
}

export function toReplFindingSummaryView(
  f: FindingRow,
): ReplFindingSummaryView {
  return {
    id: String(f.id),
    title: resolveTitle(f),
    summary: f.summary?.slice(0, 300) ?? null,
    cortex: f.cortex ?? null,
    findingType: f.findingType ?? null,
    urgency: f.urgency ?? null,
    confidence: Number(f.confidence ?? 0),
  };
}
