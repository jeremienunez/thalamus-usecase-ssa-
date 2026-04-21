import { describe, it, expect, vi, beforeEach } from "vitest";
import type { FastifyBaseLogger } from "fastify";
import {
  CycleRunnerService,
  type ThalamusDep,
  type SweepDep,
} from "../../../src/services/cycle-runner.service";

function mockThalamus(): ThalamusDep {
  return {
    thalamusService: {
      runCycle: vi.fn().mockResolvedValue({
        id: 77n,
        findingsCount: 2,
        totalCost: 1.25,
      }),
    },
    graphService: {
      listFindings: vi.fn().mockResolvedValue([
        {
          id: 501n,
          researchCycleId: 77n,
          title: "Current cycle finding",
          summary: "Projected from the graph service.",
          confidence: 0.82,
        },
        {
          id: 999n,
          researchCycleId: 12n,
          title: "Stale finding",
          summary: "Must not leak into the run response when the cycle id matches.",
          confidence: 0.95,
        },
      ]),
    },
  };
}

function mockSweep(): SweepDep {
  return {
    nanoSweepService: {
      sweep: vi.fn().mockResolvedValue({ suggestionsStored: 3 }),
    },
  };
}

function mockLogger(): FastifyBaseLogger {
  const l = {
    error: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    debug: vi.fn(),
    trace: vi.fn(),
    fatal: vi.fn(),
    child: () => l,
    level: "info",
    silent: vi.fn(),
  };
  return l as unknown as FastifyBaseLogger;
}

describe("CycleRunnerService.listHistory defensive copy", () => {
  let svc: CycleRunnerService;

  beforeEach(() => {
    svc = new CycleRunnerService(mockThalamus(), mockSweep(), mockLogger());
  });

  it("returns a new array reference on each call", async () => {
    const { cycle } = await svc.runUserCycle("thalamus", "test query");
    const a = svc.listHistory();
    const b = svc.listHistory();
    expect(cycle.error).toBeUndefined();
    expect(cycle.findingsEmitted).toBe(2);
    expect(cycle.findings).toEqual([
      {
        id: "501",
        title: "Current cycle finding",
        summary: "Projected from the graph service.",
        sourceClass: "KG",
        confidence: 0.82,
        evidenceRefs: [],
      },
    ]);
    expect(a).not.toBe(b); // different references
    expect(a).toEqual(b); // same contents
  });

  it("mutations on the returned array do not leak into subsequent calls", async () => {
    await svc.runUserCycle("thalamus", "test query");
    const first = svc.listHistory();
    expect(first.length).toBe(1);
    first.push({
      id: "injected",
      kind: "thalamus",
      startedAt: "",
      completedAt: "",
      findingsEmitted: 99,
      cortices: [],
    });
    first.length = 0;
    const second = svc.listHistory();
    expect(second.length).toBe(1);
    expect(second[0]!.id).not.toBe("injected");
    expect(second[0]!.findingsEmitted).toBe(2);
    expect(second[0]!.error).toBeUndefined();
  });
});
