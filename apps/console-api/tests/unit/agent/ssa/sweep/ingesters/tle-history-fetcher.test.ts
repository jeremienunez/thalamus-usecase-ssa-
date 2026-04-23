import { afterEach, describe, expect, it, vi } from "vitest";
import { createTleHistorySource } from "../../../../../../src/agent/ssa/sweep/ingesters/tle-history-fetcher";
import {
  makeDbDouble,
  makeRunContext,
  textResponse,
} from "./__helpers";

const olderIssTle = `ISS (ZARYA)
1 25544U 98067A   26114.12345678  .00016717  00000+0  10270-3 0  9990
2 25544  51.6416  89.1234 0006703  69.0504  32.1234 15.50000000123456
`;

const newerIssTle = `ISS (ZARYA)
1 25544U 98067A   26115.12345678  .00016717  00000+0  10270-3 0  9990
2 25544  51.6416  90.1234 0006703  70.0504  33.1234 15.60000000123456
`;

const unmatchedTle = `UNMATCHED SAT
1 99999U 24001A   26113.00000000  .00000000  00000+0  00000-0 0  9991
2 99999  98.7000 120.0000 0010000 180.0000  10.0000 14.20000000123456
`;

const legacyAndMalformedTles = `LEGACY SAT
1 25544U 98067A   98115.00000000  .00000000  00000+0 -12345-3 0  9991
2 25544  51.6416  91.0000 0006703  71.0000  34.0000 15.70000000123456
LEGACY SAT OLDER
1 25544U 98067A   98114.00000000  .00000000  00000+0 -12345-3 0  9991
2 25544  51.6416  80.0000 0006703  60.0000  24.0000 15.10000000123456
BAD NORAD
1 XXXXXU 24001A   26113.00000000  .00000000  00000+0  00000-0 0  9991
2 12345  98.7000 120.0000 0010000 180.0000  10.0000 14.20000000123456
BAD ORBIT
1 12345U 24001A   26113.00000000  .00000000  00000+0  00000-0 0  9991
2 12345  XX.XXXX 120.0000 0010000 180.0000  10.0000 14.20000000123456
BSTAR ZERO
1 99999U 24001A   26113.00000000  .00000000  00000+0  ABCDE   0  9991
2 99999  98.7000 120.0000 0010000 180.0000  10.0000 14.20000000123456
`;

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe("createTleHistorySource", () => {
  it("returns an empty result when every group yields no usable TLEs", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(textResponse("down", 503)));
    const db = makeDbDouble();
    const { ctx } = makeRunContext();
    const source = createTleHistorySource(db.db);

    const result = await source.run(ctx);

    expect(result).toEqual({
      inserted: 0,
      skipped: 0,
      notes: "All 40 groups failed — no TLEs fetched",
    });
    expect(db.executeCalls).toHaveLength(0);
    expect(db.insertCalls).toHaveLength(0);
  });

  it("deduplicates NORAD ids across groups, keeps the newest epoch, and reports unmatched catalog rows", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn((url: string | URL) => {
        const raw = String(url);
        if (raw.includes("GROUP=stations")) {
          return Promise.resolve(textResponse(olderIssTle));
        }
        if (raw.includes("GROUP=starlink")) {
          return Promise.resolve(textResponse(newerIssTle));
        }
        if (raw.includes("GROUP=oneweb")) {
          return Promise.resolve(textResponse(unmatchedTle));
        }
        if (raw.includes("GROUP=iridium-next")) {
          return Promise.reject(new Error("group timeout"));
        }
        return Promise.resolve(textResponse(""));
      }),
    );
    const db = makeDbDouble({
      insertOutcomes: [{}],
      executeOutcomes: [
        {
          rows: [{ id: "900", norad_id: 25544 }],
          rowCount: 1,
        },
      ],
    });
    const { ctx, logger } = makeRunContext();
    const source = createTleHistorySource(db.db);

    const result = await source.run(ctx);

    expect(result).toEqual({
      inserted: 0,
      skipped: 1,
      notes: "2 unique TLEs from 39/40 groups; 1 NORADs not in catalog",
    });
    expect(db.executeCalls).toHaveLength(1);
    expect(db.insertCalls).toHaveLength(1);
    expect(db.insertCalls[0]?.mode).toBe("nothing");
    expect(db.insertCalls[0]?.values).toEqual([
      expect.objectContaining({
        satelliteId: 900n,
        noradId: 25544,
        meanMotion: 15.6,
        eccentricity: 0.0006703,
        inclinationDeg: 51.6416,
        raan: 90.1234,
        argOfPerigee: 70.0504,
        meanAnomaly: 33.1234,
        bstar: expect.any(Number),
        epoch: expect.any(Date),
      }),
    ]);
    expect(logger.warn).toHaveBeenCalledWith(
      { group: "iridium-next", err: "group timeout" },
      "CelesTrak group fetch failed",
    );
    expect(logger.info).toHaveBeenCalledWith(
      {
        groupsFetched: 39,
        groupsFailed: 1,
        uniqueNorads: 2,
      },
      "CelesTrak fetch complete",
    );
  });

  it("skips malformed TLE blocks, keeps older duplicates out, and handles legacy epochs plus string fetch errors", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn((url: string | URL) => {
        const raw = String(url);
        if (raw.includes("GROUP=stations")) {
          return Promise.resolve(textResponse(legacyAndMalformedTles));
        }
        if (raw.includes("GROUP=starlink")) {
          return Promise.reject("string timeout");
        }
        return Promise.resolve(textResponse(""));
      }),
    );
    const db = makeDbDouble({
      insertOutcomes: [{ rowCount: 1 }],
      executeOutcomes: [
        {
          rows: [
            { id: "900", norad_id: 25544 },
            { id: "901", norad_id: null },
          ],
          rowCount: 2,
        },
      ],
    });
    const { ctx, logger } = makeRunContext();
    const source = createTleHistorySource(db.db);

    const result = await source.run(ctx);

    expect(result).toEqual({
      inserted: 1,
      skipped: 0,
      notes: "2 unique TLEs from 39/40 groups; 1 NORADs not in catalog",
    });
    expect(db.insertCalls[0]?.values).toEqual([
      expect.objectContaining({
        satelliteId: 900n,
        noradId: 25544,
        meanMotion: 15.7,
        raan: 91,
        bstar: expect.closeTo(-0.00012345, 12),
        epoch: new Date("1998-04-25T00:00:00.000Z"),
      }),
    ]);
    expect(logger.warn).toHaveBeenCalledWith(
      { group: "starlink", err: "string timeout" },
      "CelesTrak group fetch failed",
    );
  });
});
