import type { ReplStreamEvent } from "@interview/shared";
import { applyFollowUpStreamEvent } from "./reducer.followups";
import { applyCoreStreamEvent } from "./reducer.stream";
import type { Turn, TurnAction } from "./reducer.types";

export type {
  FollowUpDoneData,
  FollowUpFindingData,
  FollowUpPlanData,
  FollowUpStartedData,
  FollowUpStatus,
  FollowUpStepData,
  FollowUpSummaryData,
  FollowUpTurn,
  FindingData,
  Turn,
  TurnAction,
  TurnPhase,
} from "./reducer.types";

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

function applyStreamEvent(turn: Turn, event: ReplStreamEvent): Turn {
  const followupTurn = applyFollowUpStreamEvent(turn, event);
  if (followupTurn) return followupTurn;

  const coreTurn = applyCoreStreamEvent(turn, event);
  if (coreTurn) return coreTurn;

  return turn;
}
