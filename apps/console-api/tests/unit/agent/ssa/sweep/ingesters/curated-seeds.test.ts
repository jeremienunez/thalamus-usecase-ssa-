import { describe, it, expect } from "vitest";
import { createFragmentationEventsSource } from "../../../../../../src/agent/ssa/sweep/ingesters/fragmentation-events-fetcher";
import { createItuFilingsSource } from "../../../../../../src/agent/ssa/sweep/ingesters/itu-filings-fetcher";
import { makeDbDouble, makeRunContext } from "./__helpers";

describe("createFragmentationEventsSource", () => {
  it("upserts the curated breakup catalog and counts missing rowCount as skipped", async () => {
    const db = makeDbDouble({
      insertOutcomes: [{}, { rowCount: 1 }],
    });
    const { ctx, logger } = makeRunContext();
    const source = createFragmentationEventsSource(db.db);

    const result = await source.run(ctx);

    expect(source.id).toBe("fragmentation-events");
    expect(db.insertCalls.length).toBeGreaterThan(10);
    expect(result.inserted).toBe(db.insertCalls.length - 1);
    expect(result.skipped).toBe(1);
    expect(result.notes).toMatch(/^Curated seed:/);
    expect(db.insertCalls[0]?.mode).toBe("update");
    expect(db.insertCalls[0]?.values).toMatchObject({
      source: "curated",
      fetchedAt: expect.any(Date),
    });
    expect(logger.info).toHaveBeenCalledWith(
      expect.objectContaining({
        inserted: result.inserted,
        total: db.insertCalls.length,
      }),
      "fragmentation-events seed complete",
    );
  });
});

describe("createItuFilingsSource", () => {
  it("upserts the curated ITU filings and reports planned-satellite totals", async () => {
    const db = makeDbDouble({
      insertOutcomes: [{}, { rowCount: 1 }],
    });
    const { ctx, logger } = makeRunContext();
    const source = createItuFilingsSource(db.db);

    const result = await source.run(ctx);

    expect(source.id).toBe("itu-filings");
    expect(db.insertCalls.length).toBeGreaterThan(10);
    expect(result.inserted).toBe(db.insertCalls.length - 1);
    expect(result.skipped).toBe(1);
    expect(result.notes).toMatch(/^Curated seed:/);
    expect(db.insertCalls[0]?.mode).toBe("update");
    expect(db.insertCalls[0]?.values).toMatchObject({
      source: "curated",
      fetchedAt: expect.any(Date),
    });
    expect(logger.info).toHaveBeenCalledWith(
      expect.objectContaining({
        inserted: result.inserted,
        total: db.insertCalls.length,
        totalPlannedSatellites: expect.any(Number),
        countries: expect.any(Number),
      }),
      "itu-filings seed complete",
    );
  });
});
