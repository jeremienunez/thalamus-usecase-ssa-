import { describe, expect, it } from "vitest";
import type {
  OperatorSwarmStatusDto,
  SimFishTerminalDto,
  SwarmClustersDto,
} from "@/dto/http";
import { buildFishSceneModel } from "./fish-scene-model";

function status(overrides: Partial<OperatorSwarmStatusDto> = {}): OperatorSwarmStatusDto {
  return {
    swarmId: "42",
    kind: "uc3_conjunction",
    status: "running",
    size: 5,
    done: 1,
    failed: 0,
    timeout: 1,
    running: 2,
    pending: 1,
    reportFindingId: null,
    suggestionId: null,
    aggregateKeys: ["aggregate"],
    ...overrides,
  };
}

function terminal(
  overrides: Partial<SimFishTerminalDto> = {},
): SimFishTerminalDto {
  return {
    simRunId: "100",
    fishIndex: 0,
    runStatus: "done",
    agentIndex: 0,
    action: { kind: "maneuver" },
    observableSummary: "Fish chose maneuver",
    turnsPlayed: 3,
    ...overrides,
  };
}

function clusters(
  overrides: Partial<SwarmClustersDto> = {},
): SwarmClustersDto {
  return {
    swarmId: "42",
    source: "aggregate",
    clusters: [
      { label: "maneuver", memberFishIndexes: [0, 2] },
      { label: "hold", members: [{ fishIndex: 4 }] },
    ],
    summary: { quorumMet: true },
    ...overrides,
  };
}

describe("buildFishSceneModel", () => {
  it("projects operator API status, terminals, and clusters into pickable fish nodes", () => {
    const model = buildFishSceneModel({
      status: status(),
      clusters: clusters(),
      terminals: [
        terminal({ fishIndex: 0, runStatus: "done", action: { kind: "maneuver" } }),
        terminal({ fishIndex: 3, runStatus: "timeout", action: { kind: "hold" } }),
      ],
      selectedFishIndex: 3,
    });

    expect(model.swarmId).toBe("42");
    expect(model.nodes).toHaveLength(5);
    expect(model.nodes[0]).toEqual(
      expect.objectContaining({
        id: "fish:0",
        pickableId: "42:0",
        status: "done",
        clusterLabel: "maneuver",
        terminalActionKind: "maneuver",
        selected: false,
        color: "#34D399",
      }),
    );
    expect(model.nodes[3]).toEqual(
      expect.objectContaining({
        status: "timeout",
        terminalActionKind: "hold",
        selected: true,
        color: "#C084FC",
      }),
    );
    expect(model.summary.byStatus).toMatchObject({
      done: 1,
      running: 2,
      pending: 1,
      timeout: 1,
    });
    expect(model.summary.byCluster).toEqual({
      maneuver: 2,
      hold: 1,
      unclustered: 2,
    });
    expect(model.summary.byTerminalAction).toMatchObject({
      maneuver: 1,
      hold: 1,
      none: 3,
    });
  });

  it("applies status and cluster filters without mutating the full node list", () => {
    const model = buildFishSceneModel({
      status: status(),
      clusters: clusters(),
      terminals: [terminal({ fishIndex: 0, runStatus: "done" })],
      filters: { status: "running", cluster: "unclustered" },
    });

    expect(model.nodes).toHaveLength(5);
    expect(model.visibleNodes.map((node) => node.fishIndex)).toEqual([1]);
    expect(model.summary.visible).toBe(1);
  });

  it("filters by terminal action kind and the synthetic 'none' bucket", () => {
    const onlyManeuver = buildFishSceneModel({
      status: status(),
      clusters: clusters(),
      terminals: [
        terminal({ fishIndex: 0, runStatus: "done", action: { kind: "maneuver" } }),
        terminal({ fishIndex: 3, runStatus: "timeout", action: { kind: "hold" } }),
      ],
      filters: { terminalAction: "maneuver" },
    });
    expect(onlyManeuver.visibleNodes.map((n) => n.fishIndex)).toEqual([0]);

    const onlyNone = buildFishSceneModel({
      status: status(),
      clusters: clusters(),
      terminals: [
        terminal({ fishIndex: 0, runStatus: "done", action: { kind: "maneuver" } }),
        terminal({ fishIndex: 3, runStatus: "timeout", action: { kind: "hold" } }),
      ],
      filters: { terminalAction: "none" },
    });
    expect(onlyNone.visibleNodes.map((n) => n.fishIndex)).toEqual([1, 2, 4]);
  });

  it("derives turnProgress from terminals, normalised by max turnsPlayed", () => {
    const model = buildFishSceneModel({
      status: status(),
      clusters: clusters(),
      terminals: [
        terminal({ fishIndex: 0, turnsPlayed: 2 }),
        terminal({ fishIndex: 1, turnsPlayed: 8 }),
        terminal({ fishIndex: 4, turnsPlayed: 4 }),
      ],
    });
    const byIndex = new Map(model.nodes.map((n) => [n.fishIndex, n]));
    expect(byIndex.get(0)!.turnProgress).toBeCloseTo(2 / 8);
    expect(byIndex.get(1)!.turnProgress).toBeCloseTo(1);
    expect(byIndex.get(4)!.turnProgress).toBeCloseTo(4 / 8);
    // Fish without a terminal has no progress yet.
    expect(byIndex.get(2)!.turnProgress).toBe(0);
  });

  it("uses sqrt(turnsPlayed) as costScore proxy and 0 for fish without a terminal", () => {
    const model = buildFishSceneModel({
      status: status(),
      clusters: clusters(),
      terminals: [
        terminal({ fishIndex: 0, turnsPlayed: 9 }),
        terminal({ fishIndex: 3, turnsPlayed: 0 }),
      ],
    });
    const byIndex = new Map(model.nodes.map((n) => [n.fishIndex, n]));
    expect(byIndex.get(0)!.costScore).toBeCloseTo(3);
    expect(byIndex.get(3)!.costScore).toBe(0);
    expect(byIndex.get(2)!.costScore).toBe(0);
  });
});
