#!/usr/bin/env tsx
/**
 * Narrow-phase conjunction screening — closes the loop after broad-phase.
 *
 * Pipeline (per SPEC-TH-041):
 *   1. re-run `screen-broadphase` radial-overlap filter to pick the K
 *      tightest candidate pairs
 *   2. for each unique NORAD id involved, fetch the current TLE from
 *      CelesTrak (cached on disk at /tmp/tle-cache/)
 *   3. SGP4-propagate both objects over a forward window at fine step;
 *      track minimum range, TCA, relative velocity
 *   4. compute Pc via the regime-conditioned 1σ model (sigmaKmFor) and a
 *      2D projection onto the conjunction plane
 *   5. UPSERT into conjunction_event by (primary, secondary, epoch)
 *
 * Usage:
 *   pnpm --filter @interview/db-schema exec tsx src/seed/screen-narrow-phase.ts
 *
 * Env:
 *   NARROW_TOP_K       how many candidates from broad-phase (default 500)
 *   NARROW_WINDOW_H    propagation window hours (default 72)
 *   NARROW_STEP_S      SGP4 step seconds (default 30)
 *   NARROW_THRESHOLD_KM  min-range filter for conjunction_event insert (default 25)
 *   NARROW_MARGIN_KM   broad-phase radial slack (default 20)
 *   TLE_CACHE_DIR      default /tmp/tle-cache
 */

import { existsSync, readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { Pool } from "pg";
import { drizzle } from "drizzle-orm/node-postgres";
import { sql } from "drizzle-orm";
// eslint-disable-next-line @typescript-eslint/no-explicit-any
import * as satelliteJs from "satellite.js";
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const sat: any = (satelliteJs as any).default ?? satelliteJs;
import { sigmaKmFor } from "./conjunctions";

const DATABASE_URL =
  process.env.DATABASE_URL ??
  "postgres://thalamus:thalamus@localhost:5433/thalamus";

const TOP_K = Number(process.env.NARROW_TOP_K ?? 500);
const WINDOW_H = Number(process.env.NARROW_WINDOW_H ?? 72);
const STEP_S = Number(process.env.NARROW_STEP_S ?? 30);
const THRESHOLD_KM = Number(process.env.NARROW_THRESHOLD_KM ?? 25);
const MARGIN_KM = Number(process.env.NARROW_MARGIN_KM ?? 20);
const TLE_CACHE_DIR = process.env.TLE_CACHE_DIR ?? "/tmp/tle-cache";
const HARD_BODY_M = 10; // 10 m — mid-range between cubesat + medium payload

// ─── Types ──────────────────────────────────────────────────────────────────

type Regime = "leo" | "meo" | "geo" | "heo";

interface Obj {
  id: string;
  name: string;
  noradId: number;
  objectClass: string;
  perigeeKm: number;
  apogeeKm: number;
  regime: Regime;
}

interface CandidatePair {
  a: Obj;
  b: Obj;
  overlapKm: number;
}

export function classifyRegime(perigee: number, apogee: number): Regime {
  const mean = (perigee + apogee) / 2;
  if (mean < 2000) return "leo";
  if (mean < 35000) return "meo";
  if (mean < 36500) return "geo";
  return "heo";
}

// ─── Load + broad-phase top-K ────────────────────────────────────────────────

export async function loadObjects(
  db: Pick<ReturnType<typeof drizzle>, "execute">,
): Promise<Obj[]> {
  const rows = await db.execute(sql`
    SELECT
      id::text AS id, name, norad_id, object_class,
      (metadata->>'perigeeKm')::numeric::float AS perigee,
      (metadata->>'apogeeKm')::numeric::float AS apogee
    FROM satellite
    WHERE norad_id IS NOT NULL
      AND metadata->>'perigeeKm' IS NOT NULL
      AND metadata->>'apogeeKm' IS NOT NULL
  `);
  const out: Obj[] = [];
  for (const r of rows.rows as Array<{
    id: string; name: string; norad_id: number;
    object_class: string; perigee: number; apogee: number;
  }>) {
    const p = Number(r.perigee), a = Number(r.apogee);
    if (!Number.isFinite(p) || !Number.isFinite(a) || a < p) continue;
    out.push({
      id: r.id, name: r.name, noradId: r.norad_id,
      objectClass: r.object_class, perigeeKm: p, apogeeKm: a,
      regime: classifyRegime(p, a),
    });
  }
  return out;
}

/**
 * Sweep-line broad-phase with bounded top-K heap. Copy of screen-broadphase
 * logic, inlined so this script is self-contained. Returns tightest pairs.
 */
export function broadPhaseTopK(objs: Obj[], marginKm: number, topK: number): CandidatePair[] {
  const byRegime = new Map<Regime, Obj[]>();
  for (const o of objs) {
    const arr = byRegime.get(o.regime) ?? [];
    arr.push(o);
    byRegime.set(o.regime, arr);
  }
  const heap: CandidatePair[] = [];
  const up = (i: number) => {
    while (i > 0) {
      const p = (i - 1) >> 1;
      if (heap[p]!.overlapKm < heap[i]!.overlapKm) {
        [heap[p], heap[i]] = [heap[i]!, heap[p]!]; i = p;
      } else break;
    }
  };
  const down = (i: number) => {
    const n = heap.length;
    for (;;) {
      const l = 2 * i + 1, r = 2 * i + 2;
      let m = i;
      if (l < n && heap[l]!.overlapKm > heap[m]!.overlapKm) m = l;
      if (r < n && heap[r]!.overlapKm > heap[m]!.overlapKm) m = r;
      if (m === i) break;
      [heap[i], heap[m]] = [heap[m]!, heap[i]!]; i = m;
    }
  };
  const offer = (c: CandidatePair) => {
    if (heap.length < topK) { heap.push(c); up(heap.length - 1); }
    else if (c.overlapKm < heap[0]!.overlapKm) { heap[0] = c; down(0); }
  };
  for (const group of byRegime.values()) {
    group.sort((a, b) => a.perigeeKm - b.perigeeKm);
    const active: Obj[] = [];
    for (const b of group) {
      const bLow = b.perigeeKm - marginKm;
      while (active.length > 0 && active[0]!.apogeeKm + marginKm < bLow) active.shift();
      for (const a of active) {
        const bottom = Math.max(a.perigeeKm, b.perigeeKm) - marginKm;
        const top = Math.min(a.apogeeKm, b.apogeeKm) + marginKm;
        const overlapKm = top - bottom;
        if (overlapKm > 0) offer({ a, b, overlapKm });
      }
      let lo = 0, hi = active.length;
      while (lo < hi) {
        const mid = (lo + hi) >>> 1;
        if (active[mid]!.apogeeKm < b.apogeeKm) lo = mid + 1; else hi = mid;
      }
      active.splice(lo, 0, b);
    }
  }
  heap.sort((a, b) => a.overlapKm - b.overlapKm);
  return heap;
}

// ─── TLE fetch + cache ──────────────────────────────────────────────────────

if (!existsSync(TLE_CACHE_DIR)) mkdirSync(TLE_CACHE_DIR, { recursive: true });

const tleMem = new Map<number, { l1: string; l2: string } | null>();

export async function fetchTLE(norad: number): Promise<{ l1: string; l2: string } | null> {
  if (tleMem.has(norad)) return tleMem.get(norad) ?? null;
  const cachePath = join(TLE_CACHE_DIR, `${norad}.txt`);
  let body: string | null = null;
  if (existsSync(cachePath)) {
    body = readFileSync(cachePath, "utf8");
  } else {
    try {
      const res = await fetch(
        `https://celestrak.org/NORAD/elements/gp.php?CATNR=${norad}&FORMAT=tle`,
        { signal: AbortSignal.timeout(15_000) },
      );
      if (!res.ok) { tleMem.set(norad, null); return null; }
      body = await res.text();
      writeFileSync(cachePath, body, "utf8");
      await new Promise((r) => setTimeout(r, 50)); // politeness to CelesTrak
    } catch {
      tleMem.set(norad, null);
      return null;
    }
  }
  const lines = body.trim().split("\n").map((l) => l.trim());
  // Expect 3 lines: name, L1, L2. CelesTrak returns "No GP data found" on miss.
  if (lines.length < 3 || !lines[1]!.startsWith("1 ") || !lines[2]!.startsWith("2 ")) {
    tleMem.set(norad, null);
    return null;
  }
  const parsed = { l1: lines[1]!, l2: lines[2]! };
  tleMem.set(norad, parsed);
  return parsed;
}

// ─── SGP4 propagation + Pc ──────────────────────────────────────────────────

interface CloseApproach {
  minRangeKm: number;
  tca: Date;
  relVelKmps: number;
  daysFromEpoch: number;
}

/**
 * Propagate both satellites over `windowH` hours at `stepS` step and find the
 * minimum-range timestep. Returns null if either satrec fails at some step.
 */
export function findClosestApproach(
  recA: unknown, recB: unknown, start: Date, windowH: number, stepS: number,
): CloseApproach | null {
  let best: CloseApproach | null = null;
  let prevA: { x: number; y: number; z: number } | null = null;
  let prevB: { x: number; y: number; z: number } | null = null;

  const steps = Math.floor((windowH * 3600) / stepS);
  for (let i = 0; i <= steps; i++) {
    const t = new Date(start.getTime() + i * stepS * 1000);
    const pvA = sat.propagate(recA as never, t);
    const pvB = sat.propagate(recB as never, t);
    if (!pvA?.position || !pvB?.position) return null;
    const pA = pvA.position as { x: number; y: number; z: number };
    const pB = pvB.position as { x: number; y: number; z: number };
    const dx = pA.x - pB.x, dy = pA.y - pB.y, dz = pA.z - pB.z;
    const range = Math.sqrt(dx * dx + dy * dy + dz * dz);
    if (best === null || range < best.minRangeKm) {
      let relVel = 0;
      if (prevA && prevB) {
        const dvx = (pA.x - prevA.x) - (pB.x - prevB.x);
        const dvy = (pA.y - prevA.y) - (pB.y - prevB.y);
        const dvz = (pA.z - prevA.z) - (pB.z - prevB.z);
        relVel = Math.sqrt(dvx * dvx + dvy * dvy + dvz * dvz) / stepS;
      }
      best = {
        minRangeKm: range,
        tca: t,
        relVelKmps: relVel,
        daysFromEpoch: (t.getTime() - start.getTime()) / 86_400_000,
      };
    }
    prevA = pA; prevB = pB;
  }
  return best;
}

/**
 * Simple Foster 1992 style Pc approximation: treat combined position error as
 * isotropic Gaussian and integrate over a hard-body disc. Not operational
 * grade, but enough to produce a ranked list with plausible magnitudes.
 */
export function computePc(
  minRangeKm: number, sigmaCombinedKm: number, hardBodyM: number,
): number {
  const r = hardBodyM / 1000; // km
  const d = minRangeKm;
  const s2 = sigmaCombinedKm * sigmaCombinedKm;
  // 2D Gaussian integrated over disc at distance d: 1 - exp(-(r² + d²)/(2σ²)) × I0(dr/σ²) ≈
  // for small r/σ the PDF × area works within an order of magnitude.
  const density = Math.exp(-(d * d) / (2 * s2)) / (2 * Math.PI * s2);
  return Math.max(0, density * Math.PI * r * r);
}

// ─── Main ───────────────────────────────────────────────────────────────────

async function main(): Promise<void> {
  console.log(`▸ connecting to ${DATABASE_URL.replace(/\/\/[^@]+@/, "//***@")}`);
  const pool = new Pool({ connectionString: DATABASE_URL });
  const db = drizzle(pool);

  try {
    console.log("▸ loading catalog…");
    const objs = await loadObjects(db);
    console.log(`▸ ${objs.length} objects with norad_id + bands`);

    console.log(`▸ broad-phase pruning → top ${TOP_K}…`);
    const t0 = Date.now();
    const candidates = broadPhaseTopK(objs, MARGIN_KM, TOP_K);
    console.log(`  done in ${((Date.now() - t0) / 1000).toFixed(1)}s`);

    const uniqNorads = new Set<number>();
    for (const c of candidates) { uniqNorads.add(c.a.noradId); uniqNorads.add(c.b.noradId); }
    console.log(`▸ fetching TLEs for ${uniqNorads.size} unique NORAD ids…`);
    const tleFetchStart = Date.now();
    let tleHits = 0, tleMiss = 0;
    for (const norad of uniqNorads) {
      const tle = await fetchTLE(norad);
      if (tle) tleHits++; else tleMiss++;
      if ((tleHits + tleMiss) % 50 === 0) {
        process.stdout.write(`\r  tles: ${tleHits + tleMiss}/${uniqNorads.size}`);
      }
    }
    console.log(`\n  hits=${tleHits} miss=${tleMiss} elapsed=${((Date.now() - tleFetchStart) / 1000).toFixed(1)}s`);

    // Build satrec cache.
    const recCache = new Map<number, unknown>();
    for (const [norad, tle] of tleMem.entries()) {
      if (!tle) continue;
      try { recCache.set(norad, sat.twoline2satrec(tle.l1, tle.l2)); } catch { /* skip */ }
    }

    const start = new Date();
    console.log(`▸ propagating ${candidates.length} pairs over ${WINDOW_H}h @ ${STEP_S}s step…`);
    const propStart = Date.now();
    let propagated = 0, writes = 0, skipped = 0;
    for (const c of candidates) {
      const recA = recCache.get(c.a.noradId);
      const recB = recCache.get(c.b.noradId);
      if (!recA || !recB) { skipped++; continue; }

      const ca = findClosestApproach(recA, recB, start, WINDOW_H, STEP_S);
      propagated++;
      if (!ca || ca.minRangeKm > THRESHOLD_KM) continue;

      const sigma = Math.sqrt(
        sigmaKmFor(c.a.regime, 0, ca.daysFromEpoch) ** 2 +
        sigmaKmFor(c.b.regime, 0, ca.daysFromEpoch) ** 2,
      );
      const pc = computePc(ca.minRangeKm, sigma, HARD_BODY_M);

      await db.execute(sql`
        INSERT INTO conjunction_event (
          primary_satellite_id, secondary_satellite_id, epoch,
          min_range_km, relative_velocity_kmps,
          probability_of_collision,
          primary_sigma_km, secondary_sigma_km, combined_sigma_km,
          hard_body_radius_m, pc_method, metadata
        ) VALUES (
          ${BigInt(c.a.id)}, ${BigInt(c.b.id)}, ${ca.tca.toISOString()},
          ${ca.minRangeKm}, ${ca.relVelKmps},
          ${pc},
          ${sigmaKmFor(c.a.regime, 0, ca.daysFromEpoch)},
          ${sigmaKmFor(c.b.regime, 0, ca.daysFromEpoch)},
          ${sigma},
          ${HARD_BODY_M},
          'foster-1992-isotropic',
          ${JSON.stringify({
            regime: c.a.regime,
            overlapKmBroadPhase: c.overlapKm,
            aClass: c.a.objectClass, bClass: c.b.objectClass,
            aName: c.a.name, bName: c.b.name,
            daysFromEpoch: ca.daysFromEpoch,
          })}::jsonb
        )
        ON CONFLICT (primary_satellite_id, secondary_satellite_id, epoch)
        DO UPDATE SET
          min_range_km = EXCLUDED.min_range_km,
          probability_of_collision = EXCLUDED.probability_of_collision,
          combined_sigma_km = EXCLUDED.combined_sigma_km,
          computed_at = NOW()
      `);
      writes++;
      if (writes % 10 === 0) process.stdout.write(`\r  propagated ${propagated}/${candidates.length}  writes=${writes}`);
    }
    console.log(`\n▸ done. propagated=${propagated} writes=${writes} skipped=${skipped} elapsed=${((Date.now() - propStart) / 1000).toFixed(1)}s`);

    const summary = await db.execute(sql`
      SELECT
        COUNT(*)::int AS total,
        MIN(min_range_km)::float AS tightest_km,
        COUNT(*) FILTER (WHERE probability_of_collision >= 1e-4)::int AS high_pc,
        COUNT(*) FILTER (WHERE probability_of_collision >= 1e-6)::int AS med_pc
      FROM conjunction_event
    `);
    console.log(`▸ conjunction_event summary:`, summary.rows[0]);
  } finally {
    await pool.end();
  }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((err) => {
    console.error("\n✗ narrow-phase failed:", err);
    process.exit(1);
  });
}
