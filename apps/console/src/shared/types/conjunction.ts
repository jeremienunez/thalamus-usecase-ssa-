/**
 * Client-side derivations for conjunction severity/action/covariance.
 *
 * Kept in ONE place so they're trivially movable to the server later
 * (when `covariance_quality` and `action` land on `/api/conjunctions`).
 */

export type Severity = "green" | "yellow" | "red";
export type Action = "NO_ACTION" | "MONITOR" | "MANEUVER_CANDIDATE";
export type CovQuality = "HIGH" | "MED" | "LOW" | null;

export function severityOf(pc: number | null | undefined): Severity {
  if (pc == null) return "green";
  if (pc >= 1e-4) return "red";
  if (pc >= 1e-6) return "yellow";
  return "green";
}

export function actionOf(pc: number | null | undefined): Action {
  if (pc == null) return "NO_ACTION";
  if (pc >= 1e-4) return "MANEUVER_CANDIDATE";
  if (pc >= 1e-6) return "MONITOR";
  return "NO_ACTION";
}

export function covarianceQualityOf(
  sigmaKm: number | null | undefined,
): CovQuality {
  if (sigmaKm == null) return null;
  if (sigmaKm < 0.1) return "HIGH";
  if (sigmaKm < 1) return "MED";
  return "LOW";
}

export const SEVERITY_COLOR: Record<Severity, string> = {
  green: "#2ecc71",
  yellow: "#f1c40f",
  red: "#e74c3c",
};

export const ACTION_LABEL: Record<Action, string> = {
  NO_ACTION: "NO ACTION",
  MONITOR: "MONITOR",
  MANEUVER_CANDIDATE: "MANEUVER CANDIDATE",
};

export const ACTION_COLOR: Record<Action, string> = {
  NO_ACTION: "#6E7681",
  MONITOR: "#f1c40f",
  MANEUVER_CANDIDATE: "#e74c3c",
};
