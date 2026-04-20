import type { ReplStreamEvent } from "@interview/shared";
import type { CycleStep } from "@/shared/ui/CycleLoader";
import type { Turn } from "./reducer.types";

export function applyCoreStreamEvent(
  turn: Turn,
  event: ReplStreamEvent,
): Turn | undefined {
  switch (event.event) {
    case "classified":
      return {
        ...turn,
        phase: event.data.action === "chat" ? "chatting" : "cycle-running",
        executedQuery:
          event.data.action === "run_cycle"
            ? event.data.query ?? turn.executedQuery
            : turn.executedQuery,
      };
    case "cycle.start":
      return { ...turn, cycleId: event.data.cycleId, executedQuery: event.data.query };
    case "step": {
      const cycleStep = toCycleStep(event.data.step, event.data.phase, event.data.terminal, event.data.elapsedMs);
      if (cycleStep.phase === "start") return { ...turn, currentStep: cycleStep };
      const clearedCurrentStep =
        turn.currentStep?.name === cycleStep.name ? undefined : turn.currentStep;
      return {
        ...turn,
        currentStep: clearedCurrentStep,
        steps: [...turn.steps, cycleStep],
      };
    }
    case "finding":
      return { ...turn, findings: [...turn.findings, event.data] };
    case "chat.complete":
      return {
        ...turn,
        chatText: event.data.text,
        provider: event.data.provider,
      };
    case "summary.complete":
      return {
        ...turn,
        summaryText: event.data.text,
        provider: event.data.provider,
      };
    case "done":
      return {
        ...turn,
        phase: "done",
        provider: event.data.provider,
        tookMs: event.data.tookMs,
      };
    case "error":
      return { ...turn, phase: "error", error: event.data.message };
    default:
      return undefined;
  }
}

function toCycleStep(
  name: CycleStep["name"],
  phase: CycleStep["phase"],
  terminal: string,
  elapsedMs: number,
): CycleStep {
  return { name, phase, terminal, elapsedMs };
}
