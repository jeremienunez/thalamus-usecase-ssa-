import { HudPanel } from "@/shared/ui/HudPanel";
import { Measure } from "@/shared/ui/Measure";
import { fmtPcCompact, fmtRangeKm, fmtVelocity } from "@/shared/types/units";
import type { ConjunctionDto } from "@/dto/http";

type Props = {
  threats: ConjunctionDto[];
  selectedThreatId?: number | null;
  onSelectThreat?: (threat: ConjunctionDto) => void;
  onFocusSatellite?: (satelliteId: number, threat: ConjunctionDto) => void;
};

function severityOf(pc: number): "hot" | "amber" | "dim" {
  if (pc >= 1e-4) return "hot";
  if (pc >= 1e-6) return "amber";
  return "dim";
}

const fmtPcInline = (pc: number) => fmtPcCompact(pc)[0];

export function ThreatBoardPanel({
  threats,
  selectedThreatId = null,
  onSelectThreat,
  onFocusSatellite,
}: Props) {
  return (
    <HudPanel
      className="absolute right-4 top-4 z-hud w-[22rem] pointer-events-auto"
      title="THREAT BOARD"
      dot="hot"
      meta={`TOP ${threats.length}`}
    >
      {threats.length === 0 ? (
        <div className="px-3 py-3 text-caption text-dim">— no events —</div>
      ) : (
        <ul className="divide-y divide-hairline">
          {threats.map((c) => {
            const severity = severityOf(c.probabilityOfCollision);
            const active = c.id === selectedThreatId;
            const severityColor =
              severity === "hot"
                ? "bg-hot"
                : severity === "amber"
                  ? "bg-amber"
                  : "bg-dim";
            const pcColorClass =
              severity === "hot"
                ? "text-hot"
                : severity === "amber"
                ? "text-amber"
                  : "text-muted";
            return (
              <li key={c.id}>
                <div
                  role={onSelectThreat ? "button" : undefined}
                  tabIndex={onSelectThreat ? 0 : undefined}
                  aria-label={
                    onSelectThreat
                      ? `Focus conjunction ${c.primaryName} to ${c.secondaryName}`
                      : undefined
                  }
                  onClick={() => onSelectThreat?.(c)}
                  onKeyDown={(e) => {
                    if (!onSelectThreat) return;
                    if (e.key !== "Enter" && e.key !== " ") return;
                    e.preventDefault();
                    onSelectThreat(c);
                  }}
                  className={`flex w-full items-center gap-2 px-3 py-1.5 text-left transition-colors duration-fast ease-palantir ${
                    active
                      ? "bg-active"
                      : onSelectThreat
                        ? "hover:bg-active/60 cursor-pointer"
                        : ""
                  }`}
                >
                  <span className={`h-1.5 w-1.5 shrink-0 ${severityColor}`} />
                  <div className="flex min-w-0 flex-1 flex-col">
                    <div className="flex items-center gap-1 truncate text-caption text-primary">
                      <button
                        type="button"
                        onClick={(e) => {
                          e.stopPropagation();
                          onFocusSatellite?.(c.primaryId, c);
                        }}
                        className={onFocusSatellite ? "truncate hover:underline cursor-pointer" : "truncate"}
                        aria-label={`Focus satellite ${c.primaryName}`}
                      >
                        {c.primaryName}
                      </button>
                      <span className="text-dim">→</span>
                      <button
                        type="button"
                        onClick={(e) => {
                          e.stopPropagation();
                          onFocusSatellite?.(c.secondaryId, c);
                        }}
                        className={onFocusSatellite ? "truncate hover:underline cursor-pointer" : "truncate"}
                        aria-label={`Focus satellite ${c.secondaryName}`}
                      >
                        {c.secondaryName}
                      </button>
                    </div>
                    <div className="mono flex items-center gap-2 text-nano text-dim tabular-nums">
                      <Measure value={fmtRangeKm(c.minRangeKm)} className="text-nano" />
                      <span className="text-hairline-hot">·</span>
                      <Measure
                        value={fmtVelocity(c.relativeVelocityKmps)}
                        className="text-nano"
                      />
                    </div>
                    <div className="mono text-nano text-dim">
                      {c.regime} · σ{c.covarianceQuality} · {c.action.replace(/_/g, " ")}
                    </div>
                  </div>
                  <span className={`mono text-micro tabular-nums ${pcColorClass}`}>
                    {fmtPcInline(c.probabilityOfCollision)}
                  </span>
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </HudPanel>
  );
}
