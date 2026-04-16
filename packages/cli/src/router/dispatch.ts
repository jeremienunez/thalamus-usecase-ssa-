import type { Step } from "./schema";

export type DispatchResult =
  | { kind: "briefing"; findings: unknown[]; costUsd: number }
  | { kind: "telemetry"; satId: string; distribution: unknown }
  | { kind: "logs"; events: unknown[] }
  | { kind: "graph"; tree: unknown }
  | { kind: "resolution"; suggestionId: string; ok: boolean; delta: unknown }
  | { kind: "why"; tree: unknown }
  | { kind: "pc"; conjunctionId: string; estimate: unknown }
  | { kind: "candidates"; targetNoradId: number; rows: unknown[] }
  | { kind: "clarify"; question: string; options: string[] };

export interface Adapters {
  thalamus: {
    runCycle: (q: { query: string; cycleId: string }) => Promise<{ findings: unknown[]; costUsd: number }>;
  };
  telemetry: {
    start: (q: { satId: string }) => Promise<{ distribution: unknown }>;
  };
  logs: {
    tail: (q: {
      level?: "debug" | "info" | "warn" | "error";
      service?: string;
      sinceMs?: number;
    }) => unknown[];
  };
  graph: {
    neighbourhood: (entity: string) => Promise<unknown>;
  };
  resolution: {
    accept: (suggestionId: string) => Promise<{ ok: boolean; delta: unknown }>;
  };
  why: {
    build: (findingId: string) => Promise<unknown>;
  };
  pcEstimator: {
    estimate: (conjunctionId: string) => Promise<unknown>;
  };
  candidates: {
    propose: (q: {
      targetNoradId: number;
      objectClass?: "payload" | "rocket_stage" | "debris" | "unknown";
      limit?: number;
    }) => Promise<unknown[]>;
  };
}

export async function dispatch(
  step: Step,
  ctx: { adapters: Adapters; cycleId: string },
): Promise<DispatchResult> {
  switch (step.action) {
    case "query": {
      const { findings, costUsd } = await ctx.adapters.thalamus.runCycle({
        query: step.q,
        cycleId: ctx.cycleId,
      });
      return { kind: "briefing", findings, costUsd };
    }
    case "telemetry": {
      const { distribution } = await ctx.adapters.telemetry.start({ satId: step.satId });
      return { kind: "telemetry", satId: step.satId, distribution };
    }
    case "logs":
      return {
        kind: "logs",
        events: ctx.adapters.logs.tail({
          level: step.level,
          service: step.service,
          sinceMs: step.sinceMs,
        }),
      };
    case "graph":
      return { kind: "graph", tree: await ctx.adapters.graph.neighbourhood(step.entity) };
    case "accept": {
      const { ok, delta } = await ctx.adapters.resolution.accept(step.suggestionId);
      return { kind: "resolution", suggestionId: step.suggestionId, ok, delta };
    }
    case "explain":
      return { kind: "why", tree: await ctx.adapters.why.build(step.findingId) };
    case "pc":
      return {
        kind: "pc",
        conjunctionId: step.conjunctionId,
        estimate: await ctx.adapters.pcEstimator.estimate(step.conjunctionId),
      };
    case "candidates":
      return {
        kind: "candidates",
        targetNoradId: step.targetNoradId,
        rows: await ctx.adapters.candidates.propose({
          targetNoradId: step.targetNoradId,
          objectClass: step.objectClass,
          limit: step.limit,
        }),
      };
    case "clarify":
      return { kind: "clarify", question: step.question, options: step.options };
  }
}
