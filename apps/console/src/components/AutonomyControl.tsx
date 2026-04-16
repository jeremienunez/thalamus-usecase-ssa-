import { useState } from "react";
import { Play, Square, Activity, ChevronUp, ChevronDown } from "lucide-react";
import { clsx } from "clsx";
import {
  useAutonomyStatus,
  useAutonomyStart,
  useAutonomyStop,
  useStats,
  useSweepSuggestions,
} from "@/lib/queries";
import type { AutonomyTickDTO } from "@/lib/api";

const ACTION_COLOR: Record<AutonomyTickDTO["action"], string> = {
  thalamus: "text-cyan",
  "sweep-nullscan": "text-amber",
  "fish-swarm": "text-magenta",
};

const ACTION_LABEL: Record<AutonomyTickDTO["action"], string> = {
  thalamus: "THALAMUS",
  "sweep-nullscan": "SWEEP · nullScan",
  "fish-swarm": "SWEEP · briefing",
};

export function AutonomyControl() {
  const { data: state } = useAutonomyStatus();
  const { data: stats } = useStats();
  const { data: sugg } = useSweepSuggestions();
  const start = useAutonomyStart();
  const stop = useAutonomyStop();
  const [open, setOpen] = useState(false);

  const running = state?.running ?? false;
  const current = state?.currentTick;
  const history = state?.history ?? [];
  const ticks = state?.tickCount ?? 0;

  const toggle = () => {
    if (running) stop.mutate();
    else start.mutate(60);
  };

  return (
    <>
      {/* Compact pill in top bar */}
      <button
        onClick={toggle}
        disabled={start.isPending || stop.isPending}
        className={clsx(
          "flex h-6 items-center gap-2 border px-2 text-label transition-colors duration-fast ease-palantir cursor-pointer",
          running
            ? "border-cold/60 bg-cold/10 text-cold hover:bg-cold/20"
            : "border-hairline bg-panel text-muted hover:text-primary",
        )}
        title={running ? "Stop autonomous loop" : "Start autonomous loop"}
      >
        {running ? (
          <>
            <span className="relative flex h-1.5 w-1.5">
              <span className="absolute inline-flex h-full w-full animate-ping bg-cold opacity-75" />
              <span className="relative inline-flex h-1.5 w-1.5 bg-cold" />
            </span>
            <span>AUTONOMY</span>
            <span className="mono text-numeric tabular-nums">{ticks}</span>
            <Square size={10} strokeWidth={2} />
          </>
        ) : (
          <>
            <Activity size={10} strokeWidth={2} />
            <span>AUTONOMY OFF</span>
            <Play size={10} strokeWidth={2} />
          </>
        )}
      </button>

      {/* Expandable feed */}
      <button
        onClick={() => setOpen((v) => !v)}
        className="flex h-6 items-center gap-1 border border-hairline bg-panel px-2 text-label text-muted hover:text-primary transition-colors cursor-pointer"
        title={open ? "Hide feed" : "Show feed"}
      >
        FEED
        {open ? <ChevronDown size={10} /> : <ChevronUp size={10} />}
      </button>

      {open && (
        <div className="absolute right-3 top-11 z-50 w-[480px] border border-hairline-hot bg-elevated shadow-lg">
          <div className="flex h-8 items-center justify-between border-b border-hairline px-3">
            <span className="label text-primary">AUTONOMY FEED</span>
            <span className="mono text-caption text-dim tabular-nums">
              {running ? `tick ${ticks} · every ${Math.round((state?.intervalMs ?? 0) / 1000)}s` : "idle"}
            </span>
          </div>

          {/* Live counters — these move when autonomy writes */}
          <div className="grid grid-cols-3 border-b border-hairline">
            <Stat label="FINDINGS" value={stats?.findings ?? 0} tone="cyan" />
            <Stat label="SUGGESTIONS" value={sugg?.count ?? 0} tone="amber" />
            <Stat label="KG EDGES" value={stats?.kgEdges ?? 0} tone="cold" />
          </div>

          {current && (
            <div className="border-b border-hairline bg-base/60 px-3 py-2">
              <div className="flex items-center gap-2">
                <span className="relative flex h-1.5 w-1.5">
                  <span className="absolute inline-flex h-full w-full animate-ping bg-cyan opacity-75" />
                  <span className="relative inline-flex h-1.5 w-1.5 bg-cyan" />
                </span>
                <span className={clsx("label", ACTION_COLOR[current.action])}>
                  {ACTION_LABEL[current.action]}
                </span>
                <span className="mono text-caption text-dim">running…</span>
              </div>
              <div className="mt-1 mono text-caption text-muted line-clamp-2">
                {current.queryOrMode}
              </div>
            </div>
          )}

          <ul className="max-h-[300px] overflow-y-auto divide-y divide-hairline">
            {history.length === 0 && !current && (
              <li className="px-3 py-6 text-center text-caption text-dim">
                {running ? "warming up…" : "start the loop to see ticks stream"}
              </li>
            )}
            {history.map((t) => {
              const elapsed = Math.max(
                0,
                new Date(t.completedAt).getTime() - new Date(t.startedAt).getTime(),
              );
              return (
                <li key={t.id} className="px-3 py-1.5">
                  <div className="flex items-center gap-2">
                    <span className={clsx("label", ACTION_COLOR[t.action])}>
                      {ACTION_LABEL[t.action]}
                    </span>
                    <span className="mono text-caption text-dim tabular-nums">
                      +{t.emitted}
                    </span>
                    <span className="ml-auto mono text-caption text-dim tabular-nums">
                      {(elapsed / 1000).toFixed(1)}s
                    </span>
                  </div>
                  <div className="mono text-caption text-muted line-clamp-1">
                    {t.queryOrMode}
                  </div>
                  {t.error && (
                    <div className="mono text-caption text-hot line-clamp-1">
                      ⚠ {t.error}
                    </div>
                  )}
                </li>
              );
            })}
          </ul>
        </div>
      )}
    </>
  );
}

function Stat({ label, value, tone }: { label: string; value: number; tone: "cyan" | "amber" | "cold" }) {
  const cls = tone === "cyan" ? "text-cyan" : tone === "amber" ? "text-amber" : "text-cold";
  return (
    <div className="flex flex-col items-start border-r border-hairline last:border-r-0 px-3 py-2">
      <span className="label text-dim">{label}</span>
      <span className={clsx("mono text-body tabular-nums", cls)}>{value}</span>
    </div>
  );
}
