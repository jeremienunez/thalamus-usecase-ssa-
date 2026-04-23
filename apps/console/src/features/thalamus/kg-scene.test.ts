import { describe, expect, it } from "vitest";
import type { KgEdgeDto, KgNodeDto } from "@/dto/http";
import { buildKgSceneGraph, classForEntityId, computeDegree } from "./kg-scene";

function node(overrides: Partial<KgNodeDto> = {}): KgNodeDto {
  return {
    id: "sat:1",
    label: "ISS",
    class: "Satellite",
    degree: 0,
    x: 0,
    y: 0,
    cortex: "catalog",
    ...overrides,
  };
}

function edge(overrides: Partial<KgEdgeDto> = {}): KgEdgeDto {
  return {
    id: "edge-1",
    source: "sat:1",
    target: "op:1",
    relation: "operated-by",
    confidence: 0.8,
    sourceClass: "field",
    ...overrides,
  };
}

describe("kg-scene", () => {
  it("computes degree and maps ids to entity classes", () => {
    const degrees = computeDegree([
      edge({ source: "sat:1", target: "op:1" }),
      edge({ source: "sat:1", target: "finding:9" }),
    ]);

    expect(degrees.get("sat:1")).toBe(2);
    expect(degrees.get("op:1")).toBe(1);
    expect(classForEntityId("finding:1")).toBe("ConjunctionEvent");
    expect(classForEntityId("conj:1")).toBe("ConjunctionEvent");
    expect(classForEntityId("sat:1")).toBe("Satellite");
    expect(classForEntityId("op:1")).toBe("Operator");
    expect(classForEntityId("regime:leo")).toBe("OrbitRegime");
    expect(classForEntityId("payload:9")).toBe("Payload");
    expect(classForEntityId("maneuver:2")).toBe("Maneuver");
    expect(classForEntityId("debris:3")).toBe("Debris");
    expect(classForEntityId("mystery:4")).toBe("ConjunctionEvent");
  });

  it("builds deterministic 3D nodes, ghost findings, and positioned edges", () => {
    const graph = buildKgSceneGraph({
      nodes: [
        node({ id: "sat:1", label: "ISS", class: "Satellite" }),
        node({ id: "op:1", label: "NASA", class: "Operator" }),
      ],
      edges: [
        edge({ id: "edge-1", source: "sat:1", target: "op:1" }),
        edge({ id: "edge-2", source: "sat:1", target: "finding:42", sourceClass: "derived" }),
      ],
      findingTitleById: new Map([["finding:f:42", "Priority finding"]]),
    });

    const satellite = graph.nodes.find((candidate) => candidate.id === "sat:1");
    const finding = graph.nodes.find((candidate) => candidate.id === "finding:42");
    expect(satellite).toEqual(
      expect.objectContaining({
        degree: 2,
        ghost: false,
        hubness: 1,
        position: expect.arrayContaining([expect.any(Number)]),
      }),
    );
    expect(finding).toEqual(
      expect.objectContaining({
        label: "Priority finding",
        class: "ConjunctionEvent",
        degree: 1,
        ghost: true,
      }),
    );
    expect(graph.edges).toHaveLength(2);
    expect(graph.edges[1]).toEqual(
      expect.objectContaining({
        sourcePosition: satellite?.position,
        targetPosition: finding?.position,
      }),
    );

    const graphAgain = buildKgSceneGraph({
      nodes: [
        node({ id: "sat:1", label: "ISS", class: "Satellite" }),
        node({ id: "op:1", label: "NASA", class: "Operator" }),
      ],
      edges: [
        edge({ id: "edge-1", source: "sat:1", target: "op:1" }),
        edge({ id: "edge-2", source: "sat:1", target: "finding:42", sourceClass: "derived" }),
      ],
      findingTitleById: new Map([["finding:f:42", "Priority finding"]]),
    });
    expect(graphAgain.nodes.map((sceneNode) => sceneNode.position)).toEqual(
      graph.nodes.map((sceneNode) => sceneNode.position),
    );
  });
});
