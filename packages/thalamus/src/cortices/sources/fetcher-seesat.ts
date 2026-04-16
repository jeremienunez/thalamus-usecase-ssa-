/**
 * SeeSat-L archive fetcher.
 *
 * SeeSat-L is a plain-text mailing list hosted at https://satobs.org/seesat/
 * where amateur observers (Molczan, Langbroek, Tilley, Bassa, Kowalski…)
 * publish unclassified observations and reconstructed TLEs for spacecraft
 * the official catalogue either hides or lags behind on. We fuse those
 * observations with the official satellite table via `amateur_track` —
 * the OpacityScout cortex then scores information-deficit per satellite.
 *
 * Output contract: `NewAmateurTrack[]` — NOT `NewSourceItem[]`. This
 * fetcher targets the structured observation lane, not the generic
 * document lane.
 *
 * Parsing strategy:
 *   - Find 3-line TLE blocks: `<name>\n1 NNNNN[U?] ...\n2 NNNNN ...`
 *   - Extract NORAD id (5-digit after record type) and COSPAR id from
 *     line 1 column 10-17.
 *   - The message date + observer handle are supplied by the caller
 *     (parsed from mailing-list headers before calling parseSeesatMessage).
 *
 * Design note: fetching the archive index and iterating N messages is a
 * thin HTTP wrapper; the value is in the TLE extraction, which we keep
 * pure so it can be unit-tested without network I/O.
 */

import { createLogger } from "@interview/shared/observability";
import { safeFetch } from "@interview/shared";
import type { NewAmateurTrack, Source } from "@interview/db-schema";

const logger = createLogger("source-seesat");

/**
 * A raw three-line TLE block — before we attach it to a mailing-list
 * message's date / observer metadata.
 */
interface TleTriplet {
  name: string;
  line1: string;
  line2: string;
  /** Character offset of the triplet within the parsed text — used as anchor
   *  for `raw_excerpt`. */
  startOffset: number;
}

/**
 * Pull every 3-line TLE triplet out of a plain-text blob.
 *
 * Accepts a lot of noise — mailing-list headers, signatures, commentary —
 * because SeeSat messages always mix TLEs with prose.
 */
export function extractTleTriplets(text: string): TleTriplet[] {
  const out: TleTriplet[] = [];
  const lines = text.split(/\r?\n/);

  for (let i = 0; i < lines.length - 2; i++) {
    const name = lines[i].trim();
    const line1 = lines[i + 1];
    const line2 = lines[i + 2];

    if (!isTleLine1(line1) || !isTleLine2(line2)) continue;
    if (name.length === 0 || name.length > 24) continue; // TLE names fit on one card
    if (/^\d/.test(name)) continue; // digit-leading line is probably a line1, not a name

    // Both TLE lines must reference the same satellite number
    const num1 = line1.slice(2, 7).trim();
    const num2 = line2.slice(2, 7).trim();
    if (num1 !== num2) continue;

    const startOffset = lines.slice(0, i).reduce((n, l) => n + l.length + 1, 0);
    out.push({ name, line1, line2, startOffset });
    i += 2; // skip past this triplet
  }

  return out;
}

function isTleLine1(s: string): boolean {
  return (
    typeof s === "string" &&
    s.length >= 68 &&
    s.charAt(0) === "1" &&
    s.charAt(1) === " "
  );
}

function isTleLine2(s: string): boolean {
  return (
    typeof s === "string" &&
    s.length >= 68 &&
    s.charAt(0) === "2" &&
    s.charAt(1) === " "
  );
}

/**
 * Given a mailing-list message, convert every TLE triplet into a
 * `NewAmateurTrack`. Context fields (message date, observer handle,
 * citation URL, source id) are supplied by the caller because they come
 * from mail headers this function does not see.
 */
export interface SeesatMessageContext {
  sourceId: bigint;
  messageUrl: string;
  from: string | null;
  date: Date;
}

export function parseSeesatMessage(
  text: string,
  ctx: SeesatMessageContext,
): NewAmateurTrack[] {
  const triplets = extractTleTriplets(text);
  return triplets.map((t) => ({
    sourceId: ctx.sourceId,
    observedAt: ctx.date,
    candidateNoradId: parseNoradId(t.line1),
    candidateCospar: parseCospar(t.line1),
    tleLine1: t.line1,
    tleLine2: t.line2,
    observerHandle: ctx.from?.slice(0, 120) ?? null,
    citationUrl: ctx.messageUrl,
    rawExcerpt: `${t.name}\n${t.line1}\n${t.line2}`,
  }));
}

function parseNoradId(line1: string): number | null {
  // Columns 3-7 on line 1 — satellite catalog number
  const raw = line1.slice(2, 7).trim();
  const n = Number.parseInt(raw, 10);
  return Number.isFinite(n) ? n : null;
}

function parseCospar(line1: string): string | null {
  // Columns 10-17 on line 1 — international designator (YYNNNPIECE)
  // Rendered as "YY-NNNPIECE" for human readability and catalog joining.
  const raw = line1.slice(9, 17).trim();
  if (!raw) return null;
  const yy = raw.slice(0, 2);
  const rest = raw.slice(2);
  if (!/^\d{2}$/.test(yy) || rest.length === 0) return null;
  // SeeSat-era launches span the 1957-2056 window; roll the two-digit year.
  const fullYear = Number(yy) >= 57 ? `19${yy}` : `20${yy}`;
  return `${fullYear}-${rest}`;
}

// ---------------------------------------------------------------------------
// HTTP wrapper — archive index → per-message fetch → flatten
// ---------------------------------------------------------------------------

export interface SeesatFetchOptions {
  /** Maximum message pages to fetch per run. Default 40. */
  maxMessages?: number;
  /** Per-fetch timeout. Default 10s (safeFetch default). */
  timeoutMs?: number;
}

/**
 * Fetch a month-indexed SeeSat archive (or any plain-text archive matching
 * the same shape) and flatten every embedded TLE to an `amateur_track`
 * row. The archive index page is expected to link to message pages via
 * `<a href="msg00123.html">`-style anchors.
 *
 * `source.url` should point at the archive index.
 */
export async function fetchSeesatArchive(
  source: Source,
  opts: SeesatFetchOptions = {},
): Promise<NewAmateurTrack[]> {
  const maxMessages = opts.maxMessages ?? 40;
  const timeoutMs = opts.timeoutMs ?? 10_000;

  const indexHtml = await (
    await safeFetch(source.url, {
      timeoutMs,
      headers: { "User-Agent": "thalamus-opacity-scout/0.1" },
    })
  ).text();

  const messageUrls = extractMessageLinks(source.url, indexHtml).slice(
    0,
    maxMessages,
  );

  const tracks: NewAmateurTrack[] = [];
  for (const messageUrl of messageUrls) {
    try {
      const res = await safeFetch(messageUrl, {
        timeoutMs,
        headers: { "User-Agent": "thalamus-opacity-scout/0.1" },
      });
      const body = await res.text();
      const ctx = extractMessageHeaders(body, {
        sourceId: source.id,
        messageUrl,
      });
      tracks.push(...parseSeesatMessage(body, ctx));
    } catch (err) {
      logger.debug(
        { messageUrl, error: (err as Error).message },
        "SeeSat message fetch failed (non-blocking)",
      );
    }
  }

  logger.info(
    { source: source.slug, messages: messageUrls.length, tracks: tracks.length },
    "SeeSat archive fetched",
  );
  return tracks;
}

export function extractMessageLinks(indexUrl: string, indexHtml: string): string[] {
  const base = new URL(indexUrl);
  const re = /href="(msg\d{4,6}\.html?)"/gi;
  const out: string[] = [];
  let m: RegExpExecArray | null;
  while ((m = re.exec(indexHtml)) !== null) {
    out.push(new URL(m[1], base).toString());
  }
  return out;
}

function extractMessageHeaders(
  body: string,
  anchor: { sourceId: bigint; messageUrl: string },
): SeesatMessageContext {
  // Header block is standard RFC-822-ish; we only need Date and From.
  const dateMatch = body.match(/^\s*Date:\s*([^\n\r]+)/im);
  const fromMatch = body.match(/^\s*From:\s*([^\n\r]+)/im);

  const dateRaw = dateMatch ? dateMatch[1].trim() : null;
  const parsed = dateRaw ? new Date(dateRaw) : null;
  const date = parsed && Number.isFinite(parsed.getTime()) ? parsed : new Date();

  return {
    sourceId: anchor.sourceId,
    messageUrl: anchor.messageUrl,
    from: fromMatch ? fromMatch[1].trim() : null,
    date,
  };
}
