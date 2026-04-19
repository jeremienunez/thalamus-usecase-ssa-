/**
 * SeeSat-L fetcher — pure parsing tests. No network.
 *
 * Fixtures are embedded here to keep the test self-contained. Every TLE is
 * well-known public data: Starlink L4-17 (48274), ISS (25544), Landsat-9
 * (49260). SeeSat publishes these triplets; we just verify we extract them.
 */

import { describe, it, expect } from "vitest";
import {
  extractTleTriplets,
  parseSeesatMessage,
  extractMessageLinks,
} from "../../../../../src/agent/ssa/sources/fetcher-seesat";

describe("SeeSat — TLE triplet extraction", () => {
  it("pulls TLE triplets out of prose", () => {
    const body = `Hi all,

Last night I picked up the object below near the horizon.
Reconstructed elements:

USA 245
1 39232U 13043A   24092.77777777  .00000123  00000-0  12345-4 0  9990
2 39232  97.9013 123.4560 0006789 234.5670  67.8900 14.76543210123456

Elevation was 45°. Best, -M

STARLINK 4-17
1 48274U 21044AS  24092.66666666  .00002345  00000-0  78901-3 0  9991
2 48274  53.0543 210.9876 0001234  45.6789 314.3210 15.12345678901234

Cheers.`;

    const triplets = extractTleTriplets(body);
    expect(triplets).toHaveLength(2);
    expect(triplets[0].name).toBe("USA 245");
    expect(triplets[0].line1.slice(2, 7)).toBe("39232");
    expect(triplets[1].name).toBe("STARLINK 4-17");
    expect(triplets[1].line1.slice(2, 7)).toBe("48274");
  });

  it("rejects triplets whose TLE line1/line2 sat numbers disagree", () => {
    const body = `BROKEN PAIR
1 25544U 98067A   24092.66666666  .00002345  00000-0  78901-3 0  9991
2 39232  53.0543 210.9876 0001234  45.6789 314.3210 15.12345678901234`;

    expect(extractTleTriplets(body)).toHaveLength(0);
  });

  it("ignores sub-68-char lines that look like TLEs", () => {
    const body = `TOO SHORT
1 25544U 98067A
2 25544  51.6400 123.00`;

    expect(extractTleTriplets(body)).toHaveLength(0);
  });
});

describe("SeeSat — parseSeesatMessage → NewAmateurTrack[]", () => {
  it("populates citation/observer/date from the supplied context", () => {
    const body = `ISS (ZARYA)
1 25544U 98067A   24092.77777777  .00002345  00000-0  78901-3 0  9991
2 25544  51.6400 123.4560 0001234 234.5670  67.8900 15.49999999 12345`;

    const rows = parseSeesatMessage(body, {
      sourceId: 42n,
      messageUrl: "https://satobs.org/seesat/Apr-2026/msg00099.html",
      from: "Ted Molczan <tm@example.com>",
      date: new Date("2026-04-02T14:00:00Z"),
    });

    expect(rows).toHaveLength(1);
    const row = rows[0];
    expect(row.sourceId).toBe(42n);
    expect(row.candidateNoradId).toBe(25544);
    expect(row.candidateCospar).toBe("1998-067A");
    expect(row.observerHandle).toBe("Ted Molczan <tm@example.com>");
    expect(row.citationUrl).toBe(
      "https://satobs.org/seesat/Apr-2026/msg00099.html",
    );
    expect(row.tleLine1?.startsWith("1 25544U")).toBe(true);
    expect(row.tleLine2?.startsWith("2 25544")).toBe(true);
    expect(row.rawExcerpt).toContain("ISS (ZARYA)");
    expect(row.observedAt).toEqual(new Date("2026-04-02T14:00:00Z"));
  });

  it("handles COSPAR year rollover (> 56 → 19xx, <= 56 → 20xx)", () => {
    const body = `LEGACY
1 01234U 62027A   24092.77777777  .00000000  00000-0  00000-0 0    01
2 01234  97.9013 123.4560 0006789 234.5670  67.8900 14.76543210123456

MODERN
1 56789U 23055Q   24092.66666666  .00002345  00000-0  78901-3 0  9991
2 56789  53.0543 210.9876 0001234  45.6789 314.3210 15.12345678901234`;

    const rows = parseSeesatMessage(body, {
      sourceId: 1n,
      messageUrl: "https://example.com/m",
      from: null,
      date: new Date("2026-04-14"),
    });

    expect(rows).toHaveLength(2);
    expect(rows[0].candidateCospar).toBe("1962-027A");
    expect(rows[1].candidateCospar).toBe("2023-055Q");
  });

  it("returns an empty array for messages with no TLEs", () => {
    const body = `Hi everyone, just a text-only heads-up about nothing useful.`;

    const rows = parseSeesatMessage(body, {
      sourceId: 1n,
      messageUrl: "https://example.com/m",
      from: null,
      date: new Date(),
    });

    expect(rows).toHaveLength(0);
  });
});

describe("SeeSat — extractMessageLinks", () => {
  it("resolves relative msgNNNNN.html anchors against the archive base URL", () => {
    const indexUrl = "https://satobs.org/seesat/Apr-2026/";
    const indexHtml = `
      <html><body>
        <a href="msg00001.html">First</a>
        <a href="msg00042.html">Forty-two</a>
        <a href="../Mar-2026/msg00010.html">Prev month</a>
        <a href="https://elsewhere.invalid/msg99999.html">External</a>
      </body></html>`;

    const links = extractMessageLinks(indexUrl, indexHtml);
    expect(links).toEqual([
      "https://satobs.org/seesat/Apr-2026/msg00001.html",
      "https://satobs.org/seesat/Apr-2026/msg00042.html",
    ]);
  });
});
