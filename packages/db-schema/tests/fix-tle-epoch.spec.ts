import { afterEach, describe, expect, it, vi } from "vitest";

const DB_ENV_KEY = ["DATABASE", "URL"].join("_");

async function loadFixTleEpoch({
  databaseUrl,
  executeImpl,
  parseTleEpochImpl,
}: {
  databaseUrl?: string;
  executeImpl: (callIndex: number) => Promise<unknown>;
  parseTleEpochImpl: (line1: string) => string | null;
}) {
  vi.resetModules();

  const originalExit = process.exit;
  const previousDatabaseUrl = process.env[DB_ENV_KEY];
  if (databaseUrl === undefined) delete process.env[DB_ENV_KEY];
  else process.env[DB_ENV_KEY] = databaseUrl;

  const exitMock = vi.fn();
  Object.defineProperty(process, "exit", {
    configurable: true,
    value: exitMock,
  });

  let callIndex = 0;
  const execute = vi.fn(async () => executeImpl(++callIndex));
  const db = { execute };
  const drizzle = vi.fn(() => db);
  const poolEnd = vi.fn(async () => undefined);
  const PoolMock = vi.fn(function MockPool() {
    return { end: poolEnd };
  });
  const parseTleEpoch = vi.fn(parseTleEpochImpl);

  const logSpy = vi.spyOn(console, "log").mockImplementation(() => undefined);
  const errorSpy = vi.spyOn(console, "error").mockImplementation(() => undefined);

  vi.doMock("pg", () => ({
    Pool: PoolMock,
  }));
  vi.doMock("drizzle-orm/node-postgres", () => ({
    drizzle,
  }));
  vi.doMock("../src/seed/index", () => ({
    parseTleEpoch,
  }));

  await import("../src/seed/fix-tle-epoch");

  return {
    PoolMock,
    errorSpy,
    execute,
    exitMock,
    logSpy,
    parseTleEpoch,
    poolEnd,
    restore: () => {
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
});

describe("fix-tle-epoch script", () => {
  it("updates only rows with parseable tle epochs and reports the summary", async () => {
    const run = await loadFixTleEpoch({
      executeImpl: async (callIndex) => {
        if (callIndex === 1) {
          return {
            rows: [
              { id: 1, line1: null },
              { id: 2, line1: "BAD" },
              { id: 3, line1: "GOOD" },
            ],
          };
        }
        if (callIndex === 2) return { rows: [] };
        return { rows: [{ n: 7 }] };
      },
      parseTleEpochImpl: (line1) => (line1 === "GOOD" ? "2026-04-23T12:00:00.000Z" : null),
    });

    try {
      await vi.waitFor(() => {
        expect(run.poolEnd).toHaveBeenCalledTimes(1);
      });

      expect(run.PoolMock).toHaveBeenCalledWith({
        connectionString: "postgres://thalamus:thalamus@localhost:5433/thalamus",
      });
      expect(run.logSpy).toHaveBeenCalledWith("▸ scanning 3 satellites with TLE line1");
      expect(run.parseTleEpoch).toHaveBeenCalledTimes(2);
      expect(run.execute).toHaveBeenCalledTimes(3);
      expect(run.logSpy).toHaveBeenCalledWith(
        "✓ updated 1 (skipped 2); satellites with tleEpoch = 7",
      );
      expect(run.poolEnd).toHaveBeenCalledTimes(1);
      expect(run.errorSpy).not.toHaveBeenCalled();
      expect(run.exitMock).not.toHaveBeenCalled();
    } finally {
      run.restore();
    }
  });

  it("logs and exits when the backfill query fails", async () => {
    const run = await loadFixTleEpoch({
      databaseUrl: "postgres://user:pass@db.example/thalamus",
      executeImpl: async () => {
        throw new Error("db exploded");
      },
      parseTleEpochImpl: () => null,
    });

    try {
      await vi.waitFor(() => {
        expect(run.exitMock).toHaveBeenCalledWith(1);
      });

      expect(run.PoolMock).toHaveBeenCalledWith({
        connectionString: "postgres://user:pass@db.example/thalamus",
      });
      expect(run.execute).toHaveBeenCalledTimes(1);
      expect(run.poolEnd).not.toHaveBeenCalled();
      expect(run.errorSpy).toHaveBeenCalledWith(
        "✗ fix-tle-epoch failed:",
        expect.objectContaining({ message: "db exploded" }),
      );
      expect(run.exitMock).toHaveBeenCalledWith(1);
    } finally {
      run.restore();
    }
  });
});
