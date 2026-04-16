/**
 * Source catalogue seed — registers the RSS / arXiv / NTRS lanes that feed
 * the Thalamus planner with content beyond the orbital-physics catalogue.
 *
 * The fetchers are duplicated here (lightweight regex-based) because
 * `@interview/db-schema` cannot import from `@interview/thalamus` (would be
 * circular). Keep the canonical implementations in
 * `packages/thalamus/src/cortices/sources/fetcher-{rss,arxiv,ntrs}.ts` and
 * the shape in sync with [source.ts](../schema/source.ts).
 */

import { sql } from "drizzle-orm";
import type { NodePgDatabase } from "drizzle-orm/node-postgres";
import { source, sourceItem, type NewSourceItem, type Source } from "../schema";

// ─── Source registrations ────────────────────────────────────────────────────

interface SourceSeed {
  slug: string;
  name: string;
  kind: "rss" | "arxiv" | "ntrs" | "osint";
  url: string;
  category?: string;
  metadata?: Record<string, unknown>;
}

export const SOURCE_SEEDS: SourceSeed[] = [
  // ── RSS news ─────────────────────────────────────────────────────────────
  {
    slug: "spacenews",
    name: "SpaceNews",
    kind: "rss",
    url: "https://spacenews.com/feed/",
    category: "news",
  },
  {
    slug: "spaceflightnow",
    name: "SpaceflightNow",
    kind: "rss",
    url: "https://spaceflightnow.com/feed/",
    category: "news",
  },
  {
    slug: "ars-technica-science",
    name: "Ars Technica Science",
    kind: "rss",
    url: "https://feeds.arstechnica.com/arstechnica/science",
    category: "news",
  },
  {
    slug: "esa-news",
    name: "ESA News",
    kind: "rss",
    url: "https://www.esa.int/rssfeed/Our_Activities/Space_News",
    category: "news",
  },

  // ── arXiv ────────────────────────────────────────────────────────────────
  {
    slug: "arxiv-physics-space-ph",
    name: "arXiv physics.space-ph",
    kind: "arxiv",
    url: "http://export.arxiv.org/api/query?search_query=cat:physics.space-ph",
    category: "physics.space-ph",
    metadata: { searchQuery: "cat:physics.space-ph" },
  },
  {
    slug: "arxiv-astro-ph-im",
    name: "arXiv astro-ph.IM",
    kind: "arxiv",
    url: "http://export.arxiv.org/api/query?search_query=cat:astro-ph.IM",
    category: "astro-ph.IM",
    metadata: { searchQuery: "cat:astro-ph.IM" },
  },
  {
    slug: "arxiv-ssa-keywords",
    name: "arXiv SSA keywords",
    kind: "arxiv",
    url: "http://export.arxiv.org/api/query?search_query=all:%22space+debris%22",
    category: "ssa-keyword",
    metadata: {
      searchQuery:
        'all:"space debris" OR all:"conjunction analysis" OR all:"collision probability"',
    },
  },

  // ── NASA NTRS ────────────────────────────────────────────────────────────
  {
    slug: "ntrs-orbital-debris",
    name: "NTRS — Orbital Debris",
    kind: "ntrs",
    url: "https://ntrs.nasa.gov/api/citations/search",
    category: "orbital-debris",
    metadata: { searchQuery: "orbital debris" },
  },
  {
    slug: "ntrs-conjunction-assessment",
    name: "NTRS — Conjunction Assessment",
    kind: "ntrs",
    url: "https://ntrs.nasa.gov/api/citations/search",
    category: "conjunction-assessment",
    metadata: { searchQuery: "conjunction assessment" },
  },

  // ── Amateur SSA trackers (OpacityScout ingest lane) ─────────────────────
  {
    slug: "sattrackcam",
    name: "SatTrackCam Leiden (Marco Langbroek)",
    kind: "rss",
    url: "https://sattrackcam.blogspot.com/feeds/posts/default?alt=rss",
    category: "amateur-osint",
    metadata: {
      observer: "Marco Langbroek",
      fetcherKind: "rss",
      targetTable: "source_item",
    },
  },
  {
    slug: "seesat-archive-current",
    name: "SeeSat-L archive (current month)",
    kind: "osint",
    // Monthly-rotating archive. The fetcher resolves the current index each run.
    url: "https://satobs.org/seesat/",
    category: "amateur-osint",
    metadata: {
      observer: "SeeSat-L list (multiple)",
      fetcherKind: "seesat",
      targetTable: "amateur_track",
    },
  },
  {
    slug: "spacetrack-satcat-diff",
    name: "Space-Track SATCAT diff",
    kind: "osint",
    // `fetcherKind = spacetrack-diff` → Redis-backed snapshot differ.
    // URL kept for reviewer provenance; the fetcher itself pulls from Redis.
    url: "https://www.space-track.org/basicspacedata/query/class/satcat/",
    category: "catalog-drift",
    metadata: {
      observer: "Space-Track (18th SDS)",
      fetcherKind: "spacetrack-diff",
      targetTable: "amateur_track",
      cadenceHours: 24,
    },
  },
];

// ─── Lightweight fetchers (keep in sync with thalamus/cortices/sources) ─────

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
  decodeEntities(
    s.replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, "$1").replace(/<[^>]+>/g, " "),
  )
    .replace(/\s+/g, " ")
    .trim();

const pick = (block: string, tag: string): string | null => {
  const re = new RegExp(`<${tag}\\b[^>]*>([\\s\\S]*?)<\\/${tag}>`, "i");
  const m = block.match(re);
  if (!m) return null;
  const cdata = m[1].match(/<!\[CDATA\[([\s\S]*?)\]\]>/);
  return stripTags(cdata ? cdata[1] : m[1]);
};

const pickAttr = (block: string, tag: string, attr: string): string | null => {
  const re = new RegExp(
    `<${tag}\\b[^>]*\\b${attr}="([^"]+)"[^>]*\\/?>`,
    "i",
  );
  const m = block.match(re);
  return m ? m[1] : null;
};

const pickAll = (block: string, tag: string): string[] => {
  const re = new RegExp(`<${tag}\\b[^>]*>([\\s\\S]*?)<\\/${tag}>`, "gi");
  const out: string[] = [];
  let m: RegExpExecArray | null;
  while ((m = re.exec(block)) !== null) {
    const v = stripTags(m[1]);
    if (v) out.push(v);
  }
  return out;
};

const parseDate = (s: string | null | undefined): Date | null => {
  if (!s) return null;
  const d = new Date(s);
  return Number.isFinite(d.getTime()) ? d : null;
};

async function fetchRss(
  src: Source,
  limit: number,
): Promise<NewSourceItem[]> {
  const res = await fetch(src.url, {
    headers: {
      Accept: "application/rss+xml, application/atom+xml, application/xml, */*",
      "User-Agent": "thalamus-ssa-ingest/0.1",
    },
    signal: AbortSignal.timeout(12_000),
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const xml = await res.text();
  const isAtom = /<feed\b[^>]*>/i.test(xml) && !/<rss\b/i.test(xml);
  const re = isAtom
    ? /<entry\b[^>]*>([\s\S]*?)<\/entry>/gi
    : /<item\b[^>]*>([\s\S]*?)<\/item>/gi;
  const items: NewSourceItem[] = [];
  let m: RegExpExecArray | null;
  while ((m = re.exec(xml)) !== null && items.length < limit) {
    const block = m[1];
    const title = pick(block, "title");
    if (!title) continue;
    const link = pick(block, "link") ?? pickAttr(block, "link", "href");
    const guid =
      pick(block, "guid") ?? pick(block, "id") ?? link ?? title.slice(0, 200);
    const dateStr =
      pick(block, "pubDate") ??
      pick(block, "published") ??
      pick(block, "updated") ??
      pick(block, "dc:date");
    const desc =
      pick(block, "description") ??
      pick(block, "summary") ??
      pick(block, "content");
    items.push({
      sourceId: src.id,
      externalId: guid.slice(0, 500),
      title: title.slice(0, 1000),
      abstract: desc ? desc.slice(0, 4000) : null,
      url: link,
      publishedAt: parseDate(dateStr),
      rawMetadata: { feedKind: isAtom ? "atom" : "rss" },
    });
  }
  return items;
}

async function fetchArxiv(
  src: Source,
  limit: number,
): Promise<NewSourceItem[]> {
  const meta = (src.metadata ?? {}) as Record<string, unknown>;
  const searchQuery =
    typeof meta.searchQuery === "string"
      ? meta.searchQuery
      : `cat:${src.category ?? "physics.space-ph"}`;
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
    signal: AbortSignal.timeout(15_000),
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const xml = await res.text();
  const items: NewSourceItem[] = [];
  const re = /<entry\b[^>]*>([\s\S]*?)<\/entry>/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(xml)) !== null && items.length < limit) {
    const block = m[1];
    const id = pick(block, "id");
    const title = pick(block, "title");
    if (!id || !title) continue;
    const summary = pick(block, "summary");
    const published = pick(block, "published");
    const authors = pickAll(block, "name");
    const linkMatch = block.match(/<link\b[^>]*\bhref="([^"]+)"/i);
    const link = linkMatch ? linkMatch[1] : id;
    items.push({
      sourceId: src.id,
      externalId: id.slice(0, 500),
      title: title.slice(0, 1000),
      abstract: summary ? summary.slice(0, 4000) : null,
      authors: authors.length ? authors.slice(0, 20) : null,
      url: link,
      publishedAt: parseDate(published),
      rawMetadata: { searchQuery },
    });
  }
  return items;
}

async function fetchNtrs(
  src: Source,
  limit: number,
): Promise<NewSourceItem[]> {
  const meta = (src.metadata ?? {}) as Record<string, unknown>;
  const query =
    typeof meta.searchQuery === "string"
      ? meta.searchQuery
      : (src.category ?? "orbital debris");
  const res = await fetch("https://ntrs.nasa.gov/api/citations/search", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Accept: "application/json",
      "User-Agent": "thalamus-ssa-ingest/0.1",
    },
    body: JSON.stringify({
      q: query,
      page: { size: limit, from: 0 },
      sort: "publishedAt:desc",
    }),
    signal: AbortSignal.timeout(15_000),
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const json = (await res.json()) as { results?: any[] };
  const rows = json.results ?? [];
  const items: NewSourceItem[] = [];
  for (const r of rows.slice(0, limit)) {
    if (!r?.title || r?.id === undefined) continue;
    const externalId = String(r.id);
    const dateStr = r.publishedAt ?? r.publicationDate ?? r.publicDate ?? null;
    const authors: string[] = (r.authorAffiliations ?? [])
      .map((a: any) => a?.meta?.author?.name)
      .filter((n: unknown): n is string => Boolean(n))
      .slice(0, 20);
    const pdfLink = r.downloads?.[0]?.links?.pdf;
    const url = pdfLink
      ? `https://ntrs.nasa.gov${pdfLink.startsWith("/") ? "" : "/"}${pdfLink}`
      : `https://ntrs.nasa.gov/citations/${externalId}`;
    items.push({
      sourceId: src.id,
      externalId,
      title: String(r.title).slice(0, 1000),
      abstract: r.abstract ? String(r.abstract).slice(0, 4000) : null,
      authors: authors.length ? authors : null,
      url,
      publishedAt: parseDate(dateStr),
      rawMetadata: {
        query,
        stiType: r.stiType,
        center: r.center?.code,
      },
    });
  }
  return items;
}

// ─── Public seeding entrypoint ───────────────────────────────────────────────

export interface SourceSeedSummary {
  registered: number;
  fetched: number;
  failures: Array<{ slug: string; error: string }>;
}

export async function seedSources(
  db: NodePgDatabase<any>,
  perSourceLimit = 10,
): Promise<SourceSeedSummary> {
  // Register / upsert source rows
  for (const s of SOURCE_SEEDS) {
    await db
      .insert(source)
      .values({
        slug: s.slug,
        name: s.name,
        kind: s.kind,
        url: s.url,
        category: s.category ?? null,
        metadata: s.metadata ?? null,
        isEnabled: true,
      })
      .onConflictDoNothing({ target: source.slug });
  }

  // Reload to get ids
  const rows = (await db.select().from(source)) as Source[];
  const bySlug = new Map(rows.map((r) => [r.slug, r]));

  const failures: Array<{ slug: string; error: string }> = [];
  let totalItems = 0;

  for (const s of SOURCE_SEEDS) {
    const src = bySlug.get(s.slug);
    if (!src) continue;
    try {
      const items =
        s.kind === "rss"
          ? await fetchRss(src, perSourceLimit)
          : s.kind === "arxiv"
            ? await fetchArxiv(src, perSourceLimit)
            : await fetchNtrs(src, perSourceLimit);

      if (items.length > 0) {
        // Drizzle's onConflictDoNothing requires either no target or a pgUnique
        // — we registered a uniqueIndex on (source_id, external_id) and rely on
        // it via SQL composite target.
        for (const it of items) {
          await db
            .insert(sourceItem)
            .values(it)
            .onConflictDoNothing({
              target: [sourceItem.sourceId, sourceItem.externalId],
            });
        }
        totalItems += items.length;
      }

      await db
        .update(source)
        .set({ lastFetchedAt: new Date() })
        .where(sql`id = ${src.id}`);

      console.log(`  ✓ ${s.slug}: ${items.length} items`);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      failures.push({ slug: s.slug, error: msg });
      console.warn(`  ✗ ${s.slug}: ${msg}`);
    }
  }

  return {
    registered: SOURCE_SEEDS.length,
    fetched: totalItems,
    failures,
  };
}
