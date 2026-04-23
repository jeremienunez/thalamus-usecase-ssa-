import type { EntityClass } from "@/dto/http";

export const BASE_RADIUS_BY_CLASS: Record<EntityClass, number> = {
  Satellite: 0.005,
  Operator: 0.008,
  OrbitRegime: 0.006,
  ConjunctionEvent: 0.005,
  Payload: 0.005,
  Maneuver: 0.005,
  Debris: 0.003,
};
