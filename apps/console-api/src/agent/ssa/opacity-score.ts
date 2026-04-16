/**
 * Opacity score — pure function for SSA satellite transparency scoring.
 *
 * Composite of 5 independent signals. No DB, no LLM, no IO.
 */

export interface OpacitySignals {
  payloadUndisclosed: boolean;
  operatorSensitive: boolean;
  amateurObservationsCount: number;
  catalogDropoutCount: number;
  distinctAmateurSources: number;
}

export function computeOpacityScore(signals: OpacitySignals): number {
  let score = 0;
  if (signals.payloadUndisclosed) score += 0.25;
  if (signals.operatorSensitive) score += 0.25;
  if (signals.amateurObservationsCount > 0) score += 0.2;
  if (signals.catalogDropoutCount > 0) score += 0.2;
  if (signals.distinctAmateurSources >= 2) score += 0.1;
  return Math.min(1, Math.max(0, score));
}
