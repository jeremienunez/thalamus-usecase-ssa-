import { useUtcClock } from "@/hooks/useUtcClock";
import { HudPanel } from "@/shared/ui/HudPanel";
import { CycleLaunchPanel } from "./CycleLaunchPanel";

export function OpsInfoStack() {
  const { utc, date } = useUtcClock();

  return (
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
            <LegendRow className="bg-hot" label="≥ 1e-4 high" />
            <LegendRow className="bg-amber" label="≥ 1e-6 watch" />
            <LegendRow className="bg-dim" label="< 1e-6 nominal" />
          </div>
          <div className="mono mb-0.5 mt-1.5 text-nano uppercase tracking-widest text-dim">
            dots · regime
          </div>
          <div className="grid grid-cols-2 gap-x-3 gap-y-0.5">
            <LegendDot className="bg-osint" label="LEO" />
            <LegendDot className="bg-field" label="MEO" />
            <LegendDot className="bg-cold" label="GEO" />
            <LegendDot className="bg-amber" label="HEO" />
          </div>
        </div>
      </HudPanel>
      <div className="pointer-events-auto">
        <CycleLaunchPanel />
      </div>
    </div>
  );
}

function LegendRow({ className, label }: { className: string; label: string }) {
  return (
    <div className="flex items-center gap-2">
      <span className={`h-[2px] w-5 ${className}`} />
      <span className="mono text-nano text-muted">{label}</span>
    </div>
  );
}

function LegendDot({ className, label }: { className: string; label: string }) {
  return (
    <div className="flex items-center gap-2">
      <span className={`h-1.5 w-1.5 ${className}`} />
      <span className="mono text-nano text-muted">{label}</span>
    </div>
  );
}
