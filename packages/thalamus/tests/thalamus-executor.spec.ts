import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  DEFAULT_THALAMUS_CORTEX_CONFIG,
  DEFAULT_THALAMUS_PLANNER_CONFIG,
  StaticConfigProvider,
} from "@interview/shared/config";
import { ResearchFindingType, ResearchUrgency } from "@interview/shared/enum";
import { fakePort, typedSpy } from "@interview/test-kit";
import type { CortexExecutor } from "../src/cortices/executor";
import type { CortexFinding, CortexOutput } from "../src/cortices/types";
import {
  setCortexConfigProvider,
  setPlannerConfigProvider,
} from "../src/config/runtime-config";
import { DagValidationError } from "../src/services/dag-validation";
import { ThalamusDAGExecutor } from "../src/services/thalamus-executor.service";

function makeFinding(overrides: Partial<CortexFinding> = {}): CortexFinding {
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
  cortexOverrides: (typeof DEFAULT_THALAMUS_CORTEX_CONFIG)["overrides"] = {},
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
  let capturedSignal: AbortSignal | undefined;
  execute.mockImplementation(
    async (_cortexName, input) =>
      new Promise<CortexOutput>(() => {
        capturedSignal = input.signal;
      }),
  );

  const service = new ThalamusDAGExecutor(
    fakePort<CortexExecutor>({ execute }),
  );
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
  expect(capturedSignal?.aborted).toBe(true);
  return result;
}

beforeEach(() => {
  setPlannerConfigProvider(
    new StaticConfigProvider(DEFAULT_THALAMUS_PLANNER_CONFIG),
  );
  setCortexConfigProvider(
    new StaticConfigProvider(DEFAULT_THALAMUS_CORTEX_CONFIG),
  );
});

afterEach(() => {
  setPlannerConfigProvider(
    new StaticConfigProvider(DEFAULT_THALAMUS_PLANNER_CONFIG),
  );
  setCortexConfigProvider(
    new StaticConfigProvider(DEFAULT_THALAMUS_CORTEX_CONFIG),
  );
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

    const service = new ThalamusDAGExecutor(
      fakePort<CortexExecutor>({ execute }),
    );

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

  it("rejects a missing dependency before executing any cortex", async () => {
    const execute = typedSpy<CortexExecutor["execute"]>();

    const service = new ThalamusDAGExecutor(
      fakePort<CortexExecutor>({ execute }),
    );

    await expect(
      service.execute(
        {
          intent: "Ghost dependency",
          complexity: "simple",
          nodes: [{ cortex: "slow", params: {}, dependsOn: ["ghost"] }],
        },
        9n,
      ),
    ).rejects.toMatchObject({
      name: "DagValidationError",
      code: "missing_dependency",
    });
    expect(execute).not.toHaveBeenCalled();
  });

  it("rejects cyclic DAGs with a validation error", async () => {
    const execute = typedSpy<CortexExecutor["execute"]>();
    const service = new ThalamusDAGExecutor(
      fakePort<CortexExecutor>({ execute }),
    );

    await expect(
      service.execute(
        {
          intent: "Cycle",
          complexity: "simple",
          nodes: [
            { cortex: "alpha", params: {}, dependsOn: ["beta"] },
            { cortex: "beta", params: {}, dependsOn: ["alpha"] },
          ],
        },
        11n,
      ),
    ).rejects.toBeInstanceOf(DagValidationError);
    await expect(
      service.execute(
        {
          intent: "Cycle",
          complexity: "simple",
          nodes: [
            { cortex: "alpha", params: {}, dependsOn: ["beta"] },
            { cortex: "beta", params: {}, dependsOn: ["alpha"] },
          ],
        },
        11n,
      ),
    ).rejects.toMatchObject({ code: "circular_dependency" });
    expect(execute).not.toHaveBeenCalled();
  });

  it("rejects duplicate cortex names", async () => {
    const execute = typedSpy<CortexExecutor["execute"]>();
    const service = new ThalamusDAGExecutor(
      fakePort<CortexExecutor>({ execute }),
    );

    await expect(
      service.execute(
        {
          intent: "Duplicate",
          complexity: "simple",
          nodes: [
            { cortex: "alpha", params: {}, dependsOn: [] },
            { cortex: "alpha", params: { second: true }, dependsOn: [] },
          ],
        },
        12n,
      ),
    ).rejects.toMatchObject({ code: "duplicate_cortex" });
    expect(execute).not.toHaveBeenCalled();
  });

  it("rejects self-dependencies and empty DAGs", async () => {
    const execute = typedSpy<CortexExecutor["execute"]>();
    const service = new ThalamusDAGExecutor(
      fakePort<CortexExecutor>({ execute }),
    );

    await expect(
      service.execute(
        {
          intent: "Self dependency",
          complexity: "simple",
          nodes: [{ cortex: "alpha", params: {}, dependsOn: ["alpha"] }],
        },
        13n,
      ),
    ).rejects.toMatchObject({ code: "self_dependency" });

    await expect(
      service.execute(
        {
          intent: "Empty",
          complexity: "simple",
          nodes: [],
        },
        14n,
      ),
    ).rejects.toMatchObject({ code: "empty_dag" });
    expect(execute).not.toHaveBeenCalled();
  });

  it("executes a valid parallel DAG", async () => {
    const execute = typedSpy<CortexExecutor["execute"]>();
    execute.mockImplementation(async (cortexName) =>
      makeOutput([makeFinding({ title: `${cortexName} finding` })]),
    );

    const service = new ThalamusDAGExecutor(
      fakePort<CortexExecutor>({ execute }),
    );

    const result = await service.execute(
      {
        intent: "Parallel",
        complexity: "simple",
        nodes: [
          { cortex: "alpha", params: {}, dependsOn: [] },
          { cortex: "beta", params: {}, dependsOn: [] },
        ],
      },
      13n,
    );

    expect(result.outputs.get("alpha")?.findings[0]?.title).toBe(
      "alpha finding",
    );
    expect(result.outputs.get("beta")?.findings[0]?.title).toBe("beta finding");
    expect(execute).toHaveBeenCalledTimes(2);
  });

  it("aborts the DAG when the parent signal is cancelled", async () => {
    const execute = typedSpy<CortexExecutor["execute"]>();
    let capturedSignal: AbortSignal | undefined;
    execute.mockImplementation(
      async (_cortexName, input) =>
        new Promise<CortexOutput>(() => {
          capturedSignal = input.signal;
        }),
    );
    const service = new ThalamusDAGExecutor(
      fakePort<CortexExecutor>({ execute }),
    );
    const controller = new AbortController();

    const run = service.execute(
      {
        intent: "Abort DAG",
        complexity: "simple",
        nodes: [{ cortex: "alpha", params: {}, dependsOn: [] }],
      },
      15n,
      undefined,
      undefined,
      undefined,
      controller.signal,
    );
    await Promise.resolve();
    controller.abort(new Error("client aborted"));

    await expect(run).rejects.toThrow("client aborted");
    expect(capturedSignal?.aborted).toBe(true);
  });

  it("falls back to an error output when the cortex rejects with a non-Error value", async () => {
    const execute = typedSpy<CortexExecutor["execute"]>();
    execute.mockRejectedValueOnce("plain rejection");

    const service = new ThalamusDAGExecutor(
      fakePort<CortexExecutor>({ execute }),
    );

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

    expect(result.outputs.get("payload_profiler")?.metadata.model).toBe(
      "error",
    );
  });

  it("scales timeout to xhigh reasoning effort", async () => {
    const result = await expectTimeoutAfter(
      60,
      { reasoningEffort: "xhigh" },
      "alpha",
    );

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
    const result = await expectTimeoutAfter(30, {}, "alpha", {
      alpha: {
        thinking: true,
        model: "local/phi-4",
      },
    });

    expect(result.outputs.get("alpha")?.metadata.model).toBe("error");
  });
});
