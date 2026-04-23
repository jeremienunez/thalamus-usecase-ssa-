import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { FindingDto, KgEdgeDto, KgNodeDto } from "@/dto/http";
import type { KgSceneGraph, KgSceneNode } from "./kg-scene";

const state = vi.hoisted(() => ({
  kg: {
    data: undefined as { nodes: KgNodeDto[]; edges: KgEdgeDto[] } | undefined,
    isLoading: false,
  },
  findings: {
    data: undefined as { items: FindingDto[] } | undefined,
  },
  openDrawer: vi.fn(),
  closeDrawer: vi.fn(),
  sceneProps: [] as Array<{
    graph: KgSceneGraph;
    selectedNodeId: string | null;
    focusNodeId: string | null;
    onSelectNode: (node: KgSceneNode) => void;
    onFocusDone: () => void;
  }>,
  findingReadoutProps: [] as Array<{
    findingId: number | null;
    onClose: () => void;
    onFocusEntity: (entityId: string) => void;
  }>,
  drawerProps: [] as Array<{ node: KgNodeDto | null; edges: KgEdgeDto[] }>,
}));

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

vi.mock("./KgScene3d", () => ({
  KgScene3d: (props: {
    graph: KgSceneGraph;
    selectedNodeId: string | null;
    focusNodeId: string | null;
    onSelectNode: (node: KgSceneNode) => void;
    onFocusDone: () => void;
  }) => {
    state.sceneProps.push(props);
    return (
      <div data-testid="kg-scene-3d">
        {props.graph.nodes.map((node) => (
          <button key={node.id} onClick={() => props.onSelectNode(node)}>
            scene:{node.label}
          </button>
        ))}
      </div>
    );
  },
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

function node(overrides: Partial<KgNodeDto> = {}): KgNodeDto {
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

function edge(overrides: Partial<KgEdgeDto> = {}): KgEdgeDto {
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

function finding(overrides: Partial<FindingDto> = {}): FindingDto {
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
  state.sceneProps = [];
  state.findingReadoutProps = [];
  state.drawerProps = [];
  state.openDrawer.mockReset();
  state.closeDrawer.mockReset();
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("ThalamusEntry", () => {
  it("renders the loading shell without mounting the 3D graph when data is absent", () => {
    state.kg.isLoading = true;

    render(<ThalamusEntry />);

    expect(screen.getByText("loading graph…")).toBeInTheDocument();
    expect(screen.getByText("ENTITY CLASSES · orbital layers")).toBeInTheDocument();
    expect(screen.getByTestId("thalamus-drawer")).toHaveTextContent("no-node");
    expect(screen.getByTestId("finding-readout")).toHaveTextContent("no-finding");
    expect(screen.queryByTestId("kg-scene-3d")).not.toBeInTheDocument();
  });

  it("renders 3D graph stats, routes scene selection, focus buttons, and findings", async () => {
    const user = userEvent.setup();
    state.kg.data = {
      nodes: [
        node({ id: "sat:1", label: "ISS LONG LABEL", class: "Satellite", cortex: "catalog" }),
        node({ id: "sat:2", label: "STARLINK", class: "Satellite", cortex: "observations" }),
        node({ id: "op:7", label: "NASA", class: "Operator", cortex: "catalog" }),
        node({ id: "payload:9", label: "Science Payload", class: "Payload", cortex: "data_auditor" }),
      ],
      edges: [
        edge({ id: "edge-1", source: "sat:1", target: "op:7", relation: "operated-by", sourceClass: "field" }),
        edge({ id: "edge-2", source: "sat:1", target: "payload:9", relation: "hosts", sourceClass: "osint" }),
        edge({ id: "edge-3", source: "sat:2", target: "op:7", relation: "operated-by", sourceClass: "derived" }),
        edge({ id: "edge-4", source: "sat:1", target: "finding:12", relation: "flagged-by", sourceClass: "derived" }),
        edge({ id: "edge-5", source: "sat:2", target: "finding:not-a-number", relation: "flagged-by", sourceClass: "derived" }),
      ],
    };
    state.findings.data = {
      items: [
        finding({ id: "f:12", title: "Highest priority finding", priority: 90, cortex: "strategist" }),
        finding({ id: "f:7", title: "Amber priority finding", priority: 60, cortex: "catalog" }),
        { ...finding({ id: "f:2", title: "Missing priority finding", cortex: "catalog" }), priority: undefined } as FindingDto,
      ],
    };

    render(<ThalamusEntry />);

    expect(await screen.findByTestId("kg-scene-3d")).toBeInTheDocument();
    expect(screen.getByText("KNOWLEDGE GRAPH")).toBeInTheDocument();
    expect(screen.getByText("ENTITY DISTRIBUTION")).toBeInTheDocument();
    expect(screen.getByText("TOP HUBS · BY DEGREE")).toBeInTheDocument();
    expect(screen.getByText("TOP RELATIONS")).toBeInTheDocument();
    expect(screen.getByText("TOP FINDINGS · BY PRIORITY")).toBeInTheDocument();
    expect(screen.getAllByText("Highest priority finding").length).toBeGreaterThan(0);
    expect(screen.getByText("P90")).toBeInTheDocument();
    expect(screen.getByText("P60")).toBeInTheDocument();
    expect(screen.getByText("P—")).toBeInTheDocument();

    const scene = state.sceneProps.at(-1);
    expect(scene?.graph.nodes.find((candidate) => candidate.id === "finding:12")).toEqual(
      expect.objectContaining({
        label: "Highest priority finding",
        class: "ConjunctionEvent",
        ghost: true,
        position: expect.arrayContaining([expect.any(Number)]),
      }),
    );

    await user.click(screen.getByRole("button", { name: /scene:ISS LONG LABEL/i }));
    expect(state.openDrawer).toHaveBeenCalledWith("kg:sat:1");
    expect(state.drawerProps.at(-1)).toEqual(
      expect.objectContaining({
        node: expect.objectContaining({ id: "sat:1", label: "ISS LONG LABEL" }),
        edges: expect.arrayContaining([
          expect.objectContaining({ id: "edge-1" }),
          expect.objectContaining({ id: "edge-2" }),
          expect.objectContaining({ id: "edge-4" }),
        ]),
      }),
    );
    await waitFor(() => {
      expect(state.sceneProps.at(-1)?.focusNodeId).toBe("sat:1");
    });
    act(() => {
      state.sceneProps.at(-1)?.onFocusDone();
    });
    await waitFor(() => {
      expect(state.sceneProps.at(-1)?.focusNodeId).toBeNull();
    });

    await user.click(screen.getByRole("button", { name: /^ISS LONG LABEL deg 3$/i }));
    expect(state.openDrawer).toHaveBeenLastCalledWith("kg:sat:1");

    await user.click(screen.getByRole("button", { name: /^Highest priority finding F#12/i }));
    expect(state.closeDrawer).toHaveBeenCalled();
    expect(screen.getByTestId("finding-readout")).toHaveTextContent("finding:12");

    await user.click(screen.getByRole("button", { name: /scene:Finding not-a-number/i }));
    expect(state.openDrawer).toHaveBeenLastCalledWith("kg:finding:not-a-number");
    expect(state.drawerProps.at(-1)).toEqual(
      expect.objectContaining({
        node: expect.objectContaining({ id: "finding:not-a-number", class: "ConjunctionEvent" }),
      }),
    );

    const latestFinding = state.findingReadoutProps.at(-1);
    act(() => {
      latestFinding?.onFocusEntity("sat:2");
    });
    expect(state.openDrawer).toHaveBeenLastCalledWith("kg:sat:2");
    act(() => {
      latestFinding?.onFocusEntity("missing:404");
    });
    expect(state.openDrawer).toHaveBeenLastCalledWith("kg:sat:2");
    act(() => {
      latestFinding?.onClose();
    });
    expect(screen.getByTestId("finding-readout")).toHaveTextContent("no-finding");
  });

  it("renders zero-valued graph metrics when the KG payload is empty", async () => {
    state.kg.data = { nodes: [], edges: [] };

    render(<ThalamusEntry />);

    expect(await screen.findByText("KNOWLEDGE GRAPH")).toBeInTheDocument();
    expect(screen.getByText("0.0")).toBeInTheDocument();
    expect(screen.queryByText("TOP FINDINGS · BY PRIORITY")).not.toBeInTheDocument();
    expect(screen.getByTestId("kg-scene-3d")).toBeInTheDocument();
  });
});
