import { z } from "zod";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { fakePort } from "@interview/test-kit";
import type { MemoryService } from "../../src/sim/memory.service";
import type {
  SimRuntimeStore,
  SimScenarioContextProvider,
} from "../../src/sim/ports";
import { DagTurnRunner } from "../../src/sim/turn-runner-dag";
import type {
  CortexSkillRegistry,
  NanoTurnCaller,
} from "../../src/sim/turn-runner.utils";

describe("DagTurnRunner", () => {
  const nanoCaller = vi.fn<Parameters<NanoTurnCaller>, ReturnType<NanoTurnCaller>>();

  beforeEach(() => {
    vi.clearAllMocks();
    nanoCaller.mockResolvedValue({
      ok: false,
      text: "",
      error: "HTTP 400",
    });
  });

  it("fails an all-error turn without posting an empty turn batch", async () => {
    const persistTurnBatch = vi.fn();
    const runner = new DagTurnRunner({
      llmMode: "cloud",
      store: fakePort<SimRuntimeStore>({
        listAgents: vi.fn(async () => [
          {
            id: 11,
            agentIndex: 0,
            persona: "pc estimator",
            goals: [],
            constraints: {},
          },
        ]),
        listGodEventsAtOrBefore: vi.fn(async () => []),
        persistTurnBatch,
      }),
      memory: fakePort<MemoryService>({
        topK: vi.fn(async () => []),
        recentObservable: vi.fn(async () => []),
      }),
      targets: fakePort<SimScenarioContextProvider>({
        loadContext: vi.fn(async () => ({})),
      }),
      cortexRegistry: fakePort<CortexSkillRegistry>({
        get: vi.fn(() => ({
          body: "skill body",
        })),
      }),
      nanoCaller,
      prompt: { render: vi.fn(() => "turn prompt") },
      cortexSelector: { pickCortexName: vi.fn(() => "pc_estimator_agent") },
      schemaProvider: { actionSchema: () => z.object({ kind: z.literal("noop") }) },
    });

    await expect(
      runner.runTurn({ simRunId: 42, turnIndex: 0 }),
    ).rejects.toThrow("DAG turn failed for all agents");
    expect(persistTurnBatch).not.toHaveBeenCalled();
  });
});
