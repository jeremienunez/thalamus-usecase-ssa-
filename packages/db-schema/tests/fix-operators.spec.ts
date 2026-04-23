import { afterEach, describe, expect, it, vi } from "vitest";

const DB_ENV_KEY = ["DATABASE", "URL"].join("_");

async function loadFixOperators({
  databaseUrl,
  executeImpl,
  guessCountryImpl,
  guessOperatorImpl,
  operatorRows,
  satelliteRows,
}: {
  databaseUrl?: string;
  executeImpl: (callIndex: number) => Promise<unknown>;
  guessCountryImpl: (name: string, slug: string) => string;
  guessOperatorImpl: (name: string) => string;
  operatorRows: Array<{ id: bigint; slug: string }> | Error;
  satelliteRows: Array<{
    id: bigint;
    name: string;
    operatorId: bigint | null;
    operatorCountryId: bigint | null;
  }> | Error;
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

  const operatorTable = { table: "operator" };
  const satelliteTable = { table: "satellite" };

  let executeCallIndex = 0;
  const execute = vi.fn(async () => executeImpl(++executeCallIndex));
  const returningResults = new Map<string, Array<{ id: bigint }>>([
    ["eutelsat", [{ id: 10n }]],
    ["imagesat", []],
    ["usaf", [{ id: 11n }]],
  ]);
  const insert = vi.fn((table: object) => ({
    values: (row: { slug: string; name: string }) => ({
      returning: async () => {
        expect(table).toBe(operatorTable);
        return returningResults.get(row.slug) ?? [];
      },
    }),
  }));
  const select = vi.fn(() => ({
    from: async (table: object) => {
      if (table === operatorTable) {
        if (operatorRows instanceof Error) throw operatorRows;
        return operatorRows;
      }
      if (table === satelliteTable) {
        if (satelliteRows instanceof Error) throw satelliteRows;
        return satelliteRows;
      }
      return [];
    },
  }));
  const db = { execute, insert, select };
  const drizzle = vi.fn(() => db);

  const poolEnd = vi.fn(async () => undefined);
  const PoolMock = vi.fn(function MockPool() {
    return { end: poolEnd };
  });
  const guessOperator = vi.fn(guessOperatorImpl);
  const guessCountry = vi.fn(guessCountryImpl);

  const logSpy = vi.spyOn(console, "log").mockImplementation(() => undefined);
  const errorSpy = vi.spyOn(console, "error").mockImplementation(() => undefined);

  vi.doMock("pg", () => ({
    Pool: PoolMock,
  }));
  vi.doMock("drizzle-orm/node-postgres", () => ({
    drizzle,
  }));
  vi.doMock("../src/schema", () => ({
    satellite: satelliteTable,
    operator: operatorTable,
  }));
  vi.doMock("../src/seed/index", () => ({
    guessOperator,
    guessCountry,
  }));

  await import("../src/seed/fix-operators");

  return {
    PoolMock,
    errorSpy,
    execute,
    exitMock,
    guessCountry,
    guessOperator,
    insert,
    logSpy,
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

describe("fix-operators script", () => {
  it("backfills missing operators, updates changed satellites, and logs the top operators", async () => {
    const run = await loadFixOperators({
      executeImpl: async (callIndex) => {
        if (callIndex === 1) {
          return {
            rows: [
              { id: 1, slug: "us" },
              { id: 2, slug: "eu" },
              { id: 999, slug: "eu" },
            ],
          };
        }
        if (callIndex === 2) return { rows: [] };
        return {
          rows: [{ slug: "spacex", n: 4 }],
        };
      },
      guessCountryImpl: (_name, slug) => (slug === "spacex" ? "us" : slug === "eutelsat" ? "eu" : "missing"),
      guessOperatorImpl: (name) => {
        if (name.includes("STARLINK")) return "spacex";
        if (name.includes("EUTELSAT")) return "eutelsat";
        if (name.includes("USAF")) return "usaf";
        return "missing";
      },
      operatorRows: [
        { id: 1n, slug: "spacex" },
        { id: 10n, slug: "eutelsat" },
      ],
      satelliteRows: [
        { id: 100n, name: "STARLINK-1000", operatorId: null, operatorCountryId: null },
        { id: 101n, name: "EUTELSAT-1", operatorId: 5n, operatorCountryId: 5n },
        { id: 102n, name: "NO-MATCH", operatorId: null, operatorCountryId: null },
        { id: 103n, name: "STARLINK-UNCHANGED", operatorId: 1n, operatorCountryId: 1n },
        { id: 104n, name: "USAF-UNCHANGED", operatorId: 11n, operatorCountryId: null },
      ],
    });

    try {
      await vi.waitFor(() => {
        expect(run.poolEnd).toHaveBeenCalledTimes(1);
      });

      expect(run.PoolMock).toHaveBeenCalledWith({
        connectionString: "postgres://thalamus:thalamus@localhost:5433/thalamus",
      });
      expect(run.insert).toHaveBeenCalledTimes(2);
      expect(run.guessOperator).toHaveBeenCalledTimes(5);
      expect(run.guessCountry).toHaveBeenCalledTimes(5);
      expect(run.execute).toHaveBeenCalledTimes(4);
      expect(run.logSpy).toHaveBeenCalledWith("▸ scanning 5 satellites");
      expect(run.logSpy).toHaveBeenCalledWith("✓ updated 2 satellites");
      expect(run.logSpy).toHaveBeenCalledWith("▸ top operators:", [{ slug: "spacex", n: 4 }]);
      expect(run.poolEnd).toHaveBeenCalledTimes(1);
      expect(run.errorSpy).not.toHaveBeenCalled();
      expect(run.exitMock).not.toHaveBeenCalled();
    } finally {
      run.restore();
    }
  });

  it("logs and exits when the operator scan fails", async () => {
    const run = await loadFixOperators({
      databaseUrl: "postgres://user:pass@db.example/thalamus",
      executeImpl: async () => ({ rows: [] }),
      guessCountryImpl: () => "other",
      guessOperatorImpl: () => "other",
      operatorRows: new Error("db exploded"),
      satelliteRows: [],
    });

    try {
      await vi.waitFor(() => {
        expect(run.exitMock).toHaveBeenCalledWith(1);
      });

      expect(run.PoolMock).toHaveBeenCalledWith({
        connectionString: "postgres://user:pass@db.example/thalamus",
      });
      expect(run.errorSpy).toHaveBeenCalledWith(
        "✗ fix-operators failed:",
        expect.objectContaining({ message: "db exploded" }),
      );
      expect(run.exitMock).toHaveBeenCalledWith(1);
    } finally {
      run.restore();
    }
  });
});
