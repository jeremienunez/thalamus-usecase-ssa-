import { afterEach, describe, expect, it, vi } from "vitest";

const DB_ENV_KEY = ["DATABASE", "URL"].join("_");

async function loadConjunctionsCli({
  databaseUrl,
  result = { screened: 12, candidates: 3, inserted: 1 },
}: {
  databaseUrl?: string;
  result?: { screened: number; candidates: number; inserted: number } | Error;
} = {}) {
  vi.resetModules();

  const originalExit = process.exit;
  const previousDatabaseUrl = process.env[DB_ENV_KEY];
  const previousWindowDays = process.env.CONJ_WINDOW_DAYS;
  const previousStepSeconds = process.env.CONJ_STEP_SECONDS;
  const previousThresholdKm = process.env.CONJ_THRESHOLD_KM;
  const previousMaxPerRegime = process.env.CONJ_MAX_PER_REGIME;

  if (databaseUrl === undefined) delete process.env[DB_ENV_KEY];
  else process.env[DB_ENV_KEY] = databaseUrl;

  const exitMock = vi.fn();
  Object.defineProperty(process, "exit", {
    configurable: true,
    value: exitMock,
  });

  const poolEnd = vi.fn(async () => undefined);
  const PoolMock = vi.fn(function MockPool() {
    return { end: poolEnd };
  });
  const db = { tag: "db" };
  const drizzle = vi.fn(() => db);
  const seedConjunctions = vi.fn(async () => {
    if (result instanceof Error) throw result;
    return result;
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
  vi.doMock("../src/seed/conjunctions", () => ({
    seedConjunctions,
  }));

  await import("../src/seed/conjunctions-cli");

  return {
    PoolMock,
    db,
    errorSpy,
    exitMock,
    logSpy,
    poolEnd,
    restore: () => {
      Object.defineProperty(process, "exit", {
        configurable: true,
        value: originalExit,
      });
      if (previousDatabaseUrl === undefined) delete process.env[DB_ENV_KEY];
      else process.env[DB_ENV_KEY] = previousDatabaseUrl;
      if (previousWindowDays === undefined) delete process.env.CONJ_WINDOW_DAYS;
      else process.env.CONJ_WINDOW_DAYS = previousWindowDays;
      if (previousStepSeconds === undefined) delete process.env.CONJ_STEP_SECONDS;
      else process.env.CONJ_STEP_SECONDS = previousStepSeconds;
      if (previousThresholdKm === undefined) delete process.env.CONJ_THRESHOLD_KM;
      else process.env.CONJ_THRESHOLD_KM = previousThresholdKm;
      if (previousMaxPerRegime === undefined) delete process.env.CONJ_MAX_PER_REGIME;
      else process.env.CONJ_MAX_PER_REGIME = previousMaxPerRegime;
    },
    seedConjunctions,
  };
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe("conjunctions-cli script", () => {
  it("uses default env options and reports the screening summary", async () => {
    delete process.env.CONJ_WINDOW_DAYS;
    delete process.env.CONJ_STEP_SECONDS;
    delete process.env.CONJ_THRESHOLD_KM;
    delete process.env.CONJ_MAX_PER_REGIME;

    const run = await loadConjunctionsCli();

    try {
      await vi.waitFor(() => {
        expect(run.poolEnd).toHaveBeenCalledTimes(1);
      });

      expect(run.PoolMock).toHaveBeenCalledWith({
        connectionString: "postgres://thalamus:thalamus@localhost:5433/thalamus",
      });
      expect(run.seedConjunctions).toHaveBeenCalledWith(run.db, {
        windowDays: 3,
        stepSeconds: 300,
        thresholdKm: 5,
        maxPerRegime: 150,
      });
      expect(run.logSpy).toHaveBeenCalledWith(
        "▸ connecting to postgres://***@localhost:5433/thalamus",
      );
      expect(run.logSpy).toHaveBeenCalledWith("▸ options", {
        windowDays: 3,
        stepSeconds: 300,
        thresholdKm: 5,
        maxPerRegime: 150,
      });
      expect(run.logSpy).toHaveBeenCalledWith(
        "✓ done in 2.5s — screened=12 candidates=3 inserted=1",
      );
      expect(run.poolEnd).toHaveBeenCalledTimes(1);
      expect(run.errorSpy).not.toHaveBeenCalled();
      expect(run.exitMock).not.toHaveBeenCalled();
    } finally {
      run.restore();
    }
  });

  it("logs and exits when conjunction seeding fails", async () => {
    process.env.CONJ_WINDOW_DAYS = "1";
    process.env.CONJ_STEP_SECONDS = "60";
    process.env.CONJ_THRESHOLD_KM = "10";
    process.env.CONJ_MAX_PER_REGIME = "20";

    const run = await loadConjunctionsCli({
      databaseUrl: "postgres://user:pass@db.example/thalamus",
      result: new Error("sgp4 exploded"),
    });

    try {
      await vi.waitFor(() => {
        expect(run.exitMock).toHaveBeenCalledWith(1);
      });

      expect(run.PoolMock).toHaveBeenCalledWith({
        connectionString: "postgres://user:pass@db.example/thalamus",
      });
      expect(run.seedConjunctions).toHaveBeenCalledWith(run.db, {
        windowDays: 1,
        stepSeconds: 60,
        thresholdKm: 10,
        maxPerRegime: 20,
      });
      expect(run.errorSpy).toHaveBeenCalledWith(
        expect.objectContaining({ message: "sgp4 exploded" }),
      );
      expect(run.exitMock).toHaveBeenCalledWith(1);
    } finally {
      run.restore();
    }
  });
});
