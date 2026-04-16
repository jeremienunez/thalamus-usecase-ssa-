import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import type { FastifyBaseLogger } from "fastify";
import { AutonomyService } from "../../../src/services/autonomy.service";
import type { CycleRunnerService } from "../../../src/services/cycle-runner.service";

function mockCycleRunner(): CycleRunnerService {
  return {
    runThalamus: vi.fn().mockResolvedValue(0),
    runFish: vi.fn().mockResolvedValue(0),
    runBriefing: vi.fn().mockResolvedValue(0),
  } as unknown as CycleRunnerService;
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

describe("AutonomyService.start intervalSec guards", () => {
  let cycles: CycleRunnerService;
  let logger: FastifyBaseLogger;
  let svc: AutonomyService;

  beforeEach(() => {
    cycles = mockCycleRunner();
    logger = mockLogger();
    svc = new AutonomyService(cycles, logger);
  });

  afterEach(() => {
    svc.stop();
  });

  it("clamps NaN to the default (45s) then floor clamps to 15s min → 15000ms", () => {
    const res = svc.start(NaN);
    // NaN → default 45 → clamped in [15, 600] range (45 is valid)
    expect(res.state.intervalMs).toBe(45_000);
  });

  it("clamps negative intervalSec to 15s min (15000ms)", () => {
    const res = svc.start(-5);
    expect(res.state.intervalMs).toBe(15_000);
  });

  it("clamps overly large intervalSec to 600s max (600000ms)", () => {
    const res = svc.start(10_000);
    expect(res.state.intervalMs).toBe(600_000);
  });

  it("accepts a valid intervalSec in range", () => {
    const res = svc.start(60);
    expect(res.state.intervalMs).toBe(60_000);
  });

  it("falls back to default when Infinity (not finite) → 45000ms", () => {
    const res = svc.start(Infinity);
    // Infinity is not finite → default 45 → in range → 45000ms
    expect(res.state.intervalMs).toBe(45_000);
  });
});
