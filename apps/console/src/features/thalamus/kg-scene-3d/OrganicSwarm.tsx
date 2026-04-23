import { useFrame } from "@react-three/fiber";
import type { ReactNode } from "react";
import { useRef } from "react";
import * as THREE from "three";

export function OrganicSwarm({ children }: { children: ReactNode }) {
  const groupRef = useRef<THREE.Group>(null);

  useFrame((state, dt) => {
    if (groupRef.current) {
      // Slow, majestic rotation
      groupRef.current.rotation.y -= dt * 0.04;
      groupRef.current.rotation.z = Math.sin(state.clock.elapsedTime * 0.15) * 0.03;
      // Gentle breathing scale
      const scale = 1 + Math.sin(state.clock.elapsedTime * 0.4) * 0.015;
      groupRef.current.scale.setScalar(scale);
    }
  });

  return <group ref={groupRef}>{children}</group>;
}
