import { Play, Square, Activity, ChevronUp, ChevronDown, RotateCcw } from "lucide-react";
import { clsx } from "clsx";
import {
  useAutonomyStatus,
  useAutonomyStart,
  useAutonomyStop,
  useAutonomyReset,
  useStats,
  useSweepSuggestions,
} from "@/usecases";
import type { AutonomyStateDto, AutonomyTickDto } from "@/dto/http";
import { useUiStore } from "@/shared/ui/uiStore";

const ACTION_COLOR: Record<AutonomyTickDto["action"], string> = {
  thalamus: "text-cyan",
  "sweep-nullscan": "text-amber",
  "fish-swarm": "text-magenta",
};

const ACTION_LABEL: Record<AutonomyTickDto["action"], string> = {
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
  const reset = useAutonomyReset();
  const open = useUiStore((s) => s.autonomyFeedOpen);
  const toggleOpen = useUiStore((s) => s.toggleAutonomyFeed);

  const running = state?.running ?? false;
  const current = state?.currentTick;
  const history = state?.history ?? [];
  const ticks = state?.tickCount ?? 0;

  const toggle = () => {
    if (running) stop.mutate();
    else start.mutate(undefined);
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
        onClick={toggleOpen}
        className="flex h-6 items-center gap-1 border border-hairline bg-panel px-2 text-label text-muted hover:text-primary transition-colors cursor-pointer"
        title={open ? "Hide feed" : "Show feed"}
      >
        FEED
        {open ? <ChevronDown size={10} /> : <ChevronUp size={10} />}
      </button>

      {open && (
        <div className="absolute right-3 top-11 z-palette w-[480px] border border-hairline-hot bg-elevated shadow-pop animate-fade-in">
          <div className="flex h-8 items-center justify-between border-b border-hairline px-3">
            <span className="label text-primary">AUTONOMY FEED</span>
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={() => reset.mutate()}
                disabled={reset.isPending}
                className="flex items-center gap-1 border border-hairline px-2 py-0.5 mono text-caption text-muted transition-colors duration-fast ease-palantir hover:border-cyan hover:text-cyan cursor-pointer disabled:cursor-not-allowed disabled:opacity-40"
              >
                <RotateCcw size={11} strokeWidth={1.5} />
                {reset.isPending ? "Resetting…" : "Reset spend"}
              </button>
              <span className="mono text-caption text-dim tabular-nums">
                {running
                  ? `tick ${ticks} · every ${Math.round((state?.intervalMs ?? 0) / 1000)}s`
                  : "idle"}
              </span>
            </div>
          </div>

          <div className="grid grid-cols-2 gap-px border-b border-hairline bg-hairline">
            <TelemetryCell
              label="DAILY SPEND"
              value={formatUsd(state?.dailySpendUsd ?? 0)}
              tone="cyan"
            />
            <TelemetryCell
              label="MONTHLY SPEND"
              value={formatUsd(state?.monthlySpendUsd ?? 0)}
              tone="amber"
            />
            <TelemetryCell
              label="THALAMUS / DAY"
              value={String(state?.thalamusCyclesToday ?? 0)}
              tone="cold"
            />
            <TelemetryCell
              label={running ? "NEXT TICK" : "STOPPED"}
              value={
                running
                  ? formatNextTick(state?.nextTickInMs ?? null)
                  : humanizeStopReason(state?.stoppedReason ?? null)
              }
              tone={running ? "primary" : "muted"}
            />
          </div>

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
                    <span className="mono text-caption text-dim tabular-nums">
                      {formatUsd(t.costUsd)}
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

function formatUsd(value: number): string {
  return `$${value.toFixed(value >= 1 ? 2 : 3)}`;
}

function formatNextTick(value: number | null): string {
  if (value == null) return "pending";
  if (value < 1000) return `${value}ms`;
  return `${(value / 1000).toFixed(value >= 10_000 ? 0 : 1)}s`;
}

function humanizeStopReason(reason: AutonomyStateDto["stoppedReason"]): string {
  switch (reason) {
    case "daily_budget_exhausted":
      return "daily budget exhausted";
    case "monthly_budget_exhausted":
      return "monthly budget exhausted";
    case "max_thalamus_cycles_per_day":
      return "max thalamus cycles reached";
    case "stopped_by_operator":
      return "stopped by operator";
    default:
      return "idle";
  }
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

function TelemetryCell(props: {
  label: string;
  value: string;
  tone: "cyan" | "amber" | "cold" | "primary" | "muted";
}) {
  const cls =
    props.tone === "cyan"
      ? "text-cyan"
      : props.tone === "amber"
        ? "text-amber"
        : props.tone === "cold"
          ? "text-cold"
          : props.tone === "muted"
            ? "text-muted"
            : "text-primary";
  return (
    <div className="bg-elevated px-3 py-2">
      <div className="label text-dim">{props.label}</div>
      <div className={clsx("mono text-caption tabular-nums", cls)}>
        {props.value}
      </div>
    </div>
  );
}
