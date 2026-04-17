// apps/console-api/src/types/opacity.types.ts
// ── Opacity DTOs ────────────────────────────────────────────────────
export type OpacityCandidateRow = {
  satelliteId: number;
  name: string;
  noradId: number | null;
  operator: string | null;
  operatorCountry: string | null;
  platformClass: string | null;
  orbitRegime: string | null;
  launchYear: number | null;
  payloadUndisclosed: boolean;
  operatorSensitive: boolean;
  amateurObservationsCount: number;
  catalogDropoutCount: number;
  distinctAmateurSources: number;
  lastAmateurObservedAt: string | null;
  opacityScore: number | null;
};

export type OpacityCandidateView = {
  id: string;
  satelliteId: string;
  name: string;
  noradId: number | null;
  operator: string | null;
  operatorCountry: string | null;
  platformClass: string | null;
  orbitRegime: string | null;
  launchYear: number | null;
  payloadUndisclosed: boolean;
  operatorSensitive: boolean;
  amateurObservationsCount: number;
  catalogDropoutCount: number;
  distinctAmateurSources: number;
  lastAmateurObservedAt: string | null;
  opacityScore: number | null;
};

export type OpacityScoreView = {
  satelliteId: string;
  score: number;
};
