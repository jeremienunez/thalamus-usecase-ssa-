import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import type { Turn } from "./reducer";
import { TurnView } from "./TurnView";

describe("TurnView follow-up rendering", () => {
  it("shows the parent summary while follow-ups are still running", () => {
    const turn: Turn = {
      id: "t-1",
      input: "query",
      phase: "followup-running",
      startedAt: Date.now() - 1500,
      cycleId: "475",
      executedQuery: "normalized query",
      steps: [],
      findings: [],
      chatText: "",
      summaryText: "parent summary",
      provider: "kimi",
      followupPlan: {
        parentCycleId: "475",
        autoLaunched: [
          {
            followupId: "fu-1",
            kind: "sim_telemetry_verification",
            auto: true,
            title: "Telemetry verification",
            rationale: "Need telemetry evidence",
            score: 0.8,
            gateScore: 0.75,
            costClass: "low",
            reasonCodes: ["data_gap"],
            target: { entityType: "satellite", entityId: "27424" },
          },
        ],
        proposed: [],
        dropped: [],
      },
      followupOrder: ["fu-1"],
      followups: {
        "fu-1": {
          followupId: "fu-1",
          kind: "sim_telemetry_verification",
          auto: true,
          title: "Telemetry verification",
          status: "running",
          startedAt: Date.now() - 1000,
          steps: [],
          findings: [],
          summaryText: "child summary",
        },
      },
    };

    render(
      <TurnView
        turn={turn}
        onFollowUp={vi.fn()}
        onRunFollowUp={vi.fn()}
        onCancel={vi.fn()}
      />,
    );

    expect(screen.getByText("parent summary")).toBeInTheDocument();
    expect(screen.getByText("follow-ups")).toBeInTheDocument();
    expect(screen.getAllByText("Telemetry verification")).toHaveLength(2);
    expect(screen.getByText("child summary")).toBeInTheDocument();
  });

  it("lets the user trigger a proposed follow-up", async () => {
    const user = userEvent.setup();
    const onRunFollowUp = vi.fn();
    const turn: Turn = {
      id: "t-2",
      input: "query",
      phase: "done",
      startedAt: Date.now() - 1500,
      cycleId: "476",
      executedQuery: "normalized query",
      steps: [],
      findings: [],
      chatText: "",
      summaryText: "parent summary",
      provider: "kimi",
      followupPlan: {
        parentCycleId: "476",
        autoLaunched: [],
        proposed: [
          {
            followupId: "fu-2",
            kind: "deep_research_30d",
            auto: false,
            title: "Extend verification horizon to 30 days",
            rationale: "Needs monitoring",
            score: 0.69,
            gateScore: 0.82,
            costClass: "medium",
            reasonCodes: ["needs_monitoring"],
            target: null,
          },
        ],
        dropped: [],
      },
      followupOrder: [],
      followups: {},
      tookMs: 1234,
    };

    render(
      <TurnView
        turn={turn}
        onFollowUp={vi.fn()}
        onRunFollowUp={onRunFollowUp}
        onCancel={vi.fn()}
      />,
    );

    await user.click(screen.getByRole("button", { name: "run" }));
    expect(onRunFollowUp).toHaveBeenCalledWith(
      "t-2",
      "normalized query",
      "476",
      expect.objectContaining({
        followupId: "fu-2",
        kind: "deep_research_30d",
      }),
    );
  });
});
