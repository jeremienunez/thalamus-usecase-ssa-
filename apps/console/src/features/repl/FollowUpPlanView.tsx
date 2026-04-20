import type { ReplFollowUpPlanItem } from "@interview/shared";
import type { FollowUpPlanData, FollowUpTurn } from "./reducer";

type Props = {
  plan: FollowUpPlanData;
  followups: Record<string, FollowUpTurn>;
  onRun: (item: ReplFollowUpPlanItem) => void;
};

export function FollowUpPlanView({ plan, followups, onRun }: Props) {
  const hasItems =
    plan.autoLaunched.length > 0 ||
    plan.proposed.length > 0 ||
    plan.dropped.length > 0;
  if (!hasItems) return null;

  return (
    <div className="flex flex-col gap-2 border border-hairline bg-elevated p-2">
      <div className="mono text-caption text-muted">follow-ups</div>
      <PlanSection
        label="auto"
        items={plan.autoLaunched}
        tone="text-cyan"
        followups={followups}
        onRun={onRun}
      />
      <PlanSection
        label="proposed"
        items={plan.proposed}
        tone="text-cold"
        followups={followups}
        onRun={onRun}
      />
      <PlanSection
        label="dropped"
        items={plan.dropped}
        tone="text-dim"
        followups={followups}
        onRun={onRun}
      />
    </div>
  );
}

function PlanSection(props: {
  label: string;
  tone: string;
  items: FollowUpPlanData["autoLaunched"];
  followups: Record<string, FollowUpTurn>;
  onRun: (item: ReplFollowUpPlanItem) => void;
}) {
  if (props.items.length === 0) return null;
  return (
    <div className="flex flex-col gap-1">
      <div className={`mono text-caption ${props.tone}`}>{props.label}</div>
      {props.items.map((item) => (
        <div
          key={item.followupId}
          className="border-l border-hairline pl-2"
        >
          <div className="mono flex items-center gap-2 text-caption">
            <span className="text-primary">{item.title}</span>
            <span className="text-dim">[{item.kind}]</span>
            <span className="text-dim">
              score {item.score.toFixed(2)} / gate {item.gateScore.toFixed(2)}
            </span>
            {props.label === "proposed" && (
              <RunButton
                item={item}
                state={props.followups[item.followupId]}
                onRun={props.onRun}
              />
            )}
          </div>
          <div className="text-caption text-muted">{item.rationale}</div>
        </div>
      ))}
    </div>
  );
}

function RunButton(props: {
  item: ReplFollowUpPlanItem;
  state: FollowUpTurn | undefined;
  onRun: (item: ReplFollowUpPlanItem) => void;
}) {
  if (props.state) {
    return (
      <span className="ml-auto text-dim">
        {props.state.status === "running" || props.state.status === "pending"
          ? "running"
          : props.state.status}
      </span>
    );
  }
  return (
    <button
      type="button"
      onClick={() => props.onRun(props.item)}
      className="ml-auto cursor-pointer text-cyan transition-colors duration-fast ease-palantir hover:text-primary"
    >
      run
    </button>
  );
}
