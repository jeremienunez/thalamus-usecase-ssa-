import { describe, expect, it } from "vitest";
import {
  heuristicRoute,
  parseExplicitCommand,
  runTurn,
  type Fixtures,
} from "../../src/repl";

function makeFixtures(): Fixtures {
  return {
    satellites: [
      {
        id: 1,
        name: "SAT-ALPHA",
        noradId: 25544,
        regime: "LEO",
        operator: "ESA",
        country: "EU",
        inclinationDeg: 51.6,
        semiMajorAxisKm: 6790,
        eccentricity: 0.001,
        raanDeg: 10,
        argPerigeeDeg: 20,
        meanAnomalyDeg: 30,
        meanMotionRevPerDay: 15.5,
        epoch: "2026-04-21T00:00:00.000Z",
        massKg: 420,
        classificationTier: "unclassified",
      },
    ],
    kgNodes: [
      {
        id: "sat:1",
        label: "SAT-ALPHA",
        class: "Satellite",
        degree: 1,
        x: 0,
        y: 0,
        cortex: "catalog",
      },
      {
        id: "payload:alpha",
        label: "PAYLOAD-ALPHA",
        class: "Payload",
        degree: 1,
        x: 1,
        y: 1,
        cortex: "catalog",
      },
    ],
    kgEdges: [
      {
        id: "edge-1",
        source: "sat:1",
        target: "payload:alpha",
        relation: "carries",
        confidence: 0.98,
        sourceClass: "field",
      },
    ],
    findings: [
      {
        id: "f:1",
        title: "Telemetry corroborates payload link",
        summary: "Field telemetry matches the public payload manifest.",
        cortex: "correlation",
        status: "pending",
        priority: 91,
        createdAt: "2026-04-21T00:00:00.000Z",
        linkedEntityIds: ["sat:1", "payload:alpha"],
        evidence: [
          {
            kind: "osint",
            uri: "osint://press-release",
            snippet: "Public release lists payload alpha.",
          },
          {
            kind: "field",
            uri: "field://telemetry",
            snippet: "Power draw matches payload alpha profile.",
          },
        ],
      },
      {
        id: "f:2",
        title: "Accept the right finding",
        summary: "Control case for targeted acceptance.",
        cortex: "catalog",
        status: "pending",
        priority: 50,
        createdAt: "2026-04-21T00:00:00.000Z",
        linkedEntityIds: ["sat:1"],
        evidence: [
          {
            kind: "derived",
            uri: "derived://summary",
            snippet: "Synthetic summary node.",
          },
        ],
      },
    ],
  };
}

describe("parseExplicitCommand", () => {
  it("parses /logs filters instead of collapsing to a generic command", () => {
    expect(parseExplicitCommand("/logs level=warn service=sweep")).toEqual({
      steps: [{ action: "logs", level: "warn", service: "sweep" }],
      confidence: 1,
    });
  });

  it("rejects missing required ids for explicit commands", () => {
    expect(parseExplicitCommand("/accept")).toBeNull();
  });
});

describe("heuristicRoute", () => {
  it("prioritises accept intents over the query fallback", () => {
    expect(heuristicRoute("please approve sweep-9 now")).toEqual({
      steps: [{ action: "accept", suggestionId: "SWEEP-9" }],
      confidence: 0.7,
    });
  });

  it("normalises bare collision ids into conjunction ids", () => {
    expect(heuristicRoute("collision probability for 42")).toEqual({
      steps: [{ action: "pc", conjunctionId: "ce:42" }],
      confidence: 0.7,
    });
  });

  it("routes telemetry phrasing to the telemetry adapter", () => {
    expect(heuristicRoute("show telemetry for norad 25544")).toEqual({
      steps: [{ action: "telemetry", satId: "25544" }],
      confidence: 0.6,
    });
  });
});

describe("runTurn", () => {
  it("adds autonomy and budget shortcuts when the query asks about config budgets", async () => {
    const result = await runTurn(
      "show autonomy budget config",
      makeFixtures(),
      "sess-1",
    );

    expect(result.results[0]).toMatchObject({
      kind: "briefing",
      uiActions: [
        { kind: "open_feed", target: "autonomy", label: "Open autonomy FEED" },
        {
          kind: "open_config",
          domain: "console.autonomy",
          label: "Tune console.autonomy",
        },
        {
          kind: "open_config",
          domain: "thalamus.budgets",
          label: "Review thalamus.budgets",
        },
      ],
    });
  });

  it("accepts the targeted finding instead of mutating an arbitrary fallback", async () => {
    const fixtures = makeFixtures();

    const result = await runTurn("/accept f:2", fixtures, "sess-2");

    expect(result.results[0]).toMatchObject({
      kind: "resolution",
      suggestionId: "f:2",
      delta: { findingId: "f:2" },
    });
    expect(fixtures.findings.find((f) => f.id === "f:2")?.status).toBe(
      "accepted",
    );
    expect(fixtures.findings.find((f) => f.id === "f:1")?.status).toBe(
      "pending",
    );
  });

  it("sorts explain-tree edges by source class and tallies every annotated provenance node", async () => {
    const result = await runTurn("/explain f:1", makeFixtures(), "sess-3");
    const explain = result.results[0];

    expect(explain.kind).toBe("why");
    if (explain.kind !== "why") {
      throw new Error("expected why result");
    }

    expect(explain.stats).toEqual({
      edges: 2,
      sourceItems: 2,
      byClass: { field: 3, osint: 3, sim: 0 },
    });
    expect(explain.tree.children.map((child) => child.sourceClass)).toEqual([
      "field",
      "osint",
    ]);
    expect(explain.tree.children[0]?.children[0]).toMatchObject({
      kind: "source_item",
      label: "field://telemetry",
    });
  });

  it("walks the requested KG root instead of returning a permissive superset", async () => {
    const result = await runTurn("/graph sat:1", makeFixtures(), "sess-4");
    const graph = result.results[0];

    expect(graph.kind).toBe("graph");
    if (graph.kind !== "graph") {
      throw new Error("expected graph result");
    }

    expect(graph.root).toBe("sat:1");
    expect(graph.tree.children).toEqual([
      expect.objectContaining({
        id: "payload:alpha",
        class: "Payload",
      }),
    ]);
  });
});
