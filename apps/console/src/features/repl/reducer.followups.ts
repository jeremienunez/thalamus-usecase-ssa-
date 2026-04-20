import type { ReplStreamEvent } from "@interview/shared";
import type { CycleStep } from "@/shared/ui/CycleLoader";
import type {
  FollowUpPlanData,
  FollowUpTurn,
  Turn,
} from "./reducer.types";

export function applyFollowUpStreamEvent(
  turn: Turn,
  event: ReplStreamEvent,
): Turn | undefined {
  switch (event.event) {
    case "followup.plan":
      return {
        ...turn,
        phase: "followup-running",
        followupPlan: event.data,
      };
    case "followup.started":
      return {
        ...upsertFollowUp(turn, event.data.followupId, (followup) => ({
          ...followup,
          followupId: event.data.followupId,
          kind: event.data.kind,
          auto: event.data.auto,
          title: event.data.title,
          status: "running",
          startedAt: followup.startedAt ?? Date.now(),
        })),
        phase: "followup-running",
      };
    case "followup.step": {
      const cycleStep = toCycleStep(
        event.data.step,
        event.data.phase,
        event.data.terminal,
        event.data.elapsedMs,
      );
      return {
        ...upsertFollowUp(turn, event.data.followupId, (followup) => {
          const nextStep =
            cycleStep.phase === "start" || cycleStep.phase === "progress"
              ? cycleStep
              : followup.currentStep?.name === cycleStep.name
                ? undefined
                : followup.currentStep;
          const nextTrail =
            cycleStep.phase === "start" || cycleStep.phase === "progress"
              ? followup.steps
              : [...followup.steps, cycleStep];
          return {
            ...followup,
            followupId: event.data.followupId,
            kind: event.data.kind,
            auto: event.data.auto,
            status: "running",
            currentStep: nextStep,
            steps: nextTrail,
          };
        }),
        phase: "followup-running",
      };
    }
    case "followup.finding":
      return upsertFollowUp(turn, event.data.followupId, (followup) => ({
        ...followup,
        followupId: event.data.followupId,
        kind: event.data.kind,
        auto: event.data.auto,
        findings: [...followup.findings, event.data],
      }));
    case "followup.summary":
      return upsertFollowUp(turn, event.data.followupId, (followup) => ({
        ...followup,
        followupId: event.data.followupId,
        kind: event.data.kind,
        auto: event.data.auto,
        summaryText: event.data.text,
        provider: event.data.provider,
      }));
    case "followup.done": {
      const nextTurn = upsertFollowUp(turn, event.data.followupId, (followup) => ({
        ...followup,
        followupId: event.data.followupId,
        kind: event.data.kind,
        auto: event.data.auto,
        status: event.data.status,
        provider: event.data.provider,
        tookMs: event.data.tookMs,
        currentStep: undefined,
      }));
      return {
        ...nextTurn,
        phase: hasRunningFollowUps(nextTurn.followups)
          ? "followup-running"
          : turn.tookMs != null || turn.response
            ? "done"
            : nextTurn.phase,
      };
    }
    default:
      return undefined;
  }
}

function upsertFollowUp(
  turn: Turn,
  followupId: string,
  update: (followup: FollowUpTurn) => FollowUpTurn,
): Turn {
  const planned = findPlannedFollowUp(turn.followupPlan, followupId);
  const existing = turn.followups[followupId];
  const base =
    existing ??
    ({
      followupId,
      kind: planned?.kind ?? "unknown",
      auto: planned?.auto ?? false,
      title: planned?.title ?? followupId,
      status: planned?.auto ? "pending" : "proposed",
      startedAt: Date.now(),
      rationale: planned?.rationale,
      score: planned?.score,
      gateScore: planned?.gateScore,
      costClass: planned?.costClass,
      reasonCodes: planned?.reasonCodes,
      steps: [],
      findings: [],
      summaryText: "",
    } satisfies FollowUpTurn);
  const nextFollowUp = update(base);
  const nextOrder = turn.followupOrder.includes(followupId)
    ? turn.followupOrder
    : [...turn.followupOrder, followupId];
  return {
    ...turn,
    followupOrder: nextOrder,
    followups: {
      ...turn.followups,
      [followupId]: nextFollowUp,
    },
  };
}

function findPlannedFollowUp(
  plan: FollowUpPlanData | undefined,
  followupId: string,
) {
  if (!plan) return undefined;
  return [...plan.autoLaunched, ...plan.proposed, ...plan.dropped].find(
    (item) => item.followupId === followupId,
  );
}

function hasRunningFollowUps(followups: Record<string, FollowUpTurn>): boolean {
  return Object.values(followups).some(
    (followup) => followup.status === "pending" || followup.status === "running",
  );
}

function toCycleStep(
  name: CycleStep["name"],
  phase: CycleStep["phase"],
  terminal: string,
  elapsedMs: number,
): CycleStep {
  return { name, phase, terminal, elapsedMs };
}
