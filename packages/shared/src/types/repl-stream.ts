import type { StepName, StepPhase } from "../observability/step-logger";

export type ReplStreamEvent =
  | {
      event: "classified";
      data: { action: "chat" | "run_cycle"; query?: string };
    }
  | { event: "chat.complete"; data: { text: string; provider: string } }
  | { event: "cycle.start"; data: { cycleId: string; query: string } }
  | {
      event: "step";
      data: {
        step: StepName | "unknown";
        phase: StepPhase;
        terminal: string;
        elapsedMs: number;
        extra?: Record<string, unknown>;
      };
    }
  | {
      event: "finding";
      data: {
        id: string;
        title: string;
        summary: string | null;
        cortex: string | null;
        urgency: string | null;
        confidence: number;
      };
    }
  | { event: "summary.complete"; data: { text: string; provider: string } }
  | {
      event: "done";
      data: {
        provider: string;
        costUsd: number;
        tookMs: number;
        findingsCount: number;
      };
    }
  | { event: "error"; data: { message: string } };

export type ReplStreamEventType = ReplStreamEvent["event"];
