/**
 * BDD — CycleRunnerService.runUserCycle(kind="thalamus") must expose the
 * graph-side findings + costUsd on the returned CycleRun so the HTTP
 * response contract can serve /api/cycles/run to the CLI HTTP client.
 *
 * Older responses only exposed `findingsEmitted` (count) which was enough
 * for the console UI but insufficient for the CLI's `thalamus.runCycle`
 * adapter. Plan 2026-04-19-thalamus-agnosticity-cleanup Task 7.1 requires
 * the CLI to consume this HTTP contract instead of building a local
 * ThalamusContainer — hence the additive fields.
 */
import { describe, it, expect, vi } from "vitest";
import type { FastifyBaseLogger } from "fastify";
import {
  CycleRunnerService,
  type ThalamusDep,
  type SweepDep,
} from "../../../src/services/cycle-runner.service";

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

const sampleFindings = [
  {
    id: 11n,
    researchCycleId: 42n,
    title: "t-1",
    summary: "s-1",
    confidence: 0.9,
  },
  {
    id: 12n,
    researchCycleId: 42n,
    title: "t-2",
    summary: "s-2",
    confidence: 0.8,
  },
  {
    // Different cycle: must be filtered out when scoping to current run.
    id: 13n,
    researchCycleId: 99n,
    title: "t-older",
    summary: "stale",
    confidence: 0.7,
  },
];

function mockThalamus(overrides?: Partial<ThalamusDep>): ThalamusDep {
  return {
    thalamusService: {
      runCycle: vi.fn().mockResolvedValue({
        id: 42n,
        findingsCount: 2,
        totalCost: 0.123,
      }),
    },
    graphService: {
      listFindings: vi.fn().mockResolvedValue(sampleFindings),
    },
    ...overrides,
  };
}

function mockSweep(): SweepDep {
  return {
    nanoSweepService: {
      sweep: vi.fn().mockResolvedValue({ suggestionsStored: 3 }),
    },
  };
}

describe("CycleRunnerService.runUserCycle — thalamus findings projection", () => {
  it("given a thalamus kind, when the cycle runs, then findings + costUsd land on the returned cycle", async () => {
    const thalamus = mockThalamus();
    const svc = new CycleRunnerService(thalamus, mockSweep(), mockLogger());

    const { cycle } = await svc.runUserCycle("thalamus", "liste operateurs LEO");

    expect(cycle.error).toBeUndefined();
    expect(cycle.findingsEmitted).toBe(2);
    expect(cycle.costUsd).toBeCloseTo(0.123);
    // Findings scoped to the current cycle (42n), stale cycle 99n dropped.
    expect(cycle.findings).toHaveLength(2);
    expect(cycle.findings!.map((f) => f.id)).toEqual(["11", "12"]);
    const first = cycle.findings![0]!;
    expect(first.title).toBe("t-1");
    expect(first.summary).toBe("s-1");
    expect(first.confidence).toBe(0.9);
    expect(first.sourceClass).toBe("KG");
    expect(Array.isArray(first.evidenceRefs)).toBe(true);
  });

  it("given kind=fish, when the cycle runs, then findings/costUsd are absent (sweep path unchanged)", async () => {
    const svc = new CycleRunnerService(
      mockThalamus(),
      mockSweep(),
      mockLogger(),
    );
    const { cycle } = await svc.runUserCycle("fish", "scan");
    expect(cycle.findings).toBeUndefined();
    expect(cycle.costUsd).toBeUndefined();
    expect(cycle.findingsEmitted).toBe(3);
  });

  it("given no cycle-scoped findings, when the thalamus cycle runs, then falls back to the full listing", async () => {
    // Simulate a runCycle id that doesn't match any graphService finding.
    const thalamus = mockThalamus({
      thalamusService: {
        runCycle: vi.fn().mockResolvedValue({
          id: 777n,
          findingsCount: 2,
          totalCost: 0.05,
        }),
      },
    });
    const svc = new CycleRunnerService(thalamus, mockSweep(), mockLogger());
    const { cycle } = await svc.runUserCycle("thalamus", "q");
    // Fallback: listFindings returned 3 rows, none matched cycle 777 — so
    // we surface the full listing to avoid a silent empty payload.
    expect(cycle.findings).toHaveLength(3);
  });
});
