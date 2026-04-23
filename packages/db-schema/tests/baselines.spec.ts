import { setTimeout as delay } from "node:timers/promises";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it, vi } from "vitest";

interface GcatRowOptions {
  launchDate?: string;
  decayDate?: string;
  status?: string;
  perigeeKm: number | string;
  apogeeKm: number | string;
  inclinationDeg: number | string;
}

interface LoadBaselinesOptions {
  dbResults?: Array<unknown>;
  gcatBody?: string;
}

const SCRIPT_PATH = fileURLToPath(
  new URL("../src/seed/baselines.ts", import.meta.url),
);
const DB_ENV_KEY = ["DATABASE", "URL"].join("_");

function makeGcatRow({
  launchDate = "2026 Apr 01",
  decayDate = "-",
  status = "O",
  perigeeKm,
  apogeeKm,
  inclinationDeg,
}: GcatRowOptions): string {
  const cols = Array.from({ length: 40 }, () => "");
  cols[1] = "100";
  cols[7] = launchDate;
  cols[11] = decayDate;
  cols[12] = status;
  cols[33] = String(perigeeKm);
  cols[35] = String(apogeeKm);
  cols[37] = String(inclinationDeg);
  return cols.join("\t");
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

async function loadBaselinesScript({
  dbResults = [],
  gcatBody = "",
}: LoadBaselinesOptions = {}) {
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

  let executeIndex = 0;
  const db = {
    execute: vi.fn(async () => {
      const next = dbResults[executeIndex++];
      if (next instanceof Error) throw next;
      return next ?? { rows: [] };
    }),
  };
  const drizzle = vi.fn(() => db);

  const poolEnd = vi.fn(async () => undefined);
  const pool = { end: poolEnd };
  const PoolMock = vi.fn(function MockPool() {
    return pool;
  });

  const readFileSync = vi.fn(() => gcatBody);
  const logSpy = vi.spyOn(console, "log").mockImplementation(() => undefined);
  const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => undefined);
  const errorSpy = vi.spyOn(console, "error").mockImplementation(() => undefined);

  vi.doMock("node:fs", () => ({
    readFileSync,
  }));
  vi.doMock("pg", () => ({
    Pool: PoolMock,
  }));
  vi.doMock("drizzle-orm/node-postgres", () => ({
    drizzle,
  }));

  await import("../src/seed/baselines");

  return {
    PoolMock,
    db,
    errorSpy,
    exitMock,
    logSpy,
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
    },
    warnSpy,
  };
}

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe("baselines script", () => {
  it("loads GCAT events, writes baselines for known regimes, and warns for missing regime rows", async () => {
    vi.spyOn(Date, "now").mockReturnValue(Date.UTC(2026, 3, 23));
    const originalSplit = String.prototype.split;
    vi.spyOn(String.prototype, "split").mockImplementation(function mockSplit(separator, limit) {
      if (separator === "\t" && String(this) === "SPARSE_STATUS") {
        const cols = new Array<string>(40);
        cols[1] = "101";
        cols[7] = "2026 Apr 02";
        cols[33] = "520";
        cols[35] = "560";
        cols[37] = "98";
        return cols;
      }
      return originalSplit.call(String(this), separator, limit);
    });
    const gcatBody = [
      "# comment",
      "short",
      makeGcatRow({ perigeeKm: 400, apogeeKm: 500, inclinationDeg: 53 }),
      makeGcatRow({ perigeeKm: 500, apogeeKm: 550, inclinationDeg: 98 }),
      makeGcatRow({ perigeeKm: 10_000, apogeeKm: 12_000, inclinationDeg: 55 }),
      makeGcatRow({ perigeeKm: 35_500, apogeeKm: 35_900, inclinationDeg: 0 }),
      makeGcatRow({ perigeeKm: 300, apogeeKm: 18_000, inclinationDeg: 20 }),
      makeGcatRow({ perigeeKm: 500, apogeeKm: 30_000, inclinationDeg: 63, status: "E" }),
      makeGcatRow({ perigeeKm: 450, apogeeKm: 520, inclinationDeg: 54, status: "D" }),
      "SPARSE_STATUS",
      makeGcatRow({ perigeeKm: "bad", apogeeKm: 500, inclinationDeg: 53 }),
    ].join("\n");
    const run = await loadBaselinesScript({
      gcatBody,
      dbResults: [
        { rows: [] },
        {
          rows: [
            { id: "1", name: "Low Earth Orbit" },
            { id: "2", name: "Medium Earth Orbit" },
            { id: "3", name: "Geostationary Orbit" },
            { id: "4", name: "Sun-Synchronous Orbit" },
            { id: "5", name: "Geostationary Transfer Orbit" },
          ],
        },
        {
          rows: [
            { regime: "leo", computed_at: "2026-04-20T00:00:00.000Z" },
            { regime: "leo", computed_at: "2026-04-21T00:00:00.000Z" },
            { regime: "geo", computed_at: "2026-04-05T00:00:00.000Z" },
            { regime: null, computed_at: "2026-04-01T00:00:00.000Z" },
          ],
        },
        { rows: [] },
        { rows: [] },
        { rows: [] },
        { rows: [] },
        { rows: [] },
      ],
    });

    try {
      await waitForCondition("pool end", () => run.poolEnd.mock.calls.length === 1);

      expect(run.PoolMock).toHaveBeenCalledWith({
        connectionString: "postgres://thalamus:thalamus@localhost:5433/thalamus",
      });
      expect(run.readFileSync).toHaveBeenCalledWith("/tmp/gcat.tsv", "utf8");
      expect(run.db.execute).toHaveBeenCalledTimes(8);
      expect(run.logSpy).toHaveBeenCalledWith(
        "▸ connecting to postgres://***@localhost:5433/thalamus",
      );
      expect(run.logSpy).toHaveBeenCalledWith("▸ ensuring orbit_regime.baselines column");
      expect(run.logSpy).toHaveBeenCalledWith("▸ parsing GCAT from /tmp/gcat.tsv");
      expect(run.logSpy).toHaveBeenCalledWith("▸ classified 8 GCAT rows into regimes");
      expect(run.warnSpy).toHaveBeenCalledWith(
        "  ⚠ regime 'heo' missing from orbit_regime",
      );
      expect(
        run.logSpy.mock.calls.some(
          ([message]) =>
            typeof message === "string" &&
            message.startsWith("  ✓ leo: 2 GCAT objects"),
        ),
      ).toBe(true);
      expect(
        run.logSpy.mock.calls.some(
          ([message]) =>
            typeof message === "string" &&
            message.startsWith("  ✓ gto: 1 GCAT objects"),
        ),
      ).toBe(true);
      expect(run.logSpy).toHaveBeenCalledWith(
        "✓ baselines seeded from real GCAT observables",
      );
      expect(run.errorSpy).not.toHaveBeenCalled();
      expect(run.exitMock).not.toHaveBeenCalled();
    } finally {
      run.restore();
    }
  });

  it("logs and exits when a database operation fails in direct-run mode", async () => {
    const run = await loadBaselinesScript({
      gcatBody: "",
      dbResults: [new Error("ddl boom")],
    });

    try {
      await waitForCondition("process exit", () => run.exitMock.mock.calls.length === 1);

      expect(run.db.execute).toHaveBeenCalledTimes(1);
      expect(run.poolEnd).not.toHaveBeenCalled();
      expect(run.errorSpy).toHaveBeenCalledWith(
        expect.objectContaining({ message: "ddl boom" }),
      );
      expect(run.exitMock).toHaveBeenCalledWith(1);
    } finally {
      run.restore();
    }
  });
});
