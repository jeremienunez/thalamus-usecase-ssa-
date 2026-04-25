import { describe, expect, it } from "vitest";
import { SsaCortexSelector } from "../../../../../src/agent/ssa/sim/cortex-selector";

describe("SsaCortexSelector", () => {
  const selector = new SsaCortexSelector();

  it("routes specialized swarms by sim kind", () => {
    expect(
      selector.pickCortexName({
        simKind: "uc_telemetry_inference",
        turnIndex: 0,
      }),
    ).toBe("telemetry_inference_agent");

    expect(
      selector.pickCortexName({
        simKind: "uc_pc_estimator",
        turnIndex: 0,
      }),
    ).toBe("pc_estimator_agent");
  });

  it("routes specialized swarms by rich scenario hints", () => {
    expect(
      selector.pickCortexName({
        simKind: "",
        turnIndex: 0,
        hints: { hasTelemetryTarget: true },
      }),
    ).toBe("telemetry_inference_agent");

    expect(
      selector.pickCortexName({
        simKind: "",
        turnIndex: 0,
        hints: { hasPcEstimatorTarget: true },
      }),
    ).toBe("pc_estimator_agent");
  });

  it("keeps pc routing ahead of telemetry when hints overlap", () => {
    expect(
      selector.pickCortexName({
        simKind: "uc_telemetry_inference",
        turnIndex: 0,
        hints: { hasTelemetryTarget: true, hasPcEstimatorTarget: true },
      }),
    ).toBe("pc_estimator_agent");
  });

  it("falls back to the generic operator skill", () => {
    expect(
      selector.pickCortexName({
        simKind: "uc3_conjunction",
        turnIndex: 0,
        hints: { hasScenarioContext: true },
      }),
    ).toBe("sim_operator_agent");
  });
});
