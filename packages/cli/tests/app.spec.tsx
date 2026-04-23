import React from "react";
import { render } from "ink-testing-library";
import { EventEmitter } from "node:events";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { App } from "../src/app";

const proto = EventEmitter.prototype as EventEmitter & {
  ref?: () => EventEmitter;
  unref?: () => EventEmitter;
};
if (typeof proto.ref !== "function") {
  proto.ref = function ref() {
    return this;
  };
}
if (typeof proto.unref !== "function") {
  proto.unref = function unref() {
    return this;
  };
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function attachReadableInput(rawStdin: EventEmitter & { read?: () => string | null }) {
  let buffer = "";
  rawStdin.read = () => {
    if (buffer.length === 0) return null;
    const out = buffer;
    buffer = "";
    return out;
  };

  return {
    async typeLine(line: string, settleMs = 250): Promise<void> {
      for (const ch of line) {
        buffer += ch;
        rawStdin.emit("readable");
        await delay(2);
      }
      buffer += "\r";
      rawStdin.emit("readable");
      await delay(settleMs);
    },
  };
}

function makeAdapters() {
  return {
    thalamus: {
      runCycle: vi.fn().mockResolvedValue({
        findings: [
          {
            id: "F-1",
            summary: "Risky conjunction",
            sourceClass: "FIELD",
            confidence: 0.9,
            evidenceRefs: ["S-1"],
          },
        ],
        costUsd: 0.42,
      }),
    },
    telemetry: {
      start: vi.fn().mockResolvedValue({
        distribution: {
          scalars: [
            {
              name: "velocity",
              unit: "km/s",
              median: 7.61,
              p5: 7.55,
              p95: 7.69,
            },
          ],
        },
      }),
    },
    logs: {
      tail: vi.fn().mockReturnValue([
        {
          time: Date.UTC(2026, 0, 1, 12, 0, 0),
          level: 30,
          service: "planner",
          step: "cortex",
          phase: "done",
          msg: "step complete",
        },
        {
          time: Date.UTC(2026, 0, 1, 12, 0, 1),
          level: 40,
          service: "planner",
          msg: "follow-up",
        },
      ]),
    },
    graph: {
      neighbourhood: vi.fn().mockResolvedValue({
        root: "finding:1",
        levels: [
          { depth: 0, nodes: ["finding:1"] },
          { depth: 1, nodes: ["sat:25544"] },
        ],
      }),
    },
    resolution: {
      accept: vi.fn().mockResolvedValue({
        ok: true,
        delta: { status: "success" },
      }),
    },
    why: {
      build: vi.fn().mockResolvedValue({
        id: "finding:1",
        label: "Root finding",
        kind: "finding",
        children: [
          {
            id: "edge:1",
            label: "crosses node",
            kind: "edge",
            sha256: "abcdef1234567890",
            sourceClass: "field",
            children: [],
          },
        ],
      }),
    },
    pcEstimator: {
      estimate: vi.fn().mockResolvedValue({
        conjunctionId: "C-1",
        medianPc: 1.2e-4,
        sigmaPc: 0.8e-4,
        p5Pc: 0.4e-4,
        p95Pc: 2.1e-4,
        fishCount: 8,
        clusters: [],
        samples: [1e-5, 4e-5, 1e-4, 5e-4],
        severity: "medium",
        methodology: "swarm-pc-estimator",
      }),
    },
    candidates: {
      propose: vi.fn().mockResolvedValue([
        {
          candidateName: "IRIDIUM 33 DEB",
          candidateNoradId: 33732,
          candidateClass: "debris",
          cosDistance: 0.32,
          overlapKm: 28,
          apogeeKm: 512,
          perigeeKm: 504,
          regime: "leo",
        },
      ]),
    },
  };
}

describe("App", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it("ignores blank submissions", async () => {
    const adapters = makeAdapters();
    const interpret = vi.fn();
    const { stdin, lastFrame } = render(
      <App
        adapters={adapters}
        interpret={interpret}
        etaEstimate={() => ({ status: "estimating" as const })}
        etaRecord={() => {}}
      />,
    );
    const input = attachReadableInput(stdin);

    await delay(50);
    await input.typeLine("   ");

    expect(interpret).not.toHaveBeenCalled();
    expect(adapters.thalamus.runCycle).not.toHaveBeenCalled();
    expect(lastFrame()).toContain("cost $0.000");
    expect(lastFrame()).not.toContain("F-1");
  });

  it("uses the explicit slash parser before interpret", async () => {
    const adapters = makeAdapters();
    const interpret = vi.fn();
    const { stdin, lastFrame } = render(
      <App
        adapters={adapters}
        interpret={interpret}
        etaEstimate={() => ({ status: "estimating" as const })}
        etaRecord={() => {}}
      />,
    );
    const input = attachReadableInput(stdin);

    await delay(50);
    await input.typeLine("/query risk", 350);

    expect(interpret).not.toHaveBeenCalled();
    expect(adapters.thalamus.runCycle).toHaveBeenCalledWith({
      query: "risk",
      cycleId: expect.any(String),
    });
    expect(lastFrame()).toContain("Research cycle produced 1 finding(s). Cost $0.420.");
    expect(lastFrame()).toContain("F-1");
    expect(lastFrame()).toContain("last: query");
  });

  it("renders every dispatch result kind from an interpreted multi-step plan", async () => {
    const adapters = makeAdapters();
    const interpret = vi.fn().mockResolvedValue({
      plan: {
        steps: [
          { action: "query", q: "show everything" },
          { action: "telemetry", satId: "25544" },
          { action: "logs", level: "warn" },
          { action: "graph", entity: "finding:1" },
          { action: "accept", suggestionId: "S-1" },
          { action: "explain", findingId: "F-1" },
          { action: "pc", conjunctionId: "C-1" },
          { action: "candidates", targetNoradId: 25544, objectClass: "debris", limit: 5 },
          { action: "clarify", question: "Which next step?", options: ["query", "logs"] },
        ],
        confidence: 0.8,
      },
      costUsd: 0.01,
    });
    const etaRecord = vi.fn();
    const { stdin, lastFrame } = render(
      <App
        adapters={adapters}
        interpret={interpret}
        etaEstimate={() => ({ status: "estimating" as const })}
        etaRecord={etaRecord}
      />,
    );
    const input = attachReadableInput(stdin);

    await delay(50);
    await input.typeLine("show everything", 400);

    expect(interpret).toHaveBeenCalledWith(
      "show everything",
      expect.arrayContaining([
        expect.objectContaining({ role: "user", content: "show everything" }),
      ]),
    );
    expect(adapters.telemetry.start).toHaveBeenCalledWith({ satId: "25544" });
    expect(adapters.logs.tail).toHaveBeenCalledWith({
      level: "warn",
      service: undefined,
      sinceMs: undefined,
    });
    expect(adapters.graph.neighbourhood).toHaveBeenCalledWith("finding:1");
    expect(adapters.resolution.accept).toHaveBeenCalledWith("S-1");
    expect(adapters.why.build).toHaveBeenCalledWith("F-1");
    expect(adapters.pcEstimator.estimate).toHaveBeenCalledWith("C-1");
    expect(adapters.candidates.propose).toHaveBeenCalledWith({
      targetNoradId: 25544,
      objectClass: "debris",
      limit: 5,
    });
    expect(etaRecord).toHaveBeenCalledTimes(9);

    const frame = lastFrame() ?? "";
    expect(frame).toContain("Research cycle produced 1 finding(s). Cost $0.420.");
    expect(frame).toContain("Telemetry · sat 25544");
    expect(frame).toContain("Logs (2)");
    expect(frame).toContain("Graph: finding:1");
    expect(frame).toContain("accepted S-1");
    expect(frame).toContain("Why: Root finding");
    expect(frame).toContain("Pc estimate · C-1");
    expect(frame).toContain("KNN candidates · target NORAD 25544 · 1 survivors");
    expect(frame).toContain("? Which next step?");
    expect(frame).toContain("last: clarify");
    expect(frame).toContain("cost $0.420");
  });

  it("shows the busy loader during a pending step and clears it once the step resolves", async () => {
    let resolveCycle:
      | ((value: {
          findings: unknown[];
          costUsd: number;
        }) => void)
      | undefined;
    const pendingCycle = new Promise<{ findings: unknown[]; costUsd: number }>((resolve) => {
      resolveCycle = resolve;
    });
    const adapters = makeAdapters();
    adapters.thalamus.runCycle.mockReturnValueOnce(pendingCycle);
    const interpret = vi.fn().mockResolvedValue({
      plan: {
        steps: [{ action: "query", q: "pending cycle" }],
        confidence: 0.7,
      },
      costUsd: 0,
    });
    const { stdin, lastFrame } = render(
      <App
        adapters={adapters}
        interpret={interpret}
        etaEstimate={() => ({
          status: "known" as const,
          p50Ms: 50,
          p95Ms: 80,
          samples: 4,
        })}
        etaRecord={() => {}}
      />,
    );
    const input = attachReadableInput(stdin);

    await delay(50);
    const typing = input.typeLine("pending cycle", 20);
    await delay(60);

    expect(lastFrame()).toContain("running: query");
    expect(lastFrame()).toContain("remaining");
    expect(lastFrame()).toContain("$0.000 so far");
    expect(lastFrame()).toContain("…");

    resolveCycle?.({
      findings: [
        {
          id: "F-2",
          summary: "Pending resolved",
          sourceClass: "OSINT",
          confidence: 0.7,
          evidenceRefs: [],
        },
      ],
      costUsd: 0.13,
    });
    await typing;
    await delay(250);

    expect(lastFrame()).not.toContain("running: query");
    expect(lastFrame()).toContain("Pending resolved");
    expect(lastFrame()).toContain("cost $0.130");
    expect(lastFrame()).toContain("last: query");
  });

  it("renders failed resolutions with the rejection marker", async () => {
    const adapters = makeAdapters();
    adapters.resolution.accept.mockResolvedValueOnce({
      ok: false,
      delta: { status: "failed" },
    });
    const interpret = vi.fn().mockResolvedValue({
      plan: {
        steps: [{ action: "accept", suggestionId: "S-2" }],
        confidence: 0.7,
      },
      costUsd: 0,
    });
    const { stdin, lastFrame } = render(
      <App
        adapters={adapters}
        interpret={interpret}
        etaEstimate={() => ({ status: "estimating" as const })}
        etaRecord={() => {}}
      />,
    );
    const input = attachReadableInput(stdin);

    await delay(50);
    await input.typeLine("reject suggestion", 250);

    expect(adapters.resolution.accept).toHaveBeenCalledWith("S-2");
    expect(lastFrame()).toContain("✗ accepted S-2");
    expect(lastFrame()).toContain("last: accept");
  });
});
