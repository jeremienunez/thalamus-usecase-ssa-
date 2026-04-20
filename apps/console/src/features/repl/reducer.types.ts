import type { ReplStreamEvent } from "@interview/shared";
import type { CycleStep } from "@/shared/ui/CycleLoader";
import type { TurnResponse } from "@/types/repl-turn";

export type TurnPhase =
  | "classifying"
  | "chatting"
  | "cycle-running"
  | "followup-running"
  | "done"
  | "error";

export type FindingData = Extract<ReplStreamEvent, { event: "finding" }>["data"];
export type FollowUpPlanData = Extract<ReplStreamEvent, { event: "followup.plan" }>["data"];
export type FollowUpStartedData = Extract<ReplStreamEvent, { event: "followup.started" }>["data"];
export type FollowUpFindingData = Extract<ReplStreamEvent, { event: "followup.finding" }>["data"];
export type FollowUpSummaryData = Extract<ReplStreamEvent, { event: "followup.summary" }>["data"];
export type FollowUpDoneData = Extract<ReplStreamEvent, { event: "followup.done" }>["data"];
export type FollowUpStepData = Extract<ReplStreamEvent, { event: "followup.step" }>["data"];

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
