import { setTimeout as delay } from "node:timers/promises";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it, vi } from "vitest";

interface BroadphaseDbRow {
  id: string;
  name: string;
  object_class: string;
  perigee: number;
  apogee: number;
  inc: number | null;
}

interface LoadScreenBroadphaseOptions {
  dbResult?: { rows: BroadphaseDbRow[] } | Error;
  marginKm?: string;
  topN?: string;
  regimeFilter?: string;
}

const SCRIPT_PATH = fileURLToPath(
  new URL("../src/seed/screen-broadphase.ts", import.meta.url),
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

async function loadScreenBroadphaseScript({
  dbResult = { rows: [] },
  marginKm,
  topN,
  regimeFilter,
}: LoadScreenBroadphaseOptions = {}) {
  vi.resetModules();

  const originalArgv = process.argv;
  const originalExit = process.exit;
  const previousDatabaseUrl = process.env[DB_ENV_KEY];
  const previousMargin = process.env.MARGIN_KM;
  const previousTopN = process.env.TOP_N;
  const previousRegimeFilter = process.env.REGIME_FILTER;

  delete process.env[DB_ENV_KEY];
  if (marginKm === undefined) delete process.env.MARGIN_KM;
  else process.env.MARGIN_KM = marginKm;
  if (topN === undefined) delete process.env.TOP_N;
  else process.env.TOP_N = topN;
  if (regimeFilter === undefined) delete process.env.REGIME_FILTER;
  else process.env.REGIME_FILTER = regimeFilter;

  Object.defineProperty(process, "argv", {
    configurable: true,
    value: ["/usr/bin/node", SCRIPT_PATH],
  });
  const exitMock = vi.fn();
  Object.defineProperty(process, "exit", {
    configurable: true,
    value: exitMock,
  });

  const execute = vi.fn(async () => {
    if (dbResult instanceof Error) throw dbResult;
    return dbResult;
  });
  const db = { execute };
  const drizzle = vi.fn(() => db);

  const poolEnd = vi.fn(async () => undefined);
  const pool = { end: poolEnd };
  const PoolMock = vi.fn(function MockPool() {
    return pool;
  });

  const logSpy = vi.spyOn(console, "log").mockImplementation(() => undefined);
  const errorSpy = vi.spyOn(console, "error").mockImplementation(() => undefined);
  vi.spyOn(Date, "now")
    .mockReturnValueOnce(10_000)
    .mockReturnValueOnce(12_500);

  vi.doMock("pg", () => ({
    Pool: PoolMock,
  }));
  vi.doMock("drizzle-orm/node-postgres", () => ({
    drizzle,
  }));

  await import("../src/seed/screen-broadphase");

  return {
    PoolMock,
    db,
    errorSpy,
    execute,
    exitMock,
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
      if (previousMargin === undefined) delete process.env.MARGIN_KM;
      else process.env.MARGIN_KM = previousMargin;
      if (previousTopN === undefined) delete process.env.TOP_N;
      else process.env.TOP_N = previousTopN;
      if (previousRegimeFilter === undefined) delete process.env.REGIME_FILTER;
      else process.env.REGIME_FILTER = previousRegimeFilter;
    },
  };
}

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe("screen-broadphase script", () => {
  it("loads the catalog, prints the screening pipeline, and lists the tightest pairs", async () => {
    const run = await loadScreenBroadphaseScript({
      dbResult: {
        rows: [
          { id: "1", name: "ALPHA", object_class: "payload", perigee: 400, apogee: 500, inc: 53 },
          { id: "2", name: "BETA", object_class: "debris", perigee: 450, apogee: 550, inc: 52 },
          { id: "3", name: "GAMMA", object_class: "payload", perigee: 10_000, apogee: 11_000, inc: 55 },
          { id: "6", name: "DELTA", object_class: "payload", perigee: 10_050, apogee: 11_100, inc: 56 },
          { id: "4", name: "BROKEN", object_class: "payload", perigee: Number.NaN, apogee: 600, inc: 53 },
          { id: "5", name: "INVERTED", object_class: "payload", perigee: 800, apogee: 700, inc: 53 },
        ],
      },
      marginKm: "50",
      topN: "5",
    });

    try {
      await waitForCondition("pool end", () => run.poolEnd.mock.calls.length === 1);

      expect(run.PoolMock).toHaveBeenCalledWith({
        connectionString: "postgres://thalamus:thalamus@localhost:5433/thalamus",
      });
      expect(run.execute).toHaveBeenCalledTimes(1);
      expect(run.logSpy).toHaveBeenCalledWith(
        "▸ connecting to postgres://***@localhost:5433/thalamus",
      );
      expect(run.logSpy).toHaveBeenCalledWith("▸ loading catalog…");
      expect(run.logSpy).toHaveBeenCalledWith("▸ 4 objects have orbital bands");
      expect(run.logSpy).toHaveBeenCalledWith(
        "▸ running broad-phase pruner (margin=50 km, topK=5)…",
      );
      expect(run.logSpy).toHaveBeenCalledWith("\n▸ screening pipeline:");
      expect(run.logSpy).toHaveBeenCalledWith(
        "  naive universe:                       6 pairs",
      );
      expect(run.logSpy).toHaveBeenCalledWith(
        "  after regime bucketing:               2 pairs  (33.33%)",
      );
      expect(run.logSpy).toHaveBeenCalledWith(
        "  after radial overlap:                 2 pairs  (33.33%)",
      );
      expect(run.logSpy).toHaveBeenCalledWith("  pruning ratio:          3x");
      expect(run.logSpy).toHaveBeenCalledWith("  elapsed:                2.50s");
      expect(run.logSpy).toHaveBeenCalledWith("\n▸ per-regime candidate count:");
      expect(run.logSpy).toHaveBeenCalledWith("  leo              1 pairs  (2 objects)");
      expect(run.logSpy).toHaveBeenCalledWith("  meo              1 pairs  (2 objects)");
      expect(run.logSpy).toHaveBeenCalledWith("\n▸ top 5 tightest candidate pairs (overlap window):");
      expect(run.logSpy).toHaveBeenCalledWith("\n▸ cross-class candidate mix:");
      expect(
        run.logSpy.mock.calls.some(
          ([message]) =>
            typeof message === "string" &&
            message.includes("debris×payload") &&
            message.trim().endsWith("1"),
        ),
      ).toBe(true);
      expect(
        run.logSpy.mock.calls.some(
          ([message]) =>
            typeof message === "string" &&
            message.includes("payload×payload") &&
            message.trim().endsWith("1"),
        ),
      ).toBe(true);
      expect(run.errorSpy).not.toHaveBeenCalled();
      expect(run.exitMock).not.toHaveBeenCalled();
    } finally {
      run.restore();
    }
  });

  it("applies REGIME_FILTER before computing pair counts", async () => {
    const run = await loadScreenBroadphaseScript({
      dbResult: {
        rows: [
          { id: "1", name: "ALPHA", object_class: "payload", perigee: 400, apogee: 500, inc: 53 },
          { id: "2", name: "BETA", object_class: "payload", perigee: 450, apogee: 550, inc: 52 },
          { id: "3", name: "GAMMA", object_class: "payload", perigee: 10_000, apogee: 11_000, inc: 55 },
        ],
      },
      regimeFilter: "leo",
    });

    try {
      await waitForCondition("pool end", () => run.poolEnd.mock.calls.length === 1);

      expect(run.logSpy).toHaveBeenCalledWith(
        "▸ REGIME_FILTER=leo — 3 → 2 objects",
      );
      expect(run.logSpy).toHaveBeenCalledWith(
        "  naive universe:                       1 pairs",
      );
      expect(run.errorSpy).not.toHaveBeenCalled();
      expect(run.exitMock).not.toHaveBeenCalled();
    } finally {
      run.restore();
    }
  });

  it("logs and exits when loading the catalog fails", async () => {
    const run = await loadScreenBroadphaseScript({
      dbResult: new Error("db exploded"),
    });

    try {
      await waitForCondition("process exit", () => run.exitMock.mock.calls.length === 1);

      expect(run.execute).toHaveBeenCalledTimes(1);
      expect(run.poolEnd).toHaveBeenCalledTimes(1);
      expect(run.errorSpy).toHaveBeenCalledWith(
        "\n✗ broad-phase failed:",
        expect.objectContaining({ message: "db exploded" }),
      );
      expect(run.exitMock).toHaveBeenCalledWith(1);
    } finally {
      run.restore();
    }
  });
});
