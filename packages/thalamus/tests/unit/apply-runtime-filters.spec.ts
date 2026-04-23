/**
 * Unit tests for ThalamusPlanner.applyRuntimeFilters — the pure post-filter
 * step that applies runtime-config knobs (disabled/forced/max/mandatory
 * strategist) to a DAG produced by the LLM planner.
 *
 * No DB, no Redis, no Fastify, no LLM. A fake CortexRegistry is injected
 * with a fixed whitelist so we can exercise the registry.has(...) guards
 * without loading real skill files.
 */

import { beforeEach, describe, expect, it } from "vitest";
import { ThalamusPlanner } from "../../src/services/thalamus-planner.service";
import { CortexRegistry } from "../../src/cortices/registry";
import type { DAGNode } from "../../src/cortices/types";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function mkRegistry(
  knownNames: string[] = [
    "fleet_analyst",
    "conjunction_analysis",
    "launch_scout",
    "debris_forecaster",
    "strategist",
    "a",
    "b",
    "c",
  ],
): CortexRegistry {
  const set = new Set(knownNames);
  const registry = new CortexRegistry("/tmp/test-apply-runtime-filters");
  registry.has = (name: string) => set.has(name);
  return registry;
}

function mkPlannerCfg(
  partial: Partial<
    Parameters<ThalamusPlanner["applyRuntimeFilters"]>[1]
  > = {},
): Parameters<ThalamusPlanner["applyRuntimeFilters"]>[1] {
  return {
    maxCortices: 5,
    mandatoryStrategist: true,
    forcedCortices: [],
    disabledCortices: [],
    ...partial,
  };
}

function mkCortexCfg(
  overrides: Record<string, { enabled?: boolean }> = {},
): Parameters<ThalamusPlanner["applyRuntimeFilters"]>[2] {
  return { overrides };
}

function node(cortex: string, dependsOn: string[] = []): DAGNode {
  return { cortex, params: {}, dependsOn };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("ThalamusPlanner.applyRuntimeFilters — runtime-config post-filters", () => {
  let planner: ThalamusPlanner;

  beforeEach(() => {
    planner = new ThalamusPlanner(mkRegistry(), {});
  });

  it("given a dag with fleet_analyst and strategist and forcedCortices launch_scout, when applied, then launch_scout is injected into the result", () => {
    const dag: DAGNode[] = [node("fleet_analyst"), node("strategist")];
    const result = planner.applyRuntimeFilters(
      dag,
      mkPlannerCfg({ forcedCortices: ["launch_scout"] }),
      mkCortexCfg(),
    );
    expect(result.some((n) => n.cortex === "launch_scout")).toBe(true);
  });

  it("given forcedCortices contains an unknown name not_a_cortex, when applied, then the dag is unchanged because registry.has filters it out", () => {
    const dag: DAGNode[] = [node("fleet_analyst"), node("strategist")];
    const result = planner.applyRuntimeFilters(
      dag,
      mkPlannerCfg({ forcedCortices: ["not_a_cortex"] }),
      mkCortexCfg(),
    );
    expect(result.map((n) => n.cortex)).toEqual(["fleet_analyst", "strategist"]);
    expect(result.some((n) => n.cortex === "not_a_cortex")).toBe(false);
  });

  it("given disabledCortices includes strategist, when applied, then strategist is stripped from the result", () => {
    const dag: DAGNode[] = [node("fleet_analyst"), node("strategist")];
    const result = planner.applyRuntimeFilters(
      dag,
      mkPlannerCfg({
        disabledCortices: ["strategist"],
        mandatoryStrategist: false,
      }),
      mkCortexCfg(),
    );
    expect(result.some((n) => n.cortex === "strategist")).toBe(false);
  });

  it("given disabledCortices includes strategist and mandatoryStrategist is true, when applied, then disable wins and strategist is still absent", () => {
    const dag: DAGNode[] = [node("fleet_analyst"), node("strategist")];
    const result = planner.applyRuntimeFilters(
      dag,
      mkPlannerCfg({
        disabledCortices: ["strategist"],
        mandatoryStrategist: true,
      }),
      mkCortexCfg(),
    );
    expect(result.some((n) => n.cortex === "strategist")).toBe(false);
  });

  it("given a five node dag ending with strategist and maxCortices is two, when applied, then result length is two and the last element is strategist", () => {
    const dag: DAGNode[] = [
      node("fleet_analyst"),
      node("conjunction_analysis"),
      node("launch_scout"),
      node("debris_forecaster"),
      node("strategist"),
    ];
    const result = planner.applyRuntimeFilters(
      dag,
      mkPlannerCfg({ maxCortices: 2, mandatoryStrategist: false }),
      mkCortexCfg(),
    );
    expect(result).toHaveLength(2);
    expect(result[result.length - 1].cortex).toBe("strategist");
  });

  it("given a five node dag with no strategist and maxCortices is two, when applied, then result is the first two nodes in order", () => {
    const dag: DAGNode[] = [
      node("fleet_analyst"),
      node("conjunction_analysis"),
      node("launch_scout"),
      node("debris_forecaster"),
      node("a"),
    ];
    const result = planner.applyRuntimeFilters(
      dag,
      mkPlannerCfg({ maxCortices: 2, mandatoryStrategist: false }),
      mkCortexCfg(),
    );
    expect(result.map((n) => n.cortex)).toEqual([
      "fleet_analyst",
      "conjunction_analysis",
    ]);
  });

  it("given a dag of a and b with no strategist and mandatoryStrategist is true, when applied, then the last node is strategist and its dependsOn includes both a and b", () => {
    const dag: DAGNode[] = [node("a"), node("b")];
    const result = planner.applyRuntimeFilters(
      dag,
      mkPlannerCfg({ mandatoryStrategist: true }),
      mkCortexCfg(),
    );
    const last = result[result.length - 1];
    expect(last.cortex).toBe("strategist");
    expect(last.dependsOn).toEqual(expect.arrayContaining(["a", "b"]));
  });

  it("given cortexCfg.overrides.fleet_analyst.enabled is false and the dag contains fleet_analyst, when applied, then fleet_analyst is stripped via the override path", () => {
    const dag: DAGNode[] = [node("fleet_analyst"), node("strategist")];
    const result = planner.applyRuntimeFilters(
      dag,
      mkPlannerCfg({ mandatoryStrategist: false }),
      mkCortexCfg({ fleet_analyst: { enabled: false } }),
    );
    expect(result.some((n) => n.cortex === "fleet_analyst")).toBe(false);
  });

  it("given a dag b and c where c dependsOn b and disabledCortices includes b, when applied, then c.dependsOn is pruned empty and no longer references b", () => {
    const dag: DAGNode[] = [node("b"), node("c", ["b"])];
    const result = planner.applyRuntimeFilters(
      dag,
      mkPlannerCfg({
        disabledCortices: ["b"],
        mandatoryStrategist: false,
      }),
      mkCortexCfg(),
    );
    const c = result.find((n) => n.cortex === "c");
    expect(c).toBeDefined();
    expect(c!.dependsOn).not.toContain("b");
    expect(c!.dependsOn).toEqual([]);
  });

  it("given forced cortices are already present or disabled and an override is enabled true, when applied, then nothing extra is injected", () => {
    const dag: DAGNode[] = [node("a")];
    const result = planner.applyRuntimeFilters(
      dag,
      mkPlannerCfg({
        forcedCortices: ["a", "strategist"],
        disabledCortices: ["strategist"],
        mandatoryStrategist: false,
      }),
      mkCortexCfg({ a: { enabled: true } }),
    );
    expect(result).toEqual([node("a")]);
  });
});
