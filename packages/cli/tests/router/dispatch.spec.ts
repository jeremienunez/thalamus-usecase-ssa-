import { describe, it, expect, vi } from "vitest";
import { dispatch, type Adapters } from "../../src/router/dispatch";

function makeAdapters(): Adapters {
  return {
    thalamus: {
      runCycle: vi.fn().mockResolvedValue({ findings: [{ id: "f1" }], costUsd: 0.5 }),
    },
    telemetry: {
      start: vi.fn().mockResolvedValue({ distribution: { rng: 1 } }),
    },
    logs: {
      tail: vi.fn().mockReturnValue([{ msg: "x" }]),
    },
    graph: {
      neighbourhood: vi.fn().mockResolvedValue({ root: "E", levels: [] }),
    },
    resolution: {
      accept: vi.fn().mockResolvedValue({ ok: true, delta: { n: 2 } }),
    },
    why: {
      build: vi.fn().mockResolvedValue({ id: "f1", children: [] }),
    },
  };
}

describe("dispatch", () => {
  it("routes query → briefing via thalamus", async () => {
    const adapters = makeAdapters();
    const r = await dispatch(
      { action: "query", q: "hello" },
      { adapters, cycleId: "c-1" },
    );
    expect(adapters.thalamus.runCycle).toHaveBeenCalledWith({ query: "hello", cycleId: "c-1" });
    expect(r).toEqual({ kind: "briefing", findings: [{ id: "f1" }], costUsd: 0.5 });
  });

  it("routes each action kind to its adapter", async () => {
    const adapters = makeAdapters();
    const ctx = { adapters, cycleId: "c-2" };

    const tel = await dispatch({ action: "telemetry", satId: "SAT-9" }, ctx);
    expect(tel).toEqual({ kind: "telemetry", satId: "SAT-9", distribution: { rng: 1 } });

    const logs = await dispatch({ action: "logs", level: "warn" }, ctx);
    expect(logs).toEqual({ kind: "logs", events: [{ msg: "x" }] });
    expect(adapters.logs.tail).toHaveBeenCalledWith({ level: "warn", service: undefined, sinceMs: undefined });

    const g = await dispatch({ action: "graph", entity: "E" }, ctx);
    expect(adapters.graph.neighbourhood).toHaveBeenCalledWith("E");
    expect(g).toEqual({ kind: "graph", tree: { root: "E", levels: [] } });

    const acc = await dispatch({ action: "accept", suggestionId: "s1" }, ctx);
    expect(adapters.resolution.accept).toHaveBeenCalledWith("s1");
    expect(acc).toEqual({ kind: "resolution", suggestionId: "s1", ok: true, delta: { n: 2 } });

    const exp = await dispatch({ action: "explain", findingId: "f1" }, ctx);
    expect(adapters.why.build).toHaveBeenCalledWith("f1");
    expect(exp).toEqual({ kind: "why", tree: { id: "f1", children: [] } });

    const cl = await dispatch(
      { action: "clarify", question: "which?", options: ["query", "logs"] },
      ctx,
    );
    expect(cl).toEqual({ kind: "clarify", question: "which?", options: ["query", "logs"] });
  });
});
