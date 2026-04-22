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

export type KgGraphResponse = {
  root: string;
  nodes: KgNode[];
  edges: KgEdge[];
};

function normalizeKgNodeId(id: string): string {
  if (id.startsWith("satellite:")) return `sat:${id.slice("satellite:".length)}`;
  if (id.startsWith("operator:")) return `op:${id.slice("operator:".length)}`;
  if (id.startsWith("orbit_regime:")) {
    return `regime:${id.slice("orbit_regime:".length)}`;
  }
  if (id.startsWith("f:")) return `finding:${id.slice("f:".length)}`;
  return id;
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

  async getNeighbourhood(
    rootId: string,
    depth = 2,
  ): Promise<KgGraphResponse> {
    const normalizedRootId = normalizeKgNodeId(rootId);
    const [{ items: nodes }, { items: edges }] = await Promise.all([
      this.listNodes(),
      this.listEdges(),
    ]);

    const nodesById = new Map(nodes.map((node) => [node.id, node]));
    const edgeIndex = new Map<string, KgEdge[]>();
    const addEdge = (nodeId: string, edge: KgEdge): void => {
      edgeIndex.set(nodeId, [...(edgeIndex.get(nodeId) ?? []), edge]);
    };
    edges.forEach((edge) => {
      addEdge(edge.source, edge);
      addEdge(edge.target, edge);
    });

    const seen = new Set<string>([normalizedRootId]);
    const selectedEdges = new Map<string, KgEdge>();
    let frontier = [normalizedRootId];

    for (let currentDepth = 1; currentDepth <= depth; currentDepth++) {
      const next: string[] = [];
      for (const nodeId of frontier) {
        for (const edge of edgeIndex.get(nodeId) ?? []) {
          selectedEdges.set(edge.id, edge);
          const neighbor = edge.source === nodeId ? edge.target : edge.source;
          if (!seen.has(neighbor)) {
            seen.add(neighbor);
            next.push(neighbor);
          }
        }
      }
      if (next.length === 0) break;
      frontier = next;
    }

    const neighbourhoodNodes = [...seen].map(
      (id) =>
        nodesById.get(id) ?? {
          id,
          label: id,
          class: "ConjunctionEvent" as const,
        },
    );

    const neighbourhoodEdges = [...selectedEdges.values()].filter(
      (edge) => seen.has(edge.source) && seen.has(edge.target),
    );

    return {
      root: normalizedRootId,
      nodes: neighbourhoodNodes,
      edges: neighbourhoodEdges,
    };
  }
}
