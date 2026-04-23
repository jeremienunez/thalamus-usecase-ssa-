import { describe, expect, it } from "vitest";
import { newTurn, turnReducer } from "./reducer";
import type { ReplStreamEvent } from "@interview/shared";

describe("repl turnReducer follow-ups", () => {
  it("creates new turns with empty stream accumulators", () => {
    const turn = newTurn("t-1", "query");

    expect(turn).toMatchObject({
      id: "t-1",
      input: "query",
      phase: "classifying",
      steps: [],
      findings: [],
      chatText: "",
      summaryText: "",
      followupOrder: [],
      followups: {},
    });
  });

  it("handles slash completions and explicit failures", () => {
    const base = newTurn("t-1", "query");

    const done = turnReducer(base, {
      type: "slash.done",
      response: {
        results: [],
        costUsd: 0.01,
        tookMs: 456,
      },
    });
    expect(done).toMatchObject({
      phase: "done",
      tookMs: 456,
      response: {
        costUsd: 0.01,
        tookMs: 456,
      },
    });

    const failed = turnReducer(base, {
      type: "fail",
      error: "cancelled",
    });
    expect(failed).toMatchObject({
      phase: "error",
      error: "cancelled",
    });
  });

  it("tracks follow-up plan and child lifecycle under the parent turn", () => {
    let turn = newTurn("t-1", "query");

    turn = turnReducer(turn, {
      type: "stream",
      event: {
        event: "summary.complete",
        data: { text: "parent summary", provider: "kimi" },
      },
    });

    turn = turnReducer(turn, {
      type: "stream",
      event: {
        event: "followup.plan",
        data: {
          parentCycleId: "475",
          autoLaunched: [
            {
              followupId: "fu-1",
              kind: "sim_telemetry_verification",
              auto: true,
              title: "Telemetry verification",
              rationale: "Need telemetry evidence",
              score: 0.81,
              gateScore: 0.76,
              costClass: "low",
              reasonCodes: ["data_gap"],
              target: { entityType: "satellite", entityId: "27424" },
            },
          ],
          proposed: [],
          dropped: [],
        },
      },
    });

    turn = turnReducer(turn, {
      type: "stream",
      event: {
        event: "followup.started",
        data: {
          parentCycleId: "475",
          followupId: "fu-1",
          kind: "sim_telemetry_verification",
          auto: true,
          title: "Telemetry verification",
        },
      },
    });

    turn = turnReducer(turn, {
      type: "stream",
      event: {
        event: "followup.step",
        data: {
          parentCycleId: "475",
          followupId: "fu-1",
          kind: "sim_telemetry_verification",
          auto: true,
          step: "swarm",
          phase: "progress",
          terminal: "🐟",
          elapsedMs: 250,
        },
      },
    });

    turn = turnReducer(turn, {
      type: "stream",
      event: {
        event: "followup.summary",
        data: {
          parentCycleId: "475",
          followupId: "fu-1",
          kind: "sim_telemetry_verification",
          auto: true,
          text: "child summary",
          provider: "kimi",
        },
      },
    });

    turn = turnReducer(turn, {
      type: "stream",
      event: {
        event: "followup.done",
        data: {
          parentCycleId: "475",
          followupId: "fu-1",
          kind: "sim_telemetry_verification",
          auto: true,
          provider: "kimi",
          tookMs: 1234,
          status: "completed",
        },
      },
    });

    expect(turn.phase).toBe("followup-running");
    expect(turn.summaryText).toBe("parent summary");
    expect(turn.followupPlan?.autoLaunched).toHaveLength(1);
    expect(turn.followupOrder).toEqual(["fu-1"]);
    expect(turn.followups["fu-1"]).toMatchObject({
      title: "Telemetry verification",
      status: "completed",
      summaryText: "child summary",
      provider: "kimi",
      tookMs: 1234,
    });
  });

  it("routes core stream events through turnReducer", () => {
    const turn = turnReducer(newTurn("t-1", "query"), {
      type: "stream",
      event: {
        event: "error",
        data: { message: "transport failed" },
      },
    });

    expect(turn).toMatchObject({
      phase: "error",
      error: "transport failed",
    });
  });

  it("returns the original turn for unknown stream events at runtime", () => {
    const turn = newTurn("t-1", "query");
    const invalidEvent = {
      event: "not-real",
      data: {},
    } as ReplStreamEvent;

    expect(
      turnReducer(turn, {
        type: "stream",
        event: invalidEvent,
      }),
    ).toBe(turn);
  });
});
