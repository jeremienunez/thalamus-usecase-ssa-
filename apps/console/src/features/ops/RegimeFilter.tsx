import { clsx } from "clsx";

/**
 * Regime visibility toggle. The GEO belt at 42 000 km screens everything
 * behind it from a "pull-back" camera. Letting the operator hide regimes
 * is the standard SSA workflow to regain situational overview.
 */
export type RegimeKey = "LEO" | "MEO" | "GEO" | "HEO";
export type TrailMode = "off" | "tails" | "full";

const REGIMES: Array<{ key: RegimeKey; label: string; tone: string }> = [
  { key: "LEO", label: "LEO", tone: "text-primary" },
  { key: "MEO", label: "MEO", tone: "text-cyan" },
  { key: "GEO", label: "GEO", tone: "text-cold" },
  { key: "HEO", label: "HEO", tone: "text-amber" },
];

const TRAIL_OPTIONS: Array<{ key: TrailMode; label: string }> = [
  { key: "off", label: "OFF" },
  { key: "tails", label: "TAILS" },
  { key: "full", label: "FULL" },
];

export function RegimeFilter({
  visible,
  onToggle,
  counts,
  trailMode,
  onTrailMode,
}: {
  visible: Record<RegimeKey, boolean>;
  onToggle: (key: RegimeKey) => void;
  counts: Partial<Record<RegimeKey, number>>;
  trailMode?: TrailMode;
  onTrailMode?: (m: TrailMode) => void;
}) {
  return (
    <div className="pointer-events-auto border border-hairline bg-panel/90 backdrop-blur-sm">
      <div className="flex items-center gap-2 border-b border-hairline px-3 py-1.5">
        <div className="h-1.5 w-1.5 bg-cyan" />
        <div className="label text-nano">REGIMES</div>
        {trailMode !== undefined && onTrailMode && (
          <>
            <span className="ml-3 label text-nano text-dim">TRAILS</span>
            <div className="flex">
              {TRAIL_OPTIONS.map((opt) => {
                const on = trailMode === opt.key;
                return (
                  <button
                    key={opt.key}
                    type="button"
                    onClick={() => onTrailMode(opt.key)}
                    className={clsx(
                      "border-l border-hairline px-2 py-0.5 mono text-nano first:border-l-0",
                      on ? "bg-active text-cyan" : "text-muted hover:bg-hairline/40",
                    )}
                  >
                    {opt.label}
                  </button>
                );
              })}
            </div>
          </>
        )}
      </div>
      <div className="flex">
        {REGIMES.map(({ key, label, tone }) => {
          const on = visible[key] ?? true;
          return (
            <button
              key={key}
              type="button"
              onClick={() => onToggle(key)}
              className={clsx(
                "flex flex-col gap-0.5 border-l border-hairline px-3 py-1.5 text-left first:border-l-0 hover:bg-hairline/40",
                !on && "opacity-40",
              )}
            >
              <span className={clsx("label text-nano", tone)}>{label}</span>
              <span className="mono text-nano text-dim">
                {counts[key] ?? 0}
              </span>
            </button>
          );
        })}
      </div>
    </div>
  );
}
