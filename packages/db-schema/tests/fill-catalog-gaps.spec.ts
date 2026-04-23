import { setTimeout as delay } from "node:timers/promises";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it, vi } from "vitest";

type GapRow = {
  id: string;
  name: string | null;
  mass_kg: number | null;
  mean_motion: number | null;
  eccentricity: number | null;
  inclination_deg: number | null;
  operator_name: string | null;
  operator_country_name: string | null;
  platform_name: string | null;
};

interface LoadGapScriptOptions {
  rows?: GapRow[];
  queryResults?: Array<unknown>;
}

const SCRIPT_PATH = fileURLToPath(
  new URL("../src/seed/fill-catalog-gaps.ts", import.meta.url),
);
const DB_ENV_KEY = ["DATABASE", "URL"].join("_");

async function flushAsyncWork(): Promise<void> {
  await delay(0);
}

async function waitForCondition(
  label: string,
  predicate: () => boolean,
): Promise<void> {
  for (let i = 0; i < 40; i++) {
    if (predicate()) return;
    await flushAsyncWork();
  }
  throw new Error(`timed out waiting for ${label}`);
}

async function loadFillCatalogGapsScript({
  rows = [],
  queryResults = [],
}: LoadGapScriptOptions = {}) {
  vi.resetModules();

  const originalArgv = process.argv;
  const originalExit = process.exit;
  const previousDatabaseUrl = process.env[DB_ENV_KEY];
  delete process.env[DB_ENV_KEY];
  Object.defineProperty(process, "argv", {
    configurable: true,
    value: ["/usr/bin/node", SCRIPT_PATH],
  });
  const exitMock = vi.fn();
  Object.defineProperty(process, "exit", {
    configurable: true,
    value: exitMock,
  });

  let queryIndex = 0;
  const queryMock = vi.fn(async () => {
    if (queryIndex === 0) {
      queryIndex++;
      return { rows };
    }
    const next = queryResults[queryIndex - 1];
    queryIndex++;
    if (next instanceof Error) throw next;
    return next ?? { rows: [] };
  });
  const release = vi.fn();
  const client = {
    query: queryMock,
    release,
  };
  const poolEnd = vi.fn(async () => undefined);
  const pool = {
    connect: vi.fn(async () => client),
    end: poolEnd,
  };
  const PoolMock = vi.fn(function MockPool() {
    return pool;
  });

  const logSpy = vi.spyOn(console, "log").mockImplementation(() => undefined);
  const errorSpy = vi.spyOn(console, "error").mockImplementation(() => undefined);

  vi.doMock("pg", () => ({
    Pool: PoolMock,
  }));

  await import("../src/seed/fill-catalog-gaps");

  return {
    PoolMock,
    client,
    errorSpy,
    exitMock,
    logSpy,
    pool,
    poolEnd,
    queryMock,
    release,
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
    },
  };
}

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe("fill-catalog-gaps script", () => {
  it("loads satellites, fills missing fields, commits once, and prints summary distributions", async () => {
    const run = await loadFillCatalogGapsScript({
      rows: [
        {
          id: "1",
          name: "PATHFINDER-1",
          mass_kg: 5,
          mean_motion: 14,
          eccentricity: 0,
          inclination_deg: 98,
          operator_name: "NASA",
          operator_country_name: "United States",
          platform_name: "earth_observation",
        },
        {
          id: "2",
          name: "OPS-ALPHA",
          mass_kg: 200,
          mean_motion: null,
          eccentricity: 0,
          inclination_deg: 53,
          operator_name: "Commercial Operator",
          operator_country_name: "commercial",
          platform_name: "communications",
        },
        {
          id: "3",
          name: "QUIET-SAT",
          mass_kg: 500,
          mean_motion: 1.01,
          eccentricity: 0,
          inclination_deg: 0,
          operator_name: "United States Space Force",
          operator_country_name: "United States",
          platform_name: "military",
        },
      ],
      queryResults: [
        { rows: [] },
        { rows: [{ r_set: true, t_set: true, e_set: true }] },
        { rows: [{ r_set: true, t_set: true, e_set: false }] },
        { rows: [] },
        { rows: [] },
        { rows: [{ regime: "SSO", n: 1 }, { regime: "GEO", n: 1 }] },
        { rows: [{ tier: "sensitive", n: 1 }, { tier: "restricted", n: 1 }] },
        { rows: [{ experimental: true, n: 1 }, { experimental: false, n: 2 }] },
      ],
    });

    try {
      await waitForCondition("pool end", () => run.poolEnd.mock.calls.length === 1);

      expect(run.PoolMock).toHaveBeenCalledWith({
        connectionString: "postgres://thalamus:thalamus@localhost:5433/thalamus",
      });
      expect(run.pool.connect).toHaveBeenCalledTimes(1);
      expect(run.queryMock).toHaveBeenCalledTimes(9);
      expect(run.queryMock.mock.calls[1]?.[0]).toBe("BEGIN");
      expect(run.queryMock.mock.calls[5]?.[0]).toBe("COMMIT");
      expect(run.queryMock.mock.calls[2]?.[1]).toEqual(["1", "SSO", "sensitive", true]);
      expect(run.queryMock.mock.calls[3]?.[1]).toEqual([
        "2",
        null,
        "unclassified",
        false,
      ]);
      expect(run.queryMock.mock.calls[4]?.[1]).toEqual([
        "3",
        "GEO",
        "restricted",
        false,
      ]);
      expect(run.logSpy).toHaveBeenCalledWith("→ loading satellites with context…");
      expect(run.logSpy).toHaveBeenCalledWith("  3 satellites");
      expect(run.logSpy).toHaveBeenCalledWith("✓ regime set on      1 sats");
      expect(run.logSpy).toHaveBeenCalledWith("✓ classification on  2 sats");
      expect(run.logSpy).toHaveBeenCalledWith("✓ experimental on    1 sats");
      expect(run.logSpy).toHaveBeenCalledWith(
        "\nregime distribution :",
        [{ regime: "SSO", n: 1 }, { regime: "GEO", n: 1 }],
      );
      expect(run.logSpy).toHaveBeenCalledWith(
        "tier distribution   :",
        [{ tier: "sensitive", n: 1 }, { tier: "restricted", n: 1 }],
      );
      expect(run.logSpy).toHaveBeenCalledWith(
        "experimental        :",
        [{ experimental: true, n: 1 }, { experimental: false, n: 2 }],
      );
      expect(run.release).toHaveBeenCalledTimes(1);
      expect(run.errorSpy).not.toHaveBeenCalled();
      expect(run.exitMock).not.toHaveBeenCalled();
    } finally {
      run.restore();
    }
  });

  it("rolls back on failure, swallows rollback errors, and exits through the direct-run catch", async () => {
    const run = await loadFillCatalogGapsScript({
      rows: [
        {
          id: "1",
          name: "BROKEN-SAT",
          mass_kg: null,
          mean_motion: 14,
          eccentricity: 0,
          inclination_deg: 53,
          operator_name: null,
          operator_country_name: null,
          platform_name: null,
        },
      ],
      queryResults: [
        { rows: [] },
        new Error("update failed"),
        new Error("rollback failed"),
      ],
    });

    try {
      await waitForCondition("process exit", () => run.exitMock.mock.calls.length === 1);

      expect(run.queryMock).toHaveBeenCalledTimes(4);
      expect(run.queryMock.mock.calls[1]?.[0]).toBe("BEGIN");
      expect(run.queryMock.mock.calls[3]?.[0]).toBe("ROLLBACK");
      expect(run.release).toHaveBeenCalledTimes(1);
      expect(run.poolEnd).toHaveBeenCalledTimes(1);
      expect(run.errorSpy).toHaveBeenCalledWith(
        "✗ fill-catalog-gaps failed:",
        expect.objectContaining({ message: "update failed" }),
      );
      expect(run.exitMock).toHaveBeenCalledWith(1);
    } finally {
      run.restore();
    }
  });
});
