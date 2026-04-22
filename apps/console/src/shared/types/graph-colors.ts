import type { EntityClass, SourceClass } from "@/dto/http";

export const ENTITY_COLOR: Record<EntityClass, string> = {
  Satellite: "#60A5FA",
  Debris: "#6E7681",
  Operator: "#A78BFA",
  Payload: "#22D3EE",
  OrbitRegime: "#34D399",
  ConjunctionEvent: "#F87171",
  Maneuver: "#F59E0B",
};

export const ENTITY_SHAPE: Record<EntityClass, "circle" | "square"> = {
  Satellite: "circle",
  Debris: "circle",
  Operator: "square",
  Payload: "circle",
  OrbitRegime: "square",
  ConjunctionEvent: "circle",
  Maneuver: "square",
};

export const SOURCE_COLOR: Record<SourceClass | "sim", string> = {
  osint: "#60A5FA",
  field: "#A78BFA",
  derived: "#8B949E",
  sim: "#F59E0B",
};

export const STATUS_COLOR = {
  pending: "#F59E0B",
  accepted: "#22D3EE",
  rejected: "#F87171",
  "in-review": "#8B949E",
} as const;
