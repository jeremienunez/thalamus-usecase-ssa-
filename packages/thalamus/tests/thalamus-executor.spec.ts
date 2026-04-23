import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  DEFAULT_THALAMUS_CORTEX_CONFIG,
  DEFAULT_THALAMUS_PLANNER_CONFIG,
  StaticConfigProvider,
} from "@interview/shared/config";
import {
  ResearchFindingType,
  ResearchUrgency,
} from "@interview/shared/enum";
import { fakePort, typedSpy } from "@interview/test-kit";
import type { CortexExecutor } from "../src/cortices/executor";
import type { CortexFinding, CortexOutput } from "../src/cortices/types";
import {
  setCortexConfigProvider,
  setPlannerConfigProvider,
} from "../src/config/runtime-config";
import { ThalamusDAGExecutor } from "../src/services/thalamus-executor.service";

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
    impactScore: 3,
    edges: [],
    ...overrides,
  };
}

function makeOutput(
  findings: CortexFinding[],
  tokensUsed = 0,
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

async function expectTimeoutAfter(
  expectedMs: number,
  plannerPatch: Partial<typeof DEFAULT_THALAMUS_PLANNER_CONFIG>,
  cortexName: string,
  cortexOverrides: typeof DEFAULT_THALAMUS_CORTEX_CONFIG["overrides"] = {},
): Promise<Awaited<ReturnType<ThalamusDAGExecutor["execute"]>>> {
  vi.useFakeTimers();
  setPlannerConfigProvider(
    new StaticConfigProvider({
      ...DEFAULT_THALAMUS_PLANNER_CONFIG,
      cortexTimeoutMs: 10,
      provider: "openai",
      model: "gpt-test",
      reasoningEffort: "low",
      thinking: false,
      ...plannerPatch,
    }),
  );
  setCortexConfigProvider(
    new StaticConfigProvider({
      overrides: cortexOverrides,
    }),
  );

  const execute = typedSpy<CortexExecutor["execute"]>();
  execute.mockImplementation(async () => new Promise<CortexOutput>(() => {}));

  const service = new ThalamusDAGExecutor(fakePort<CortexExecutor>({ execute }));
  let settled = false;
  const run = service
    .execute(
      {
        intent: "Timeout probe",
        complexity: "simple",
        nodes: [{ cortex: cortexName, params: {}, dependsOn: [] }],
      },
      1n,
    )
    .then((value) => {
      settled = true;
      return value;
    });

  await vi.advanceTimersByTimeAsync(expectedMs - 1);
  expect(settled).toBe(false);

  await vi.advanceTimersByTimeAsync(1);
  const result = await run;
  expect(settled).toBe(true);
  expect(result.outputs.get(cortexName)).toEqual({
    findings: [],
    metadata: { tokensUsed: 0, duration: 0, model: "error" },
  });
  return result;
}

beforeEach(() => {
  setPlannerConfigProvider(
    new StaticConfigProvider(DEFAULT_THALAMUS_PLANNER_CONFIG),
  );
  setCortexConfigProvider(new StaticConfigProvider(DEFAULT_THALAMUS_CORTEX_CONFIG));
});

afterEach(() => {
  setPlannerConfigProvider(
    new StaticConfigProvider(DEFAULT_THALAMUS_PLANNER_CONFIG),
  );
  setCortexConfigProvider(new StaticConfigProvider(DEFAULT_THALAMUS_CORTEX_CONFIG));
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe("ThalamusDAGExecutor.execute", () => {
  it("passes upstream findings into dependent node context", async () => {
    const execute = typedSpy<CortexExecutor["execute"]>();
    execute.mockImplementation(async (cortexName) => {
      if (cortexName === "alpha") {
        return makeOutput([
          makeFinding({
            title: "Alpha corroboration",
            summary: "Alpha summary",
            confidence: 0.91,
          }),
        ]);
      }
      return makeOutput([]);
    });

    const service = new ThalamusDAGExecutor(fakePort<CortexExecutor>({ execute }));

    const result = await service.execute(
      {
        intent: "Chain the nodes",
        complexity: "simple",
        nodes: [
          { cortex: "alpha", params: {}, dependsOn: [] },
          { cortex: "beta", params: {}, dependsOn: ["alpha"] },
        ],
      },
      7n,
      "en",
      "audit",
    );

    expect(result.outputs.get("alpha")).toEqual(
      makeOutput([
        makeFinding({
          title: "Alpha corroboration",
          summary: "Alpha summary",
          confidence: 0.91,
        }),
      ]),
    );
    expect(execute.mock.calls[1]?.[1]).toMatchObject({
      query: "Chain the nodes",
      context: {
        previousFindings: [
          {
            title: "Alpha corroboration",
            summary: "Alpha summary",
            confidence: 0.91,
          },
        ],
      },
    });
  });

  it("forces execution of unresolvable nodes and falls back to an error output when the cortex times out", async () => {
    vi.useFakeTimers();
    setPlannerConfigProvider(
      new StaticConfigProvider({
        ...DEFAULT_THALAMUS_PLANNER_CONFIG,
        cortexTimeoutMs: 100,
      }),
    );
    setCortexConfigProvider(
      new StaticConfigProvider({
        overrides: {
          slow: { callTimeoutMs: 5 },
        },
      }),
    );

    const execute = typedSpy<CortexExecutor["execute"]>();
    execute.mockImplementation(async () => new Promise<CortexOutput>(() => {}));

    const service = new ThalamusDAGExecutor(fakePort<CortexExecutor>({ execute }));
    let settled = false;
    const run = service
      .execute(
        {
          intent: "Ghost dependency",
          complexity: "simple",
          nodes: [{ cortex: "slow", params: {}, dependsOn: ["ghost"] }],
        },
        9n,
      )
      .then((value) => {
        settled = true;
        return value;
      });

    await vi.advanceTimersByTimeAsync(4);
    expect(settled).toBe(false);

    await vi.advanceTimersByTimeAsync(1);
    const result = await run;

    expect(execute).toHaveBeenCalledWith(
      "slow",
      expect.objectContaining({
        context: undefined,
      }),
    );
    expect(result.outputs.get("slow")).toEqual({
      findings: [],
      metadata: { tokensUsed: 0, duration: 0, model: "error" },
    });
  });

  it("falls back to an error output when the cortex rejects with a non-Error value", async () => {
    const execute = typedSpy<CortexExecutor["execute"]>();
    execute.mockRejectedValueOnce("plain rejection");

    const service = new ThalamusDAGExecutor(fakePort<CortexExecutor>({ execute }));

    const result = await service.execute(
      {
        intent: "Reject plainly",
        complexity: "simple",
        nodes: [{ cortex: "alpha", params: {}, dependsOn: [] }],
      },
      10n,
    );

    expect(result.outputs.get("alpha")).toEqual({
      findings: [],
      metadata: { tokensUsed: 0, duration: 0, model: "error" },
    });
  });

  it("uses the static payload_profiler timeout override", async () => {
    const result = await expectTimeoutAfter(180_000, {}, "payload_profiler");

    expect(result.outputs.get("payload_profiler")?.metadata.model).toBe("error");
  });

  it("scales timeout to xhigh reasoning effort", async () => {
    const result = await expectTimeoutAfter(60, { reasoningEffort: "xhigh" }, "alpha");

    expect(result.outputs.get("alpha")?.metadata.model).toBe("error");
  });

  it("applies the high-effort minimax timeout floor", async () => {
    const result = await expectTimeoutAfter(
      30,
      { provider: "minimax", reasoningEffort: "high" },
      "alpha",
    );

    expect(result.outputs.get("alpha")?.metadata.model).toBe("error");
  });

  it("honors cortex-level thinking and local model overrides when computing timeouts", async () => {
    const result = await expectTimeoutAfter(
      30,
      {},
      "alpha",
      {
        alpha: {
          thinking: true,
          model: "local/phi-4",
        },
      },
    );

    expect(result.outputs.get("alpha")?.metadata.model).toBe("error");
  });
});
