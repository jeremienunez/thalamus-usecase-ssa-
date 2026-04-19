import type { ReplStreamEvent } from "@interview/shared";
import type { CycleStep } from "@/shared/ui/CycleLoader";
import type { TurnResponse } from "@/features/repl/types";

export type TurnPhase =
  | "classifying"
  | "chatting"
  | "cycle-running"
  | "done"
  | "error";

export type FindingData = Extract<ReplStreamEvent, { event: "finding" }>["data"];

export type Turn = {
  id: string;
  input: string;
  phase: TurnPhase;
  startedAt: number;
  response?: TurnResponse;
  error?: string;
  cycleId?: string;
  currentStep?: CycleStep;
  steps: CycleStep[];
  findings: FindingData[];
  chatText: string;
  summaryText: string;
  provider?: string;
  tookMs?: number;
};

export type TurnAction =
  | { type: "stream"; event: ReplStreamEvent }
  | { type: "slash.done"; response: TurnResponse }
  | { type: "fail"; error: string };

export function newTurn(id: string, input: string): Turn {
  return {
    id,
    input,
    phase: "classifying",
    startedAt: Date.now(),
    steps: [],
    findings: [],
    chatText: "",
    summaryText: "",
  };
}

export function turnReducer(turn: Turn, action: TurnAction): Turn {
  switch (action.type) {
    case "slash.done":
      return {
        ...turn,
        phase: "done",
        response: action.response,
        tookMs: action.response.tookMs,
      };
    case "fail":
      return { ...turn, phase: "error", error: action.error };
    case "stream":
      return applyStreamEvent(turn, action.event);
  }
}

function applyStreamEvent(turn: Turn, evt: ReplStreamEvent): Turn {
  switch (evt.event) {
    case "classified":
      return {
        ...turn,
        phase: evt.data.action === "chat" ? "chatting" : "cycle-running",
      };
    case "cycle.start":
      return { ...turn, cycleId: evt.data.cycleId };
    case "step": {
      const cs: CycleStep = {
        name: evt.data.step,
        phase: evt.data.phase,
        terminal: evt.data.terminal,
        elapsedMs: evt.data.elapsedMs,
      };
      if (cs.phase === "start") return { ...turn, currentStep: cs };
      const cleared =
        turn.currentStep?.name === cs.name ? undefined : turn.currentStep;
      return { ...turn, currentStep: cleared, steps: [...turn.steps, cs] };
    }
    case "finding":
      return { ...turn, findings: [...turn.findings, evt.data] };
    case "chat.complete":
      return {
        ...turn,
        chatText: evt.data.text,
        provider: evt.data.provider,
      };
    case "summary.complete":
      return {
        ...turn,
        summaryText: evt.data.text,
        provider: evt.data.provider,
      };
    case "done":
      return {
        ...turn,
        phase: "done",
        provider: evt.data.provider,
        tookMs: evt.data.tookMs,
      };
    case "error":
      return { ...turn, phase: "error", error: evt.data.message };
    default:
      return turn;
  }
}
