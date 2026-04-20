import { useMemo, useRef, useEffect } from "react";
import { useFrame } from "@react-three/fiber";
import * as THREE from "three";
import type { SatelliteDTO } from "@/transformers/http";
import { satellitePosition } from "@/adapters/propagator/sgp4";
import { useRenderer } from "@/adapters/renderer/RendererContext";
import type { TailsGeometry } from "@/adapters/renderer/orbit-geometry";

export type TrailMode = "off" | "tails" | "full";
export type RegimeFilterKey = "ALL" | "LEO" | "MEO" | "GEO" | "HEO";

type Props = {
  satellites: SatelliteDTO[];
  regimeFilter: RegimeFilterKey;
  trailMode: TrailMode;
  timeScale: number;
  /** Optional shared time base from parent (otherwise OrbitTrails keeps its own). */
  tRef?: React.MutableRefObject<number>;
};

const REGIMES: Array<"LEO" | "MEO" | "GEO" | "HEO"> = ["LEO", "MEO", "GEO", "HEO"];

const TAIL_LEN = 60;

// One-shot perf warning flag.
let WARNED_FULL_ALL = false;

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export function OrbitTrails({
  satellites,
  regimeFilter,
  trailMode,
  timeScale,
  tRef: tRefExternal,
}: Props) {
  const { ringColor, buildFullRingsGeometry, buildTailsGeometry } = useRenderer();
  // Own time ref (used when parent doesn't provide one).
  const tRefInternal = useRef(0);
  const tRef = tRefExternal ?? tRefInternal;

  // ----- Regime filter helper
  const includesRegime = (r: "LEO" | "MEO" | "GEO" | "HEO") =>
    regimeFilter === "ALL" || regimeFilter === r;

  // ----- Full-ring geometries (cheap useMemo; only rebuilds on sat-set change)
  const fullGeoms = useMemo(() => {
    if (trailMode !== "full") return null;
    const out: Partial<Record<"LEO" | "MEO" | "GEO" | "HEO", THREE.BufferGeometry>> = {};
    for (const r of REGIMES) {
      if (!includesRegime(r)) continue;
      const inRegime = satellites.filter((s) => s.regime === r);
      const g = buildFullRingsGeometry(inRegime);
      if (g) out[r] = g;
    }
    return out;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    satellites.map((s) => s.id).join(","),
    regimeFilter,
    trailMode,
  ]);

  // Perf warning (one-shot): full + ALL + large fleet.
  useEffect(() => {
    if (
      trailMode === "full" &&
      regimeFilter === "ALL" &&
      satellites.length > 500 &&
      !WARNED_FULL_ALL
    ) {
      WARNED_FULL_ALL = true;
      // eslint-disable-next-line no-console
      console.warn(
        "OrbitTrails: full mode with ALL regimes may exceed perf budget — consider selecting a single regime.",
      );
    }
  }, [trailMode, regimeFilter, satellites.length]);

  // Dispose regime geometries when swapped out.
  useEffect(() => {
    return () => {
      if (!fullGeoms) return;
      for (const r of REGIMES) fullGeoms[r]?.dispose();
    };
  }, [fullGeoms]);

  // ============================================================
  // TAILS path
  // ============================================================
  // Ring buffers keyed by sat.id. Each: Float32Array(TAIL_LEN*3), nextIdx.
  const tailBuffers = useRef(
    new Map<number, { buf: Float32Array; nextIdx: number; filled: number }>(),
  );

  // Prune stale entries when the satellite set changes.
  useEffect(() => {
    const live = new Set(satellites.map((s) => s.id));
    for (const id of tailBuffers.current.keys()) {
      if (!live.has(id)) tailBuffers.current.delete(id);
    }
  }, [satellites]);

  // Merged tails geometry: TAIL_LEN-1 segments per sat × N sats × 2 verts × 3.
  const tailsGeom = useMemo<TailsGeometry | null>(() => {
    if (trailMode !== "tails") return null;
    const visible = satellites.filter((s) =>
      includesRegime(s.regime as "LEO" | "MEO" | "GEO" | "HEO"),
    );
    return buildTailsGeometry(visible, TAIL_LEN);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    satellites.map((s) => s.id).join(","),
    regimeFilter,
    trailMode,
  ]);

  useEffect(() => {
    return () => {
      tailsGeom?.dispose();
    };
  }, [tailsGeom]);

  // Per-frame: advance tails ring buffers + rewrite merged geometry.
  const tmpVec = useRef(new THREE.Vector3()).current;

  useFrame((_, dt) => {
    if (trailMode !== "tails" || !tailsGeom) {
      // Still advance time so if the user flips modes we don't jump.
      if (!tRefExternal) tRef.current += dt * timeScale;
      return;
    }
    if (!tRefExternal) tRef.current += dt * timeScale;

    const sats = tailsGeom._sats;
    const posAttr = tailsGeom.getAttribute("position") as THREE.BufferAttribute;
    const colAttr = tailsGeom.getAttribute("color") as THREE.BufferAttribute;
    const posArr = posAttr.array as Float32Array;
    const colArr = colAttr.array as Float32Array;

    const segPerSat = TAIL_LEN - 1;
    const floatsPerSat = segPerSat * 2 * 3; // 2 verts per segment, 3 floats each

    for (let si = 0; si < sats.length; si++) {
      const s = sats[si];
      if (!s) continue;
      let entry = tailBuffers.current.get(s.id);
      if (!entry) {
        entry = {
          buf: new Float32Array(TAIL_LEN * 3),
          nextIdx: 0,
          filled: 0,
        };
        tailBuffers.current.set(s.id, entry);
      }

      // Push current position into ring buffer.
      satellitePosition(s, tRef.current, tmpVec);
      const wi = entry.nextIdx * 3;
      entry.buf[wi] = tmpVec.x;
      entry.buf[wi + 1] = tmpVec.y;
      entry.buf[wi + 2] = tmpVec.z;
      entry.nextIdx = (entry.nextIdx + 1) % TAIL_LEN;
      if (entry.filled < TAIL_LEN) entry.filled++;

      // Write segments into merged geometry: oldest → newest, fade tail→head.
      // Oldest slot = entry.nextIdx (the one we'll overwrite next).
      const base = new THREE.Color(
        ringColor(s.regime as "LEO" | "MEO" | "GEO" | "HEO"),
      );
      const satOffset = si * floatsPerSat;
      for (let k = 0; k < segPerSat; k++) {
        const ageA = k; // 0 = oldest segment start
        const ageB = k + 1;
        const idxA = (entry.nextIdx + (TAIL_LEN - entry.filled) + ageA) % TAIL_LEN;
        const idxB = (entry.nextIdx + (TAIL_LEN - entry.filled) + ageB) % TAIL_LEN;
        const a3 = idxA * 3;
        const b3 = idxB * 3;

        const segOff = satOffset + k * 6;
        if (entry.filled < 2 || ageB >= entry.filled) {
          // Not enough data yet — collapse segment to origin (invisible line).
          posArr[segOff] = 0;
          posArr[segOff + 1] = 0;
          posArr[segOff + 2] = 0;
          posArr[segOff + 3] = 0;
          posArr[segOff + 4] = 0;
          posArr[segOff + 5] = 0;
          colArr[segOff] = 0;
          colArr[segOff + 1] = 0;
          colArr[segOff + 2] = 0;
          colArr[segOff + 3] = 0;
          colArr[segOff + 4] = 0;
          colArr[segOff + 5] = 0;
          continue;
        }

        posArr[segOff] = entry.buf[a3] ?? 0;
        posArr[segOff + 1] = entry.buf[a3 + 1] ?? 0;
        posArr[segOff + 2] = entry.buf[a3 + 2] ?? 0;
        posArr[segOff + 3] = entry.buf[b3] ?? 0;
        posArr[segOff + 4] = entry.buf[b3 + 1] ?? 0;
        posArr[segOff + 5] = entry.buf[b3 + 2] ?? 0;

        // Fade: head (newest) = bright, tail (oldest) = dark.
        // ageA/B run 0 (oldest) → segPerSat (newest).
        const fadeA = 0.15 + 0.85 * (ageA / segPerSat);
        const fadeB = 0.15 + 0.85 * (ageB / segPerSat);
        colArr[segOff] = base.r * fadeA;
        colArr[segOff + 1] = base.g * fadeA;
        colArr[segOff + 2] = base.b * fadeA;
        colArr[segOff + 3] = base.r * fadeB;
        colArr[segOff + 4] = base.g * fadeB;
        colArr[segOff + 5] = base.b * fadeB;
      }
    }

    posAttr.needsUpdate = true;
    colAttr.needsUpdate = true;
  });

  if (trailMode === "off") return null;

  return (
    <group>
      {trailMode === "full" && fullGeoms &&
        REGIMES.map((r) => {
          const g = fullGeoms[r];
          if (!g) return null;
          return (
            <lineSegments key={r} geometry={g}>
              <lineBasicMaterial
                color={ringColor(r)}
                opacity={0.35}
                transparent
                blending={THREE.AdditiveBlending}
                depthWrite={false}
              />
            </lineSegments>
          );
        })}

      {trailMode === "tails" && tailsGeom && (
        <lineSegments geometry={tailsGeom}>
          <lineBasicMaterial
            vertexColors
            opacity={0.55}
            transparent
            blending={THREE.AdditiveBlending}
            depthWrite={false}
          />
        </lineSegments>
      )}
    </group>
  );
}
