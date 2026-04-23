import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { SigmaRendererOptions } from "@/adapters/graph/sigma-renderer";
import type { EntityClass, FindingDto, KgEdgeDto, KgNodeDto } from "@/dto/http";

const state = vi.hoisted(() => {
  const graph = {
    hasNode: vi.fn((nodeId: string) => nodeId !== "missing:404"),
  };
  const rendererHandle = {
    kill: vi.fn(),
    resetCamera: vi.fn(),
    focusNode: vi.fn(),
    getNodeAttributes: vi.fn(),
  };
  return {
    kg: {
      data: undefined as { nodes: KgNodeDto[]; edges: KgEdgeDto[] } | undefined,
      isLoading: false,
    },
    findings: {
      data: undefined as { items: FindingDto[] } | undefined,
    },
    openDrawer: vi.fn(),
    closeDrawer: vi.fn(),
    buildKgGraph: vi.fn(() => graph),
    incidentEdgesFor: vi.fn((): KgEdgeDto[] => []),
    createSigmaRenderer: vi.fn(() => rendererHandle),
    graph,
    rendererHandle,
    findingReadoutProps: [] as Array<Record<string, unknown>>,
    drawerProps: [] as Array<Record<string, unknown>>,
  };
});

vi.mock("@/usecases", () => ({
  useKg: () => state.kg,
  useFindings: () => state.findings,
}));

vi.mock("@/shared/ui/uiStore", () => ({
  useUiStore: (selector: (value: { openDrawer: typeof state.openDrawer; closeDrawer: typeof state.closeDrawer }) => unknown) =>
    selector({
      openDrawer: state.openDrawer,
      closeDrawer: state.closeDrawer,
    }),
}));

vi.mock("@/adapters/graph/GraphContext", () => ({
  useGraph: () => ({
    buildKgGraph: state.buildKgGraph,
    incidentEdgesFor: state.incidentEdgesFor,
    createSigmaRenderer: state.createSigmaRenderer,
  }),
}));

vi.mock("./FindingReadout", () => ({
  FindingReadout: (props: {
    findingId: number | null;
    onClose: () => void;
    onFocusEntity: (entityId: string) => void;
  }) => {
    state.findingReadoutProps.push(props);
    return (
      <div data-testid="finding-readout">
        {props.findingId === null ? "no-finding" : `finding:${props.findingId}`}
      </div>
    );
  },
}));

vi.mock("./ThalamusDrawer", () => ({
  ThalamusDrawer: (props: { node: KgNodeDto | null; edges: KgEdgeDto[] }) => {
    state.drawerProps.push(props);
    return (
      <div data-testid="thalamus-drawer">
        {props.node ? `${props.node.id}:${props.edges.length}` : "no-node"}
      </div>
    );
  },
}));

import { ThalamusEntry } from "./Entry";

function node(
  overrides: Partial<KgNodeDto> = {},
): KgNodeDto {
  return {
    id: "sat:1",
    label: "ISS LONG LABEL",
    class: "Satellite",
    degree: 0,
    x: 10,
    y: 20,
    cortex: "catalog",
    ...overrides,
  };
}

function edge(
  overrides: Partial<KgEdgeDto> = {},
): KgEdgeDto {
  return {
    id: "edge-1",
    source: "sat:1",
    target: "op:7",
    relation: "operated-by",
    confidence: 0.8,
    sourceClass: "field",
    ...overrides,
  };
}

function finding(
  overrides: Partial<FindingDto> = {},
): FindingDto {
  return {
    id: "f:12",
    title: "Highest priority finding",
    summary: "Summary",
    cortex: "strategist",
    status: "accepted",
    priority: 90,
    createdAt: "2026-04-22T00:00:00.000Z",
    linkedEntityIds: [],
    evidence: [],
    ...overrides,
  };
}

beforeEach(() => {
  state.kg.data = undefined;
  state.kg.isLoading = false;
  state.findings.data = undefined;
  state.findingReadoutProps = [];
  state.drawerProps = [];
  state.openDrawer.mockReset();
  state.closeDrawer.mockReset();
  state.buildKgGraph.mockReset();
  state.buildKgGraph.mockReturnValue(state.graph);
  state.incidentEdgesFor.mockReset();
  state.incidentEdgesFor.mockReturnValue([]);
  state.createSigmaRenderer.mockReset();
  state.createSigmaRenderer.mockReturnValue(state.rendererHandle);
  state.graph.hasNode.mockReset();
  state.graph.hasNode.mockImplementation((nodeId: string) => nodeId !== "missing:404");
  state.rendererHandle.kill.mockReset();
  state.rendererHandle.resetCamera.mockReset();
  state.rendererHandle.focusNode.mockReset();
  state.rendererHandle.getNodeAttributes.mockReset();
  document.body.style.cursor = "default";
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("ThalamusEntry", () => {
  it("renders the loading shell without building a graph when data is absent", () => {
    state.kg.isLoading = true;

    render(<ThalamusEntry />);

    expect(screen.getByText("loading graph…")).toBeInTheDocument();
    expect(screen.getByText("ENTITY CLASSES · grouped by sector")).toBeInTheDocument();
    expect(screen.getByTestId("thalamus-drawer")).toHaveTextContent("no-node");
    expect(screen.getByTestId("finding-readout")).toHaveTextContent("no-finding");
    expect(state.buildKgGraph).not.toHaveBeenCalled();
    expect(state.createSigmaRenderer).not.toHaveBeenCalled();
  });

  it("builds graph stats, drives node selection, and cleans up the Sigma handle", async () => {
    const user = userEvent.setup();
    const sat1 = node({ id: "sat:1", label: "ISS LONG LABEL", class: "Satellite", cortex: "catalog" });
    const sat2 = node({ id: "sat:2", label: "STARLINK", class: "Satellite", cortex: "observations" });
    const operator = node({ id: "op:7", label: "NASA", class: "Operator", cortex: "catalog" });
    const payload = node({ id: "payload:9", label: "Science Payload", class: "Payload", cortex: "data_auditor" });
    const debris = node({ id: "debris:5", label: "Fragment", class: "Debris", cortex: "observations" });
    state.kg.data = {
      nodes: [sat1, sat2, operator, payload, debris],
      edges: [
        edge({ id: "edge-1", source: "sat:1", target: "op:7", relation: "operated-by", sourceClass: "field" }),
        edge({ id: "edge-2", source: "sat:1", target: "payload:9", relation: "hosts", sourceClass: "osint" }),
        edge({ id: "edge-3", source: "sat:2", target: "op:7", relation: "operated-by", sourceClass: "sim" }),
        edge({ id: "edge-4", source: "sat:1", target: "finding:12", relation: "flagged-by", sourceClass: "derived" }),
      ],
    };
    const unresolvedPriority = {
      ...finding({ id: "f:2", title: "Missing priority finding", cortex: "catalog" }),
      priority: undefined,
    } as FindingDto;
    const unresolvedPriorityTwo = {
      ...finding({ id: "f:3", title: "Another missing priority", cortex: "catalog" }),
      priority: undefined,
    } as FindingDto;
    state.findings.data = {
      items: [
        finding({ id: "f:12", title: "Highest priority finding", priority: 90, cortex: "strategist" }),
        finding({ id: "f:7", title: "Amber priority finding", priority: 60, cortex: "catalog" }),
        unresolvedPriority,
        unresolvedPriorityTwo,
      ],
    };
    state.incidentEdgesFor.mockReturnValue([
      edge({ id: "inc-1", source: "sat:1", target: "op:7", relation: "operated-by" }),
      edge({ id: "inc-2", source: "payload:9", target: "sat:1", relation: "mounted-on" }),
    ]);
    state.rendererHandle.getNodeAttributes.mockImplementation((nodeId: string) => ({
      label: nodeId === "finding:not-a-number" ? "Ghost finding" : "ISS LONG LABEL",
      entityClass: (nodeId === "finding:not-a-number" ? "ConjunctionEvent" : "Satellite") as EntityClass,
      degree: 3,
      x: 11,
      y: 22,
      cortex: "catalog",
    }));

    const { unmount } = render(<ThalamusEntry />);

    expect(await screen.findByText("KNOWLEDGE GRAPH")).toBeInTheDocument();
    expect(screen.getByText("CLASS DISTRIBUTION")).toBeInTheDocument();
    expect(screen.getByText("TOP FINDINGS · BY PRIORITY")).toBeInTheDocument();
    expect(screen.getByText("Highest priority finding")).toBeInTheDocument();
    expect(screen.getByText("P90")).toBeInTheDocument();
    expect(screen.getByText("P60")).toBeInTheDocument();
    expect(screen.getAllByText("P—").length).toBeGreaterThan(0);
    expect(screen.getByText("TOP HUBS · BY DEGREE")).toBeInTheDocument();
    expect(screen.getByText("TOP RELATIONS")).toBeInTheDocument();
    expect(state.buildKgGraph).toHaveBeenCalledOnce();
    const spec = state.buildKgGraph.mock.calls[0]?.[0] as {
      layout: Map<string, { x: number; y: number }>;
      findingTitleById: Map<string, string>;
      ghostClassFor: (id: string) => EntityClass;
      truncateLabel: (label: string, max: number) => string;
    };
    expect(spec.layout.get("sat:1")).toEqual(expect.objectContaining({ x: expect.any(Number), y: expect.any(Number) }));
    expect(spec.layout.get("sat:2")).toEqual(expect.objectContaining({ x: expect.any(Number), y: expect.any(Number) }));
    expect(spec.findingTitleById.get("finding:f:12")).toBe("Highest priority finding");
    expect(spec.ghostClassFor("finding:1")).toBe("ConjunctionEvent");
    expect(spec.ghostClassFor("conj:1")).toBe("ConjunctionEvent");
    expect(spec.ghostClassFor("sat:1")).toBe("Satellite");
    expect(spec.ghostClassFor("op:7")).toBe("Operator");
    expect(spec.ghostClassFor("regime:leo")).toBe("OrbitRegime");
    expect(spec.ghostClassFor("payload:9")).toBe("Payload");
    expect(spec.ghostClassFor("maneuver:2")).toBe("Maneuver");
    expect(spec.ghostClassFor("debris:3")).toBe("Debris");
    expect(spec.ghostClassFor("mystery:4")).toBe("ConjunctionEvent");
    expect(spec.truncateLabel("short", 10)).toBe("short");
    expect(spec.truncateLabel("long label here", 8)).toBe("long la…");
    expect(state.createSigmaRenderer).toHaveBeenCalledOnce();

    const options = state.createSigmaRenderer.mock.calls[0]?.[2] as SigmaRendererOptions;
    act(() => {
      options.onHoverChange("pointer");
    });
    expect(document.body.style.cursor).toBe("pointer");

    await user.click(screen.getByRole("button", { name: /ISS LONG LABEL/i }));
    expect(state.rendererHandle.focusNode).toHaveBeenCalledWith("sat:1");
    expect(state.openDrawer).toHaveBeenCalledWith("kg:sat:1");
    expect(state.drawerProps.at(-1)).toEqual(
      expect.objectContaining({
        node: expect.objectContaining({ id: "sat:1" }),
        edges: expect.arrayContaining([
          expect.objectContaining({ id: "inc-1" }),
          expect.objectContaining({ id: "inc-2" }),
        ]),
      }),
    );

    state.graph.hasNode.mockImplementation(
      (nodeId: string) => nodeId !== "sat:2" && nodeId !== "missing:404",
    );
    await user.click(screen.getByRole("button", { name: /STARLINK/i }));
    expect(state.rendererHandle.focusNode).not.toHaveBeenCalledWith("sat:2");

    await user.click(screen.getByRole("button", { name: /Highest priority finding/i }));
    expect(state.closeDrawer).toHaveBeenCalled();
    expect(screen.getByTestId("finding-readout")).toHaveTextContent("finding:12");

    act(() => {
      options.onNodeClick("finding:18", {});
    });
    expect(screen.getByTestId("finding-readout")).toHaveTextContent("finding:18");

    act(() => {
      options.onNodeClick("finding:not-a-number", state.rendererHandle.getNodeAttributes("finding:not-a-number"));
    });
    expect(state.openDrawer).toHaveBeenCalledWith("kg:finding:not-a-number");
    expect(state.drawerProps.at(-1)).toEqual(
      expect.objectContaining({
        node: expect.objectContaining({ id: "finding:not-a-number", class: "ConjunctionEvent" }),
      }),
    );

    const latestFinding = state.findingReadoutProps.at(-1) as {
      onFocusEntity: (entityId: string) => void;
      onClose: () => void;
    };
    act(() => {
      latestFinding.onFocusEntity("sat:1");
      latestFinding.onFocusEntity("missing:404");
      latestFinding.onClose();
    });
    expect(state.rendererHandle.focusNode).toHaveBeenCalledWith("sat:1");
    expect(screen.getByTestId("finding-readout")).toHaveTextContent("no-finding");

    unmount();
    expect(state.rendererHandle.kill).toHaveBeenCalled();
  });

  it("renders zero-valued graph metrics when the KG payload is empty", async () => {
    state.kg.data = {
      nodes: [],
      edges: [],
    };
    state.findings.data = undefined;

    render(<ThalamusEntry />);

    expect(await screen.findByText("KNOWLEDGE GRAPH")).toBeInTheDocument();
    expect(screen.getByText("0.0")).toBeInTheDocument();
    expect(screen.queryByText("TOP FINDINGS · BY PRIORITY")).not.toBeInTheDocument();
  });

  it("tolerates defensive fallback branches for graph maps and findings arrays", async () => {
    const originalHas = Map.prototype.has;
    const originalGet = Map.prototype.get;
    let satelliteArrayGets = 0;
    let satelliteNumberGets = 0;
    vi.spyOn(Map.prototype, "has").mockImplementation(function (
      this: Map<unknown, unknown>,
      key: unknown,
    ) {
      if (key === "Debris" && !originalHas.call(this, key)) {
        return true;
      }
      return originalHas.call(this, key);
    });
    vi.spyOn(Map.prototype, "get").mockImplementation(function (
      this: Map<unknown, unknown>,
      key: unknown,
    ) {
      const value = originalGet.call(this, key);
      if (key === "Satellite") {
        if (Array.isArray(value)) {
          satelliteArrayGets++;
          if (satelliteArrayGets === 2) {
            return undefined;
          }
        }
        if (typeof value === "number") {
          satelliteNumberGets++;
          if (satelliteNumberGets === 2) {
            return undefined;
          }
        }
      }
      if (key === "Debris" && value === 0) {
        return undefined;
      }
      if (key === "Satellite" && value === undefined && satelliteArrayGets >= 2) {
        if (satelliteNumberGets >= 2) {
          return undefined;
        }
      }
      return value;
    });
    state.kg.data = {
      nodes: [node({ id: "sat:1", label: "Solo satellite", class: "Satellite" })],
      edges: [],
    };
    let itemAccesses = 0;
    state.findings.data = {
      get items() {
        itemAccesses++;
        return itemAccesses <= 2
          ? [finding({ id: "f:99", title: "Getter-backed finding", priority: 90 })]
          : undefined;
      },
    } as { items: FindingDto[] };

    render(<ThalamusEntry />);

    expect(await screen.findByText("KNOWLEDGE GRAPH")).toBeInTheDocument();
    expect(screen.queryByText("Getter-backed finding")).not.toBeInTheDocument();
  });
});
