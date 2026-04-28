import type {
  TemporalProgressEvent,
  TemporalProgressReporter,
} from "@interview/temporal";

export interface ConsoleEtaReporterOptions {
  enabled?: boolean;
  stream?: Pick<NodeJS.WriteStream, "write">;
}

export function createConsoleEtaReporter(
  options: ConsoleEtaReporterOptions = {},
): TemporalProgressReporter | undefined {
  if (options.enabled === false) return undefined;
  const stream = options.stream ?? process.stderr;
  const phaseStartedAt = new Map<string, number>();

  return (event) => {
    if (event.status === "started") {
      phaseStartedAt.set(event.phase, Date.now());
    }
    const line = formatProgressLine(event, phaseStartedAt.get(event.phase));
    stream.write(`${line}\n`);
  };
}

export function formatProgressLine(
  event: TemporalProgressEvent,
  wallStartedAt?: number,
): string {
  const progress = formatProgress(event.completed, event.total);
  const elapsed = formatDuration(event.elapsed_ms);
  const eta = event.eta_ms == null ? "eta ?" : `eta ${formatDuration(event.eta_ms)}`;
  const rate =
    event.rate_per_sec == null ? "" : ` rate ${event.rate_per_sec.toFixed(2)}/s`;
  const counters = formatCounters(event.counters);
  const wallElapsed =
    wallStartedAt == null ? "" : ` wall ${formatDuration(Date.now() - wallStartedAt)}`;
  return [
    `[eval] ${event.status}`,
    event.phase,
    progress,
    `elapsed ${elapsed}`,
    eta,
    rate.trim(),
    counters,
    wallElapsed.trim(),
  ]
    .filter(Boolean)
    .join(" | ");
}

export function formatDuration(ms: number): string {
  const totalSeconds = Math.max(0, Math.round(ms / 1_000));
  const hours = Math.floor(totalSeconds / 3_600);
  const minutes = Math.floor((totalSeconds % 3_600) / 60);
  const seconds = totalSeconds % 60;
  if (hours > 0) return `${hours}h${pad(minutes)}m${pad(seconds)}s`;
  if (minutes > 0) return `${minutes}m${pad(seconds)}s`;
  return `${seconds}s`;
}

function formatProgress(completed?: number, total?: number): string {
  if (completed == null) return "";
  if (total == null) return `${completed}`;
  const percent = total <= 0 ? 100 : Math.min(100, (completed / total) * 100);
  return `${completed}/${total} ${percent.toFixed(1)}%`;
}

function formatCounters(
  counters?: TemporalProgressEvent["counters"],
): string {
  if (!counters) return "";
  return Object.entries(counters)
    .map(([key, value]) => `${key}=${value}`)
    .join(" ");
}

function pad(value: number): string {
  return String(value).padStart(2, "0");
}
