import { useEffect, useMemo, useRef, useState } from "react";
import Graph from "graphology";
import Sigma from "sigma";
import forceAtlas2 from "graphology-layout-forceatlas2";
import { useKg, useFindings } from "@/usecases";
import { ENTITY_COLOR, SOURCE_COLOR } from "@/shared/types/graph-colors";
import { useUiStore } from "@/shared/ui/uiStore";
import { Drawer, DrawerSection, KV } from "@/shared/ui/Drawer";
import { fmtCount } from "@/shared/types/units";
import { Measure } from "@/shared/ui/Measure";
import { FindingReadout } from "./FindingReadout";
import type { EntityClass, KgEdgeDTO, KgNodeDTO } from "@/shared/types";

const CLASSES: EntityClass[] = [
  "Satellite",
  "Operator",
  "OrbitRegime",
  "ConjunctionEvent",
  "Payload",
  "Maneuver",
  "Debris",
];

/** Deterministic class-sector layout: every class sits in its own pie slice
 *  around the origin; within a slice, nodes are ordered by degree (inner =
 *  more connected) and spread across the slice angle. No randomness, no FA2. */
function layoutByClass(nodes: KgNodeDTO[]): Map<string, { x: number; y: number }> {
  const byClass = new Map<EntityClass, KgNodeDTO[]>();
  for (const n of nodes) {
    const arr = byClass.get(n.class) ?? [];
    arr.push(n);
    byClass.set(n.class, arr);
  }
  const out = new Map<string, { x: number; y: number }>();
  const R_HUB = 60;
  const R_RIM = 420;
  const presentClasses = CLASSES.filter((c) => (byClass.get(c)?.length ?? 0) > 0);
  presentClasses.forEach((cls, ci) => {
    const list = (byClass.get(cls) ?? []).slice().sort((a, b) => b.degree - a.degree);
    const sectorCenter = (ci / presentClasses.length) * Math.PI * 2 - Math.PI / 2;
    const sectorWidth = (Math.PI * 2) / presentClasses.length;
    const maxDeg = Math.max(1, ...list.map((n) => n.degree));
    list.forEach((n, i) => {
      const t = list.length === 1 ? 0.5 : i / (list.length - 1);
      const angle = sectorCenter + (t - 0.5) * sectorWidth * 0.82;
      // Inner ring for hubs, rim for leaves
      const r = R_HUB + (1 - n.degree / maxDeg) * (R_RIM - R_HUB);
      out.set(n.id, { x: Math.cos(angle) * r, y: Math.sin(angle) * r });
    });
  });
  return out;
}

export function ThalamusEntry() {
  const { data, isLoading } = useKg();
  const { data: findingsData } = useFindings();
  const containerRef = useRef<HTMLDivElement>(null);
  const sigmaRef = useRef<Sigma | null>(null);
  const [selected, setSelected] = useState<KgNodeDTO | null>(null);
  const [selectedFindingNumeric, setSelectedFindingNumeric] = useState<number | null>(null);
  const openDrawer = useUiStore((s) => s.openDrawer);
  const closeDrawer = useUiStore((s) => s.closeDrawer);

  // Map finding:<id> → human title for graph labelling.
  const findingTitleById = useMemo(() => {
    const m = new Map<string, string>();
    for (const f of findingsData?.items ?? []) m.set(`finding:${f.id}`, f.title);
    return m;
  }, [findingsData]);

  const stats = useMemo(() => {
    if (!data) return null;
    const classCount = new Map<EntityClass, number>();
    for (const c of CLASSES) classCount.set(c, 0);
    for (const n of data.nodes) classCount.set(n.class, (classCount.get(n.class) ?? 0) + 1);
    // The KG endpoint returns degree=0 for every node (pre-aggregation); compute
    // it client-side from the edge list so TOP HUBS reflects actual connectivity.
    const degreeById = new Map<string, number>();
    for (const e of data.edges) {
      degreeById.set(e.source, (degreeById.get(e.source) ?? 0) + 1);
      degreeById.set(e.target, (degreeById.get(e.target) ?? 0) + 1);
    }
    const nodesWithDegree = data.nodes.map((n) => ({
      ...n,
      degree: n.degree || (degreeById.get(n.id) ?? 0),
    }));
    const topHubs = [...nodesWithDegree]
      .sort((a, b) => b.degree - a.degree)
      .slice(0, 6);
    const relCount = new Map<string, number>();
    for (const e of data.edges) relCount.set(e.relation, (relCount.get(e.relation) ?? 0) + 1);
    const topRelations = [...relCount.entries()]
      .sort((a, b) => b[1] - a[1])
      .slice(0, 5);
    const maxClass = Math.max(1, ...classCount.values());
    return { classCount, topHubs, topRelations, maxClass };
  }, [data]);

  const graph = useMemo(() => {
    if (!data) return null;
    const g = new Graph({ type: "undirected", multi: true });
    // Compute degree client-side (server returns 0 for every node).
    const deg = new Map<string, number>();
    for (const e of data.edges) {
      deg.set(e.source, (deg.get(e.source) ?? 0) + 1);
      deg.set(e.target, (deg.get(e.target) ?? 0) + 1);
    }
    // Inject ghost nodes for any edge endpoint missing from the node list
    // (the /api/kg/nodes endpoint omits Finding entities, but edges reference
    // them — without this the graph collapses into isolated singletons).
    const knownIds = new Set(data.nodes.map((n) => n.id));
    const ghosts: KgNodeDTO[] = [];
    const seenGhost = new Set<string>();
    const ghostClassFor = (id: string): EntityClass => {
      if (id.startsWith("finding:")) return "ConjunctionEvent";
      if (id.startsWith("conj:")) return "ConjunctionEvent";
      if (id.startsWith("sat:")) return "Satellite";
      if (id.startsWith("op:")) return "Operator";
      if (id.startsWith("regime:")) return "OrbitRegime";
      if (id.startsWith("payload:")) return "Payload";
      if (id.startsWith("maneuver:")) return "Maneuver";
      if (id.startsWith("debris:")) return "Debris";
      return "ConjunctionEvent";
    };
    // Build a synthetic descriptive label from the edges referencing each
    // ghost: KG edges name `finding:NNN` while /api/findings uses `f:NNNN` so
    // titles don't match — the relation summary is the next best thing.
    const ghostNeighbours = new Map<
      string,
      { peer: string; relation: string }[]
    >();
    for (const e of data.edges) {
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
        // Pick the most descriptive peer (prefer non-finding peers).
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
    for (const e of data.edges) {
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
    const allNodes = [...data.nodes, ...ghosts];
    const layout = layoutByClass(allNodes);
    const maxDeg = Math.max(1, ...deg.values());
    for (const n of allNodes) {
      const p = layout.get(n.id) ?? { x: n.x, y: n.y };
      const d = n.degree || deg.get(n.id) || 0;
      // Connected nodes (axons) are large + bright; isolated nodes are tiny dim
      // dust so the live neuron cluster reads as the focal point.
      const isConnected = d > 0;
      const size = isConnected
        ? Math.min(5 + Math.sqrt(d) * 3.2, 28)
        : 1.2;
      const color = isConnected
        ? ENTITY_COLOR[n.class]
        : ENTITY_COLOR[n.class] + "55";
      const isFinding = n.id.startsWith("finding:");
      const attrs = {
        label: isConnected ? n.label : "", // hide labels on dust
        // Findings get bright white labels (the human-readable title); other
        // entities use the muted default so the brief titles stand out.
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
    for (const e of data.edges) {
      if (!g.hasNode(e.source) || !g.hasNode(e.target)) continue;
      // Default confidence to a strong baseline when API omits it (most edges
      // have no confidence field today). This keeps axons visible.
      const conf = typeof e.confidence === "number" && Number.isFinite(e.confidence)
        ? e.confidence
        : 0.85;
      const cls = (e.sourceClass ?? "derived") as keyof typeof SOURCE_COLOR;
      // Bright alpha — axons must read as live signals, not faint dust.
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
    // ForceAtlas2 settles the seed sectors into organic neuron clusters.
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
  }, [data, findingTitleById]);

  useEffect(() => {
    if (!graph || !containerRef.current) return;
    const renderer = new Sigma(graph, containerRef.current, {
      labelColor: { attribute: "labelColor" },
      labelSize: 12,
      labelFont: "JetBrains Mono Variable, ui-monospace, monospace",
      labelWeight: "700",
      defaultEdgeColor: "#22D3EE99",
      renderLabels: true,
      renderEdgeLabels: false,
      labelRenderedSizeThreshold: 4,
      enableEdgeEvents: false,
      minCameraRatio: 0.05,
      maxCameraRatio: 4,
    });
    // Auto-fit camera to graph bounding box so the cluster centres on load.
    requestAnimationFrame(() => {
      const cam = renderer.getCamera();
      cam.animatedReset({ duration: 600 });
    });
    renderer.on("clickNode", ({ node }) => {
      // Findings open the SYNAPTIC READOUT panel (live fetch from
      // /api/findings/:id). Other entities open the standard ThalamusDrawer.
      if (node.startsWith("finding:")) {
        const numeric = Number(node.split(":")[1]);
        if (Number.isFinite(numeric)) {
          closeDrawer();
          setSelected(null);
          setSelectedFindingNumeric(numeric);
          return;
        }
      }
      const attrs = graph.getNodeAttributes(node);
      setSelectedFindingNumeric(null);
      setSelected({
        id: node,
        label: attrs.label,
        class: attrs.entityClass as EntityClass,
        degree: attrs.degree,
        x: attrs.x,
        y: attrs.y,
        cortex: attrs.cortex,
      });
      openDrawer(`kg:${node}`);
    });
    renderer.on("enterNode", () => (document.body.style.cursor = "pointer"));
    renderer.on("leaveNode", () => (document.body.style.cursor = "default"));
    sigmaRef.current = renderer;
    return () => {
      renderer.kill();
      sigmaRef.current = null;
    };
  }, [graph, openDrawer, closeDrawer]);

  const incidentEdges = useMemo<KgEdgeDTO[]>(() => {
    if (!graph || !selected) return [];
    return graph.edges(selected.id).map((eid) => {
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
  }, [graph, selected]);

  const handleFocus = (nodeId: string) => {
    const r = sigmaRef.current;
    if (!r || !graph?.hasNode(nodeId)) return;
    const attrs = graph.getNodeAttributes(nodeId);
    r.getCamera().animate(
      { x: attrs.x / 1000 + 0.5, y: attrs.y / 1000 + 0.5, ratio: 0.35 },
      { duration: 400 },
    );
    if (nodeId.startsWith("finding:")) {
      const numeric = Number(nodeId.split(":")[1]);
      if (Number.isFinite(numeric)) {
        closeDrawer();
        setSelected(null);
        setSelectedFindingNumeric(numeric);
        return;
      }
    }
    setSelectedFindingNumeric(null);
    setSelected({
      id: nodeId,
      label: attrs.label,
      class: attrs.entityClass as EntityClass,
      degree: attrs.degree,
      x: attrs.x,
      y: attrs.y,
      cortex: attrs.cortex,
    });
    openDrawer(`kg:${nodeId}`);
  };

  return (
    <div className="relative h-full w-full bg-base">
      <div className="absolute inset-0 opacity-30 [background-image:radial-gradient(circle_at_1px_1px,#1F2937_1px,transparent_0)] [background-size:24px_24px]" />
      <div ref={containerRef} className="absolute inset-0" />

      {isLoading && (
        <div className="absolute left-4 top-4 border border-hairline bg-panel/90 px-3 py-2 backdrop-blur-sm">
          <span className="mono text-caption text-dim">loading graph…</span>
        </div>
      )}

      {/* Top-left: graph summary */}
      {data && stats && (
        <div className="pointer-events-none absolute left-4 top-4 border border-hairline bg-panel/90 backdrop-blur-sm">
          <div className="flex items-center gap-2 border-b border-hairline px-3 py-1.5">
            <div className="h-1.5 w-1.5 bg-cyan" />
            <div className="label text-nano">KNOWLEDGE GRAPH</div>
          </div>
          <div className="flex">
            <div className="flex flex-col gap-0.5 px-3 py-2 border-r border-hairline">
              <div className="label text-nano">NODES</div>
              <div className="mono text-h2 leading-none text-primary tabular-nums">
                {data.nodes.length}
              </div>
            </div>
            <div className="flex flex-col gap-0.5 px-3 py-2 border-r border-hairline">
              <div className="label text-nano">EDGES</div>
              <div className="mono text-h2 leading-none text-cyan tabular-nums">
                {data.edges.length}
              </div>
            </div>
            <div className="flex flex-col gap-0.5 px-3 py-2">
              <div className="label text-nano">AVG DEG</div>
              <div className="mono text-h2 leading-none text-primary tabular-nums">
                {data.nodes.length === 0
                  ? "0"
                  : ((data.edges.length * 2) / data.nodes.length).toFixed(1)}
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Top-right: class distribution + top hubs + relations */}
      {data && stats && (
        <div className="absolute right-4 top-4 w-72 border border-hairline bg-panel/90 backdrop-blur-sm">
          <div className="border-b border-hairline px-3 py-1.5">
            <div className="label text-nano">CLASS DISTRIBUTION</div>
          </div>
          <div className="flex flex-col gap-1 px-3 py-2">
            {CLASSES.filter((c) => (stats.classCount.get(c) ?? 0) > 0).map((c) => {
              const n = stats.classCount.get(c) ?? 0;
              const pct = (n / stats.maxClass) * 100;
              return (
                <div key={c} className="flex items-center gap-2">
                  <span
                    className="h-1.5 w-1.5 shrink-0"
                    style={{ backgroundColor: ENTITY_COLOR[c] }}
                  />
                  <span className="mono w-24 shrink-0 text-nano text-muted">{c}</span>
                  <div className="relative h-1.5 flex-1 bg-hairline">
                    <div
                      className="absolute inset-y-0 left-0"
                      style={{ width: `${pct}%`, backgroundColor: ENTITY_COLOR[c] }}
                    />
                  </div>
                  <span className="mono w-8 text-right text-nano text-numeric tabular-nums">
                    {n}
                  </span>
                </div>
              );
            })}
          </div>

          <div className="border-t border-hairline px-3 py-1.5">
            <div className="label text-nano">TOP HUBS · BY DEGREE</div>
          </div>
          <ul className="divide-y divide-hairline">
            {stats.topHubs.map((n) => (
              <li key={n.id}>
                <button
                  onClick={() => handleFocus(n.id)}
                  className="flex w-full cursor-pointer items-center gap-2 px-3 py-1 text-left hover:bg-hover"
                >
                  <span
                    className="h-1.5 w-1.5 shrink-0"
                    style={{ backgroundColor: ENTITY_COLOR[n.class] }}
                  />
                  <span className="truncate text-caption text-primary">{n.label}</span>
                  <span className="ml-auto mono text-nano text-dim tabular-nums">
                    deg {n.degree}
                  </span>
                </button>
              </li>
            ))}
          </ul>

          <div className="border-t border-hairline px-3 py-1.5">
            <div className="label text-nano">TOP RELATIONS</div>
          </div>
          <div className="flex flex-col gap-0.5 px-3 py-2">
            {stats.topRelations.map(([rel, n]) => (
              <div key={rel} className="flex items-center justify-between">
                <span className="mono text-nano text-muted">{rel}</span>
                <span className="mono text-nano text-numeric tabular-nums">{n}</span>
              </div>
            ))}
          </div>

          {(findingsData?.items?.length ?? 0) > 0 && (
            <>
              <div className="border-t border-hairline px-3 py-1.5">
                <div className="label text-nano">TOP FINDINGS · BY PRIORITY</div>
              </div>
              <ul className="divide-y divide-hairline">
                {(findingsData?.items ?? [])
                  .slice()
                  .sort((a, b) => (b.priority ?? 0) - (a.priority ?? 0))
                  .slice(0, 8)
                  .map((f) => {
                    const numeric = Number(f.id.replace(/^f:/, ""));
                    const sevColor =
                      f.priority >= 80
                        ? "bg-hot"
                        : f.priority >= 50
                          ? "bg-amber"
                          : "bg-dim";
                    return (
                      <li key={f.id}>
                        <button
                          onClick={() => {
                            closeDrawer();
                            setSelected(null);
                            setSelectedFindingNumeric(numeric);
                          }}
                          className="flex w-full cursor-pointer items-start gap-2 px-3 py-1.5 text-left transition-colors duration-fast ease-palantir hover:bg-hover"
                        >
                          <span className={`mt-1 h-1.5 w-1.5 shrink-0 ${sevColor}`} />
                          <div className="flex min-w-0 flex-1 flex-col">
                            <span className="truncate text-caption text-primary">
                              {f.title}
                            </span>
                            <span className="mono text-nano text-dim">
                              F#{numeric} · {f.cortex}
                            </span>
                          </div>
                          <span className="mono shrink-0 text-nano text-numeric tabular-nums">
                            P{f.priority?.toString().padStart(2, "0") ?? "—"}
                          </span>
                        </button>
                      </li>
                    );
                  })}
              </ul>
            </>
          )}
        </div>
      )}

      <ClassLegend />

      {selectedFindingNumeric === null && <ThalamusDrawer node={selected} edges={incidentEdges} />}
      <FindingReadout
        findingId={selectedFindingNumeric}
        onClose={() => setSelectedFindingNumeric(null)}
        onFocusEntity={(eid) => {
          // Re-focus the graph on the linked entity (sat/finding) if it lives
          // in the current graph; otherwise no-op.
          if (graph?.hasNode(eid)) handleFocus(eid);
        }}
      />
    </div>
  );
}

function ClassLegend() {
  return (
    <div className="absolute bottom-4 left-4 border border-hairline bg-panel/90 px-3 py-2 backdrop-blur-sm">
      <div className="label mb-2 text-nano">ENTITY CLASSES · grouped by sector</div>
      <div className="grid grid-cols-2 gap-x-4 gap-y-1">
        {CLASSES.map((c) => (
          <div key={c} className="flex items-center gap-2">
            <span className="h-2 w-2" style={{ backgroundColor: ENTITY_COLOR[c] }} />
            <span className="mono text-caption text-numeric">{c}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

function classDescription(cls: EntityClass): string {
  switch (cls) {
    case "Satellite":
      return "Tracked space asset — TLE-propagated, conjunction-screened, optionally fronted by an Operator and bound to a single OrbitRegime.";
    case "Operator":
      return "Sovereign or commercial entity declared as the responsible party for a fleet. Drives provenance and classification posture.";
    case "OrbitRegime":
      return "Coarse altitude/inclination class (LEO/MEO/GEO/HEO/SSO). Aggregates congestion, debris density and conjunction priors.";
    case "ConjunctionEvent":
      return "Pair-wise close-approach event: two assets, a TCA, miss distance and Pc. Promoted into Findings when severity warrants action.";
    case "Payload":
      return "Functional class hosted on a Satellite (comms, EO, nav, science). Used by replacement-cost and capability inference.";
    case "Maneuver":
      return "Detected or planned orbital change — delta-v vector and confidence. Ties Cause→Effect across observation windows.";
    case "Debris":
      return "Untracked or fragment object. No active operator; mass and area are estimated from radar cross-section.";
    default:
      return "Knowledge-graph entity — see cortex provenance for derivation rationale.";
  }
}

function truncateLabel(s: string, max: number): string {
  if (s.length <= max) return s;
  return s.slice(0, max - 1).trimEnd() + "…";
}

function buildAsciiBar(value: number, max: number, width = 20): string {
  if (max <= 0) return " ".repeat(width);
  const blocks = Math.max(1, Math.round((value / max) * width));
  return "█".repeat(blocks) + "░".repeat(Math.max(0, width - blocks));
}

function buildNeuronAscii(degree: number, hubness: number): string {
  // 9-line ASCII neuron drawn with stable mono-width chars.
  // Soma intensity scales with hub rank; axon length scales with degree.
  const arms = Math.min(10, Math.max(1, Math.ceil(Math.sqrt(degree))));
  const limbLen = Math.min(10, 2 + Math.floor(arms / 2));
  const limb = "─".repeat(limbLen);
  const pad = " ".repeat(Math.max(0, 10 - limbLen));
  const intensity = hubness > 0.66 ? "▓" : hubness > 0.33 ? "▒" : "░";
  const fill = "▓";
  const rows = [
    `${pad}${" ".repeat(6)}${intensity}${intensity}${intensity}${intensity}${intensity}${intensity}${" ".repeat(6)}`,
    `${pad}${" ".repeat(4)}${intensity}${fill}${fill}${" "}${" "}${fill}${fill}${intensity}${" ".repeat(4)}`,
    `${pad}${" ".repeat(3)}${intensity}${fill}${fill}${fill}${fill}${fill}${fill}${intensity}${" ".repeat(3)}`,
    `${limb}─${intensity}${fill}${fill}╳${fill}${fill}${intensity}─${limb}`,
    `${pad}${" ".repeat(3)}${intensity}${fill}${fill}${fill}${fill}${fill}${fill}${intensity}${" ".repeat(3)}`,
    `${pad}${" ".repeat(4)}${intensity}${fill}${fill}${" "}${" "}${fill}${fill}${intensity}${" ".repeat(4)}`,
    `${pad}${" ".repeat(6)}${intensity}${intensity}${intensity}${intensity}${intensity}${intensity}${" ".repeat(6)}`,
    "",
    ` axons ${String(arms).padStart(2)}   degree ${String(degree).padStart(3)}   hub ${(hubness * 100).toFixed(0).padStart(3)}%`,
  ];
  return rows.join("\n");
}

function ThalamusDrawer({ node, edges }: { node: KgNodeDTO | null; edges: KgEdgeDTO[] }) {
  if (!node) return <Drawer title="ENTITY" subtitle="select a neuron">{null}</Drawer>;

  const incidentDegree = edges.length;
  const relationCount = new Map<string, number>();
  const sourceCount: Record<"field" | "osint" | "sim" | "derived", number> = {
    field: 0,
    osint: 0,
    sim: 0,
    derived: 0,
  };
  let totalConfidence = 0;
  let confidenceSamples = 0;
  for (const e of edges) {
    relationCount.set(e.relation, (relationCount.get(e.relation) ?? 0) + 1);
    const cls = (e.sourceClass ?? "derived") as keyof typeof sourceCount;
    sourceCount[cls] = (sourceCount[cls] ?? 0) + 1;
    if (typeof e.confidence === "number" && Number.isFinite(e.confidence)) {
      totalConfidence += e.confidence;
      confidenceSamples++;
    }
  }
  const meanConfidence = confidenceSamples === 0 ? null : totalConfidence / confidenceSamples;
  const topRelations = [...relationCount.entries()].sort((a, b) => b[1] - a[1]);
  const maxRelCount = Math.max(1, ...topRelations.map(([, n]) => n));
  const hubness = Math.min(1, incidentDegree / 12);

  return (
    <Drawer title="NEURON" subtitle={`${node.label} · ${node.class}`}>
      <DrawerSection title="ASCII MAP">
        <pre className="mono whitespace-pre text-nano leading-tight text-cyan">
{buildNeuronAscii(incidentDegree, hubness)}
        </pre>
        <div className="mt-2 text-caption text-muted leading-snug">
          {classDescription(node.class)}
        </div>
      </DrawerSection>

      <DrawerSection title="IDENTITY">
        <KV k="ID" v={node.id} mono />
        <KV k="Label" v={node.label} />
        <KV
          k="Class"
          v={
            <span className="mono" style={{ color: ENTITY_COLOR[node.class] }}>
              {node.class}
            </span>
          }
        />
        <KV
          k="Cortex"
          v={<span className="mono text-caption text-numeric">{node.cortex || "—"}</span>}
        />
        <KV k="Degree" v={<Measure value={fmtCount(incidentDegree)} />} />
        <KV
          k="Hub rank"
          v={
            <span className="mono tabular-nums text-cyan">
              {(hubness * 100).toFixed(0)}
              <span className="ml-0.5 text-dim">%</span>
            </span>
          }
        />
        <KV
          k="μ-confidence"
          v={
            meanConfidence === null ? (
              <span className="mono text-dim">— no signal</span>
            ) : (
              <span className="mono tabular-nums">
                {(meanConfidence * 100).toFixed(0)}
                <span className="ml-0.5 text-dim">%</span>
              </span>
            )
          }
        />
      </DrawerSection>

      <DrawerSection title={`AXONS · ${edges.length}`}>
        {edges.length === 0 && (
          <div className="text-caption text-dim">isolated · no incident edges yet</div>
        )}
        {edges.length > 0 && (
          <>
            <div className="mb-2 grid grid-cols-[80px_1fr_28px] items-center gap-2">
              {(["field", "osint", "sim", "derived"] as const).map((k) => {
                const n = sourceCount[k];
                if (n === 0) return null;
                const bar = buildAsciiBar(n, edges.length, 18);
                return (
                  <div key={k} className="contents">
                    <span
                      className="mono text-nano uppercase tracking-widest"
                      style={{ color: SOURCE_COLOR[k] }}
                    >
                      {k}
                    </span>
                    <pre
                      className="mono whitespace-pre text-nano leading-none"
                      style={{ color: SOURCE_COLOR[k] }}
                    >
                      {bar}
                    </pre>
                    <span className="mono text-right text-nano text-numeric tabular-nums">
                      {n}
                    </span>
                  </div>
                );
              })}
            </div>
            <div className="grid grid-cols-[88px_1fr_24px] items-center gap-2 border-t border-hairline pt-2">
              <span className="mono text-nano uppercase tracking-widest text-dim">
                relations
              </span>
              <span />
              <span />
              {topRelations.slice(0, 6).map(([rel, n]) => (
                <div key={rel} className="contents">
                  <span className="mono truncate text-nano text-muted">{rel}</span>
                  <pre className="mono whitespace-pre text-nano leading-none text-cyan">
                    {buildAsciiBar(n, maxRelCount, 18)}
                  </pre>
                  <span className="mono text-right text-nano text-numeric tabular-nums">
                    {n}
                  </span>
                </div>
              ))}
            </div>
          </>
        )}
      </DrawerSection>

      <DrawerSection title="INCIDENT EDGES">
        {edges.slice(0, 12).map((e) => {
          const peer = e.source === node.id ? e.target : e.source;
          return (
            <div
              key={e.id}
              className="grid grid-cols-[1fr_auto] items-baseline gap-2 border-b border-hairline py-1 last:border-0"
            >
              <span className="truncate text-caption text-numeric">
                <span className="text-muted">{e.relation}</span>{" "}
                <span className="text-primary">{peer}</span>
              </span>
              <span
                className="mono text-caption tabular-nums"
                style={{ color: SOURCE_COLOR[(e.sourceClass ?? "derived") as keyof typeof SOURCE_COLOR] }}
              >
                {e.sourceClass ?? "derived"}
                {typeof e.confidence === "number" && Number.isFinite(e.confidence) && (
                  <>
                    <span className="ml-1 text-dim">·</span>{" "}
                    {(e.confidence * 100).toFixed(0)}
                    <span className="ml-0.5 text-dim">%</span>
                  </>
                )}
              </span>
            </div>
          );
        })}
        {edges.length > 12 && (
          <div className="mt-1 text-nano text-dim">+{edges.length - 12} more</div>
        )}
      </DrawerSection>
    </Drawer>
  );
}
