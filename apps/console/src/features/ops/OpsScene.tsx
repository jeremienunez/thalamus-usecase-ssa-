import { Canvas } from "@react-three/fiber";
import { Environment, OrbitControls, Stars } from "@react-three/drei";
import { useRef, useState } from "react";
import type { ConjunctionDto, SatelliteDto } from "@/dto/http";
import { Globe } from "./Globe";
import { SatelliteField } from "./SatelliteField";
import { ConjunctionArcs } from "./ConjunctionArcs";
import { ConjunctionMarkers } from "./ConjunctionMarkers";
import { PostFx } from "./PostFx";
import { CameraFocus } from "./CameraFocus";
import { OrbitTrails, type RegimeFilterKey } from "./OrbitTrails";

type Props = {
  filteredSats: SatelliteDto[];
  satellites: SatelliteDto[];
  selectedId: number | null;
  labelIds: number[];
  conjunctions: ConjunctionDto[];
  satellitesById: Map<number, SatelliteDto>;
  focusId: number | null;
  trailMode: "off" | "tails" | "full";
  orbitRegimeFilter: RegimeFilterKey;
  effectiveSpeed: number;
  onSelectSatellite: (id: number) => void;
  onFocusDone: () => void;
};

export function OpsScene({
  filteredSats,
  satellites,
  selectedId,
  labelIds,
  conjunctions,
  satellitesById,
  focusId,
  trailMode,
  orbitRegimeFilter,
  effectiveSpeed,
  onSelectSatellite,
  onFocusDone,
}: Props) {
  const orbitControlsRef = useRef<any>(null);
  const [hoveredCjId, setHoveredCjId] = useState<string | null>(null);
  const [selectedCjId, setSelectedCjId] = useState<string | null>(null);

  return (
    <Canvas
      camera={{ position: [0, 2, 5], fov: 40, near: 0.01, far: 100 }}
      dpr={[1, 1.5]}
    >
      <color attach="background" args={["#0A0E14"]} />
      <ambientLight intensity={0.3} />
      <directionalLight position={[5, 3, 5]} intensity={0.9} castShadow />
      <directionalLight position={[-5, -3, -5]} intensity={0.2} color="#60A5FA" />
      <Environment preset="city" />
      <Stars radius={50} depth={30} count={2000} factor={2} fade speed={0.5} />
      <Globe />
      {filteredSats.length > 0 && (
        <>
          <SatelliteField
            satellites={filteredSats}
            selectedId={selectedId}
            onSelect={onSelectSatellite}
            timeScale={effectiveSpeed}
            labelIds={labelIds}
          />
          <OrbitTrails
            satellites={filteredSats}
            regimeFilter={orbitRegimeFilter}
            trailMode={trailMode}
            timeScale={effectiveSpeed}
          />
          <ConjunctionArcs
            satellites={filteredSats}
            conjunctions={conjunctions}
            timeScale={effectiveSpeed}
          />
          <ConjunctionMarkers
            conjunctions={conjunctions}
            satellitesById={satellitesById}
            hoveredId={hoveredCjId}
            selectedId={selectedCjId}
            timeScale={effectiveSpeed}
            onHover={setHoveredCjId}
            onSelect={setSelectedCjId}
          />
        </>
      )}
      <OrbitControls
        ref={orbitControlsRef}
        enablePan={false}
        minDistance={2.6}
        maxDistance={15}
        rotateSpeed={0.4}
        zoomSpeed={0.6}
      />
      <CameraFocus
        focusId={focusId}
        satellites={satellites}
        orbitControlsRef={orbitControlsRef}
        timeScale={effectiveSpeed}
        onDone={onFocusDone}
      />
      <PostFx />
    </Canvas>
  );
}
