import { useEffect, useMemo, useRef, useState } from "react";
import { useKg, useFindings } from "@/usecases";
import { ENTITY_COLOR, SOURCE_COLOR } from "@/shared/types/graph-colors";
import { useUiStore } from "@/shared/ui/uiStore";
import { Drawer, DrawerSection, KV } from "@/shared/ui/Drawer";
import { fmtCount } from "@/shared/types/units";
import { Measure } from "@/shared/ui/Measure";
import { blockBar } from "@/shared/ui/sparkline";
import { HudPanel } from "@/shared/ui/HudPanel";
import { MetricTile } from "@/shared/ui/MetricTile";
import { countBy, topN, maxCount } from "@/shared/util/aggregate";
import { useGraph } from "@/adapters/graph/GraphContext";
import type { GraphInstance } from "@/adapters/graph/graph-builder";
import type { SigmaRendererHandle } from "@/adapters/graph/sigma-renderer";
import { FindingReadout } from "./FindingReadout";
import { ThalamusDrawer } from "./ThalamusDrawer";
import type { EntityClass, KgEdgeDto, KgNodeDto } from "@/dto/http";

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
function layoutByClass(nodes: KgNodeDto[]): Map<string, { x: number; y: number }> {
  const byClass = new Map<EntityClass, KgNodeDto[]>();
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

const GHOST_CLASS_FOR = (id: string): EntityClass => {
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

export function ThalamusEntry() {
  const { data, isLoading } = useKg();
  const { data: findingsData } = useFindings();
  const containerRef = useRef<HTMLDivElement>(null);
  const sigmaRef = useRef<SigmaRendererHandle | null>(null);
  const [selected, setSelected] = useState<KgNodeDto | null>(null);
  const [selectedFindingNumeric, setSelectedFindingNumeric] = useState<number | null>(null);
  const openDrawer = useUiStore((s) => s.openDrawer);
  const closeDrawer = useUiStore((s) => s.closeDrawer);
  const graphAdapter = useGraph();

  // Map finding:<id> → human title for graph labelling.
  const findingTitleById = useMemo(() => {
    const m = new Map<string, string>();
    for (const f of findingsData?.items ?? []) m.set(`finding:${f.id}`, f.title);
    return m;
  }, [findingsData]);

  const stats = useMemo(() => {
    if (!data) return null;
    const classCount = countBy(data.nodes, (n) => n.class);
    for (const c of CLASSES) if (!classCount.has(c)) classCount.set(c, 0);
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
    const topRelations = topN(countBy(data.edges, (e) => e.relation), 5);
    const maxClass = Math.max(1, maxCount(classCount));
    return { classCount, topHubs, topRelations, maxClass };
  }, [data]);

  const graph = useMemo<GraphInstance | null>(() => {
    if (!data) return null;
    const layout = layoutByClass(data.nodes);
    return graphAdapter.buildKgGraph({
      nodes: data.nodes,
      edges: data.edges,
      layout,
      findingTitleById,
      ghostClassFor: GHOST_CLASS_FOR,
      truncateLabel,
    });
  }, [data, findingTitleById, graphAdapter]);

  // Route a graph click/focus into the right drawer: findings pop the
  // FindingReadout (fresh fetch from /api/findings/:id); other entities go
  // through the standard ThalamusDrawer wired to the global drawer store.
  const selectKgNode = (nodeId: string, attrs: Record<string, unknown>) => {
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
      label: attrs.label as string,
      class: attrs.entityClass as EntityClass,
      degree: attrs.degree as number,
      x: attrs.x as number,
      y: attrs.y as number,
      cortex: attrs.cortex as string,
    });
    openDrawer(`kg:${nodeId}`);
  };

  useEffect(() => {
    if (!graph || !containerRef.current) return;
    const handle = graphAdapter.createSigmaRenderer(containerRef.current, graph, {
      onNodeClick: selectKgNode,
      onHoverChange: (cursor) => {
        document.body.style.cursor = cursor;
      },
    });
    sigmaRef.current = handle;
    return () => {
      handle.kill();
      sigmaRef.current = null;
    };
    // selectKgNode is stable relative to its closures within the render
    // scope; no need to add it to deps and risk re-mounting the renderer.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [graph, graphAdapter, openDrawer, closeDrawer]);

  const incidentEdges = useMemo<KgEdgeDto[]>(() => {
    if (!graph || !selected) return [];
    return graphAdapter.incidentEdgesFor(graph, selected.id);
  }, [graph, selected, graphAdapter]);

  const handleFocus = (nodeId: string) => {
    const r = sigmaRef.current;
    if (!r || !graph?.hasNode(nodeId)) return;
    r.focusNode(nodeId);
    selectKgNode(nodeId, r.getNodeAttributes(nodeId));
  };

  return (
    <div className="relative h-full w-full bg-base">
      <div className="absolute inset-0 opacity-30 [background-image:radial-gradient(circle_at_1px_1px,#1F2937_1px,transparent_0)] [background-size:24px_24px]" />
      <div ref={containerRef} className="absolute inset-0" />

      {isLoading && (
        <HudPanel className="absolute left-4 top-4">
          <div className="px-3 py-2">
            <span className="mono text-caption text-dim">loading graph…</span>
          </div>
        </HudPanel>
      )}

      {/* Top-left: graph summary */}
      {data && stats && (
        <HudPanel
          className="absolute left-4 top-4"
          passthrough
          title="KNOWLEDGE GRAPH"
          dot="cyan"
        >
          <div className="flex">
            <MetricTile label="NODES" value={data.nodes.length} accent="primary" />
            <MetricTile label="EDGES" value={data.edges.length} accent="cyan" />
            <MetricTile
              label="AVG DEG"
              value={
                data.nodes.length === 0 ? 0 : (data.edges.length * 2) / data.nodes.length
              }
              display={(v) => v.toFixed(1)}
              accent="primary"
            />
          </div>
        </HudPanel>
      )}

      {/* Top-right: class distribution + top hubs + relations */}
      {data && stats && (
        <HudPanel className="absolute right-4 top-4 w-72" title="CLASS DISTRIBUTION">
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
        </HudPanel>
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
    <HudPanel className="absolute bottom-4 left-4">
      <div className="px-3 py-2">
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
    </HudPanel>
  );
}

function truncateLabel(s: string, max: number): string {
  if (s.length <= max) return s;
  return s.slice(0, max - 1).trimEnd() + "…";
}
