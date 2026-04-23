import { afterEach, describe, expect, it, vi } from "vitest";
import { createSpaceWeatherSource } from "../../../../../../src/agent/ssa/sweep/ingesters/space-weather-fetcher";
import {
  jsonResponse,
  makeDbDouble,
  makeRunContext,
  textResponse,
} from "./__helpers";

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

describe("createSpaceWeatherSource", () => {
  it("ingests NOAA, GFZ, and SIDC rows and reports per-source totals", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-04-23T12:00:00.000Z"));
    vi.stubGlobal(
      "fetch",
      vi
        .fn()
        .mockResolvedValueOnce(
          textResponse(`:Issued: 2026 Apr 23 1230 UTC
2026 Apr 24      95           8          3`),
        )
        .mockResolvedValueOnce(
          jsonResponse({
            datetime: ["2026-04-23T00:00:00Z", "2026-04-23T03:00:00Z"],
            Kp: [4, null],
          }),
        )
        .mockResolvedValueOnce(
          textResponse(`2026,4,23,2026.31,123,0,0,0
2026,4,24,2026.32,-1,0,0,0`),
        ),
    );
    const db = makeDbDouble({
      insertOutcomes: [{ rowCount: 1 }, { rowCount: 1 }, { rowCount: 1 }],
    });
    const { ctx, logger } = makeRunContext();
    const source = createSpaceWeatherSource(db.db);

    const result = await source.run(ctx);

    expect(result).toEqual({
      inserted: 3,
      skipped: 0,
      notes: "noaa-swpc-27do: 1/1; gfz-kp: 1/1; sidc-eisn: 1/1",
    });
    expect(db.insertCalls).toHaveLength(3);
    expect(db.insertCalls[0]?.mode).toBe("nothing");
    expect(db.insertCalls[0]?.values).toEqual([
      expect.objectContaining({
        source: "noaa-swpc-27do",
        epoch: new Date("2026-04-24T00:00:00.000Z"),
        f107: 95,
        apIndex: 8,
        kpIndex: 3,
        issuedAt: new Date("2026-04-23T12:30:00.000Z"),
      }),
    ]);
    expect(db.insertCalls[1]?.values).toEqual([
      expect.objectContaining({
        source: "gfz-kp",
        epoch: new Date("2026-04-23T00:00:00.000Z"),
        kpIndex: 4,
        issuedAt: expect.any(Date),
      }),
    ]);
    expect(db.insertCalls[2]?.values).toEqual([
      expect.objectContaining({
        source: "sidc-eisn",
        epoch: new Date("2026-04-23T00:00:00.000Z"),
        sunspotNumber: 123,
        issuedAt: expect.any(Date),
      }),
    ]);
    expect(logger.info).toHaveBeenCalledWith(
      {
        perSource: {
          "noaa-swpc-27do": { fetched: 1, inserted: 1 },
          "gfz-kp": { fetched: 1, inserted: 1 },
          "sidc-eisn": { fetched: 1, inserted: 1 },
        },
      },
      "space-weather fetch complete",
    );
  });

  it("degrades to empty per-source counts when upstream fetches fail or return non-2xx", async () => {
    vi.stubGlobal(
      "fetch",
      vi
        .fn()
        .mockResolvedValueOnce(textResponse("down", 503))
        .mockRejectedValueOnce(new Error("gfz down"))
        .mockResolvedValueOnce(textResponse("down", 503)),
    );
    const db = makeDbDouble();
    const { ctx } = makeRunContext();
    const source = createSpaceWeatherSource(db.db);

    const result = await source.run(ctx);

    expect(result).toEqual({
      inserted: 0,
      skipped: 0,
      notes: "noaa-swpc-27do: 0/0; gfz-kp: 0/0; sidc-eisn: 0/0",
    });
    expect(db.insertCalls).toHaveLength(0);
  });

  it("treats text-fetch exceptions and GFZ non-2xx responses as empty sources", async () => {
    vi.stubGlobal(
      "fetch",
      vi
        .fn()
        .mockRejectedValueOnce(new Error("noaa down"))
        .mockResolvedValueOnce(textResponse("down", 503))
        .mockResolvedValueOnce(textResponse("down", 503)),
    );
    const db = makeDbDouble();
    const { ctx } = makeRunContext();
    const source = createSpaceWeatherSource(db.db);

    const result = await source.run(ctx);

    expect(result).toEqual({
      inserted: 0,
      skipped: 0,
      notes: "noaa-swpc-27do: 0/0; gfz-kp: 0/0; sidc-eisn: 0/0",
    });
  });

  it("treats a missing NOAA issued header and malformed GFZ payload as empty sources", async () => {
    vi.stubGlobal(
      "fetch",
      vi
        .fn()
        .mockResolvedValueOnce(textResponse("2026 Apr 24 95 8 3"))
        .mockResolvedValueOnce(jsonResponse({ nope: true }))
        .mockResolvedValueOnce(
          textResponse(`

bad
2026,4
nope,4,23,2026.31,10
2026,4,23,2026.31,123,0,0,0`),
        ),
    );
    const db = makeDbDouble({
      insertOutcomes: [{ rowCount: 1 }],
    });
    const { ctx } = makeRunContext();
    const source = createSpaceWeatherSource(db.db);

    const result = await source.run(ctx);

    expect(result).toEqual({
      inserted: 1,
      skipped: 0,
      notes: "noaa-swpc-27do: 0/0; gfz-kp: 0/0; sidc-eisn: 1/1",
    });
  });

  it("falls back to month index zero for unknown NOAA month abbreviations and missing rowCounts", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-04-23T12:00:00.000Z"));
    vi.stubGlobal(
      "fetch",
      vi
        .fn()
        .mockResolvedValueOnce(
          textResponse(`:Issued: 2026 Foo 23 1230 UTC
2026 Bar 24      95           8          3`),
        )
        .mockResolvedValueOnce(jsonResponse({ datetime: [], Kp: [] }))
        .mockResolvedValueOnce(textResponse("down", 503)),
    );
    const db = makeDbDouble({
      insertOutcomes: [{}],
    });
    const { ctx } = makeRunContext();
    const source = createSpaceWeatherSource(db.db);

    const result = await source.run(ctx);

    expect(result).toEqual({
      inserted: 0,
      skipped: 1,
      notes: "noaa-swpc-27do: 0/1; gfz-kp: 0/0; sidc-eisn: 0/0",
    });
    expect(db.insertCalls[0]?.values).toEqual([
      expect.objectContaining({
        source: "noaa-swpc-27do",
        epoch: new Date("2026-01-24T00:00:00.000Z"),
        issuedAt: new Date("2026-01-23T12:30:00.000Z"),
      }),
    ]);
  });

  it("isolates insert failures per source and keeps going", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-04-23T12:00:00.000Z"));
    vi.stubGlobal(
      "fetch",
      vi
        .fn()
        .mockResolvedValueOnce(
          textResponse(`:Issued: 2026 Apr 23 1230 UTC
2026 Apr 24      95           8          3`),
        )
        .mockResolvedValueOnce(
          jsonResponse({
            datetime: ["2026-04-23T00:00:00Z"],
            Kp: [4],
          }),
        )
        .mockResolvedValueOnce(
          textResponse(`2026,4,23,2026.31,123,0,0,0`),
        ),
    );
    const db = makeDbDouble({
      insertOutcomes: [
        { error: new Error("noaa insert failed") },
        { error: new Error("gfz insert failed") },
        { error: new Error("sidc insert failed") },
      ],
    });
    const { ctx, logger } = makeRunContext();
    const source = createSpaceWeatherSource(db.db);

    const result = await source.run(ctx);

    expect(result).toEqual({
      inserted: 0,
      skipped: 0,
      notes: "noaa-swpc-27do: 0/0; gfz-kp: 0/0; sidc-eisn: 0/0",
    });
    expect(logger.warn).toHaveBeenCalledTimes(3);
    expect(logger.warn).toHaveBeenNthCalledWith(
      1,
      { err: "noaa insert failed" },
      "NOAA SWPC ingest failed",
    );
    expect(logger.warn).toHaveBeenNthCalledWith(
      2,
      { err: "gfz insert failed" },
      "GFZ Potsdam ingest failed",
    );
    expect(logger.warn).toHaveBeenNthCalledWith(
      3,
      { err: "sidc insert failed" },
      "SIDC EISN ingest failed",
    );
  });

  it("stringifies non-Error insert failures independently for each source", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-04-23T12:00:00.000Z"));
    vi.stubGlobal(
      "fetch",
      vi
        .fn()
        .mockResolvedValueOnce(
          textResponse(`:Issued: 2026 Apr 23 1230 UTC
2026 Apr 24      95           8          3`),
        )
        .mockResolvedValueOnce(
          jsonResponse({
            datetime: ["2026-04-23T00:00:00Z"],
            Kp: [4],
          }),
        )
        .mockResolvedValueOnce(textResponse(`2026,4,23,2026.31,123,0,0,0`)),
    );
    const db = makeDbDouble({
      insertOutcomes: [
        { error: "noaa string" },
        { error: "gfz string" },
        { error: "sidc string" },
      ],
    });
    const { ctx, logger } = makeRunContext();
    const source = createSpaceWeatherSource(db.db);

    const result = await source.run(ctx);

    expect(result).toEqual({
      inserted: 0,
      skipped: 0,
      notes: "noaa-swpc-27do: 0/0; gfz-kp: 0/0; sidc-eisn: 0/0",
    });
    expect(logger.warn).toHaveBeenNthCalledWith(
      1,
      { err: "noaa string" },
      "NOAA SWPC ingest failed",
    );
    expect(logger.warn).toHaveBeenNthCalledWith(
      2,
      { err: "gfz string" },
      "GFZ Potsdam ingest failed",
    );
    expect(logger.warn).toHaveBeenNthCalledWith(
      3,
      { err: "sidc string" },
      "SIDC EISN ingest failed",
    );
  });
});
