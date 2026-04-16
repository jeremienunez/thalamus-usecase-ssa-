import type { KgNode, KgEdge } from "@interview/shared";
import { KgRepository } from "../repositories/kg.repository";
import {
  toFindingNode,
  toKgEdge,
  toOperatorNode,
  toRegimeNode,
  toSatelliteNode,
} from "../transformers/kg-view.transformer";

export class KgViewService {
  constructor(private readonly repo: KgRepository) {}

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
