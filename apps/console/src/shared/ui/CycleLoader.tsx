import { clsx } from "clsx";
import { AnimatedStepBadge } from "./AnimatedStepBadge";
import type { StepName } from "@/shared/types/steps";

export type CycleStep = {
  name: StepName | "unknown";
  phase: "start" | "progress" | "done" | "error";
  terminal: string;
  elapsedMs: number;
};

export function CycleLoader(props: {
  cycleId: string;
  current?: CycleStep;
  trail: CycleStep[];
  elapsedMs: number;
}) {
  const { cycleId, current, trail, elapsedMs } = props;
  return (
    <div className="border-l-2 border-cyan pl-3">
      <div className="mono text-caption text-cyan">
        ▶ cycle <span className="text-primary">{cycleId}</span>
        <span className="ml-2 text-dim">· {(elapsedMs / 1000).toFixed(1)}s</span>
      </div>
      <div className="mt-1 flex flex-col gap-0.5">
        {trail.map((s, i) => (
          <div key={i} className="mono text-caption">
            <span className={clsx(s.phase === "error" ? "text-hot" : "text-cold")}>
              {s.terminal}
            </span>
            <span className="ml-2 text-muted">{s.name}</span>
            <span className="ml-2 text-dim">({(s.elapsedMs / 1000).toFixed(1)}s)</span>
          </div>
        ))}
        {current && current.name !== "unknown" && (
          <div className="mono text-caption">
            <AnimatedStepBadge step={current.name as StepName} phase="progress" />
            <span
              className={clsx(
                "ml-2",
                current.phase === "error" ? "text-hot" : "text-primary",
              )}
            >
              {current.name}
            </span>
            <span className="ml-2 text-dim">…</span>
          </div>
        )}
      </div>
    </div>
  );
}
