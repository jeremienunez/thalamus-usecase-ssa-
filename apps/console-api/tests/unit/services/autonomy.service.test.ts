import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import type { FastifyBaseLogger } from "fastify";
import {
  AutonomyService,
  type CycleOrchestratorPort,
} from "../../../src/services/autonomy.service";
import { setAutonomyConfigProvider } from "../../../src/services/autonomy-config";
import {
  DEFAULT_CONSOLE_AUTONOMY_CONFIG,
  StaticConfigProvider,
} from "@interview/shared/config";

function mockCycleRunner(): CycleOrchestratorPort {
  return {
    runThalamus: vi.fn().mockResolvedValue({ emitted: 0, costUsd: 0 }),
    runFish: vi.fn().mockResolvedValue(0),
    runBriefing: vi.fn().mockResolvedValue(0),
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

describe("AutonomyService.start intervalSec guards", () => {
  let cycles: CycleOrchestratorPort;
  let logger: FastifyBaseLogger;
  let svc: AutonomyService;

  beforeEach(() => {
    setAutonomyConfigProvider(
      new StaticConfigProvider(DEFAULT_CONSOLE_AUTONOMY_CONFIG),
    );
    cycles = mockCycleRunner();
    logger = mockLogger();
    svc = new AutonomyService(cycles, logger);
  });

  afterEach(() => {
    svc.stop();
  });

  it("clamps NaN override to the config default (45s)", async () => {
    const res = await svc.start(NaN);
    expect(res.state.intervalMs).toBe(45_000);
  });

  it("clamps negative override to 15s min", async () => {
    const res = await svc.start(-5);
    expect(res.state.intervalMs).toBe(15_000);
  });

  it("clamps overly large override to 600s max", async () => {
    const res = await svc.start(10_000);
    expect(res.state.intervalMs).toBe(600_000);
  });

  it("accepts a valid override", async () => {
    const res = await svc.start(60);
    expect(res.state.intervalMs).toBe(60_000);
  });

  it("falls back to 45s when override is Infinity", async () => {
    const res = await svc.start(Infinity);
    expect(res.state.intervalMs).toBe(45_000);
  });

  it("reads intervalSec from the config provider when override is omitted", async () => {
    setAutonomyConfigProvider(
      new StaticConfigProvider({
        ...DEFAULT_CONSOLE_AUTONOMY_CONFIG,
        intervalSec: 120,
      }),
    );

    const res = await svc.start();

    expect(res.state.intervalMs).toBe(120_000);
  });

  it("falls back to a thalamus tick when the configured rotation contains no supported actions", async () => {
    vi.useFakeTimers();
    try {
      setAutonomyConfigProvider(
        new StaticConfigProvider({
          ...DEFAULT_CONSOLE_AUTONOMY_CONFIG,
          intervalSec: 30,
          rotation: ["bogus-mode"],
        }),
      );

      const res = await svc.start();
      await vi.advanceTimersByTimeAsync(0);

      expect(res.state.running).toBe(true);
      expect(cycles.runThalamus).toHaveBeenCalledTimes(1);
      expect(cycles.runFish).not.toHaveBeenCalled();
      expect(cycles.runBriefing).not.toHaveBeenCalled();
      expect(svc.publicState().history[0]?.action).toBe("thalamus");
    } finally {
      svc.stop();
      vi.useRealTimers();
    }
  });
});
