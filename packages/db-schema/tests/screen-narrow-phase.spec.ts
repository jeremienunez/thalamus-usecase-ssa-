import { setTimeout as delay } from "node:timers/promises";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it, vi } from "vitest";

interface NarrowphaseDbRow {
  id: string;
  name: string;
  norad_id: number;
  object_class: string;
  perigee: number;
  apogee: number;
}

interface FetchOkResult {
  body: string;
  ok?: true;
}

interface FetchMissResult {
  ok: false;
  body?: string;
}

interface LoadScreenNarrowPhaseOptions {
  cacheDirExists?: boolean;
  cacheFiles?: Record<string, string>;
  dbResult?: { rows: NarrowphaseDbRow[] } | Error;
  expectedWrites?: number;
  fetchByNorad?: Record<number, FetchOkResult | FetchMissResult | Error>;
  marginKm?: string;
  thresholdKm?: string;
  topK?: string;
  windowHours?: string;
}

const SCRIPT_PATH = fileURLToPath(
  new URL("../src/seed/screen-narrow-phase.ts", import.meta.url),
);
const DB_ENV_KEY = ["DATABASE", "URL"].join("_");

function buildTleBody(norad: number): string {
  const n = String(norad).padStart(5, "0");
  return `SAT-${norad}\n1 ${n}U TEST\n2 ${n} TEST`;
}

function createRows(norads: number[]): NarrowphaseDbRow[] {
  return norads.map((norad) => ({
    id: String(norad),
    name: `SAT-${norad}`,
    norad_id: norad,
    object_class: "payload",
    perigee: 100,
    apogee: 200,
  }));
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

async function loadScreenNarrowPhaseScript({
  cacheDirExists = true,
  cacheFiles = {},
  dbResult = { rows: [] },
  expectedWrites = 0,
  fetchByNorad = {},
  marginKm = "0",
  thresholdKm = "25",
  topK = "100",
  windowHours = "0",
}: LoadScreenNarrowPhaseOptions = {}) {
  vi.resetModules();

  const tleCacheDir = "/tmp/test-tle-cache";
  const cache = new Map<string, string>();
  for (const [fileName, body] of Object.entries(cacheFiles)) {
    cache.set(join(tleCacheDir, fileName), body);
  }
  let hasCacheDir = cacheDirExists;

  const originalArgv = process.argv;
  const originalExit = process.exit;
  const previousDatabaseUrl = process.env[DB_ENV_KEY];
  const previousTopK = process.env.NARROW_TOP_K;
  const previousWindowH = process.env.NARROW_WINDOW_H;
  const previousStepS = process.env.NARROW_STEP_S;
  const previousThresholdKm = process.env.NARROW_THRESHOLD_KM;
  const previousMarginKm = process.env.NARROW_MARGIN_KM;
  const previousCacheDir = process.env.TLE_CACHE_DIR;

  delete process.env[DB_ENV_KEY];
  process.env.NARROW_TOP_K = topK;
  process.env.NARROW_WINDOW_H = windowHours;
  process.env.NARROW_STEP_S = "60";
  process.env.NARROW_THRESHOLD_KM = thresholdKm;
  process.env.NARROW_MARGIN_KM = marginKm;
  process.env.TLE_CACHE_DIR = tleCacheDir;

  Object.defineProperty(process, "argv", {
    configurable: true,
    value: ["/usr/bin/node", SCRIPT_PATH],
  });
  const exitMock = vi.fn();
  Object.defineProperty(process, "exit", {
    configurable: true,
    value: exitMock,
  });

  const existsSync = vi.fn((path: string) => {
    if (path === tleCacheDir) return hasCacheDir;
    return cache.has(path);
  });
  const readFileSync = vi.fn((path: string) => cache.get(path) ?? "");
  const writeFileSync = vi.fn((path: string, body: string) => {
    cache.set(path, body);
  });
  const mkdirSync = vi.fn((path: string) => {
    if (path === tleCacheDir) hasCacheDir = true;
  });

  let queryIndex = 0;
  const execute = vi.fn(async () => {
    if (dbResult instanceof Error) throw dbResult;

    queryIndex++;
    if (queryIndex === 1) return dbResult;
    if (queryIndex <= 1 + expectedWrites) return { rows: [] };
    return {
      rows: [
        {
          total: expectedWrites,
          tightest_km: expectedWrites > 0 ? 5 : null,
          high_pc: 0,
          med_pc: expectedWrites > 0 ? 1 : 0,
        },
      ],
    };
  });
  const db = { execute };
  const drizzle = vi.fn(() => db);

  const poolEnd = vi.fn(async () => undefined);
  const PoolMock = vi.fn(function MockPool() {
    return { end: poolEnd };
  });

  const twoline2satrec = vi.fn((l1: string) => {
    const norad = Number(l1.slice(2, 7).trim());
    if (norad === 106) throw new Error("bad tle");
    return { norad };
  });
  const propagate = vi.fn((rec: { norad: number }) => {
    if (rec.norad === 107) return { position: null };
    if (rec.norad >= 20_000) return { position: { x: rec.norad % 2 === 0 ? 0 : 5, y: 0, z: 0 } };
    if (rec.norad === 108) return { position: { x: 100, y: 0, z: 0 } };
    if (rec.norad === 102) return { position: { x: 5, y: 0, z: 0 } };
    return { position: { x: 0, y: 0, z: 0 } };
  });

  const fetchMock = vi.fn(async (input: string | URL) => {
    const url = new URL(String(input));
    const norad = Number(url.searchParams.get("CATNR"));
    const result = fetchByNorad[norad];
    if (result instanceof Error) throw result;
    if (result && result.ok === false) {
      return {
        ok: false,
        text: async () => result.body ?? "",
      };
    }
    return {
      ok: true,
      text: async () => result?.body ?? buildTleBody(norad),
    };
  });

  const originalSetTimeout = globalThis.setTimeout;
  vi.stubGlobal("fetch", fetchMock);
  vi.stubGlobal("setTimeout", (...args: Parameters<typeof setTimeout>) => {
    const [handler] = args;
    if (typeof handler === "function") handler();
    return originalSetTimeout(() => undefined, 0);
  });

  const logSpy = vi.spyOn(console, "log").mockImplementation(() => undefined);
  const errorSpy = vi.spyOn(console, "error").mockImplementation(() => undefined);
  const stdoutWrite = vi.spyOn(process.stdout, "write").mockImplementation(() => true);

  vi.doMock("node:fs", () => ({
    existsSync,
    readFileSync,
    writeFileSync,
    mkdirSync,
  }));
  vi.doMock("pg", () => ({
    Pool: PoolMock,
  }));
  vi.doMock("drizzle-orm/node-postgres", () => ({
    drizzle,
  }));
  vi.doMock("satellite.js", () => ({
    default: {
      twoline2satrec,
      propagate,
    },
    twoline2satrec,
    propagate,
  }));

  await import("../src/seed/screen-narrow-phase");

  return {
    PoolMock,
    errorSpy,
    execute,
    existsSync,
    exitMock,
    fetchMock,
    logSpy,
    mkdirSync,
    poolEnd,
    readFileSync,
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
      if (previousTopK === undefined) delete process.env.NARROW_TOP_K;
      else process.env.NARROW_TOP_K = previousTopK;
      if (previousWindowH === undefined) delete process.env.NARROW_WINDOW_H;
      else process.env.NARROW_WINDOW_H = previousWindowH;
      if (previousStepS === undefined) delete process.env.NARROW_STEP_S;
      else process.env.NARROW_STEP_S = previousStepS;
      if (previousThresholdKm === undefined) delete process.env.NARROW_THRESHOLD_KM;
      else process.env.NARROW_THRESHOLD_KM = previousThresholdKm;
      if (previousMarginKm === undefined) delete process.env.NARROW_MARGIN_KM;
      else process.env.NARROW_MARGIN_KM = previousMarginKm;
      if (previousCacheDir === undefined) delete process.env.TLE_CACHE_DIR;
      else process.env.TLE_CACHE_DIR = previousCacheDir;
    },
    stdoutWrite,
    twoline2satrec,
    writeFileSync,
  };
}

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe("screen-narrow-phase script", () => {
  it("computes relative velocity when a later timestep becomes the closest approach", async () => {
    vi.resetModules();

    const start = new Date("2026-04-23T12:00:00.000Z");
    const originalCacheDir = process.env.TLE_CACHE_DIR;
    process.env.TLE_CACHE_DIR = "/tmp/test-tle-cache-helper";

    vi.doMock("node:fs", () => ({
      existsSync: () => true,
      mkdirSync: vi.fn(),
      readFileSync: vi.fn(),
      writeFileSync: vi.fn(),
    }));
    vi.doMock("satellite.js", () => ({
      default: {
        twoline2satrec: vi.fn(),
        propagate: vi.fn((rec: { norad: number }, t: Date) => {
          const step = Math.round((t.getTime() - start.getTime()) / 60_000);
          if (rec.norad === 1) return { position: { x: 0, y: 0, z: 0 } };
          return { position: { x: step === 0 ? 10 : 1, y: 0, z: 0 } };
        }),
      },
      twoline2satrec: vi.fn(),
      propagate: vi.fn((rec: { norad: number }, t: Date) => {
        const step = Math.round((t.getTime() - start.getTime()) / 60_000);
        if (rec.norad === 1) return { position: { x: 0, y: 0, z: 0 } };
        return { position: { x: step === 0 ? 10 : 1, y: 0, z: 0 } };
      }),
    }));

    try {
      const mod = await import("../src/seed/screen-narrow-phase");
      const closest = mod.findClosestApproach(
        { norad: 1 },
        { norad: 2 },
        start,
        1 / 60,
        60,
      );

      expect(closest).toEqual(
        expect.objectContaining({
          minRangeKm: 1,
          relVelKmps: 0.15,
        }),
      );
      expect(closest?.tca.toISOString()).toBe("2026-04-23T12:01:00.000Z");
      expect(closest?.daysFromEpoch).toBeCloseTo(1 / 1440, 12);
    } finally {
      if (originalCacheDir === undefined) delete process.env.TLE_CACHE_DIR;
      else process.env.TLE_CACHE_DIR = originalCacheDir;
    }
  });

  it("creates the cache dir, handles fetch miss paths, and writes only close conjunctions", async () => {
    const run = await loadScreenNarrowPhaseScript({
      cacheDirExists: false,
      dbResult: { rows: createRows([101, 102, 103, 104, 105, 106, 107, 108]) },
      expectedWrites: 1,
      fetchByNorad: {
        101: { body: buildTleBody(101) },
        102: { body: buildTleBody(102) },
        103: { ok: false },
        104: new Error("network down"),
        105: { body: "No GP data found" },
        106: { body: buildTleBody(106) },
        107: { body: buildTleBody(107) },
        108: { body: buildTleBody(108) },
      },
    });

    try {
      await waitForCondition("pool end", () => run.poolEnd.mock.calls.length === 1);

      expect(run.PoolMock).toHaveBeenCalledWith({
        connectionString: "postgres://thalamus:thalamus@localhost:5433/thalamus",
      });
      expect(run.mkdirSync).toHaveBeenCalledWith("/tmp/test-tle-cache", {
        recursive: true,
      });
      expect(run.fetchMock).toHaveBeenCalledTimes(8);
      expect(run.writeFileSync).toHaveBeenCalledTimes(6);
      expect(run.twoline2satrec).toHaveBeenCalledTimes(5);
      expect(run.execute).toHaveBeenCalledTimes(3);
      expect(run.logSpy).toHaveBeenCalledWith("▸ loading catalog…");
      expect(run.logSpy).toHaveBeenCalledWith("▸ 8 objects with norad_id + bands");
      expect(
        run.logSpy.mock.calls.some(
          ([message]) =>
            typeof message === "string" && message.includes("hits=5 miss=3"),
        ),
      ).toBe(true);
      expect(
        run.logSpy.mock.calls.some(
          ([message]) =>
            typeof message === "string" && message.includes("propagated=6 writes=1 skipped=22"),
        ),
      ).toBe(true);
      expect(run.logSpy).toHaveBeenCalledWith(
        "▸ conjunction_event summary:",
        expect.objectContaining({ total: 1, tightest_km: 5 }),
      );
      expect(run.errorSpy).not.toHaveBeenCalled();
      expect(run.exitMock).not.toHaveBeenCalled();
    } finally {
      run.restore();
    }
  });

  it("memoizes fetched TLEs for repeated NORAD lookups", async () => {
    vi.resetModules();

    const originalCacheDir = process.env.TLE_CACHE_DIR;
    process.env.TLE_CACHE_DIR = "/tmp/test-tle-cache-memo";

    const existsSync = vi.fn(() => false);
    const mkdirSync = vi.fn();
    const readFileSync = vi.fn();
    const writeFileSync = vi.fn();
    const fetchMock = vi.fn(async () => ({
      ok: true,
      text: async () => buildTleBody(303),
    }));

    vi.stubGlobal("fetch", fetchMock);
    vi.doMock("node:fs", () => ({
      existsSync,
      mkdirSync,
      readFileSync,
      writeFileSync,
    }));

    try {
      const mod = await import("../src/seed/screen-narrow-phase");
      const first = await mod.fetchTLE(303);
      const second = await mod.fetchTLE(303);

      expect(first).toEqual({ l1: "1 00303U TEST", l2: "2 00303 TEST" });
      expect(second).toEqual(first);
      expect(mkdirSync).toHaveBeenCalledWith("/tmp/test-tle-cache-memo", {
        recursive: true,
      });
      expect(readFileSync).not.toHaveBeenCalled();
      expect(writeFileSync).toHaveBeenCalledTimes(1);
      expect(fetchMock).toHaveBeenCalledTimes(1);
    } finally {
      if (originalCacheDir === undefined) delete process.env.TLE_CACHE_DIR;
      else process.env.TLE_CACHE_DIR = originalCacheDir;
    }
  });

  it("memoizes null TLE lookups for repeated NORAD misses", async () => {
    vi.resetModules();

    const originalCacheDir = process.env.TLE_CACHE_DIR;
    process.env.TLE_CACHE_DIR = "/tmp/test-tle-cache-memo-null";

    const existsSync = vi.fn(() => false);
    const mkdirSync = vi.fn();
    const readFileSync = vi.fn();
    const writeFileSync = vi.fn();
    const fetchMock = vi.fn(async () => ({
      ok: false,
      text: async () => "",
    }));

    vi.stubGlobal("fetch", fetchMock);
    vi.doMock("node:fs", () => ({
      existsSync,
      mkdirSync,
      readFileSync,
      writeFileSync,
    }));

    try {
      const mod = await import("../src/seed/screen-narrow-phase");
      const first = await mod.fetchTLE(404);
      const second = await mod.fetchTLE(404);

      expect(first).toBeNull();
      expect(second).toBeNull();
      expect(readFileSync).not.toHaveBeenCalled();
      expect(writeFileSync).not.toHaveBeenCalled();
      expect(fetchMock).toHaveBeenCalledTimes(1);
    } finally {
      if (originalCacheDir === undefined) delete process.env.TLE_CACHE_DIR;
      else process.env.TLE_CACHE_DIR = originalCacheDir;
    }
  });

  it("prints TLE and propagation progress markers for large candidate sets", async () => {
    const norads = Array.from({ length: 50 }, (_, index) => 20_001 + index);
    const cacheFiles = Object.fromEntries(
      norads.map((norad) => [`${norad}.txt`, buildTleBody(norad)]),
    );
    const writes = (norads.length * (norads.length - 1)) / 2;

    const run = await loadScreenNarrowPhaseScript({
      cacheDirExists: true,
      cacheFiles,
      dbResult: { rows: createRows(norads) },
      expectedWrites: writes,
      topK: "2000",
    });

    try {
      await waitForCondition("pool end", () => run.poolEnd.mock.calls.length === 1);

      expect(run.fetchMock).not.toHaveBeenCalled();
      expect(run.readFileSync).toHaveBeenCalledTimes(50);
      expect(run.execute).toHaveBeenCalledTimes(1 + writes + 1);
      expect(
        run.stdoutWrite.mock.calls.some(
          ([message]) => typeof message === "string" && message === "\r  tles: 50/50",
        ),
      ).toBe(true);
      expect(
        run.stdoutWrite.mock.calls.some(
          ([message]) =>
            typeof message === "string" &&
            message === `\r  propagated 10/${writes}  writes=10`,
        ),
      ).toBe(true);
      expect(run.errorSpy).not.toHaveBeenCalled();
      expect(run.exitMock).not.toHaveBeenCalled();
    } finally {
      run.restore();
    }
  });

  it("logs and exits when narrow-phase loading fails", async () => {
    const run = await loadScreenNarrowPhaseScript({
      dbResult: new Error("db exploded"),
    });

    try {
      await waitForCondition("process exit", () => run.exitMock.mock.calls.length === 1);

      expect(run.execute).toHaveBeenCalledTimes(1);
      expect(run.poolEnd).toHaveBeenCalledTimes(1);
      expect(run.errorSpy).toHaveBeenCalledWith(
        "\n✗ narrow-phase failed:",
        expect.objectContaining({ message: "db exploded" }),
      );
      expect(run.exitMock).toHaveBeenCalledWith(1);
    } finally {
      run.restore();
    }
  });
});
