import { afterEach, describe, expect, it, vi } from "vitest";
import {
  DEFAULT_THALAMUS_BUDGETS_CONFIG,
  DEFAULT_THALAMUS_PLANNER_CONFIG,
  DEFAULT_THALAMUS_REFLEXION_CONFIG,
  StaticConfigProvider,
} from "@interview/shared/config";
import {
  ResearchCycleStatus,
  ResearchCycleTrigger,
} from "@interview/shared/enum";
import { fakePort, typedSpy } from "@interview/test-kit";
import {
  setBudgetsConfigProvider,
  setPlannerConfigProvider,
  setReflexionConfigProvider,
} from "../src/config/runtime-config";
import type { CycleLoopRunner } from "../src/services/cycle-loop.service";
import type { FindingPersister } from "../src/services/finding-persister.service";
import type { ResearchGraphService } from "../src/services/research-graph.service";
import {
  type CyclesPort,
  ThalamusService,
} from "../src/services/thalamus.service";
import type {
  ThalamusPlanner,
  DAGPlan,
} from "../src/services/thalamus-planner.service";
import type {
  ResearchCycle,
  ResearchCycleRunResult,
} from "../src/types/research.types";

function makePlan(overrides: Partial<DAGPlan> = {}): DAGPlan {
  return {
    intent: "Nominal plan",
    complexity: "moderate",
    nodes: [{ cortex: "strategist", params: {}, dependsOn: [] }],
    ...overrides,
  };
}

function makeCycle(overrides: Partial<ResearchCycle> = {}): ResearchCycle {
  return {
    id: 123n,
    triggerType: ResearchCycleTrigger.User,
    triggerSource: "Nominal query",
    userId: null,
    dagPlan: null,
    corticesUsed: ["strategist"],
    status: ResearchCycleStatus.Running,
    findingsCount: 0,
    totalCost: null,
    error: null,
    startedAt: new Date("2026-04-22T00:00:00.000Z"),
    completedAt: null,
    ...overrides,
  };
}

function makeRunResult(cycle: ResearchCycle): ResearchCycleRunResult {
  return {
    ...cycle,
    verification: {
      needsVerification: false,
      reasonCodes: [],
      targetHints: [],
      confidence: 0.9,
    },
  };
}

function createHarness() {
  const plan = typedSpy<ThalamusPlanner["plan"]>();
  const getDaemonDag = typedSpy<ThalamusPlanner["getDaemonDag"]>();
  const buildManualDag = typedSpy<ThalamusPlanner["buildManualDag"]>();
  const run = typedSpy<CycleLoopRunner["run"]>();
  const persist = typedSpy<FindingPersister["persist"]>();
  const create = typedSpy<CyclesPort["create"]>();
  const findById = typedSpy<CyclesPort["findById"]>();
  const updateStatus = typedSpy<CyclesPort["updateStatus"]>();
  const expireAndClean = typedSpy<ResearchGraphService["expireAndClean"]>();

  create.mockResolvedValue(makeCycle());
  findById.mockResolvedValue(
    makeCycle({
      status: ResearchCycleStatus.Completed,
      totalCost: 0,
      completedAt: new Date("2026-04-22T00:05:00.000Z"),
    }),
  );
  run.mockResolvedValue({
    allFindings: [],
    totalCost: 0.02,
    iterations: 1,
    finalPlan: makePlan(),
    verification: {
      needsVerification: false,
      reasonCodes: [],
      targetHints: [],
      confidence: 0.9,
    },
  });
  persist.mockResolvedValue(0);
  expireAndClean.mockResolvedValue({ expired: 0, orphans: 0 });

  const service = new ThalamusService(
    fakePort<ThalamusPlanner>({ plan, getDaemonDag, buildManualDag }),
    fakePort<CycleLoopRunner>({ run }),
    fakePort<FindingPersister>({ persist }),
    fakePort<CyclesPort>({ create, findById, updateStatus }),
    fakePort<ResearchGraphService>({ expireAndClean }),
  );

  return {
    service,
    plan,
    getDaemonDag,
    buildManualDag,
    run,
    persist,
    create,
    findById,
    updateStatus,
    expireAndClean,
  };
}

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
  vi.restoreAllMocks();
});

describe("ThalamusService.runCycle", () => {
  it("bypasses the planner when an explicit DAG is provided and falls back to the moderate budget row for unknown complexity", async () => {
    const { service, plan, getDaemonDag, run, persist } = createHarness();
    setPlannerConfigProvider(
      new StaticConfigProvider({
        ...DEFAULT_THALAMUS_PLANNER_CONFIG,
        maxCostUsd: 0.75,
      }),
    );
    setReflexionConfigProvider(
      new StaticConfigProvider({
        ...DEFAULT_THALAMUS_REFLEXION_CONFIG,
        maxIterations: 9,
      }),
    );

    const dag = JSON.parse(
      '{"intent":"Manual DAG","complexity":"wild","nodes":[{"cortex":"strategist","params":{},"dependsOn":[]}]}',
    );

    await service.runCycle({
      query: "Manual DAG",
      triggerType: ResearchCycleTrigger.User,
      dag,
    });

    expect(plan).not.toHaveBeenCalled();
    expect(getDaemonDag).not.toHaveBeenCalled();
    expect(run).toHaveBeenCalledWith(
      dag,
      123n,
      {
        maxIter: 4,
        maxCost: 0.75,
        budget: DEFAULT_THALAMUS_BUDGETS_CONFIG.moderate,
      },
      expect.objectContaining({
        hasUser: false,
      }),
    );
    expect(persist).toHaveBeenCalledWith([], {
      cycleId: 123n,
      iteration: 1,
      plan: dag,
      entityOverride: undefined,
    });
  });

  it("treats runtime null user ids as no-user context when asking the planner to build the DAG", async () => {
    const { service, plan, run } = createHarness();
    plan.mockResolvedValueOnce(makePlan({ intent: "Null user plan" }));

    const input = JSON.parse(
      '{"query":"Null user plan","triggerType":"user","userId":null}',
    );

    await service.runCycle(input);

    expect(plan).toHaveBeenCalledWith("Null user plan", { hasUser: false });
    expect(run.mock.calls[0]?.[3]).toMatchObject({
      hasUser: false,
      userId: null,
    });
  });

  it("aborts before creating a cycle when the resolved DAG is empty", async () => {
    const { service, plan, create } = createHarness();
    plan.mockResolvedValueOnce({
      intent: "Empty plan",
      complexity: "simple",
      nodes: [],
    });

    await expect(
      service.runCycle({
        query: "Empty plan",
        triggerType: ResearchCycleTrigger.User,
      }),
    ).rejects.toThrow("Planner produced empty DAG");
    expect(create).not.toHaveBeenCalled();
  });

  it("marks the cycle failed and stringifies non-Error failures from the loop", async () => {
    const { service, plan, run, updateStatus } = createHarness();
    plan.mockResolvedValueOnce(makePlan({ intent: "Failure path" }));
    const failure = "loop exploded";
    run.mockRejectedValueOnce(failure);

    await expect(
      service.runCycle({
        query: "Failure path",
        triggerType: ResearchCycleTrigger.User,
      }),
    ).rejects.toBe(failure);

    expect(run).toHaveBeenCalled();
    expect(updateStatus).toHaveBeenCalledWith(
      123n,
      ResearchCycleStatus.Failed,
      { error: "loop exploded" },
    );
  });

  it("marks the cycle failed with the error message when the loop throws an Error", async () => {
    const { service, plan, run, updateStatus } = createHarness();
    plan.mockResolvedValueOnce(makePlan({ intent: "Failure error path" }));
    run.mockRejectedValueOnce(new Error("loop crashed"));

    await expect(
      service.runCycle({
        query: "Failure error path",
        triggerType: ResearchCycleTrigger.User,
      }),
    ).rejects.toThrow("loop crashed");

    expect(updateStatus).toHaveBeenCalledWith(
      123n,
      ResearchCycleStatus.Failed,
      { error: "loop crashed" },
    );
  });

  it("uses daemon DAGs when a daemon job is provided", async () => {
    const { service, plan, getDaemonDag } = createHarness();
    getDaemonDag.mockReturnValueOnce(
      makePlan({
        intent: "Daemon DAG",
        complexity: "simple",
      }),
    );

    await service.runCycle({
      query: "Daemon DAG",
      triggerType: ResearchCycleTrigger.Daemon,
      daemonJob: "nightly-refresh",
    });

    expect(getDaemonDag).toHaveBeenCalledWith("nightly-refresh");
    expect(plan).not.toHaveBeenCalled();
  });

  it("builds a flat manual DAG when cortices are provided and no dag or daemon job wins", async () => {
    const { service, plan, getDaemonDag, buildManualDag, run } =
      createHarness();
    const manualPlan = makePlan({
      intent: "Manual cortices",
      nodes: [
        { cortex: "alpha", params: {}, dependsOn: [] },
        { cortex: "beta", params: {}, dependsOn: [] },
      ],
    });
    buildManualDag.mockReturnValueOnce(manualPlan);

    await service.runCycle({
      query: "Manual cortices",
      triggerType: ResearchCycleTrigger.User,
      cortices: ["alpha", "beta"],
    });

    expect(buildManualDag).toHaveBeenCalledWith("Manual cortices", [
      "alpha",
      "beta",
    ]);
    expect(plan).not.toHaveBeenCalled();
    expect(getDaemonDag).not.toHaveBeenCalled();
    expect(run.mock.calls[0]?.[0]).toBe(manualPlan);
  });

  it("aborts daemon cycles when no predefined DAG exists for the job", async () => {
    const { service, getDaemonDag, create } = createHarness();
    getDaemonDag.mockReturnValueOnce(null);

    await expect(
      service.runCycle({
        query: "Missing daemon DAG",
        triggerType: ResearchCycleTrigger.Daemon,
        daemonJob: "missing-job",
      }),
    ).rejects.toThrow("Planner produced empty DAG");

    expect(getDaemonDag).toHaveBeenCalledWith("missing-job");
    expect(create).not.toHaveBeenCalled();
  });
});

describe("ThalamusService wrappers", () => {
  it("runDaemonJob delegates to runCycle with daemon defaults", async () => {
    const { service } = createHarness();
    const cycle = makeRunResult(
      makeCycle({
        triggerType: ResearchCycleTrigger.Daemon,
        triggerSource: "nightly-refresh",
      }),
    );
    const runCycle = vi.spyOn(service, "runCycle").mockResolvedValueOnce(cycle);

    await expect(service.runDaemonJob("nightly-refresh")).resolves.toEqual(
      cycle,
    );
    expect(runCycle).toHaveBeenCalledWith({
      query: "Daemon job: nightly-refresh",
      triggerType: ResearchCycleTrigger.Daemon,
      triggerSource: "nightly-refresh",
      daemonJob: "nightly-refresh",
      lang: "fr",
      mode: "audit",
    });
  });

  it("maintenance forwards expireAndClean to the graph service", async () => {
    const { service, expireAndClean } = createHarness();
    expireAndClean.mockResolvedValueOnce({ expired: 4, orphans: 2 });

    await expect(service.maintenance()).resolves.toEqual({
      expired: 4,
      orphans: 2,
    });
    expect(expireAndClean).toHaveBeenCalled();
  });
});
