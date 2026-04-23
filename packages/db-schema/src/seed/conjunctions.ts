/**
 * seedConjunctions — SGP4-propagated close-approach screening.
 *
 * Reads satellites + parsed TLE params from satellite.telemetry_summary,
 * synthesizes minimal-but-valid TLE strings when raw lines are absent,
 * runs satellite.js SGP4 propagation over a forward window, and persists
 * candidate close approaches (min_range < threshold) to conjunction_event.
 *
 * Designed to run in < 3 min wall clock on 500 satellites by:
 *   - Grouping by regime (cross-regime conjunctions are vanishingly rare)
 *   - Capping per-regime sample size
 *   - 5-min propagation step (300 s)
 *   - Pre-computed position arrays per satellite per timestep
 */

import { sql } from "drizzle-orm";
// eslint-disable-next-line @typescript-eslint/no-explicit-any
import * as satelliteJs from "satellite.js";
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const satellite: any = (satelliteJs as any).default ?? satelliteJs;
import { conjunctionEvent } from "../schema/conjunction";

export interface SeedConjunctionsOpts {
  windowDays?: number;
  stepSeconds?: number;
  thresholdKm?: number;
  maxPerRegime?: number;
  logIntervalMs?: number;
}

interface SatRow {
  id: bigint;
  name: string;
  noradId: number;
  meanMotion: number;
  inclination: number;
  eccentricity: number;
  regime: string;
  tleLine1?: string;
  tleLine2?: string;
}

// ─── Covariance / Pc model ───────────────────────────────────────────────────

/**
 * Regime-conditioned 1σ position uncertainty (km) at TCA.
 * baseline σ at epoch + growth rate × days propagated forward.
 * Values are order-of-magnitude plausible for OSINT-derived TLEs.
 */
export function sigmaKmFor(
  regime: string,
  _ageAtEpochDays: number,
  propagationDays: number,
): number {
  const r = (regime || "").toUpperCase();
  let baseline: number;
  let growth: number;
  switch (r) {
    case "LEO":
      baseline = 0.5; growth = 0.15; break;
    case "SSO":
      baseline = 0.5; growth = 0.15; break;
    case "MEO":
      baseline = 1.0; growth = 0.05; break;
    case "GTO":
      baseline = 2.0; growth = 0.1; break;
    case "HEO":
      baseline = 2.5; growth = 0.1; break;
    case "GEO":
      baseline = 4.0; growth = 0.02; break;
    default:
      baseline = 1.0; growth = 0.1;
  }
  const days = Math.max(0, propagationDays);
  return baseline + growth * days;
}

// ─── TLE synthesis ───────────────────────────────────────────────────────────

function pad(n: number, len: number): string {
  return String(n).padStart(len, "0");
}

function tleChecksum(line: string): number {
  let sum = 0;
  for (const ch of line.slice(0, 68)) {
    if (ch >= "0" && ch <= "9") sum += Number(ch);
    else if (ch === "-") sum += 1;
  }
  return sum % 10;
}

function formatEccentricity(e: number): string {
  // TLE format: implicit leading 0., 7 digits
  const s = Math.max(0, Math.min(0.9999999, e)).toFixed(7).slice(2);
  return s.padEnd(7, "0");
}

function synthesizeTLE(s: SatRow, now: Date): [string, string] {
  // Epoch: YYDDD.DDDDDDDD — year (2-digit) + day of year (with fraction)
  const year = now.getUTCFullYear();
  const startOfYear = Date.UTC(year, 0, 1);
  const dayOfYear =
    (now.getTime() - startOfYear) / 86_400_000 + 1;
  const epochStr =
    String(year).slice(-2) + dayOfYear.toFixed(8).padStart(12, "0");

  const noradStr = pad(s.noradId, 5);
  const intlDesig = "24001A  "; // 8 chars

  // Line 1: 1 NNNNNU LLLLLLLL EEEEE.EEEEEEEE  .00000000  00000-0  00000-0 0  0000
  let l1 =
    "1 " +
    noradStr +
    "U " +
    intlDesig +
    " " +
    epochStr +
    " " +
    " .00000000" + // mean motion dot (first derivative)
    " " +
    " 00000-0" + // mean motion ddot
    " " +
    " 00000-0" + // bstar
    " 0" + // ephemeris type
    " " +
    " 999"; // element set number
  l1 = l1.padEnd(68, " ");
  l1 = l1.slice(0, 68) + String(tleChecksum(l1));

  // Line 2: 2 NNNNN III.IIII RRR.RRRR EEEEEEE AAA.AAAA MMM.MMMM NN.NNNNNNNNRRRRR
  const incStr = s.inclination.toFixed(4).padStart(8, " ");
  const raan = "  0.0000";
  const eccStr = formatEccentricity(s.eccentricity);
  const argPerigee = "  0.0000";
  const meanAnom = ((s.noradId * 137) % 360).toFixed(4).padStart(8, " "); // spread satellites around orbit
  const meanMotionStr = s.meanMotion.toFixed(8).padStart(11, " ");
  const revNum = "    0";

  let l2 =
    "2 " +
    noradStr +
    " " +
    incStr +
    " " +
    raan +
    " " +
    eccStr +
    " " +
    argPerigee +
    " " +
    meanAnom +
    " " +
    meanMotionStr +
    revNum;
  l2 = l2.padEnd(68, " ");
  l2 = l2.slice(0, 68) + String(tleChecksum(l2));

  return [l1, l2];
}

// ─── Main ────────────────────────────────────────────────────────────────────

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export async function seedConjunctions(db: any, opts: SeedConjunctionsOpts = {}) {
  const windowDays = opts.windowDays ?? 7;
  const stepSeconds = opts.stepSeconds ?? 300;
  const thresholdKm = opts.thresholdKm ?? 50;
  const maxPerRegime = opts.maxPerRegime ?? 100;
  const logIntervalMs = opts.logIntervalMs ?? 30_000;

  const t0 = Date.now();

  const rows = await db.execute(sql`
    SELECT id, name, telemetry_summary
    FROM satellite
    WHERE telemetry_summary IS NOT NULL
      AND telemetry_summary ? 'noradId'
      AND telemetry_summary ? 'meanMotion'
      AND telemetry_summary ? 'inclination'
      AND telemetry_summary ? 'eccentricity'
      AND telemetry_summary ? 'regime'
  `);

  const allSats: SatRow[] = [];
  for (const r of rows.rows as Array<Record<string, unknown>>) {
    const ts = r.telemetry_summary as Record<string, unknown>;
    allSats.push({
      id: BigInt(r.id as string | number),
      name: r.name as string,
      noradId: Number(ts.noradId),
      meanMotion: Number(ts.meanMotion),
      inclination: Number(ts.inclination),
      eccentricity: Number(ts.eccentricity),
      regime: String(ts.regime),
      tleLine1: ts.tleLine1 as string | undefined,
      tleLine2: ts.tleLine2 as string | undefined,
    });
  }

  console.log(`[conj] loaded ${allSats.length} satellites`);

  // Group by regime
  const byRegime = new Map<string, SatRow[]>();
  for (const s of allSats) {
    const arr = byRegime.get(s.regime) ?? [];
    arr.push(s);
    byRegime.set(s.regime, arr);
  }

  // Build satrecs (synthesize TLE if not stored)
  const now = new Date();
  const endTime = new Date(now.getTime() + windowDays * 86_400_000);
  const stepMs = stepSeconds * 1000;
  const nSteps = Math.floor((endTime.getTime() - now.getTime()) / stepMs);

  interface Pair {
    a: SatRow;
    b: SatRow;
    minRange: number;
    minIdx: number;
    relVel: number;
  }
  const candidates: Pair[] = [];

  let totalPairsTested = 0;
  let lastLog = Date.now();

  for (const [regime, sats] of byRegime) {
    // Deterministic subsample: keep first maxPerRegime after a spread-pick
    let regimeSats = sats;
    if (sats.length > maxPerRegime) {
      const stride = sats.length / maxPerRegime;
      regimeSats = [];
      for (let i = 0; i < maxPerRegime; i++) {
        regimeSats.push(sats[Math.floor(i * stride)]);
      }
    }

    // Build satrecs
    const satrecs: Array<{ rec: any; sat: SatRow } | null> = [];
    for (const s of regimeSats) {
      const [l1, l2] =
        s.tleLine1 && s.tleLine2
          ? [s.tleLine1, s.tleLine2]
          : synthesizeTLE(s, now);
      try {
        const rec = satellite.twoline2satrec(l1, l2);
        if (rec.error) {
          satrecs.push(null);
          continue;
        }
        satrecs.push({ rec, sat: s });
      } catch {
        satrecs.push(null);
      }
    }

    // Pre-propagate positions & velocities for all sats at every step
    // positions[satIdx][stepIdx] = {x,y,z} in km
    const positions: Array<Array<{ x: number; y: number; z: number } | null>> = [];
    const velocities: Array<Array<{ x: number; y: number; z: number } | null>> = [];
    for (let i = 0; i < satrecs.length; i++) {
      positions.push(new Array(nSteps));
      velocities.push(new Array(nSteps));
    }

    for (let step = 0; step < nSteps; step++) {
      const t = new Date(now.getTime() + step * stepMs);
      for (let i = 0; i < satrecs.length; i++) {
        const entry = satrecs[i];
        if (!entry) {
          positions[i][step] = null;
          velocities[i][step] = null;
          continue;
        }
        const pv = satellite.propagate(entry.rec, t);
        if (pv && pv.position && typeof pv.position !== "boolean") {
          positions[i][step] = pv.position;
          velocities[i][step] =
            pv.velocity && typeof pv.velocity !== "boolean"
              ? pv.velocity
              : null;
        } else {
          positions[i][step] = null;
          velocities[i][step] = null;
        }
      }
    }

    // Pair screening
    const n = satrecs.length;
    let regimePairs = 0;
    let regimeCandidates = 0;
    const thresholdSq = thresholdKm * thresholdKm;

    for (let i = 0; i < n; i++) {
      const ei = satrecs[i];
      if (!ei) continue;
      for (let j = i + 1; j < n; j++) {
        const ej = satrecs[j];
        if (!ej) continue;
        // Skip same-noradId duplicates (same object re-seeded with different DB ids)
        if (ei.sat.noradId === ej.sat.noradId) continue;
        regimePairs++;
        totalPairsTested++;

        let minSq = Infinity;
        let minStep = -1;
        for (let step = 0; step < nSteps; step++) {
          const pi = positions[i][step];
          const pj = positions[j][step];
          if (!pi || !pj) continue;
          const dx = pi.x - pj.x;
          const dy = pi.y - pj.y;
          const dz = pi.z - pj.z;
          const d2 = dx * dx + dy * dy + dz * dz;
          if (d2 < minSq) {
            minSq = d2;
            minStep = step;
          }
        }

        if (minStep >= 0 && minSq < thresholdSq) {
          const minRange = Math.sqrt(minSq);
          const vi = velocities[i][minStep];
          const vj = velocities[j][minStep];
          let relVel = 0;
          if (vi && vj) {
            const vx = vi.x - vj.x;
            const vy = vi.y - vj.y;
            const vz = vi.z - vj.z;
            relVel = Math.sqrt(vx * vx + vy * vy + vz * vz);
          }
          if (minRange <= 0 || relVel <= 0) continue;
          candidates.push({
            a: ei.sat,
            b: ej.sat,
            minRange,
            minIdx: minStep,
            relVel,
          });
          regimeCandidates++;
        }

        if (Date.now() - lastLog > logIntervalMs) {
          console.log(
            `[conj] regime=${regime} pairs=${regimePairs} tested, candidates=${regimeCandidates} so far (total tested=${totalPairsTested})`,
          );
          lastLog = Date.now();
        }
      }
    }

    console.log(
      `[conj] regime=${regime} done: sats=${n} pairs=${regimePairs} candidates=${regimeCandidates}`,
    );
  }

  console.log(
    `[conj] screening done in ${((Date.now() - t0) / 1000).toFixed(1)}s: ${candidates.length} candidates`,
  );

  // Insert
  const hardBodyRadiusM = 20; // ≈ 10 m per object, summed
  const HBR_km = hardBodyRadiusM / 1000;
  let inserted = 0;
  for (const c of candidates) {
    const epoch = new Date(now.getTime() + c.minIdx * stepMs);

    // Propagation days from "now" to TCA
    const propagationDays = Math.max(
      0,
      (epoch.getTime() - now.getTime()) / 86_400_000,
    );

    // Per-object σ (regime-conditioned). Each object carries its own σ;
    // combined σ is the RSS of the two.
    const primarySigmaKm = sigmaKmFor(c.a.regime, 0, propagationDays);
    const secondarySigmaKm = sigmaKmFor(c.b.regime, 0, propagationDays);
    const combinedSigmaKm = Math.sqrt(
      primarySigmaKm * primarySigmaKm +
        secondarySigmaKm * secondarySigmaKm,
    );

    // Foster-style 1D gaussian miss-distance Pc
    const two_s2 = 2 * combinedSigmaKm * combinedSigmaKm;
    let pc =
      ((HBR_km * HBR_km) / two_s2) *
      Math.exp(-(c.minRange * c.minRange) / two_s2);
    // Clamp to a physically reasonable range
    pc = Math.min(0.5, Math.max(1e-12, pc));

    // Ensure primary < secondary for stable unique key
    const [p, s, pSigma, sSigma] =
      c.a.id < c.b.id
        ? [c.a, c.b, primarySigmaKm, secondarySigmaKm]
        : [c.b, c.a, secondarySigmaKm, primarySigmaKm];

    try {
      await db
        .insert(conjunctionEvent)
        .values({
          primarySatelliteId: p.id,
          secondarySatelliteId: s.id,
          epoch,
          minRangeKm: c.minRange,
          relativeVelocityKmps: c.relVel || null,
          probabilityOfCollision: pc,
          primarySigmaKm: pSigma,
          secondarySigmaKm: sSigma,
          combinedSigmaKm,
          hardBodyRadiusM,
          pcMethod: "foster-gaussian-1d",
          metadata: {
            regime: c.a.regime,
            stepSeconds,
            windowDays,
            synth: !(c.a.tleLine1 && c.a.tleLine2),
            propagationDays,
          },
        })
        .onConflictDoNothing();
      inserted++;
    } catch (err) {
      console.warn("[conj] insert failed:", (err as Error).message);
    }
  }

  console.log(`[conj] inserted ${inserted} conjunction_event rows`);
  return { screened: totalPairsTested, candidates: candidates.length, inserted };
}
