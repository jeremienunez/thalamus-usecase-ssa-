import { useFrame, useThree } from "@react-three/fiber";
import { useEffect, useRef } from "react";
import * as THREE from "three";
import type { SatelliteDTO } from "@/transformers/http";
import { satellitePosition } from "@/adapters/propagator/sgp4";

/**
 * Animates the camera toward a selected satellite over ~1s.
 *
 * Drives orbit controls via their imperative handle — we grab `target` from
 * the OrbitControls instance and smoothly lerp both `camera.position` and
 * `controls.target` toward the satellite's current world position, then
 * hand control back to the user. Motion is ease-out so it feels cinematic
 * rather than jumpy.
 */
export function CameraFocus({
  focusId,
  satellites,
  orbitControlsRef,
  timeScale,
  onDone,
}: {
  focusId: number | null;
  satellites: SatelliteDTO[];
  orbitControlsRef: React.MutableRefObject<any>;
  timeScale: number;
  onDone: () => void;
}) {
  const { camera } = useThree();
  const startPos = useRef(new THREE.Vector3());
  const startTarget = useRef(new THREE.Vector3());
  const endTarget = useRef(new THREE.Vector3());
  const tRef = useRef(0);
  const localTimeRef = useRef(0);
  const animating = useRef(false);
  const durationMs = 800;
  const startedAt = useRef(0);

  useEffect(() => {
    if (focusId == null) return;
    const sat = satellites.find((s) => s.id === focusId);
    if (!sat) return;
    const controls = orbitControlsRef.current;
    if (!controls) return;

    // Snapshot camera + target at animation start.
    startPos.current.copy(camera.position);
    startTarget.current.copy(controls.target);

    // Compute satellite current world position.
    const targetPos = satellitePosition(sat, localTimeRef.current, new THREE.Vector3());
    endTarget.current.copy(targetPos);

    tRef.current = 0;
    animating.current = true;
    startedAt.current = performance.now();
  }, [focusId, satellites, camera, orbitControlsRef]);

  useFrame((_state, dt) => {
    localTimeRef.current += dt * timeScale;
    if (!animating.current) return;

    const elapsed = performance.now() - startedAt.current;
    const k = Math.min(1, elapsed / durationMs);
    // Ease-out cubic
    const e = 1 - Math.pow(1 - k, 3);

    const controls = orbitControlsRef.current;
    if (!controls) return;

    // Lerp target toward satellite
    controls.target.lerpVectors(startTarget.current, endTarget.current, e);

    // Camera hugs the satellite from its current compass direction, scaled
    // so the sat fills ~25% of the frame. Keep viewer orientation; just
    // move in along the existing camera→target ray.
    const satDist = endTarget.current.length();
    const viewDist = Math.max(satDist * 0.25 + 0.4, 0.5);
    const dir = controls.target.clone().normalize();
    const wantedPos = endTarget.current.clone().add(dir.multiplyScalar(viewDist));
    camera.position.lerpVectors(startPos.current, wantedPos, e);
    camera.lookAt(controls.target);
    controls.update();

    if (k >= 1) {
      animating.current = false;
      onDone();
    }
  });

  return null;
}
