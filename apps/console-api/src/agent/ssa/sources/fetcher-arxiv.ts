import { createLogger } from "@interview/shared/observability";
import {
  pickAllTagText,
  pickFirstTagText,
} from "@interview/shared/utils";
import type { Source, NewSourceItem } from "@interview/db-schema";

const logger = createLogger("source-arxiv");

/**
 * arXiv API fetcher.
 *
 * Endpoint: http://export.arxiv.org/api/query?search_query=<q>&start=0&max_results=N
 *
 * Response is Atom XML — we parse <entry> blocks for id / title / summary /
 * authors / published. The arXiv `id` URL doubles as the canonical external
 * identifier.
 *
 * `source.metadata` may carry `{ searchQuery: "cat:physics.space-ph" }` to
 * compose the query string at fetch time.
 */

export interface ArxivFetchOptions {
  limit?: number;
  timeoutMs?: number;
}

export async function fetchArxivSource(
  source: Source,
  opts: ArxivFetchOptions = {},
): Promise<NewSourceItem[]> {
  const limit = opts.limit ?? 10;
  const timeoutMs = opts.timeoutMs ?? 15_000;

  const meta = (source.metadata ?? {}) as Record<string, unknown>;
  const searchQuery =
    typeof meta.searchQuery === "string"
      ? meta.searchQuery
      : `cat:${source.category ?? "physics.space-ph"}`;

  const url = new URL("http://export.arxiv.org/api/query");
  url.searchParams.set("search_query", searchQuery);
  url.searchParams.set("start", "0");
  url.searchParams.set("max_results", String(limit));
  url.searchParams.set("sortBy", "submittedDate");
  url.searchParams.set("sortOrder", "descending");

  const res = await fetch(url.toString(), {
    headers: {
      Accept: "application/atom+xml",
      "User-Agent": "thalamus-ssa-ingest/0.1",
    },
    signal: AbortSignal.timeout(timeoutMs),
  });
  if (!res.ok) {
    throw new Error(`arXiv ${source.slug} HTTP ${res.status}`);
  }
  const xml = await res.text();

  const items: NewSourceItem[] = [];
  const re = /<entry\b[^>]*>([\s\S]*?)<\/entry>/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(xml)) !== null && items.length < limit) {
    const block = m[1];
    const id = pickFirstTagText(block, "id");
    const title = pickFirstTagText(block, "title");
    if (!id || !title) continue;

    const summary = pickFirstTagText(block, "summary");
    const published = pickFirstTagText(block, "published");
    const authors = pickAllTagText(block, "name");

    // Pull primary link href (the <id> is also a usable URL on arXiv)
    const linkMatch = block.match(/<link\b[^>]*\bhref="([^"]+)"/i);
    const link = linkMatch ? linkMatch[1] : id;

    const publishedAt = published ? new Date(published) : null;

    items.push({
      sourceId: source.id,
      externalId: id.slice(0, 500),
      title: title.slice(0, 1000),
      abstract: summary ? summary.slice(0, 4000) : null,
      body: null,
      authors: authors.length ? authors.slice(0, 20) : null,
      url: link,
      publishedAt:
        publishedAt && Number.isFinite(publishedAt.getTime())
          ? publishedAt
          : null,
      rawMetadata: { searchQuery },
    });
  }

  logger.debug(
    { source: source.slug, items: items.length, searchQuery },
    "arXiv fetched",
  );
  return items;
}
