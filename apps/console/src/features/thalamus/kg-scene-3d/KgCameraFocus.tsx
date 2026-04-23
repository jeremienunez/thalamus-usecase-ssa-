import { useFrame, useThree } from "@react-three/fiber";
import type { MutableRefObject } from "react";
import { useEffect, useRef } from "react";
import * as THREE from "three";
import type { KgSceneNode } from "../kg-scene";

export function KgCameraFocus({
  nodes,
  focusNodeId,
  controlsRef,
  onDone,
}: {
  nodes: KgSceneNode[];
  focusNodeId: string | null;
  controlsRef: MutableRefObject<any>;
  onDone: () => void;
}) {
  const { camera } = useThree();
  const startPos = useRef(new THREE.Vector3());
  const startTarget = useRef(new THREE.Vector3());
  const endTarget = useRef(new THREE.Vector3());
  const startedAt = useRef(0);
  const animating = useRef(false);

  useEffect(() => {
    if (!focusNodeId) return;
    const node = nodes.find((candidate) => candidate.id === focusNodeId);
    const controls = controlsRef.current;
    if (!node || !controls) return;

    startPos.current.copy(camera.position);
    startTarget.current.copy(controls.target);
    endTarget.current.set(...node.position);
    startedAt.current = performance.now();
    animating.current = true;
  }, [camera, controlsRef, focusNodeId, nodes]);

  useFrame(() => {
    if (!animating.current) return;
    const controls = controlsRef.current;
    if (!controls) return;

    const k = Math.min(1, (performance.now() - startedAt.current) / 650);
    const eased = 1 - Math.pow(1 - k, 3);
    controls.target.lerpVectors(startTarget.current, endTarget.current, eased);

    const viewDir = new THREE.Vector3(0.7, 0.55, 1).normalize();
    const distance = 1.55;
    const wantedPos = endTarget.current.clone().add(viewDir.multiplyScalar(distance));
    camera.position.lerpVectors(startPos.current, wantedPos, eased);
    camera.lookAt(controls.target);
    controls.update();

    if (k >= 1) {
      animating.current = false;
      onDone();
    }
  });

  return null;
}
