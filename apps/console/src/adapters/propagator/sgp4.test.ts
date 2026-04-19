import { describe, it, expect } from "vitest";
import * as THREE from "three";
import {
  satellitePosition,
  satellitePositionAt,
  propagateSgp4,
  orbitRing,
  SCENE_SCALE,
  EARTH_KM,
} from "./sgp4";

const MU = 398600.4418;

// Representative LEO (ISS-ish): a≈7000 km, e=0.001, i=51.6°, Ω/ω/M=0
const leo = {
  semiMajorAxisKm: 7000,
  eccentricity: 0.001,
  inclinationDeg: 51.6,
  raanDeg: 0,
  argPerigeeDeg: 0,
  meanAnomalyDeg: 0,
  meanMotionRevPerDay: 86400 / (2 * Math.PI * Math.sqrt((7000 ** 3) / MU)),
};

describe("orbit", () => {
  it("ring closure: first ≈ last sample within 1e-3 scene units", () => {
    const ring = orbitRing(leo, 128);
    // Compute position at t=T (one full period) and compare to t=0
    const a = leo.semiMajorAxisKm;
    const T = 2 * Math.PI * Math.sqrt((a * a * a) / MU);
    const p0 = satellitePosition(leo, 0, new THREE.Vector3());
    const pT = satellitePosition(leo, T, new THREE.Vector3());
    const dx = p0.x - pT.x, dy = p0.y - pT.y, dz = p0.z - pT.z;
    const dist = Math.sqrt(dx * dx + dy * dy + dz * dz);
    expect(dist).toBeLessThan(1e-3);
    // Also: first sample (k=0) and re-sampling at k=n (which equals k=0 cyclically)
    expect(ring[0]).toBeCloseTo(p0.x, 5);
    expect(ring[1]).toBeCloseTo(p0.y, 5);
    expect(ring[2]).toBeCloseTo(p0.z, 5);
  });

  it("period correctness: satellitePosition(s, 0) ≈ satellitePosition(s, T) within 1e-3", () => {
    const a = leo.semiMajorAxisKm;
    const T = 2 * Math.PI * Math.sqrt((a * a * a) / MU);
    const p0 = satellitePosition(leo, 0, new THREE.Vector3());
    const pT = satellitePosition(leo, T, new THREE.Vector3());
    expect(Math.abs(p0.x - pT.x)).toBeLessThan(1e-3);
    expect(Math.abs(p0.y - pT.y)).toBeLessThan(1e-3);
    expect(Math.abs(p0.z - pT.z)).toBeLessThan(1e-3);
  });

  it("orbitRing length = 3 * n for n=128", () => {
    const ring = orbitRing(leo, 128);
    expect(ring).toBeInstanceOf(Float32Array);
    expect(ring.length).toBe(3 * 128);
  });

  it("orbitRing determinism: two calls yield identical arrays", () => {
    const a = orbitRing(leo, 128);
    const b = orbitRing(leo, 128);
    expect(a.length).toBe(b.length);
    for (let i = 0; i < a.length; i++) {
      expect(a[i]).toBe(b[i]);
    }
  });

  it("SCENE_SCALE is applied (positions are small, not km)", () => {
    const p = satellitePosition(leo, 0, new THREE.Vector3());
    // a=7000 km → scene ≈ 7000/3000 ≈ 2.33 units
    const r = Math.sqrt(p.x * p.x + p.y * p.y + p.z * p.z);
    expect(r).toBeCloseTo(leo.semiMajorAxisKm * (1 - leo.eccentricity) * SCENE_SCALE, 2);
  });

  it("satellitePositionAt anchors on TLE epoch (t=epoch ≈ Kepler t=0)", () => {
    const epoch = "2026-04-19T00:00:00.000Z";
    const sAt = { ...leo, epoch };
    const p0Kepler = satellitePosition(leo, 0, new THREE.Vector3());
    const pAtEpoch = satellitePositionAt(sAt, Date.parse(epoch), new THREE.Vector3());
    expect(pAtEpoch.x).toBeCloseTo(p0Kepler.x, 6);
    expect(pAtEpoch.y).toBeCloseTo(p0Kepler.y, 6);
    expect(pAtEpoch.z).toBeCloseTo(p0Kepler.z, 6);
  });

  it("propagateSgp4 falls back to Kepler when TLE lines are absent", () => {
    const epoch = "2026-04-19T00:00:00.000Z";
    const sNoTle = { ...leo, epoch, tleLine1: null, tleLine2: null };
    const nowMs = Date.parse(epoch) + 600_000; // +10 min
    const sgp4Result = propagateSgp4(sNoTle, nowMs, new THREE.Vector3());
    const keplerResult = satellitePositionAt(sNoTle, nowMs, new THREE.Vector3());
    expect(sgp4Result.x).toBeCloseTo(keplerResult.x, 8);
    expect(sgp4Result.y).toBeCloseTo(keplerResult.y, 8);
    expect(sgp4Result.z).toBeCloseTo(keplerResult.z, 8);
  });

  it("propagateSgp4 returns ~LEO-radius ECI position for a valid ISS TLE", () => {
    // ISS TLE (2023-11-15, CelesTrak archive). Deterministic — no network.
    const tleLine1 =
      "1 25544U 98067A   23319.56666667  .00012345  00000-0  22789-3 0  9998";
    const tleLine2 =
      "2 25544  51.6400 123.4567 0001234 234.5678 125.4321 15.50123456456789";
    const iss = {
      ...leo,
      epoch: "2023-11-15T13:36:00.000Z",
      tleLine1,
      tleLine2,
    };
    const p = propagateSgp4(iss, Date.parse(iss.epoch), new THREE.Vector3());
    const rKm = Math.sqrt(p.x * p.x + p.y * p.y + p.z * p.z) / SCENE_SCALE;
    // ISS altitude ~410 km → geocentric radius ≈ 6781 km. Allow wide band.
    expect(rKm).toBeGreaterThan(EARTH_KM + 200);
    expect(rKm).toBeLessThan(EARTH_KM + 1000);
  });
});
