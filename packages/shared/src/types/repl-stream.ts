import type { StepName } from "../observability/steps";
import type { StepPhase } from "../observability/step-events";

export type ReplFollowUpKind = string;

export interface ReplFollowUpTarget {
  entityType?: string | null;
  entityId?: string | null;
  refs?: Record<string, string> | null;
}

export interface ReplFollowUpPlanItem {
  followupId: string;
  kind: ReplFollowUpKind;
  auto: boolean;
  title: string;
  rationale: string;
  score: number;
  gateScore: number;
  costClass: "low" | "medium";
  reasonCodes: string[];
  target?: ReplFollowUpTarget | null;
}

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
  | {
      event: "followup.plan";
      data: {
        parentCycleId: string;
        autoLaunched: ReplFollowUpPlanItem[];
        proposed: ReplFollowUpPlanItem[];
        dropped: ReplFollowUpPlanItem[];
      };
    }
  | {
      event: "followup.started";
      data: {
        parentCycleId: string;
        followupId: string;
        kind: ReplFollowUpKind;
        auto: boolean;
        title: string;
      };
    }
  | {
      event: "followup.step";
      data: {
        parentCycleId: string;
        followupId: string;
        kind: ReplFollowUpKind;
        auto: boolean;
        step: StepName | "swarm" | "unknown";
        phase: StepPhase;
        terminal: string;
        elapsedMs: number;
        extra?: Record<string, unknown>;
      };
    }
  | {
      event: "followup.finding";
      data: {
        parentCycleId: string;
        followupId: string;
        kind: ReplFollowUpKind;
        auto: boolean;
        id: string;
        title: string;
        summary: string | null;
        cortex: string | null;
        urgency: string | null;
        confidence: number;
      };
    }
  | {
      event: "followup.summary";
      data: {
        parentCycleId: string;
        followupId: string;
        kind: ReplFollowUpKind;
        auto: boolean;
        text: string;
        provider: string;
      };
    }
  | {
      event: "followup.done";
      data: {
        parentCycleId: string;
        followupId: string;
        kind: ReplFollowUpKind;
        auto: boolean;
        provider: string;
        tookMs: number;
        status: "completed" | "failed" | "proposed" | "dropped";
      };
    }
  | { event: "error"; data: { message: string } };

export type ReplStreamEventType = ReplStreamEvent["event"];
