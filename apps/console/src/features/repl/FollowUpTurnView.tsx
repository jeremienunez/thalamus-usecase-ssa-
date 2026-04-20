import { clsx } from "clsx";
import { AnimatedStepBadge } from "@/shared/ui/AnimatedStepBadge";
import type { FollowUpTurn } from "./reducer";

type Props = {
  followup: FollowUpTurn;
};

export function FollowUpTurnView({ followup }: Props) {
  const isRunning =
    followup.status === "pending" || followup.status === "running";

  return (
    <div className="border-l-2 border-cold pl-3">
      <div className="mono flex items-center gap-2 text-caption">
        <span className="text-cold">↳</span>
        <span className="text-primary">{followup.title}</span>
        <span className="text-dim">[{followup.kind}]</span>
        <span
          className={clsx(
            "ml-auto",
            followup.status === "failed"
              ? "text-hot"
              : followup.status === "completed"
                ? "text-cyan"
                : "text-dim",
          )}
        >
          {followup.status}
        </span>
      </div>

      {followup.currentStep && isRunning && followup.currentStep.name !== "unknown" && (
        <div className="mono mt-1 text-caption">
          <AnimatedStepBadge
            step={followup.currentStep.name}
            phase="progress"
          />
          <span className="ml-2 text-primary">{followup.currentStep.name}</span>
          <span className="ml-2 text-dim">…</span>
        </div>
      )}

      {followup.steps.length > 0 && (
        <div className="mt-1 flex flex-col gap-0.5">
          {followup.steps.map((step, index) => (
            <div key={index} className="mono text-caption">
              <span
                className={clsx(
                  step.phase === "error" ? "text-hot" : "text-cold",
                )}
              >
                {step.terminal}
              </span>
              <span className="ml-2 text-muted">{step.name}</span>
              <span className="ml-2 text-dim">
                ({(step.elapsedMs / 1000).toFixed(1)}s)
              </span>
            </div>
          ))}
        </div>
      )}

      {followup.findings.length > 0 && (
        <div className="mt-2 flex flex-col gap-1 border border-hairline bg-panel/40 p-2">
          <div className="mono text-caption text-muted">
            findings · {followup.findings.length}
          </div>
          {followup.findings.map((finding) => (
            <div
              key={finding.id}
              className="mono flex items-center gap-2 text-caption"
            >
              <span className="text-primary">{finding.id}</span>
              <span className="text-muted">{finding.title}</span>
              {finding.cortex && (
                <span className="text-dim">[{finding.cortex}]</span>
              )}
            </div>
          ))}
        </div>
      )}

      {followup.summaryText && (
        <div className="mt-2 whitespace-pre-wrap text-body text-primary">
          {followup.summaryText}
        </div>
      )}

      {(followup.provider || followup.tookMs != null) && (
        <div className="mono mt-1 text-caption text-dim">
          {followup.provider ? `${followup.provider} · ` : ""}
          {followup.tookMs != null ? `${followup.tookMs}ms` : ""}
        </div>
      )}
    </div>
  );
}
