/** Mirrors apps/console-api/src/repl.ts result shapes. */
import type { StepName } from "./steps";

export type BriefingFinding = {
  id: string;
  summary: string;
  sourceClass: "field" | "osint" | "derived";
  confidence: number;
  evidenceRefs: string[];
};

export type TelemetryEntry = {
  name: string;
  unit: string;
  median: number;
  p5: number;
  p95: number;
};

export type LogEvent = {
  time: string;
  level: "debug" | "info" | "warn" | "error";
  service: string;
  msg: string;
  step?: StepName;
  phase?: "start" | "progress" | "done" | "error";
};

export type GraphNode = { id: string; label: string; class: string; children: GraphNode[] };
export type WhyNode = {
  id?: string;
  label: string;
  kind: "finding" | "edge" | "source_item" | "evidence";
  detail?: string;
  sha256?: string;
  sourceClass?: "field" | "osint" | "sim" | "derived";
  children: WhyNode[];
};
export type WhyStats = {
  edges: number;
  sourceItems: number;
  byClass: { field: number; osint: number; sim: number };
};

export type PcCluster = {
  mode: string;
  flags: string[];
  pcRange: [number, number];
  fishCount: number;
};
export type PcEstimate = {
  medianPc: number;
  sigmaPc: number;
  p5Pc: number;
  p95Pc: number;
  fishCount: number;
  histogramBins: Array<{ log10Pc: number; count: number }>;
  clusters: PcCluster[];
  severity: "info" | "medium" | "high";
  suggestionId?: string;
};

export type DispatchResult =
  | {
      kind: "briefing";
      executiveSummary: string;
      findings: BriefingFinding[];
      recommendedActions: string[];
      followUpPrompts: string[];
      costUsd: number;
    }
  | { kind: "telemetry"; satId: string; satName: string; distribution: TelemetryEntry[] }
  | { kind: "logs"; events: LogEvent[] }
  | { kind: "graph"; root: string; tree: GraphNode }
  | { kind: "resolution"; suggestionId: string; ok: boolean; delta: { findingId: string } }
  | { kind: "why"; findingId: string; tree: WhyNode; stats: WhyStats }
  | { kind: "pc"; conjunctionId: string; estimate: PcEstimate }
  | { kind: "clarify"; question: string; options: string[] };

export type TurnResponse = {
  results: DispatchResult[];
  costUsd: number;
  tookMs: number;
};

export async function postTurn(input: string, sessionId: string): Promise<TurnResponse> {
  const res = await fetch("/api/repl/turn", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ input, sessionId }),
  });
  if (!res.ok) throw new Error(`${res.status} ${res.statusText}`);
  return (await res.json()) as TurnResponse;
}
