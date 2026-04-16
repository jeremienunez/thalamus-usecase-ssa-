import type { KgNode, KgEdge } from "@interview/shared";
import { KgRepository, type KgEdgeRow } from "../repositories/kg.repository";

export class KgViewService {
  constructor(private readonly repo: KgRepository) {}

  async listNodes(): Promise<{ items: KgNode[] }> {
    const { sats, ops, regimes, findings } = await this.repo.loadNodeSources();
    const items: KgNode[] = [
      ...regimes.map((r) => ({
        id: `regime:${r.name}`,
        label: r.name,
        class: "OrbitRegime" as const,
        degree: 0,
        x: 0,
        y: 0,
        cortex: "—",
      })),
      ...ops.map((o) => ({
        id: `op:${o.name}`,
        label: o.name,
        class: "Operator" as const,
        degree: 0,
        x: 0,
        y: 0,
        cortex: "—",
      })),
      ...sats.map((s) => ({
        id: `sat:${s.id}`,
        label: s.name,
        class: "Satellite" as const,
        degree: 0,
        x: 0,
        y: 0,
        cortex: "catalog",
      })),
      ...findings.map((f) => ({
        id: `finding:${f.id}`,
        label: f.title.slice(0, 32),
        class: "Payload" as const,
        degree: 0,
        x: 0,
        y: 0,
        cortex: f.cortex,
      })),
    ];
    return { items };
  }

  async listEdges(): Promise<{ items: KgEdge[] }> {
    const rows = await this.repo.listRecentEdges();
    return { items: rows.map(toEdge) };
  }
}

function toEdge(e: KgEdgeRow): KgEdge {
  return {
    id: e.id,
    source: `finding:${e.finding_id}`,
    target:
      e.entity_type === "satellite"
        ? `sat:${e.entity_id}`
        : e.entity_type === "operator"
          ? `op:${e.entity_id}`
          : `${e.entity_type}:${e.entity_id}`,
    relation: e.relation,
  };
}
