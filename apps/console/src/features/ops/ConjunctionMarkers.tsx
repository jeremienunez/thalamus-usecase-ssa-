/**
 * ConjunctionMarkers — ✕ sprites at each conjunction's TCA point.
 *
 * Raycast strategy: (b) INVISIBLE TARGET SPRITES.
 *
 * ConjunctionArcs uses an InstancedMesh of merged cylinders, so individual
 * arcs are not trivially raycastable. Rather than refactor the arcs into a
 * pile of per-arc <line> objects, we mount a second, slightly larger,
 * invisible sprite per conjunction (always present, opacity 0 on the
 * material). The parent owns the raycaster hook and publishes hover state
 * via `onHover`. The visible ✕ sprite on top reveals itself when the
 * conjunction id matches `hoveredId` or `selectedId`.
 */
import { useMemo, useRef, useEffect } from "react";
import { useFrame, useThree, type ThreeEvent } from "@react-three/fiber";
import * as THREE from "three";
import type { ConjunctionDto, SatelliteDto } from "@/dto/http";
import { satellitePosition } from "@/adapters/propagator/sgp4";
import { severityOf, SEVERITY_COLOR, type Severity } from "@/shared/types/conjunction";

interface Props {
  conjunctions: ConjunctionDto[];
  satellitesById: Map<number, SatelliteDto>;
  hoveredId: string | null;
  selectedId: string | null;
  timeScale: number;
  onHover: (id: string | null) => void;
  onSelect?: (id: string) => void;
}

const BASE_SCALE = 0.08;
const HIGHLIGHT_SCALE = 0.15;
const PICK_SCALE = 0.16; // invisible pick target — larger than visible sprite

/** Cache one texture per severity palette colour. */
const textureCache = new Map<Severity, THREE.Texture>();
function getCrossTexture(sev: Severity): THREE.Texture {
  const cached = textureCache.get(sev);
  if (cached) return cached;
  const size = 64;
  const canvas = document.createElement("canvas");
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext("2d")!;
  ctx.clearRect(0, 0, size, size);
  ctx.strokeStyle = SEVERITY_COLOR[sev];
  ctx.lineCap = "round";
  ctx.lineWidth = 8;
  // Outer glow
  ctx.shadowColor = SEVERITY_COLOR[sev];
  ctx.shadowBlur = 6;
  ctx.beginPath();
  ctx.moveTo(14, 14);
  ctx.lineTo(size - 14, size - 14);
  ctx.moveTo(size - 14, 14);
  ctx.lineTo(14, size - 14);
  ctx.stroke();
  const tex = new THREE.CanvasTexture(canvas);
  tex.needsUpdate = true;
  textureCache.set(sev, tex);
  return tex;
}

type MarkerItem = {
  id: string;
  sat: SatelliteDto;
  severity: Severity;
};

export function ConjunctionMarkers({
  conjunctions,
  satellitesById,
  hoveredId,
  selectedId,
  timeScale,
  onHover,
  onSelect,
}: Props) {
  const { raycaster } = useThree();
  const tRef = useRef(0);
  const visibleRefs = useRef<Map<string, THREE.Sprite>>(new Map());
  const pickRefs = useRef<Map<string, THREE.Sprite>>(new Map());
  const hoverTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Build the renderable list: drop any conjunction whose primary sat is
  // absent (AC-7 — missing satellite → skip, no crash).
  const items = useMemo<MarkerItem[]>(() => {
    const out: MarkerItem[] = [];
    for (const c of conjunctions) {
      const primary = satellitesById.get(c.primaryId);
      const secondary = satellitesById.get(c.secondaryId);
      if (!primary || !secondary) continue;
      out.push({
        id: String(c.id),
        sat: primary,
        severity: severityOf(c.probabilityOfCollision),
      });
    }
    return out;
  }, [conjunctions, satellitesById]);

  // Drive sprite positions each frame so they track the primary's orbit.
  // tRef mirrors the accumulator used by ConjunctionArcs/SatelliteField so
  // the ✕ sits at the same "present" the arcs converge to.
  const tmpPos = useMemo(() => new THREE.Vector3(), []);
  useFrame((_, dt) => {
    tRef.current += dt * timeScale;
    for (const item of items) {
      satellitePosition(item.sat, tRef.current, tmpPos);
      const vis = visibleRefs.current.get(item.id);
      const pick = pickRefs.current.get(item.id);
      if (vis) vis.position.copy(tmpPos);
      if (pick) pick.position.copy(tmpPos);
      if (vis) {
        const highlighted =
          hoveredId === item.id || selectedId === item.id;
        const target = highlighted ? HIGHLIGHT_SCALE : BASE_SCALE;
        vis.scale.setScalar(target);
        const mat = vis.material as THREE.SpriteMaterial;
        mat.opacity = highlighted ? 1 : 0;
      }
    }
  });

  // Clean up any stray hover timeout on unmount.
  useEffect(() => {
    return () => {
      if (hoverTimeoutRef.current) clearTimeout(hoverTimeoutRef.current);
    };
  }, []);

  const scheduleDismiss = () => {
    if (hoverTimeoutRef.current) clearTimeout(hoverTimeoutRef.current);
    hoverTimeoutRef.current = setTimeout(() => onHover(null), 500);
  };
  const cancelDismiss = () => {
    if (hoverTimeoutRef.current) {
      clearTimeout(hoverTimeoutRef.current);
      hoverTimeoutRef.current = null;
    }
  };

  // Also drive raycaster-free hover off the invisible sprite's pointer events
  // (r3f handles the raycast for us against Object3Ds).
  void raycaster;

  return (
    <group>
      {items.map((item) => {
        const tex = getCrossTexture(item.severity);
        return (
          <group key={item.id}>
            {/* Visible ✕ sprite */}
            <sprite
              ref={(s) => {
                if (s) visibleRefs.current.set(item.id, s);
                else visibleRefs.current.delete(item.id);
              }}
              scale={[BASE_SCALE, BASE_SCALE, BASE_SCALE]}
              renderOrder={10}
            >
              <spriteMaterial
                map={tex}
                transparent
                opacity={0}
                depthTest={false}
                depthWrite={false}
                toneMapped={false}
              />
            </sprite>
            {/* Invisible pick target — bigger hitbox, always listening */}
            <sprite
              ref={(s) => {
                if (s) pickRefs.current.set(item.id, s);
                else pickRefs.current.delete(item.id);
              }}
              scale={[PICK_SCALE, PICK_SCALE, PICK_SCALE]}
              onPointerOver={(e: ThreeEvent<PointerEvent>) => {
                e.stopPropagation();
                cancelDismiss();
                onHover(item.id);
              }}
              onPointerOut={(e: ThreeEvent<PointerEvent>) => {
                e.stopPropagation();
                scheduleDismiss();
              }}
              onClick={(e: ThreeEvent<MouseEvent>) => {
                e.stopPropagation();
                onSelect?.(item.id);
              }}
            >
              <spriteMaterial
                transparent
                opacity={0}
                depthTest={false}
                depthWrite={false}
              />
            </sprite>
          </group>
        );
      })}
    </group>
  );
}
