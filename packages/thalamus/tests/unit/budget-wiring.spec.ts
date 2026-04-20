import { afterEach, describe, expect, it, vi } from "vitest";
import {
  DEFAULT_THALAMUS_BUDGETS_CONFIG,
  DEFAULT_THALAMUS_PLANNER_CONFIG,
  DEFAULT_THALAMUS_REFLEXION_CONFIG,
  StaticConfigProvider,
} from "@interview/shared/config";
import { ResearchCycleTrigger, ResearchCycleStatus } from "@interview/shared/enum";
import {
  setBudgetsConfigProvider,
  setPlannerConfigProvider,
  setReflexionConfigProvider,
  ThalamusService,
} from "@interview/thalamus";

describe("ThalamusService respects thalamus.budgets provider", () => {
  afterEach(() => {
    setBudgetsConfigProvider(
      new StaticConfigProvider(DEFAULT_THALAMUS_BUDGETS_CONFIG),
    );
    setPlannerConfigProvider(
      new StaticConfigProvider(DEFAULT_THALAMUS_PLANNER_CONFIG),
    );
    setReflexionConfigProvider(
      new StaticConfigProvider(DEFAULT_THALAMUS_REFLEXION_CONFIG),
    );
  });

  it("uses the patched deep budget row when computing the loop budget", async () => {
    setBudgetsConfigProvider(
      new StaticConfigProvider({
        ...DEFAULT_THALAMUS_BUDGETS_CONFIG,
        deep: { ...DEFAULT_THALAMUS_BUDGETS_CONFIG.deep, maxCost: 0.25 },
      }),
    );
    setPlannerConfigProvider(
      new StaticConfigProvider({
        ...DEFAULT_THALAMUS_PLANNER_CONFIG,
        maxCostUsd: 0,
      }),
    );

    let observed:
      | {
          maxIter: number;
          maxCost: number;
          budget: { maxCost: number };
        }
      | undefined;

    const planner = {
      plan: vi.fn(async () => ({
        intent: "deep probe",
        complexity: "deep",
        nodes: [{ cortex: "strategist", dependsOn: [] }],
      })),
    } as any;
    const cycleLoop = {
      run: vi.fn(async (_plan, _cycleId, budget) => {
        observed = budget;
        return {
          allFindings: [],
          totalCost: 0,
          iterations: 1,
          finalPlan: {
            intent: "deep probe",
            complexity: "deep",
            nodes: [{ cortex: "strategist", dependsOn: [] }],
          },
          verification: {
            needsVerification: false,
            reasonCodes: [],
            targetHints: [],
            confidence: 0,
          },
        };
      }),
    } as any;
    const persister = {
      persist: vi.fn(async () => 0),
    } as any;
    const cycleRepo = {
      create: vi.fn(async () => ({
        id: 123n,
        triggerType: ResearchCycleTrigger.User,
        triggerSource: "deep probe",
        userId: null,
        dagPlan: null,
        corticesUsed: ["strategist"],
        status: ResearchCycleStatus.Running,
        findingsCount: 0,
        totalCost: null,
        error: null,
        startedAt: new Date(),
        completedAt: null,
      })),
      updateStatus: vi.fn(async () => {}),
      findById: vi.fn(async () => ({
        id: 123n,
        triggerType: ResearchCycleTrigger.User,
        triggerSource: "deep probe",
        userId: null,
        dagPlan: null,
        corticesUsed: ["strategist"],
        status: ResearchCycleStatus.Completed,
        findingsCount: 0,
        totalCost: 0,
        error: null,
        startedAt: new Date(),
        completedAt: new Date(),
      })),
    } as any;
    const graphService = {} as any;
    const svc = new ThalamusService(
      planner,
      cycleLoop,
      persister,
      cycleRepo,
      graphService,
    );

    await svc.runCycle({
      query: "deep probe",
      triggerType: ResearchCycleTrigger.User,
    });

    expect(cycleLoop.run).toHaveBeenCalled();
    expect(observed).toBeDefined();
    expect(observed?.maxIter).toBe(2);
    expect(observed?.maxCost).toBe(0.1);
    expect(observed?.budget.maxCost).toBeCloseTo(0.25, 5);
  });
});
