import * as THREE from "three";
import * as satelliteJs from "satellite.js";
import type { SatelliteDTO } from "./api";

/** Earth radius in km (scene uses km → units / 1000 for display). */
export const EARTH_KM = 6378.137;
export const SCENE_SCALE = 1 / 3000;
export const EARTH_UNITS = EARTH_KM * SCENE_SCALE;

const MU = 398600.4418;
const DEG = Math.PI / 180;

/**
 * Kepler position in Earth-Centered Inertial frame, given orbital elements.
 * Returns position in scene units.
 */
export function satellitePosition(
  s: Pick<
    SatelliteDTO,
    | "semiMajorAxisKm"
    | "eccentricity"
    | "inclinationDeg"
    | "raanDeg"
    | "argPerigeeDeg"
    | "meanAnomalyDeg"
    | "meanMotionRevPerDay"
  >,
  tSec: number,
  out = new THREE.Vector3(),
): THREE.Vector3 {
  const a = s.semiMajorAxisKm;
  const e = s.eccentricity;
  const i = s.inclinationDeg * DEG;
  const Om = s.raanDeg * DEG;
  const w = s.argPerigeeDeg * DEG;
  const n = Math.sqrt(MU / (a * a * a));
  const M = s.meanAnomalyDeg * DEG + n * tSec;

  // Solve Kepler M = E - e sin E
  let E = M;
  for (let k = 0; k < 6; k++) {
    E = E - (E - e * Math.sin(E) - M) / (1 - e * Math.cos(E));
  }
  const nu = 2 * Math.atan2(Math.sqrt(1 + e) * Math.sin(E / 2), Math.sqrt(1 - e) * Math.cos(E / 2));
  const r = a * (1 - e * Math.cos(E));

  const xp = r * Math.cos(nu);
  const yp = r * Math.sin(nu);

  const cosO = Math.cos(Om), sinO = Math.sin(Om);
  const cosi = Math.cos(i), sini = Math.sin(i);
  const cosw = Math.cos(w), sinw = Math.sin(w);

  const x = (cosO * cosw - sinO * sinw * cosi) * xp + (-cosO * sinw - sinO * cosw * cosi) * yp;
  const y = (sinO * cosw + cosO * sinw * cosi) * xp + (-sinO * sinw + cosO * cosw * cosi) * yp;
  const z = sinw * sini * xp + cosw * sini * yp;

  out.set(x * SCENE_SCALE, z * SCENE_SCALE, -y * SCENE_SCALE);
  return out;
}

/**
 * Sample `n` ECI positions across one full orbital period.
 * Returns a flat Float32Array [x0, y0, z0, x1, y1, z1, ...] in scene units.
 * Default n = 128.
 */
export function orbitRing(
  s: Pick<
    SatelliteDTO,
    | "semiMajorAxisKm"
    | "eccentricity"
    | "inclinationDeg"
    | "raanDeg"
    | "argPerigeeDeg"
    | "meanAnomalyDeg"
    | "meanMotionRevPerDay"
  >,
  n: number = 128,
): Float32Array {
  const a = s.semiMajorAxisKm;
  const T = 2 * Math.PI * Math.sqrt((a * a * a) / MU);
  const out = new Float32Array(3 * n);
  const v = new THREE.Vector3();
  for (let k = 0; k < n; k++) {
    const tSec = (k / n) * T;
    satellitePosition(s, tSec, v);
    out[3 * k] = v.x;
    out[3 * k + 1] = v.y;
    out[3 * k + 2] = v.z;
  }
  return out;
}

/**
 * Keplerian fallback anchored on the TLE epoch: advance mean anomaly from the
 * element epoch to `nowMs` (wall-clock), then delegate to the two-body solver.
 * Safe to call without tleLine1/tleLine2 — only needs s.epoch.
 */
export function satellitePositionAt(
  s: Pick<
    SatelliteDTO,
    | "semiMajorAxisKm"
    | "eccentricity"
    | "inclinationDeg"
    | "raanDeg"
    | "argPerigeeDeg"
    | "meanAnomalyDeg"
    | "meanMotionRevPerDay"
    | "epoch"
  >,
  nowMs: number = Date.now(),
  out = new THREE.Vector3(),
): THREE.Vector3 {
  const epochMs = Date.parse(s.epoch);
  const dtSec = Number.isFinite(epochMs) ? (nowMs - epochMs) / 1000 : 0;
  return satellitePosition(s, dtSec, out);
}

// satrec init is not cheap (≈ms for each TLE); cache by line1 since TLEs are
// immutable per ingestion and we rebuild every animation frame.
const satrecByLine1 = new Map<string, satelliteJs.SatRec | null>();

/**
 * Real-time SGP4/SDP4 propagation from TLE line1/line2 when available,
 * otherwise falls back to the epoch-anchored Keplerian solver.
 * Returns position in scene units (three.js y-up).
 */
export function propagateSgp4(
  s: Pick<
    SatelliteDTO,
    | "semiMajorAxisKm"
    | "eccentricity"
    | "inclinationDeg"
    | "raanDeg"
    | "argPerigeeDeg"
    | "meanAnomalyDeg"
    | "meanMotionRevPerDay"
    | "epoch"
    | "tleLine1"
    | "tleLine2"
  >,
  nowMs: number = Date.now(),
  out = new THREE.Vector3(),
): THREE.Vector3 {
  const l1 = s.tleLine1;
  const l2 = s.tleLine2;
  if (l1 && l2) {
    let satrec = satrecByLine1.get(l1);
    if (satrec === undefined) {
      try {
        satrec = satelliteJs.twoline2satrec(l1, l2);
      } catch {
        satrec = null;
      }
      satrecByLine1.set(l1, satrec);
    }
    if (satrec && satrec.error === 0) {
      const pv = satelliteJs.propagate(satrec, new Date(nowMs));
      const pos = pv.position;
      if (pos && typeof pos !== "boolean" && satrec.error === 0) {
        // TEME ≈ ECI at visualization scale; map ECI (x,y,z) → scene (x, z, -y).
        out.set(pos.x * SCENE_SCALE, pos.z * SCENE_SCALE, -pos.y * SCENE_SCALE);
        return out;
      }
    }
  }
  return satellitePositionAt(s, nowMs, out);
}

export function regimeColor(regime: "LEO" | "MEO" | "GEO" | "HEO"): THREE.Color {
  const map = { LEO: "#60A5FA", MEO: "#A78BFA", GEO: "#34D399", HEO: "#F59E0B" } as const;
  return new THREE.Color(map[regime]);
}

export function pcColor(pc: number): THREE.Color {
  if (pc >= 1e-4) return new THREE.Color("#F87171");
  if (pc >= 1e-6) return new THREE.Color("#F59E0B");
  return new THREE.Color("#6E7681");
}
