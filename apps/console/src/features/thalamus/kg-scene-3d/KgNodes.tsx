import { Html } from "@react-three/drei";
import { useFrame } from "@react-three/fiber";
import type { ThreeEvent } from "@react-three/fiber";
import { useMemo, useRef } from "react";
import * as THREE from "three";
import type { EntityClass } from "@/dto/http";
import { ENTITY_COLOR } from "@/shared/types/graph-colors";
import type { KgSceneNode } from "../kg-scene";
import { BASE_RADIUS_BY_CLASS } from "./constants";

export function KgNodes({
  nodes,
  selectedNodeId,
  hoveredNodeId,
  haloTex,
  onSelectNode,
  onHoverNode,
}: {
  nodes: KgSceneNode[];
  selectedNodeId: string | null;
  hoveredNodeId: string | null;
  haloTex: THREE.Texture;
  onSelectNode: (node: KgSceneNode) => void;
  onHoverNode: (nodeId: string | null) => void;
}) {
  const topLabelIds = useMemo(
    () =>
      new Set(
        nodes
          .filter((node) => !node.ghost)
          .slice()
          .sort((a, b) => b.degree - a.degree)
          .slice(0, 3)
          .map((node) => node.id),
      ),
    [nodes],
  );

  return (
    <group>
      {nodes.map((node) => (
        <KgNodeMesh
          key={node.id}
          node={node}
          haloTex={haloTex}
          selected={node.id === selectedNodeId}
          hovered={node.id === hoveredNodeId}
          labelled={
            node.id === selectedNodeId ||
            node.id === hoveredNodeId ||
            (topLabelIds.has(node.id) && !hoveredNodeId)
          }
          onSelectNode={onSelectNode}
          onHoverNode={onHoverNode}
        />
      ))}
    </group>
  );
}

function KgNodeMesh({
  node,
  haloTex,
  selected,
  hovered,
  labelled,
  onSelectNode,
  onHoverNode,
}: {
  node: KgSceneNode;
  haloTex: THREE.Texture;
  selected: boolean;
  hovered: boolean;
  labelled: boolean;
  onSelectNode: (node: KgSceneNode) => void;
  onHoverNode: (nodeId: string | null) => void;
}) {
  const groupRef = useRef<THREE.Group>(null);
  const ringRef = useRef<THREE.Mesh>(null);
  const color = ENTITY_COLOR[node.class];

  const baseRadius =
    (BASE_RADIUS_BY_CLASS[node.class] ?? 0.045) +
    node.hubness * (node.ghost ? 0.014 : 0.045);
  const ghostScale = node.ghost ? 0.62 : 1.0;
  const radius = baseRadius * ghostScale;
  const stateScale = selected ? 1.45 : hovered ? 1.18 : 1.0;
  // Conjunctions glow softer by default — let the bloom highlight Operators/Satellites instead.
  const isConj = node.class === "ConjunctionEvent";
  const baseEmissive = node.ghost ? 0.3 : isConj ? 0.8 : 1.2;
  const emissive = selected ? 2.5 : hovered ? 1.8 : baseEmissive;

  const wantsHalo = !node.ghost; // Let every node emit a soft glow like a distant star
  const wantsAlertRing = isConj && (selected || hovered);

  useFrame(() => {
    const grp = groupRef.current;
    if (grp) {
      const t = performance.now() * 0.003;
      const pulse = selected ? 1.0 + Math.sin(t) * 0.06 : 1.0;
      grp.scale.setScalar(stateScale * pulse);
    }
    if (ringRef.current && wantsAlertRing) {
      const t = performance.now() * 0.0024;
      ringRef.current.rotation.z += 0.012;
      const mat = ringRef.current.material as THREE.MeshBasicMaterial;
      mat.opacity = 0.18 + Math.sin(t) * 0.08;
    }
  });

  function select(event: ThreeEvent<MouseEvent>) {
    event.stopPropagation();
    onSelectNode(node);
  }

  function hover(event: ThreeEvent<PointerEvent>) {
    event.stopPropagation();
    document.body.style.cursor = "pointer";
    onHoverNode(node.id);
  }

  function leave(event: ThreeEvent<PointerEvent>) {
    event.stopPropagation();
    document.body.style.cursor = "";
    onHoverNode(null);
  }

  return (
    <group ref={groupRef} position={node.position}>
      {/* Soft additive halo for prominent classes */}
      {wantsHalo && (
        <sprite scale={[radius * 18.0, radius * 18.0, 1]}>
          <spriteMaterial
            map={haloTex}
            color={color}
            transparent
            depthWrite={false}
            opacity={selected ? 0.95 : hovered ? 0.7 : 0.4}
            blending={THREE.AdditiveBlending}
            toneMapped={false}
          />
        </sprite>
      )}

      {/* Class-specific body */}
      <mesh onClick={select} onPointerOver={hover} onPointerOut={leave}>
        <NodeGeometry cls={node.class} radius={radius} ghost={!!node.ghost} />
        <meshPhysicalMaterial
          color={color}
          emissive={color}
          emissiveIntensity={emissive}
          metalness={0.9}
          roughness={node.class === "Operator" ? 0.15 : 0.25}
          clearcoat={1.0}
          clearcoatRoughness={0.15}
          transparent
          opacity={node.ghost ? 0.22 : 0.94}
          depthWrite={!node.ghost}
        />
      </mesh>

      {/* Selection ring — flat orbital lane around picked node */}
      {selected && (
        <mesh rotation={[Math.PI / 2, 0, 0]}>
          <ringGeometry args={[radius * 2.2, radius * 2.45, 56]} />
          <meshBasicMaterial
            color={color}
            transparent
            opacity={0.55}
            side={THREE.DoubleSide}
            depthWrite={false}
            toneMapped={false}
          />
        </mesh>
      )}

      {/* Alert ring for live ConjunctionEvents — pulsing red marker */}
      {wantsAlertRing && (
        <mesh ref={ringRef} rotation={[Math.PI / 2, 0, 0]}>
          <ringGeometry args={[radius * 1.7, radius * 1.85, 32]} />
          <meshBasicMaterial
            color="#F87171"
            transparent
            opacity={0.22}
            side={THREE.DoubleSide}
            depthWrite={false}
            toneMapped={false}
          />
        </mesh>
      )}

      {labelled && (
        <Html
          zIndexRange={[10, 0]}
          pointerEvents="none"
          style={{ pointerEvents: "none" }}
        >
          <div
            className="flex items-center gap-1 whitespace-nowrap border-l-2 bg-panel/90 pl-1.5 pr-1.5 py-0.5 shadow-hud backdrop-blur-md"
            style={{ borderColor: color, transform: "translate(10px, -10px)" }}
          >
            <span
              className="h-1 w-1 shrink-0"
              style={{ backgroundColor: color }}
            />
            <span
              className={
                selected
                  ? "mono max-w-[10rem] truncate text-nano text-cyan font-bold"
                  : "mono max-w-[9rem] truncate text-nano text-primary"
              }
            >
              {node.label}
            </span>
          </div>
        </Html>
      )}
    </group>
  );
}

function NodeGeometry({
  cls,
  radius,
  ghost,
}: {
  cls: EntityClass;
  radius: number;
  ghost: boolean;
}) {
  switch (cls) {
    case "Satellite":
      return <sphereGeometry args={[radius, 32, 32]} />;
    case "Operator":
      return <sphereGeometry args={[radius * 1.5, 32, 32]} />;
    case "OrbitRegime":
      return <sphereGeometry args={[radius * 1.6, 32, 32]} />;
    case "ConjunctionEvent":
      return <icosahedronGeometry args={[radius * 1.3, 2]} />;
    case "Payload":
      return <sphereGeometry args={[radius * 0.9, 24, 24]} />;
    case "Maneuver":
      return <sphereGeometry args={[radius * 0.9, 24, 24]} />;
    case "Debris":
      return <sphereGeometry args={[radius * 0.7, 16, 16]} />;
    default:
      return <sphereGeometry args={[radius, 32, 32]} />;
  }
}
