import { useMemo, useState } from "react";
import { useTimeControl } from "@/hooks/useTimeControl";
import { useRegimeFilter } from "@/hooks/useRegimeFilter";
import { useThreatBoard } from "@/hooks/useThreatBoard";
import { OpsDrawer } from "./OpsDrawer";
import { SatelliteSearch } from "./SatelliteSearch";
import { FindingsPanel } from "./FindingsPanel";
import { RegimeFilter } from "./RegimeFilter";
import { useSatellitesQuery } from "@/usecases/useSatellitesQuery";
import { useConjunctionsQuery } from "@/usecases/useConjunctionsQuery";
import { useUiStore } from "@/shared/ui/uiStore";
import { useOpsFilterStore } from "./opsFilterStore";
import type { SatelliteDto } from "@/dto/http";
import { OpsScene } from "./OpsScene";
import { OpsTelemetryPanel } from "./OpsTelemetryPanel";
import { ThreatBoardPanel } from "./ThreatBoardPanel";
import { OpsInfoStack } from "./OpsInfoStack";
import { TimeControlPanel } from "./TimeControlPanel";

const SPEED_LABELS = ["1×", "1m", "10m", "1h"];
const SPEED_FULL = ["REAL-TIME", "1 MIN / S", "10 MIN / S", "1 H / S"];

function CornerBracket({ pos }: { pos: "tl" | "tr" | "bl" | "br" }) {
  const base = "pointer-events-none absolute h-4 w-4 border-hairline-hot";
  const cls = {
    tl: "left-2 top-2 border-l border-t",
    tr: "right-2 top-2 border-r border-t",
    bl: "left-2 bottom-2 border-l border-b",
    br: "right-2 bottom-2 border-r border-b",
  }[pos];
  return <div className={`${base} ${cls}`} />;
}

export function OpsEntry() {
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const [selectedConjunctionId, setSelectedConjunctionId] = useState<number | null>(
    null,
  );
  const openDrawer = useUiStore((s) => s.openDrawer);

  const { data: satData, isLoading: loadingSats } = useSatellitesQuery();
  const pcThresholdExp = useOpsFilterStore((s) => s.pcThresholdExp);
  const { data: cjData } = useConjunctionsQuery(Math.pow(10, pcThresholdExp));
  const { data: boardCjData } = useConjunctionsQuery(0);

  const satellites = satData?.items ?? [];
  const conjunctions = cjData?.items ?? [];
  const boardConjunctions = boardCjData?.items ?? conjunctions;
  const satellitesById = useMemo(() => {
    const m = new Map<number, typeof satellites[number]>();
    for (const s of satellites) m.set(s.id, s);
    return m;
  }, [satellites]);

  const { threats, highCount, peakPc, labelIds } = useThreatBoard(boardConjunctions);

  const handleSelect = (id: number) => {
    setSelectedId(id);
    setSelectedConjunctionId(null);
    openDrawer(`sat:${id}`);
  };

  const [focusId, setFocusId] = useState<number | null>(null);

  const {
    regimeVisible,
    toggleRegime,
    trailMode,
    setTrailMode,
    orbitRegimeFilter,
    filteredSats,
    regimeCounts,
  } = useRegimeFilter(satellites);

  const handleSearchPick = (sat: SatelliteDto) => {
    setSelectedId(sat.id);
    setSelectedConjunctionId(null);
    openDrawer(`sat:${sat.id}`);
    // Bump the focus key each time so picking the same sat twice re-triggers.
    setFocusId(sat.id);
  };

  const focusThreatSatellite = (satelliteId: number, conjunctionId: number) => {
    setSelectedId(satelliteId);
    setSelectedConjunctionId(conjunctionId);
    openDrawer(`sat:${satelliteId}`);
    setFocusId(satelliteId);
  };

  const handleSelectThreat = (threat: (typeof threats)[number]) => {
    focusThreatSatellite(threat.primaryId, threat.id);
  };

  const { speedIdx, paused, effectiveSpeed, togglePause, selectSpeed } = useTimeControl(1);

  return (
    <div className="relative h-full w-full overflow-hidden">
      <OpsScene
        filteredSats={filteredSats}
        satellites={satellites}
        selectedId={selectedId}
        labelIds={labelIds}
        conjunctions={conjunctions}
        satellitesById={satellitesById}
        focusId={focusId}
        trailMode={trailMode}
        orbitRegimeFilter={orbitRegimeFilter}
        effectiveSpeed={effectiveSpeed ?? 1}
        onSelectSatellite={handleSelect}
        onFocusDone={() => setFocusId(null)}
      />

      {/* Vignette + scanline atmosphere */}
      <div
        className="pointer-events-none absolute inset-0"
        style={{
          background:
            "radial-gradient(ellipse at center, transparent 55%, rgba(10,14,20,0.55) 100%)",
        }}
      />
      <CornerBracket pos="tl" />
      <CornerBracket pos="tr" />
      <CornerBracket pos="bl" />
      <CornerBracket pos="br" />

      {/* Top-left: live telemetry card */}
      <OpsTelemetryPanel
        loadingSats={loadingSats}
        satelliteCount={satellites.length}
        conjunctionCount={boardConjunctions.length}
        highCount={highCount}
        peakPc={peakPc}
        paused={paused}
      />

      {/* Top-center: satellite search + regime filter */}
      <div className="absolute left-1/2 top-4 z-hud flex -translate-x-1/2 flex-col items-center gap-2">
        <SatelliteSearch satellites={satellites} onPick={handleSearchPick} />
        <RegimeFilter
          visible={regimeVisible}
          onToggle={toggleRegime}
          counts={regimeCounts}
          trailMode={trailMode}
          onTrailMode={setTrailMode}
        />
      </div>

      {/* Top-right: threat board */}
      <ThreatBoardPanel
        threats={threats}
        selectedThreatId={selectedConjunctionId}
        onSelectThreat={handleSelectThreat}
        onFocusSatellite={(satelliteId, threat) =>
          focusThreatSatellite(satelliteId, threat.id)
        }
      />

      {/* Bottom-left: UTC clock + legend + cycle launcher (stacked) */}
      <OpsInfoStack />

      {/* Bottom-center: segmented time controller */}
      <TimeControlPanel
        paused={paused}
        speedIdx={speedIdx}
        labels={SPEED_LABELS}
        fullLabels={SPEED_FULL}
        onTogglePause={togglePause}
        onSelectSpeed={selectSpeed}
      />

      {/* Bottom-right: findings stream */}
      <div className="absolute bottom-4 right-4 z-hud">
        <FindingsPanel
          satellites={satellites}
          selectedSatellite={
            satellites.find((s) => s.id === selectedId) ?? null
          }
          onFocusSat={handleSearchPick}
        />
      </div>

      <OpsDrawer
        satellite={satellites.find((s) => s.id === selectedId) ?? null}
        conjunctions={conjunctions.filter(
          (c) => c.primaryId === selectedId || c.secondaryId === selectedId,
        )}
        selectedConjunctionId={selectedConjunctionId}
      />
    </div>
  );
}
