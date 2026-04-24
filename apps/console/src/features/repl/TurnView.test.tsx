import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import type { Turn } from "./reducer";
import { TurnView } from "./TurnView";

describe("TurnView follow-up rendering", () => {
  it("shows the classifying badge and lets the operator cancel an in-flight turn", async () => {
    const user = userEvent.setup();
    const onCancel = vi.fn();
    const turn: Turn = {
      id: "t-0",
      input: "query",
      phase: "classifying",
      startedAt: Date.now() - 500,
      steps: [],
      findings: [],
      chatText: "",
      summaryText: "",
      followupOrder: [],
      followups: {},
    };

    render(
      <TurnView
        turn={turn}
        onFollowUp={vi.fn()}
        onUiAction={vi.fn()}
        onRunFollowUp={vi.fn()}
        onCancel={onCancel}
      />,
    );

    expect(screen.getByText(/classifying/i)).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Cancel turn" }));
    expect(onCancel).toHaveBeenCalledTimes(1);
  });

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
        onUiAction={vi.fn()}
        onRunFollowUp={vi.fn()}
        onCancel={vi.fn()}
      />,
    );

    expect(screen.getByText("parent summary")).toBeInTheDocument();
    expect(screen.getByText("follow-ups")).toBeInTheDocument();
    expect(screen.getAllByText("Telemetry verification")).toHaveLength(2);
    expect(screen.getByText("child summary")).toBeInTheDocument();
  });

  it("renders cycle progress, stream findings, bare timing metadata, and skips missing follow-up rows", () => {
    const turn: Turn = {
      id: "t-1b",
      input: "query",
      phase: "followup-running",
      startedAt: Date.now() - 2400,
      steps: [
        {
          name: "planner",
          phase: "done",
          terminal: "✓",
          elapsedMs: 1200,
        },
      ],
      currentStep: {
        name: "swarm",
        phase: "progress",
        terminal: "🐟",
        elapsedMs: 800,
      },
      findings: [
        {
          id: "f-1",
          title: "Main finding",
          cortex: "value_detective",
        },
      ],
      chatText: "chat body",
      summaryText: "summary body",
      followupPlan: {
        parentCycleId: "475",
        autoLaunched: [],
        proposed: [],
        dropped: [],
      },
      followupOrder: ["missing-followup"],
      followups: {},
      tookMs: 222,
    };

    render(
      <TurnView
        turn={turn}
        onFollowUp={vi.fn()}
        onUiAction={vi.fn()}
        onRunFollowUp={vi.fn()}
      />,
    );

    expect(screen.getByText(/cycle/i)).toBeInTheDocument();
    expect(screen.getByText("chat body")).toBeInTheDocument();
    expect(screen.getByText("findings · 1")).toBeInTheDocument();
    expect(screen.getByText("summary body")).toBeInTheDocument();
    expect(screen.queryByText("missing-followup")).not.toBeInTheDocument();
    expect(screen.getByText("222ms")).toBeInTheDocument();
  });

  it("renders chatting, cycle-running, and error phases", () => {
    const { rerender } = render(
      <TurnView
        turn={{
          id: "t-chat",
          input: "query",
          phase: "chatting",
          startedAt: Date.now() - 500,
          steps: [],
          findings: [],
          chatText: "",
          summaryText: "",
          followupOrder: [],
          followups: {},
        }}
        onFollowUp={vi.fn()}
        onUiAction={vi.fn()}
        onRunFollowUp={vi.fn()}
      />,
    );

    expect(screen.getByText(/chat…/i)).toBeInTheDocument();

    rerender(
      <TurnView
        turn={{
          id: "t-cycle",
          input: "query",
          phase: "cycle-running",
          startedAt: Date.now() - 900,
          steps: [],
          findings: [],
          chatText: "",
          summaryText: "",
          followupOrder: [],
          followups: {},
        }}
        onFollowUp={vi.fn()}
        onUiAction={vi.fn()}
        onRunFollowUp={vi.fn()}
      />,
    );

    expect(screen.getByText(/cycle/i)).toBeInTheDocument();
    expect(screen.getByText("…")).toBeInTheDocument();

    rerender(
      <TurnView
        turn={{
          id: "t-error",
          input: "query",
          phase: "error",
          startedAt: Date.now() - 900,
          steps: [],
          findings: [],
          chatText: "",
          summaryText: "",
          followupOrder: [],
          followups: {},
          error: "transport failed",
        }}
        onFollowUp={vi.fn()}
        onUiAction={vi.fn()}
        onRunFollowUp={vi.fn()}
      />,
    );

    expect(screen.getByText("error: transport failed")).toBeInTheDocument();
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
        onUiAction={vi.fn()}
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

  it("renders the aggregate briefing as the terminal view and keeps raw trace available", () => {
    const turn: Turn = {
      id: "t-brief",
      input: "rapport launches",
      phase: "done",
      startedAt: Date.now() - 1500,
      steps: [],
      findings: [
        {
          id: "377",
          title: "Progress MS-34",
          cortex: "launch_scout",
        },
      ],
      chatText: "",
      summaryText: "parent summary",
      briefing: {
        parentCycleId: "475",
        title: "Rapport launch consolide",
        summary: "Les lancements critiques sont confirmes et priorises.",
        sections: [
          {
            title: "Priorites",
            body: "Surveiller les fenetres proches.",
            bullets: ["ROSCOSMOS: Progress MS-34 (#377)"],
          },
        ],
        nextActions: ["Verifier les mises a jour de fenetre"],
        evidence: [
          {
            id: "377",
            title: "Progress MS-34",
            cortex: "launch_scout",
            confidence: 0.85,
            source: "parent",
          },
        ],
        provider: "kimi",
      },
      followupOrder: [],
      followups: {},
      tookMs: 321,
    };

    render(
      <TurnView
        turn={turn}
        onFollowUp={vi.fn()}
        onUiAction={vi.fn()}
        onRunFollowUp={vi.fn()}
      />,
    );

    expect(screen.getByText("Rapport launch consolide")).toBeInTheDocument();
    expect(
      screen.getByText("Les lancements critiques sont confirmes et priorises."),
    ).toBeInTheDocument();
    expect(screen.getByText("Priorites")).toBeInTheDocument();
    expect(screen.getByText("ROSCOSMOS: Progress MS-34 (#377)")).toBeInTheDocument();
    expect(screen.getByText("raw cycle trace")).toBeInTheDocument();
    expect(screen.getByText("parent summary")).toBeInTheDocument();
  });

  it("falls back to the raw input when the executed query is missing", async () => {
    const user = userEvent.setup();
    const onRunFollowUp = vi.fn();

    render(
      <TurnView
        turn={{
          id: "t-raw",
          input: "raw query",
          phase: "done",
          startedAt: Date.now() - 1500,
          steps: [],
          findings: [],
          chatText: "",
          summaryText: "parent summary",
          followupPlan: {
            parentCycleId: "900",
            autoLaunched: [],
            proposed: [
              {
                followupId: "fu-raw",
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
        }}
        onFollowUp={vi.fn()}
        onUiAction={vi.fn()}
        onRunFollowUp={onRunFollowUp}
      />,
    );

    await user.click(screen.getByRole("button", { name: "run" }));
    expect(onRunFollowUp).toHaveBeenCalledWith(
      "t-raw",
      "raw query",
      "900",
      expect.objectContaining({ followupId: "fu-raw" }),
    );
  });

  it("renders slash results and the final cost footer once the turn is done", () => {
    const turn: Turn = {
      id: "t-3",
      input: "query",
      phase: "done",
      startedAt: Date.now() - 1500,
      steps: [],
      findings: [],
      chatText: "",
      summaryText: "",
      followupOrder: [],
      followups: {},
      response: {
        results: [
          {
            kind: "chat",
            text: "assistant answer",
            provider: "openai",
          },
        ],
        costUsd: 0.1234,
        tookMs: 678,
      },
    };

    render(
      <TurnView
        turn={turn}
        onFollowUp={vi.fn()}
        onUiAction={vi.fn()}
        onRunFollowUp={vi.fn()}
      />,
    );

    expect(screen.getByText("assistant answer")).toBeInTheDocument();
    expect(screen.getByText("assistant · openai")).toBeInTheDocument();
    expect(screen.getByText("cost=$0.1234 · 678ms")).toBeInTheDocument();
  });
});
