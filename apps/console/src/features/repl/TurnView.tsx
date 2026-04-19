import { X } from "lucide-react";
import { AnimatedStepBadge } from "@/shared/ui/AnimatedStepBadge";
import { CycleLoader } from "@/shared/ui/CycleLoader";
import type { Turn } from "@/features/repl/reducer";
import { ResultView } from "./ResultView";

type Props = {
  turn: Turn;
  onFollowUp: (input: string) => void;
  onCancel?: () => void;
};

export function TurnView({ turn, onFollowUp, onCancel }: Props) {
  const elapsed = Date.now() - turn.startedAt;
  const isRunning =
    turn.phase === "classifying" ||
    turn.phase === "chatting" ||
    turn.phase === "cycle-running";

  return (
    <div className="mb-3 animate-fade-in border-l border-hairline pl-3">
      <div className="mono mb-1 flex items-center gap-2 text-caption text-cyan">
        <span>&gt;</span>
        <span className="text-primary">{turn.input}</span>
        {isRunning && onCancel && (
          <button
            onClick={onCancel}
            aria-label="Cancel turn"
            className="ml-auto text-dim transition-colors duration-fast ease-palantir hover:text-hot"
          >
            <X size={12} />
          </button>
        )}
      </div>

      {turn.phase === "classifying" && (
        <div className="mono text-caption text-muted">
          <AnimatedStepBadge step="planner" phase="progress" /> classifying…
        </div>
      )}

      {turn.phase === "chatting" && (
        <div className="mono text-caption text-muted">
          <AnimatedStepBadge step="nano.call" phase="progress" /> chat…
        </div>
      )}

      {turn.phase === "cycle-running" && (
        <CycleLoader
          cycleId={turn.cycleId ?? "…"}
          current={turn.currentStep}
          trail={turn.steps}
          elapsedMs={elapsed}
        />
      )}

      {turn.phase === "error" && (
        <div className="mono text-caption text-hot">error: {turn.error}</div>
      )}

      {turn.phase === "done" && turn.response && (
        <div className="flex flex-col gap-2">
          {turn.response.results.map((r, i) => (
            <ResultView key={i} result={r} onFollowUp={onFollowUp} />
          ))}
          <div className="mono text-caption text-dim">
            cost=${turn.response.costUsd.toFixed(4)} · {turn.response.tookMs}ms
          </div>
        </div>
      )}

      {turn.phase === "done" && !turn.response && (
        <div className="flex flex-col gap-2">
          {turn.chatText && (
            <div className="border-l-2 border-cyan pl-3">
              <div className="whitespace-pre-wrap text-body text-primary">
                {turn.chatText}
              </div>
              <div className="mt-1 mono text-caption text-dim">
                assistant · {turn.provider}
              </div>
            </div>
          )}
          {turn.findings.length > 0 && (
            <div className="flex flex-col gap-1 border border-hairline bg-elevated p-2">
              <div className="mono text-caption text-muted">
                findings · {turn.findings.length}
              </div>
              {turn.findings.map((f) => (
                <div
                  key={f.id}
                  className="mono flex items-center gap-2 text-caption"
                >
                  <span className="text-primary">{f.id}</span>
                  <span className="text-muted">{f.title}</span>
                  {f.cortex && <span className="text-dim">[{f.cortex}]</span>}
                </div>
              ))}
            </div>
          )}
          {turn.summaryText && (
            <div className="border-l-2 border-cold pl-3">
              <div className="whitespace-pre-wrap text-body text-primary">
                {turn.summaryText}
              </div>
            </div>
          )}
          {turn.tookMs != null && (
            <div className="mono text-caption text-dim">
              {turn.provider ? `${turn.provider} · ` : ""}
              {turn.tookMs}ms
            </div>
          )}
        </div>
      )}
    </div>
  );
}
