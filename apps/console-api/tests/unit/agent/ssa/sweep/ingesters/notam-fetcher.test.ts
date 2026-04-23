import { afterEach, describe, expect, it, vi } from "vitest";
import { createNotamSource } from "../../../../../../src/agent/ssa/sweep/ingesters/notam-fetcher";
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

describe("createNotamSource", () => {
  it("returns an HTTP note when the FAA endpoint responds non-2xx", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(jsonResponse({}, 502)));
    const db = makeDbDouble();
    const { ctx, logger } = makeRunContext();
    const source = createNotamSource(db.db);

    const result = await source.run(ctx);

    expect(result).toEqual({
      inserted: 0,
      skipped: 0,
      notes: "FAA HTTP 502",
    });
    expect(logger.warn).toHaveBeenCalledWith(
      { status: 502 },
      "FAA TFR endpoint returned non-2xx",
    );
  });

  it("stringifies FAA fetch failures into a note", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue("offline"));
    const db = makeDbDouble();
    const { ctx, logger } = makeRunContext();
    const source = createNotamSource(db.db);

    const result = await source.run(ctx);

    expect(result).toEqual({
      inserted: 0,
      skipped: 0,
      notes: "FAA fetch error: offline",
    });
    expect(logger.warn).toHaveBeenCalledWith(
      { err: "offline" },
      "FAA TFR fetch failed",
    );
  });

  it("uses err.message when FAA fetch rejects with a real Error", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("faa boom")));
    const db = makeDbDouble();
    const { ctx } = makeRunContext();
    const source = createNotamSource(db.db);

    const result = await source.run(ctx);

    expect(result.notes).toBe("FAA fetch error: faa boom");
  });

  it("returns a no-parseable note when the payload lacks required NOTAM fields", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        jsonResponse([{ notam_id: "X1", type: "SPACE OPERATIONS" }]),
      ),
    );
    const db = makeDbDouble();
    const { ctx } = makeRunContext();
    const source = createNotamSource(db.db);

    const result = await source.run(ctx);

    expect(result).toEqual({
      inserted: 0,
      skipped: 0,
      notes: "FAA returned no parseable TFRs",
    });
    expect(db.insertCalls).toHaveLength(0);
  });

  it("maps FAA rows, parses dates, and flags launch-related narratives", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-04-23T12:00:00.000Z"));
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        jsonResponse([
          {
            notam_id: "A1",
            type: "SPACE OPERATIONS",
            facility: "ZLA",
            state: "CA",
            description:
              "BLACK ROCK, NV, Sunday, April 19, 2026 through Monday, April 20, 2026 UTC",
            creation_date: "04/17/2026",
          },
          {
            notam_id: "B2",
            type: "AIRSHOW",
            facility: "ZJX",
            state: "FL",
            description:
              "CAPE CANAVERAL, FL, Saturday, April 18, 2026 UTC",
            creation_date: "bad-date",
          },
          {
            notam_id: "C3",
            type: "AIRSHOW",
          },
        ]),
      ),
    );
    const db = makeDbDouble({
      insertOutcomes: [{ rowCount: 1 }, { rowCount: 1 }],
    });
    const { ctx, logger } = makeRunContext();
    const source = createNotamSource(db.db);

    const result = await source.run(ctx);

    expect(result).toEqual({
      inserted: 2,
      skipped: 0,
      notes: "FAA TFR: 2 upserted (2 launch-related)",
    });
    expect(db.insertCalls).toHaveLength(2);
    expect(db.insertCalls[0]?.values).toMatchObject({
      notamId: "A1",
      type: "SPACE OPERATIONS",
      facility: "ZLA",
      state: "CA",
      creationDate: new Date("2026-04-17T00:00:00.000Z"),
      parsedStartUtc: new Date("2026-04-19T00:00:00.000Z"),
      parsedEndUtc: new Date("2026-04-20T23:59:59.000Z"),
      isLaunchRelated: true,
      source: "faa-tfr",
      fetchedAt: expect.any(Date),
    });
    expect(db.insertCalls[1]?.values).toMatchObject({
      notamId: "B2",
      creationDate: null,
      parsedStartUtc: new Date("2026-04-18T00:00:00.000Z"),
      parsedEndUtc: new Date("2026-04-18T23:59:59.000Z"),
      isLaunchRelated: true,
    });
    expect(logger.info).toHaveBeenCalledWith(
      {
        fetched: 3,
        mapped: 2,
        launchRelated: 2,
        types: ["SPACE OPERATIONS", "AIRSHOW"],
      },
      "FAA TFR fetch complete",
    );
  });

  it("maps sparse NOTAM rows with null fallbacks, unknown months, and missing rowCounts", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-04-23T12:00:00.000Z"));
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        jsonResponse([
          {
            notam_id: "D4",
            type: "AIRSPACE",
            description: "SMARCH RANGE, ZZ, Monday, Smarch 21, 2026 UTC",
          },
        ]),
      ),
    );
    const db = makeDbDouble({
      insertOutcomes: [{}],
    });
    const { ctx } = makeRunContext();
    const source = createNotamSource(db.db);

    const result = await source.run(ctx);

    expect(result).toEqual({
      inserted: 0,
      skipped: 1,
      notes: "FAA TFR: 1 upserted (0 launch-related)",
    });
    expect(db.insertCalls[0]?.values).toMatchObject({
      notamId: "D4",
      facility: null,
      state: null,
      creationDate: null,
      parsedStartUtc: null,
      parsedEndUtc: null,
      isLaunchRelated: false,
    });
  });
});
