/**
 * Space-weather ingester — pulls three independent publishers and writes
 * one row per (source, epoch, issued_at) to `space_weather_forecast`.
 *
 *   - NOAA SWPC 27-day outlook (US): daily F10.7 + Ap + largest-Kp forecast.
 *   - GFZ Potsdam (DE): canonical global Kp nowcast at 3-hour cadence.
 *   - SIDC/STCE (BE, ESA-adjacent): Estimated International Sunspot Number (EISN).
 *
 * Idempotent via the `(source, epoch, issued_at)` unique index. Sources that
 * fail silently do not block the others — the job reports per-source counts
 * in its return value so ops can see which publishers were up.
 */

import {
  spaceWeatherForecast,
  type NewSpaceWeatherForecast,
} from "@interview/db-schema";
import type { IngestionFetcher } from "../ingestion-registry";

const NOAA_27DO_URL = "https://services.swpc.noaa.gov/text/27-day-outlook.txt";
// GFZ nowcast Kp — request yesterday → tomorrow so the same call covers
// final + nowcast + preliminary readings the publisher is still revising.
const GFZ_KP_URL_TMPL =
  "https://kp.gfz.de/app/json/?start={start}&end={end}&index=Kp";
const SIDC_EISN_URL =
  "https://www.sidc.be/SILSO/DATA/EISN/EISN_current.csv";

const USER_AGENT =
  "thalamus-ssa-ingest/0.1 (interview-project; contact: jerem@interview-project.invalid)";

async function httpGetText(url: string): Promise<string | null> {
  try {
    const res = await fetch(url, {
      signal: AbortSignal.timeout(30_000),
      headers: { "User-Agent": USER_AGENT, Accept: "text/plain, */*" },
    });
    if (!res.ok) return null;
    return await res.text();
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------------
// NOAA SWPC 27-day outlook
// ---------------------------------------------------------------------------

function parseNoaaOutlook(text: string): NewSpaceWeatherForecast[] {
  // Header lines begin with ':' or '#'. Issued date in `:Issued: YYYY MMM DD HHMM UTC`.
  const issuedMatch = text.match(
    /:Issued:\s+(\d{4})\s+(\w{3})\s+(\d{1,2})\s+(\d{2})(\d{2})\s+UTC/,
  );
  if (!issuedMatch) return [];
  const months: Record<string, number> = {
    Jan: 0, Feb: 1, Mar: 2, Apr: 3, May: 4, Jun: 5,
    Jul: 6, Aug: 7, Sep: 8, Oct: 9, Nov: 10, Dec: 11,
  };
  const [, yS, mS, dS, hhS, mmS] = issuedMatch;
  const issuedAt = new Date(
    Date.UTC(Number(yS), months[mS] ?? 0, Number(dS), Number(hhS), Number(mmS)),
  );

  const out: NewSpaceWeatherForecast[] = [];
  for (const line of text.split(/\r?\n/)) {
    // `2026 Apr 13      95           8          3`
    const m = line.match(
      /^\s*(\d{4})\s+(\w{3})\s+(\d{1,2})\s+(\d+)\s+(\d+)\s+(\d+)\s*$/,
    );
    if (!m) continue;
    const [, y, mo, d, f107, ap, kp] = m;
    const epoch = new Date(Date.UTC(Number(y), months[mo] ?? 0, Number(d)));
    out.push({
      source: "noaa-swpc-27do",
      epoch,
      f107: Number(f107),
      apIndex: Number(ap),
      kpIndex: Number(kp),
      sunspotNumber: null,
      issuedAt,
    });
  }
  return out;
}

// ---------------------------------------------------------------------------
// GFZ Potsdam Kp JSON
// ---------------------------------------------------------------------------

interface GfzKpPayload {
  meta?: { source?: string; license?: string };
  datetime?: string[];
  Kp?: number[];
  status?: string[];
}

function parseGfzKp(json: GfzKpPayload): NewSpaceWeatherForecast[] {
  if (!Array.isArray(json.datetime) || !Array.isArray(json.Kp)) return [];
  const fetchedAt = new Date();
  const out: NewSpaceWeatherForecast[] = [];
  for (let i = 0; i < json.datetime.length; i++) {
    const t = json.datetime[i];
    const kp = json.Kp[i];
    if (!t || !Number.isFinite(kp)) continue;
    out.push({
      source: "gfz-kp",
      epoch: new Date(t),
      f107: null,
      apIndex: null,
      kpIndex: kp,
      sunspotNumber: null,
      // GFZ doesn't publish an authoritative issue timestamp per sample;
      // use fetch time so every import is attributable without colliding.
      issuedAt: fetchedAt,
    });
  }
  return out;
}

async function fetchGfzKp(): Promise<NewSpaceWeatherForecast[]> {
  const now = new Date();
  const start = new Date(now.getTime() - 2 * 24 * 3600 * 1000);
  const end = new Date(now.getTime() + 24 * 3600 * 1000);
  const url = GFZ_KP_URL_TMPL.replace(
    "{start}",
    start.toISOString().slice(0, 19) + "Z",
  ).replace("{end}", end.toISOString().slice(0, 19) + "Z");
  try {
    const res = await fetch(url, {
      signal: AbortSignal.timeout(30_000),
      headers: { "User-Agent": USER_AGENT, Accept: "application/json, */*" },
    });
    if (!res.ok) return [];
    const json = (await res.json()) as GfzKpPayload;
    return parseGfzKp(json);
  } catch {
    return [];
  }
}

// ---------------------------------------------------------------------------
// SIDC EISN sunspot CSV
// ---------------------------------------------------------------------------

function parseSidcEisn(text: string): NewSpaceWeatherForecast[] {
  // CSV columns: year, month, day, decimal_year, ssn, stddev, n_obs, n_def, (flag)
  const fetchedAt = new Date();
  const out: NewSpaceWeatherForecast[] = [];
  for (const line of text.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    const cols = trimmed.split(",").map((s) => s.trim());
    if (cols.length < 5) continue;
    const year = Number(cols[0]);
    const month = Number(cols[1]);
    const day = Number(cols[2]);
    const ssn = Number(cols[4]);
    if (!Number.isFinite(year) || !Number.isFinite(month) || !Number.isFinite(day))
      continue;
    if (!Number.isFinite(ssn) || ssn < 0) continue;
    const epoch = new Date(Date.UTC(year, month - 1, day));
    out.push({
      source: "sidc-eisn",
      epoch,
      f107: null,
      apIndex: null,
      kpIndex: null,
      sunspotNumber: ssn,
      issuedAt: fetchedAt,
    });
  }
  return out;
}

// ---------------------------------------------------------------------------
// Ingester
// ---------------------------------------------------------------------------

export const spaceWeatherFetcher: IngestionFetcher = async ({
  db,
  logger,
}) => {
  const perSource: Record<string, { fetched: number; inserted: number }> = {};

  async function ingest(
    sourceTag: string,
    rows: NewSpaceWeatherForecast[],
  ): Promise<void> {
    perSource[sourceTag] = { fetched: rows.length, inserted: 0 };
    if (rows.length === 0) return;
    // Chunk under the Postgres 1664 expression-list parser cap —
    // 9 cols × 150 rows = 1350 entries per VALUES statement.
    const CHUNK = 150;
    let inserted = 0;
    for (let i = 0; i < rows.length; i += CHUNK) {
      const chunk = rows.slice(i, i + CHUNK);
      const result = await db
        .insert(spaceWeatherForecast)
        .values(chunk)
        .onConflictDoNothing({
          target: [
            spaceWeatherForecast.source,
            spaceWeatherForecast.epoch,
            spaceWeatherForecast.issuedAt,
          ],
        });
      inserted += result.rowCount ?? 0;
    }
    perSource[sourceTag].inserted = inserted;
  }

  // NOAA SWPC 27-day outlook
  try {
    const text = await httpGetText(NOAA_27DO_URL);
    const rows = text ? parseNoaaOutlook(text) : [];
    await ingest("noaa-swpc-27do", rows);
  } catch (err) {
    logger.warn(
      { err: err instanceof Error ? err.message : String(err) },
      "NOAA SWPC ingest failed",
    );
    perSource["noaa-swpc-27do"] = { fetched: 0, inserted: 0 };
  }

  // GFZ Potsdam Kp
  try {
    const rows = await fetchGfzKp();
    await ingest("gfz-kp", rows);
  } catch (err) {
    logger.warn(
      { err: err instanceof Error ? err.message : String(err) },
      "GFZ Potsdam ingest failed",
    );
    perSource["gfz-kp"] = { fetched: 0, inserted: 0 };
  }

  // SIDC EISN
  try {
    const text = await httpGetText(SIDC_EISN_URL);
    const rows = text ? parseSidcEisn(text) : [];
    await ingest("sidc-eisn", rows);
  } catch (err) {
    logger.warn(
      { err: err instanceof Error ? err.message : String(err) },
      "SIDC EISN ingest failed",
    );
    perSource["sidc-eisn"] = { fetched: 0, inserted: 0 };
  }

  logger.info({ perSource }, "space-weather fetch complete");

  const totalInserted = Object.values(perSource).reduce(
    (s, v) => s + v.inserted,
    0,
  );
  const totalFetched = Object.values(perSource).reduce(
    (s, v) => s + v.fetched,
    0,
  );
  return {
    inserted: totalInserted,
    skipped: totalFetched - totalInserted,
    notes: Object.entries(perSource)
      .map(([src, v]) => `${src}: ${v.inserted}/${v.fetched}`)
      .join("; "),
  };
};
