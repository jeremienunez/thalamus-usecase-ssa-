import { createLogger } from "@interview/shared/observability";
import type { Source, NewSourceItem } from "@interview/db-schema";

const logger = createLogger("source-rss");

/**
 * Generic RSS 2.0 / Atom fetcher.
 *
 * Strategy: regex extraction of <item> / <entry> blocks then per-item field
 * pulls. We deliberately avoid an XML-parser dependency — feeds vary wildly
 * but the title / link / pubDate / description (or summary) trio is reliably
 * present and that's all the planner consumes downstream.
 *
 * Returns NewSourceItem[] — caller does the upsert keyed on
 * (source_id, external_id).
 */

export interface RssFetchOptions {
  limit?: number;
  timeoutMs?: number;
}

const decodeEntities = (s: string): string =>
  s
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&apos;/g, "'")
    .replace(/&amp;/g, "&")
    .replace(/&#(\d+);/g, (_, n) => String.fromCharCode(Number(n)));

const stripTags = (s: string): string =>
  decodeEntities(s.replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, "$1").replace(/<[^>]+>/g, " "))
    .replace(/\s+/g, " ")
    .trim();

const pick = (block: string, tag: string): string | null => {
  const re = new RegExp(`<${tag}\\b[^>]*>([\\s\\S]*?)<\\/${tag}>`, "i");
  const m = block.match(re);
  if (!m) return null;
  const raw = m[1];
  // CDATA passthrough then tag strip
  const cdata = raw.match(/<!\[CDATA\[([\s\S]*?)\]\]>/);
  return stripTags(cdata ? cdata[1] : raw);
};

const pickAttr = (block: string, tag: string, attr: string): string | null => {
  const re = new RegExp(`<${tag}\\b[^>]*\\b${attr}="([^"]+)"[^>]*\\/?>`, "i");
  const m = block.match(re);
  return m ? m[1] : null;
};

const parseDate = (s: string | null): Date | null => {
  if (!s) return null;
  const d = new Date(s);
  return Number.isFinite(d.getTime()) ? d : null;
};

export async function fetchRssSource(
  source: Source,
  opts: RssFetchOptions = {},
): Promise<NewSourceItem[]> {
  const limit = opts.limit ?? 10;
  const timeoutMs = opts.timeoutMs ?? 12_000;

  const res = await fetch(source.url, {
    headers: {
      Accept: "application/rss+xml, application/atom+xml, application/xml, */*",
      "User-Agent": "thalamus-ssa-ingest/0.1",
    },
    signal: AbortSignal.timeout(timeoutMs),
  });
  if (!res.ok) {
    throw new Error(`RSS ${source.slug} HTTP ${res.status}`);
  }
  const xml = await res.text();

  // Atom <entry> first, fall back to RSS <item>
  const isAtom = /<feed\b[^>]*>/i.test(xml) && !/<rss\b/i.test(xml);
  const blockRe = isAtom
    ? /<entry\b[^>]*>([\s\S]*?)<\/entry>/gi
    : /<item\b[^>]*>([\s\S]*?)<\/item>/gi;

  const items: NewSourceItem[] = [];
  let m: RegExpExecArray | null;
  while ((m = blockRe.exec(xml)) !== null && items.length < limit) {
    const block = m[1];

    const title = pick(block, "title");
    if (!title) continue;

    const link =
      pick(block, "link") ?? pickAttr(block, "link", "href") ?? null;

    const guid =
      pick(block, "guid") ?? pick(block, "id") ?? link ?? title.slice(0, 200);

    const dateStr =
      pick(block, "pubDate") ??
      pick(block, "published") ??
      pick(block, "updated") ??
      pick(block, "dc:date");

    const description =
      pick(block, "description") ??
      pick(block, "summary") ??
      pick(block, "content");

    items.push({
      sourceId: source.id,
      externalId: guid.slice(0, 500),
      title: title.slice(0, 1000),
      abstract: description ? description.slice(0, 4000) : null,
      body: null,
      authors: null,
      url: link,
      publishedAt: parseDate(dateStr),
      rawMetadata: { feedKind: isAtom ? "atom" : "rss" },
    });
  }

  logger.debug(
    { source: source.slug, items: items.length },
    "RSS fetched",
  );
  return items;
}
