import { describe, expect, it } from "vitest";
import { fakePort, typedSpy } from "@interview/test-kit";
import {
  ResearchFindingType,
  ResearchUrgency,
} from "@interview/shared/enum";
import type { CortexFinding, DAGPlan, CortexOutput } from "../src/cortices/types";
import type { IterationBudget } from "../src/cortices/config";
import { CycleLoopRunner } from "../src/services/cycle-loop.service";
import type { ThalamusDAGExecutor } from "../src/services/thalamus-executor.service";
import type { ThalamusReflexion } from "../src/services/thalamus-reflexion.service";
import type { ThalamusPlanner } from "../src/services/thalamus-planner.service";
import type { StopCriteriaEvaluator } from "../src/services/stop-criteria.service";

function makeBudget(
  overrides: Partial<IterationBudget> = {},
): IterationBudget {
  return {
    maxIterations: 4,
    maxCost: 0.06,
    confidenceTarget: 0.8,
    coverageTarget: 0.75,
    minFindingsToStop: 2,
    ...overrides,
  };
}

function makePlan(intent: string, cortices: string[]): DAGPlan {
  return {
    intent,
    complexity: "moderate",
    nodes: cortices.map((cortex) => ({
      cortex,
      params: {},
      dependsOn: [],
    })),
  };
}

function makeFinding(
  overrides: Partial<CortexFinding> = {},
): CortexFinding {
  return {
    title: "Nominal finding",
    summary: "Nominal summary",
    findingType: ResearchFindingType.Insight,
    urgency: ResearchUrgency.Low,
    evidence: [{ source: "fixture", data: { id: 1 }, weight: 1 }],
    confidence: 0.8,
    impactScore: 4,
    edges: [],
    ...overrides,
  };
}

function makeOutput(
  findings: CortexFinding[],
  tokensUsed: number,
  model = "test-model",
): CortexOutput {
  return {
    findings,
    metadata: {
      tokensUsed,
      duration: 1,
      model,
    },
  };
}

describe("CycleLoopRunner.run", () => {
  it("stops immediately when stop criteria fires and keeps only findings above the configured threshold", async () => {
    const execute = typedSpy<ThalamusDAGExecutor["execute"]>();
    const evaluate = typedSpy<ThalamusReflexion["evaluate"]>();
    const plan = typedSpy<ThalamusPlanner["plan"]>();
    const shouldStop = typedSpy<StopCriteriaEvaluator["shouldStop"]>();

    execute.mockResolvedValue({
      outputs: new Map([
        [
          "scout",
          makeOutput(
            [
              makeFinding({
                title: "High confidence lead",
                sourceCortex: "scout",
                confidence: 0.91,
              }),
              makeFinding({
                title: "Discarded low confidence lead",
                sourceCortex: "scout",
                confidence: 0.45,
              }),
            ],
            500,
          ),
        ],
      ]),
      totalDuration: 1,
    });
    shouldStop.mockReturnValue({
      stop: true,
      reason: "cost-exhausted",
      metrics: {
        avgConfidence: 0.91,
        coverageRatio: 1,
        noveltyRatio: 1,
        noveltyThreshold: 0.42,
        corticesWithFindings: 1,
        totalCorticesInPlan: 1,
        novelFindings: 1,
      },
    });

    const runner = new CycleLoopRunner(
      fakePort<ThalamusDAGExecutor>({ execute }),
      fakePort<ThalamusReflexion>({ evaluate }),
      fakePort<ThalamusPlanner>({ plan }),
      fakePort<StopCriteriaEvaluator>({ shouldStop }),
    );
    const initialPlan = makePlan("Inspect the corridor", ["scout"]);

    const result = await runner.run(
      initialPlan,
      77n,
      {
        maxIter: 3,
        maxCost: 0.5,
        budget: makeBudget(),
      },
      {
        query: "Inspect the corridor",
        minConfidence: 0.8,
      },
    );

    expect(result.iterations).toBe(1);
    expect(result.totalCost).toBe(0.001);
    expect(result.finalPlan).toBe(initialPlan);
    expect(result.allFindings).toEqual([
      expect.objectContaining({
        title: "High confidence lead",
      }),
    ]);
    expect(evaluate).not.toHaveBeenCalled();
    expect(plan).not.toHaveBeenCalled();
    expect(shouldStop.mock.calls[0]?.[0]).toMatchObject({
      iteration: 1,
      consecutiveZeroRuns: 0,
      totalCost: 0.001,
      allFindings: [
        expect.objectContaining({ title: "High confidence lead" }),
      ],
      kept: [
        expect.objectContaining({ title: "High confidence lead" }),
      ],
    });
    expect(result.verification.reasonCodes).toContain("budget_exhausted");
  });

  it("returns after reflexion_sufficient without replanning when stop criteria allows the loop to continue", async () => {
    const execute = typedSpy<ThalamusDAGExecutor["execute"]>();
    const evaluate = typedSpy<ThalamusReflexion["evaluate"]>();
    const plan = typedSpy<ThalamusPlanner["plan"]>();
    const shouldStop = typedSpy<StopCriteriaEvaluator["shouldStop"]>();

    const keptFinding = makeFinding({
      title: "Corroborated operator shift",
      sourceCortex: "curator",
      confidence: 0.93,
    });

    execute.mockResolvedValue({
      outputs: new Map([["curator", makeOutput([keptFinding], 200)]]),
      totalDuration: 1,
    });
    shouldStop.mockReturnValue({
      stop: false,
      metrics: {
        avgConfidence: 0.93,
        coverageRatio: 1,
        noveltyRatio: 1,
        noveltyThreshold: 0.42,
        corticesWithFindings: 1,
        totalCorticesInPlan: 1,
        novelFindings: 1,
      },
    });
    evaluate.mockResolvedValue({
      replan: false,
      notes: "Evidence is sufficient.",
      gaps: [],
      overallConfidence: 0.93,
    });

    const runner = new CycleLoopRunner(
      fakePort<ThalamusDAGExecutor>({ execute }),
      fakePort<ThalamusReflexion>({ evaluate }),
      fakePort<ThalamusPlanner>({ plan }),
      fakePort<StopCriteriaEvaluator>({ shouldStop }),
    );
    const initialPlan = makePlan("Assess the shift", ["curator"]);

    const result = await runner.run(
      initialPlan,
      88n,
      {
        maxIter: 3,
        maxCost: 0.5,
        budget: makeBudget(),
      },
      {
        query: "Assess the shift",
      },
    );

    expect(result.iterations).toBe(1);
    expect(result.finalPlan).toBe(initialPlan);
    expect(plan).not.toHaveBeenCalled();
    expect(evaluate).toHaveBeenCalledWith(
      "Assess the shift",
      [keptFinding],
      [keptFinding],
      1,
      {
        complexity: "moderate",
        remainingBudget: 0.4996,
        maxIterations: 3,
      },
    );
    expect(result.verification).toEqual({
      needsVerification: false,
      reasonCodes: [],
      targetHints: [],
      confidence: 0.93,
    });
  });

  it("replans with accumulated context and carries repeated gap signatures into the next stop evaluation", async () => {
    const execute = typedSpy<ThalamusDAGExecutor["execute"]>();
    const evaluate = typedSpy<ThalamusReflexion["evaluate"]>();
    const plan = typedSpy<ThalamusPlanner["plan"]>();
    const shouldStop = typedSpy<StopCriteriaEvaluator["shouldStop"]>();

    const initialPlan = makePlan("Track this cluster", ["scout"]);
    const replannedPlan = makePlan("Track this cluster — telemetry pass", ["curator"]);
    const finalPlan = makePlan("Track this cluster — final pass", ["verifier"]);

    execute
      .mockResolvedValueOnce({
        outputs: new Map([
          [
            "scout",
            makeOutput(
              [
                makeFinding({
                  title: "Weak telemetry lead",
                  sourceCortex: "scout",
                  confidence: 0.31,
                }),
              ],
              100,
            ),
          ],
        ]),
        totalDuration: 1,
      })
      .mockResolvedValueOnce({
        outputs: new Map([
          [
            "curator",
            makeOutput(
              [
                makeFinding({
                  title: "Telemetry corroborated",
                  sourceCortex: "curator",
                  confidence: 0.92,
                }),
              ],
              200,
            ),
          ],
        ]),
        totalDuration: 1,
      })
      .mockResolvedValueOnce({
        outputs: new Map([
          [
            "verifier",
            makeOutput([], 0),
          ],
        ]),
        totalDuration: 1,
      });

    shouldStop
      .mockReturnValueOnce({ stop: false })
      .mockReturnValueOnce({ stop: false })
      .mockReturnValueOnce({ stop: true, reason: "cost-exhausted" });

    evaluate
      .mockResolvedValueOnce({
        replan: true,
        notes: "Need more telemetry.",
        gaps: ["Coverage gap", "Telemetry gap"],
        overallConfidence: 0.33,
      })
      .mockResolvedValueOnce({
        replan: true,
        notes: "Need more telemetry.",
        gaps: [" telemetry gap ", "coverage gap"],
        overallConfidence: 0.58,
      });

    plan
      .mockResolvedValueOnce(replannedPlan)
      .mockResolvedValueOnce(finalPlan);

    const runner = new CycleLoopRunner(
      fakePort<ThalamusDAGExecutor>({ execute }),
      fakePort<ThalamusReflexion>({ evaluate }),
      fakePort<ThalamusPlanner>({ plan }),
      fakePort<StopCriteriaEvaluator>({ shouldStop }),
    );

    const result = await runner.run(
      initialPlan,
      99n,
      {
        maxIter: 3,
        maxCost: 0.5,
        budget: makeBudget(),
      },
      {
        query: "Track this cluster",
        hasUser: true,
      },
    );

    expect(result.iterations).toBe(3);
    expect(result.totalCost).toBeCloseTo(0.0006, 10);
    expect(result.finalPlan).toBe(finalPlan);
    expect(result.allFindings).toEqual([
      expect.objectContaining({ title: "Telemetry corroborated" }),
    ]);
    expect(shouldStop.mock.calls[0]?.[0]).toMatchObject({
      iteration: 1,
      consecutiveZeroRuns: 1,
      consecutiveIdenticalGaps: 0,
      kept: [],
    });
    expect(shouldStop.mock.calls[1]?.[0]).toMatchObject({
      iteration: 2,
      consecutiveZeroRuns: 0,
      consecutiveIdenticalGaps: 0,
      kept: [expect.objectContaining({ title: "Telemetry corroborated" })],
    });
    expect(shouldStop.mock.calls[2]?.[0]).toMatchObject({
      iteration: 3,
      consecutiveZeroRuns: 1,
      consecutiveIdenticalGaps: 1,
    });
    expect(plan.mock.calls[0]).toEqual([
      "Track this cluster\n\nIteration 1. Previous findings: \nGaps: Coverage gap, Telemetry gap",
      { hasUser: true },
    ]);
    expect(plan.mock.calls[1]).toEqual([
      "Track this cluster\n\nIteration 2. Previous findings: Telemetry corroborated\nGaps:  telemetry gap , coverage gap",
      { hasUser: true },
    ]);
    expect(result.verification.reasonCodes).toEqual(
      expect.arrayContaining([
        "replan_requested",
        "low_confidence_round",
        "budget_exhausted",
        "low_overall_confidence",
        "data_gap",
      ]),
    );
  });

  it("threads AbortSignal through executor, reflexion, and replanning", async () => {
    const execute = typedSpy<ThalamusDAGExecutor["execute"]>();
    const evaluate = typedSpy<ThalamusReflexion["evaluate"]>();
    const plan = typedSpy<ThalamusPlanner["plan"]>();
    const shouldStop = typedSpy<StopCriteriaEvaluator["shouldStop"]>();
    const controller = new AbortController();
    const initialPlan = makePlan("Trace abortable loop", ["scout"]);
    const replannedPlan = makePlan("Trace abortable loop - pass 2", ["curator"]);

    execute
      .mockResolvedValueOnce({
        outputs: new Map([
          [
            "scout",
            makeOutput([
              makeFinding({
                title: "Abortable lead",
                sourceCortex: "scout",
                confidence: 0.91,
              }),
            ]),
          ],
        ]),
        totalDuration: 1,
      })
      .mockResolvedValueOnce({
        outputs: new Map([["curator", makeOutput([])]]),
        totalDuration: 1,
      });
    shouldStop
      .mockReturnValueOnce({ stop: false })
      .mockReturnValueOnce({ stop: true, reason: "max-iterations" });
    evaluate.mockResolvedValueOnce({
      replan: true,
      notes: "Need one more pass.",
      gaps: ["coverage"],
      overallConfidence: 0.75,
    });
    plan.mockResolvedValueOnce(replannedPlan);

    const runner = new CycleLoopRunner(
      fakePort<ThalamusDAGExecutor>({ execute }),
      fakePort<ThalamusReflexion>({ evaluate }),
      fakePort<ThalamusPlanner>({ plan }),
      fakePort<StopCriteriaEvaluator>({ shouldStop }),
    );

    await runner.run(
      initialPlan,
      100n,
      {
        maxIter: 2,
        maxCost: 0.5,
        budget: makeBudget({ maxIterations: 2 }),
      },
      {
        query: "Trace abortable loop",
        hasUser: true,
        signal: controller.signal,
      },
    );

    expect(execute.mock.calls[0]?.[5]).toBe(controller.signal);
    expect(evaluate.mock.calls[0]?.[4]).toMatchObject({
      signal: controller.signal,
    });
    expect(plan.mock.calls[0]).toEqual([
      "Trace abortable loop\n\nIteration 1. Previous findings: Abortable lead\nGaps: coverage",
      { hasUser: true, signal: controller.signal },
    ]);
  });

  it("stops on a repeated gap plateau before issuing another replan", async () => {
    const execute = typedSpy<ThalamusDAGExecutor["execute"]>();
    const evaluate = typedSpy<ThalamusReflexion["evaluate"]>();
    const plan = typedSpy<ThalamusPlanner["plan"]>();
    const shouldStop = typedSpy<StopCriteriaEvaluator["shouldStop"]>();

    const initialPlan = makePlan("Plateau probe", ["scout"]);
    const pass2 = makePlan("Plateau probe - pass 2", ["curator"]);
    const pass3 = makePlan("Plateau probe - pass 3", ["verifier"]);

    execute.mockResolvedValue({
      outputs: new Map([["scout", makeOutput([], 0)]]),
      totalDuration: 1,
    });
    shouldStop.mockReturnValue({ stop: false });
    evaluate
      .mockResolvedValueOnce({
        replan: true,
        notes: "Need coverage.",
        gaps: ["coverage"],
        overallConfidence: 0.4,
      })
      .mockResolvedValueOnce({
        replan: true,
        notes: "Need coverage.",
        gaps: ["coverage"],
        overallConfidence: 0.4,
      })
      .mockResolvedValueOnce({
        replan: true,
        notes: "Need coverage.",
        gaps: ["coverage"],
        overallConfidence: 0.4,
      });
    plan.mockResolvedValueOnce(pass2).mockResolvedValueOnce(pass3);

    const runner = new CycleLoopRunner(
      fakePort<ThalamusDAGExecutor>({ execute }),
      fakePort<ThalamusReflexion>({ evaluate }),
      fakePort<ThalamusPlanner>({ plan }),
      fakePort<StopCriteriaEvaluator>({ shouldStop }),
    );

    const result = await runner.run(
      initialPlan,
      110n,
      {
        maxIter: 4,
        maxCost: 0.5,
        budget: makeBudget({ maxIterations: 4 }),
      },
      {
        query: "Plateau probe",
      },
    );

    expect(result.iterations).toBe(3);
    expect(result.finalPlan).toBe(pass3);
    expect(evaluate).toHaveBeenCalledTimes(3);
    expect(plan).toHaveBeenCalledTimes(2);
  });

  it("replans without explicit gaps and exits on the iteration limit without a final reflexion pass", async () => {
    const execute = typedSpy<ThalamusDAGExecutor["execute"]>();
    const evaluate = typedSpy<ThalamusReflexion["evaluate"]>();
    const plan = typedSpy<ThalamusPlanner["plan"]>();
    const shouldStop = typedSpy<StopCriteriaEvaluator["shouldStop"]>();

    const initialPlan = makePlan("Probe the corridor", ["scout"]);
    const replannedPlan = makePlan(
      "Probe the corridor — corroboration pass",
      ["verifier"],
    );

    execute
      .mockResolvedValueOnce({
        outputs: new Map([
          [
            "scout",
            makeOutput(
              [
                makeFinding({
                  title: "Weak corridor lead",
                  sourceCortex: "scout",
                  confidence: 0.42,
                }),
              ],
              60,
            ),
          ],
        ]),
        totalDuration: 1,
      })
      .mockResolvedValueOnce({
        outputs: new Map([
          [
            "verifier",
            makeOutput(
              [
                makeFinding({
                  title: "Verified corridor shift",
                  sourceCortex: "verifier",
                  confidence: 0.91,
                }),
              ],
              140,
            ),
          ],
        ]),
        totalDuration: 1,
      });

    shouldStop
      .mockReturnValueOnce({ stop: false })
      .mockReturnValueOnce({ stop: false });
    evaluate.mockResolvedValueOnce({
      replan: true,
      notes: "Try a corroboration pass.",
      overallConfidence: 0.42,
    });
    plan.mockResolvedValueOnce(replannedPlan);

    const runner = new CycleLoopRunner(
      fakePort<ThalamusDAGExecutor>({ execute }),
      fakePort<ThalamusReflexion>({ evaluate }),
      fakePort<ThalamusPlanner>({ plan }),
      fakePort<StopCriteriaEvaluator>({ shouldStop }),
    );

    const result = await runner.run(
      initialPlan,
      111n,
      {
        maxIter: 2,
        maxCost: 0.5,
        budget: makeBudget({ maxIterations: 2 }),
      },
      {
        query: "Probe the corridor",
      },
    );

    expect(result.iterations).toBe(2);
    expect(result.totalCost).toBeCloseTo(0.0004, 10);
    expect(result.finalPlan).toBe(replannedPlan);
    expect(evaluate).toHaveBeenCalledTimes(1);
    expect(plan).toHaveBeenCalledTimes(1);
    expect(plan.mock.calls[0]).toEqual([
      "Probe the corridor\n\nIteration 1. Previous findings: \nGaps: need more evidence",
      { hasUser: undefined },
    ]);
    expect(shouldStop.mock.calls[0]?.[0]).toMatchObject({
      iteration: 1,
      consecutiveZeroRuns: 1,
      kept: [],
    });
    expect(shouldStop.mock.calls[1]?.[0]).toMatchObject({
      iteration: 2,
      consecutiveZeroRuns: 0,
      plan: replannedPlan,
      kept: [expect.objectContaining({ title: "Verified corridor shift" })],
    });
    expect(result.verification.reasonCodes).toEqual(
      expect.arrayContaining([
        "replan_requested",
        "iteration_limit_reached",
        "low_confidence_round",
        "low_overall_confidence",
      ]),
    );
  });
});
