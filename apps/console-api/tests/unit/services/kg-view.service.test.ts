import { describe, expect, it, vi } from "vitest";
import {
  KgViewService,
  type KgReadPort,
} from "../../../src/services/kg-view.service";

function mockRepo(): KgReadPort {
  return {
    loadNodeSources: vi.fn(),
    listRecentEdges: vi.fn(),
  };
}

describe("KgViewService.listNodes", () => {
  it("maps node sources in regime → operator → satellite → finding order", async () => {
    const repo = mockRepo();
    (repo.loadNodeSources as ReturnType<typeof vi.fn>).mockResolvedValue({
      regimes: [{ id: "1", name: "LEO" }],
      ops: [{ id: "2", name: "ESA" }],
      sats: [{ id: "3", name: "SENTINEL-1A" }],
      findings: [{ id: "4", title: "brief anomaly", cortex: "classification_auditor" }],
    });

    const { items } = await new KgViewService(repo).listNodes();

    expect(items.map((item) => item.id)).toEqual([
      "regime:LEO",
      "op:ESA",
      "sat:3",
      "finding:4",
    ]);
    expect(items[3]).toMatchObject({
      label: "brief anomaly",
      class: "ConjunctionEvent",
      cortex: "classification_auditor",
    });
  });
});

describe("KgViewService.listEdges", () => {
  it("maps repository rows to graph edges", async () => {
    const repo = mockRepo();
    (repo.listRecentEdges as ReturnType<typeof vi.fn>).mockResolvedValue([
      {
        id: "10",
        finding_id: "4",
        entity_type: "satellite",
        entity_id: "3",
        relation: "about",
      },
      {
        id: "11",
        finding_id: "4",
        entity_type: "operator",
        entity_id: "ESA",
        relation: "owned_by",
      },
      {
        id: "12",
        finding_id: "4",
        entity_type: "orbit_regime",
        entity_id: "LEO",
        relation: "in_regime",
      },
    ]);

    const { items } = await new KgViewService(repo).listEdges();

    expect(items).toEqual([
      {
        id: "10",
        source: "finding:4",
        target: "sat:3",
        relation: "about",
      },
      {
        id: "11",
        source: "finding:4",
        target: "op:ESA",
        relation: "owned_by",
      },
      {
        id: "12",
        source: "finding:4",
        target: "regime:LEO",
        relation: "in_regime",
      },
    ]);
  });
});

describe("KgViewService.getNeighbourhood", () => {
  it("returns a BFS neighbourhood rooted at the requested node", async () => {
    const repo = mockRepo();
    (repo.loadNodeSources as ReturnType<typeof vi.fn>).mockResolvedValue({
      regimes: [{ id: "1", name: "LEO" }],
      ops: [{ id: "2", name: "ESA" }],
      sats: [{ id: "3", name: "SENTINEL-1A" }],
      findings: [{ id: "4", title: "brief anomaly", cortex: "classification_auditor" }],
    });
    (repo.listRecentEdges as ReturnType<typeof vi.fn>).mockResolvedValue([
      {
        id: "10",
        finding_id: "4",
        entity_type: "satellite",
        entity_id: "3",
        relation: "about",
      },
      {
        id: "11",
        finding_id: "4",
        entity_type: "operator",
        entity_id: "ESA",
        relation: "owned_by",
      },
      {
        id: "12",
        finding_id: "4",
        entity_type: "orbit_regime",
        entity_id: "LEO",
        relation: "in_regime",
      },
    ]);

    const graph = await new KgViewService(repo).getNeighbourhood("finding:4", 1);

    expect(graph.root).toBe("finding:4");
    expect(graph.nodes.map((node) => node.id).sort()).toEqual([
      "finding:4",
      "op:ESA",
      "regime:LEO",
      "sat:3",
    ]);
    expect(graph.edges.map((edge) => edge.id).sort()).toEqual(["10", "11", "12"]);
  });

  it("adds a fallback node when the requested id is absent from the known KG view", async () => {
    const repo = mockRepo();
    (repo.loadNodeSources as ReturnType<typeof vi.fn>).mockResolvedValue({
      regimes: [],
      ops: [],
      sats: [],
      findings: [],
    });
    (repo.listRecentEdges as ReturnType<typeof vi.fn>).mockResolvedValue([]);

    const graph = await new KgViewService(repo).getNeighbourhood("custom:root", 2);

    expect(graph).toEqual({
      root: "custom:root",
      nodes: [
        { id: "custom:root", label: "custom:root", class: "ConjunctionEvent" },
      ],
      edges: [],
    });
  });

  it("normalizes CLI-style entity aliases before traversing the KG view", async () => {
    const repo = mockRepo();
    (repo.loadNodeSources as ReturnType<typeof vi.fn>).mockResolvedValue({
      regimes: [],
      ops: [],
      sats: [{ id: "3", name: "SENTINEL-1A" }],
      findings: [{ id: "4", title: "brief anomaly", cortex: "classification_auditor" }],
    });
    (repo.listRecentEdges as ReturnType<typeof vi.fn>).mockResolvedValue([
      {
        id: "10",
        finding_id: "4",
        entity_type: "satellite",
        entity_id: "3",
        relation: "about",
      },
    ]);

    const graph = await new KgViewService(repo).getNeighbourhood("satellite:3", 1);

    expect(graph.root).toBe("sat:3");
    expect(graph.nodes.map((node) => node.id).sort()).toEqual(["finding:4", "sat:3"]);
  });
});
