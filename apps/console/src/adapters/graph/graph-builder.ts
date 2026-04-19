import Graph from "graphology";
import forceAtlas2 from "graphology-layout-forceatlas2";
import { ENTITY_COLOR, SOURCE_COLOR } from "@/shared/types/graph-colors";
import type { EntityClass, KgEdgeDTO, KgNodeDTO } from "@/shared/types";

export type GraphInstance = Graph;

export interface KgGraphSpec {
  nodes: KgNodeDTO[];
  edges: KgEdgeDTO[];
  /** Class → ghost-fallback mapping already applied; pure layout coordinates. */
  layout: Map<string, { x: number; y: number }>;
  /** Map of `finding:NNN` → human title, used for ghost node labels. */
  findingTitleById: Map<string, string>;
  /** Entity classes that should be accepted as ghost fallbacks (domain policy). */
  ghostClassFor: (id: string) => EntityClass;
  /** Layout truncation helper (domain) — keeps labels readable. */
  truncateLabel: (s: string, max: number) => string;
}

/**
 * Build a sigma-ready graphology Graph from KG DTOs.
 *
 * Handles:
 *   - degree re-computation (server returns 0)
 *   - ghost nodes (edges reference entities missing from /api/kg/nodes)
 *   - styling (size, color, alpha from confidence, finding-vs-entity labels)
 *   - ForceAtlas2 relaxation seeded by the caller-supplied layout
 */
export function buildKgGraph(spec: KgGraphSpec): GraphInstance {
  const { nodes, edges, layout, findingTitleById, ghostClassFor, truncateLabel } = spec;
  const g = new Graph({ type: "undirected", multi: true });

  const deg = new Map<string, number>();
  for (const e of edges) {
    deg.set(e.source, (deg.get(e.source) ?? 0) + 1);
    deg.set(e.target, (deg.get(e.target) ?? 0) + 1);
  }

  const knownIds = new Set(nodes.map((n) => n.id));
  const ghosts: KgNodeDTO[] = [];
  const seenGhost = new Set<string>();
  const ghostNeighbours = new Map<string, { peer: string; relation: string }[]>();
  for (const e of edges) {
    for (const [side, peer] of [
      [e.source, e.target],
      [e.target, e.source],
    ] as const) {
      if (knownIds.has(side)) continue;
      const arr = ghostNeighbours.get(side) ?? [];
      arr.push({ peer, relation: e.relation });
      ghostNeighbours.set(side, arr);
    }
  }
  const synthLabel = (id: string): string => {
    const fallback = id.replace(/^[a-z]+:/, "");
    const numeric = id.split(":")[1] ?? id;
    if (id.startsWith("finding:")) {
      const real = findingTitleById.get(id) ?? findingTitleById.get(`f:${numeric}`);
      if (real) return truncateLabel(real, 36);
      const neigh = ghostNeighbours.get(id) ?? [];
      if (neigh.length === 0) return `F#${numeric}`;
      const named = neigh.find((n) => !n.peer.startsWith("finding:")) ?? neigh[0]!;
      const peerLabel = named.peer.startsWith("sat:")
        ? `SAT ${named.peer.slice(4)}`
        : named.peer.startsWith("op:")
          ? named.peer.slice(3)
          : named.peer.replace(/^[a-z]+:/, "");
      return truncateLabel(`F#${numeric} ${named.relation} ${peerLabel}`, 36);
    }
    return fallback;
  };

  for (const e of edges) {
    for (const id of [e.source, e.target]) {
      if (knownIds.has(id) || seenGhost.has(id)) continue;
      seenGhost.add(id);
      ghosts.push({
        id,
        label: synthLabel(id),
        class: ghostClassFor(id),
        degree: 0,
        x: 0,
        y: 0,
        cortex: id.startsWith("finding:") ? "ssa-curator" : "—",
      });
    }
  }

  const allNodes = [...nodes, ...ghosts];
  const maxDeg = Math.max(1, ...deg.values());
  for (const n of allNodes) {
    const p = layout.get(n.id) ?? { x: n.x, y: n.y };
    const d = n.degree || deg.get(n.id) || 0;
    const isConnected = d > 0;
    const size = isConnected ? Math.min(5 + Math.sqrt(d) * 3.2, 28) : 1.2;
    const color = isConnected ? ENTITY_COLOR[n.class] : ENTITY_COLOR[n.class] + "55";
    const isFinding = n.id.startsWith("finding:");
    const attrs = {
      label: isConnected ? n.label : "",
      labelColor: isFinding ? "#FFFFFF" : "#E6EDF3",
      x: p.x,
      y: p.y,
      size,
      color,
      entityClass: n.class,
      cortex: n.cortex,
      degree: d,
      hubness: maxDeg > 0 ? d / maxDeg : 0,
    };
    if (g.hasNode(n.id)) {
      g.mergeNodeAttributes(n.id, attrs);
    } else {
      g.addNode(n.id, attrs);
    }
  }

  for (const e of edges) {
    if (!g.hasNode(e.source) || !g.hasNode(e.target)) continue;
    const conf =
      typeof e.confidence === "number" && Number.isFinite(e.confidence)
        ? e.confidence
        : 0.85;
    const cls = (e.sourceClass ?? "derived") as keyof typeof SOURCE_COLOR;
    const alphaByte = Math.max(0x88, Math.round(0x88 + conf * 0x77))
      .toString(16)
      .padStart(2, "0");
    g.addEdgeWithKey(e.id, e.source, e.target, {
      size: Math.max(1.4, conf * 3.0),
      color: SOURCE_COLOR[cls] + alphaByte,
      relation: e.relation,
      confidence: conf,
      sourceClass: cls,
    });
  }

  if (g.order > 0 && g.size > 0) {
    forceAtlas2.assign(g, {
      iterations: 320,
      settings: {
        gravity: 1.2,
        scalingRatio: 18,
        slowDown: 2,
        barnesHutOptimize: g.order > 200,
        edgeWeightInfluence: 0.8,
        strongGravityMode: true,
      },
    });
  }

  return g;
}

/** Read-only edge details extracted for a given node id. */
export function incidentEdgesFor(
  graph: GraphInstance,
  nodeId: string,
): KgEdgeDTO[] {
  return graph.edges(nodeId).map((eid) => {
    const a = graph.getEdgeAttributes(eid);
    const [src, tgt] = graph.extremities(eid);
    return {
      id: eid,
      source: src,
      target: tgt,
      relation: a.relation,
      confidence: a.confidence,
      sourceClass: a.sourceClass,
    };
  });
}
