import type { DispatchResult, TelemetryEntry } from "@/types/repl-turn";

export function TelemetryRender({ r }: { r: Extract<DispatchResult, { kind: "telemetry" }> }) {
  const max = Math.max(...r.distribution.map((d) => Math.abs(d.p95 - d.p5))) || 1;
  return (
    <div className="flex flex-col gap-1 border border-hairline bg-elevated p-2">
      <div className="mono text-caption text-muted">
        telemetry · {r.satName} <span className="text-dim">· NORAD {r.satId}</span>
      </div>
      <div className="flex flex-col gap-0.5">
        {r.distribution.map((e: TelemetryEntry) => {
          const spread = Math.abs(e.p95 - e.p5);
          const barLen = Math.max(1, Math.round((spread / max) * 24));
          return (
            <div
              key={e.name}
              className="mono grid grid-cols-[260px_1fr_100px_160px] gap-2 text-caption"
            >
              <span className="text-primary">{e.name}</span>
              <span className="text-cyan">{"█".repeat(barLen)}</span>
              <span className="text-numeric">
                {e.median} <span className="text-dim">{e.unit}</span>
              </span>
              <span className="text-dim">
                [{e.p5} .. {e.p95}]
              </span>
            </div>
          );
        })}
      </div>
    </div>
  );
}
