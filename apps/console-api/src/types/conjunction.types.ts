// apps/console-api/src/types/conjunction.types.ts
// ── Conjunction DTOs ────────────────────────────────────────────────
export type ConjunctionRow = {
  id: string;
  primary_id: string;
  secondary_id: string;
  primary_name: string;
  secondary_name: string;
  /** Real NORAD catalog ID for the primary satellite. NULL means not tracked
   *  in our catalog — the cortex-llm wrapper instructs the LLM to cite
   *  '(NORAD unavailable)' in that case, never a substitute. */
  primary_norad_id: number | null;
  secondary_norad_id: number | null;
  primary_mm: number | null;
  epoch: Date | string;
  min_range_km: number;
  relative_velocity_kmps: number | null;
  probability_of_collision: number | null;
  combined_sigma_km: number | null;
  hard_body_radius_m: number | null;
  pc_method: string | null;
  computed_at: Date | string;
};

export type ScreenedConjunctionRow = {
  conjunctionId: number;
  primarySatellite: string;
  primaryNoradId: number | null;
  secondarySatellite: string;
  secondaryNoradId: number | null;
  epoch: string;
  minRangeKm: number;
  relativeVelocityKmps: number | null;
  probabilityOfCollision: number | null;
  primarySigmaKm: number | null;
  secondarySigmaKm: number | null;
  combinedSigmaKm: number | null;
  hardBodyRadiusM: number | null;
  pcMethod: string | null;
  operatorPrimary: string | null;
  operatorSecondary: string | null;
  regime: string | null;
  primaryTleEpoch: string | null;
};

export type KnnCandidateRow = {
  targetNoradId: number;
  targetName: string;
  candidateId: number;
  candidateName: string;
  candidateNoradId: number | null;
  candidateClass: string | null;
  cosDistance: number;
  overlapKm: number;
  apogeeKm: number | null;
  perigeeKm: number | null;
  inclinationDeg: number | null;
  regime: "leo" | "meo" | "geo" | "heo" | "unknown";
};

export type ScreenedConjunctionView = ScreenedConjunctionRow & { id: string };
export type KnnCandidateView = KnnCandidateRow & { id: string };
