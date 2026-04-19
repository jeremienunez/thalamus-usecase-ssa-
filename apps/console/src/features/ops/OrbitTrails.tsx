import { useMemo, useRef, useEffect } from "react";
import { useFrame } from "@react-three/fiber";
import * as THREE from "three";
import type { SatelliteDTO } from "@/lib/api";
import { orbitRing, satellitePosition } from "@/lib/orbit";

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

/** Spec §2.1 color palette — full-ring colors (distinct from per-regime sat dot colors). */
const RING_COLORS: Record<"LEO" | "MEO" | "GEO" | "HEO", string> = {
  LEO: "#8ecae6",
  MEO: "#2a9d8f",
  GEO: "#e9c46a",
  HEO: "#c77dff",
};

const TAIL_LEN = 60;

// ---------------------------------------------------------------------------
// orbitRing cache with simple LRU-ish eviction (cap 2000).
// ---------------------------------------------------------------------------

type RingCacheEntry = { ring: Float32Array };
const RING_CACHE = new Map<string, RingCacheEntry>();
const RING_CACHE_CAP = 2000;

function ringCacheKey(s: SatelliteDTO): string {
  // TLE epoch captures orbit freshness; fallback to id alone.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const epoch = (s as any).tleEpoch ?? (s as any).tle_epoch ?? "";
  return `${s.id}:${epoch}`;
}

function getCachedRing(s: SatelliteDTO): Float32Array | null {
  const key = ringCacheKey(s);
  const hit = RING_CACHE.get(key);
  if (hit) {
    // Touch to keep order (Map preserves insertion order, so re-set moves to end).
    RING_CACHE.delete(key);
    RING_CACHE.set(key, hit);
    return hit.ring;
  }
  try {
    const ring = orbitRing(s, 128);
    RING_CACHE.set(key, { ring });
    if (RING_CACHE.size > RING_CACHE_CAP) {
      // Drop the oldest half in one pass.
      const drop = Math.floor(RING_CACHE_CAP / 2);
      const iter = RING_CACHE.keys();
      for (let i = 0; i < drop; i++) {
        const k = iter.next().value;
        if (k === undefined) break;
        RING_CACHE.delete(k);
      }
    }
    return ring;
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------------
// One-shot perf warning.
// ---------------------------------------------------------------------------
let WARNED_FULL_ALL = false;

// ---------------------------------------------------------------------------
// Full-ring geometry per regime: merge rings into LineSegments.
// For each 128-point ring, emit 128 segments pairing consecutive points
// (closed loop). Output vertex count = 256 × N_rings per regime.
// ---------------------------------------------------------------------------

function buildRegimeGeometry(
  sats: SatelliteDTO[],
): THREE.BufferGeometry | null {
  if (sats.length === 0) return null;
  const segPerRing = 128;
  const vertsPerRing = segPerRing * 2;
  const total = sats.length * vertsPerRing;
  const positions = new Float32Array(total * 3);
  let write = 0;

  for (const s of sats) {
    const ring = getCachedRing(s);
    if (!ring) continue;
    for (let k = 0; k < segPerRing; k++) {
      const a = k * 3;
      const b = ((k + 1) % segPerRing) * 3;
      positions[write++] = ring[a] ?? 0;
      positions[write++] = ring[a + 1] ?? 0;
      positions[write++] = ring[a + 2] ?? 0;
      positions[write++] = ring[b] ?? 0;
      positions[write++] = ring[b + 1] ?? 0;
      positions[write++] = ring[b + 2] ?? 0;
    }
  }

  const geom = new THREE.BufferGeometry();
  // If some rings failed we may have unused tail — trim.
  const used = positions.subarray(0, write);
  geom.setAttribute("position", new THREE.BufferAttribute(used, 3));
  return geom;
}

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
      const g = buildRegimeGeometry(inRegime);
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
  const tailsGeom = useMemo(() => {
    if (trailMode !== "tails") return null;
    const visible = satellites.filter((s) =>
      includesRegime(s.regime as "LEO" | "MEO" | "GEO" | "HEO"),
    );
    const segPerSat = TAIL_LEN - 1;
    const total = visible.length * segPerSat * 2;
    const g = new THREE.BufferGeometry();
    g.setAttribute(
      "position",
      new THREE.BufferAttribute(new Float32Array(total * 3), 3),
    );
    g.setAttribute(
      "color",
      new THREE.BufferAttribute(new Float32Array(total * 3), 3),
    );
    // Keep list of sat ids aligned to buffer segments so useFrame can write.
    (g as unknown as { _satIds: number[] })._satIds = visible.map((s) => s.id);
    (g as unknown as { _sats: SatelliteDTO[] })._sats = visible;
    return g;
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

    const sats = (tailsGeom as unknown as { _sats: SatelliteDTO[] })._sats;
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
        RING_COLORS[s.regime as "LEO" | "MEO" | "GEO" | "HEO"] ?? "#ffffff",
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
                color={RING_COLORS[r]}
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
