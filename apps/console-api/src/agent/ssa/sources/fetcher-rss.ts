import { createLogger } from "@interview/shared/observability";
import {
  pickFirstTagText,
  pickTagAttr,
} from "@interview/shared/utils";
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

    const title = pickFirstTagText(block, "title");
    if (!title) continue;

    const link =
      pickFirstTagText(block, "link") ?? pickTagAttr(block, "link", "href") ?? null;

    const guid =
      pickFirstTagText(block, "guid") ??
      pickFirstTagText(block, "id") ??
      link ??
      title.slice(0, 200);

    const dateStr =
      pickFirstTagText(block, "pubDate") ??
      pickFirstTagText(block, "published") ??
      pickFirstTagText(block, "updated") ??
      pickFirstTagText(block, "dc:date");

    const description =
      pickFirstTagText(block, "description") ??
      pickFirstTagText(block, "summary") ??
      pickFirstTagText(block, "content");

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
