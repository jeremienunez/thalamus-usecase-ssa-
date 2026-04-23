import { setTimeout as delay } from "node:timers/promises";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it, vi } from "vitest";

interface GroupPlan {
  body?: string;
  status?: number;
  error?: unknown;
}

interface LoadUpdateScriptOptions {
  executeResults?: Array<{ rowCount?: number } | Error>;
  enrichError?: unknown;
  enrichResult?: {
    massBackfill: number;
    busBackfill: number;
    updatesApplied: number;
  };
  groupPlans?: Record<string, GroupPlan>;
}

const SCRIPT_PATH = fileURLToPath(
  new URL("../src/seed/update-tle.ts", import.meta.url),
);
const DB_ENV_KEY = ["DATABASE", "URL"].join("_");

const SAMPLE_TLE_LINE_1 =
  "1 25544U 98067A   26113.50000000  .00001264  00000+0  29669-4 0  9995";
const SAMPLE_TLE_LINE_2 =
  "2 25544  51.6434  42.2123 0003050  91.7000  12.8000 15.49000000 00001";

function textResponse(body: string, status = 200): Response {
  return new Response(body, { status });
}

function makeTleLines(noradId: number): [string, string] {
  const norad = String(noradId).padStart(5, "0");
  return [
    `1 ${norad}U 98067A   26113.50000000  .00001264  00000+0  29669-4 0  9995`,
    `2 ${norad}  51.6434  42.2123 0003050  91.7000  12.8000 15.49000000 00001`,
  ];
}

function buildTleFeed(blocks: Array<{ name: string; line1: string; line2: string }>): string {
  return blocks.flatMap((block) => [block.name, block.line1, block.line2]).join("\n");
}

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

async function loadUpdateTleScript({
  executeResults = [],
  enrichError,
  enrichResult = {
    massBackfill: 0,
    busBackfill: 0,
    updatesApplied: 0,
  },
  groupPlans = {},
}: LoadUpdateScriptOptions) {
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

  const poolEnd = vi.fn(async () => undefined);
  const pool = { end: poolEnd };
  const PoolMock = vi.fn(function MockPool() {
    return pool;
  });

  let executeIndex = 0;
  const db = {
    execute: vi.fn(async () => {
      const next = executeResults[executeIndex++];
      if (next instanceof Error) throw next;
      return next ?? { rowCount: 0 };
    }),
  };
  const drizzle = vi.fn(() => db);

  const enrichGcat = vi.fn(async () => {
    if (enrichError !== undefined) throw enrichError;
    return enrichResult;
  });

  const fetchMock = vi.fn((url: string | URL) => {
    const group = new URL(String(url)).searchParams.get("GROUP") ?? "";
    const plan = groupPlans[group];
    if (plan?.error !== undefined) {
      return Promise.reject(plan.error);
    }
    return Promise.resolve(
      textResponse(plan?.body ?? "", plan?.status ?? 200),
    );
  });

  const logSpy = vi.spyOn(console, "log").mockImplementation(() => undefined);
  const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => undefined);
  const errorSpy = vi.spyOn(console, "error").mockImplementation(() => undefined);

  vi.doMock("pg", () => ({
    Pool: PoolMock,
  }));
  vi.doMock("drizzle-orm/node-postgres", () => ({
    drizzle,
  }));
  vi.doMock("../src/seed/enrich-gcat", () => ({
    enrichGcat,
  }));
  vi.stubGlobal("fetch", fetchMock);

  await import("../src/seed/update-tle");

  return {
    PoolMock,
    db,
    drizzle,
    enrichGcat,
    errorSpy,
    exitMock,
    fetchMock,
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
    },
    warnSpy,
  };
}

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe("update-tle script", () => {
  it("deduplicates TLEs across groups, tracks updated versus missing rows, and runs GCAT enrichment", async () => {
    const [stationsLine1, stationsLine2] = makeTleLines(25544);
    const [starlinkLine1, starlinkLine2] = makeTleLines(30000);
    const run = await loadUpdateTleScript({
      executeResults: [{ rowCount: 1 }, { rowCount: 0 }],
      enrichResult: {
        massBackfill: 2,
        busBackfill: 1,
        updatesApplied: 3,
      },
      groupPlans: {
        stations: {
          body: buildTleFeed([
            {
              name: "ISS (ZARYA)",
              line1: stationsLine1,
              line2: stationsLine2,
            },
            {
              name: "BROKEN",
              line1: SAMPLE_TLE_LINE_1,
              line2: SAMPLE_TLE_LINE_2.replace("15.49000000", "XX.INVALID "),
            },
          ]),
        },
        starlink: {
          body: buildTleFeed([
            {
              name: "ISS DUP",
              line1: stationsLine1,
              line2: stationsLine2,
            },
            {
              name: "STARLINK",
              line1: starlinkLine1,
              line2: starlinkLine2,
            },
          ]),
        },
        oneweb: {
          body: "down",
          status: 503,
        },
        planet: {
          error: new Error("offline"),
        },
      },
    });

    try {
      await waitForCondition("pool end", () => run.poolEnd.mock.calls.length === 1);

      expect(run.PoolMock).toHaveBeenCalledWith({
        connectionString: "postgres://thalamus:thalamus@localhost:5433/thalamus",
      });
      expect(run.drizzle).toHaveBeenCalledTimes(1);
      expect(run.fetchMock).toHaveBeenCalledTimes(40);
      expect(run.fetchMock.mock.calls[0]?.[1]).toEqual(
        expect.objectContaining({
          headers: expect.objectContaining({
            Accept: "text/plain, */*",
          }),
        }),
      );
      expect(run.db.execute).toHaveBeenCalledTimes(2);
      expect(run.enrichGcat).toHaveBeenCalledWith(run.db);
      expect(run.warnSpy).toHaveBeenCalledWith("  ✗ oneweb HTTP 503");
      expect(run.warnSpy).toHaveBeenCalledWith("  ✗ planet", "offline");
      expect(run.logSpy).toHaveBeenCalledWith("  ✓ stations         +1");
      expect(run.logSpy).toHaveBeenCalledWith("  ✓ starlink         +1");
      expect(run.logSpy).toHaveBeenCalledWith(
        "▸ parsed 2 unique TLE blocks across 40 groups",
      );
      expect(run.logSpy).toHaveBeenCalledWith(
        "✓ updated 1 satellites, 1 not in DB",
      );
      expect(run.logSpy).toHaveBeenCalledWith(
        "✓ GCAT: 2 mass backfills, 1 bus backfills, 3 rows updated",
      );
      expect(run.errorSpy).not.toHaveBeenCalled();
      expect(run.exitMock).not.toHaveBeenCalled();
    } finally {
      run.restore();
    }
  });

  it("warns when the GCAT enrichment step fails but still closes the pool", async () => {
    const [line1, line2] = makeTleLines(25544);
    const run = await loadUpdateTleScript({
      executeResults: [{ rowCount: 1 }],
      enrichError: new Error("gcat down"),
      groupPlans: {
        stations: {
          body: buildTleFeed([
            { name: "ISS", line1, line2 },
          ]),
        },
      },
    });

    try {
      await waitForCondition("pool end", () => run.poolEnd.mock.calls.length === 1);

      expect(run.db.execute).toHaveBeenCalledTimes(1);
      expect(run.enrichGcat).toHaveBeenCalledWith(run.db);
      expect(run.warnSpy).toHaveBeenCalledWith(
        "⚠ GCAT enrichment failed:",
        "gcat down",
      );
      expect(run.errorSpy).not.toHaveBeenCalled();
      expect(run.exitMock).not.toHaveBeenCalled();
    } finally {
      run.restore();
    }
  });

  it("logs and exits when a database update fails during the direct-run path", async () => {
    const [line1, line2] = makeTleLines(25544);
    const run = await loadUpdateTleScript({
      executeResults: [new Error("update boom")],
      groupPlans: {
        stations: {
          body: buildTleFeed([
            { name: "ISS", line1, line2 },
          ]),
        },
      },
    });

    try {
      await waitForCondition("process exit", () => run.exitMock.mock.calls.length === 1);

      expect(run.enrichGcat).not.toHaveBeenCalled();
      expect(run.poolEnd).not.toHaveBeenCalled();
      expect(run.errorSpy).toHaveBeenCalledWith(
        expect.objectContaining({ message: "update boom" }),
      );
      expect(run.exitMock).toHaveBeenCalledWith(1);
    } finally {
      run.restore();
    }
  });
});
