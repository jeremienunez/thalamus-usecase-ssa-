import { MetricTile, MetricTilePlaceholder } from "@/shared/ui/MetricTile";
import { HudPanel } from "@/shared/ui/HudPanel";
import { fmtPcCompact } from "@/shared/types/units";

type Props = {
  loadingSats: boolean;
  satelliteCount: number;
  conjunctionCount: number;
  highCount: number;
  peakPc: number;
  paused: boolean;
};

const fmtPcInline = (pc: number) => fmtPcCompact(pc)[0];

export function OpsTelemetryPanel({
  loadingSats,
  satelliteCount,
  conjunctionCount,
  highCount,
  peakPc,
  paused,
}: Props) {
  return (
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
          <MetricTile label="TRACKED" value={satelliteCount} accent="primary" />
        )}
        <MetricTile label="CONJUNCTIONS" value={conjunctionCount} accent="cyan" />
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
  );
}
