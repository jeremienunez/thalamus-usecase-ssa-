import type { KgNode, KgEdge } from "@interview/shared";
import {
  toFindingNode,
  toKgEdge,
  toOperatorNode,
  toRegimeNode,
  toSatelliteNode,
} from "../transformers/kg-view.transformer";
import type {
  KgSatRow,
  KgOpRow,
  KgRegimeRow,
  KgFindingRow,
  KgEdgeRow,
} from "../types/kg.types";

// ── Port (structural — repo satisfies this by duck typing) ────────
export interface KgReadPort {
  loadNodeSources(): Promise<{
    sats: KgSatRow[];
    ops: KgOpRow[];
    regimes: KgRegimeRow[];
    findings: KgFindingRow[];
  }>;
  listRecentEdges(): Promise<KgEdgeRow[]>;
}

export class KgViewService {
  constructor(private readonly repo: KgReadPort) {}

  async listNodes(): Promise<{ items: KgNode[] }> {
    const { sats, ops, regimes, findings } = await this.repo.loadNodeSources();
    const items: KgNode[] = [
      ...regimes.map(toRegimeNode),
      ...ops.map(toOperatorNode),
      ...sats.map(toSatelliteNode),
      ...findings.map(toFindingNode),
    ];
    return { items };
  }

  async listEdges(): Promise<{ items: KgEdge[] }> {
    const rows = await this.repo.listRecentEdges();
    return { items: rows.map(toKgEdge) };
  }
}
