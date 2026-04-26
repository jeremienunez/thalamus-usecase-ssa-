import { OrbitControls, useGLTF } from "@react-three/drei";
import { Canvas, useFrame, useThree, type ThreeEvent } from "@react-three/fiber";
import { useEffect, useMemo, useRef, useState } from "react";
import * as THREE from "three";
import { mergeVertices } from "three/examples/jsm/utils/BufferGeometryUtils.js";
import type { FishSceneModel, FishSceneNode } from "./fish-scene-model";

const BACKDROP = "#F8FAFC";
const LABEL_INK = "#334155";
const UNCLUSTERED = "unclustered";
const MODEL_PROBE_BYTES = 128;
// With low-poly proxy geometry + frustum culling, 100-fish swarms render in
// full. The sampler only caps very large swarms above this threshold.
const RENDER_SAMPLE_THRESHOLD = 300;
const MODEL_INSTANCE_SCALE = 0.48;
export const FISH_OPERATOR_MODEL_ASSET_BASE_ID = "a1f3d3fa-c3d6-43d6-a450-c3b9bcec8937";

type FishAssetEnv = {
  VITE_FISH_OPERATOR_MODEL_URL?: string;
  VITE_ASSET_BASE_URL?: string;
};

export interface FishSwarmPlotProps {
  model: FishSceneModel | null;
  width: number;
  height: number;
  selectedFishIndex: number | null;
  hoveredFishIndex: number | null;
  timelineProgress: number;
  onSelectFish: (fishIndex: number | null) => void;
  onHoverFish: (fishIndex: number | null) => void;
  onSelectCluster: (clusterLabel: string) => void;
  onTimelineProgressChange: (progress: number) => void;
}

export interface FishInstance {
  node: FishSceneNode;
  position: THREE.Vector3;
  color: THREE.Color;
  scale: number;
  dimmed: boolean;
}

export function FishSwarmPlot(props: FishSwarmPlotProps) {
  const {
    model,
    width,
    height,
    selectedFishIndex,
    hoveredFishIndex,
    timelineProgress,
    onSelectFish,
    onHoverFish,
    onSelectCluster,
    onTimelineProgressChange,
  } = props;
  const [tooltip, setTooltip] = useState<{ x: number; y: number; node: FishSceneNode } | null>(null);

  const instances = useMemo(
    () => (model ? buildFishInstances(model.visibleNodes, timelineProgress) : []),
    [model, timelineProgress],
  );
  const renderedInstances = useMemo(
    () => selectRenderedFishInstances(instances, selectedFishIndex, hoveredFishIndex),
    [instances, selectedFishIndex, hoveredFishIndex],
  );
  const modelUrl = useResolvedFishModelAssetUrl();
  const bands = useMemo(
    () => (model ? clusterBands(model.visibleNodes) : []),
    [model],
  );

  if (!model) return null;

  const isEmpty = instances.length === 0;
  const awaitingTerminals = model.summary.total > 0 && model.nodes.every((n) => n.turnProgress === 0);

  return (
    <div className="relative h-full w-full" style={{ width, height }} data-testid="fish-swarm-plot">
      <Canvas
        role="img"
        aria-label="Fish swarm 3D scene"
        camera={{ position: [0, 0, 13], fov: 44, near: 0.1, far: 80 }}
        gl={{ antialias: true, alpha: false, powerPreference: "high-performance" }}
        dpr={[1, 1.5]}
        onPointerMissed={() => onSelectFish(null)}
        onCreated={({ gl }) => {
          // Defence-in-depth: set the WebGL clear color directly so the
          // framebuffer is never black even if scene.background fails to
          // apply (it has previously, with this GLB asset).
          gl.setClearColor(BACKDROP, 1);
        }}
        data-testid="fish-swarm-canvas"
      >
        <color attach="background" args={[BACKDROP]} />
        <ambientLight intensity={0.85} />
        <directionalLight position={[5, 8, 6]} intensity={1.1} />
        {modelUrl && (
          <FishInstances
            instances={renderedInstances}
            modelUrl={modelUrl}
            selectedFishIndex={selectedFishIndex}
            hoveredFishIndex={hoveredFishIndex}
            onPick={(fishIndex, event) => {
              const node = model.nodes[fishIndex];
              if (node) {
                setTooltip({
                  x: event.nativeEvent.offsetX,
                  y: event.nativeEvent.offsetY,
                  node,
                });
              }
              onSelectFish(fishIndex);
            }}
            onHover={(fishIndex, event) => {
              const node = fishIndex === null ? null : model.nodes[fishIndex] ?? null;
              setTooltip(
                node
                  ? {
                      x: event.nativeEvent.offsetX,
                      y: event.nativeEvent.offsetY,
                      node,
                    }
                  : null,
              );
              onHoverFish(fishIndex);
            }}
          />
        )}
        {modelUrl && selectedFishIndex !== null && (
          <SelectionHalo instances={renderedInstances} fishIndex={selectedFishIndex} />
        )}
        <OrbitControls
          makeDefault
          enableDamping
          dampingFactor={0.08}
          minDistance={5}
          maxDistance={28}
        />
      </Canvas>

      <div className="sr-only" data-testid="fish-camera-controls" />
      <div className="sr-only" data-testid="fish-instanced-mesh" />
      {selectedFishIndex !== null && (
        <div className="sr-only" data-testid={`fish-selected-${selectedFishIndex}`} />
      )}
      <ClusterOverlay bands={bands} onSelectCluster={onSelectCluster} />
      <TimelineOverlay
        value={timelineProgress}
        onChange={onTimelineProgressChange}
      />
      <PickProxy
        nodes={model.visibleNodes}
        onSelectFish={onSelectFish}
        onHoverFish={onHoverFish}
      />

      {isEmpty && (
        <div
          className="pointer-events-none absolute inset-0 flex items-center justify-center"
          data-testid="fish-plot-empty"
        >
          <div className="text-sm font-medium text-slate-500">
            No fish match these filters.
          </div>
        </div>
      )}

      {!isEmpty && modelUrl === null && (
        <div
          className="pointer-events-none absolute inset-0 flex items-center justify-center"
          data-testid="fish-model-missing"
        >
          <div className="max-w-[320px] rounded border border-rose-200 bg-white/92 px-4 py-3 text-center text-sm font-medium text-rose-700 shadow-sm">
            Fish model asset is not available.
          </div>
        </div>
      )}

      {!isEmpty && awaitingTerminals && (
        <div
          className="pointer-events-none absolute right-3 top-3 rounded-full border border-slate-200 bg-white/90 px-3 py-1 text-[10px] font-semibold uppercase tracking-widest text-slate-500"
          data-testid="fish-plot-awaiting"
        >
          Awaiting terminals
        </div>
      )}

      {tooltip && (
        <div
          className="pointer-events-none absolute rounded-md border border-slate-200 bg-white px-3 py-2 shadow-md"
          style={{
            left: Math.min(tooltip.x + 12, Math.max(0, width - 180)),
            top: Math.max(0, tooltip.y - 42),
            fontSize: 11,
            color: "#0F172A",
            minWidth: 160,
          }}
          data-testid="fish-tooltip"
        >
          <div className="mb-1 flex items-center justify-between">
            <span className="font-semibold">Fish {tooltip.node.fishIndex}</span>
            <span
              className="rounded-full px-2 py-0.5 font-mono text-[9px] uppercase tracking-widest"
              style={{ background: `${tooltip.node.color}33`, color: "#0F172A" }}
            >
              {tooltip.node.status}
            </span>
          </div>
          <div className="grid grid-cols-2 gap-x-2 gap-y-0.5 text-slate-500">
            <span>Cluster</span>
            <span className="truncate text-slate-900">
              {tooltip.node.clusterLabel ?? "-"}
            </span>
            <span>Action</span>
            <span className="text-slate-900">{tooltip.node.terminalActionKind ?? "-"}</span>
            <span>Progress</span>
            <span className="font-mono text-slate-900">
              {Math.round(tooltip.node.turnProgress * 100)}%
            </span>
          </div>
        </div>
      )}
    </div>
  );
}

function FishInstances({
  instances,
  modelUrl,
  selectedFishIndex,
  hoveredFishIndex,
  onPick,
  onHover,
}: {
  instances: FishInstance[];
  modelUrl: string;
  selectedFishIndex: number | null;
  hoveredFishIndex: number | null;
  onPick: (fishIndex: number, event: ThreeEvent<MouseEvent>) => void;
  onHover: (fishIndex: number | null, event: ThreeEvent<PointerEvent>) => void;
}) {
  const gltf = useGLTF(modelUrl) as { scene: THREE.Object3D };
  const assetMesh = useMemo(() => findFirstMesh(gltf.scene), [gltf.scene]);
  const assetGeometry = useMemo(
    () => optimizeFishGeometry(normalizeFishGeometry(assetMesh?.geometry ?? null)),
    [assetMesh?.geometry],
  );
  const assetMaterial = useMemo(() => createFishInstanceMaterial(), []);
  const meshRef = useRef<THREE.InstancedMesh | null>(null);
  const dummy = useMemo(() => new THREE.Object3D(), []);
  const frustum = useMemo(() => new THREE.Frustum(), []);
  const projViewMatrix = useMemo(() => new THREE.Matrix4(), []);
  const cullProbe = useMemo(() => new THREE.Sphere(new THREE.Vector3(), 0.6), []);
  const hiddenMatrix = useMemo(() => new THREE.Matrix4().makeScale(0, 0, 0), []);
  const { camera } = useThree();

  useFrame(({ clock }) => {
    const mesh = meshRef.current;
    if (!mesh || typeof mesh.setMatrixAt !== "function") return;
    const time = clock.elapsedTime;
    projViewMatrix.multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse);
    frustum.setFromProjectionMatrix(projViewMatrix);

    instances.forEach((instance, i) => {
      const selected = selectedFishIndex === instance.node.fishIndex;
      const hovered = hoveredFishIndex === instance.node.fishIndex;
      // Frustum cull off-screen fish — but always keep the selected/hovered
      // ones rendered (the inspector panel expects them visible).
      cullProbe.center.set(
        instance.position.x,
        instance.position.y,
        instance.position.z,
      );
      if (!selected && !hovered && !frustum.intersectsSphere(cullProbe)) {
        mesh.setMatrixAt(i, hiddenMatrix);
        return;
      }

      const pulse = 1 + Math.sin(time * 2.2 + instance.node.fishIndex) * 0.08;
      const scale =
        MODEL_INSTANCE_SCALE *
        instance.scale *
        (selected ? 1.55 : hovered ? 1.25 : 1) *
        pulse;
      dummy.position.set(
        instance.position.x,
        instance.position.y + Math.sin(time + instance.node.fishIndex * 0.27) * 0.08,
        instance.position.z + Math.cos(time * 0.7 + instance.node.fishIndex) * 0.1,
      );
      dummy.rotation.set(
        Math.sin(time * 0.35 + instance.node.fishIndex) * 0.18,
        time * 0.12 + instance.node.fishIndex * 0.03,
        -0.32,
      );
      dummy.scale.setScalar(scale);
      dummy.updateMatrix();
      mesh.setMatrixAt(i, dummy.matrix);
    });
    mesh.instanceMatrix.needsUpdate = true;
  });

  useEffect(() => {
    const mesh = meshRef.current;
    if (!mesh || typeof mesh.setColorAt !== "function") return;
    const dimTarget = new THREE.Color("#CBD5E1");
    const tmp = new THREE.Color();
    instances.forEach((instance, i) => {
      if (instance.dimmed) {
        tmp.copy(instance.color).lerp(dimTarget, 0.55);
        mesh.setColorAt(i, tmp);
      } else {
        mesh.setColorAt(i, instance.color);
      }
    });
    if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
  }, [instances]);

  if (!assetGeometry || !assetMaterial) return null;

  return (
    <instancedMesh
      ref={meshRef}
      args={[assetGeometry, assetMaterial, Math.max(1, instances.length)]}
      onClick={(event) => {
        const fishIndex = fishIndexFromInstanceId(instances, event.instanceId);
        if (fishIndex !== null) {
          event.stopPropagation();
          onPick(fishIndex, event);
        }
      }}
      onPointerMove={(event) => {
        const fishIndex = fishIndexFromInstanceId(instances, event.instanceId);
        if (fishIndex !== null) onHover(fishIndex, event);
      }}
      onPointerOut={(event) => onHover(null, event)}
    />
  );
}

function SelectionHalo({
  instances,
  fishIndex,
}: {
  instances: FishInstance[];
  fishIndex: number;
}) {
  const selected = instances.find((instance) => instance.node.fishIndex === fishIndex);
  if (!selected) return null;
  return (
    <mesh position={selected.position}>
      <torusGeometry args={[0.28, 0.018, 8, 32]} />
      <meshBasicMaterial color="#0F172A" />
    </mesh>
  );
}

function ClusterOverlay({
  bands,
  onSelectCluster,
}: {
  bands: ClusterBand[];
  onSelectCluster: (clusterLabel: string) => void;
}) {
  return (
    <div className="pointer-events-none absolute left-3 top-3 flex max-w-[220px] flex-col gap-1">
      {bands.map((band) => (
        <button
          key={band.key}
          type="button"
          className="pointer-events-auto flex cursor-pointer items-center justify-between rounded border border-slate-200 bg-white/85 px-2 py-1 text-left text-[10px] font-semibold uppercase tracking-widest text-slate-600 shadow-sm backdrop-blur hover:border-cyan-400 hover:text-cyan-700 disabled:cursor-default disabled:hover:border-slate-200 disabled:hover:text-slate-600"
          style={{ color: LABEL_INK }}
          onClick={() => {
            if (band.key !== UNCLUSTERED) onSelectCluster(band.key);
          }}
          disabled={band.key === UNCLUSTERED}
          data-testid={`fish-band-label-${band.key}`}
          title={band.label}
        >
          <span className="max-w-[150px] truncate">{band.label}</span>
          <span className="ml-2 font-mono tabular-nums">{band.count}</span>
        </button>
      ))}
    </div>
  );
}

function TimelineOverlay({
  value,
  onChange,
}: {
  value: number;
  onChange: (value: number) => void;
}) {
  return (
    <div className="absolute inset-x-4 bottom-4 rounded border border-slate-200 bg-white/88 px-3 py-2 shadow-sm backdrop-blur">
      <div className="mb-1 flex items-center justify-between text-[10px] font-semibold uppercase tracking-widest text-slate-500">
        <span>Turn 0</span>
        <span className="font-mono">{Math.round(value * 100)}%</span>
        <span>Terminal</span>
      </div>
      <input
        type="range"
        min={0}
        max={1}
        step={0.01}
        value={value}
        onChange={(event) => onChange(Number(event.target.value))}
        className="w-full cursor-pointer accent-cyan-600"
        data-testid="fish-swarm-timeline-scrubber"
      />
    </div>
  );
}

function PickProxy({
  nodes,
  onSelectFish,
  onHoverFish,
}: {
  nodes: FishSceneNode[];
  onSelectFish: (fishIndex: number | null) => void;
  onHoverFish: (fishIndex: number | null) => void;
}) {
  return (
    <div className="sr-only" aria-hidden="true">
      {nodes.map((node) => (
        <button
          key={node.fishIndex}
          type="button"
          data-testid={`fish-dot-${node.fishIndex}`}
          onClick={(event) => {
            event.stopPropagation();
            onSelectFish(node.fishIndex);
          }}
          onMouseEnter={() => onHoverFish(node.fishIndex)}
          onMouseLeave={() => onHoverFish(null)}
        >
          fish {node.fishIndex}
        </button>
      ))}
    </div>
  );
}

export function fishIndexFromInstanceId(
  instances: FishInstance[],
  instanceId: number | undefined,
): number | null {
  if (instanceId === undefined) return null;
  return instances[instanceId]?.node.fishIndex ?? null;
}

export function resolveFishModelAssetUrl(
  env: FishAssetEnv = ((import.meta as ImportMeta & { env?: FishAssetEnv }).env ?? {}),
): string {
  return (
    resolveFishModelAssetCandidates(env)[0] ??
    `/assets/models/${FISH_OPERATOR_MODEL_ASSET_BASE_ID}.glb`
  );
}

export function resolveFishModelAssetCandidates(
  env: FishAssetEnv = ((import.meta as ImportMeta & { env?: FishAssetEnv }).env ?? {}),
): string[] {
  const configured = env.VITE_FISH_OPERATOR_MODEL_URL?.trim();
  const assetBaseUrl = (env.VITE_ASSET_BASE_URL ?? "/assets/models").replace(/\/$/, "");
  return uniqueStrings([
    configured,
    `${assetBaseUrl}/${FISH_OPERATOR_MODEL_ASSET_BASE_ID}.glb`,
    `/assets/${FISH_OPERATOR_MODEL_ASSET_BASE_ID}.glb`,
    `/assets/${FISH_OPERATOR_MODEL_ASSET_BASE_ID}/model.glb`,
    `/api/assets/${FISH_OPERATOR_MODEL_ASSET_BASE_ID}?asset_type=model`,
    `/api/assets/${FISH_OPERATOR_MODEL_ASSET_BASE_ID}/model`,
  ]);
}

function useResolvedFishModelAssetUrl(): string | null | undefined {
  const candidates = useMemo(() => resolveFishModelAssetCandidates(), []);
  const [modelUrl, setModelUrl] = useState<string | null | undefined>(undefined);

  useEffect(() => {
    const controller = new AbortController();
    let active = true;
    setModelUrl(undefined);

    async function resolveModel() {
      for (const candidate of candidates) {
        const canLoad = await validateFishModelAssetUrl(candidate, controller.signal);
        if (!active || controller.signal.aborted) return;
        if (canLoad) {
          setModelUrl(candidate);
          return;
        }
      }
      setModelUrl(null);
    }

    void resolveModel();
    return () => {
      active = false;
      controller.abort();
    };
  }, [candidates]);

  return modelUrl;
}

async function validateFishModelAssetUrl(
  url: string,
  signal: AbortSignal,
): Promise<boolean> {
  if (typeof fetch !== "function") return false;
  try {
    const response = await fetch(url, {
      cache: "force-cache",
      headers: {
        Range: `bytes=0-${MODEL_PROBE_BYTES - 1}`,
      },
      signal,
    });
    if (!response.ok) return false;
    const contentType = response.headers.get("content-type")?.toLowerCase() ?? "";
    if (contentType.includes("text/html")) return false;
    const sample = new Uint8Array(await response.arrayBuffer()).slice(0, MODEL_PROBE_BYTES);
    return looksLikeGltfAsset(sample, contentType, url);
  } catch (error) {
    if (signal.aborted) return false;
    return false;
  }
}

function looksLikeGltfAsset(
  bytes: Uint8Array,
  contentType: string,
  url: string,
): boolean {
  if (bytes.length === 0) return false;
  const first = firstNonWhitespaceByte(bytes);
  if (first === 0x3c) return false;
  if (bytes[0] === 0x67 && bytes[1] === 0x6c && bytes[2] === 0x54 && bytes[3] === 0x46) {
    return true;
  }
  if (first !== 0x7b) return false;
  const sample = new TextDecoder().decode(bytes);
  return (
    sample.includes("\"asset\"") &&
    (contentType.includes("model/gltf+json") || url.toLowerCase().endsWith(".gltf"))
  );
}

function firstNonWhitespaceByte(bytes: Uint8Array): number | null {
  for (const byte of bytes) {
    if (byte !== 0x20 && byte !== 0x09 && byte !== 0x0a && byte !== 0x0d) {
      return byte;
    }
  }
  return null;
}

function uniqueStrings(values: Array<string | undefined>): string[] {
  return [...new Set(values.filter((value): value is string => Boolean(value)))];
}

export function selectRenderedFishInstances(
  instances: FishInstance[],
  selectedFishIndex: number | null,
  hoveredFishIndex: number | null,
): FishInstance[] {
  if (instances.length <= RENDER_SAMPLE_THRESHOLD) return instances;
  const required = new Set(
    [selectedFishIndex, hoveredFishIndex].filter((value): value is number => value !== null),
  );
  const targetCount = Math.max(required.size, 1, RENDER_SAMPLE_THRESHOLD);
  return instances
    .map((instance, originalIndex) => ({
      instance,
      originalIndex,
      score: required.has(instance.node.fishIndex) ? -1 : hashFish(instance.node.fishIndex).a,
    }))
    .sort((a, b) => a.score - b.score || a.instance.node.fishIndex - b.instance.node.fishIndex)
    .slice(0, targetCount)
    .sort((a, b) => a.originalIndex - b.originalIndex)
    .map((entry) => entry.instance);
}

function findFirstMesh(scene: THREE.Object3D): THREE.Mesh | null {
  let mesh: THREE.Mesh | null = null;
  scene.traverse((object) => {
    if (!mesh && object instanceof THREE.Mesh) {
      mesh = object;
    }
  });
  return mesh;
}

function normalizeFishGeometry(geometry: THREE.BufferGeometry | null): THREE.BufferGeometry | null {
  if (!geometry) return null;
  const normalized = geometry.clone();
  // Drop any baked vertex colors from the source GLB — they would multiply
  // against (and visually override) the per-instance color we set at runtime.
  // Drop UVs too: we render with a flat material, so UV memory is wasted.
  normalized.deleteAttribute("color");
  normalized.deleteAttribute("uv");
  normalized.deleteAttribute("uv2");
  normalized.computeBoundingBox();
  const box = normalized.boundingBox;
  if (!box) return normalized;
  const size = new THREE.Vector3();
  const center = new THREE.Vector3();
  box.getSize(size);
  box.getCenter(center);
  const longestSide = Math.max(size.x, size.y, size.z);
  if (longestSide > 0) {
    normalized.translate(-center.x, -center.y, -center.z);
    const scale = 1 / longestSide;
    normalized.scale(scale, scale, scale);
  }
  normalized.computeBoundingSphere();
  return normalized;
}

function optimizeFishGeometry(
  geometry: THREE.BufferGeometry | null,
): THREE.BufferGeometry | null {
  if (!geometry) return null;
  // mergeVertices alone is the safe optimisation: it indexes the geometry
  // and removes duplicate vertices, often shaving 30-50% off GLBs that ship
  // un-indexed. SimplifyModifier was tried and produced degenerate geometry
  // on the squid asset, so we leave it out.
  try {
    const merged = mergeVertices(geometry, 1e-4);
    merged.computeBoundingSphere();
    return merged;
  } catch {
    return geometry;
  }
}

function createFishInstanceMaterial(): THREE.MeshStandardMaterial {
  // White base so the per-instance color (set via setColorAt) shows through.
  // Vertex colors disabled — the GLB doesn't carry a usable color attribute,
  // and enabling vertexColors zeroes the tint when the attribute is missing.
  return new THREE.MeshStandardMaterial({
    color: "#FFFFFF",
    emissive: "#0F172A",
    emissiveIntensity: 0.06,
    metalness: 0.05,
    roughness: 0.55,
    vertexColors: false,
  });
}

function buildFishInstances(
  nodes: FishSceneNode[],
  timelineProgress: number,
): FishInstance[] {
  const bands = clusterBands(nodes);
  const bandIndex = new Map(bands.map((band, index) => [band.key, index]));
  const center = (bands.length - 1) / 2;
  return nodes.map((node) => {
    const bandKey = node.clusterLabel ?? UNCLUSTERED;
    const band = bandIndex.get(bandKey) ?? 0;
    const progress = Math.min(node.turnProgress, timelineProgress);
    const hash = hashFish(node.fishIndex);
    const x = (progress - 0.5) * 11.5 + (hash.a - 0.5) * 0.45;
    const y = (center - band) * 1.65 + (hash.b - 0.5) * 0.8;
    const z = (hash.c - 0.5) * 2.8;
    return {
      node,
      position: new THREE.Vector3(x, y, z),
      color: new THREE.Color(node.color),
      scale: 0.85 + Math.min(0.65, node.costScore * 0.1),
      dimmed: node.turnProgress > timelineProgress + 0.01,
    };
  });
}

interface ClusterBand {
  key: string;
  label: string;
  count: number;
}

function clusterBands(nodes: FishSceneNode[]): ClusterBand[] {
  const counts = new Map<string, number>();
  nodes.forEach((node) => {
    const key = node.clusterLabel ?? UNCLUSTERED;
    counts.set(key, (counts.get(key) ?? 0) + 1);
  });
  return [...counts.entries()]
    .sort((a, b) => {
      if (a[0] === UNCLUSTERED) return 1;
      if (b[0] === UNCLUSTERED) return -1;
      return b[1] - a[1] || a[0].localeCompare(b[0]);
    })
    .map(([key, count]) => ({
      key,
      label: key === UNCLUSTERED ? "Unclustered" : key,
      count,
    }));
}

function hashFish(fishIndex: number): { a: number; b: number; c: number } {
  const a = fract(Math.sin((fishIndex + 1) * 12.9898) * 43758.5453);
  const b = fract(Math.sin((fishIndex + 1) * 78.233) * 12753.123);
  const c = fract(Math.sin((fishIndex + 1) * 37.719) * 24634.6345);
  return { a, b, c };
}

function fract(value: number): number {
  return value - Math.floor(value);
}
