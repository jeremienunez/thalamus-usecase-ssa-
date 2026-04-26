import { z } from "zod";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { fakePort, typedSpy } from "@interview/test-kit";
import type { CortexRegistry } from "@interview/thalamus";
import type { AgentContext } from "../../src/sim/types";

const thalamus = vi.hoisted(() => ({
  callNanoWithMode: vi.fn(),
}));

vi.mock("@interview/thalamus", () => ({
  callNanoWithMode: thalamus.callNanoWithMode,
}));

import { callTurnAgent } from "../../src/sim/turn-runner.utils";

describe("callTurnAgent cortex selection hints", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    thalamus.callNanoWithMode.mockResolvedValue({
      ok: true,
      text: JSON.stringify({
        action: { kind: "noop" },
        rationale: "valid rationale",
        observableSummary: "valid observable summary",
      }),
    });
  });

  it("passes scenario and subject hints into the cortex selector", async () => {
    const pickCortexName = vi.fn(() => "telemetry_inference_agent");
    const getSkill = typedSpy<CortexRegistry["get"]>().mockReturnValue({
      header: {
        name: "telemetry_inference_agent",
        description: "Telemetry inference",
        sqlHelper: "",
        params: {},
      },
      body: "telemetry skill",
      filePath: "test://telemetry-inference-agent.md",
    });
    const ctx: AgentContext = {
      simRunId: 10,
      agentId: 20,
      agentIndex: 0,
      turnIndex: 3,
      persona: "operator",
      goals: [],
      constraints: {},
      topMemories: [],
      observable: [],
      godEvents: [],
      subjectSnapshot: {
        displayName: "Intelsat 23",
        attributes: { bus: "SSL-1300", regime: "GEO" },
      },
      scenarioContext: {
        telemetryTargetSatelliteId: 7,
        telemetryTarget: { id: 7 },
      },
    };

    await callTurnAgent({
      deps: {
        cortexRegistry: fakePort<CortexRegistry>({ get: getSkill }),
        prompt: {
          render: vi.fn(() => "turn prompt"),
        },
        cortexSelector: { pickCortexName },
        schemaProvider: {
          actionSchema: () => z.object({ kind: z.literal("noop") }),
        },
      },
      ctx,
      simKind: "uc_telemetry_inference",
      logger: { warn: vi.fn() },
    });

    expect(pickCortexName).toHaveBeenCalledWith({
      simKind: "uc_telemetry_inference",
      turnIndex: 3,
      hints: {
        hasScenarioContext: true,
        hasTelemetryTarget: true,
        hasPcEstimatorTarget: false,
        scenarioContextKeys: ["telemetryTarget", "telemetryTargetSatelliteId"],
        subjectDisplayName: "Intelsat 23",
        subjectAttributeKeys: ["bus", "regime"],
      },
    });
  });

  it("accepts a direct action object when the model omits the turn envelope", async () => {
    thalamus.callNanoWithMode.mockResolvedValueOnce({
      ok: true,
      text: JSON.stringify({
        kind: "noop",
        reason: "direct action rationale",
      }),
    });

    const response = await callTurnAgent({
      deps: {
        cortexRegistry: fakePort<CortexRegistry>({
          get: vi.fn(() => ({
            header: {
              name: "pc_estimator_agent",
              description: "PC estimator",
              sqlHelper: "",
              params: {},
            },
            body: "pc skill",
            filePath: "test://pc-estimator-agent.md",
          })),
        }),
        prompt: { render: vi.fn(() => "turn prompt") },
        cortexSelector: { pickCortexName: vi.fn(() => "pc_estimator_agent") },
        schemaProvider: {
          actionSchema: () =>
            z.object({
              kind: z.literal("noop"),
              reason: z.string().min(1),
            }),
        },
      },
      ctx: {
        simRunId: 10,
        agentId: 20,
        agentIndex: 0,
        turnIndex: 0,
        persona: "operator",
        goals: [],
        constraints: {},
        topMemories: [],
        observable: [],
        godEvents: [],
        subjectSnapshot: null,
        scenarioContext: {},
      },
      simKind: "uc_pc_estimator",
      logger: { warn: vi.fn() },
    });

    expect(response).toEqual({
      action: {
        kind: "noop",
        reason: "direct action rationale",
      },
      rationale: "direct action rationale",
      observableSummary: "Returned noop action directly.",
    });
  });
});
