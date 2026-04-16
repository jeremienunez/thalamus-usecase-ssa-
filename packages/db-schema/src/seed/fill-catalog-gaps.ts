#!/usr/bin/env tsx
/**
 * Fill catalog gaps — populate the 3 columns that the nullScan sweep finds
 * missing on 100% of satellites:
 *   - g_orbit_regime_description (LEO / MEO / GEO / HEO / SSO / GTO)
 *   - classification_tier        (unclassified / sensitive / restricted)
 *   - is_experimental            (boolean, based on mass/bus/name heuristics)
 *
 * Deterministic. Idempotent. Only writes rows where the value is NULL —
 * reviewer-confirmed overrides stay intact.
 *
 * Sources of truth:
 *   - regime: orbital elements already in satellite (mean_motion,
 *     eccentricity, inclination_deg)
 *   - classification: operator name + country heuristic (military / gov →
 *     restricted, dual-use keywords → sensitive, rest → unclassified)
 *   - experimental: mass < 10kg (cubesat-class), bus names containing
 *     TESTBED/DEMOSAT/PATHFINDER, or name starting with CUBE/EXP
 */

import { Pool } from "pg";

const DATABASE_URL =
  process.env.DATABASE_URL ??
  "postgres://thalamus:thalamus@localhost:5433/thalamus";

type Row = {
  id: string;
  name: string | null;
  mass_kg: number | null;
  mean_motion: number | null;
  eccentricity: number | null;
  inclination_deg: number | null;
  operator_name: string | null;
  operator_country_name: string | null;
  platform_name: string | null;
};

// ─── Regime classifier ────────────────────────────────────────────────
function classifyRegime(row: Row): string | null {
  const mm = row.mean_motion;
  const ecc = row.eccentricity;
  const inc = row.inclination_deg;
  if (mm == null) return null;

  // HEO — high eccentricity before anything else
  if (ecc != null && ecc > 0.25) {
    // GTO = high ecc + apogee near GEO → mm roughly 2 rev/day
    if (mm > 1.5 && mm < 4) return "GTO";
    return "HEO";
  }

  // GEO / GSO: ~1 rev/day (0.9–1.1)
  if (mm > 0.9 && mm < 1.1) return "GEO";

  // MEO: 2 < mm < 6 (GPS ≈ 2, GLONASS ≈ 2.1, Galileo ≈ 1.7, BeiDou MEO ≈ 1.9)
  if (mm >= 1.1 && mm < 6) return "MEO";

  // LEO family (mm ≥ 6 rev/day → period < 240min → alt < ~4000km)
  if (mm >= 6) {
    // SSO: LEO with inclination ~96–104°
    if (inc != null && inc >= 96 && inc <= 104) return "SSO";
    return "LEO";
  }

  return null;
}

// ─── Classification tier classifier ───────────────────────────────────
const MILITARY_KEYWORDS = [
  "usaf", "ussf", "u.s. space force", "space force",
  "navy", "dod", "department of defense",
  "nro", "national reconnaissance",
  "mod ", "ministry of defense",
  "plaaf", "pla ", "people's liberation",
  "vks ", "russian military", "russian space forces",
  "bundeswehr",
  "dga", "cnes military", "cmsa",
];

const DUAL_USE_KEYWORDS = [
  "nasa", "esa", "jaxa", "dlr", "cnes", "roscosmos", "isro", "asi",
  "noaa", "nrl", "dbl",
  "raytheon", "lockheed", "northrop", "boeing defense",
  "thales alenia", "airbus defence",
  "digitalglobe", "maxar",
];

function classifyTier(row: Row): "restricted" | "sensitive" | "unclassified" {
  const op = (row.operator_name ?? "").toLowerCase();
  const oc = (row.operator_country_name ?? "").toLowerCase();
  const name = (row.name ?? "").toLowerCase();
  const platform = (row.platform_name ?? "").toLowerCase();

  // Explicit military operators
  for (const k of MILITARY_KEYWORDS) {
    if (op.includes(k) || name.includes(k)) return "restricted";
  }
  // Platform-class signals
  if (platform === "sigint" || platform === "military") return "restricted";

  // Dual-use government / defence-adjacent
  for (const k of DUAL_USE_KEYWORDS) {
    if (op.includes(k)) return "sensitive";
  }
  if (platform === "earth_observation" || platform === "navigation") {
    // Govt-operated EO/nav is sensitive; commercial EO already falls under duals above
    if (oc && oc !== "other / unknown" && oc !== "commercial") return "sensitive";
  }

  return "unclassified";
}

// ─── Experimental classifier ──────────────────────────────────────────
const EXPERIMENTAL_NAME_HINTS = [
  "cube", "exp", "demo", "testbed", "pathfinder", "techdemo", "sat-sim",
  "student", "university", "school",
];

function classifyExperimental(row: Row): boolean {
  const mass = row.mass_kg ?? 0;
  const name = (row.name ?? "").toLowerCase();
  const platform = (row.platform_name ?? "").toLowerCase();

  // CubeSat-class mass
  if (mass > 0 && mass < 10) return true;
  // Bus/platform signals
  if (platform.includes("cubesat") || platform.includes("smallsat")) return true;
  // Name patterns
  for (const k of EXPERIMENTAL_NAME_HINTS) {
    if (name.includes(k)) return true;
  }
  return false;
}

// ─── Driver ──────────────────────────────────────────────────────────
async function main(): Promise<void> {
  const pool = new Pool({ connectionString: DATABASE_URL });
  const client = await pool.connect();
  try {
    console.log("→ loading satellites with context…");
    const { rows } = await client.query<Row>(`
      SELECT
        s.id::text                                                   AS id,
        s.name                                                       AS name,
        s.mass_kg                                                    AS mass_kg,
        NULLIF(s.telemetry_summary->>'meanMotion','')::float         AS mean_motion,
        NULLIF(s.telemetry_summary->>'eccentricity','')::float       AS eccentricity,
        COALESCE(
          NULLIF(s.telemetry_summary->>'inclinationDeg','')::float,
          NULLIF(s.telemetry_summary->>'inclination','')::float
        )                                                            AS inclination_deg,
        op.name                                                      AS operator_name,
        oc.name                                                      AS operator_country_name,
        pc.name                                                      AS platform_name
      FROM satellite s
      LEFT JOIN operator op         ON op.id = s.operator_id
      LEFT JOIN operator_country oc ON oc.id = s.operator_country_id
      LEFT JOIN platform_class pc   ON pc.id = s.platform_class_id
    `);
    console.log(`  ${rows.length} satellites`);

    let regimeUpdates = 0;
    let tierUpdates = 0;
    let expUpdates = 0;

    await client.query("BEGIN");

    for (const row of rows) {
      const regime = classifyRegime(row);
      const tier = classifyTier(row);
      const exp = classifyExperimental(row);

      const r = await client.query(
        `
        UPDATE satellite SET
          g_orbit_regime_description = COALESCE(g_orbit_regime_description, $2),
          classification_tier        = COALESCE(classification_tier, $3),
          is_experimental            = COALESCE(is_experimental, $4)
        WHERE id = $1::bigint
        RETURNING
          (g_orbit_regime_description = $2) AS r_set,
          (classification_tier = $3)        AS t_set,
          (is_experimental = $4)            AS e_set
        `,
        [row.id, regime, tier, exp],
      );
      const upd = r.rows[0];
      if (upd?.r_set && regime) regimeUpdates++;
      if (upd?.t_set) tierUpdates++;
      if (upd?.e_set) expUpdates++;
    }

    await client.query("COMMIT");
    console.log(`✓ regime set on      ${regimeUpdates} sats`);
    console.log(`✓ classification on  ${tierUpdates} sats`);
    console.log(`✓ experimental on    ${expUpdates} sats`);

    // Summary by value
    const byRegime = await client.query(`
      SELECT g_orbit_regime_description AS regime, count(*)::int AS n
      FROM satellite WHERE g_orbit_regime_description IS NOT NULL
      GROUP BY regime ORDER BY n DESC
    `);
    const byTier = await client.query(`
      SELECT classification_tier AS tier, count(*)::int AS n
      FROM satellite WHERE classification_tier IS NOT NULL
      GROUP BY tier ORDER BY n DESC
    `);
    const byExp = await client.query(`
      SELECT is_experimental AS experimental, count(*)::int AS n
      FROM satellite WHERE is_experimental IS NOT NULL
      GROUP BY experimental ORDER BY n DESC
    `);
    console.log("\nregime distribution :", byRegime.rows);
    console.log("tier distribution   :", byTier.rows);
    console.log("experimental        :", byExp.rows);
  } catch (err) {
    await client.query("ROLLBACK").catch(() => {});
    throw err;
  } finally {
    client.release();
    await pool.end();
  }
}

main().catch((err) => {
  console.error("✗ fill-catalog-gaps failed:", err);
  process.exit(1);
});
