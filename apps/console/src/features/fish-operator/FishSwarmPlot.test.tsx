import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import * as THREE from "three";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type {
  OperatorSwarmStatusDto,
  SimFishTerminalDto,
  SwarmClustersDto,
} from "@/dto/http";
import { buildFishSceneModel } from "./fish-scene-model";
import {
  FISH_OPERATOR_MODEL_ASSET_BASE_ID,
  FishSwarmPlot,
  fishIndexFromInstanceId,
  resolveFishModelAssetCandidates,
  resolveFishModelAssetUrl,
  selectRenderedFishInstances,
} from "./FishSwarmPlot";

const useGltfMock = vi.hoisted(() => vi.fn());

vi.mock("@react-three/fiber", () => ({
  Canvas: ({
    children,
    onPointerMissed,
  }: {
    children: ReactNode;
    onPointerMissed?: () => void;
  }) => (
    <div data-testid="fish-swarm-canvas" onClick={onPointerMissed}>
      {children}
    </div>
  ),
  useFrame: vi.fn(),
  useThree: () => ({
    camera: {
      projectionMatrix: new THREE.Matrix4(),
      matrixWorldInverse: new THREE.Matrix4(),
    },
  }),
}));

vi.mock("@react-three/drei", () => ({
  OrbitControls: () => <div data-testid="mock-orbit-controls" />,
  Stars: () => null,
  useGLTF: useGltfMock,
}));

beforeEach(() => {
  useGltfMock.mockReset();
  const scene = new THREE.Group();
  scene.add(
    new THREE.Mesh(
      new THREE.BoxGeometry(1, 1, 1),
      new THREE.MeshStandardMaterial({ color: "#ffffff" }),
    ),
  );
  useGltfMock.mockReturnValue({ scene });
  vi.stubGlobal(
    "fetch",
    vi.fn(async () =>
      new Response(
        new Uint8Array([0x67, 0x6c, 0x54, 0x46, 0x02, 0, 0, 0, 12, 0, 0, 0]),
        {
          status: 200,
          headers: { "content-type": "model/gltf-binary" },
        },
      ),
    ),
  );
});

afterEach(() => {
  vi.unstubAllGlobals();
});

function makeModel({
  size = 30,
  selectedFishIndex,
}: {
  size?: number;
  selectedFishIndex?: number | null;
} = {}) {
  const status: OperatorSwarmStatusDto = {
    swarmId: "swarm-1",
    kind: "uc3_conjunction",
    status: "running",
    size,
    done: 0,
    failed: 0,
    timeout: 0,
    running: size,
    pending: 0,
    reportFindingId: null,
    suggestionId: null,
    aggregateKeys: [],
  };
  const clusters: SwarmClustersDto = {
    swarmId: "swarm-1",
    source: "aggregate",
    clusters: [
      {
        label: "maneuver",
        memberFishIndexes: Array.from({ length: Math.floor(size / 2) }, (_v, i) => i),
      },
      {
        label: "hold",
        memberFishIndexes: Array.from(
          { length: size - Math.floor(size / 2) },
          (_v, i) => i + Math.floor(size / 2),
        ),
      },
    ],
    summary: {},
  };
  const terminals: SimFishTerminalDto[] = Array.from({ length: size }, (_v, i) => ({
    simRunId: `r-${i}`,
    fishIndex: i,
    runStatus: "running",
    agentIndex: 0,
    action: i % 5 === 0 ? { kind: "maneuver" } : null,
    observableSummary: null,
    turnsPlayed: (i % 6) + 1,
  }));
  return buildFishSceneModel({
    status,
    clusters,
    terminals,
    selectedFishIndex: selectedFishIndex ?? null,
  });
}

describe("FishSwarmPlot", () => {
  it("renders one pick target per visible fish and loads the model asset", async () => {
    const model = makeModel({ size: 30 });
    render(
      <FishSwarmPlot
        model={model}
        width={1000}
        height={600}
        selectedFishIndex={null}
        hoveredFishIndex={null}
        timelineProgress={1}
        onSelectFish={vi.fn()}
        onHoverFish={vi.fn()}
        onSelectCluster={vi.fn()}
        onTimelineProgressChange={vi.fn()}
      />,
    );
    expect(screen.getAllByTestId(/^fish-dot-\d+$/)).toHaveLength(30);
    expect(screen.getByTestId("fish-band-label-maneuver")).toBeInTheDocument();
    expect(screen.getByTestId("fish-band-label-hold")).toBeInTheDocument();
    expect(screen.getByTestId("fish-instanced-mesh")).toBeInTheDocument();
    expect(screen.getByTestId("fish-camera-controls")).toBeInTheDocument();
    await waitFor(() =>
      expect(useGltfMock).toHaveBeenCalledWith(
        `/assets/models/${FISH_OPERATOR_MODEL_ASSET_BASE_ID}.glb`,
      ),
    );
  });

  it("emits the fishIndex when a dot is clicked and clears selection on background click", () => {
    const model = makeModel({ size: 10 });
    const onSelectFish = vi.fn();
    render(
      <FishSwarmPlot
        model={model}
        width={800}
        height={400}
        selectedFishIndex={null}
        hoveredFishIndex={null}
        timelineProgress={1}
        onSelectFish={onSelectFish}
        onHoverFish={vi.fn()}
        onSelectCluster={vi.fn()}
        onTimelineProgressChange={vi.fn()}
      />,
    );

    fireEvent.click(screen.getByTestId("fish-dot-3"));
    expect(onSelectFish).toHaveBeenLastCalledWith(3);

    fireEvent.click(screen.getByTestId("fish-swarm-canvas"));
    expect(onSelectFish).toHaveBeenLastCalledWith(null);
  });

  it("marks the selected fish for the 3D selection halo", () => {
    const model = makeModel({ size: 8, selectedFishIndex: 4 });
    render(
      <FishSwarmPlot
        model={model}
        width={800}
        height={400}
        selectedFishIndex={4}
        hoveredFishIndex={null}
        timelineProgress={1}
        onSelectFish={vi.fn()}
        onHoverFish={vi.fn()}
        onSelectCluster={vi.fn()}
        onTimelineProgressChange={vi.fn()}
      />,
    );
    expect(screen.getByTestId("fish-selected-4")).toBeInTheDocument();
  });

  it("clicking a cluster band label invokes onSelectCluster with that label", () => {
    const model = makeModel({ size: 10 });
    const onSelectCluster = vi.fn();
    render(
      <FishSwarmPlot
        model={model}
        width={800}
        height={400}
        selectedFishIndex={null}
        hoveredFishIndex={null}
        timelineProgress={1}
        onSelectFish={vi.fn()}
        onHoverFish={vi.fn()}
        onSelectCluster={onSelectCluster}
        onTimelineProgressChange={vi.fn()}
      />,
    );
    fireEvent.click(screen.getByTestId("fish-band-label-maneuver"));
    expect(onSelectCluster).toHaveBeenCalledWith("maneuver");
  });

  it("renders 200 fish without throwing", () => {
    const model = makeModel({ size: 200 });
    expect(() =>
      render(
        <FishSwarmPlot
          model={model}
          width={1280}
          height={800}
          selectedFishIndex={null}
          hoveredFishIndex={null}
          timelineProgress={0.5}
          onSelectFish={vi.fn()}
          onHoverFish={vi.fn()}
          onSelectCluster={vi.fn()}
          onTimelineProgressChange={vi.fn()}
        />,
      ),
    ).not.toThrow();
  });

  it("maps R3F instance ids back to fish indexes for picking", () => {
    const model = makeModel({ size: 6 });
    const instances = model.visibleNodes.map((node) => ({
      node,
      position: new THREE.Vector3(),
      color: new THREE.Color(node.color),
      scale: 1,
      dimmed: false,
    }));

    expect(fishIndexFromInstanceId(instances, 3)).toBe(3);
    expect(fishIndexFromInstanceId(instances, undefined)).toBeNull();
    expect(fishIndexFromInstanceId(instances, 99)).toBeNull();
  });

  it("renders the full swarm at <=300 fish and caps very large swarms while keeping selected/hovered", () => {
    const small = makeModel({ size: 200 });
    const smallInstances = small.visibleNodes.map((node) => ({
      node,
      position: new THREE.Vector3(),
      color: new THREE.Color(node.color),
      scale: 1,
      dimmed: false,
    }));
    expect(selectRenderedFishInstances(smallInstances, null, null)).toHaveLength(200);

    // Above the 300-fish threshold, sampling kicks in but always keeps the
    // selected and hovered fish in the rendered set.
    const big = makeModel({ size: 500 });
    const bigInstances = big.visibleNodes.map((node) => ({
      node,
      position: new THREE.Vector3(),
      color: new THREE.Color(node.color),
      scale: 1,
      dimmed: false,
    }));
    const rendered = selectRenderedFishInstances(bigInstances, 499, 498);
    expect(rendered).toHaveLength(300);
    expect(rendered.some((instance) => instance.node.fishIndex === 499)).toBe(true);
    expect(rendered.some((instance) => instance.node.fishIndex === 498)).toBe(true);
  });

  it("resolves the configured model asset URL before falling back to the asset id path", () => {
    expect(
      resolveFishModelAssetUrl({
        VITE_FISH_OPERATOR_MODEL_URL: "/operator-fish.glb",
      }),
    ).toBe("/operator-fish.glb");
    expect(
      resolveFishModelAssetCandidates({
        VITE_FISH_OPERATOR_MODEL_URL: "/operator-fish.glb",
      })[0],
    ).toBe("/operator-fish.glb");
    expect(
      resolveFishModelAssetUrl({
        VITE_ASSET_BASE_URL: "/generated-assets/",
      }),
    ).toBe(`/generated-assets/${FISH_OPERATOR_MODEL_ASSET_BASE_ID}.glb`);
    expect(
      resolveFishModelAssetCandidates({
        VITE_ASSET_BASE_URL: "/generated-assets/",
      }),
    ).toContain(`/api/assets/${FISH_OPERATOR_MODEL_ASSET_BASE_ID}?asset_type=model`);
  });

  it("does not send the Vite HTML fallback into GLTFLoader", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        new Response("<!doctype html><html></html>", {
          status: 200,
          headers: { "content-type": "text/html" },
        }),
      ),
    );
    const model = makeModel({ size: 12 });
    render(
      <FishSwarmPlot
        model={model}
        width={800}
        height={400}
        selectedFishIndex={null}
        hoveredFishIndex={null}
        timelineProgress={1}
        onSelectFish={vi.fn()}
        onHoverFish={vi.fn()}
        onSelectCluster={vi.fn()}
        onTimelineProgressChange={vi.fn()}
      />,
    );
    await waitFor(() => expect(screen.getByTestId("fish-model-missing")).toBeInTheDocument());
    expect(useGltfMock).not.toHaveBeenCalled();
  });

  it("emits timeline scrubber changes", () => {
    const model = makeModel({ size: 10 });
    const onTimelineProgressChange = vi.fn();
    render(
      <FishSwarmPlot
        model={model}
        width={800}
        height={400}
        selectedFishIndex={null}
        hoveredFishIndex={null}
        timelineProgress={1}
        onSelectFish={vi.fn()}
        onHoverFish={vi.fn()}
        onSelectCluster={vi.fn()}
        onTimelineProgressChange={onTimelineProgressChange}
      />,
    );
    fireEvent.change(screen.getByTestId("fish-swarm-timeline-scrubber"), {
      target: { value: "0.42" },
    });
    expect(onTimelineProgressChange).toHaveBeenCalledWith(0.42);
  });
});
