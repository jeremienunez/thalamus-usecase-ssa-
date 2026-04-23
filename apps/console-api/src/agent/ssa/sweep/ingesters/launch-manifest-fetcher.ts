/**
 * Launch manifest ingester — pulls the next N upcoming launches from
 * Launch Library 2 (https://ll.thespacedevs.com) and upserts into the
 * `launch` table, enriching operator / pad / planned-window / orbit /
 * mission columns.
 *
 * LL2 is a free public aggregator operated by TheSpaceDevs, covering
 * worldwide launches (US, CN, RU, IN, EU, JP). No API key required;
 * generous rate limits. Cadence: every 12 h matches LL2's update
 * frequency without hammering them.
 */

import { and, isNotNull, notIlike, notInArray, or, sql } from "drizzle-orm";
import { launch, type Database, type NewLaunch } from "@interview/db-schema";
import type { IngestionSource, IngestionRunContext } from "@interview/sweep";

interface IngestionResult {
  inserted: number;
  skipped: number;
  notes?: string;
}

const LL2_UPCOMING_URL =
  "https://ll.thespacedevs.com/2.3.0/launches/upcoming/?limit=100&mode=detailed";

const USER_AGENT =
  "thalamus-ssa-ingest/0.1 (interview-project; contact: jerem@interview-project.invalid)";

// ---------------------------------------------------------------------------
// LL2 response types — partial, only fields we persist
// ---------------------------------------------------------------------------

interface Ll2Country {
  alpha_2_code?: string;
  name?: string;
}

interface Ll2Agency {
  name?: string;
  country?: Ll2Country[];
}

interface Ll2Location {
  name?: string;
  country_code?: string;
}

interface Ll2Pad {
  name?: string;
  location?: Ll2Location;
}

interface Ll2Orbit {
  name?: string;
  abbrev?: string;
}

interface Ll2Mission {
  name?: string;
  description?: string;
  orbit?: Ll2Orbit;
}

interface Ll2RocketConfig {
  name?: string;
}

interface Ll2Rocket {
  configuration?: Ll2RocketConfig;
}

interface Ll2Status {
  name?: string;
  abbrev?: string;
}

interface Ll2Launch {
  id?: string;
  name?: string;
  net?: string;
  window_start?: string;
  window_end?: string;
  status?: Ll2Status;
  launch_service_provider?: Ll2Agency;
  rocket?: Ll2Rocket;
  pad?: Ll2Pad;
  mission?: Ll2Mission;
}

interface Ll2Response {
  count?: number;
  results?: Ll2Launch[];
}

// ---------------------------------------------------------------------------
// Mapping
// ---------------------------------------------------------------------------

function parseIsoOrNull(s: string | undefined | null): Date | null {
  if (!s) return null;
  const d = new Date(s);
  return Number.isNaN(d.getTime()) ? null : d;
}

function mapLaunch(r: Ll2Launch, fetchedAt: Date): NewLaunch | null {
  if (!r.id || !r.name) return null;
  const net = parseIsoOrNull(r.net);
  const year = net?.getUTCFullYear() ?? new Date().getUTCFullYear();

  const operator = r.launch_service_provider?.name ?? null;
  const operatorCountry =
    r.launch_service_provider?.country?.[0]?.alpha_2_code ??
    r.launch_service_provider?.country?.[0]?.name ??
    null;

  const padName = r.pad?.name ?? null;
  const padLocation = r.pad?.location?.name ?? null;

  // Heuristic rideshare flag — LL2 doesn't expose this directly, but rideshare
  // missions typically name it in the mission or launch title. False positives
  // here are harmless; the skill can override.
  const title = `${r.name} ${r.mission?.name ?? ""} ${r.mission?.description ?? ""}`.toLowerCase();
  const rideshare =
    title.includes("rideshare") ||
    title.includes("transporter") ||
    title.includes("bandwagon");

  return {
    year,
    name: r.name,
    vehicle: r.rocket?.configuration?.name ?? null,
    externalLaunchId: r.id,
    operatorName: operator,
    operatorCountry,
    padName,
    padLocation,
    plannedNet: net,
    plannedWindowStart: parseIsoOrNull(r.window_start),
    plannedWindowEnd: parseIsoOrNull(r.window_end),
    status: r.status?.name ?? r.status?.abbrev ?? null,
    orbitName: r.mission?.orbit?.abbrev ?? r.mission?.orbit?.name ?? null,
    missionName: r.mission?.name ?? null,
    missionDescription: r.mission?.description ?? null,
    rideshare,
    fetchedAt,
  };
}

// ---------------------------------------------------------------------------
// Ingester
// ---------------------------------------------------------------------------

export function createLaunchManifestSource(
  db: Database,
): IngestionSource<IngestionResult> {
  async function run(ctx: IngestionRunContext): Promise<IngestionResult> {
    const { logger } = ctx;
  let payload: Ll2Response | null = null;
  try {
    const res = await fetch(LL2_UPCOMING_URL, {
      signal: AbortSignal.timeout(30_000),
      headers: { "User-Agent": USER_AGENT, Accept: "application/json" },
    });
    if (!res.ok) {
      logger.warn(
        { status: res.status },
        "LL2 upcoming endpoint returned non-2xx",
      );
      return {
        inserted: 0,
        skipped: 0,
        notes: `LL2 HTTP ${res.status}`,
      };
    }
    payload = (await res.json()) as Ll2Response;
  } catch (err) {
    logger.warn(
      { err: err instanceof Error ? err.message : String(err) },
      "LL2 fetch failed",
    );
    return {
      inserted: 0,
      skipped: 0,
      notes: `LL2 fetch error: ${err instanceof Error ? err.message : String(err)}`,
    };
  }

  const results = payload.results ?? [];
  const fetchedAt = new Date();
  const rows: NewLaunch[] = [];
  for (const r of results) {
    const row = mapLaunch(r, fetchedAt);
    if (row) rows.push(row);
  }

  logger.info(
    { count: payload.count ?? 0, mapped: rows.length },
    "LL2 upcoming fetched",
  );

  if (rows.length === 0) {
    return { inserted: 0, skipped: 0, notes: "LL2 returned no usable launches" };
  }

  // Upsert on externalLaunchId — LL2 updates the same UUID as a launch
  // progresses through net-precision changes. On conflict, refresh all
  // LL2-sourced columns but leave the bigserial id + legacy created_at intact.
  let inserted = 0;
  for (const row of rows) {
    const result = await db
      .insert(launch)
      .values(row)
      .onConflictDoUpdate({
        target: launch.externalLaunchId,
        set: {
          year: row.year,
          name: row.name,
          vehicle: row.vehicle,
          operatorName: row.operatorName,
          operatorCountry: row.operatorCountry,
          padName: row.padName,
          padLocation: row.padLocation,
          plannedNet: row.plannedNet,
          plannedWindowStart: row.plannedWindowStart,
          plannedWindowEnd: row.plannedWindowEnd,
          status: row.status,
          orbitName: row.orbitName,
          missionName: row.missionName,
          missionDescription: row.missionDescription,
          rideshare: row.rideshare,
          fetchedAt: row.fetchedAt,
        },
      });
    inserted += result.rowCount ?? 0;
  }

  // Best-effort cleanup: expire LL2-sourced rows that no longer appear in
  // the upcoming manifest (launched or cancelled). Non-LL2 rows (legacy
  // seeds without externalLaunchId) are untouched.
  const currentIds = rows.map((r) => r.externalLaunchId!);
  const expireResult = await db
    .update(launch)
    .set({ status: sql`COALESCE(${launch.status}, '') || ' [stale]'` })
    .where(
      and(
        isNotNull(launch.externalLaunchId),
        notInArray(launch.externalLaunchId, currentIds),
        or(
          sql`${launch.status} IS NULL`,
          notIlike(launch.status, "%stale%"),
        ),
      ),
    );
  const expired = expireResult.rowCount ?? 0;

  return {
    inserted,
    skipped: rows.length - inserted,
    notes: `LL2: ${rows.length} upcoming launches upserted; ${expired} stale rows marked`,
  };
}

  return {
    id: "launch-manifest",
    description: "Launch Library 2 upcoming launches",
    cron: "0 */12 * * *",
    run,
  };
}
