import type {
  OpacityCandidateRow,
  OpacityCandidateView,
  OpacityScoreView,
} from "../types/opacity.types";

export function toOpacityCandidateView(
  r: OpacityCandidateRow,
): OpacityCandidateView {
  const satelliteId = String(r.satelliteId);
  return {
    id: `opacity:${satelliteId}`,
    satelliteId,
    name: r.name,
    noradId: r.noradId ?? null,
    operator: r.operator ?? null,
    operatorCountry: r.operatorCountry ?? null,
    platformClass: r.platformClass ?? null,
    orbitRegime: r.orbitRegime ?? null,
    launchYear: r.launchYear ?? null,
    payloadUndisclosed: r.payloadUndisclosed,
    operatorSensitive: r.operatorSensitive,
    amateurObservationsCount: r.amateurObservationsCount,
    catalogDropoutCount: r.catalogDropoutCount,
    distinctAmateurSources: r.distinctAmateurSources,
    lastAmateurObservedAt: r.lastAmateurObservedAt ?? null,
    opacityScore: r.opacityScore ?? null,
  };
}

export function toOpacityScoreView(
  satelliteId: number,
  score: number,
): OpacityScoreView {
  return { satelliteId: String(satelliteId), score };
}
