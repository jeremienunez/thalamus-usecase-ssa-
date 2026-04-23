import { setTimeout as delay } from "node:timers/promises";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it, vi } from "vitest";

interface SeedIndexLoadOptions {
  argvThrows?: boolean;
  celestrakUrl?: string;
  countsRow?: Record<string, number>;
  enrichGcatResult?: { massBackfill: number; busBackfill: number; updatesApplied: number } | Error;
  fetchResult?: { ok: boolean; text?: string; status?: number; statusText?: string };
  scriptArg?: string | null;
  seedConjunctionsResult?: { screened: number; candidates: number; inserted: number } | Error;
  seedCount?: string;
  seedSourcesResult?: {
    registered: number;
    fetched: number;
    failures: Array<{ slug: string; error: string }>;
  } | Error;
  satelliteInsertFailures?: Set<string>;
}

const SCRIPT_PATH = fileURLToPath(
  new URL("../src/seed/index.ts", import.meta.url),
);
const DB_ENV_KEY = ["DATABASE", "URL"].join("_");

const SAMPLE_TLE_LINE_1 =
  "1 25544U 98067A   26113.50000000  .00001264  00000+0  29669-4 0  9995";
const SAMPLE_TLE_LINE_2 =
  "2 25544  51.6434  42.2123 0003050  91.7000  12.8000 15.49000000 00001";

function makeTleBlock(name: string, noradId: number, intlPrefix = "98"): string {
  const norad = String(noradId).padStart(5, "0");
  const line1 = `1 ${norad}U ${intlPrefix}067A   26113.50000000  .00001264  00000+0  29669-4 0  9995`;
  const line2 = `2 ${norad}  51.6434  42.2123 0003050  91.7000  12.8000 15.49000000 00001`;
  return `${name}\n${line1}\n${line2}`;
}

async function flushAsyncWork(): Promise<void> {
  await delay(0);
}

async function waitForCondition(
  label: string,
  predicate: () => boolean,
): Promise<void> {
  for (let i = 0; i < 60; i++) {
    if (predicate()) return;
    await flushAsyncWork();
  }
  throw new Error(`timed out waiting for ${label}`);
}

async function loadSeedIndexScript({
  argvThrows = false,
  celestrakUrl = "https://celestrak.test/active.tle",
  countsRow = {
    satellites: 41,
    operators: 23,
    countries: 14,
    regimes: 6,
    platforms: 6,
  },
  enrichGcatResult = {
    massBackfill: 3,
    busBackfill: 2,
    updatesApplied: 4,
  },
  fetchResult = {
    ok: true,
    text: [
      makeTleBlock("STARLINK-1000", 25544),
      makeTleBlock("MYSTERY SAT", 25545),
      "BROKEN\nbad\nbad",
    ].join("\n"),
    status: 200,
    statusText: "OK",
  },
  seedConjunctionsResult = {
    screened: 45,
    candidates: 3,
    inserted: 2,
  },
  scriptArg = SCRIPT_PATH,
  seedCount = "10",
  seedSourcesResult = {
    registered: 3,
    fetched: 9,
    failures: [{ slug: "ntrs", error: "timeout" }],
  },
  satelliteInsertFailures = new Set<string>(),
}: SeedIndexLoadOptions = {}) {
  vi.resetModules();

  const originalArgv = process.argv;
  const originalExit = process.exit;
  const previousDatabaseUrl = process.env[DB_ENV_KEY];
  const previousUrl = process.env.CELESTRAK_URL;
  const previousSeedCount = process.env.SEED_COUNT;

  delete process.env[DB_ENV_KEY];
  process.env.CELESTRAK_URL = celestrakUrl;
  process.env.SEED_COUNT = seedCount;

  if (argvThrows) {
    Object.defineProperty(process, "argv", {
      configurable: true,
      get: () => {
        throw new Error("argv exploded");
      },
    });
  } else {
    Object.defineProperty(process, "argv", {
      configurable: true,
      value: scriptArg === null ? ["/usr/bin/node"] : ["/usr/bin/node", scriptArg],
    });
  }

  const exitMock = vi.fn();
  Object.defineProperty(process, "exit", {
    configurable: true,
    value: exitMock,
  });

  const orbitRegimeTable = { table: "orbitRegime" };
  const platformClassTable = { table: "platformClass" };
  const operatorCountryTable = { table: "operatorCountry" };
  const operatorTable = { table: "operator" };
  const satelliteTable = { table: "satellite" };

  const insertedRows = new Map<object, unknown[]>([
    [orbitRegimeTable, []],
    [platformClassTable, []],
    [operatorCountryTable, []],
    [operatorTable, []],
    [satelliteTable, []],
  ]);
  const satelliteRows = insertedRows.get(satelliteTable)!;

  const insert = vi.fn((table: object) => ({
    values: (row: unknown) => ({
      onConflictDoNothing: async () => {
        insertedRows.get(table)?.push(row);
        if (
          table === satelliteTable &&
          typeof row === "object" &&
          row !== null &&
          "name" in row &&
          satelliteInsertFailures.has(String(row.name))
        ) {
          throw new Error("duplicate satellite");
        }
      },
    }),
  }));

  const select = vi.fn(() => ({
    from: async (table: object) => {
      if (table === orbitRegimeTable) {
        return [
          { id: 1n, name: "Low Earth Orbit" },
          { id: 2n, name: "Medium Earth Orbit" },
          { id: 3n, name: "Geostationary Orbit" },
          { id: 4n, name: "Highly Elliptical Orbit" },
          { id: 5n, name: "Sun-Synchronous Orbit" },
          { id: 6n, name: "Geostationary Transfer Orbit" },
        ];
      }
      if (table === operatorCountryTable) {
        return [{ id: 11n, slug: "us" }];
      }
      if (table === operatorTable) {
        return [{ id: 21n, slug: "spacex" }];
      }
      return [];
    },
  }));

  const execute = vi.fn(async () => ({
    rows: [countsRow],
  }));

  const db = { insert, select, execute };
  const drizzle = vi.fn(() => db);

  const poolEnd = vi.fn(async () => undefined);
  const PoolMock = vi.fn(function MockPool() {
    return { end: poolEnd };
  });

  const fetchMock = vi.fn(async () => ({
    ok: fetchResult.ok,
    status: fetchResult.status ?? 200,
    statusText: fetchResult.statusText ?? "OK",
    text: async () => fetchResult.text ?? "",
  }));

  const seedSources = vi.fn(async () => {
    if (seedSourcesResult instanceof Error) throw seedSourcesResult;
    return seedSourcesResult;
  });
  const seedConjunctions = vi.fn(async () => {
    if (seedConjunctionsResult instanceof Error) throw seedConjunctionsResult;
    return seedConjunctionsResult;
  });
  const enrichGcat = vi.fn(async () => {
    if (enrichGcatResult instanceof Error) throw enrichGcatResult;
    return enrichGcatResult;
  });

  const logSpy = vi.spyOn(console, "log").mockImplementation(() => undefined);
  const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => undefined);
  const errorSpy = vi.spyOn(console, "error").mockImplementation(() => undefined);

  vi.stubGlobal("fetch", fetchMock);
  vi.doMock("pg", () => ({
    Pool: PoolMock,
  }));
  vi.doMock("drizzle-orm/node-postgres", () => ({
    drizzle,
  }));
  vi.doMock("../src/schema", () => ({
    orbitRegime: orbitRegimeTable,
    platformClass: platformClassTable,
    operatorCountry: operatorCountryTable,
    operator: operatorTable,
    satellite: satelliteTable,
  }));
  vi.doMock("../src/seed/sources", () => ({
    seedSources,
  }));
  vi.doMock("../src/seed/conjunctions", () => ({
    seedConjunctions,
  }));
  vi.doMock("../src/seed/enrich-gcat", () => ({
    enrichGcat,
  }));

  await import("../src/seed/index");

  return {
    PoolMock,
    db,
    errorSpy,
    execute,
    exitMock,
    fetchMock,
    insertedRows,
    logSpy,
    poolEnd,
    restore: () => {
      Object.defineProperty(process, "argv", {
        configurable: true,
        value: originalArgv,
      });
      Object.defineProperty(process, "exit", {
        configurable: true,
        value: originalExit,
      });
      if (previousDatabaseUrl === undefined) delete process.env[DB_ENV_KEY];
      else process.env[DB_ENV_KEY] = previousDatabaseUrl;
      if (previousUrl === undefined) delete process.env.CELESTRAK_URL;
      else process.env.CELESTRAK_URL = previousUrl;
      if (previousSeedCount === undefined) delete process.env.SEED_COUNT;
      else process.env.SEED_COUNT = previousSeedCount;
    },
    seedConjunctions,
    seedSources,
    satelliteRows,
    warnSpy,
    enrichGcat,
  };
}

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe("seed index script", () => {
  it("seeds reference data, inserts satellites, and runs follow-up enrichment steps", async () => {
    const run = await loadSeedIndexScript({
      satelliteInsertFailures: new Set(["MYSTERY SAT"]),
    });

    try {
      await waitForCondition("pool end", () => run.poolEnd.mock.calls.length === 1);

      expect(run.PoolMock).toHaveBeenCalledWith({
        connectionString: "postgres://thalamus:thalamus@localhost:5433/thalamus",
      });
      expect(run.fetchMock).toHaveBeenCalledWith("https://celestrak.test/active.tle");
      expect(run.seedSources).toHaveBeenCalledWith(run.db);
      expect(run.seedConjunctions).toHaveBeenCalledWith(run.db);
      expect(run.enrichGcat).toHaveBeenCalledWith(run.db);
      expect(run.execute).toHaveBeenCalledTimes(1);
      expect(run.logSpy).toHaveBeenCalledWith("▸ parsed 2 TLEs");
      expect(run.logSpy).toHaveBeenCalledWith("✓ inserted/kept 1 satellites");
      expect(run.logSpy).toHaveBeenCalledWith("▸ final counts:", {
        satellites: 41,
        operators: 23,
        countries: 14,
        regimes: 6,
        platforms: 6,
      });
      expect(run.logSpy).toHaveBeenCalledWith(
        "✓ sources: 3 registered, 9 items fetched, 1 failures",
      );
      expect(run.logSpy).toHaveBeenCalledWith(
        "✓ conjunctions: 2 inserted from 3 candidates (45 pairs screened)",
      );
      expect(run.logSpy).toHaveBeenCalledWith(
        "✓ GCAT: 3 mass backfills, 2 bus backfills, 4 rows updated",
      );
      expect(run.logSpy).toHaveBeenCalledWith("✓ seed complete");
      expect(run.warnSpy).toHaveBeenCalledWith(
        "  skipped",
        "MYSTERY SAT",
        "→",
        "duplicate satellite",
      );
      expect(run.warnSpy).toHaveBeenCalledWith("  - ntrs: timeout");
      expect(run.errorSpy).not.toHaveBeenCalled();
      expect(run.exitMock).not.toHaveBeenCalled();

      expect(run.satelliteRows).toHaveLength(2);
      expect(run.satelliteRows[0]).toMatchObject({
        name: "STARLINK-1000",
        operatorCountryId: 11n,
        operatorId: 21n,
        noradId: 25544,
      });
      expect(run.satelliteRows[1]).toMatchObject({
        name: "MYSTERY SAT",
        operatorCountryId: null,
        operatorId: null,
        noradId: 25545,
      });
      expect(run.satelliteRows[1]?.telemetrySummary).toMatchObject({
        regime: "leo",
        tleLine1: expect.stringContaining("25545"),
        tleLine2: expect.stringContaining("25545"),
      });
    } finally {
      run.restore();
    }
  });

  it("warns and continues when source, conjunction, and GCAT enrichment steps fail", async () => {
    const run = await loadSeedIndexScript({
      enrichGcatResult: new Error("gcat down"),
      seedConjunctionsResult: new Error("sgp4 down"),
      seedSourcesResult: new Error("rss down"),
    });

    try {
      await waitForCondition("pool end", () => run.poolEnd.mock.calls.length === 1);

      expect(run.warnSpy).toHaveBeenCalledWith("⚠ source seeding failed:", "rss down");
      expect(run.warnSpy).toHaveBeenCalledWith("⚠ conjunction seeding failed:", "sgp4 down");
      expect(run.warnSpy).toHaveBeenCalledWith("⚠ GCAT enrichment failed:", "gcat down");
      expect(run.logSpy).toHaveBeenCalledWith("✓ seed complete");
      expect(run.errorSpy).not.toHaveBeenCalled();
      expect(run.exitMock).not.toHaveBeenCalled();
    } finally {
      run.restore();
    }
  });

  it("supports the .js entrypoint, stops at SEED_COUNT, and skips failure bullets on clean source runs", async () => {
    const run = await loadSeedIndexScript({
      fetchResult: {
        ok: true,
        text: makeTleBlock("MYSTERY SAT", 25545, "AA"),
      },
      scriptArg: "/tmp/seed/index.js",
      seedCount: "1",
      seedSourcesResult: {
        registered: 1,
        fetched: 2,
        failures: [],
      },
    });

    try {
      await waitForCondition("pool end", () => run.poolEnd.mock.calls.length === 1);

      expect(run.logSpy).toHaveBeenCalledWith("▸ parsed 1 TLEs");
      expect(run.satelliteRows).toHaveLength(1);
      expect(run.satelliteRows[0]).toMatchObject({
        launchYear: null,
      });
      expect(run.logSpy).toHaveBeenCalledWith(
        "✓ sources: 1 registered, 2 items fetched, 0 failures",
      );
      expect(
        run.warnSpy.mock.calls.some(
          ([message]) => typeof message === "string" && message.startsWith("  - "),
        ),
      ).toBe(false);
      expect(run.errorSpy).not.toHaveBeenCalled();
      expect(run.exitMock).not.toHaveBeenCalled();
    } finally {
      run.restore();
    }
  });

  it("logs and exits when direct-run seeding fails before completion", async () => {
    const run = await loadSeedIndexScript({
      fetchResult: {
        ok: false,
        status: 503,
        statusText: "Service Unavailable",
      },
    });

    try {
      await waitForCondition("process exit", () => run.exitMock.mock.calls.length === 1);

      expect(run.fetchMock).toHaveBeenCalledTimes(1);
      expect(run.poolEnd).not.toHaveBeenCalled();
      expect(run.errorSpy).toHaveBeenCalledWith(
        "✗ seed failed:",
        expect.objectContaining({
          message: "CelesTrak fetch failed: 503 Service Unavailable",
        }),
      );
      expect(run.exitMock).toHaveBeenCalledWith(1);
    } finally {
      run.restore();
    }
  });

  it("treats argv access failures as non-direct imports", async () => {
    const run = await loadSeedIndexScript({
      argvThrows: true,
    });

    try {
      await flushAsyncWork();

      expect(run.PoolMock).not.toHaveBeenCalled();
      expect(run.fetchMock).not.toHaveBeenCalled();
      expect(run.errorSpy).not.toHaveBeenCalled();
      expect(run.exitMock).not.toHaveBeenCalled();
    } finally {
      run.restore();
    }
  });

  it("treats missing argv entries as non-direct imports", async () => {
    const run = await loadSeedIndexScript({
      scriptArg: null,
    });

    try {
      await flushAsyncWork();

      expect(run.PoolMock).not.toHaveBeenCalled();
      expect(run.fetchMock).not.toHaveBeenCalled();
      expect(run.errorSpy).not.toHaveBeenCalled();
      expect(run.exitMock).not.toHaveBeenCalled();
    } finally {
      run.restore();
    }
  });
});
