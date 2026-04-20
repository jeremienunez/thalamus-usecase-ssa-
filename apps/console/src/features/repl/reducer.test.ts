import { describe, expect, it } from "vitest";
import { newTurn, turnReducer } from "./reducer";

describe("repl turnReducer follow-ups", () => {
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
});
