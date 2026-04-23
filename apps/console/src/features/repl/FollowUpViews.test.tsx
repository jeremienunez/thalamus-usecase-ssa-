import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { FollowUpPlanView } from "./FollowUpPlanView";
import { FollowUpTurnView } from "./FollowUpTurnView";
import type { FollowUpPlanData, FollowUpTurn } from "./reducer";

function makePlan(overrides: Partial<FollowUpPlanData> = {}): FollowUpPlanData {
  return {
    parentCycleId: "cycle-1",
    autoLaunched: [],
    proposed: [],
    dropped: [],
    ...overrides,
  };
}

function makeFollowUp(overrides: Partial<FollowUpTurn> = {}): FollowUpTurn {
  return {
    followupId: "fu-1",
    kind: "deep_research_30d",
    auto: false,
    title: "Extend verification horizon",
    status: "proposed",
    startedAt: 1,
    steps: [],
    findings: [],
    summaryText: "",
    ...overrides,
  };
}

describe("repl FollowUpPlanView", () => {
  it("returns null when there are no auto, proposed, or dropped items", () => {
    const { container } = render(
      <FollowUpPlanView
        plan={makePlan()}
        followups={{}}
        onRun={vi.fn()}
      />,
    );

    expect(container.firstChild).toBeNull();
  });

  it("renders all plan buckets and lets the operator run a proposed follow-up that is not started yet", async () => {
    const user = userEvent.setup();
    const onRun = vi.fn();
    const proposed = {
      followupId: "fu-proposed",
      kind: "deep_research_30d",
      auto: false,
      title: "Extend verification horizon",
      rationale: "Needs longer sampling window",
      score: 0.71,
      gateScore: 0.6,
      costClass: "medium" as const,
      reasonCodes: ["needs_monitoring"],
      target: null,
    };

    render(
      <FollowUpPlanView
        plan={makePlan({
          autoLaunched: [
            {
              followupId: "fu-auto",
              kind: "sim_telemetry_verification",
              auto: true,
              title: "Telemetry verification",
              rationale: "Telemetry is missing",
              score: 0.9,
              gateScore: 0.8,
              costClass: "low",
              reasonCodes: ["data_gap"],
              target: { entityType: "satellite", entityId: "25544" },
            },
          ],
          proposed: [proposed],
          dropped: [
            {
              followupId: "fu-drop",
              kind: "deep_research_30d",
              auto: false,
              title: "Discarded branch",
              rationale: "Too costly",
              score: 0.2,
              gateScore: 0.7,
              costClass: "medium",
              reasonCodes: ["budget"],
              target: null,
            },
          ],
        })}
        followups={{}}
        onRun={onRun}
      />,
    );

    expect(screen.getByText("follow-ups")).toBeInTheDocument();
    expect(screen.getByText("auto")).toBeInTheDocument();
    expect(screen.getByText("proposed")).toBeInTheDocument();
    expect(screen.getByText("dropped")).toBeInTheDocument();
    expect(screen.getByText("Telemetry verification")).toBeInTheDocument();
    expect(screen.getByText("Discarded branch")).toBeInTheDocument();
    expect(screen.getByText("score 0.71 / gate 0.60")).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "run" }));
    expect(onRun).toHaveBeenCalledWith(proposed);
  });

  it("shows the current follow-up status instead of a run button for proposed items that already exist", () => {
    render(
      <FollowUpPlanView
        plan={makePlan({
          proposed: [
            {
              followupId: "fu-1",
              kind: "deep_research_30d",
              auto: false,
              title: "Extend verification horizon",
              rationale: "Needs longer sampling window",
              score: 0.71,
              gateScore: 0.6,
              costClass: "medium",
              reasonCodes: ["needs_monitoring"],
              target: null,
            },
          ],
        })}
        followups={{
          "fu-1": makeFollowUp({ status: "running" }),
        }}
        onRun={vi.fn()}
      />,
    );

    expect(screen.getByText("running")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "run" })).not.toBeInTheDocument();
  });

  it("collapses pending follow-ups into running and shows settled follow-up statuses verbatim", () => {
    const { rerender } = render(
      <FollowUpPlanView
        plan={makePlan({
          proposed: [
            {
              followupId: "fu-1",
              kind: "deep_research_30d",
              auto: false,
              title: "Extend verification horizon",
              rationale: "Needs longer sampling window",
              score: 0.71,
              gateScore: 0.6,
              costClass: "medium",
              reasonCodes: ["needs_monitoring"],
              target: null,
            },
          ],
        })}
        followups={{
          "fu-1": makeFollowUp({ status: "pending" }),
        }}
        onRun={vi.fn()}
      />,
    );

    expect(screen.getByText("running")).toBeInTheDocument();

    rerender(
      <FollowUpPlanView
        plan={makePlan({
          proposed: [
            {
              followupId: "fu-1",
              kind: "deep_research_30d",
              auto: false,
              title: "Extend verification horizon",
              rationale: "Needs longer sampling window",
              score: 0.71,
              gateScore: 0.6,
              costClass: "medium",
              reasonCodes: ["needs_monitoring"],
              target: null,
            },
          ],
        })}
        followups={{
          "fu-1": makeFollowUp({ status: "completed" }),
        }}
        onRun={vi.fn()}
      />,
    );

    expect(screen.getByText("completed")).toBeInTheDocument();
  });
});

describe("repl FollowUpTurnView", () => {
  it("renders the live step, archived steps, findings, summary, and provider timing metadata", () => {
    render(
      <FollowUpTurnView
        followup={makeFollowUp({
          kind: "sim_telemetry_verification",
          auto: true,
          status: "running",
          currentStep: {
            name: "swarm",
            phase: "progress",
            terminal: "🐟",
            elapsedMs: 250,
          },
          steps: [
            {
              name: "planner",
              phase: "error",
              terminal: "✗",
              elapsedMs: 1000,
            },
          ],
          findings: [
            {
              id: "finding-1",
              title: "Found telemetry gap",
              cortex: "value_detective",
            },
          ],
          summaryText: "follow-up summary",
          provider: "kimi",
          tookMs: 321,
        })}
      />,
    );

    expect(screen.getByText("Extend verification horizon")).toBeInTheDocument();
    expect(screen.getByText("[sim_telemetry_verification]")).toBeInTheDocument();
    expect(screen.getByText("running")).toBeInTheDocument();
    expect(screen.getByText("swarm")).toBeInTheDocument();
    expect(screen.getByText("(1.0s)")).toBeInTheDocument();
    expect(screen.getByText("findings · 1")).toBeInTheDocument();
    expect(screen.getByText("Found telemetry gap")).toBeInTheDocument();
    expect(screen.getByText("[value_detective]")).toBeInTheDocument();
    expect(screen.getByText("follow-up summary")).toBeInTheDocument();
    expect(screen.getByText("kimi · 321ms")).toBeInTheDocument();
  });

  it("hides optional sections when the follow-up is settled or the current step is unknown", () => {
    render(
      <FollowUpTurnView
        followup={makeFollowUp({
          status: "completed",
          currentStep: {
            name: "unknown",
            phase: "progress",
            terminal: "…",
            elapsedMs: 10,
          },
        })}
      />,
    );

    expect(screen.getByText("completed")).toBeInTheDocument();
    expect(screen.queryByText("findings · 1")).not.toBeInTheDocument();
    expect(screen.queryByText("unknown")).not.toBeInTheDocument();
    expect(screen.queryByText(/ms$/)).not.toBeInTheDocument();
  });

  it("renders failed states, non-error archived steps, and provider-only metadata", () => {
    render(
      <FollowUpTurnView
        followup={makeFollowUp({
          status: "failed",
          steps: [
            {
              name: "planner",
              phase: "done",
              terminal: "✓",
              elapsedMs: 800,
            },
          ],
          provider: "openai",
        })}
      />,
    );

    expect(screen.getByText("failed")).toBeInTheDocument();
    expect(screen.getByText("(0.8s)")).toBeInTheDocument();
    expect(screen.getByText("openai ·")).toBeInTheDocument();
  });

  it("renders timing-only metadata when no provider is attached", () => {
    render(
      <FollowUpTurnView
        followup={makeFollowUp({
          status: "completed",
          tookMs: 222,
        })}
      />,
    );

    expect(screen.getByText("222ms")).toBeInTheDocument();
  });
});
