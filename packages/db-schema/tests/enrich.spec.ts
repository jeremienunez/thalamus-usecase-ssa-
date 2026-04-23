import { setTimeout as delay } from "node:timers/promises";
import { afterEach, describe, expect, it, vi } from "vitest";

const DB_ENV_KEY = ["DATABASE", "URL"].join("_");

interface PlatformRow {
  id: bigint;
  name: string;
}

interface SatelliteRow {
  id: bigint;
  name: string;
  telemetrySummary: { noradId?: number } | null;
}

interface SummaryRow {
  total: number;
  with_platform: number;
  with_mass: number;
}

interface FetchPlan {
  body?: string;
  status?: number;
  error?: unknown;
}

function textResponse(body: string, status = 200): Response {
  return new Response(body, { status });
}

function groupCsv(
  header: string,
  rows: Array<number | string>,
): string {
  return [header, ...rows.map(String)].join("\n");
}

async function flushAsyncWork(): Promise<void> {
  await delay(0);
}

async function waitForCondition(
  label: string,
  predicate: () => boolean,
): Promise<void> {
  for (let i = 0; i < 20; i++) {
    if (predicate()) return;
    await flushAsyncWork();
  }
  throw new Error(`timed out waiting for ${label}`);
}

function makeDbDouble({
  platformRows = [],
  satelliteRows = [],
  summaryRow = {
    total: 0,
    with_platform: 0,
    with_mass: 0,
  },
  failPlatformSelect,
}: {
  platformRows?: PlatformRow[];
  satelliteRows?: SatelliteRow[];
  summaryRow?: SummaryRow;
  failPlatformSelect?: unknown;
} = {}) {
  const updatePatches: Array<{ platformClassId?: bigint; massKg?: number }> = [];
  const selectQueue: Array<unknown> =
    failPlatformSelect !== undefined
      ? [{ fail: failPlatformSelect }]
      : [platformRows, satelliteRows];

  const tx = {
    update: vi.fn(() => ({
      set: (patch: { platformClassId?: bigint; massKg?: number }) => {
        updatePatches.push(patch);
        return {
          where: async () => undefined,
        };
      },
    })),
  };

  const db = {
    select: vi.fn(() => ({
      from: async () => {
        const next = selectQueue.shift();
        if (
          next != null &&
          typeof next === "object" &&
          "fail" in next
        ) {
          throw next.fail;
        }
        return next ?? [];
      },
    })),
    transaction: vi.fn(async (callback: (innerTx: typeof tx) => Promise<unknown>) => callback(tx)),
    execute: vi.fn(async () => ({
      rows: [summaryRow],
    })),
  };

  return {
    db,
    updatePatches,
  };
}

async function loadEnrichScript({
  platformRows,
  satelliteRows,
  summaryRow,
  failPlatformSelect,
  fetchPlans = {},
}: {
  platformRows?: PlatformRow[];
  satelliteRows?: SatelliteRow[];
  summaryRow?: SummaryRow;
  failPlatformSelect?: unknown;
  fetchPlans?: Record<string, FetchPlan>;
}) {
  vi.resetModules();

  const originalExit = process.exit;
  const previousDatabaseUrl = process.env[DB_ENV_KEY];
  delete process.env[DB_ENV_KEY];
  const exitMock = vi.fn();
  Object.defineProperty(process, "exit", {
    configurable: true,
    value: exitMock,
  });

  const poolEnd = vi.fn(async () => undefined);
  const pool = { end: poolEnd };
  const PoolMock = vi.fn(function MockPool() {
    return pool;
  });
  const dbDouble = makeDbDouble({
    platformRows,
    satelliteRows,
    summaryRow,
    failPlatformSelect,
  });
  const drizzle = vi.fn(() => dbDouble.db);
  const logSpy = vi.spyOn(console, "log").mockImplementation(() => undefined);
  const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => undefined);
  const errorSpy = vi.spyOn(console, "error").mockImplementation(() => undefined);
  const fetchMock = vi.fn((url: string | URL) => {
    const group = new URL(String(url)).searchParams.get("GROUP") ?? "";
    const plan = fetchPlans[group] ?? {
      body: groupCsv("NORAD_CAT_ID", []),
      status: 200,
    };
    if (plan.error !== undefined) {
      return Promise.reject(plan.error);
    }
    return Promise.resolve(
      textResponse(plan.body ?? groupCsv("NORAD_CAT_ID", []), plan.status ?? 200),
    );
  });
  const timeoutSpy = vi
    .spyOn(globalThis, "setTimeout")
    .mockImplementation((callback: TimerHandler) => {
      if (typeof callback === "function") {
        callback();
      }
      return 0;
    });

  vi.doMock("pg", () => ({
    Pool: PoolMock,
  }));
  vi.doMock("drizzle-orm/node-postgres", () => ({
    drizzle,
  }));
  vi.stubGlobal("fetch", fetchMock);

  const restore = () => {
    Object.defineProperty(process, "exit", {
      configurable: true,
      value: originalExit,
    });
    if (previousDatabaseUrl === undefined) delete process.env[DB_ENV_KEY];
    else process.env[DB_ENV_KEY] = previousDatabaseUrl;
  };

  await import("../src/seed/enrich");

  return {
    PoolMock,
    dbDouble,
    drizzle,
    errorSpy,
    exitMock,
    fetchMock,
    logSpy,
    poolEnd,
    restore,
    timeoutSpy,
    warnSpy,
  };
}

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe("seed enrich script", () => {
  it("hydrates platform and mass updates from CelesTrak groups, exact NORAD masses, and prefix fallbacks", async () => {
    const run = await loadEnrichScript({
      platformRows: [
        { id: 1n, name: "communications" },
        { id: 2n, name: "earth_observation" },
        { id: 3n, name: "navigation" },
      ],
      satelliteRows: [
        {
          id: 1n,
          name: "WEATHER-BIRD",
          telemetrySummary: { noradId: 100 },
        },
        {
          id: 2n,
          name: "ISS",
          telemetrySummary: { noradId: 25544 },
        },
        {
          id: 3n,
          name: "STARLINK-9000",
          telemetrySummary: { noradId: 200 },
        },
        {
          id: 4n,
          name: "SCIENCE-1",
          telemetrySummary: { noradId: 300 },
        },
        {
          id: 5n,
          name: "SKIP-NO-NORAD",
          telemetrySummary: null,
        },
        {
          id: 6n,
          name: "GPS TEST",
          telemetrySummary: { noradId: 400 },
        },
      ],
      summaryRow: {
        total: 6,
        with_platform: 3,
        with_mass: 3,
      },
      fetchPlans: {
        weather: {
          body: groupCsv("NORAD_CAT_ID", [100]),
        },
        military: {
          body: groupCsv("NORAD_CAT_ID", [100]),
        },
        starlink: {
          body: groupCsv("NORAD_CAT_ID", [200, 0, "bad"]),
        },
        science: {
          body: groupCsv("NORAD_CAT_ID", [300]),
        },
        "gps-ops": {
          body: groupCsv("NORAD_CAT_ID", [400]),
        },
      },
    });

    try {
      await waitForCondition("pool end", () => run.poolEnd.mock.calls.length === 1);

      expect(run.PoolMock).toHaveBeenCalledWith({
        connectionString: "postgres://thalamus:thalamus@localhost:5433/thalamus",
      });
      expect(run.drizzle).toHaveBeenCalledTimes(1);
      expect(run.fetchMock).toHaveBeenCalledTimes(30);
      expect(run.timeoutSpy).toHaveBeenCalledTimes(30);
      expect(run.dbDouble.updatePatches).toEqual([
        { platformClassId: 2n, massKg: undefined },
        { platformClassId: undefined, massKg: 420_000 },
        { platformClassId: 1n, massKg: 300 },
        { platformClassId: 3n, massKg: 3000 },
      ]);
      expect(run.dbDouble.db.transaction).toHaveBeenCalledTimes(1);
      expect(run.dbDouble.db.execute).toHaveBeenCalledTimes(1);
      expect(run.warnSpy).toHaveBeenCalledWith(
        "  ⚠ platform_class 'sigint' not in DB — did you run seed?",
      );
      expect(run.warnSpy).toHaveBeenCalledWith(
        "  ⚠ platform_class 'science' not in DB — did you run seed?",
      );
      expect(run.warnSpy).toHaveBeenCalledWith(
        "  ⚠ platform_class 'military' not in DB — did you run seed?",
      );
      expect(run.errorSpy).not.toHaveBeenCalled();
      expect(run.exitMock).not.toHaveBeenCalled();
    } finally {
      run.restore();
    }
  });

  it("returns early without updates when group fetches are empty or malformed", async () => {
    const run = await loadEnrichScript({
      platformRows: [],
      satelliteRows: [
        {
          id: 1n,
          name: "UNKNOWN-1",
          telemetrySummary: { noradId: 600 },
        },
        {
          id: 2n,
          name: "UNKNOWN-2",
          telemetrySummary: null,
        },
      ],
      fetchPlans: {
        "gps-ops": {
          body: "down",
          status: 503,
        },
        "glo-ops": {
          body: groupCsv("NOT_NORAD", [1]),
        },
        galileo: {
          body: "NORAD_CAT_ID",
        },
      },
    });

    try {
      await waitForCondition("pool end", () => run.poolEnd.mock.calls.length === 1);

      expect(run.dbDouble.updatePatches).toEqual([]);
      expect(run.dbDouble.db.transaction).not.toHaveBeenCalled();
      expect(run.dbDouble.db.execute).not.toHaveBeenCalled();
      expect(run.warnSpy).toHaveBeenCalledWith("  ⚠ gps-ops: HTTP 503");
      expect(run.warnSpy).toHaveBeenCalledWith(
        "  ⚠ glo-ops: NORAD_CAT_ID column not found in header",
      );
      expect(run.errorSpy).not.toHaveBeenCalled();
      expect(run.exitMock).not.toHaveBeenCalled();
    } finally {
      run.restore();
    }
  });

  it("logs and exits when the platform lookup crashes before enrichment", async () => {
    const run = await loadEnrichScript({
      failPlatformSelect: new Error("db offline"),
    });

    try {
      await waitForCondition("process exit", () => run.exitMock.mock.calls.length === 1);

      expect(run.errorSpy).toHaveBeenCalledWith(
        expect.objectContaining({ message: "db offline" }),
      );
      expect(run.exitMock).toHaveBeenCalledWith(1);
      expect(run.poolEnd).not.toHaveBeenCalled();
    } finally {
      run.restore();
    }
  });
});
