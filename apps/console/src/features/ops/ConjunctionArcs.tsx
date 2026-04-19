import { useMemo, useRef, useEffect } from "react";
import { useFrame } from "@react-three/fiber";
import * as THREE from "three";
import type { ConjunctionDTO, SatelliteDTO } from "@/shared/types";
import { satellitePosition } from "@/adapters/propagator/sgp4";
import { pcColor } from "@/adapters/renderer/palette";

const cylTmp = new THREE.Object3D();
const ringTmp = new THREE.Object3D();
const upVec = new THREE.Vector3(0, 1, 0);
const zVec = new THREE.Vector3(0, 0, 1);
const p1 = new THREE.Vector3();
const p2 = new THREE.Vector3();

/** How far ahead/behind to trace each satellite's orbit around the conjunction. */
const TRAIL_WINDOW_SEC = 540; // ±9 min — enough to span LEO rendezvous geometry
/** Segments per orbital trail — each conjunction thus draws 2 × SEGS cylinders. */
const SEGS_PER_TRAIL = 14;

interface Props {
  satellites: SatelliteDTO[];
  conjunctions: ConjunctionDTO[];
  timeScale: number;
}

export function ConjunctionArcs({ satellites, conjunctions, timeScale }: Props) {
  const cylRef = useRef<THREE.InstancedMesh>(null);
  const ringRef = useRef<THREE.InstancedMesh>(null);
  const tRef = useRef(0);

  // Restructure the sequence: We must filter valid coordinate pairs FIRST, then slice the top 20
  const threatPairs = useMemo(() => {
    // Strongly enforce string keys for mapping to prevent string/number lookup failures
    const satById = new Map(satellites.map((s) => [String(s.id), s]));
    
    // 1. Gather all physically renderable conjunctions
    const renderable = conjunctions
      .map((c) => ({
        c,
        sA: satById.get(String(c.primaryId)),
        sB: satById.get(String(c.secondaryId)),
        col: pcColor(c.probabilityOfCollision),
        isHot: c.probabilityOfCollision >= 1e-4,
      }))
      .filter((tp) => tp.sA && tp.sB);

    // 2. Safely extract local top 20 to prevent global clutter
    const sorted = renderable.sort((a, b) => b.c.probabilityOfCollision - a.c.probabilityOfCollision);
    return sorted.slice(0, 20);
  }, [conjunctions, satellites]);

  // Each conjunction draws two separate orbital trails (one per satellite),
  // each made of SEGS_PER_TRAIL short cylinders, plus one epicentre ring at
  // the closest-approach point.
  const cylsPerConjunction = 2 * SEGS_PER_TRAIL;
  const numCyls = threatPairs.length * cylsPerConjunction;

  useEffect(() => {
    if (!cylRef.current || !ringRef.current || threatPairs.length === 0) return;
    threatPairs.forEach((tp, i) => {
      ringRef.current!.setColorAt(i, tp.col);
      for (let j = 0; j < cylsPerConjunction; j++) {
        cylRef.current!.setColorAt(i * cylsPerConjunction + j, tp.col);
      }
    });
    if (cylRef.current.instanceColor) cylRef.current.instanceColor.needsUpdate = true;
    if (ringRef.current.instanceColor) ringRef.current.instanceColor.needsUpdate = true;
  }, [threatPairs, cylsPerConjunction]);

  useFrame((state, dt) => {
    if (!cylRef.current || !ringRef.current || threatPairs.length === 0) return;
    
    // Sync time mathematically identical to SatelliteField
    tRef.current += dt * timeScale;
    const timeSec = state.clock.elapsedTime;

    threatPairs.forEach((tp, i) => {
      // Each satellite gets a real orbital-track trail: we propagate each
      // sat backwards/forwards by TRAIL_WINDOW_SEC in scene time, sample
      // SEGS_PER_TRAIL+1 positions along its true orbital plane, and draw
      // cylinders between consecutive samples. The two trails naturally
      // converge at the conjunction — that's the physics.
      for (let satIdx = 0; satIdx < 2; satIdx++) {
        const sat = satIdx === 0 ? tp.sA! : tp.sB!;
        for (let j = 0; j < SEGS_PER_TRAIL; j++) {
          const f1 = j / SEGS_PER_TRAIL;
          const f2 = (j + 1) / SEGS_PER_TRAIL;
          const t1 =
            tRef.current + (f1 - 0.5) * 2 * TRAIL_WINDOW_SEC;
          const t2 =
            tRef.current + (f2 - 0.5) * 2 * TRAIL_WINDOW_SEC;
          satellitePosition(sat, t1, p1);
          satellitePosition(sat, t2, p2);

          const dist = p1.distanceTo(p2);

          cylTmp.position.copy(p1).lerp(p2, 0.5);
          const direction = p2.clone().sub(p1).normalize();
          if (direction.lengthSq() > 0) {
            cylTmp.quaternion.setFromUnitVectors(upVec, direction);
          }

          // Energy flow: bright pulse travelling from past (j=0) → present → future.
          // The brightest segment tracks the satellite's current position.
          const centerFrac = 0.5; // f where present is
          const distanceFromNow = Math.abs(f1 - centerFrac);
          // Travelling pulse modulation
          const flowRaw = timeSec * 1.2 - f1;
          const flow = flowRaw - Math.floor(flowRaw);
          const travelling = flow > 0 && flow < 0.18 ? 1 : 0;
          // Trail fade: thick near present, thin far out
          const fade = Math.max(0.25, 1 - distanceFromNow * 1.6);
          const baseThickness = tp.isHot ? 0.001 : 0.0006;
          const peakThickness = tp.isHot ? 0.005 : 0.0028;
          const thickness =
            (baseThickness + (peakThickness - baseThickness) * travelling) *
            fade;

          cylTmp.scale.set(thickness, dist, thickness);
          cylTmp.updateMatrix();
          cylRef.current!.setMatrixAt(
            i * cylsPerConjunction + satIdx * SEGS_PER_TRAIL + j,
            cylTmp.matrix,
          );
        }
      }

      // Epicentre ring — at the midpoint of the actual current positions
      // (where the two orbits converge right NOW).
      satellitePosition(tp.sA!, tRef.current, p1);
      satellitePosition(tp.sB!, tRef.current, p2);
      const epic = p1.clone().lerp(p2, 0.5);
      ringTmp.position.copy(epic);
      ringTmp.quaternion.setFromUnitVectors(zVec, epic.clone().normalize());

      const pulseSpeed = tp.isHot ? 12 : 4;
      const pulseScale = tp.isHot ? 0.035 : 0.02;
      const pulse = 1 + Math.sin(timeSec * pulseSpeed) * 0.4;

      ringTmp.scale.setScalar(pulseScale * pulse);
      ringTmp.updateMatrix();
      ringRef.current!.setMatrixAt(i, ringTmp.matrix);
    });

    cylRef.current.instanceMatrix.needsUpdate = true;
    ringRef.current.instanceMatrix.needsUpdate = true;
  });

  if (numCyls === 0) return null;

  return (
    <group>
      {/* Laser Arc Strands */}
      <instancedMesh ref={cylRef} args={[undefined, undefined, numCyls]} frustumCulled={false}>
        <cylinderGeometry args={[1, 1, 1, 6]} />
        <meshBasicMaterial 
          color="#ffffff" 
          transparent 
          opacity={0.8} 
          toneMapped={false} 
          blending={THREE.AdditiveBlending}
        />
      </instancedMesh>

      {/* Collision Alert Epicenter Rings */}
      <instancedMesh ref={ringRef} args={[undefined, undefined, threatPairs.length]} frustumCulled={false}>
        <torusGeometry args={[1, 0.15, 6, 24]} />
        <meshBasicMaterial 
          color="#ffffff" 
          transparent 
          opacity={0.9} 
          toneMapped={false}
          blending={THREE.AdditiveBlending}
        />
      </instancedMesh>
    </group>
  );
}
