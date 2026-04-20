import { Canvas } from "@react-three/fiber";
import { OrbitControls, Stars, Environment } from "@react-three/drei";
import { useRef, useState, useEffect, useMemo } from "react";
import { Pause, Play } from "lucide-react";
import { useUtcClock } from "@/hooks/useUtcClock";
import { useTimeControl, TIME_SPEEDS } from "@/hooks/useTimeControl";
import { useRegimeFilter } from "@/hooks/useRegimeFilter";
import { useThreatBoard } from "@/hooks/useThreatBoard";
import { MetricTile, MetricTilePlaceholder } from "@/shared/ui/MetricTile";
import { fmtPcCompact, fmtRangeKm, fmtVelocity } from "@/shared/types/units";
import { Measure } from "@/shared/ui/Measure";
import { HudPanel } from "@/shared/ui/HudPanel";
import { Globe } from "./Globe";
import { SatelliteField } from "./SatelliteField";
import { ConjunctionArcs } from "./ConjunctionArcs";
import { ConjunctionMarkers } from "./ConjunctionMarkers";
import { PostFx } from "./PostFx";
import { OpsDrawer } from "./OpsDrawer";
import { SatelliteSearch } from "./SatelliteSearch";
import { CameraFocus } from "./CameraFocus";
import { CycleLaunchPanel } from "./CycleLaunchPanel";
import { FindingsPanel } from "./FindingsPanel";
import { RegimeFilter, type RegimeKey, type TrailMode } from "./RegimeFilter";
import { OrbitTrails, type RegimeFilterKey } from "./OrbitTrails";
import { useSatellitesQuery } from "@/usecases/useSatellitesQuery";
import { useConjunctionsQuery } from "@/usecases/useConjunctionsQuery";
import { useUiStore } from "@/shared/ui/uiStore";
import { useOpsFilterStore } from "./opsFilterStore";
import type { SatelliteDTO } from "@/shared/types";

const SPEEDS = TIME_SPEEDS;
const SPEED_LABELS = ["1×", "1m", "10m", "1h"];
const SPEED_FULL = ["REAL-TIME", "1 MIN / S", "10 MIN / S", "1 H / S"];

const fmtPcInline = (pc: number) => fmtPcCompact(pc)[0];

function severityOf(pc: number): "hot" | "amber" | "dim" {
  if (pc >= 1e-4) return "hot";
  if (pc >= 1e-6) return "amber";
  return "dim";
}

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
  const openDrawer = useUiStore((s) => s.openDrawer);
  const { utc, date } = useUtcClock();

  const { data: satData, isLoading: loadingSats } = useSatellitesQuery();
  const pcThresholdExp = useOpsFilterStore((s) => s.pcThresholdExp);
  const { data: cjData } = useConjunctionsQuery(Math.pow(10, pcThresholdExp));

  const satellites = satData?.items ?? [];
  const conjunctions = cjData?.items ?? [];
  const satellitesById = useMemo(() => {
    const m = new Map<number, typeof satellites[number]>();
    for (const s of satellites) m.set(s.id, s);
    return m;
  }, [satellites]);
  const [hoveredCjId, setHoveredCjId] = useState<string | null>(null);
  const [selectedCjId, setSelectedCjId] = useState<string | null>(null);

  const { threats, highCount, peakPc, labelIds } = useThreatBoard(conjunctions);

  const handleSelect = (id: number) => {
    setSelectedId(id);
    openDrawer(`sat:${id}`);
  };

  const [focusId, setFocusId] = useState<number | null>(null);
  const orbitControlsRef = useRef<any>(null);

  const {
    regimeVisible,
    toggleRegime,
    trailMode,
    setTrailMode,
    orbitRegimeFilter,
    filteredSats,
    regimeCounts,
  } = useRegimeFilter(satellites);

  const handleSearchPick = (sat: SatelliteDTO) => {
    setSelectedId(sat.id);
    openDrawer(`sat:${sat.id}`);
    // Bump the focus key each time so picking the same sat twice re-triggers.
    setFocusId(sat.id);
  };

  const { speedIdx, paused, effectiveSpeed, togglePause, selectSpeed } = useTimeControl(1);

  return (
    <div className="relative h-full w-full overflow-hidden">
      <Canvas
        camera={{ position: [0, 2, 5], fov: 40, near: 0.01, far: 100 }}
        dpr={[1, 1.5]}
      >
        <color attach="background" args={["#0A0E14"]} />
        <ambientLight intensity={0.3} />
        <directionalLight position={[5, 3, 5]} intensity={0.9} castShadow />
        <directionalLight position={[-5, -3, -5]} intensity={0.2} color="#60A5FA" />
        <Environment preset="city" />
        <Stars radius={50} depth={30} count={2000} factor={2} fade speed={0.5} />
        <Globe />
        {filteredSats.length > 0 && (
          <>
            <SatelliteField
              satellites={filteredSats}
              selectedId={selectedId}
              onSelect={handleSelect}
              timeScale={effectiveSpeed ?? 1}
              labelIds={labelIds}
            />
            <OrbitTrails
              satellites={filteredSats}
              regimeFilter={orbitRegimeFilter}
              trailMode={trailMode}
              timeScale={effectiveSpeed ?? 1}
            />
            <ConjunctionArcs
              satellites={filteredSats}
              conjunctions={conjunctions}
              timeScale={effectiveSpeed ?? 1}
            />
            <ConjunctionMarkers
              conjunctions={conjunctions}
              satellitesById={satellitesById}
              hoveredId={hoveredCjId}
              selectedId={selectedCjId}
              timeScale={effectiveSpeed ?? 1}
              onHover={setHoveredCjId}
              onSelect={setSelectedCjId}
            />
          </>
        )}
        <OrbitControls
          ref={orbitControlsRef}
          enablePan={false}
          minDistance={2.6}
          maxDistance={15}
          rotateSpeed={0.4}
          zoomSpeed={0.6}
        />
        <CameraFocus
          focusId={focusId}
          satellites={satellites}
          orbitControlsRef={orbitControlsRef}
          timeScale={effectiveSpeed ?? 1}
          onDone={() => setFocusId(null)}
        />
        <PostFx />
      </Canvas>

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
      <HudPanel
        className="absolute left-4 top-4 z-hud"
        passthrough
        title={paused ? "TELEMETRY · PAUSED" : "LIVE TELEMETRY"}
        dot={paused ? "amber" : "cold"}
        live={!paused}
        meta="SSA / OPS"
      >
        <div className="flex">
          {loadingSats ? (
            <MetricTilePlaceholder label="TRACKED" />
          ) : (
            <MetricTile label="TRACKED" value={satellites.length} accent="primary" />
          )}
          <MetricTile
            label="CONJUNCTIONS"
            value={conjunctions.length}
            accent="cyan"
          />
          <MetricTile
            label="≥ 1e-4"
            value={highCount}
            accent={highCount > 0 ? "hot" : "primary"}
          />
          <MetricTile
            label="PEAK PC"
            value={peakPc}
            display={fmtPcInline}
            accent={peakPc >= 1e-4 ? "hot" : peakPc >= 1e-6 ? "amber" : "primary"}
          />
        </div>
      </HudPanel>

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
      <HudPanel
        className="absolute right-4 top-4 z-hud w-[22rem]"
        passthrough
        title="THREAT BOARD"
        dot="hot"
        meta={`TOP ${threats.length}`}
      >
        {threats.length === 0 ? (
          <div className="px-3 py-3 text-caption text-dim">— no events —</div>
        ) : (
          <ul className="divide-y divide-hairline">
            {threats.map((c) => {
              const sev = severityOf(c.probabilityOfCollision);
              const sevColor =
                sev === "hot" ? "bg-hot" : sev === "amber" ? "bg-amber" : "bg-dim";
              const pcColorCls =
                sev === "hot" ? "text-hot" : sev === "amber" ? "text-amber" : "text-muted";
              return (
                <li key={c.id} className="flex items-center gap-2 px-3 py-1.5">
                  <span className={`h-1.5 w-1.5 shrink-0 ${sevColor}`} />
                  <div className="flex min-w-0 flex-1 flex-col">
                    <div className="flex items-center gap-1 truncate text-caption text-primary">
                      <span className="truncate">{c.primaryName}</span>
                      <span className="text-dim">→</span>
                      <span className="truncate">{c.secondaryName}</span>
                    </div>
                    <div className="mono flex items-center gap-2 text-nano text-dim tabular-nums">
                      <Measure value={fmtRangeKm(c.minRangeKm)} className="text-nano" />
                      <span className="text-hairline-hot">·</span>
                      <Measure value={fmtVelocity(c.relativeVelocityKmps)} className="text-nano" />
                    </div>
                    <div className="mono text-nano text-dim">
                      {c.regime} · σ{c.covarianceQuality} · {c.action.replace(/_/g, " ")}
                    </div>
                  </div>
                  <span className={`mono text-micro tabular-nums ${pcColorCls}`}>
                    {fmtPcInline(c.probabilityOfCollision)}
                  </span>
                </li>
              );
            })}
          </ul>
        )}
      </HudPanel>

      {/* Bottom-left: UTC clock + legend + cycle launcher (stacked) */}
      <div className="pointer-events-none absolute bottom-4 left-4 z-hud flex max-h-[calc(100vh-8rem)] flex-col gap-2 overflow-y-auto">
        <HudPanel>
          <div className="px-3 py-2">
            <div className="label text-nano">UTC</div>
            <div className="mono text-h1 leading-none text-primary tabular-nums">{utc}</div>
            <div className="mono text-nano text-dim tabular-nums">{date}</div>
          </div>
        </HudPanel>
        <HudPanel>
          <div className="px-3 py-2">
            <div className="label mb-1 text-nano">LEGEND</div>
            <div className="mono mb-0.5 text-nano uppercase tracking-widest text-dim">
              arcs · P(C)
            </div>
            <div className="flex flex-col gap-0.5">
              <div className="flex items-center gap-2">
                <span className="h-[2px] w-5 bg-hot" />
                <span className="mono text-nano text-muted">≥ 1e-4 high</span>
              </div>
              <div className="flex items-center gap-2">
                <span className="h-[2px] w-5 bg-amber" />
                <span className="mono text-nano text-muted">≥ 1e-6 watch</span>
              </div>
              <div className="flex items-center gap-2">
                <span className="h-[2px] w-5 bg-dim" />
                <span className="mono text-nano text-muted">&lt; 1e-6 nominal</span>
              </div>
            </div>
            <div className="mono mb-0.5 mt-1.5 text-nano uppercase tracking-widest text-dim">
              dots · regime
            </div>
            <div className="grid grid-cols-2 gap-x-3 gap-y-0.5">
              {[
                { k: "LEO", c: "bg-osint" },
                { k: "MEO", c: "bg-field" },
                { k: "GEO", c: "bg-cold" },
                { k: "HEO", c: "bg-amber" },
              ].map((r) => (
                <div key={r.k} className="flex items-center gap-2">
                  <span className={`h-1.5 w-1.5 ${r.c}`} />
                  <span className="mono text-nano text-muted">{r.k}</span>
                </div>
              ))}
            </div>
          </div>
        </HudPanel>
        <div className="pointer-events-auto">
          <CycleLaunchPanel />
        </div>
      </div>

      {/* Bottom-center: segmented time controller */}
      <HudPanel
        className="absolute bottom-4 left-1/2 z-hud -translate-x-1/2"
        title="TIME CONTROL"
        meta={
          <span className="text-cyan tabular-nums">
            {paused ? "PAUSED" : SPEED_FULL[speedIdx]}
          </span>
        }
      >
        <div className="flex items-stretch">
          <button
            aria-label={paused ? "Play" : "Pause"}
            onClick={togglePause}
            className="flex h-9 w-9 items-center justify-center border-r border-hairline text-cyan transition-colors duration-fast ease-palantir hover:bg-hover cursor-pointer"
          >
            {paused ? <Play size={14} strokeWidth={1.5} /> : <Pause size={14} strokeWidth={1.5} />}
          </button>
          {SPEEDS.map((_, i) => {
            const active = !paused && i === speedIdx;
            return (
              <button
                key={i}
                aria-label={`Speed ${SPEED_FULL[i]}`}
                onClick={() => selectSpeed(i)}
                className={`relative flex h-9 w-11 items-center justify-center border-r border-hairline mono text-caption tabular-nums transition-colors duration-fast ease-palantir cursor-pointer last:border-r-0 ${
                  active
                    ? "bg-active text-cyan"
                    : "text-muted hover:bg-hover hover:text-primary"
                }`}
              >
                {SPEED_LABELS[i]}
                {active && <span className="absolute inset-x-0 top-0 h-[2px] bg-cyan" />}
              </button>
            );
          })}
        </div>
      </HudPanel>

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
      />
    </div>
  );
}
