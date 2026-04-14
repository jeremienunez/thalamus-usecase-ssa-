import { createLogger } from "@interview/shared/observability";
import type { Source, NewSourceItem } from "@interview/db-schema";

const logger = createLogger("source-ntrs");

/**
 * NASA NTRS (Technical Reports Server) fetcher.
 *
 * Endpoint: POST https://ntrs.nasa.gov/api/citations/search
 * Body shape (subset NTRS understands):
 *   { q: "<query>", page: { size: N, from: 0 }, sort: "publishedAt:desc" }
 *
 * Response: { results: [{ id, title, abstract, publicationDate, authorAffiliations, downloads, ... }] }
 *
 * `source.metadata.searchQuery` carries the query string. NTRS occasionally
 * 5xx's — caller is expected to log + continue on failure.
 */

export interface NtrsFetchOptions {
  limit?: number;
  timeoutMs?: number;
}

interface NtrsResultRow {
  id?: string | number;
  title?: string;
  abstract?: string;
  publicationDate?: string;
  publishedAt?: string;
  publicDate?: string;
  authorAffiliations?: Array<{ meta?: { author?: { name?: string } } }>;
  downloads?: Array<{ links?: { pdf?: string; original?: string } }>;
  stiType?: string;
  center?: { code?: string; name?: string };
}

export async function fetchNtrsSource(
  source: Source,
  opts: NtrsFetchOptions = {},
): Promise<NewSourceItem[]> {
  const limit = opts.limit ?? 10;
  const timeoutMs = opts.timeoutMs ?? 15_000;

  const meta = (source.metadata ?? {}) as Record<string, unknown>;
  const query =
    typeof meta.searchQuery === "string"
      ? meta.searchQuery
      : (source.category ?? "orbital debris");

  const body = {
    q: query,
    page: { size: limit, from: 0 },
    sort: "publishedAt:desc",
  };

  const res = await fetch("https://ntrs.nasa.gov/api/citations/search", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Accept: "application/json",
      "User-Agent": "thalamus-ssa-ingest/0.1",
    },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(timeoutMs),
  });
  if (!res.ok) {
    throw new Error(`NTRS ${source.slug} HTTP ${res.status}`);
  }

  const json = (await res.json()) as { results?: NtrsResultRow[] };
  const rows = json.results ?? [];

  const items: NewSourceItem[] = [];
  for (const r of rows.slice(0, limit)) {
    if (!r.title || r.id === undefined) continue;

    const externalId = String(r.id);
    const dateStr = r.publishedAt ?? r.publicationDate ?? r.publicDate ?? null;
    const publishedAt = dateStr ? new Date(dateStr) : null;

    const authors = (r.authorAffiliations ?? [])
      .map((a) => a?.meta?.author?.name)
      .filter((n): n is string => Boolean(n))
      .slice(0, 20);

    const pdfLink = r.downloads?.[0]?.links?.pdf;
    const url = pdfLink
      ? `https://ntrs.nasa.gov${pdfLink.startsWith("/") ? "" : "/"}${pdfLink}`
      : `https://ntrs.nasa.gov/citations/${externalId}`;

    items.push({
      sourceId: source.id,
      externalId,
      title: r.title.slice(0, 1000),
      abstract: r.abstract ? r.abstract.slice(0, 4000) : null,
      body: null,
      authors: authors.length ? authors : null,
      url,
      publishedAt:
        publishedAt && Number.isFinite(publishedAt.getTime())
          ? publishedAt
          : null,
      rawMetadata: {
        query,
        stiType: r.stiType,
        center: r.center?.code,
      },
    });
  }

  logger.debug(
    { source: source.slug, items: items.length, query },
    "NTRS fetched",
  );
  return items;
}
