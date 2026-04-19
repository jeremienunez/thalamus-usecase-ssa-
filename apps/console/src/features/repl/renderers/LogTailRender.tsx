import { clsx } from "clsx";
import { AnimatedStepBadge } from "@/shared/ui/AnimatedStepBadge";
import type { DispatchResult, LogEvent } from "@/lib/repl";

const LEVEL_COLOR: Record<LogEvent["level"], string> = {
  debug: "text-dim",
  info: "text-muted",
  warn: "text-amber",
  error: "text-hot",
};

export function LogTailRender({ r }: { r: Extract<DispatchResult, { kind: "logs" }> }) {
  return (
    <div className="flex flex-col gap-0.5 border border-hairline bg-elevated p-2">
      <div className="mono text-caption text-muted">logs · {r.events.length} events</div>
      {r.events.map((e, i) => (
        <div key={i} className="mono flex items-center gap-2 text-caption">
          {e.step ? (
            <AnimatedStepBadge step={e.step} phase={e.phase ?? "progress"} />
          ) : (
            <span className="w-5" />
          )}
          <span className="text-dim">{e.time.slice(11, 19)}</span>
          <span className={clsx(LEVEL_COLOR[e.level], "uppercase")}>{e.level}</span>
          <span className="text-field">{e.service}</span>
          <span className="text-primary">{e.msg}</span>
        </div>
      ))}
    </div>
  );
}
