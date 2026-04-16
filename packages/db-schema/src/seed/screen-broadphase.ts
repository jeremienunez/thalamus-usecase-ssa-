#!/usr/bin/env tsx
/**
 * Broad-phase conjunction screening.
 *
 * Problem: with 33,564 catalogued objects, naive O(n²) = 563M pairs before
 * any SGP4 propagation. Unusable. We need a cheap pre-filter that survives
 * only the pairs whose orbital bands can physically intersect.
 *
 * Pipeline (per SPEC-TH-041 latency budget):
 *
 *   1. partition by regime (LEO / MEO / GEO / HEO) — prunes ~90% on cross-
 *      regime pairs.
 *   2. radial overlap: pair (A,B) survives iff
 *        max(perigeeA, perigeeB) - margin ≤ min(apogeeA, apogeeB) + margin
 *      i.e. their altitude bands overlap within a Δ (default 50 km).
 *   3. (optional) relative inclination screen — two orbits with |ΔInc| > 90°
 *      in LEO still conjunction at plane-crossing nodes, so we keep it
 *      permissive (180° filter = identity). Left disabled by default.
 *
 * Output: counts at each stage + top-N candidate pairs ordered by
 * overlap-window tightness. No SGP4 propagation, no DB writes.
 *
 * Usage:
 *   pnpm --filter @interview/db-schema exec tsx src/seed/screen-broadphase.ts
 *
 * Env:
 *   MARGIN_KM          radial slack (default 50)
 *   TOP_N              how many tightest candidate pairs to print (default 20)
 *   REGIME_FILTER      restrict to one regime: leo|meo|geo|heo (default all)
 */

import { Pool } from "pg";
import { drizzle } from "drizzle-orm/node-postgres";
import { sql } from "drizzle-orm";

const DATABASE_URL =
  process.env.DATABASE_URL ??
  "postgres://thalamus:thalamus@localhost:5433/thalamus";

const MARGIN_KM = Number(process.env.MARGIN_KM ?? 50);
const TOP_N = Number(process.env.TOP_N ?? 20);
const REGIME_FILTER = process.env.REGIME_FILTER ?? "";

type Regime = "leo" | "meo" | "geo" | "heo";

interface Obj {
  id: string;
  name: string;
  objectClass: string;
  perigeeKm: number;
  apogeeKm: number;
  inclinationDeg: number | null;
  regime: Regime;
}

/** Classify by mean altitude. Matches the existing `classifyRegime` convention. */
function classifyRegime(perigee: number, apogee: number): Regime {
  const mean = (perigee + apogee) / 2;
  if (mean < 2000) return "leo";
  if (mean < 35000) return "meo";
  if (mean < 36500) return "geo";
  return "heo";
}

async function loadObjects(db: ReturnType<typeof drizzle>): Promise<Obj[]> {
  const rows = await db.execute(sql`
    SELECT
      id::text AS id,
      name,
      object_class,
      (metadata->>'perigeeKm')::numeric::float AS perigee,
      (metadata->>'apogeeKm')::numeric::float AS apogee,
      (metadata->>'inclinationDeg')::numeric::float AS inc
    FROM satellite
    WHERE metadata->>'perigeeKm' IS NOT NULL
      AND metadata->>'apogeeKm' IS NOT NULL
  `);

  const out: Obj[] = [];
  for (const r of rows.rows as Array<{
    id: string;
    name: string;
    object_class: string;
    perigee: number;
    apogee: number;
    inc: number | null;
  }>) {
    const perigeeKm = Number(r.perigee);
    const apogeeKm = Number(r.apogee);
    if (!Number.isFinite(perigeeKm) || !Number.isFinite(apogeeKm)) continue;
    if (apogeeKm < perigeeKm) continue;
    out.push({
      id: r.id,
      name: r.name,
      objectClass: r.object_class,
      perigeeKm,
      apogeeKm,
      inclinationDeg: r.inc,
      regime: classifyRegime(perigeeKm, apogeeKm),
    });
  }
  return out;
}

interface CandidatePair {
  aId: string;
  aName: string;
  aClass: string;
  bId: string;
  bName: string;
  bClass: string;
  regime: Regime;
  overlapBottom: number;
  overlapTop: number;
  overlapKm: number;
}

interface BroadPhaseResult {
  totalCandidates: number;
  perRegime: Map<Regime, number>;
  classMix: Map<string, number>;
  /** Top-K tightest pairs (smallest `overlapKm` first). */
  topK: CandidatePair[];
}

/**
 * Radial-overlap pruner using a sweep-line.
 *
 * Within each regime bucket, sort by perigee ascending. For each object
 * `b`, candidates are the already-seen objects `a` with `a.apogee + margin ≥
 * b.perigee - margin`. We maintain a perigee-sorted active list and pop
 * exhausted entries (those whose apogee has fallen below the current
 * perigee - margin threshold).
 *
 * Counts are accumulated without storing pairs. A bounded max-heap of size
 * `topK` keeps the tightest overlaps for the narrow-phase hand-off.
 *
 * Complexity: O(n log n + candidate_count). Memory: O(n + topK).
 */
function broadPhase(
  objs: Obj[],
  marginKm: number,
  topK: number,
): BroadPhaseResult {
  const byRegime = new Map<Regime, Obj[]>();
  for (const o of objs) {
    const arr = byRegime.get(o.regime) ?? [];
    arr.push(o);
    byRegime.set(o.regime, arr);
  }

  const perRegime = new Map<Regime, number>();
  const classMix = new Map<string, number>();
  let total = 0;

  // Max-heap (largest overlapKm at top) so we can discard non-tight pairs.
  const heap: CandidatePair[] = [];
  function heapUp(i: number): void {
    while (i > 0) {
      const p = (i - 1) >> 1;
      if (heap[p]!.overlapKm < heap[i]!.overlapKm) {
        [heap[p], heap[i]] = [heap[i]!, heap[p]!];
        i = p;
      } else break;
    }
  }
  function heapDown(i: number): void {
    const n = heap.length;
    for (;;) {
      const l = 2 * i + 1;
      const r = 2 * i + 2;
      let largest = i;
      if (l < n && heap[l]!.overlapKm > heap[largest]!.overlapKm) largest = l;
      if (r < n && heap[r]!.overlapKm > heap[largest]!.overlapKm) largest = r;
      if (largest === i) break;
      [heap[i], heap[largest]] = [heap[largest]!, heap[i]!];
      i = largest;
    }
  }
  function offer(c: CandidatePair): void {
    if (heap.length < topK) {
      heap.push(c);
      heapUp(heap.length - 1);
    } else if (c.overlapKm < heap[0]!.overlapKm) {
      heap[0] = c;
      heapDown(0);
    }
  }

  for (const [regime, group] of byRegime) {
    // Sort by perigee — active window slides over sorted list.
    group.sort((a, b) => a.perigeeKm - b.perigeeKm);

    // `active` stores objects whose apogee (+ margin) still reaches current b.
    // We also keep it sorted by apogee so expiry is a linear drain from head.
    const active: Obj[] = [];
    let regimeCount = 0;

    for (const b of group) {
      const bLow = b.perigeeKm - marginKm;
      // Drain expired actives (apogee + margin < bLow).
      while (active.length > 0 && active[0]!.apogeeKm + marginKm < bLow) {
        active.shift();
      }
      for (const a of active) {
        const bottom = Math.max(a.perigeeKm, b.perigeeKm) - marginKm;
        const top = Math.min(a.apogeeKm, b.apogeeKm) + marginKm;
        const overlapKm = top - bottom;
        if (overlapKm <= 0) continue;

        total++;
        regimeCount++;
        const key = [a.objectClass, b.objectClass].sort().join("×");
        classMix.set(key, (classMix.get(key) ?? 0) + 1);

        offer({
          aId: a.id, aName: a.name, aClass: a.objectClass,
          bId: b.id, bName: b.name, bClass: b.objectClass,
          regime,
          overlapBottom: bottom,
          overlapTop: top,
          overlapKm,
        });
      }
      // Insert b into active list sorted by apogee ascending.
      let lo = 0,
        hi = active.length;
      while (lo < hi) {
        const mid = (lo + hi) >>> 1;
        if (active[mid]!.apogeeKm < b.apogeeKm) lo = mid + 1;
        else hi = mid;
      }
      active.splice(lo, 0, b);
    }
    perRegime.set(regime, regimeCount);
  }

  // Extract heap ascending (tightest first) by repeatedly removing max.
  heap.sort((a, b) => a.overlapKm - b.overlapKm);

  return { totalCandidates: total, perRegime, classMix, topK: heap };
}

async function main(): Promise<void> {
  console.log(`▸ connecting to ${DATABASE_URL.replace(/\/\/[^@]+@/, "//***@")}`);
  const pool = new Pool({ connectionString: DATABASE_URL });
  const db = drizzle(pool);

  try {
    console.log("▸ loading catalog…");
    let objs = await loadObjects(db);
    console.log(`▸ ${objs.length} objects have orbital bands`);

    if (REGIME_FILTER) {
      const before = objs.length;
      objs = objs.filter((o) => o.regime === REGIME_FILTER);
      console.log(`▸ REGIME_FILTER=${REGIME_FILTER} — ${before} → ${objs.length} objects`);
    }

    // Stage 1 — naive universe
    const naivePairs = (objs.length * (objs.length - 1)) / 2;

    // Stage 2 — per-regime bucketing
    const regimeCounts = new Map<Regime, number>();
    for (const o of objs) regimeCounts.set(o.regime, (regimeCounts.get(o.regime) ?? 0) + 1);
    let regimePairs = 0;
    for (const n of regimeCounts.values()) regimePairs += (n * (n - 1)) / 2;

    // Stage 3 — radial overlap (actual pruner)
    console.log(`▸ running broad-phase pruner (margin=${MARGIN_KM} km, topK=${TOP_N})…`);
    const t0 = Date.now();
    const { totalCandidates, perRegime, classMix, topK } = broadPhase(objs, MARGIN_KM, TOP_N);
    const elapsed = ((Date.now() - t0) / 1000).toFixed(2);

    console.log(`\n▸ screening pipeline:`);
    console.log(`  naive universe:         ${naivePairs.toLocaleString().padStart(15)} pairs`);
    console.log(`  after regime bucketing: ${regimePairs.toLocaleString().padStart(15)} pairs  (${((regimePairs / naivePairs) * 100).toFixed(2)}%)`);
    console.log(`  after radial overlap:   ${totalCandidates.toLocaleString().padStart(15)} pairs  (${((totalCandidates / naivePairs) * 100).toFixed(2)}%)`);
    console.log(`  pruning ratio:          ${(naivePairs / Math.max(totalCandidates, 1)).toFixed(0)}x`);
    console.log(`  elapsed:                ${elapsed}s`);

    console.log(`\n▸ per-regime candidate count:`);
    for (const [r, n] of [...perRegime.entries()].sort((a, b) => b[1] - a[1])) {
      const objsInRegime = regimeCounts.get(r) ?? 0;
      console.log(`  ${String(r).padEnd(5)} ${n.toLocaleString().padStart(12)} pairs  (${objsInRegime} objects)`);
    }

    console.log(`\n▸ top ${TOP_N} tightest candidate pairs (overlap window):`);
    for (const c of topK) {
      console.log(
        `  [${c.regime}] ${c.aName.padEnd(28)} × ${c.bName.padEnd(28)}  overlap=${c.overlapKm.toFixed(1)} km  band=[${c.overlapBottom.toFixed(0)}, ${c.overlapTop.toFixed(0)}]  (${c.aClass}×${c.bClass})`,
      );
    }

    console.log(`\n▸ cross-class candidate mix:`);
    for (const [k, n] of [...classMix.entries()].sort((a, b) => b[1] - a[1])) {
      console.log(`  ${k.padEnd(28)} ${n.toLocaleString().padStart(12)}`);
    }
  } finally {
    await pool.end();
  }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((err) => {
    console.error("\n✗ broad-phase failed:", err);
    process.exit(1);
  });
}
