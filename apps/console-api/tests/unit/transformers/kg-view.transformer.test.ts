import { describe, it, expect } from "vitest";
import {
  entityRef,
  toFindingNode,
  toKgEdge,
  toOperatorNode,
  toRegimeNode,
  toSatelliteNode,
} from "../../../src/transformers/kg-view.transformer";

describe("toRegimeNode", () => {
  it("prefixes id with regime:, class OrbitRegime, cortex —", () => {
    const n = toRegimeNode({ id: "1", name: "LEO" });
    expect(n.id).toBe("regime:LEO");
    expect(n.label).toBe("LEO");
    expect(n.class).toBe("OrbitRegime");
    expect(n.cortex).toBe("—");
    expect(n.degree).toBe(0);
    expect(n.x).toBe(0);
    expect(n.y).toBe(0);
  });
});

describe("toOperatorNode", () => {
  it("prefixes id with op:, class Operator, cortex —", () => {
    const n = toOperatorNode({ id: "9", name: "SpaceX" });
    expect(n.id).toBe("op:SpaceX");
    expect(n.label).toBe("SpaceX");
    expect(n.class).toBe("Operator");
    expect(n.cortex).toBe("—");
  });
});

describe("toSatelliteNode", () => {
  it("prefixes id with sat:, class Satellite, cortex catalog", () => {
    const n = toSatelliteNode({ id: "42", name: "STARLINK-1" });
    expect(n.id).toBe("sat:42");
    expect(n.label).toBe("STARLINK-1");
    expect(n.class).toBe("Satellite");
    expect(n.cortex).toBe("catalog");
  });
});

describe("toFindingNode", () => {
  it("prefixes id with finding:, class ConjunctionEvent, carries cortex", () => {
    const n = toFindingNode({ id: "7", title: "short", cortex: "anomaly" });
    expect(n.id).toBe("finding:7");
    expect(n.label).toBe("short");
    expect(n.class).toBe("ConjunctionEvent");
    expect(n.cortex).toBe("anomaly");
  });

  it("truncates label at 32 chars", () => {
    const long = "A".repeat(50);
    const n = toFindingNode({ id: "7", title: long, cortex: "anomaly" });
    expect(n.label).toBe("A".repeat(32));
    expect(n.label.length).toBe(32);
  });
});

describe("entityRef", () => {
  it.each([
    ["satellite", "123", "sat:123"],
    ["operator", "9", "op:9"],
    ["orbit_regime", "7", "regime:7"],
    ["payload", "7", "payload:7"],
    ["regime", "LEO", "regime:LEO"],
  ])("type=%s id=%s → %s", (type, id, expected) => {
    expect(entityRef(type, id)).toBe(expected);
  });
});

describe("toKgEdge", () => {
  it("builds source=finding:<id> and target via entityRef", () => {
    const e = toKgEdge({
      id: "1",
      finding_id: "11",
      entity_type: "satellite",
      entity_id: "42",
      relation: "observes",
    });
    expect(e.id).toBe("1");
    expect(e.source).toBe("finding:11");
    expect(e.target).toBe("sat:42");
    expect(e.relation).toBe("observes");
  });

  it("operator target uses op: prefix", () => {
    const e = toKgEdge({
      id: "2",
      finding_id: "12",
      entity_type: "operator",
      entity_id: "SpaceX",
      relation: "owns",
    });
    expect(e.target).toBe("op:SpaceX");
  });

  it("orbit_regime target uses regime: prefix", () => {
    const e = toKgEdge({
      id: "3",
      finding_id: "13",
      entity_type: "orbit_regime",
      entity_id: "LEO",
      relation: "about",
    });
    expect(e.target).toBe("regime:LEO");
  });

  it("unknown entity_type falls through to type:id", () => {
    const e = toKgEdge({
      id: "4",
      finding_id: "14",
      entity_type: "payload",
      entity_id: "99",
      relation: "relates",
    });
    expect(e.target).toBe("payload:99");
  });
});
