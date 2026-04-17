import type { ConjunctionView } from "@interview/shared";
import {
  deriveAction,
  deriveCovarianceQuality,
  regimeFromMeanMotion,
} from "@interview/shared";
import type {
  ConjunctionRow,
  ScreenedConjunctionRow,
  KnnCandidateRow,
  ScreenedConjunctionView,
  KnnCandidateView,
} from "../types/conjunction.types";

function toIso(v: Date | string): string {
  return v instanceof Date ? v.toISOString() : new Date(v).toISOString();
}

export function toScreenedConjunctionView(
  r: ScreenedConjunctionRow,
): ScreenedConjunctionView {
  return { ...r, id: `conj:${r.conjunctionId}` };
}

export function toKnnCandidateView(r: KnnCandidateRow): KnnCandidateView {
  return { ...r, id: `knn:${r.targetNoradId}:${r.candidateId}` };
}

export function toConjunctionView(r: ConjunctionRow): ConjunctionView {
  const pc = r.probability_of_collision ?? 0;
  const sigma = r.combined_sigma_km ?? 10;
  return {
    id: Number(r.id),
    primaryId: Number(r.primary_id),
    secondaryId: Number(r.secondary_id),
    primaryName: r.primary_name ?? `sat-${r.primary_id}`,
    secondaryName: r.secondary_name ?? `sat-${r.secondary_id}`,
    regime: regimeFromMeanMotion(r.primary_mm),
    epoch: toIso(r.epoch),
    minRangeKm: r.min_range_km,
    relativeVelocityKmps: r.relative_velocity_kmps ?? 0,
    probabilityOfCollision: pc,
    combinedSigmaKm: sigma,
    hardBodyRadiusM: r.hard_body_radius_m ?? 20,
    pcMethod: r.pc_method ?? "foster-gaussian",
    computedAt: toIso(r.computed_at),
    covarianceQuality: deriveCovarianceQuality(sigma),
    action: deriveAction(pc),
  };
}
