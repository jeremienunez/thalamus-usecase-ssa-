import { setTimeout as delay } from "node:timers/promises";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it, vi } from "vitest";

interface SummaryRow {
  object_class: string | null;
  n: number;
}

interface LoadScriptOptions {
  cacheMode: "fresh" | "stale" | "missing";
  cacheBody?: string;
  fetchBody?: string;
  fetchStatus?: number;
  insertedFlags?: boolean[];
  summaryRows?: SummaryRow[];
}

const SCRIPT_PATH = fileURLToPath(
  new URL("../src/seed/populate-space-catalog.ts", import.meta.url),
);
const DB_ENV_KEY = ["DATABASE", "URL"].join("_");

function textResponse(body: string, status = 200): Response {
  return new Response(body, { status });
}

function buildCsvRow({
  name,
  objectId,
  noradId,
  objectType,
  opsStatus = "",
  owner = "",
  launchDate = "",
  decayDate = "",
  period = "",
  inclination = "",
  apogee = "",
  perigee = "",
  rcs = "",
}: {
  name: string;
  objectId: string;
  noradId: number;
  objectType: string;
  opsStatus?: string;
  owner?: string;
  launchDate?: string;
  decayDate?: string;
  period?: string;
  inclination?: string;
  apogee?: string;
  perigee?: string;
  rcs?: string;
}): string {
  return [
    name,
    objectId,
    String(noradId),
    objectType,
    opsStatus,
    owner,
    launchDate,
    decayDate,
    period,
    inclination,
    apogee,
    perigee,
    rcs,
  ].join(",");
}

function buildCsv(rows: string[]): string {
  return [
    "OBJECT_NAME,OBJECT_ID,NORAD_CAT_ID,OBJECT_TYPE,OPS_STATUS_CODE,OWNER,LAUNCH_DATE,DECAY_DATE,PERIOD,INCLINATION,APOGEE,PERIGEE,RCS",
    ...rows,
  ].join("\n");
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

async function loadPopulateScript({
  cacheMode,
  cacheBody = "",
  fetchBody = "",
  fetchStatus = 200,
  insertedFlags = [],
  summaryRows = [],
}: LoadScriptOptions) {
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

  const existsSync = vi.fn(() => cacheMode !== "missing");
  const statSync = vi.fn(() => ({
    mtimeMs: cacheMode === "fresh" ? Date.now() : 0,
  }));
  const readFileSync = vi.fn(() => cacheBody);
  const writeFileSync = vi.fn();

  const fetchMock = vi.fn().mockResolvedValue(
    textResponse(fetchBody, fetchStatus),
  );

  let executeCalls = 0;
  const db = {
    execute: vi.fn(async () => {
      executeCalls++;
      if (executeCalls <= insertedFlags.length) {
        return {
          rows: [{ inserted: insertedFlags[executeCalls - 1] }],
        };
      }
      return { rows: summaryRows };
    }),
  };

  const poolEnd = vi.fn(async () => undefined);
  const pool = { end: poolEnd };
  const PoolMock = vi.fn(function MockPool() {
    return pool;
  });
  const drizzle = vi.fn(() => db);

  const logSpy = vi.spyOn(console, "log").mockImplementation(() => undefined);
  const errorSpy = vi.spyOn(console, "error").mockImplementation(() => undefined);
  const stdoutWrite = vi
    .spyOn(process.stdout, "write")
    .mockImplementation(() => true);

  vi.doMock("node:fs", () => ({
    existsSync,
    readFileSync,
    statSync,
    writeFileSync,
  }));
  vi.doMock("pg", () => ({
    Pool: PoolMock,
  }));
  vi.doMock("drizzle-orm/node-postgres", () => ({
    drizzle,
  }));
  vi.stubGlobal("fetch", fetchMock);

  await import("../src/seed/populate-space-catalog");

  return {
    PoolMock,
    db,
    drizzle,
    errorSpy,
    existsSync,
    exitMock,
    fetchMock,
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
    statSync,
    stdoutWrite,
    writeFileSync,
  };
}

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe("populate-space-catalog script", () => {
  it("uses a fresh cache, batches upserts by 500, and prints the class summary", async () => {
    const rows = [
      ...Array.from({ length: 300 }, (_, index) =>
        buildCsvRow({
          name: `PAY-${index + 1}`,
          objectId: `2026-001${String.fromCharCode(65 + (index % 26))}`,
          noradId: index + 1,
          objectType: "PAY",
          launchDate: "2026-01-01",
        }),
      ),
      ...Array.from({ length: 200 }, (_, index) =>
        buildCsvRow({
          name: `DEB-${index + 1}`,
          objectId: `2026-002${String.fromCharCode(65 + (index % 26))}`,
          noradId: 10_000 + index + 1,
          objectType: "DEB",
          launchDate: "2026-02-01",
        }),
      ),
      buildCsvRow({
        name: "RB-1",
        objectId: "2026-003A",
        noradId: 20_001,
        objectType: "R/B",
        launchDate: "2026-03-01",
      }),
    ];
    const insertedFlags = [
      ...Array.from({ length: 500 }, () => true),
      false,
    ];
    const run = await loadPopulateScript({
      cacheMode: "fresh",
      cacheBody: buildCsv(rows),
      insertedFlags,
      summaryRows: [
        { object_class: "payload", n: 300 },
        { object_class: "debris", n: 200 },
        { object_class: "rocket_stage", n: 1 },
      ],
    });

    try {
      await waitForCondition("pool end", () => run.poolEnd.mock.calls.length === 1);

      expect(run.PoolMock).toHaveBeenCalledWith({
        connectionString: "postgres://thalamus:thalamus@localhost:5433/thalamus",
      });
      expect(run.drizzle).toHaveBeenCalledTimes(1);
      expect(run.existsSync).toHaveBeenCalledWith("/tmp/celestrak-satcat.csv");
      expect(run.statSync).toHaveBeenCalledWith("/tmp/celestrak-satcat.csv");
      expect(run.readFileSync).toHaveBeenCalledWith(
        "/tmp/celestrak-satcat.csv",
        "utf8",
      );
      expect(run.fetchMock).not.toHaveBeenCalled();
      expect(run.writeFileSync).not.toHaveBeenCalled();
      expect(run.db.execute).toHaveBeenCalledTimes(502);
      expect(run.stdoutWrite).toHaveBeenCalledTimes(2);
      expect(run.stdoutWrite.mock.calls[0]?.[0]).toContain("500/501");
      expect(run.stdoutWrite.mock.calls[0]?.[0]).toContain("(+500 new, 0 updated)");
      expect(run.stdoutWrite.mock.calls[1]?.[0]).toContain("501/501");
      expect(run.stdoutWrite.mock.calls[1]?.[0]).toContain("(+500 new, 1 updated)");
      expect(run.logSpy).toHaveBeenCalledWith(
        "▸ parsed 501 alive objects:",
        "payload=300 debris=200 rocket_stage=1",
      );
      expect(run.logSpy).toHaveBeenCalledWith(
        "\n▸ done. 500 inserted, 1 updated.",
      );
      expect(run.logSpy).toHaveBeenCalledWith("\n▸ satellite catalog by object_class:");
      expect(run.logSpy).toHaveBeenCalledWith("  payload        300");
      expect(run.logSpy).toHaveBeenCalledWith("  debris         200");
      expect(run.logSpy).toHaveBeenCalledWith("  rocket_stage   1");
      expect(run.errorSpy).not.toHaveBeenCalled();
      expect(run.exitMock).not.toHaveBeenCalled();
    } finally {
      run.restore();
    }
  });

  it("refetches and rewrites the cache when the SATCAT file is stale", async () => {
    const fetchedBody = buildCsv([
      buildCsvRow({
        name: "NEW-PAYLOAD",
        objectId: "2026-010A",
        noradId: 90001,
        objectType: "PAY",
        launchDate: "2026-04-01",
      }),
      "MYSTERY,2026-010B,90002,ALIEN",
    ]);
    const run = await loadPopulateScript({
      cacheMode: "stale",
      fetchBody: fetchedBody,
      insertedFlags: [true, false],
      summaryRows: [
        { object_class: "payload", n: 1 },
        { object_class: "unknown", n: 1 },
        { object_class: null, n: 1 },
      ],
    });

    try {
      await waitForCondition("pool end", () => run.poolEnd.mock.calls.length === 1);

      expect(run.existsSync).toHaveBeenCalledWith("/tmp/celestrak-satcat.csv");
      expect(run.statSync).toHaveBeenCalledWith("/tmp/celestrak-satcat.csv");
      expect(run.readFileSync).not.toHaveBeenCalled();
      expect(run.fetchMock).toHaveBeenCalledTimes(1);
      expect(run.fetchMock.mock.calls[0]?.[0]).toBe("https://celestrak.org/pub/satcat.csv");
      expect(run.writeFileSync).toHaveBeenCalledWith(
        "/tmp/celestrak-satcat.csv",
        fetchedBody,
        "utf8",
      );
      expect(run.db.execute).toHaveBeenCalledTimes(3);
      expect(run.stdoutWrite).toHaveBeenCalledTimes(1);
      expect(run.stdoutWrite.mock.calls[0]?.[0]).toContain("2/2");
      expect(run.stdoutWrite.mock.calls[0]?.[0]).toContain("(+1 new, 1 updated)");
      expect(run.logSpy).toHaveBeenCalledWith(
        "▸ parsed 2 alive objects:",
        "payload=1 unknown=1",
      );
      expect(run.logSpy).toHaveBeenCalledWith("  unknown        1");
      expect(run.logSpy).toHaveBeenCalledWith("  NULL           1");
      expect(run.exitMock).not.toHaveBeenCalled();
    } finally {
      run.restore();
    }
  });

  it("logs and exits when the SATCAT fetch fails on a cache miss", async () => {
    const run = await loadPopulateScript({
      cacheMode: "missing",
      fetchStatus: 503,
      fetchBody: "down",
    });

    try {
      await waitForCondition("process exit", () => run.exitMock.mock.calls.length === 1);

      expect(run.existsSync).toHaveBeenCalledWith("/tmp/celestrak-satcat.csv");
      expect(run.statSync).not.toHaveBeenCalled();
      expect(run.readFileSync).not.toHaveBeenCalled();
      expect(run.fetchMock).toHaveBeenCalledTimes(1);
      expect(run.writeFileSync).not.toHaveBeenCalled();
      expect(run.poolEnd).toHaveBeenCalledTimes(1);
      expect(run.errorSpy).toHaveBeenCalledWith(
        "\n✗ populate failed:",
        expect.objectContaining({ message: "SATCAT HTTP 503" }),
      );
      expect(run.exitMock).toHaveBeenCalledWith(1);
    } finally {
      run.restore();
    }
  });
});
