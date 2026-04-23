import { afterEach, describe, expect, it, vi } from "vitest";
import type { Source } from "@interview/db-schema";
import { SourceKind } from "@interview/shared";
import {
  fetchArxivSource,
  fetchNtrsSource,
  fetchRssSource,
} from "../../../../../src/agent/ssa/sources";

function makeSource(overrides: Partial<Source> = {}): Source {
  return {
    id: 1n,
    name: "Test Source",
    slug: "test-source",
    kind: SourceKind.Rss,
    url: "https://example.test/feed.xml",
    category: null,
    isEnabled: true,
    lastFetchedAt: null,
    metadata: null,
    createdAt: new Date("2026-04-01T00:00:00.000Z"),
    ...overrides,
  };
}

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

function textResponse(body: string, status = 200): Response {
  return new Response(body, {
    status,
    headers: { "content-type": "text/plain" },
  });
}

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe("arXiv fetcher", () => {
  it("parses Atom entries, honors metadata search queries, and skips malformed entries", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      textResponse(`<?xml version="1.0" encoding="utf-8"?>
        <feed xmlns="http://www.w3.org/2005/Atom">
          <entry>
            <id>http://arxiv.org/abs/1234.5678v1</id>
            <title>Tracking conjunctions</title>
            <summary>Orbital risk summary</summary>
            <published>2026-04-20T10:00:00Z</published>
            <author><name>Alice</name></author>
            <author><name>Bob</name></author>
            <link href="https://arxiv.org/abs/1234.5678v1" />
          </entry>
          <entry>
            <id>http://arxiv.org/abs/9999.0001v1</id>
            <title>Fallback link</title>
            <published>not-a-date</published>
          </entry>
          <entry>
            <id>http://arxiv.org/abs/should-skip</id>
          </entry>
        </feed>`),
    );
    vi.stubGlobal("fetch", fetchMock);

    const out = await fetchArxivSource(
      makeSource({
        kind: SourceKind.Arxiv,
        slug: "arxiv-latest",
        metadata: { searchQuery: "cat:astro-ph.HE" },
      }),
      { limit: 2, timeoutMs: 777 },
    );

    expect(String(fetchMock.mock.calls[0]?.[0])).toContain(
      "search_query=cat%3Aastro-ph.HE",
    );
    expect(String(fetchMock.mock.calls[0]?.[0])).toContain("max_results=2");
    expect(fetchMock.mock.calls[0]?.[1]).toEqual(
      expect.objectContaining({
        headers: expect.objectContaining({
          Accept: "application/atom+xml",
          "User-Agent": "thalamus-ssa-ingest/0.1",
        }),
        signal: expect.anything(),
      }),
    );

    expect(out).toHaveLength(2);
    expect(out[0]).toMatchObject({
      sourceId: 1n,
      externalId: "http://arxiv.org/abs/1234.5678v1",
      title: "Tracking conjunctions",
      abstract: "Orbital risk summary",
      authors: ["Alice", "Bob"],
      url: "https://arxiv.org/abs/1234.5678v1",
      rawMetadata: { searchQuery: "cat:astro-ph.HE" },
    });
    expect(out[0]?.publishedAt).toEqual(new Date("2026-04-20T10:00:00.000Z"));
    expect(out[1]).toMatchObject({
      externalId: "http://arxiv.org/abs/9999.0001v1",
      title: "Fallback link",
      abstract: null,
      authors: null,
      url: "http://arxiv.org/abs/9999.0001v1",
    });
    expect(out[1]?.publishedAt).toBeNull();
  });

  it("uses the source category as the arXiv query and throws on non-ok responses", async () => {
    const fetchMock = vi.fn().mockResolvedValue(textResponse("down", 503));
    vi.stubGlobal("fetch", fetchMock);

    await expect(
      fetchArxivSource(
        makeSource({
          kind: SourceKind.Arxiv,
          slug: "arxiv-risk",
          category: "orbital.debris",
        }),
      ),
    ).rejects.toThrow(/arXiv arxiv-risk HTTP 503/);

    expect(String(fetchMock.mock.calls[0]?.[0])).toContain(
      "search_query=cat%3Aorbital.debris",
    );
  });

  it("uses the built-in default category and tolerates entries without ids, titles, or timestamps", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      textResponse(`<?xml version="1.0" encoding="utf-8"?>
        <feed xmlns="http://www.w3.org/2005/Atom">
          <entry>
            <id>http://arxiv.org/abs/skip-me</id>
          </entry>
          <entry>
            <id>http://arxiv.org/abs/3333.4444v1</id>
            <title>No published date</title>
          </entry>
        </feed>`),
    );
    vi.stubGlobal("fetch", fetchMock);

    const out = await fetchArxivSource(
      makeSource({
        kind: SourceKind.Arxiv,
        slug: "arxiv-default",
      }),
      { limit: 5 },
    );

    expect(String(fetchMock.mock.calls[0]?.[0])).toContain(
      "search_query=cat%3Aphysics.space-ph",
    );
    expect(out).toEqual([
      expect.objectContaining({
        externalId: "http://arxiv.org/abs/3333.4444v1",
        title: "No published date",
        publishedAt: null,
      }),
    ]);
  });
});

describe("RSS fetcher", () => {
  it("parses RSS items, falls back to title-derived external ids, and truncates to the requested limit", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      textResponse(`<?xml version="1.0"?>
        <rss version="2.0">
          <channel>
            <item>
              <title>Launch manifest</title>
              <link>https://example.test/launch</link>
              <guid>launch-1</guid>
              <pubDate>Tue, 22 Apr 2026 12:00:00 GMT</pubDate>
              <description>Manifest details</description>
            </item>
            <item>
              <title>${"T".repeat(250)}</title>
              <dc:date>not-a-date</dc:date>
            </item>
            <item>
              <link>https://example.test/skip-me</link>
            </item>
          </channel>
        </rss>`),
    );
    vi.stubGlobal("fetch", fetchMock);

    const out = await fetchRssSource(
      makeSource({
        slug: "rss-launches",
      }),
      { limit: 2, timeoutMs: 456 },
    );

    expect(fetchMock.mock.calls[0]?.[1]).toEqual(
      expect.objectContaining({
        headers: expect.objectContaining({
          Accept:
            "application/rss+xml, application/atom+xml, application/xml, */*",
          "User-Agent": "thalamus-ssa-ingest/0.1",
        }),
        signal: expect.anything(),
      }),
    );
    expect(out).toHaveLength(2);
    expect(out[0]).toMatchObject({
      externalId: "launch-1",
      title: "Launch manifest",
      abstract: "Manifest details",
      url: "https://example.test/launch",
      rawMetadata: { feedKind: "rss" },
    });
    expect(out[0]?.publishedAt).toEqual(new Date("2026-04-22T12:00:00.000Z"));
    expect(out[1]?.externalId).toBe("T".repeat(200));
    expect(out[1]?.abstract).toBeNull();
    expect(out[1]?.url).toBeNull();
    expect(out[1]?.publishedAt).toBeNull();
  });

  it("parses Atom entries with link href attributes and summary fallbacks", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      textResponse(`<?xml version="1.0"?>
        <feed xmlns="http://www.w3.org/2005/Atom">
          <entry>
            <title>Atom summary</title>
            <id>tag:example.test,2026:1</id>
            <link href="https://example.test/atom-1" />
            <published>2026-04-21T10:30:00Z</published>
            <summary>Atom body</summary>
          </entry>
          <entry>
            <title>Atom content</title>
            <id>tag:example.test,2026:2</id>
            <link href="https://example.test/atom-2" />
            <updated>2026-04-21T11:30:00Z</updated>
            <content>Rendered content</content>
          </entry>
        </feed>`),
    );
    vi.stubGlobal("fetch", fetchMock);

    const out = await fetchRssSource(
      makeSource({ url: "https://example.test/atom.xml" }),
    );

    expect(out).toHaveLength(2);
    expect(out[0]).toMatchObject({
      externalId: "tag:example.test,2026:1",
      abstract: "Atom body",
      url: "https://example.test/atom-1",
      rawMetadata: { feedKind: "atom" },
    });
    expect(out[1]).toMatchObject({
      externalId: "tag:example.test,2026:2",
      abstract: "Rendered content",
      url: "https://example.test/atom-2",
    });
  });

  it("throws with the source slug when the feed endpoint is not ok", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(textResponse("nope", 502)));

    await expect(
      fetchRssSource(makeSource({ slug: "rss-broken" })),
    ).rejects.toThrow(/RSS rss-broken HTTP 502/);
  });

  it("skips title-less entries and returns null when no feed date exists", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      textResponse(`<?xml version="1.0"?>
        <rss version="2.0">
          <channel>
            <item>
              <link>https://example.test/skip</link>
            </item>
            <item>
              <title>Untimed entry</title>
            </item>
          </channel>
        </rss>`),
    );
    vi.stubGlobal("fetch", fetchMock);

    const out = await fetchRssSource(makeSource(), { limit: 5 });

    expect(out).toEqual([
      expect.objectContaining({
        title: "Untimed entry",
        publishedAt: null,
      }),
    ]);
  });
});

describe("NTRS fetcher", () => {
  it("posts the expected body, maps authors and pdf links, and skips malformed rows", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      jsonResponse({
        results: [
          {
            id: 101,
            title: "Debris mitigation study",
            abstract: "Study abstract",
            publishedAt: "2026-04-18T08:00:00Z",
            authorAffiliations: [
              { meta: { author: { name: "Ada Lovelace" } } },
              { meta: { author: { name: "Katherine Johnson" } } },
            ],
            downloads: [{ links: { pdf: "/archive/nasa-101.pdf" } }],
            stiType: "REPORT",
            center: { code: "JSC" },
          },
          {
            id: "NTRS-202",
            title: "Fallback citation url",
            publicDate: "not-a-date",
            downloads: [],
            authorAffiliations: [{ meta: { author: {} } }],
            center: { code: "GSFC" },
          },
          {
            id: 303,
          },
        ],
      }),
    );
    vi.stubGlobal("fetch", fetchMock);

    const out = await fetchNtrsSource(
      makeSource({
        kind: SourceKind.Ntrs,
        slug: "ntrs-reports",
        category: "orbital debris",
        metadata: { searchQuery: "orbital debris collision avoidance" },
      }),
      { limit: 2, timeoutMs: 999 },
    );

    expect(fetchMock.mock.calls[0]?.[0]).toBe(
      "https://ntrs.nasa.gov/api/citations/search",
    );
    expect(fetchMock.mock.calls[0]?.[1]).toEqual(
      expect.objectContaining({
        method: "POST",
        headers: expect.objectContaining({
          "Content-Type": "application/json",
          Accept: "application/json",
          "User-Agent": "thalamus-ssa-ingest/0.1",
        }),
        signal: expect.anything(),
      }),
    );
    expect(
      JSON.parse(String(fetchMock.mock.calls[0]?.[1]?.body)),
    ).toMatchObject({
      q: "orbital debris collision avoidance",
      page: { size: 2, from: 0 },
      sort: "publishedAt:desc",
    });

    expect(out).toHaveLength(2);
    expect(out[0]).toMatchObject({
      externalId: "101",
      title: "Debris mitigation study",
      abstract: "Study abstract",
      authors: ["Ada Lovelace", "Katherine Johnson"],
      url: "https://ntrs.nasa.gov/archive/nasa-101.pdf",
      rawMetadata: {
        query: "orbital debris collision avoidance",
        stiType: "REPORT",
        center: "JSC",
      },
    });
    expect(out[0]?.publishedAt).toEqual(new Date("2026-04-18T08:00:00.000Z"));
    expect(out[1]).toMatchObject({
      externalId: "NTRS-202",
      title: "Fallback citation url",
      authors: null,
      url: "https://ntrs.nasa.gov/citations/NTRS-202",
      rawMetadata: {
        query: "orbital debris collision avoidance",
        stiType: undefined,
        center: "GSFC",
      },
    });
    expect(out[1]?.publishedAt).toBeNull();
  });

  it("uses the source category as the NTRS query and throws on non-ok responses", async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse({}, 500));
    vi.stubGlobal("fetch", fetchMock);

    await expect(
      fetchNtrsSource(
        makeSource({
          kind: SourceKind.Ntrs,
          slug: "ntrs-broken",
          category: "launch windows",
        }),
      ),
    ).rejects.toThrow(/NTRS ntrs-broken HTTP 500/);

    expect(
      JSON.parse(String(fetchMock.mock.calls[0]?.[1]?.body)),
    ).toMatchObject({
      q: "launch windows",
    });
  });

  it("uses the built-in fallback query, tolerates missing result arrays, and handles undated rows with relative pdf paths", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse({}))
      .mockResolvedValueOnce(
        jsonResponse({
          results: [
            {
              id: 404,
              title: "Relative PDF",
              downloads: [{ links: { pdf: "archive/relative.pdf" } }],
            },
            {
              id: 505,
            },
          ],
        }),
      );
    vi.stubGlobal("fetch", fetchMock);

    const source = makeSource({
      kind: SourceKind.Ntrs,
      slug: "ntrs-default",
      category: null,
    });

    await expect(fetchNtrsSource(source)).resolves.toEqual([]);
    const out = await fetchNtrsSource(source);

    expect(
      JSON.parse(String(fetchMock.mock.calls[0]?.[1]?.body)),
    ).toMatchObject({
      q: "orbital debris",
    });
    expect(out).toEqual([
      expect.objectContaining({
        externalId: "404",
        title: "Relative PDF",
        authors: null,
        url: "https://ntrs.nasa.gov/archive/relative.pdf",
        publishedAt: null,
      }),
    ]);
  });
});
