import { Environment, OrbitControls, Stars } from "@react-three/drei";
import { Canvas } from "@react-three/fiber";
import { Bloom, EffectComposer, Noise, Vignette } from "@react-three/postprocessing";
import { BlendFunction, KernelSize } from "postprocessing";
import { useMemo, useRef, useState } from "react";
import type { KgSceneGraph, KgSceneNode } from "../kg-scene";
import { KgCameraFocus } from "./KgCameraFocus";
import { KgEdges } from "./KgEdges";
import { KgNodes } from "./KgNodes";
import { OrganicSwarm } from "./OrganicSwarm";
import { makeHaloTexture } from "./geometry";

type Props = {
  graph: KgSceneGraph;
  selectedNodeId: string | null;
  focusNodeId: string | null;
  onSelectNode: (node: KgSceneNode) => void;
  onFocusDone: () => void;
};

export function KgScene3d({
  graph,
  selectedNodeId,
  focusNodeId,
  onSelectNode,
  onFocusDone,
}: Props) {
  const controlsRef = useRef<any>(null);
  const [hoveredNodeId, setHoveredNodeId] = useState<string | null>(null);
  const haloTex = useMemo(() => makeHaloTexture(), []);

  return (
    <Canvas
      camera={{ position: [0, 2.35, 5.4], fov: 42, near: 0.01, far: 100 }}
      dpr={[1, 1.5]}
      gl={{ antialias: true, powerPreference: "high-performance" }}
    >
      <color attach="background" args={["#0F172A"]} />
      <fog attach="fog" args={["#0F172A", 5.0, 24.0]} />

      {/* Three-light orbital console rig updated for coherence with OpsScene */}
      <ambientLight intensity={0.25} />
      <hemisphereLight args={["#5BD3F3", "#0F172A", 0.42]} />
      <directionalLight position={[4.5, 6.5, 4]} intensity={0.85} color="#E8F7FF" castShadow />
      <directionalLight position={[-5.2, -1.8, -3.5]} intensity={0.3} color="#60A5FA" />
      <pointLight position={[0, 0, 0]} intensity={1.6} color="#22D3EE" distance={1.4} decay={2.0} />
      <pointLight position={[-2.4, 1.2, 1.4]} intensity={1.4} color="#A78BFA" distance={5} decay={2.2} />

      <Environment preset="city" />
      <Stars radius={46} depth={20} count={1200} factor={1.25} fade speed={0.15} />

      <OrganicSwarm>
        <KgEdges edges={graph.edges} selectedNodeId={selectedNodeId} hoveredNodeId={hoveredNodeId} />
        <KgNodes
          nodes={graph.nodes}
          selectedNodeId={selectedNodeId}
          hoveredNodeId={hoveredNodeId}
          haloTex={haloTex}
          onSelectNode={onSelectNode}
          onHoverNode={setHoveredNodeId}
        />
      </OrganicSwarm>

      <OrbitControls
        ref={controlsRef}
        enablePan={false}
        minDistance={2.4}
        maxDistance={24.0}
        rotateSpeed={0.32}
        zoomSpeed={0.45}
      />
      <KgCameraFocus
        nodes={graph.nodes}
        focusNodeId={focusNodeId}
        controlsRef={controlsRef}
        onDone={onFocusDone}
      />

      <EffectComposer multisampling={0} enableNormalPass={false}>
        <Bloom
          intensity={0.5}
          luminanceThreshold={0.5}
          luminanceSmoothing={0.18}
          kernelSize={KernelSize.LARGE}
          mipmapBlur
        />
        <Vignette eskil={false} offset={0.22} darkness={0.88} />
        <Noise opacity={0.02} blendFunction={BlendFunction.OVERLAY} />
      </EffectComposer>
    </Canvas>
  );
}
