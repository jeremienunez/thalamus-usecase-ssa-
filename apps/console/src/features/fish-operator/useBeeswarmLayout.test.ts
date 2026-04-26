import { describe, expect, it } from "vitest";
import type {
  OperatorSwarmStatusDto,
  SimFishTerminalDto,
  SwarmClustersDto,
} from "@/dto/http";
import { buildFishSceneModel } from "./fish-scene-model";
import { computeBeeswarmLayout } from "./useBeeswarmLayout";

function status(overrides: Partial<OperatorSwarmStatusDto> = {}): OperatorSwarmStatusDto {
  return {
    swarmId: "swarm-1",
    kind: "uc3_conjunction",
    status: "running",
    size: 100,
    done: 0,
    failed: 0,
    timeout: 0,
    running: 100,
    pending: 0,
    reportFindingId: null,
    suggestionId: null,
    aggregateKeys: [],
    ...overrides,
  };
}

function clustersOf(
  buckets: Array<{ label: string; size: number; offset: number }>,
): SwarmClustersDto {
  return {
    swarmId: "swarm-1",
    source: "aggregate",
    clusters: buckets.map((b) => ({
      label: b.label,
      memberFishIndexes: Array.from({ length: b.size }, (_v, i) => i + b.offset),
    })),
    summary: {},
  };
}

function makeModel({
  size = 100,
  bands,
}: {
  size?: number;
  bands: Array<{ label: string; size: number; offset: number }>;
}) {
  const terminals: SimFishTerminalDto[] = Array.from({ length: size }, (_v, i) => ({
    simRunId: `run-${i}`,
    fishIndex: i,
    runStatus: "running",
    agentIndex: 0,
    action: null,
    observableSummary: null,
    turnsPlayed: (i % 8) + 1,
  }));
  return buildFishSceneModel({
    status: status({ size, running: size, done: 0 }),
    clusters: clustersOf(bands),
    terminals,
  });
}

describe("computeBeeswarmLayout", () => {
  it("places every visible fish without circle overlap", () => {
    const model = makeModel({
      size: 100,
      bands: [
        { label: "maneuver", size: 50, offset: 0 },
        { label: "hold", size: 30, offset: 50 },
        { label: "investigate", size: 20, offset: 80 },
      ],
    });
    const layout = computeBeeswarmLayout({ width: 1200, height: 800, model });
    expect(layout.dots).toHaveLength(100);

    const visible = layout.dots.filter((d) => d.isVisible);
    for (let i = 0; i < visible.length; i++) {
      for (let j = i + 1; j < visible.length; j++) {
        const a = visible[i]!;
        const b = visible[j]!;
        const dx = a.cx - b.cx;
        const dy = a.cy - b.cy;
        const dist = Math.sqrt(dx * dx + dy * dy);
        // Allow a tiny tolerance for the simulation not fully converging.
        expect(dist).toBeGreaterThan(a.r + b.r - 0.6);
      }
    }
  });

  it("orders bands by cluster size descending and pins unclustered to the bottom", () => {
    const model = makeModel({
      size: 100,
      bands: [
        { label: "small", size: 10, offset: 0 },
        { label: "big", size: 50, offset: 10 },
        { label: "medium", size: 25, offset: 60 },
        // remaining 15 fish are unclustered (offset 85 onward not assigned)
      ],
    });
    const layout = computeBeeswarmLayout({ width: 1200, height: 600, model });
    const labels = layout.bands.map((b) => b.label);
    expect(labels[0]).toBe("big");
    expect(labels[1]).toBe("medium");
    expect(labels[2]).toBe("small");
    expect(layout.bands[layout.bands.length - 1]!.isUnclustered).toBe(true);
  });

  it("gives a larger band more vertical space than a smaller one", () => {
    const model = makeModel({
      size: 100,
      bands: [
        { label: "big", size: 70, offset: 0 },
        { label: "small", size: 30, offset: 70 },
      ],
    });
    const layout = computeBeeswarmLayout({ width: 1200, height: 800, model });
    const big = layout.bands.find((b) => b.label === "big")!;
    const small = layout.bands.find((b) => b.label === "small")!;
    expect(big.y1 - big.y0).toBeGreaterThan(small.y1 - small.y0);
  });

  it("returns an empty layout when the model is null", () => {
    const layout = computeBeeswarmLayout({ width: 800, height: 600, model: null });
    expect(layout.dots).toEqual([]);
    expect(layout.bands).toEqual([]);
  });

  it("spreads a fully-terminated swarm across the plot when every fish shares turnProgress=1", () => {
    const status: OperatorSwarmStatusDto = {
      swarmId: "swarm-3",
      kind: "uc3_conjunction",
      status: "done",
      size: 100,
      done: 100,
      failed: 0,
      timeout: 0,
      running: 0,
      pending: 0,
      reportFindingId: null,
      suggestionId: null,
      aggregateKeys: [],
    };
    const terminals: SimFishTerminalDto[] = Array.from({ length: 100 }, (_v, i) => ({
      simRunId: `r-${i}`,
      fishIndex: i,
      runStatus: "done",
      agentIndex: 0,
      action: { kind: "estimate_pc" },
      observableSummary: null,
      turnsPlayed: 1,
    }));
    const model = buildFishSceneModel({ status, terminals });
    expect(model.nodes.every((n) => n.turnProgress === 1)).toBe(true);
    const layout = computeBeeswarmLayout({ width: 1200, height: 600, model });
    const xs = layout.dots.map((d) => d.cx).sort((a, b) => a - b);
    const minX = xs[0]!;
    const maxX = xs[xs.length - 1]!;
    expect(maxX - minX).toBeGreaterThan(800);
  });

  it("falls back to fishIndex spread when no fish has progress data yet", () => {
    const status: OperatorSwarmStatusDto = {
      swarmId: "swarm-2",
      kind: "uc3_conjunction",
      status: "running",
      size: 100,
      done: 0,
      failed: 0,
      timeout: 0,
      running: 100,
      pending: 0,
      reportFindingId: null,
      suggestionId: null,
      aggregateKeys: [],
    };
    // No clusters, no terminals → bandKey "unclustered" must still match a band,
    // and X targets must spread across the inner width.
    const model = buildFishSceneModel({ status });
    const layout = computeBeeswarmLayout({ width: 1200, height: 600, model });
    expect(layout.dots).toHaveLength(100);
    expect(layout.bands.map((b) => b.key)).toEqual(["unclustered"]);
    expect(layout.bands[0]!.label).toBe("All fish");
    const xs = layout.dots.map((d) => d.cx).sort((a, b) => a - b);
    const minX = xs[0]!;
    const maxX = xs[xs.length - 1]!;
    expect(maxX - minX).toBeGreaterThan(800);
    // No overlap.
    for (let i = 0; i < layout.dots.length; i++) {
      for (let j = i + 1; j < layout.dots.length; j++) {
        const a = layout.dots[i]!;
        const b = layout.dots[j]!;
        const d = Math.hypot(a.cx - b.cx, a.cy - b.cy);
        expect(d).toBeGreaterThan(a.r + b.r - 0.6);
      }
    }
  });

  it("is deterministic for identical input", () => {
    const model = makeModel({
      size: 60,
      bands: [
        { label: "a", size: 30, offset: 0 },
        { label: "b", size: 30, offset: 30 },
      ],
    });
    const first = computeBeeswarmLayout({ width: 1000, height: 700, model });
    const second = computeBeeswarmLayout({ width: 1000, height: 700, model });
    expect(first.dots.map((d) => [d.fishIndex, round(d.cx), round(d.cy)])).toEqual(
      second.dots.map((d) => [d.fishIndex, round(d.cx), round(d.cy)]),
    );
  });
});

function round(value: number): number {
  return Math.round(value * 1000) / 1000;
}
