import { describe, expect, it, vi } from "vitest";
import { newTurn } from "./reducer";
import { applyFollowUpStreamEvent } from "./reducer.followups";

describe("repl applyFollowUpStreamEvent", () => {
  it("stores follow-up plans and hydrates proposed follow-ups from plan metadata", () => {
    const turn = applyFollowUpStreamEvent(newTurn("t-1", "query"), {
      event: "followup.plan",
      data: {
        parentCycleId: "cycle-1",
        autoLaunched: [],
        proposed: [
          {
            followupId: "fu-1",
            kind: "deep_research_30d",
            auto: false,
            title: "Extend verification horizon",
            rationale: "Need more evidence",
            score: 0.81,
            gateScore: 0.66,
            costClass: "medium",
            reasonCodes: ["needs_monitoring"],
            target: null,
          },
        ],
        dropped: [],
      },
    });

    const withFinding = applyFollowUpStreamEvent(turn!, {
      event: "followup.finding",
      data: {
        parentCycleId: "cycle-1",
        followupId: "fu-1",
        kind: "deep_research_30d",
        auto: false,
        id: "finding-1",
        title: "Queued finding",
        cortex: "value_detective",
      },
    });

    expect(withFinding?.phase).toBe("followup-running");
    expect(withFinding?.followupOrder).toEqual(["fu-1"]);
    expect(withFinding?.followups["fu-1"]).toMatchObject({
      title: "Extend verification horizon",
      rationale: "Need more evidence",
      score: 0.81,
      gateScore: 0.66,
      costClass: "medium",
      reasonCodes: ["needs_monitoring"],
      status: "proposed",
      findings: [
        {
          id: "finding-1",
          title: "Queued finding",
          cortex: "value_detective",
        },
      ],
    });
  });

  it("tracks start and progress steps in currentStep, then archives terminal steps", () => {
    const started = applyFollowUpStreamEvent(newTurn("t-1", "query"), {
      event: "followup.started",
      data: {
        parentCycleId: "cycle-1",
        followupId: "fu-1",
        kind: "sim_telemetry_verification",
        auto: true,
        title: "Telemetry verification",
      },
    });

    const withProgress = applyFollowUpStreamEvent(started!, {
      event: "followup.step",
      data: {
        parentCycleId: "cycle-1",
        followupId: "fu-1",
        kind: "sim_telemetry_verification",
        auto: true,
        step: "swarm",
        phase: "progress",
        terminal: "🐟",
        elapsedMs: 250,
      },
    });

    expect(withProgress?.followups["fu-1"]).toMatchObject({
      status: "running",
      currentStep: {
        name: "swarm",
        phase: "progress",
        terminal: "🐟",
        elapsedMs: 250,
      },
      steps: [],
    });

    const withTerminal = applyFollowUpStreamEvent(withProgress!, {
      event: "followup.step",
      data: {
        parentCycleId: "cycle-1",
        followupId: "fu-1",
        kind: "sim_telemetry_verification",
        auto: true,
        step: "swarm",
        phase: "done",
        terminal: "✓",
        elapsedMs: 400,
      },
    });

    expect(withTerminal?.followups["fu-1"]).toMatchObject({
      currentStep: undefined,
      steps: [{ name: "swarm", phase: "done", terminal: "✓", elapsedMs: 400 }],
    });
  });

  it("preserves a different running step when a terminal event arrives for another step", () => {
    const turn = {
      ...newTurn("t-1", "query"),
      phase: "followup-running" as const,
      followupOrder: ["fu-1"],
      followups: {
        "fu-1": {
          followupId: "fu-1",
          kind: "sim_telemetry_verification",
          auto: true,
          title: "Telemetry verification",
          status: "running" as const,
          startedAt: 1,
          currentStep: {
            name: "planner",
            phase: "progress" as const,
            terminal: "○",
            elapsedMs: 100,
          },
          steps: [],
          findings: [],
          summaryText: "",
        },
      },
    };

    const next = applyFollowUpStreamEvent(turn, {
      event: "followup.step",
      data: {
        parentCycleId: "cycle-1",
        followupId: "fu-1",
        kind: "sim_telemetry_verification",
        auto: true,
        step: "swarm",
        phase: "error",
        terminal: "✗",
        elapsedMs: 333,
      },
    });

    expect(next?.followups["fu-1"]).toMatchObject({
      currentStep: {
        name: "planner",
        phase: "progress",
        terminal: "○",
        elapsedMs: 100,
      },
      steps: [{ name: "swarm", phase: "error", terminal: "✗", elapsedMs: 333 }],
    });
  });

  it("finalizes the parent turn once the last follow-up completes after a parent response exists", () => {
    const turn = {
      ...newTurn("t-1", "query"),
      phase: "followup-running" as const,
      tookMs: 123,
      followupOrder: ["fu-1"],
      followups: {
        "fu-1": {
          followupId: "fu-1",
          kind: "deep_research_30d",
          auto: false,
          title: "Extend verification horizon",
          status: "running" as const,
          startedAt: 1,
          steps: [],
          findings: [],
          summaryText: "",
        },
      },
    };

    const next = applyFollowUpStreamEvent(turn, {
      event: "followup.done",
      data: {
        parentCycleId: "cycle-1",
        followupId: "fu-1",
        kind: "deep_research_30d",
        auto: false,
        status: "completed",
        provider: "openai",
        tookMs: 456,
      },
    });

    expect(next).toMatchObject({
      phase: "done",
      followups: {
        "fu-1": expect.objectContaining({
          status: "completed",
          provider: "openai",
          tookMs: 456,
          currentStep: undefined,
        }),
      },
    });
  });

  it("keeps the parent in followup-running while another follow-up is still pending and stores summaries", () => {
    const turn = {
      ...newTurn("t-1", "query"),
      phase: "followup-running" as const,
      followupOrder: ["fu-1", "fu-2"],
      followups: {
        "fu-1": {
          followupId: "fu-1",
          kind: "deep_research_30d",
          auto: false,
          title: "Extend verification horizon",
          status: "running" as const,
          startedAt: 1,
          steps: [],
          findings: [],
          summaryText: "",
        },
        "fu-2": {
          followupId: "fu-2",
          kind: "sim_telemetry_verification",
          auto: true,
          title: "Telemetry verification",
          status: "pending" as const,
          startedAt: 2,
          steps: [],
          findings: [],
          summaryText: "",
        },
      },
    };

    const withSummary = applyFollowUpStreamEvent(turn, {
      event: "followup.summary",
      data: {
        parentCycleId: "cycle-1",
        followupId: "fu-1",
        kind: "deep_research_30d",
        auto: false,
        text: "follow-up summary",
        provider: "kimi",
      },
    });
    const next = applyFollowUpStreamEvent(withSummary!, {
      event: "followup.done",
      data: {
        parentCycleId: "cycle-1",
        followupId: "fu-1",
        kind: "deep_research_30d",
        auto: false,
        status: "failed",
        provider: "kimi",
        tookMs: 789,
      },
    });

    expect(next).toMatchObject({
      phase: "followup-running",
      followups: {
        "fu-1": expect.objectContaining({
          status: "failed",
          summaryText: "follow-up summary",
          provider: "kimi",
          tookMs: 789,
        }),
      },
    });
  });

  it("returns undefined for non-follow-up events", () => {
    expect(
      applyFollowUpStreamEvent(newTurn("t-1", "query"), {
        event: "done",
        data: { provider: "kimi", tookMs: 120 },
      }),
    ).toBeUndefined();
  });

  it("falls back to Date.now when a started event revives a follow-up missing startedAt", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-04-23T00:00:00.000Z"));

    const existing = {
      followupId: "fu-1",
      kind: "deep_research_30d",
      auto: false,
      title: "Extend verification horizon",
      status: "proposed" as const,
      startedAt: 1,
      steps: [],
      findings: [],
      summaryText: "",
    };
    Reflect.deleteProperty(
      existing as typeof existing & { startedAt?: number },
      "startedAt",
    );

    const turn = {
      ...newTurn("t-1", "query"),
      followupOrder: ["fu-1"],
      followups: {
        "fu-1": existing,
      },
    };

    const next = applyFollowUpStreamEvent(turn, {
      event: "followup.started",
      data: {
        parentCycleId: "cycle-1",
        followupId: "fu-1",
        kind: "deep_research_30d",
        auto: false,
        title: "Extend verification horizon",
      },
    });

    expect(next?.followups["fu-1"]?.startedAt).toBe(
      new Date("2026-04-23T00:00:00.000Z").valueOf(),
    );
    vi.useRealTimers();
  });
});
