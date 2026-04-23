import { afterEach, describe, expect, it, vi } from "vitest";
import { createLaunchManifestSource } from "../../../../../../src/agent/ssa/sweep/ingesters/launch-manifest-fetcher";
import {
  jsonResponse,
  makeDbDouble,
  makeRunContext,
} from "./__helpers";

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

describe("createLaunchManifestSource", () => {
  it("returns an HTTP note when Launch Library 2 responds non-2xx", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(jsonResponse({}, 503)));
    const db = makeDbDouble();
    const { ctx, logger } = makeRunContext();
    const source = createLaunchManifestSource(db.db);

    const result = await source.run(ctx);

    expect(result).toEqual({
      inserted: 0,
      skipped: 0,
      notes: "LL2 HTTP 503",
    });
    expect(logger.warn).toHaveBeenCalledWith(
      { status: 503 },
      "LL2 upcoming endpoint returned non-2xx",
    );
  });

  it("stringifies fetch failures into the result note", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue("offline"));
    const db = makeDbDouble();
    const { ctx, logger } = makeRunContext();
    const source = createLaunchManifestSource(db.db);

    const result = await source.run(ctx);

    expect(result).toEqual({
      inserted: 0,
      skipped: 0,
      notes: "LL2 fetch error: offline",
    });
    expect(logger.warn).toHaveBeenCalledWith(
      { err: "offline" },
      "LL2 fetch failed",
    );
  });

  it("uses err.message when Launch Library 2 throws a real Error", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("ll2 boom")));
    const db = makeDbDouble();
    const { ctx } = makeRunContext();
    const source = createLaunchManifestSource(db.db);

    const result = await source.run(ctx);

    expect(result.notes).toBe("LL2 fetch error: ll2 boom");
  });

  it("returns a no-usable-launches note when every launch is missing required ids", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        jsonResponse({
          count: 1,
          results: [{ name: "Missing ID", net: "2027-01-01T00:00:00Z" }],
        }),
      ),
    );
    const db = makeDbDouble();
    const { ctx } = makeRunContext();
    const source = createLaunchManifestSource(db.db);

    const result = await source.run(ctx);

    expect(result).toEqual({
      inserted: 0,
      skipped: 0,
      notes: "LL2 returned no usable launches",
    });
    expect(db.insertCalls).toHaveLength(0);
    expect(db.updateCalls).toHaveLength(0);
  });

  it("defaults missing results and count to empty values", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(jsonResponse({})));
    const db = makeDbDouble();
    const { ctx, logger } = makeRunContext();
    const source = createLaunchManifestSource(db.db);

    const result = await source.run(ctx);

    expect(result).toEqual({
      inserted: 0,
      skipped: 0,
      notes: "LL2 returned no usable launches",
    });
    expect(logger.info).toHaveBeenCalledWith(
      { count: 0, mapped: 0 },
      "LL2 upcoming fetched",
    );
  });

  it("maps launches, upserts them, and marks stale LL2 rows", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-04-23T12:00:00.000Z"));
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        jsonResponse({
          count: 2,
          results: [
            {
              id: "ll2-1",
              name: "Falcon 9 Transporter",
              net: "2027-02-03T10:11:12Z",
              window_start: "not-a-date",
              window_end: "2027-02-03T11:22:33Z",
              status: { abbrev: "TBC" },
              launch_service_provider: {
                name: "SpaceX",
                country: [{ name: "USA" }],
              },
              rocket: { configuration: { name: "Falcon 9" } },
              pad: {
                name: "SLC-40",
                location: { name: "CCSFS" },
              },
              mission: {
                name: "Bandwagon",
                description: "Bandwagon rideshare mission",
                orbit: { abbrev: "LEO" },
              },
            },
            {
              name: "Broken launch",
            },
          ],
        }),
      ),
    );
    const db = makeDbDouble({
      insertOutcomes: [{ rowCount: 1 }],
      updateOutcomes: [{ rowCount: 2 }],
    });
    const { ctx, logger } = makeRunContext();
    const source = createLaunchManifestSource(db.db);

    const result = await source.run(ctx);

    expect(result).toEqual({
      inserted: 1,
      skipped: 0,
      notes: "LL2: 1 upcoming launches upserted; 2 stale rows marked",
    });
    expect(db.insertCalls).toHaveLength(1);
    expect(db.updateCalls).toHaveLength(1);
    expect(db.insertCalls[0]?.mode).toBe("update");
    expect(db.insertCalls[0]?.values).toMatchObject({
      externalLaunchId: "ll2-1",
      name: "Falcon 9 Transporter",
      vehicle: "Falcon 9",
      operatorName: "SpaceX",
      operatorCountry: "USA",
      padName: "SLC-40",
      padLocation: "CCSFS",
      year: 2027,
      status: "TBC",
      orbitName: "LEO",
      missionName: "Bandwagon",
      rideshare: true,
      plannedWindowStart: null,
      plannedWindowEnd: new Date("2027-02-03T11:22:33.000Z"),
      fetchedAt: expect.any(Date),
    });
    expect(logger.info).toHaveBeenCalledWith(
      { count: 2, mapped: 1 },
      "LL2 upcoming fetched",
    );
  });

  it("maps sparse launches with null fallbacks, current-year defaulting, and missing rowCounts", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-04-23T12:00:00.000Z"));
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        jsonResponse({
          count: 3,
          results: [
            { id: "ll2-transporter", name: "Transporter-15" },
            {
              id: "ll2-bandwagon",
              name: "Mission",
              mission: { name: "Bandwagon" },
            },
            { id: "ll2-sparse", name: "Mystery mission" },
          ],
        }),
      ),
    );
    const db = makeDbDouble({
      insertOutcomes: [{}, {}, {}],
      updateOutcomes: [{}],
    });
    const { ctx } = makeRunContext();
    const source = createLaunchManifestSource(db.db);

    const result = await source.run(ctx);

    expect(result).toEqual({
      inserted: 0,
      skipped: 3,
      notes: "LL2: 3 upcoming launches upserted; 0 stale rows marked",
    });
    expect(db.insertCalls[0]?.values).toMatchObject({
      externalLaunchId: "ll2-transporter",
      year: 2026,
      operatorName: null,
      operatorCountry: null,
      padName: null,
      padLocation: null,
      vehicle: null,
      status: null,
      orbitName: null,
      missionName: null,
      missionDescription: null,
      rideshare: true,
    });
    expect(db.insertCalls[1]?.values).toMatchObject({
      externalLaunchId: "ll2-bandwagon",
      rideshare: true,
      missionName: "Bandwagon",
    });
    expect(db.insertCalls[2]?.values).toMatchObject({
      externalLaunchId: "ll2-sparse",
      rideshare: false,
    });
  });
});
