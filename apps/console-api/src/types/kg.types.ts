// apps/console-api/src/types/kg.types.ts
// ── KG row DTOs (consumed by repo + transformer + service) ─────────
export type KgSatRow = { id: string; name: string };
export type KgOpRow = { id: string; name: string };
export type KgRegimeRow = { id: string; name: string };
export type KgFindingRow = { id: string; title: string; cortex: string };
export type KgEdgeRow = {
  id: string;
  finding_id: string;
  entity_type: string;
  entity_id: string;
  relation: string;
};
