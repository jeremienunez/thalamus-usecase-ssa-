import { describe, it, expect, vi, afterEach } from "vitest";
import { render } from "ink-testing-library";
import React from "react";
import { SatelliteLoader } from "../../src/components/SatelliteLoader";

describe("SatelliteLoader", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

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

  it("renders estimating-soon and running-long subtitles", () => {
    const { lastFrame, rerender } = render(
      <SatelliteLoader
        subject="correlation"
        kind="cortex"
        etaEstimate={{ status: "estimating-soon", samples: 2 }}
        elapsedMs={200}
        costUsd={0}
        _frameOverride={1}
      />,
    );

    expect(lastFrame()).toContain("estimating (2 samples)");
    expect(lastFrame()).toContain("$0.000 so far");

    rerender(
      <SatelliteLoader
        subject="correlation"
        kind="cortex"
        etaEstimate={{ status: "known", p50Ms: 5_000, p95Ms: 10_000, samples: 10 }}
        elapsedMs={11_500}
        costUsd={0.25}
        _frameOverride={2}
      />,
    );

    expect(lastFrame()).toContain("running long");
    expect(lastFrame()).toContain("p95 was 10s");
    expect(lastFrame()).toContain("$0.250 so far");
  });

  it("defaults to frame zero and advances frames when no override is provided", async () => {
    vi.useFakeTimers();

    const { lastFrame } = render(
      <SatelliteLoader
        subject="autopilot"
        kind="cortex"
        etaEstimate={{ status: "estimating" }}
        elapsedMs={100}
        costUsd={0}
      />,
    );

    expect(lastFrame()).toContain("running: autopilot");
    expect(lastFrame()).toContain("     .·°·.");

    await vi.advanceTimersByTimeAsync(120);
    expect(lastFrame()).toContain("     ·°·.·");
  });
});
