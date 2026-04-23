#!/usr/bin/env tsx
/**
 * Regime-level baselines from real GCAT observables.
 *
 * We do NOT synthesize operator telemetry (power draw, thermal margin,
 * attitude rate, etc.) — those are operator-private, not publicly
 * observable, and any synthetic value would be a hallucination.
 *
 * Instead, baselines here are built from quantities that ARE publicly
 * observable and citable:
 *
 *   - weekly_launches_26w  — from GCAT LDate, grouped by regime
 *   - weekly_decays_26w    — from GCAT DDate, grouped by regime
 *   - active_count         — from GCAT Status (active objects only)
 *   - weekly_conjunctions_26w — from conjunction_event (our own screening)
 *
 * Each metric is stored as `{ mean, std, samples, windowWeeks, source }`
 * with a literal source tag so downstream findings can cite provenance.
 *
 * Source: https://planet4589.org/space/gcat/ (CC-BY, Jonathan McDowell).
 * Local cache: /tmp/gcat.tsv.
 */

import { readFileSync } from "node:fs";
import { pathToFileURL } from "node:url";
import { Pool } from "pg";
import { drizzle } from "drizzle-orm/node-postgres";
import { sql } from "drizzle-orm";

const DATABASE_URL =
  process.env.DATABASE_URL ??
  "postgres://thalamus:thalamus@localhost:5433/thalamus";

const GCAT_CACHE = "/tmp/gcat.tsv";

/** GCAT column layout (tab-separated). */
const COL = {
  SATCAT: 1,
  LAUNCH_DATE: 7,
  DECAY_DATE: 11,
  STATUS: 12,
  PERIGEE_KM: 33,
  APOGEE_KM: 35,
  INCLINATION_DEG: 37,
};

type Regime = "leo" | "meo" | "geo" | "heo" | "sso" | "gto";

const REGIME_LONG_NAME: Record<Regime, string> = {
  leo: "Low Earth Orbit",
  meo: "Medium Earth Orbit",
  geo: "Geostationary Orbit",
  heo: "Highly Elliptical Orbit",
  sso: "Sun-Synchronous Orbit",
  gto: "Geostationary Transfer Orbit",
};

/**
 * Classify a regime from perigee / apogee / inclination (km, deg).
 * Deliberately simple — matches the seed-time classification convention.
 */
export function classify(
  perigee: number,
  apogee: number,
  inc: number,
): Regime | null {
  if (!Number.isFinite(perigee) || !Number.isFinite(apogee)) return null;
  const avg = (perigee + apogee) / 2;
  const e = (apogee - perigee) / (apogee + perigee + 1e-9);
  if (e > 0.2) {
    if (apogee > 20_000) return "heo";
    return "gto";
  }
  if (avg >= 34_000 && avg <= 37_000) return "geo";
  if (avg >= 2_000 && avg < 34_000) return "meo";
  if (avg < 2_000) {
    // Sun-synchronous: near-polar, inclination ~97-99°, altitude 500-850 km.
    if (inc >= 96 && inc <= 100 && avg >= 400 && avg <= 900) return "sso";
    return "leo";
  }
  return null;
}

/** Parse a GCAT date string like "2024 Jan 15" → timestamp ms, or null. */
export function parseGcatDate(s: string | undefined): number | null {
  if (!s) return null;
  const trimmed = s.trim().replace(/\?$/, "");
  if (!trimmed || trimmed === "-") return null;
  // Keep only the YYYY Mon DD prefix (GCAT sometimes appends HH:MM).
  const m = trimmed.match(
    /^(\d{4})\s+([A-Z][a-z]{2})(?:\s+(\d{1,2}))?/,
  );
  if (!m) return null;
  const [, year, mon, day] = m;
  const d = new Date(`${mon} ${day ?? "1"}, ${year}`);
  const t = d.getTime();
  return Number.isFinite(t) ? t : null;
}

interface SatelliteLifeEvent {
  regime: Regime;
  launched: number | null;
  decayed: number | null;
  active: boolean;
}

function loadGcat(): SatelliteLifeEvent[] {
  const buffer = readFileSync(GCAT_CACHE, "utf8");
  const out: SatelliteLifeEvent[] = [];
  for (const line of buffer.split("\n")) {
    if (!line || line.startsWith("#")) continue;
    const cols = line.split("\t");
    if (cols.length < 40) continue;

    const perigee = Number(cols[COL.PERIGEE_KM]?.trim());
    const apogee = Number(cols[COL.APOGEE_KM]?.trim());
    const inc = Number(cols[COL.INCLINATION_DEG]?.trim());
    const regime = classify(perigee, apogee, inc);
    if (!regime) continue;

    const launched = parseGcatDate(cols[COL.LAUNCH_DATE]);
    const decayed = parseGcatDate(cols[COL.DECAY_DATE]);
    const status = cols[COL.STATUS]?.trim() ?? "";
    // GCAT status codes: "O"=operational, "D"=decayed, "?"=unknown, etc.
    // An object is "active" if launched, not decayed, and not marked dead.
    const active =
      launched != null && decayed == null && status !== "D" && status !== "E";

    out.push({ regime, launched, decayed, active });
  }
  return out;
}

export function weeklyCounts(
  timestamps: Array<number | null>,
  windowWeeks: number,
  now: number,
): number[] {
  const weekMs = 7 * 24 * 3_600_000;
  const buckets = new Array<number>(windowWeeks).fill(0);
  const cutoff = now - windowWeeks * weekMs;
  for (const t of timestamps) {
    if (t == null || t < cutoff || t > now) continue;
    const idx = Math.min(
      windowWeeks - 1,
      Math.floor((t - cutoff) / weekMs),
    );
    if (idx >= 0 && idx < windowWeeks) buckets[idx]!++;
  }
  return buckets;
}

export function meanStd(xs: number[]): { mean: number; std: number; samples: number } {
  if (xs.length === 0) return { mean: 0, std: 0, samples: 0 };
  const mean = xs.reduce((s, v) => s + v, 0) / xs.length;
  const variance = xs.reduce((s, v) => s + (v - mean) ** 2, 0) / xs.length;
  return {
    mean: Number(mean.toFixed(3)),
    std: Number(Math.sqrt(variance).toFixed(3)),
    samples: xs.length,
  };
}

async function main(): Promise<void> {
  console.log(`▸ connecting to ${DATABASE_URL.replace(/\/\/[^@]+@/, "//***@")}`);
  const pool = new Pool({ connectionString: DATABASE_URL });
  const db = drizzle(pool);

  console.log("▸ ensuring orbit_regime.baselines column");
  await db.execute(
    sql`ALTER TABLE orbit_regime ADD COLUMN IF NOT EXISTS baselines jsonb`,
  );

  console.log("▸ parsing GCAT from /tmp/gcat.tsv");
  const events = loadGcat();
  console.log(`▸ classified ${events.length} GCAT rows into regimes`);

  // Regime id lookup
  const regimeRows = await db.execute(sql`SELECT id, name FROM orbit_regime`);
  const idByName = new Map(
    (regimeRows.rows as Array<{ id: string; name: string }>).map((r) => [
      r.name.toLowerCase(),
      BigInt(r.id),
    ]),
  );

  // Conjunction counts from our own DB screening
  const conjRows = await db.execute(sql`
    SELECT metadata->>'regime' AS regime, computed_at
    FROM conjunction_event
    WHERE computed_at IS NOT NULL
  `);
  const conjEvents = (conjRows.rows as Array<{
    regime: string | null;
    computed_at: string;
  }>).map((r) => ({
    regime: (r.regime ?? "").toLowerCase(),
    t: new Date(r.computed_at).getTime(),
  }));

  const now = Date.now();
  const WINDOW = 26;

  const regimeSummary: Record<string, number> = {};
  for (const regime of Object.keys(REGIME_LONG_NAME) as Regime[]) {
    const scoped = events.filter((e) => e.regime === regime);
    regimeSummary[regime] = scoped.length;

    const launches = scoped.map((e) => e.launched);
    const decays = scoped.map((e) => e.decayed);
    const activeCount = scoped.filter((e) => e.active).length;
    const conjs = conjEvents
      .filter((c) => c.regime === regime)
      .map((c) => c.t);

    const launchWeekly = weeklyCounts(launches, WINDOW, now);
    const decayWeekly = weeklyCounts(decays, WINDOW, now);
    const conjWeekly = weeklyCounts(conjs, WINDOW, now);

    const baselines = {
      weekly_launches_26w: {
        ...meanStd(launchWeekly),
        windowWeeks: WINDOW,
        source: "GCAT LDate (planet4589.org/space/gcat, CC-BY)",
      },
      weekly_decays_26w: {
        ...meanStd(decayWeekly),
        windowWeeks: WINDOW,
        source: "GCAT DDate (planet4589.org/space/gcat, CC-BY)",
      },
      weekly_conjunctions_26w: {
        ...meanStd(conjWeekly),
        windowWeeks: WINDOW,
        source: "conjunction_event (SGP4 screening, threshold 5km)",
      },
      active_count: {
        mean: activeCount,
        std: 0,
        samples: scoped.length,
        windowWeeks: 0,
        source: "GCAT Status (planet4589.org/space/gcat, CC-BY)",
      },
    };

    const regimeId = idByName.get(REGIME_LONG_NAME[regime].toLowerCase());
    if (!regimeId) {
      console.warn(`  ⚠ regime '${regime}' missing from orbit_regime`);
      continue;
    }

    await db.execute(sql`
      UPDATE orbit_regime
      SET baselines = ${JSON.stringify(baselines)}::jsonb
      WHERE id = ${regimeId}
    `);

    console.log(
      `  ✓ ${regime}: ${scoped.length} GCAT objects | launches μ=${baselines.weekly_launches_26w.mean} σ=${baselines.weekly_launches_26w.std} | decays μ=${baselines.weekly_decays_26w.mean} σ=${baselines.weekly_decays_26w.std} | active ${activeCount}`,
    );
  }

  console.log("✓ baselines seeded from real GCAT observables");
  await pool.end();
}

const isDirectRun =
  process.argv[1] != null &&
  import.meta.url === pathToFileURL(process.argv[1]).href;

if (isDirectRun) {
  main().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}
