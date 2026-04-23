import { afterEach, describe, expect, it, vi } from "vitest";

const DB_ENV_KEY = ["DATABASE", "URL"].join("_");

interface GcatSummaryRow {
  total: number;
  with_mass: number;
  with_bus: number;
  with_platform: number;
}

interface GcatBusRow {
  id: bigint;
  name: string;
}

interface GcatSatelliteRow {
  id: bigint;
  name: string;
  noradId: number | null;
  currentMass: number | null;
  currentBus: bigint | null;
}

function textResponse(body: string, status = 200): Response {
  return new Response(body, { status });
}

async function flushAsyncWork(): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, 0));
}

function gcatLine({
  satcat,
  manufacturer = "",
  bus = "",
  mass = "",
  dryMass = "",
  totMass = "",
}: {
  satcat: string;
  manufacturer?: string;
  bus?: string;
  mass?: string;
  dryMass?: string;
  totMass?: string;
}): string {
  const cols = Array.from({ length: 24 }, () => "");
  cols[1] = satcat;
  cols[16] = manufacturer;
  cols[17] = bus;
  cols[19] = mass;
  cols[21] = dryMass;
  cols[23] = totMass;
  return cols.join("\t");
}

function makeDbDouble({
  busRows = [],
  satelliteRows = [],
  summaryRows = [],
}: {
  busRows?: GcatBusRow[];
  satelliteRows?: GcatSatelliteRow[];
  summaryRows?: GcatSummaryRow[];
} = {}) {
  const insertCalls: Array<{ name: string }> = [];
  const updatePatches: Array<{ massKg?: number; satelliteBusId?: bigint }> = [];
  const selectQueue: Array<GcatBusRow[] | GcatSatelliteRow[]> = [
    busRows,
    satelliteRows,
  ];
  const executeQueue = [...summaryRows];

  const tx = {
    update: vi.fn(() => ({
      set: (patch: { massKg?: number; satelliteBusId?: bigint }) => {
        updatePatches.push(patch);
        return {
          where: async () => undefined,
        };
      },
    })),
  };

  const db = {
    insert: vi.fn(() => ({
      values: (value: { name: string }) => {
        insertCalls.push(value);
        return {
          onConflictDoNothing: async () => undefined,
        };
      },
    })),
    select: vi.fn(() => ({
      from: async () => selectQueue.shift() ?? [],
    })),
    execute: vi.fn(async () => ({
      rows: [
        executeQueue.shift() ?? {
          total: 0,
          with_mass: 0,
          with_bus: 0,
          with_platform: 0,
        },
      ],
    })),
    transaction: vi.fn(async (callback: (innerTx: typeof tx) => Promise<unknown>) => callback(tx)),
  };

  return {
    db,
    insertCalls,
    updatePatches,
  };
}

async function loadSubject({
  cacheText,
  readThrows,
  fetchText,
  fetchStatus = 200,
}: {
  cacheText?: string;
  readThrows?: unknown;
  fetchText?: string;
  fetchStatus?: number;
}) {
  vi.resetModules();

  const readFileSync = vi.fn(() => {
    if (readThrows !== undefined) {
      throw readThrows;
    }
    return cacheText ?? "";
  });
  const writeFileSync = vi.fn();
  const fetchMock = vi.fn();

  vi.doMock("node:fs", () => ({
    readFileSync,
    writeFileSync,
  }));
  vi.stubGlobal("fetch", fetchMock);

  if (readThrows !== undefined) {
    fetchMock.mockResolvedValue(
      textResponse(fetchText ?? "", fetchStatus),
    );
  }

  const mod = await import("../src/seed/enrich-gcat");
  return {
    enrichGcat: mod.enrichGcat,
    fetchMock,
    readFileSync,
    writeFileSync,
  };
}

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe("enrichGcat", () => {
  it("uses the cached GCAT file, skips malformed rows, and returns the no-op summary when nothing needs backfill", async () => {
    const { enrichGcat, fetchMock, readFileSync, writeFileSync } =
      await loadSubject({
        cacheText: [
          "# comment",
          gcatLine({
            satcat: "",
            manufacturer: "Should Skip",
            bus: "SKIP",
            mass: "100",
          }),
          gcatLine({
            satcat: "25544",
            manufacturer: "Lockheed Martin",
            bus: "A2100",
            mass: "20",
            dryMass: "10",
            totMass: "30",
          }),
          gcatLine({
            satcat: "20000",
            manufacturer: "-",
            bus: "-",
            mass: "NaN",
            totMass: "0",
          }),
          gcatLine({
            satcat: "30000",
            manufacturer: "-",
            bus: "UNKNOWN-BUS",
          }),
          gcatLine({
            satcat: "bad",
            manufacturer: "Boeing",
            bus: "BSS",
            mass: "50",
          }),
        ].join("\n"),
      });
    const db = makeDbDouble({
      busRows: [{ id: 7n, name: "A2100" }],
      satelliteRows: [
        {
          id: 1n,
          name: "ISS",
          noradId: 25544,
          currentMass: 420_000,
          currentBus: 7n,
        },
        {
          id: 2n,
          name: "UNKNOWN",
          noradId: 30000,
          currentMass: null,
          currentBus: null,
        },
        {
          id: 3n,
          name: "NULL NORAD",
          noradId: null,
          currentMass: null,
          currentBus: null,
        },
        {
          id: 4n,
          name: "BAD NORAD",
          noradId: Number.NaN,
          currentMass: null,
          currentBus: null,
        },
        {
          id: 5n,
          name: "MISSING GCAT",
          noradId: 99999,
          currentMass: null,
          currentBus: null,
        },
      ],
      summaryRows: [
        {
          total: 5,
          with_mass: 1,
          with_bus: 1,
          with_platform: 1,
        },
      ],
    });

    const summary = await Reflect.apply(enrichGcat, null, [db.db]);

    expect(summary).toEqual({
      total: 5,
      withMass: 1,
      withBus: 1,
      withPlatform: 1,
      massBackfill: 0,
      busBackfill: 0,
      updatesApplied: 0,
    });
    expect(readFileSync).toHaveBeenCalledWith("/tmp/gcat.tsv", "utf8");
    expect(fetchMock).not.toHaveBeenCalled();
    expect(writeFileSync).not.toHaveBeenCalled();
    expect(db.insertCalls).toEqual([
      { name: "A2100" },
      { name: "UNKNOWN-BUS" },
    ]);
    expect(db.updatePatches).toEqual([]);
    expect(db.db.transaction).not.toHaveBeenCalled();
    expect(db.db.execute).toHaveBeenCalledTimes(1);
  });

  it("fetches GCAT on cache miss, writes the cache, and backfills only missing mass and bus fields", async () => {
    const body = [
      gcatLine({
        satcat: "100",
        manufacturer: "-",
        bus: "-",
        mass: "20",
        dryMass: "10",
        totMass: "30",
      }),
      gcatLine({
        satcat: "101",
        manufacturer: "Boeing",
        bus: "A2100",
        totMass: "40",
      }),
      gcatLine({
        satcat: "102",
        manufacturer: "Lockheed Martin",
        bus: "A2100",
        mass: "9",
      }),
      gcatLine({
        satcat: "-1",
        manufacturer: "Ignored",
        bus: "Ignored",
        mass: "999",
      }),
    ].join("\n");
    const { enrichGcat, fetchMock, writeFileSync } = await loadSubject({
      readThrows: new Error("cache miss"),
      fetchText: body,
    });
    const db = makeDbDouble({
      busRows: [{ id: 7n, name: "A2100" }],
      satelliteRows: [
        {
          id: 1n,
          name: "SAT-100",
          noradId: 100,
          currentMass: null,
          currentBus: null,
        },
        {
          id: 2n,
          name: "SAT-101",
          noradId: 101,
          currentMass: null,
          currentBus: null,
        },
        {
          id: 3n,
          name: "SAT-102",
          noradId: 102,
          currentMass: 99,
          currentBus: null,
        },
        {
          id: 4n,
          name: "NO MATCH",
          noradId: 404,
          currentMass: null,
          currentBus: null,
        },
      ],
      summaryRows: [
        {
          total: 4,
          with_mass: 3,
          with_bus: 2,
          with_platform: 0,
        },
      ],
    });

    const summary = await Reflect.apply(enrichGcat, null, [db.db]);

    expect(summary).toEqual({
      total: 4,
      withMass: 3,
      withBus: 2,
      withPlatform: 0,
      massBackfill: 2,
      busBackfill: 2,
      updatesApplied: 3,
    });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(writeFileSync).toHaveBeenCalledWith("/tmp/gcat.tsv", body, "utf8");
    expect(db.insertCalls).toEqual([{ name: "A2100" }]);
    expect(db.updatePatches).toEqual([
      { massKg: 10 },
      { massKg: 40, satelliteBusId: 7n },
      { satelliteBusId: 7n },
    ]);
    expect(db.db.transaction).toHaveBeenCalledTimes(1);
    expect(db.db.execute).toHaveBeenCalledTimes(1);
  });

  it("throws when GCAT fetch returns a non-2xx response", async () => {
    const { enrichGcat, fetchMock, writeFileSync } = await loadSubject({
      readThrows: new Error("cache miss"),
      fetchText: "down",
      fetchStatus: 503,
    });

    await expect(Reflect.apply(enrichGcat, null, [{}])).rejects.toThrow(
      "GCAT HTTP 503",
    );
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(writeFileSync).not.toHaveBeenCalled();
  });

  it("treats a missing argv entry as a non-direct import", async () => {
    const originalArgv = process.argv;
    Object.defineProperty(process, "argv", {
      configurable: true,
      value: ["/usr/bin/node"],
    });

    try {
      const { enrichGcat } = await loadSubject({ cacheText: "" });
      expect(enrichGcat).toBeTypeOf("function");
    } finally {
      Object.defineProperty(process, "argv", {
        configurable: true,
        value: originalArgv,
      });
    }
  });

  it("treats argv access failures as a non-direct import", async () => {
    const originalArgv = process.argv;
    Object.defineProperty(process, "argv", {
      configurable: true,
      get: () => {
        throw new Error("argv blocked");
      },
    });

    try {
      const { enrichGcat } = await loadSubject({ cacheText: "" });
      expect(enrichGcat).toBeTypeOf("function");
    } finally {
      Object.defineProperty(process, "argv", {
        configurable: true,
        value: originalArgv,
      });
    }
  });

  it("logs and exits when the direct-run path fails", async () => {
    const originalArgv = process.argv;
    const originalExit = process.exit;
    const previousDatabaseUrl = process.env[DB_ENV_KEY];
    delete process.env[DB_ENV_KEY];
    const exitMock = vi.fn();
    const poolEnd = vi.fn(async () => undefined);
    const pool = { end: poolEnd };
    const PoolMock = vi.fn(function MockPool() {
      return pool;
    });
    const drizzle = vi.fn(() => ({}));
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => undefined);

    vi.resetModules();
    Object.defineProperty(process, "argv", {
      configurable: true,
      value: ["/usr/bin/node", "/tmp/seed/enrich-gcat.ts"],
    });
    Object.defineProperty(process, "exit", {
      configurable: true,
      value: exitMock,
    });
    vi.doMock("node:fs", () => ({
      readFileSync: vi.fn(() => {
        throw new Error("cache miss");
      }),
      writeFileSync: vi.fn(),
    }));
    vi.doMock("pg", () => ({
      Pool: PoolMock,
    }));
    vi.doMock("drizzle-orm/node-postgres", () => ({
      drizzle,
    }));
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(textResponse("down", 503)));

    try {
      await import("../src/seed/enrich-gcat");
      await flushAsyncWork();

      expect(PoolMock).toHaveBeenCalledWith({
        connectionString: "postgres://thalamus:thalamus@localhost:5433/thalamus",
      });
      expect(drizzle).toHaveBeenCalledWith(pool);
      expect(poolEnd).toHaveBeenCalledTimes(1);
      expect(errorSpy).toHaveBeenCalledWith(
        expect.objectContaining({ message: "GCAT HTTP 503" }),
      );
      expect(exitMock).toHaveBeenCalledWith(1);
    } finally {
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
    }
  });
});
