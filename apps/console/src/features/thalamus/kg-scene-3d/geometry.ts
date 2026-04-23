import * as THREE from "three";
import type { KgSceneEdge } from "../kg-scene";

export function curvedEdgeGeometry(edge: KgSceneEdge): THREE.BufferGeometry {
  const source = new THREE.Vector3(...edge.sourcePosition);
  const target = new THREE.Vector3(...edge.targetPosition);
  const middle = source.clone().lerp(target, 0.5);
  middle.multiplyScalar(0.78);
  middle.y += Math.min(0.3, source.distanceTo(target) * 0.07);

  const curve = new THREE.QuadraticBezierCurve3(source, middle, target);
  const samples = curve.getPoints(10);
  const points: THREE.Vector3[] = [];
  for (let i = 0; i < samples.length - 1; i++) {
    const a = samples[i];
    const b = samples[i + 1];
    if (a && b) points.push(a, b);
  }
  return new THREE.BufferGeometry().setFromPoints(points);
}

export function makeHaloTexture(): THREE.Texture {
  const size = 64;
  const canvas = document.createElement("canvas");
  canvas.width = canvas.height = size;
  const ctx = canvas.getContext("2d")!;
  const grad = ctx.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
  grad.addColorStop(0, "rgba(255,255,255,1)");
  grad.addColorStop(0.28, "rgba(255,255,255,0.55)");
  grad.addColorStop(0.62, "rgba(255,255,255,0.08)");
  grad.addColorStop(1, "rgba(199, 109, 109, 0)");
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, size, size);
  const tex = new THREE.CanvasTexture(canvas);
  tex.minFilter = THREE.LinearFilter;
  tex.needsUpdate = true;
  return tex;
}
