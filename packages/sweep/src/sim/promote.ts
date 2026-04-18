import type { TurnAction } from "./types";

export function isKgPromotable(action: TurnAction): boolean {
  return (
    action.kind === "maneuver" ||
    action.kind === "launch" ||
    action.kind === "retire"
  );
}

export function isTerminal(action: TurnAction): boolean {
  return action.kind === "accept" || action.kind === "reject";
}
