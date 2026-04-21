import { HudPanel } from "@/shared/ui/HudPanel";
import { Measure } from "@/shared/ui/Measure";
import { fmtPcCompact, fmtRangeKm, fmtVelocity } from "@/shared/types/units";
import type { ConjunctionDTO } from "@/transformers/http";

type Props = {
  threats: ConjunctionDTO[];
};

function severityOf(pc: number): "hot" | "amber" | "dim" {
  if (pc >= 1e-4) return "hot";
  if (pc >= 1e-6) return "amber";
  return "dim";
}

const fmtPcInline = (pc: number) => fmtPcCompact(pc)[0];

export function ThreatBoardPanel({ threats }: Props) {
  return (
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
            const severity = severityOf(c.probabilityOfCollision);
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
              <li key={c.id} className="flex items-center gap-2 px-3 py-1.5">
                <span className={`h-1.5 w-1.5 shrink-0 ${severityColor}`} />
                <div className="flex min-w-0 flex-1 flex-col">
                  <div className="flex items-center gap-1 truncate text-caption text-primary">
                    <span className="truncate">{c.primaryName}</span>
                    <span className="text-dim">→</span>
                    <span className="truncate">{c.secondaryName}</span>
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
              </li>
            );
          })}
        </ul>
      )}
    </HudPanel>
  );
}
