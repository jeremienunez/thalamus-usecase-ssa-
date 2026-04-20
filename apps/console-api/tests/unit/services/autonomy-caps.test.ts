import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  DEFAULT_CONSOLE_AUTONOMY_CONFIG,
  StaticConfigProvider,
} from "@interview/shared/config";
import { setAutonomyConfigProvider } from "../../../src/services/autonomy-config";
import { AutonomyService } from "../../../src/services/autonomy.service";
import { SpendLedger } from "../../../src/services/spend-ledger";

const silentLogger: any = {
  info: () => {},
  warn: () => {},
  error: () => {},
  debug: () => {},
  child: () => silentLogger,
  level: "silent",
};

describe("AutonomyService caps", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
    setAutonomyConfigProvider(
      new StaticConfigProvider(DEFAULT_CONSOLE_AUTONOMY_CONFIG),
    );
  });

  it("stops in the same tick once the daily cap is reached", async () => {
    setAutonomyConfigProvider(
      new StaticConfigProvider({
        ...DEFAULT_CONSOLE_AUTONOMY_CONFIG,
        intervalSec: 30,
        rotation: ["thalamus"],
        dailyBudgetUsd: 0.05,
        stopOnBudgetExhausted: true,
      }),
    );
    const cycles = {
      runThalamus: vi.fn(async () => ({ emitted: 1, costUsd: 0.03 })),
      runFish: vi.fn(async () => 0),
      runBriefing: vi.fn(async () => 0),
    };
    const svc = new AutonomyService(cycles, silentLogger, new SpendLedger());

    await svc.start();
    await vi.advanceTimersByTimeAsync(0);
    await vi.advanceTimersByTimeAsync(30_000);
    await vi.advanceTimersByTimeAsync(0);

    const state = svc.publicState();
    expect(state.running).toBe(false);
    expect(state.stoppedReason).toBe("daily_budget_exhausted");
    expect(cycles.runThalamus).toHaveBeenCalledTimes(2);
    expect(state.dailySpendUsd).toBeCloseTo(0.06, 5);
  });

  it("respects maxThalamusCyclesPerDay and does not count fish-swarm ticks", async () => {
    setAutonomyConfigProvider(
      new StaticConfigProvider({
        ...DEFAULT_CONSOLE_AUTONOMY_CONFIG,
        intervalSec: 30,
        rotation: ["fish-swarm", "thalamus"],
        dailyBudgetUsd: 0,
        monthlyBudgetUsd: 0,
        maxThalamusCyclesPerDay: 1,
        stopOnBudgetExhausted: true,
      }),
    );
    const cycles = {
      runThalamus: vi.fn(async () => ({ emitted: 1, costUsd: 0 })),
      runFish: vi.fn(async () => 0),
      runBriefing: vi.fn(async () => 2),
    };
    const svc = new AutonomyService(cycles, silentLogger, new SpendLedger());

    await svc.start();
    await vi.advanceTimersByTimeAsync(0);
    await vi.advanceTimersByTimeAsync(30_000);
    await vi.advanceTimersByTimeAsync(0);

    const state = svc.publicState();
    expect(state.running).toBe(false);
    expect(state.stoppedReason).toBe("max_thalamus_cycles_per_day");
    expect(cycles.runThalamus).toHaveBeenCalledTimes(1);
    expect(cycles.runBriefing).toHaveBeenCalledTimes(1);
    expect(state.thalamusCyclesToday).toBe(1);
  });

  it("reschedules the timer when intervalSec changes live", async () => {
    let intervalSec = 30;
    setAutonomyConfigProvider({
      async get() {
        return {
          ...DEFAULT_CONSOLE_AUTONOMY_CONFIG,
          intervalSec,
          rotation: ["thalamus"],
        };
      },
    });
    const cycles = {
      runThalamus: vi.fn(async () => ({ emitted: 1, costUsd: 0 })),
      runFish: vi.fn(async () => 0),
      runBriefing: vi.fn(async () => 0),
    };
    const svc = new AutonomyService(cycles, silentLogger, new SpendLedger());

    await svc.start();
    await vi.advanceTimersByTimeAsync(0);
    intervalSec = 15;
    await vi.advanceTimersByTimeAsync(30_000);
    await vi.advanceTimersByTimeAsync(0);
    await vi.advanceTimersByTimeAsync(15_000);
    await vi.advanceTimersByTimeAsync(0);

    expect(cycles.runThalamus.mock.calls.length).toBeGreaterThanOrEqual(3);
    svc.stop();
  });
});
