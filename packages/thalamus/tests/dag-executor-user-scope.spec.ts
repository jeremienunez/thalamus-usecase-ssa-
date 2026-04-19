import { describe, expect, it, vi } from "vitest";
import { ThalamusDAGExecutor } from "../src/services/thalamus-executor.service";
import type { CortexExecutor } from "../src/cortices/executor";

describe("ThalamusDAGExecutor user scope propagation", () => {
  it("injects cycle userId into node params when the node does not provide one", async () => {
    const execute = vi.fn(async () => ({
      findings: [],
      metadata: { tokensUsed: 0, duration: 0, model: "test" },
    }));
    const executor = new ThalamusDAGExecutor({ execute } as CortexExecutor);

    await executor.execute(
      {
        intent: "test",
        complexity: "simple",
        nodes: [{ cortex: "fleet_analyst", params: {}, dependsOn: [] }],
      },
      1n,
      "fr",
      "audit",
      7n,
    );

    expect(execute).toHaveBeenCalledWith(
      "fleet_analyst",
      expect.objectContaining({
        params: expect.objectContaining({ userId: 7n }),
      }),
    );
  });

  it("preserves an explicit node params.userId over the cycle userId", async () => {
    const execute = vi.fn(async () => ({
      findings: [],
      metadata: { tokensUsed: 0, duration: 0, model: "test" },
    }));
    const executor = new ThalamusDAGExecutor({ execute } as CortexExecutor);

    await executor.execute(
      {
        intent: "test",
        complexity: "simple",
        nodes: [
          {
            cortex: "fleet_analyst",
            params: { userId: 99n },
            dependsOn: [],
          },
        ],
      },
      1n,
      "fr",
      "audit",
      7n,
    );

    expect(execute).toHaveBeenCalledWith(
      "fleet_analyst",
      expect.objectContaining({
        params: expect.objectContaining({ userId: 99n }),
      }),
    );
  });
});
