import type { ReplStreamEvent } from "@interview/shared";
import type { CycleStep } from "@/shared/ui/CycleLoader";
import type { TurnResponse } from "@/features/repl/types";

export type TurnPhase =
  | "classifying"
  | "chatting"
  | "cycle-running"
  | "followup-running"
  | "done"
  | "error";

export type FindingData = Extract<ReplStreamEvent, { event: "finding" }>["data"];
export type FollowUpPlanData = Extract<
  ReplStreamEvent,
  { event: "followup.plan" }
>["data"];
export type FollowUpStartedData = Extract<
  ReplStreamEvent,
  { event: "followup.started" }
>["data"];
export type FollowUpFindingData = Extract<
  ReplStreamEvent,
  { event: "followup.finding" }
>["data"];
export type FollowUpSummaryData = Extract<
  ReplStreamEvent,
  { event: "followup.summary" }
>["data"];
export type FollowUpDoneData = Extract<
  ReplStreamEvent,
  { event: "followup.done" }
>["data"];
export type FollowUpStepData = Extract<
  ReplStreamEvent,
  { event: "followup.step" }
>["data"];

export type FollowUpStatus =
  | "pending"
  | "running"
  | "completed"
  | "failed"
  | "proposed"
  | "dropped";

export type FollowUpTurn = {
  followupId: string;
  kind: string;
  auto: boolean;
  title: string;
  status: FollowUpStatus;
  startedAt: number;
  rationale?: string;
  score?: number;
  gateScore?: number;
  costClass?: "low" | "medium";
  reasonCodes?: string[];
  currentStep?: CycleStep;
  steps: CycleStep[];
  findings: FollowUpFindingData[];
  summaryText: string;
  provider?: string;
  tookMs?: number;
};

export type Turn = {
  id: string;
  input: string;
  phase: TurnPhase;
  startedAt: number;
  response?: TurnResponse;
  error?: string;
  cycleId?: string;
  executedQuery?: string;
  currentStep?: CycleStep;
  steps: CycleStep[];
  findings: FindingData[];
  chatText: string;
  summaryText: string;
  provider?: string;
  tookMs?: number;
  followupPlan?: FollowUpPlanData;
  followupOrder: string[];
  followups: Record<string, FollowUpTurn>;
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
    followupOrder: [],
    followups: {},
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
        executedQuery:
          evt.data.action === "run_cycle" ? evt.data.query ?? turn.executedQuery : turn.executedQuery,
      };
    case "cycle.start":
      return { ...turn, cycleId: evt.data.cycleId, executedQuery: evt.data.query };
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
    case "followup.plan":
      return {
        ...turn,
        phase: "followup-running",
        followupPlan: evt.data,
      };
    case "followup.started":
      return {
        ...upsertFollowUp(turn, evt.data.followupId, (followup) => ({
          ...followup,
          followupId: evt.data.followupId,
          kind: evt.data.kind,
          auto: evt.data.auto,
          title: evt.data.title,
          status: "running",
          startedAt: followup.startedAt ?? Date.now(),
        })),
        phase: "followup-running",
      };
    case "followup.step": {
      const cs: CycleStep = {
        name: evt.data.step,
        phase: evt.data.phase,
        terminal: evt.data.terminal,
        elapsedMs: evt.data.elapsedMs,
      };
      return {
        ...upsertFollowUp(turn, evt.data.followupId, (followup) => {
        const nextStep =
          cs.phase === "start" || cs.phase === "progress"
            ? cs
            : followup.currentStep?.name === cs.name
              ? undefined
              : followup.currentStep;
        const nextTrail =
          cs.phase === "start" || cs.phase === "progress"
            ? followup.steps
            : [...followup.steps, cs];
        return {
          ...followup,
          followupId: evt.data.followupId,
          kind: evt.data.kind,
          auto: evt.data.auto,
          status: "running",
          currentStep: nextStep,
          steps: nextTrail,
        };
        }),
        phase: "followup-running",
      };
    }
    case "followup.finding":
      return upsertFollowUp(turn, evt.data.followupId, (followup) => ({
        ...followup,
        followupId: evt.data.followupId,
        kind: evt.data.kind,
        auto: evt.data.auto,
        findings: [...followup.findings, evt.data],
      }));
    case "followup.summary":
      return upsertFollowUp(turn, evt.data.followupId, (followup) => ({
        ...followup,
        followupId: evt.data.followupId,
        kind: evt.data.kind,
        auto: evt.data.auto,
        summaryText: evt.data.text,
        provider: evt.data.provider,
      }));
    case "followup.done": {
      const next = upsertFollowUp(turn, evt.data.followupId, (followup) => ({
        ...followup,
        followupId: evt.data.followupId,
        kind: evt.data.kind,
        auto: evt.data.auto,
        status: evt.data.status,
        provider: evt.data.provider,
        tookMs: evt.data.tookMs,
        currentStep: undefined,
      }));
      return {
        ...next,
        phase: hasRunningFollowUps(next.followups)
          ? "followup-running"
          : turn.tookMs != null || turn.response
            ? "done"
            : next.phase,
      };
    }
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

function upsertFollowUp(
  turn: Turn,
  followupId: string,
  update: (followup: FollowUpTurn) => FollowUpTurn,
): Turn {
  const planned = findPlannedFollowUp(turn.followupPlan, followupId);
  const existing = turn.followups[followupId];
  const base = existing ?? {
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
  } satisfies FollowUpTurn;
  const next = update(base);
  const order = turn.followupOrder.includes(followupId)
    ? turn.followupOrder
    : [...turn.followupOrder, followupId];
  return {
    ...turn,
    followupOrder: order,
    followups: {
      ...turn.followups,
      [followupId]: next,
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
    (followup) =>
      followup.status === "pending" || followup.status === "running",
  );
}
