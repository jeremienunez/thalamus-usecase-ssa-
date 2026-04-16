import type { KgNode, KgEdge } from "@interview/shared";
import type {
  KgSatRow,
  KgOpRow,
  KgRegimeRow,
  KgFindingRow,
  KgEdgeRow,
} from "../repositories/kg.repository";

export function toRegimeNode(r: KgRegimeRow): KgNode {
  return {
    id: `regime:${r.name}`,
    label: r.name,
    class: "OrbitRegime",
    degree: 0,
    x: 0,
    y: 0,
    cortex: "—",
  };
}

export function toOperatorNode(o: KgOpRow): KgNode {
  return {
    id: `op:${o.name}`,
    label: o.name,
    class: "Operator",
    degree: 0,
    x: 0,
    y: 0,
    cortex: "—",
  };
}

export function toSatelliteNode(s: KgSatRow): KgNode {
  return {
    id: `sat:${s.id}`,
    label: s.name,
    class: "Satellite",
    degree: 0,
    x: 0,
    y: 0,
    cortex: "catalog",
  };
}

export function toFindingNode(f: KgFindingRow): KgNode {
  return {
    id: `finding:${f.id}`,
    label: f.title.slice(0, 32),
    class: "Payload",
    degree: 0,
    x: 0,
    y: 0,
    cortex: f.cortex,
  };
}

/** Maps entity_type + entity_id to the prefixed node id used by KgNode. */
export function entityRef(type: string, id: string): string {
  if (type === "satellite") return `sat:${id}`;
  if (type === "operator") return `op:${id}`;
  return `${type}:${id}`;
}

export function toKgEdge(e: KgEdgeRow): KgEdge {
  return {
    id: e.id,
    source: `finding:${e.finding_id}`,
    target: entityRef(e.entity_type, e.entity_id),
    relation: e.relation,
  };
}
