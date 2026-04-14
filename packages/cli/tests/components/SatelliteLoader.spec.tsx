import { describe, it, expect } from "vitest";
import { render } from "ink-testing-library";
import React from "react";
import { SatelliteLoader } from "../../src/components/SatelliteLoader";

describe("SatelliteLoader", () => {
  it("renders subtitle with cortex name and estimating when no ETA", () => {
    const { lastFrame } = render(
      <SatelliteLoader
        subject="conjunction-analysis"
        kind="cortex"
        etaEstimate={{ status: "estimating" }}
        elapsedMs={200}
        costUsd={0.001}
        _frameOverride={0}
      />
    );
    const f = lastFrame() ?? "";
    expect(f).toContain("conjunction-analysis");
    expect(f).toContain("estimating");
  });
  it("renders remaining time when elapsed < p50", () => {
    const { lastFrame } = render(
      <SatelliteLoader
        subject="x"
        kind="cortex"
        etaEstimate={{ status: "known", p50Ms: 5000, p95Ms: 10000, samples: 10 }}
        elapsedMs={2000}
        costUsd={0.01}
        _frameOverride={0}
      />
    );
    expect(lastFrame()).toMatch(/~ 3s remaining/);
  });
  it("renders 'slower than usual' past p50 but before p95", () => {
    const { lastFrame } = render(
      <SatelliteLoader
        subject="x"
        kind="cortex"
        etaEstimate={{ status: "known", p50Ms: 5000, p95Ms: 10000, samples: 10 }}
        elapsedMs={7000}
        costUsd={0.01}
        _frameOverride={0}
      />
    );
    expect(lastFrame()).toContain("slower than usual");
  });
});
