import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import {
  useOperatorSwarmStatusQuery,
  useOperatorSwarmClustersQuery,
  useOperatorSwarmTerminalsQuery,
} from "@/usecases";
import {
  buildFishSceneModel,
  type FishSceneFilters,
  type FishSceneInput,
} from "./fish-scene-model";
import { FishSwarmPlot } from "./FishSwarmPlot";
import {
  FishFiltersPanel,
  FishInspectorPanel,
  FishEvidencePanel,
  FishAskPanel,
} from "./FishOperatorHud";

const DEFAULT_FILTERS: FishSceneFilters = {
  status: "all",
  cluster: "all",
  terminalAction: "all",
};

export function FishOperatorView({ swarmId }: { swarmId: string }) {
  const { data: status } = useOperatorSwarmStatusQuery(swarmId);
  const { data: clusters } = useOperatorSwarmClustersQuery(swarmId);
  const { data: terminals } = useOperatorSwarmTerminalsQuery(swarmId);

  const [selectedFishIndex, setSelectedFishIndexRaw] = useState<number | null>(null);
  const [selectedTurnIndex, setSelectedTurnIndex] = useState<number | null>(null);
  const [hoveredFishIndex, setHoveredFishIndex] = useState<number | null>(null);
  const [filters, setFilters] = useState<FishSceneFilters>(DEFAULT_FILTERS);
  const [timelineProgress, setTimelineProgress] = useState(1);

  const setSelectedFishIndex = useCallback((next: number | null) => {
    setSelectedFishIndexRaw(next === null || next < 0 ? null : next);
  }, []);

  useEffect(() => {
    setSelectedTurnIndex(null);
  }, [selectedFishIndex]);

  const sceneModel = useMemo(() => {
    if (!status) return null;
    const input: FishSceneInput = {
      status,
      clusters,
      terminals: terminals ?? [],
      selectedFishIndex,
      filters,
    };
    return buildFishSceneModel(input);
  }, [status, clusters, terminals, selectedFishIndex, filters]);

  const plotContainerRef = useRef<HTMLDivElement | null>(null);
  const [size, setSize] = useState<{ width: number; height: number }>({ width: 800, height: 600 });

  useLayoutEffect(() => {
    const node = plotContainerRef.current;
    if (!node) return;
    const measure = () => {
      const rect = node.getBoundingClientRect();
      setSize({ width: Math.max(320, rect.width), height: Math.max(240, rect.height) });
    };
    measure();
    const observer = typeof ResizeObserver !== "undefined" ? new ResizeObserver(measure) : null;
    if (observer) observer.observe(node);
    window.addEventListener("resize", measure);
    return () => {
      observer?.disconnect();
      window.removeEventListener("resize", measure);
    };
  }, []);

  const handleClearAll = useCallback(() => {
    setSelectedFishIndexRaw(null);
    setSelectedTurnIndex(null);
    setFilters(DEFAULT_FILTERS);
  }, []);

  const handleSelectCluster = useCallback((label: string) => {
    setFilters((prev) => ({
      ...prev,
      cluster: prev.cluster === label ? "all" : label,
    }));
  }, []);

  return (
    <div
      className="grid h-full w-full grid-cols-1 gap-3 bg-[#FAFAF7] p-3 text-slate-900 lg:grid-cols-[240px_minmax(0,1fr)_340px] lg:gap-4 lg:p-4"
      style={{ fontFamily: "ui-sans-serif, system-ui, Inter, sans-serif" }}
    >
      <aside
        className="order-2 overflow-y-auto lg:order-1"
      >
        <div className="flex flex-col gap-3">
          <FishFiltersPanel
            swarmId={swarmId}
            model={sceneModel}
            filters={filters}
            onFiltersChange={setFilters}
            onClearAll={handleClearAll}
          />
          <FishEvidencePanel swarmId={swarmId} />
        </div>
      </aside>

      <main
        ref={plotContainerRef}
        className="relative order-1 min-h-[420px] overflow-hidden bg-[#F8FAFC] lg:order-2 lg:min-h-0"
      >
        <FishSwarmPlot
          model={sceneModel}
          width={size.width}
          height={size.height}
          selectedFishIndex={selectedFishIndex}
          hoveredFishIndex={hoveredFishIndex}
          timelineProgress={timelineProgress}
          onSelectFish={setSelectedFishIndex}
          onHoverFish={setHoveredFishIndex}
          onSelectCluster={handleSelectCluster}
          onTimelineProgressChange={setTimelineProgress}
        />
      </main>

      <aside
        className="order-3 flex flex-col gap-3 overflow-y-auto"
      >
        <FishInspectorPanel
          swarmId={swarmId}
          model={sceneModel}
          selectedFishIndex={selectedFishIndex}
          selectedTurnIndex={selectedTurnIndex}
          onSelectFish={setSelectedFishIndex}
          onSelectTurn={setSelectedTurnIndex}
          filters={filters}
        />
        <FishAskPanel
          swarmId={swarmId}
          model={sceneModel}
          selectedFishIndex={selectedFishIndex}
          filters={filters}
        />
      </aside>
    </div>
  );
}
