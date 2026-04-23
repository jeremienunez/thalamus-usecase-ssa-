import { useMemo } from "react";
import * as THREE from "three";
import type { KgSceneEdge } from "../kg-scene";
import { curvedEdgeGeometry } from "./geometry";

export function KgEdges({
  edges,
  selectedNodeId,
  hoveredNodeId,
}: {
  edges: KgSceneEdge[];
  selectedNodeId: string | null;
  hoveredNodeId: string | null;
}) {
  return (
    <group>
      {edges.map((edge) => {
        const active =
          selectedNodeId === edge.source ||
          selectedNodeId === edge.target ||
          hoveredNodeId === edge.source ||
          hoveredNodeId === edge.target;
        return <KgEdgeLine key={edge.id} edge={edge} active={active} />;
      })}
    </group>
  );
}

function KgEdgeLine({ edge, active }: { edge: KgSceneEdge; active: boolean }) {
  const geometry = useMemo(() => curvedEdgeGeometry(edge), [edge]);
  // Use a deep neural blue/cyan gradient effect instead of semantic graph colors
  const color = active ? "#22D3EE" : "#1E3A8A";
  const confidence = edge.confidence || 0.35;
  const opacity = active
    ? Math.max(0.7, Math.min(0.95, confidence + 0.4))
    : Math.max(0.35, Math.min(0.55, confidence * 0.8));

  return (
    <lineSegments geometry={geometry}>
      <lineBasicMaterial
        color={active ? "#DFF7FF" : color}
        transparent
        opacity={opacity}
        depthWrite={false}
        blending={THREE.AdditiveBlending}
        toneMapped={false}
      />
    </lineSegments>
  );
}
