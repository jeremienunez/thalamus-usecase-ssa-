import { describe, expect, it } from "vitest";
import { newTurn } from "./reducer";
import { applyCoreStreamEvent } from "./reducer.stream";

describe("repl applyCoreStreamEvent", () => {
  it("switches to chatting for chat classifications and preserves the previous executed query", () => {
    const turn = {
      ...newTurn("t-1", "query"),
      executedQuery: "previous query",
    };

    const next = applyCoreStreamEvent(turn, {
      event: "classified",
      data: { action: "chat" },
    });

    expect(next).toMatchObject({
      phase: "chatting",
      executedQuery: "previous query",
    });
  });

  it("switches to cycle-running for run_cycle classifications and updates the executed query when present", () => {
    const turn = newTurn("t-1", "query");

    const next = applyCoreStreamEvent(turn, {
      event: "classified",
      data: { action: "run_cycle", query: "normalized query" },
    });

    expect(next).toMatchObject({
      phase: "cycle-running",
      executedQuery: "normalized query",
    });
  });

  it("keeps the previous executed query when a run_cycle classification omits the normalized query", () => {
    const turn = {
      ...newTurn("t-1", "query"),
      executedQuery: "existing query",
    };

    const next = applyCoreStreamEvent(turn, {
      event: "classified",
      data: { action: "run_cycle" },
    });

    expect(next?.executedQuery).toBe("existing query");
  });

  it("stores cycle ids, findings, chat text, summaries, completion data, and error messages", () => {
    let turn = newTurn("t-1", "query");

    turn =
      applyCoreStreamEvent(turn, {
        event: "cycle.start",
        data: { cycleId: "cycle-1", query: "cycle query" },
      }) ?? turn;
    turn =
      applyCoreStreamEvent(turn, {
        event: "finding",
        data: { id: "f-1", title: "Finding", cortex: "planner" },
      }) ?? turn;
    turn =
      applyCoreStreamEvent(turn, {
        event: "chat.complete",
        data: { text: "chat reply", provider: "kimi" },
      }) ?? turn;
    turn =
      applyCoreStreamEvent(turn, {
        event: "summary.complete",
        data: { text: "summary text", provider: "openai" },
      }) ?? turn;
    turn =
      applyCoreStreamEvent(turn, {
        event: "briefing.complete",
        data: {
          parentCycleId: "cycle-1",
          title: "Final report",
          summary: "aggregated summary",
          sections: [{ title: "Result", body: "body", bullets: ["#f-1"] }],
          nextActions: [],
          evidence: [
            {
              id: "f-1",
              title: "Finding",
              cortex: "planner",
              confidence: 0.8,
              source: "parent",
            },
          ],
          provider: "kimi",
        },
      }) ?? turn;
    turn =
      applyCoreStreamEvent(turn, {
        event: "done",
        data: { provider: "minimax", tookMs: 987 },
      }) ?? turn;

    expect(turn).toMatchObject({
      cycleId: "cycle-1",
      executedQuery: "cycle query",
      findings: [{ id: "f-1", title: "Finding", cortex: "planner" }],
      chatText: "chat reply",
      summaryText: "summary text",
      briefing: {
        title: "Final report",
        summary: "aggregated summary",
      },
      provider: "minimax",
      phase: "done",
      tookMs: 987,
    });

    const errored =
      applyCoreStreamEvent(turn, {
        event: "error",
        data: { message: "stream exploded" },
      }) ?? turn;

    expect(errored).toMatchObject({
      phase: "error",
      error: "stream exploded",
    });
  });

  it("tracks cycle steps, clearing the current step only when the terminal event matches it", () => {
    const turn = newTurn("t-1", "query");

    const withStart =
      applyCoreStreamEvent(turn, {
        event: "step",
        data: {
          step: "planner",
          phase: "start",
          terminal: "○",
          elapsedMs: 10,
        },
      }) ?? turn;
    expect(withStart.currentStep).toMatchObject({
      name: "planner",
      phase: "start",
      terminal: "○",
      elapsedMs: 10,
    });
    expect(withStart.steps).toEqual([]);

    const withMismatchTerminal =
      applyCoreStreamEvent(
        {
          ...withStart,
          currentStep: {
            name: "planner",
            phase: "progress",
            terminal: "○",
            elapsedMs: 10,
          },
        },
        {
          event: "step",
          data: {
            step: "swarm",
            phase: "done",
            terminal: "✓",
            elapsedMs: 20,
          },
        },
      ) ?? withStart;
    expect(withMismatchTerminal.currentStep?.name).toBe("planner");
    expect(withMismatchTerminal.steps).toEqual([
      { name: "swarm", phase: "done", terminal: "✓", elapsedMs: 20 },
    ]);

    const withMatchedTerminal =
      applyCoreStreamEvent(
        {
          ...withStart,
          currentStep: {
            name: "planner",
            phase: "progress",
            terminal: "○",
            elapsedMs: 10,
          },
        },
        {
          event: "step",
          data: {
            step: "planner",
            phase: "error",
            terminal: "✗",
            elapsedMs: 30,
          },
        },
      ) ?? withStart;
    expect(withMatchedTerminal.currentStep).toBeUndefined();
    expect(withMatchedTerminal.steps).toEqual([
      { name: "planner", phase: "error", terminal: "✗", elapsedMs: 30 },
    ]);
  });

  it("returns undefined for non-core events", () => {
    const turn = newTurn("t-1", "query");

    expect(
      applyCoreStreamEvent(turn, {
        event: "followup.plan",
        data: {
          parentCycleId: "cycle-1",
          autoLaunched: [],
          proposed: [],
          dropped: [],
        },
      }),
    ).toBeUndefined();
  });
});
