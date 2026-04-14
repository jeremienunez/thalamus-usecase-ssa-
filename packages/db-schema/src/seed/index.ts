#!/usr/bin/env tsx
/**
 * Seed — bootstrap a demonstrable SSA catalog from public CelesTrak TLE data.
 *
 *   orbit_regime  ← 6 bands (LEO/MEO/GEO/HEO/SSO/GTO) derived from mean motion
 *   platform_class ← 6 categories (comms, EO, navigation, SIGINT, science, military)
 *   operator_country ← ~25 agencies seeded from a static list
 *   operator      ← ~40 major operators (SpaceX, ESA, NASA, …)
 *   satellite     ← ~500 real birds from CelesTrak active TLE feed
 *
 * Source: https://celestrak.org/NORAD/elements/gp.php?GROUP=active&FORMAT=tle
 * (public domain, no auth, rate-limited). Orbit regime classification is derived
 * from SGP4 mean motion (rev/day) — see `classifyRegime`.
 *
 * Idempotent: upserts on `slug` for reference tables, `name` for satellites
 * (CelesTrak international designator would be cleaner, not modeled yet).
 */

import { Pool } from "pg";
import { drizzle } from "drizzle-orm/node-postgres";
import { sql } from "drizzle-orm";
import {
  orbitRegime,
  platformClass,
  operatorCountry,
  operator,
  satellite,
  type NewSatellite,
} from "../schema";
import { seedSources } from "./sources";
import { seedConjunctions } from "./conjunctions";

const DATABASE_URL =
  process.env.DATABASE_URL ??
  "postgres://thalamus:thalamus@localhost:5433/thalamus";

const CELESTRAK_URL =
  process.env.CELESTRAK_URL ??
  "https://celestrak.org/NORAD/elements/gp.php?GROUP=active&FORMAT=tle";

const SEED_COUNT = Number(process.env.SEED_COUNT ?? 500);

// ─── Reference data ──────────────────────────────────────────────────────────

const ORBIT_REGIMES = [
  { slug: "leo", name: "Low Earth Orbit", band: "200–2000 km" },
  { slug: "meo", name: "Medium Earth Orbit", band: "2000–35786 km" },
  { slug: "geo", name: "Geostationary Orbit", band: "~35786 km" },
  { slug: "heo", name: "Highly Elliptical Orbit", band: "variable" },
  { slug: "sso", name: "Sun-Synchronous Orbit", band: "600–800 km polar" },
  { slug: "gto", name: "Geostationary Transfer Orbit", band: "200×35786 km" },
] as const;

const PLATFORM_CLASSES = [
  "communications",
  "earth_observation",
  "navigation",
  "sigint",
  "science",
  "military",
] as const;

const OPERATOR_COUNTRIES = [
  { slug: "us", name: "United States" },
  { slug: "ru", name: "Russia" },
  { slug: "cn", name: "China" },
  { slug: "in", name: "India" },
  { slug: "jp", name: "Japan" },
  { slug: "eu", name: "European Space Agency" },
  { slug: "fr", name: "France (CNES)" },
  { slug: "de", name: "Germany (DLR)" },
  { slug: "uk", name: "United Kingdom" },
  { slug: "kr", name: "South Korea" },
  { slug: "br", name: "Brazil" },
  { slug: "ca", name: "Canada (CSA)" },
  { slug: "il", name: "Israel" },
  { slug: "other", name: "Other / Unknown" },
] as const;

const OPERATORS = [
  { slug: "spacex", name: "SpaceX" },
  { slug: "nasa", name: "NASA" },
  { slug: "esa", name: "European Space Agency" },
  { slug: "roscosmos", name: "Roscosmos" },
  { slug: "cnsa", name: "China National Space Administration" },
  { slug: "isro", name: "Indian Space Research Organisation" },
  { slug: "jaxa", name: "Japan Aerospace Exploration Agency" },
  { slug: "ula", name: "United Launch Alliance" },
  { slug: "arianespace", name: "Arianespace" },
  { slug: "planet", name: "Planet Labs" },
  { slug: "iridium", name: "Iridium" },
  { slug: "oneweb", name: "OneWeb" },
  { slug: "intelsat", name: "Intelsat" },
  { slug: "ses", name: "SES" },
  { slug: "airbus-ds", name: "Airbus Defence and Space" },
  { slug: "thales-alenia", name: "Thales Alenia Space" },
  { slug: "maxar", name: "Maxar Technologies" },
  { slug: "boeing", name: "Boeing" },
  { slug: "lockheed", name: "Lockheed Martin" },
  { slug: "other", name: "Other / Unknown" },
] as const;

// ─── TLE parsing ─────────────────────────────────────────────────────────────

interface Tle {
  name: string;
  noradId: number;
  meanMotion: number; // rev/day (line 2, columns 53-63)
  inclination: number; // deg (line 2, columns 9-16)
  eccentricity: number; // 0.x (line 2, columns 27-33 with implicit decimal)
  launchYear: number | null;
  line1: string;
  line2: string;
}

function parseTleBlock(name: string, l1: string, l2: string): Tle | null {
  try {
    const noradId = Number(l1.slice(2, 7).trim());
    if (!Number.isFinite(noradId)) return null;
    const intlDesig = l1.slice(9, 17).trim();
    const launchYearTwoDigit = Number(intlDesig.slice(0, 2));
    const launchYear = Number.isFinite(launchYearTwoDigit)
      ? launchYearTwoDigit < 57
        ? 2000 + launchYearTwoDigit
        : 1900 + launchYearTwoDigit
      : null;
    const inclination = Number(l2.slice(8, 16).trim());
    const eccStr = l2.slice(26, 33).trim();
    const eccentricity = Number("0." + eccStr);
    const meanMotion = Number(l2.slice(52, 63).trim());
    if (![inclination, eccentricity, meanMotion].every(Number.isFinite))
      return null;
    return { name: name.trim(), noradId, meanMotion, inclination, eccentricity, launchYear, line1: l1, line2: l2 };
  } catch {
    return null;
  }
}

function classifyRegime(t: Tle): (typeof ORBIT_REGIMES)[number]["slug"] {
  // Period (min) = 1440 / meanMotion
  const periodMin = 1440 / t.meanMotion;
  if (t.eccentricity > 0.25 && periodMin < 1000) return "gto";
  if (t.eccentricity > 0.25) return "heo";
  if (periodMin > 1400 && periodMin < 1480) return "geo";
  if (periodMin > 600 && periodMin < 800) return "meo";
  if (t.inclination > 95 && t.inclination < 105 && periodMin < 110) return "sso";
  return "leo";
}

function guessOperator(satName: string): string {
  const n = satName.toUpperCase();
  if (n.startsWith("STARLINK")) return "spacex";
  if (n.startsWith("ONEWEB")) return "oneweb";
  if (n.startsWith("IRIDIUM")) return "iridium";
  if (n.startsWith("INTELSAT")) return "intelsat";
  if (n.startsWith("PLANET") || n.startsWith("FLOCK") || n.startsWith("DOVE"))
    return "planet";
  if (n.startsWith("ISS")) return "nasa";
  if (n.startsWith("SES")) return "ses";
  return "other";
}

function guessCountry(satName: string, operatorSlug: string): string {
  if (operatorSlug === "spacex" || operatorSlug === "nasa") return "us";
  if (operatorSlug === "esa") return "eu";
  if (operatorSlug === "roscosmos") return "ru";
  if (operatorSlug === "cnsa") return "cn";
  if (operatorSlug === "isro") return "in";
  if (operatorSlug === "jaxa") return "jp";
  if (operatorSlug === "oneweb" || operatorSlug === "airbus-ds") return "eu";
  if (operatorSlug === "intelsat" || operatorSlug === "iridium") return "us";
  if (operatorSlug === "ses") return "eu";
  return "other";
}

function toSlug(s: string) {
  return s.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
}

// ─── Run ─────────────────────────────────────────────────────────────────────

async function main() {
  console.log("▸ connecting to", DATABASE_URL);
  const pool = new Pool({ connectionString: DATABASE_URL });
  const db = drizzle(pool);

  console.log("▸ fetching TLE from", CELESTRAK_URL);
  const res = await fetch(CELESTRAK_URL);
  if (!res.ok)
    throw new Error(`CelesTrak fetch failed: ${res.status} ${res.statusText}`);
  const text = await res.text();

  const lines = text.split(/\r?\n/).filter((l) => l.length > 0);
  const tles: Tle[] = [];
  for (let i = 0; i + 2 < lines.length; i += 3) {
    const tle = parseTleBlock(lines[i], lines[i + 1], lines[i + 2]);
    if (tle) tles.push(tle);
    if (tles.length >= SEED_COUNT) break;
  }
  console.log(`▸ parsed ${tles.length} TLEs`);

  // Reference tables ---------------------------------------------------------
  console.log("▸ seeding orbit_regime");
  for (const r of ORBIT_REGIMES) {
    await db
      .insert(orbitRegime)
      .values({ name: r.name, altitudeBand: r.band })
      .onConflictDoNothing();
  }

  console.log("▸ seeding platform_class");
  for (const c of PLATFORM_CLASSES) {
    await db.insert(platformClass).values({ name: c }).onConflictDoNothing();
  }

  console.log("▸ seeding operator_country");
  for (const c of OPERATOR_COUNTRIES) {
    await db
      .insert(operatorCountry)
      .values({ name: c.name, slug: c.slug })
      .onConflictDoNothing();
  }

  console.log("▸ seeding operator");
  for (const o of OPERATORS) {
    await db
      .insert(operator)
      .values({ name: o.name, slug: o.slug })
      .onConflictDoNothing();
  }

  // Lookup maps --------------------------------------------------------------
  const regimeRows = await db.select().from(orbitRegime);
  const countryRows = await db.select().from(operatorCountry);
  const operatorRows = await db.select().from(operator);

  const regimeByName = new Map(regimeRows.map((r) => [r.name, r.id]));
  const regimeBySlug = new Map(
    ORBIT_REGIMES.map((r) => [r.slug, regimeByName.get(r.name)!]),
  );
  const countryBySlug = new Map(
    countryRows.map((c) => [c.slug, c.id]),
  );
  const operatorBySlug = new Map(
    operatorRows.map((o) => [o.slug, o.id]),
  );

  // Satellites ---------------------------------------------------------------
  console.log(`▸ upserting ${tles.length} satellites`);
  let inserted = 0;
  for (const t of tles) {
    const opSlug = guessOperator(t.name);
    const countrySlug = guessCountry(t.name, opSlug);
    const regimeSlug = classifyRegime(t);

    const row: NewSatellite = {
      name: t.name,
      slug: toSlug(t.name) + "-" + t.noradId,
      launchYear: t.launchYear ?? null,
      operatorCountryId: countryBySlug.get(countrySlug) ?? null,
      operatorId: operatorBySlug.get(opSlug) ?? null,
      telemetrySummary: {
        noradId: t.noradId,
        meanMotion: t.meanMotion,
        inclination: t.inclination,
        eccentricity: t.eccentricity,
        regime: regimeSlug,
        tleLine1: t.line1,
        tleLine2: t.line2,
      },
      metadata: { source: "celestrak:active" },
    };

    try {
      await db.insert(satellite).values(row).onConflictDoNothing();
      inserted++;
    } catch (err) {
      console.warn("  skipped", t.name, "→", (err as Error).message);
    }
  }

  console.log(`✓ inserted/kept ${inserted} satellites`);

  // Quick post-conditions ----------------------------------------------------
  const counts = await db.execute(sql`
    SELECT
      (SELECT count(*)::int FROM satellite) AS satellites,
      (SELECT count(*)::int FROM operator) AS operators,
      (SELECT count(*)::int FROM operator_country) AS countries,
      (SELECT count(*)::int FROM orbit_regime) AS regimes,
      (SELECT count(*)::int FROM platform_class) AS platforms
  `);
  console.log("▸ final counts:", counts.rows[0]);

  // ── Source ingestion ─────────────────────────────────────────────────────
  console.log("▸ seeding sources (RSS / arXiv / NTRS)");
  try {
    const summary = await seedSources(db);
    console.log(
      `✓ sources: ${summary.registered} registered, ${summary.fetched} items fetched, ${summary.failures.length} failures`,
    );
    if (summary.failures.length > 0) {
      for (const f of summary.failures) {
        console.warn(`  - ${f.slug}: ${f.error}`);
      }
    }
  } catch (err) {
    console.warn("⚠ source seeding failed:", (err as Error).message);
  }

  // ── Conjunction screening ───────────────────────────────────────────────
  console.log("▸ screening conjunctions (SGP4)");
  try {
    const result = await seedConjunctions(db);
    console.log(
      `✓ conjunctions: ${result.inserted} inserted from ${result.candidates} candidates (${result.screened} pairs screened)`,
    );
  } catch (err) {
    console.warn("⚠ conjunction seeding failed:", (err as Error).message);
  }

  await pool.end();
  console.log("✓ seed complete");
  // suppress unused warning if helper map never queried downstream in this file
  void regimeBySlug;
}

main().catch((err) => {
  console.error("✗ seed failed:", err);
  process.exit(1);
});
