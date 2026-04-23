/**
 * NOTAM ingester — pulls the FAA TFR (Temporary Flight Restrictions) list
 * from https://tfr.faa.gov/tfrapi/exportTfrList. Public JSON, no auth.
 *
 * The FAA pre-classifies TFRs with `type = "SPACE OPERATIONS"` for launch
 * hazard areas — exactly what `launch_scout` needs to tier confidence
 * from 0.7 (manifest-only) to 0.85 (manifest + NOTAM-confirmed).
 *
 * Geometry is not available from this endpoint; the description narrates
 * "18NM NORTH OF DILLON, MT, Saturday April 18..." without a bbox.
 * Parsed start/end timestamps are regexed from the description so queries
 * can filter by active window without LLM-parsing the narrative.
 *
 * Scope: US-only for now. Non-US NOTAMs (Eurocontrol, NAV CANADA, ITU)
 * remain out of reach without auth / scraping; track as future work.
 */

import { notam, type Database, type NewNotam } from "@interview/db-schema";
import type { IngestionSource, IngestionRunContext } from "@interview/sweep";

interface IngestionResult {
  inserted: number;
  skipped: number;
  notes?: string;
}

const FAA_TFR_LIST_URL = "https://tfr.faa.gov/tfrapi/exportTfrList";

const USER_AGENT =
  "Mozilla/5.0 thalamus-ssa-ingest/0.1 (interview-project; contact: jerem@interview-project.invalid)";

interface FaaTfrRow {
  notam_id?: string;
  type?: string;
  facility?: string;
  state?: string;
  description?: string;
  creation_date?: string;
}

const MONTHS: Record<string, number> = {
  january: 0, february: 1, march: 2, april: 3, may: 4, june: 5,
  july: 6, august: 7, september: 8, october: 9, november: 10, december: 11,
};

/**
 * Parse start / end UTC from TFR description narratives.
 * Examples handled:
 *   "BLACK ROCK, NV, Sunday, April 19, 2026 through Monday, April 20, 2026 UTC"
 *   "18NM NORTH OF DILLON, MT, Saturday, April 18, 2026 UTC"
 *   "..., Friday, April 17, 2026 through Friday, May 1, 2026 UTC"
 */
function parseDatesFromDescription(
  desc: string,
): { start: Date | null; end: Date | null } {
  const datePattern =
    /\b(?:Mon|Tues?|Wednes|Thurs?|Fri|Satur|Sun)day,\s+([A-Za-z]+)\s+(\d{1,2}),\s+(\d{4})/gi;
  const dates: Date[] = [];
  let m: RegExpExecArray | null;
  while ((m = datePattern.exec(desc)) !== null) {
    const [, monthName, day, year] = m;
    const monthIdx = MONTHS[monthName.toLowerCase()];
    if (monthIdx === undefined) continue;
    dates.push(new Date(Date.UTC(Number(year), monthIdx, Number(day))));
  }
  if (dates.length === 0) return { start: null, end: null };
  const start = dates[0];
  const end = dates.length > 1 ? dates[dates.length - 1] : dates[0];
  // End of day on the terminal date (TFRs typically run through end of UTC day).
  const endEod = new Date(end.getTime() + 86_400_000 - 1000);
  return { start, end: endEod };
}

function parseCreationDate(s: string | undefined | null): Date | null {
  if (!s) return null;
  // "04/17/2026"
  const m = s.match(/^(\d{2})\/(\d{2})\/(\d{4})$/);
  if (!m) return null;
  return new Date(Date.UTC(Number(m[3]), Number(m[1]) - 1, Number(m[2])));
}

function isLaunchRelated(row: FaaTfrRow): boolean {
  if (row.type === "SPACE OPERATIONS") return true;
  const desc = row.description?.toUpperCase() ?? "";
  return /\b(LAUNCH|ROCKET|SPACEX|KENNEDY|CAPE CANAVERAL|VANDENBERG|WALLOPS|CAPE KENNEDY|BOCA CHICA)\b/.test(
    desc,
  );
}

function mapRow(row: FaaTfrRow, fetchedAt: Date): NewNotam | null {
  const launchRelated = isLaunchRelated(row);
  if (!row.notam_id || !row.type || !row.description) return null;
  const { start, end } = parseDatesFromDescription(row.description);
  return {
    notamId: row.notam_id,
    type: row.type,
    facility: row.facility ?? null,
    state: row.state ?? null,
    description: row.description,
    creationDate: parseCreationDate(row.creation_date),
    parsedStartUtc: start,
    parsedEndUtc: end,
    isLaunchRelated: launchRelated,
    source: "faa-tfr",
    fetchedAt,
  };
}

export function createNotamSource(
  db: Database,
): IngestionSource<IngestionResult> {
  async function run(ctx: IngestionRunContext): Promise<IngestionResult> {
    const { logger } = ctx;
  let payload: FaaTfrRow[] | null = null;
  try {
    const res = await fetch(FAA_TFR_LIST_URL, {
      signal: AbortSignal.timeout(30_000),
      headers: { "User-Agent": USER_AGENT, Accept: "application/json" },
    });
    if (!res.ok) {
      logger.warn({ status: res.status }, "FAA TFR endpoint returned non-2xx");
      return { inserted: 0, skipped: 0, notes: `FAA HTTP ${res.status}` };
    }
    payload = (await res.json()) as FaaTfrRow[];
  } catch (err) {
    logger.warn(
      { err: err instanceof Error ? err.message : String(err) },
      "FAA TFR fetch failed",
    );
    return {
      inserted: 0,
      skipped: 0,
      notes: `FAA fetch error: ${err instanceof Error ? err.message : String(err)}`,
    };
  }

  const fetchedAt = new Date();
  const rows: NewNotam[] = [];
  for (const r of payload) {
    const row = mapRow(r, fetchedAt);
    if (row) rows.push(row);
  }

  const launchCount = rows.filter((r) => r.isLaunchRelated).length;
  logger.info(
    {
      fetched: payload.length,
      mapped: rows.length,
      launchRelated: launchCount,
      types: [...new Set(rows.map((r) => r.type))],
    },
    "FAA TFR fetch complete",
  );

  if (rows.length === 0) {
    return { inserted: 0, skipped: 0, notes: "FAA returned no parseable TFRs" };
  }

  // Upsert on (source, notamId). The FAA can re-issue the same notamId with
  // updated description / dates — refresh all narrative + parsed windows.
  let inserted = 0;
  for (const row of rows) {
    const result = await db
      .insert(notam)
      .values(row)
      .onConflictDoUpdate({
        target: [notam.source, notam.notamId],
        set: {
          type: row.type,
          facility: row.facility,
          state: row.state,
          description: row.description,
          creationDate: row.creationDate,
          parsedStartUtc: row.parsedStartUtc,
          parsedEndUtc: row.parsedEndUtc,
          isLaunchRelated: row.isLaunchRelated,
          fetchedAt: row.fetchedAt,
        },
      });
    inserted += result.rowCount ?? 0;
  }

  return {
    inserted,
    skipped: rows.length - inserted,
    notes: `FAA TFR: ${rows.length} upserted (${launchCount} launch-related)`,
  };
}

  return {
    id: "notams",
    description: "FAA TFR (Temporary Flight Restrictions) — SPACE OPERATIONS",
    cron: "15 */6 * * *",
    run,
  };
}
