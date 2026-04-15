import { useEffect, useMemo, useRef, useState } from "react";
import Graph from "graphology";
import Sigma from "sigma";
import { useKg } from "@/lib/queries";
import { ENTITY_COLOR, SOURCE_COLOR } from "@/lib/graphColors";
import { useUiStore } from "@/lib/uiStore";
import { Drawer, DrawerSection, KV } from "@/components/Drawer";
import type { EntityClass, KgEdgeDTO, KgNodeDTO } from "@/lib/api";

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

export function ThalamusMode() {
  const { data, isLoading } = useKg();
  const containerRef = useRef<HTMLDivElement>(null);
  const sigmaRef = useRef<Sigma | null>(null);
  const [selected, setSelected] = useState<KgNodeDTO | null>(null);
  const openDrawer = useUiStore((s) => s.openDrawer);

  const stats = useMemo(() => {
    if (!data) return null;
    const classCount = new Map<EntityClass, number>();
    for (const c of CLASSES) classCount.set(c, 0);
    for (const n of data.nodes) classCount.set(n.class, (classCount.get(n.class) ?? 0) + 1);
    const topHubs = [...data.nodes].sort((a, b) => b.degree - a.degree).slice(0, 6);
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
    const layout = layoutByClass(data.nodes);
    for (const n of data.nodes) {
      const p = layout.get(n.id) ?? { x: n.x, y: n.y };
      const attrs = {
        label: n.label,
        x: p.x,
        y: p.y,
        size: Math.min(3 + Math.sqrt(n.degree) * 1.8, 16),
        color: ENTITY_COLOR[n.class],
        entityClass: n.class,
        cortex: n.cortex,
        degree: n.degree,
      };
      if (g.hasNode(n.id)) {
        g.mergeNodeAttributes(n.id, attrs);
      } else {
        g.addNode(n.id, attrs);
      }
    }
    for (const e of data.edges) {
      if (!g.hasNode(e.source) || !g.hasNode(e.target)) continue;
      g.addEdgeWithKey(e.id, e.source, e.target, {
        size: Math.max(0.25, e.confidence * 1.4),
        color: SOURCE_COLOR[e.sourceClass] + "44",
        relation: e.relation,
        confidence: e.confidence,
        sourceClass: e.sourceClass,
      });
    }
    return g;
  }, [data]);

  useEffect(() => {
    if (!graph || !containerRef.current) return;
    const renderer = new Sigma(graph, containerRef.current, {
      labelColor: { color: "#8B949E" },
      labelSize: 11,
      labelFont: "Inter Variable, Inter, sans-serif",
      labelWeight: "500",
      defaultEdgeColor: "#1F293766",
      renderLabels: true,
      labelRenderedSizeThreshold: 10,
    });
    renderer.on("clickNode", ({ node }) => {
      const attrs = graph.getNodeAttributes(node);
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
  }, [graph, openDrawer]);

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
            <div className="label text-[10px]">KNOWLEDGE GRAPH</div>
          </div>
          <div className="flex">
            <div className="flex flex-col gap-0.5 px-3 py-2 border-r border-hairline">
              <div className="label text-[10px]">NODES</div>
              <div className="mono text-h2 leading-none text-primary tabular-nums">
                {data.nodes.length}
              </div>
            </div>
            <div className="flex flex-col gap-0.5 px-3 py-2 border-r border-hairline">
              <div className="label text-[10px]">EDGES</div>
              <div className="mono text-h2 leading-none text-cyan tabular-nums">
                {data.edges.length}
              </div>
            </div>
            <div className="flex flex-col gap-0.5 px-3 py-2">
              <div className="label text-[10px]">AVG DEG</div>
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
            <div className="label text-[10px]">CLASS DISTRIBUTION</div>
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
                  <span className="mono w-24 shrink-0 text-[10px] text-muted">{c}</span>
                  <div className="relative h-1.5 flex-1 bg-hairline">
                    <div
                      className="absolute inset-y-0 left-0"
                      style={{ width: `${pct}%`, backgroundColor: ENTITY_COLOR[c] }}
                    />
                  </div>
                  <span className="mono w-8 text-right text-[10px] text-numeric tabular-nums">
                    {n}
                  </span>
                </div>
              );
            })}
          </div>

          <div className="border-t border-hairline px-3 py-1.5">
            <div className="label text-[10px]">TOP HUBS · BY DEGREE</div>
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
                  <span className="ml-auto mono text-[10px] text-dim tabular-nums">
                    deg {n.degree}
                  </span>
                </button>
              </li>
            ))}
          </ul>

          <div className="border-t border-hairline px-3 py-1.5">
            <div className="label text-[10px]">TOP RELATIONS</div>
          </div>
          <div className="flex flex-col gap-0.5 px-3 py-2">
            {stats.topRelations.map(([rel, n]) => (
              <div key={rel} className="flex items-center justify-between">
                <span className="mono text-[10px] text-muted">{rel}</span>
                <span className="mono text-[10px] text-numeric tabular-nums">{n}</span>
              </div>
            ))}
          </div>
        </div>
      )}

      <ClassLegend />

      <ThalamusDrawer node={selected} edges={incidentEdges} />
    </div>
  );
}

function ClassLegend() {
  return (
    <div className="absolute bottom-4 left-4 border border-hairline bg-panel/90 px-3 py-2 backdrop-blur-sm">
      <div className="label mb-2 text-[10px]">ENTITY CLASSES · grouped by sector</div>
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

function ThalamusDrawer({ node, edges }: { node: KgNodeDTO | null; edges: KgEdgeDTO[] }) {
  if (!node) return <Drawer title="ENTITY" subtitle="select a node">{null}</Drawer>;
  return (
    <Drawer title="ENTITY" subtitle={`${node.label} · ${node.class}`}>
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
        <KV k="Cortex" v={<span className="mono text-caption text-numeric">{node.cortex}</span>} />
        <KV k="Degree" v={node.degree} mono />
      </DrawerSection>
      <DrawerSection title={`EDGES (${edges.length})`}>
        {edges.length === 0 && <div className="text-caption text-dim">isolated node</div>}
        {edges.slice(0, 20).map((e) => (
          <div
            key={e.id}
            className="grid grid-cols-[1fr_auto] items-baseline gap-2 border-b border-hairline py-1 last:border-0"
          >
            <span className="truncate text-caption text-numeric">
              <span className="text-muted">{e.relation}</span>{" "}
              {e.source === node.id ? e.target : e.source}
            </span>
            <span
              className="mono text-caption"
              style={{ color: SOURCE_COLOR[e.sourceClass] }}
            >
              {e.sourceClass} · {(e.confidence * 100).toFixed(0)}%
            </span>
          </div>
        ))}
      </DrawerSection>
    </Drawer>
  );
}
