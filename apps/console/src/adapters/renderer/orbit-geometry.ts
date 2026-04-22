import * as THREE from "three";
import type { SatelliteDto } from "@/dto/http";
import { orbitRing } from "@/adapters/propagator/sgp4";

/**
 * Module-level LRU-ish cache of 128-point orbit rings keyed by
 * `${id}:${tleEpoch}`. Kept inside the adapter so features don't hold a
 * module singleton of their own.
 */
type RingCacheEntry = { ring: Float32Array };
const RING_CACHE = new Map<string, RingCacheEntry>();
const RING_CACHE_CAP = 2000;

function ringCacheKey(s: SatelliteDto): string {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const epoch = (s as any).tleEpoch ?? (s as any).tle_epoch ?? "";
  return `${s.id}:${epoch}`;
}

function getCachedRing(s: SatelliteDto): Float32Array | null {
  const key = ringCacheKey(s);
  const hit = RING_CACHE.get(key);
  if (hit) {
    RING_CACHE.delete(key);
    RING_CACHE.set(key, hit);
    return hit.ring;
  }
  try {
    const ring = orbitRing(s, 128);
    RING_CACHE.set(key, { ring });
    if (RING_CACHE.size > RING_CACHE_CAP) {
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

export function clearRingCache(): void {
  RING_CACHE.clear();
}

/**
 * Build a merged `lineSegments` geometry out of every satellite's full orbital
 * ring. One segment per ring sample pair, closed loop. Returns null if none of
 * the inputs had a propagate-able TLE.
 */
export function buildFullRingsGeometry(sats: SatelliteDto[]): THREE.BufferGeometry | null {
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
  const used = positions.subarray(0, write);
  geom.setAttribute("position", new THREE.BufferAttribute(used, 3));
  return geom;
}

/** Shape returned by {@link buildTailsGeometry} — the `_sats` slot is consumed
 *  by the per-frame writer to keep geometry-row order stable. */
export type TailsGeometry = THREE.BufferGeometry & {
  _sats: SatelliteDto[];
  _satIds: number[];
};

/**
 * Allocate a merged `lineSegments` geometry large enough to hold
 * `tailLen-1` segments per satellite, with both `position` and `color`
 * attributes zero-initialised. The per-frame writer mutates both arrays.
 */
export function buildTailsGeometry(
  sats: SatelliteDto[],
  tailLen: number,
): TailsGeometry {
  const segPerSat = tailLen - 1;
  const total = sats.length * segPerSat * 2;
  const g = new THREE.BufferGeometry();
  g.setAttribute("position", new THREE.BufferAttribute(new Float32Array(total * 3), 3));
  g.setAttribute("color", new THREE.BufferAttribute(new Float32Array(total * 3), 3));
  const tagged = g as TailsGeometry;
  tagged._sats = sats;
  tagged._satIds = sats.map((s) => s.id);
  return tagged;
}
