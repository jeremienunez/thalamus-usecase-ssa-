import { useMemo, useState } from "react";
import { useKg, useFindings } from "@/usecases";
import { ENTITY_COLOR } from "@/shared/types/graph-colors";
import { useUiStore } from "@/shared/ui/uiStore";
import { HudPanel } from "@/shared/ui/HudPanel";
import { MetricTile } from "@/shared/ui/MetricTile";
import { countBy, topN, maxCount } from "@/shared/util/aggregate";
import { KgScene3d } from "./KgScene3d";
import {
  buildKgSceneGraph,
  KG_CLASSES,
  type KgSceneNode,
} from "./kg-scene";
import { FindingReadout } from "./FindingReadout";
import { ThalamusDrawer } from "./ThalamusDrawer";
import type { KgEdgeDto, KgNodeDto } from "@/dto/http";

export function ThalamusEntry() {
  const { data, isLoading } = useKg();
  const { data: findingsData } = useFindings();
  const [selected, setSelected] = useState<KgNodeDto | null>(null);
  const [selectedFindingNumeric, setSelectedFindingNumeric] = useState<number | null>(null);
  const [focusNodeId, setFocusNodeId] = useState<string | null>(null);
  const openDrawer = useUiStore((s) => s.openDrawer);
  const closeDrawer = useUiStore((s) => s.closeDrawer);
  const findings = findingsData?.items ?? [];

  const findingTitleById = useMemo(() => {
    const m = new Map<string, string>();
    for (const f of findings) {
      m.set(`finding:${f.id}`, f.title);
      if (f.id.startsWith("f:")) m.set(`finding:${f.id.slice(2)}`, f.title);
    }
    return m;
  }, [findings]);

  const sceneGraph = useMemo(
    () =>
      data
        ? buildKgSceneGraph({
            nodes: data.nodes,
            edges: data.edges,
            findingTitleById,
          })
        : null,
    [data, findingTitleById],
  );

  const sceneNodeById = useMemo(() => {
    const m = new Map<string, KgSceneNode>();
    for (const node of sceneGraph?.nodes ?? []) m.set(node.id, node);
    return m;
  }, [sceneGraph]);

  const stats = useMemo(() => {
    if (!data || !sceneGraph) return null;
    const classCount = countBy(data.nodes, (n) => n.class);
    for (const c of KG_CLASSES) if (!classCount.has(c)) classCount.set(c, 0);
    const topHubs = [...sceneGraph.nodes]
      .filter((node) => !node.ghost)
      .sort((a, b) => b.degree - a.degree)
      .slice(0, 6);
    const topRelations = topN(countBy(data.edges, (e) => e.relation), 5);
    const maxClass = Math.max(1, maxCount(classCount));
    return { classCount, topHubs, topRelations, maxClass };
  }, [data, sceneGraph]);

  const selectKgNode = (node: KgSceneNode) => {
    if (node.id.startsWith("finding:")) {
      const numeric = Number(node.id.split(":")[1]);
      if (Number.isFinite(numeric)) {
        closeDrawer();
        setSelected(null);
        setSelectedFindingNumeric(numeric);
        return;
      }
    }
    setSelectedFindingNumeric(null);
    setSelected(node);
    openDrawer(`kg:${node.id}`);
  };

  const incidentEdges = useMemo<KgEdgeDto[]>(() => {
    if (!data || !selected) return [];
    return data.edges.filter((edge) => edge.source === selected.id || edge.target === selected.id);
  }, [data, selected]);

  const handleFocus = (nodeId: string) => {
    const node = sceneNodeById.get(nodeId);
    if (!node) return;
    setFocusNodeId(nodeId);
    selectKgNode(node);
  };

  return (
    <div className="relative h-full w-full bg-base">
      <div className="absolute inset-0 opacity-30 [background-image:radial-gradient(circle_at_1px_1px,#1F2937_1px,transparent_0)] [background-size:24px_24px]" />
      {sceneGraph && (
        <div className="absolute inset-0">
          <KgScene3d
            graph={sceneGraph}
            selectedNodeId={selected?.id ?? null}
            focusNodeId={focusNodeId}
            onSelectNode={(node) => {
              setFocusNodeId(node.id);
              selectKgNode(node);
            }}
            onFocusDone={() => setFocusNodeId(null)}
          />
        </div>
      )}

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
        <HudPanel className="absolute right-4 top-4 w-72" title="ENTITY DISTRIBUTION">
          <div className="flex flex-col gap-1 px-3 py-2">
            {KG_CLASSES.filter((c) => (stats.classCount.get(c) ?? 0) > 0).map((c) => {
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

          {findings.length > 0 && (
            <>
              <div className="border-t border-hairline px-3 py-1.5">
                <div className="label text-nano">TOP FINDINGS · BY PRIORITY</div>
              </div>
              <ul className="divide-y divide-hairline">
                {findings
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
          if (sceneNodeById.has(eid)) handleFocus(eid);
        }}
      />
    </div>
  );
}

function ClassLegend() {
  return (
    <HudPanel className="absolute bottom-4 left-4">
      <div className="px-3 py-2">
        <div className="label mb-2 text-nano">ENTITY CLASSES · orbital layers</div>
        <div className="grid grid-cols-2 gap-x-4 gap-y-1">
          {KG_CLASSES.map((c) => (
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
