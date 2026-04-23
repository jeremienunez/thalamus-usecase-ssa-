import { afterEach, describe, expect, it, vi } from "vitest";
import { source, sourceItem, type Source } from "../src/schema/source";
import {
  SOURCE_SEEDS,
  fetchArxiv,
  fetchNtrs,
  fetchRss,
  parseDate,
  seedSources,
} from "../src/seed/sources";

function makeSourceFixture(
  overrides: Partial<Source> = {},
): Source {
  return {
    id: 1n,
    name: "Fixture Source",
    slug: "fixture-source",
    kind: "rss",
    url: "https://example.test/feed.xml",
    category: "news",
    isEnabled: true,
    lastFetchedAt: null,
    metadata: null,
    createdAt: new Date("2026-04-23T12:00:00.000Z"),
    ...overrides,
  };
}

function invokeSeedSources(db: object, perSourceLimit = 10) {
  return Reflect.apply(seedSources, null, [db, perSourceLimit]);
}

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe("source seed helpers", () => {
  it("parses dates and returns null for missing or invalid inputs", () => {
    expect(parseDate("2026-04-23T12:00:00.000Z")?.toISOString()).toBe(
      "2026-04-23T12:00:00.000Z",
    );
    expect(parseDate("not-a-date")).toBeNull();
    expect(parseDate(undefined)).toBeNull();
    expect(parseDate(null)).toBeNull();
  });

  it("parses RSS items with guid, date, and description fallbacks", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => ({
        ok: true,
        text: async () => `<?xml version="1.0"?>
          <rss>
            <channel>
              <item>
                <title>First Item</title>
                <link>https://example.test/first</link>
                <guid>guid-first</guid>
                <pubDate>2026-04-20T10:00:00.000Z</pubDate>
                <description>Alpha description</description>
              </item>
              <item>
                <title>Second Item</title>
                <link>https://example.test/second</link>
                <updated>not-a-date</updated>
                <content>Fallback content body</content>
              </item>
              <item>
                <title>Title Only Item</title>
              </item>
              <item>
                <description>No title means skip</description>
              </item>
            </channel>
          </rss>`,
      })),
    );

    const items = await fetchRss(
      makeSourceFixture({ id: 11n, slug: "rss-source" }),
      5,
    );

    expect(items).toEqual([
      {
        sourceId: 11n,
        externalId: "guid-first",
        title: "First Item",
        abstract: "Alpha description",
        url: "https://example.test/first",
        publishedAt: new Date("2026-04-20T10:00:00.000Z"),
        rawMetadata: { feedKind: "rss" },
      },
      {
        sourceId: 11n,
        externalId: "https://example.test/second",
        title: "Second Item",
        abstract: "Fallback content body",
        url: "https://example.test/second",
        publishedAt: null,
        rawMetadata: { feedKind: "rss" },
      },
      {
        sourceId: 11n,
        externalId: "Title Only Item",
        title: "Title Only Item",
        abstract: null,
        url: null,
        publishedAt: null,
        rawMetadata: { feedKind: "rss" },
      },
    ]);
  });

  it("parses Atom feeds with href links, id fallback, and summary fallback", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => ({
        ok: true,
        text: async () => `<?xml version="1.0"?>
          <feed>
            <entry>
              <title>Atom One</title>
              <link href="https://example.test/atom-1" />
              <id>atom-1</id>
              <published>2026-04-21T08:30:00.000Z</published>
              <summary>Atom summary</summary>
            </entry>
            <entry>
              <title>Atom Two</title>
              <link href="https://example.test/atom-2" />
              <dc:date>2026-04-22T09:45:00.000Z</dc:date>
            </entry>
          </feed>`,
      })),
    );

    const items = await fetchRss(
      makeSourceFixture({ id: 12n, slug: "atom-source", url: "https://example.test/atom.xml" }),
      2,
    );

    expect(items).toEqual([
      {
        sourceId: 12n,
        externalId: "atom-1",
        title: "Atom One",
        abstract: "Atom summary",
        url: "https://example.test/atom-1",
        publishedAt: new Date("2026-04-21T08:30:00.000Z"),
        rawMetadata: { feedKind: "atom" },
      },
      {
        sourceId: 12n,
        externalId: "https://example.test/atom-2",
        title: "Atom Two",
        abstract: null,
        url: "https://example.test/atom-2",
        publishedAt: new Date("2026-04-22T09:45:00.000Z"),
        rawMetadata: { feedKind: "atom" },
      },
    ]);
  });

  it("throws on non-ok RSS responses", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => ({
        ok: false,
        status: 503,
      })),
    );

    await expect(
      fetchRss(makeSourceFixture({ slug: "rss-fail" }), 1),
    ).rejects.toThrow("HTTP 503");
  });

  it("parses arXiv entries and uses metadata searchQuery when present", async () => {
    const fetchMock = vi.fn(async (input: string | URL) => ({
      ok: true,
      text: async () => `<?xml version="1.0"?>
        <feed>
          <entry>
            <id>arxiv:1</id>
            <title>Paper One</title>
            <summary>Deep summary</summary>
            <published>2026-04-19T07:00:00.000Z</published>
            <author><name>Alice</name></author>
            <author><name>Bob</name></author>
            <link href="https://arxiv.org/abs/1" />
          </entry>
          <entry>
            <id>missing-title</id>
          </entry>
        </feed>`,
    }));
    vi.stubGlobal("fetch", fetchMock);

    const items = await fetchArxiv(
      makeSourceFixture({
        id: 21n,
        kind: "arxiv",
        slug: "arxiv-source",
        metadata: { searchQuery: "all:\"space debris\"" },
      }),
      3,
    );

    const calledUrl = new URL(String(fetchMock.mock.calls[0]?.[0]));
    expect(calledUrl.searchParams.get("search_query")).toBe('all:"space debris"');
    expect(calledUrl.searchParams.get("max_results")).toBe("3");
    expect(items).toEqual([
      {
        sourceId: 21n,
        externalId: "arxiv:1",
        title: "Paper One",
        abstract: "Deep summary",
        authors: ["Alice", "Bob"],
        url: "https://arxiv.org/abs/1",
        publishedAt: new Date("2026-04-19T07:00:00.000Z"),
        rawMetadata: { searchQuery: 'all:"space debris"' },
      },
    ]);
  });

  it("falls back to category-driven arXiv queries and id links when link tags are absent", async () => {
    const fetchMock = vi.fn(async () => ({
      ok: true,
      text: async () => `<?xml version="1.0"?>
          <feed>
            <entry>
              <id>arxiv:2</id>
              <title>Paper Two</title>
              <updated>not-a-date</updated>
            </entry>
            <entry>
              <title>Missing ID</title>
            </entry>
          </feed>`,
    }));
    vi.stubGlobal("fetch", fetchMock);

    const items = await fetchArxiv(
      makeSourceFixture({
        id: 22n,
        kind: "arxiv",
        slug: "arxiv-fallback",
        category: null,
        metadata: null,
      }),
      2,
    );

    const calledUrl = new URL(String(fetchMock.mock.calls[0]?.[0]));
    expect(calledUrl.searchParams.get("search_query")).toBe("cat:physics.space-ph");
    expect(items).toEqual([
      {
        sourceId: 22n,
        externalId: "arxiv:2",
        title: "Paper Two",
        abstract: null,
        authors: null,
        url: "arxiv:2",
        publishedAt: null,
        rawMetadata: { searchQuery: "cat:physics.space-ph" },
      },
    ]);
  });

  it("uses default orbital debris queries, publicDate, and slash-prefixed PDF links for NTRS", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => ({
        ok: true,
        json: async () => ({
          results: [
            {
              id: 99,
              title: "Default Query",
              publicDate: "2026-04-16T04:00:00.000Z",
              downloads: [{ links: { pdf: "/docs/99.pdf" } }],
            },
            {
              id: 100,
              title: "No Date",
            },
          ],
        }),
      })),
    );

    const items = await fetchNtrs(
      makeSourceFixture({
        id: 32n,
        kind: "ntrs",
        slug: "ntrs-default",
        category: null,
        metadata: null,
      }),
      4,
    );

    expect(items).toEqual([
      {
        sourceId: 32n,
        externalId: "99",
        title: "Default Query",
        abstract: null,
        authors: null,
        url: "https://ntrs.nasa.gov/docs/99.pdf",
        publishedAt: new Date("2026-04-16T04:00:00.000Z"),
        rawMetadata: {
          query: "orbital debris",
          stiType: undefined,
          center: undefined,
        },
      },
      {
        sourceId: 32n,
        externalId: "100",
        title: "No Date",
        abstract: null,
        authors: null,
        url: "https://ntrs.nasa.gov/citations/100",
        publishedAt: null,
        rawMetadata: {
          query: "orbital debris",
          stiType: undefined,
          center: undefined,
        },
      },
    ]);
  });

  it("throws on non-ok arXiv responses", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => ({
        ok: false,
        status: 429,
      })),
    );

    await expect(
      fetchArxiv(makeSourceFixture({ kind: "arxiv", metadata: null }), 1),
    ).rejects.toThrow("HTTP 429");
  });

  it("parses NTRS rows with query metadata, author filtering, and PDF links", async () => {
    const fetchMock = vi.fn(async (_input: string | URL, init?: RequestInit) => ({
      ok: true,
      json: async () => ({
        results: [
          {
            id: 77,
            title: "Debris Assessment",
            abstract: "NTRS abstract",
            publishedAt: "2026-04-18T06:00:00.000Z",
            authorAffiliations: [
              { meta: { author: { name: "Carol" } } },
              { meta: { author: { name: "" } } },
              { meta: {} },
            ],
            downloads: [{ links: { pdf: "documents/77.pdf" } }],
            stiType: "Report",
            center: { code: "JSC" },
          },
          {
            id: 88,
            title: "Fallback Citation",
            publicationDate: "2026-04-17T05:00:00.000Z",
            authorAffiliations: [],
            downloads: [],
          },
          {
            id: undefined,
            title: "Skip me",
          },
        ],
      }),
    }));
    vi.stubGlobal("fetch", fetchMock);

    const items = await fetchNtrs(
      makeSourceFixture({
        id: 31n,
        kind: "ntrs",
        slug: "ntrs-source",
        metadata: { searchQuery: "orbital debris" },
      }),
      5,
    );

    const body = JSON.parse(String(fetchMock.mock.calls[0]?.[1]?.body));
    expect(body).toEqual({
      q: "orbital debris",
      page: { size: 5, from: 0 },
      sort: "publishedAt:desc",
    });
    expect(items).toEqual([
      {
        sourceId: 31n,
        externalId: "77",
        title: "Debris Assessment",
        abstract: "NTRS abstract",
        authors: ["Carol"],
        url: "https://ntrs.nasa.gov/documents/77.pdf",
        publishedAt: new Date("2026-04-18T06:00:00.000Z"),
        rawMetadata: {
          query: "orbital debris",
          stiType: "Report",
          center: "JSC",
        },
      },
      {
        sourceId: 31n,
        externalId: "88",
        title: "Fallback Citation",
        abstract: null,
        authors: null,
        url: "https://ntrs.nasa.gov/citations/88",
        publishedAt: new Date("2026-04-17T05:00:00.000Z"),
        rawMetadata: {
          query: "orbital debris",
          stiType: undefined,
          center: undefined,
        },
      },
    ]);
  });

  it("falls back to category-driven NTRS queries and handles empty result sets", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => ({
        ok: true,
        json: async () => ({}),
      })),
    );

    const items = await fetchNtrs(
      makeSourceFixture({
        id: 32n,
        kind: "ntrs",
        slug: "ntrs-fallback",
        category: "amateur-osint",
        metadata: null,
      }),
      4,
    );

    expect(items).toEqual([]);
  });

  it("throws on non-ok NTRS responses", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => ({
        ok: false,
        status: 500,
      })),
    );

    await expect(
      fetchNtrs(makeSourceFixture({ kind: "ntrs", metadata: null }), 2),
    ).rejects.toThrow("HTTP 500");
  });
});

describe("seedSources", () => {
  it("registers sources, skips missing rows, stores fetched items, updates timestamps, and records failures", async () => {
    const originalSeeds = [...SOURCE_SEEDS];
    SOURCE_SEEDS.splice(
      0,
      SOURCE_SEEDS.length,
      {
        slug: "rss-good",
        name: "RSS Good",
        kind: "rss",
        url: "https://example.test/rss",
        category: "news",
      },
      {
        slug: "arxiv-good",
        name: "arXiv Good",
        kind: "arxiv",
        url: "http://export.arxiv.org/api/query?search_query=cat:test",
        category: "physics.space-ph",
        metadata: { searchQuery: "cat:test" },
      },
      {
        slug: "ntrs-empty",
        name: "NTRS Empty",
        kind: "ntrs",
        url: "https://ntrs.nasa.gov/api/citations/search",
        category: "orbital-debris",
      },
      {
        slug: "osint-fail",
        name: "OSINT Fail",
        kind: "osint",
        url: "https://satobs.org/seesat/",
        category: "catalog-drift",
      },
      {
        slug: "rss-error",
        name: "RSS Error",
        kind: "rss",
        url: "https://example.test/rss-error",
        category: "news",
      },
      {
        slug: "rss-missing",
        name: "Missing Row",
        kind: "rss",
        url: "https://example.test/missing",
      },
    );

    const fetchMock = vi.fn(async (input: string | URL) => {
      const url = String(input);
      if (url === "https://example.test/rss") {
        return {
          ok: true,
          text: async () => `<?xml version="1.0"?>
            <rss><channel><item><title>RSS Item</title><link>https://example.test/a</link></item></channel></rss>`,
        };
      }
      if (url.startsWith("http://export.arxiv.org/api/query")) {
        return {
          ok: true,
          text: async () => `<?xml version="1.0"?>
            <feed><entry><id>arxiv:seed</id><title>Seed Paper</title></entry></feed>`,
        };
      }
      if (url === "https://example.test/rss-error") {
        return {
          ok: false,
          status: 503,
        };
      }
      const body = JSON.parse(
        String(fetchMock.mock.calls.at(-1)?.[1]?.body ?? "{}"),
      ) as { q?: string };
      if (body.q === "orbital-debris") {
        return {
          ok: true,
          json: async () => ({ results: [] }),
        };
      }
      throw "upstream exploded";
    });
    vi.stubGlobal("fetch", fetchMock);

    const sourceRows: Source[] = [
      makeSourceFixture({
        id: 101n,
        slug: "rss-good",
        name: "RSS Good",
        url: "https://example.test/rss",
      }),
      makeSourceFixture({
        id: 102n,
        slug: "arxiv-good",
        kind: "arxiv",
        name: "arXiv Good",
        url: "http://export.arxiv.org/api/query?search_query=cat:test",
        metadata: { searchQuery: "cat:test" },
      }),
      makeSourceFixture({
        id: 103n,
        slug: "ntrs-empty",
        kind: "ntrs",
        name: "NTRS Empty",
        url: "https://ntrs.nasa.gov/api/citations/search",
        category: "orbital-debris",
      }),
      makeSourceFixture({
        id: 104n,
        slug: "osint-fail",
        kind: "osint",
        name: "OSINT Fail",
        url: "https://satobs.org/seesat/",
        category: "catalog-drift",
      }),
      makeSourceFixture({
        id: 105n,
        slug: "rss-error",
        name: "RSS Error",
        url: "https://example.test/rss-error",
      }),
    ];

    const registeredRows: Array<Record<string, unknown>> = [];
    const itemRows: Array<Record<string, unknown>> = [];
    const updateRows: Array<Record<string, unknown>> = [];
    const registrationTargets: unknown[] = [];
    const itemTargets: unknown[] = [];

    const db = {
      insert(table: object) {
        if (table === source) {
          return {
            values(value: Record<string, unknown>) {
              return {
                async onConflictDoNothing(options: Record<string, unknown>) {
                  registeredRows.push(value);
                  registrationTargets.push(options.target);
                },
              };
            },
          };
        }
        if (table === sourceItem) {
          return {
            values(value: Record<string, unknown>) {
              return {
                async onConflictDoNothing(options: Record<string, unknown>) {
                  itemRows.push(value);
                  itemTargets.push(options.target);
                },
              };
            },
          };
        }
        throw new Error("unexpected insert table");
      },
      select() {
        return {
          async from(table: object) {
            expect(table).toBe(source);
            return sourceRows;
          },
        };
      },
      update(table: object) {
        expect(table).toBe(source);
        return {
          set(value: Record<string, unknown>) {
            return {
              async where(condition: unknown) {
                updateRows.push({ value, condition });
              },
            };
          },
        };
      },
    };

    const logSpy = vi.spyOn(console, "log").mockImplementation(() => undefined);
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => undefined);

    try {
      const summary = await invokeSeedSources(db, 3);

      expect(summary).toEqual({
        registered: 6,
        fetched: 2,
        failures: [
          { slug: "osint-fail", error: "upstream exploded" },
          { slug: "rss-error", error: "HTTP 503" },
        ],
      });
      expect(registeredRows).toHaveLength(6);
      expect(registeredRows[0]).toMatchObject({
        slug: "rss-good",
        isEnabled: true,
        category: "news",
      });
      expect(registeredRows[3]).toMatchObject({
        slug: "osint-fail",
        metadata: null,
      });
      expect(registeredRows[4]).toMatchObject({
        slug: "rss-error",
        category: "news",
      });
      expect(registeredRows[5]).toMatchObject({
        slug: "rss-missing",
        category: null,
      });
      expect(registrationTargets.every((target) => target === source.slug)).toBe(true);
      expect(itemRows).toEqual([
        expect.objectContaining({
          sourceId: 101n,
          externalId: "https://example.test/a",
          title: "RSS Item",
        }),
        expect.objectContaining({
          sourceId: 102n,
          externalId: "arxiv:seed",
          title: "Seed Paper",
        }),
      ]);
      expect(
        itemTargets.every(
          (target) =>
            Array.isArray(target) &&
            target[0] === sourceItem.sourceId &&
            target[1] === sourceItem.externalId,
        ),
      ).toBe(true);
      expect(updateRows).toHaveLength(3);
      expect(
        updateRows.every(
          (entry) => entry.value.lastFetchedAt instanceof Date,
        ),
      ).toBe(true);
      expect(logSpy).toHaveBeenCalledWith("  ✓ rss-good: 1 items");
      expect(logSpy).toHaveBeenCalledWith("  ✓ arxiv-good: 1 items");
      expect(logSpy).toHaveBeenCalledWith("  ✓ ntrs-empty: 0 items");
      expect(warnSpy).toHaveBeenCalledWith("  ✗ osint-fail: upstream exploded");
      expect(warnSpy).toHaveBeenCalledWith("  ✗ rss-error: HTTP 503");
    } finally {
      SOURCE_SEEDS.splice(0, SOURCE_SEEDS.length, ...originalSeeds);
    }
  });
});
