import { X } from "lucide-react";
import type { ReplFollowUpPlanItem } from "@interview/shared";
import { AnimatedStepBadge } from "@/shared/ui/AnimatedStepBadge";
import { CycleLoader } from "@/shared/ui/CycleLoader";
import type { BriefingUiAction } from "@/types/repl-turn";
import type { Turn } from "@/features/repl/reducer";
import { AggregateBriefingView } from "./AggregateBriefingView";
import { FollowUpPlanView } from "./FollowUpPlanView";
import { FollowUpTurnView } from "./FollowUpTurnView";
import { ResultView } from "./ResultView";

type Props = {
  turn: Turn;
  onFollowUp: (input: string) => void;
  onUiAction: (action: BriefingUiAction) => void;
  onRunFollowUp: (
    turnId: string,
    query: string,
    parentCycleId: string,
    item: ReplFollowUpPlanItem,
  ) => void;
  onCancel?: () => void;
};

export function TurnView({
  turn,
  onFollowUp,
  onUiAction,
  onRunFollowUp,
  onCancel,
}: Props) {
  const elapsed = Date.now() - turn.startedAt;
  const isRunning =
    turn.phase === "classifying" ||
    turn.phase === "chatting" ||
    turn.phase === "cycle-running" ||
    turn.phase === "followup-running";
  const showStreamResult =
    (turn.phase === "done" || turn.phase === "followup-running") &&
    !turn.response;
  const streamTrace = (
    <>
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
      {turn.followupPlan && (
        <FollowUpPlanView
          plan={turn.followupPlan}
          followups={turn.followups}
          onRun={(item) =>
            onRunFollowUp(
              turn.id,
              turn.executedQuery ?? turn.input,
              turn.followupPlan!.parentCycleId,
              item,
            )
          }
        />
      )}
      {turn.followupOrder.length > 0 && (
        <div className="flex flex-col gap-2">
          {turn.followupOrder.map((followupId) => {
            const followup = turn.followups[followupId];
            if (!followup) return null;
            return (
              <FollowUpTurnView
                key={followup.followupId}
                followup={followup}
              />
            );
          })}
        </div>
      )}
    </>
  );

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

      {turn.phase === "followup-running" && (
        <div className="flex flex-col gap-2">
          <CycleLoader
            cycleId={turn.cycleId ?? "…"}
            current={turn.currentStep}
            trail={turn.steps}
            elapsedMs={elapsed}
          />
          <div className="mono text-caption text-cold">
            <AnimatedStepBadge step="swarm" phase="progress" /> follow-ups…
          </div>
        </div>
      )}

      {turn.phase === "error" && (
        <div className="mono text-caption text-hot">error: {turn.error}</div>
      )}

      {turn.phase === "done" && turn.response && (
        <div className="flex flex-col gap-2">
          {turn.response.results.map((r, i) => (
            <ResultView
              key={i}
              result={r}
              onFollowUp={onFollowUp}
              onUiAction={onUiAction}
            />
          ))}
          <div className="mono text-caption text-dim">
            cost=${turn.response.costUsd.toFixed(4)} · {turn.response.tookMs}ms
          </div>
        </div>
      )}

      {showStreamResult && (
        <div className="flex flex-col gap-2">
          {turn.briefing && <AggregateBriefingView briefing={turn.briefing} />}
          {turn.briefing ? (
            <details className="border border-hairline bg-panel/40 p-2">
              <summary className="mono cursor-pointer text-caption text-dim">
                raw cycle trace
              </summary>
              <div className="mt-2 flex flex-col gap-2">{streamTrace}</div>
            </details>
          ) : (
            streamTrace
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
