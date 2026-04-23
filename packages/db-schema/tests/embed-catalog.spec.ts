import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  classifyRegime,
  composeText,
  embedDocuments,
} from "../src/seed/embed-catalog";

const DB_ENV_KEY = ["DATABASE", "URL"].join("_");
const VOYAGE_ENV_KEY = ["VOYAGE", "API", "KEY"].join("_");
const SCRIPT_PATH = fileURLToPath(
  new URL("../src/seed/embed-catalog.ts", import.meta.url),
);

function makeCatalogRow(
  overrides: Partial<Parameters<typeof composeText>[0]> = {},
): Parameters<typeof composeText>[0] {
  return {
    id: "1",
    name: "SAT-1",
    objectClass: "payload",
    noradId: 25544,
    launchYear: 2024,
    operator: "SpaceX",
    operatorCountry: "United States",
    platformClass: "communications",
    bus: "Starlink Bus",
    apogeeKm: 550,
    perigeeKm: 540,
    inclinationDeg: 53.2,
    massKg: 260,
    ...overrides,
  };
}

async function loadEmbedCatalogScript({
  apiKey,
  batch,
  databaseUrl,
  embedForce,
  embedLimit,
  executeImpl,
  fetchImpl,
  nowValues = [10_000, 12_500, 15_000],
  transactionImpl,
}: {
  apiKey?: string;
  batch?: string;
  databaseUrl?: string;
  embedForce?: string;
  embedLimit?: string;
  executeImpl: (callIndex: number) => Promise<unknown>;
  fetchImpl: (input: string | URL, init?: RequestInit) => Promise<unknown>;
  nowValues?: number[];
  transactionImpl?: (
    tx: { execute: (query: unknown) => Promise<unknown> },
  ) => Promise<void>;
}) {
  vi.resetModules();

  const originalArgv = process.argv;
  const originalExit = process.exit;
  const previousApiKey = process.env[VOYAGE_ENV_KEY];
  const previousBatch = process.env.EMBED_BATCH;
  const previousDatabaseUrl = process.env[DB_ENV_KEY];
  const previousForce = process.env.EMBED_FORCE;
  const previousLimit = process.env.EMBED_LIMIT;

  if (apiKey === undefined) delete process.env[VOYAGE_ENV_KEY];
  else process.env[VOYAGE_ENV_KEY] = apiKey;
  if (batch === undefined) delete process.env.EMBED_BATCH;
  else process.env.EMBED_BATCH = batch;
  if (databaseUrl === undefined) delete process.env[DB_ENV_KEY];
  else process.env[DB_ENV_KEY] = databaseUrl;
  if (embedForce === undefined) delete process.env.EMBED_FORCE;
  else process.env.EMBED_FORCE = embedForce;
  if (embedLimit === undefined) delete process.env.EMBED_LIMIT;
  else process.env.EMBED_LIMIT = embedLimit;

  Object.defineProperty(process, "argv", {
    configurable: true,
    value: ["/usr/bin/node", SCRIPT_PATH],
  });
  const exitMock = vi.fn();
  Object.defineProperty(process, "exit", {
    configurable: true,
    value: exitMock,
  });

  let executeCallIndex = 0;
  const execute = vi.fn(async () => executeImpl(++executeCallIndex));
  const txExecute = vi.fn(async () => ({ rows: [] }));
  const transaction = vi.fn(async (callback: (tx: { execute: typeof txExecute }) => Promise<void>) => {
    if (transactionImpl) {
      await transactionImpl({ execute: txExecute });
      return;
    }
    await callback({ execute: txExecute });
  });
  const db = {
    execute,
    transaction,
  };
  const drizzle = vi.fn(() => db);
  const poolEnd = vi.fn(async () => undefined);
  const PoolMock = vi.fn(function MockPool() {
    return { end: poolEnd };
  });

  const fetchMock = vi.fn(fetchImpl);
  vi.stubGlobal("fetch", fetchMock);

  const logSpy = vi.spyOn(console, "log").mockImplementation(() => undefined);
  const errorSpy = vi.spyOn(console, "error").mockImplementation(() => undefined);
  const stdoutWrite = vi.spyOn(process.stdout, "write").mockImplementation(() => true);

  let nowIndex = 0;
  vi.spyOn(Date, "now").mockImplementation(
    () => nowValues[nowIndex++] ?? 20_000 + nowIndex * 1_000,
  );

  vi.doMock("pg", () => ({
    Pool: PoolMock,
  }));
  vi.doMock("drizzle-orm/node-postgres", () => ({
    drizzle,
  }));

  await import("../src/seed/embed-catalog");

  return {
    PoolMock,
    db,
    errorSpy,
    execute,
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
      if (previousApiKey === undefined) delete process.env[VOYAGE_ENV_KEY];
      else process.env[VOYAGE_ENV_KEY] = previousApiKey;
      if (previousBatch === undefined) delete process.env.EMBED_BATCH;
      else process.env.EMBED_BATCH = previousBatch;
      if (previousDatabaseUrl === undefined) delete process.env[DB_ENV_KEY];
      else process.env[DB_ENV_KEY] = previousDatabaseUrl;
      if (previousForce === undefined) delete process.env.EMBED_FORCE;
      else process.env.EMBED_FORCE = previousForce;
      if (previousLimit === undefined) delete process.env.EMBED_LIMIT;
      else process.env.EMBED_LIMIT = previousLimit;
    },
    stdoutWrite,
    transaction,
    txExecute,
  };
}

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe("embed catalog helpers", () => {
  it("classifies orbital regimes and composes dense embedding text", () => {
    expect(classifyRegime(400, 500)).toBe("LEO");
    expect(classifyRegime(10_000, 12_000)).toBe("MEO");
    expect(classifyRegime(35_500, 35_900)).toBe("GEO");
    expect(classifyRegime(40_000, 41_000)).toBe("HEO");

    expect(composeText(makeCatalogRow())).toContain(
      "SAT-1 · payload · LEO · altitude 540x550km · inclination 53.2° · SpaceX",
    );
    expect(
      composeText(
        makeCatalogRow({
          apogeeKm: null,
          perigeeKm: null,
          inclinationDeg: null,
          objectClass: null,
          operator: null,
          operatorCountry: null,
          platformClass: null,
          bus: null,
          launchYear: null,
          massKg: null,
          noradId: null,
        }),
      ),
    ).toBe("SAT-1 · unknown-regime · altitude-unknown");
  });

  it("returns an empty array for empty embedding requests", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    await expect(embedDocuments("voyage-key", [])).resolves.toEqual([]);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("batches Voyage calls and writes embeddings back at the correct offsets", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          data: [
            { embedding: [0.1, 0.2], index: 0 },
            { embedding: [0.3, 0.4], index: 1 },
          ],
        }),
      })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          data: [{ embedding: [0.9, 1.0], index: 0 }],
        }),
      });
    vi.stubGlobal("fetch", fetchMock);

    const texts = Array.from({ length: 129 }, (_, index) => `doc-${index}`);
    const vectors = await embedDocuments("voyage-key", texts);

    const firstBody = JSON.parse(String(fetchMock.mock.calls[0]?.[1]?.body));
    expect(firstBody).toEqual({
      model: "voyage-4-large",
      input: texts.slice(0, 128),
      input_type: "document",
      output_dimension: 2048,
      truncation: true,
    });
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(vectors[0]).toEqual([0.1, 0.2]);
    expect(vectors[1]).toEqual([0.3, 0.4]);
    expect(vectors[128]).toEqual([0.9, 1.0]);
  });

  it("logs HTTP and thrown Voyage failures while keeping null placeholders", async () => {
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce({
        ok: false,
        status: 500,
        text: async () => "bad gateway",
      })
      .mockRejectedValueOnce(new Error("network down"));
    vi.stubGlobal("fetch", fetchMock);

    const vectors = await embedDocuments(
      "voyage-key",
      Array.from({ length: 129 }, (_, index) => `doc-${index}`),
    );

    expect(vectors.every((entry) => entry === null)).toBe(true);
    expect(errorSpy).toHaveBeenCalledWith("  voyage HTTP 500: bad gateway");
    expect(errorSpy).toHaveBeenCalledWith(
      "  voyage call failed at batch 128:",
      expect.objectContaining({ message: "network down" }),
    );
  });
});

describe("embed-catalog script", () => {
  it("exits early when VOYAGE_API_KEY is missing", async () => {
    const run = await loadEmbedCatalogScript({
      executeImpl: async () => ({ rows: [] }),
      fetchImpl: async () => ({ ok: true }),
    });

    try {
      expect(run.PoolMock).not.toHaveBeenCalled();
      expect(run.errorSpy).toHaveBeenCalledWith(
        "✗ VOYAGE_API_KEY missing — run via `pnpm exec dotenv` or set it in .env",
      );
      expect(run.exitMock).toHaveBeenCalledWith(1);
    } finally {
      run.restore();
    }
  });

  it("returns early when there is nothing left to embed", async () => {
    const run = await loadEmbedCatalogScript({
      apiKey: "voyage-key",
      databaseUrl: "postgres://user:pass@db.example/thalamus",
      embedForce: "1",
      executeImpl: async () => ({
        rows: [],
      }),
      fetchImpl: async () => ({
        ok: true,
      }),
    });

    try {
      await vi.waitFor(() => {
        expect(run.poolEnd).toHaveBeenCalledTimes(1);
      });

      expect(run.PoolMock).toHaveBeenCalledWith({
        connectionString: "postgres://user:pass@db.example/thalamus",
      });
      expect(run.logSpy).toHaveBeenCalledWith(
        "▸ connecting to postgres://***@db.example/thalamus",
      );
      expect(run.logSpy).toHaveBeenCalledWith("▸ 0 rows to embed (force=true)");
      expect(run.logSpy).toHaveBeenCalledWith(
        "▸ nothing to do — all rows already embedded",
      );
      expect(run.fetchMock).not.toHaveBeenCalled();
      expect(run.errorSpy).not.toHaveBeenCalled();
      expect(run.exitMock).not.toHaveBeenCalled();
    } finally {
      run.restore();
    }
  });

  it("embeds rows in batches, skips null vectors, writes progress, and reports the final state", async () => {
    const run = await loadEmbedCatalogScript({
      apiKey: "voyage-key",
      batch: "2",
      embedLimit: "2",
      executeImpl: async (callIndex) => {
        if (callIndex === 1) {
          return {
            rows: [
              makeCatalogRow({ id: "1", name: "SAT-ALPHA" }),
              makeCatalogRow({ id: "2", name: "SAT-BETA", operator: null }),
            ],
          };
        }
        return {
          rows: [{ total: 2, embedded: 1, missing: 1 }],
        };
      },
      fetchImpl: async () => ({
        ok: true,
        json: async () => ({
          data: [{ embedding: [0.25, 0.5], index: 0 }],
        }),
      }),
    });

    try {
      await vi.waitFor(() => {
        expect(run.poolEnd).toHaveBeenCalledTimes(1);
      });

      expect(run.execute).toHaveBeenCalledTimes(2);
      expect(run.transaction).toHaveBeenCalledTimes(1);
      expect(run.txExecute).toHaveBeenCalledTimes(1);
      expect(run.fetchMock).toHaveBeenCalledTimes(1);

      const voyageBody = JSON.parse(String(run.fetchMock.mock.calls[0]?.[1]?.body));
      expect(voyageBody.model).toBe("voyage-4-large");
      expect(voyageBody.input).toEqual([
        expect.stringContaining("SAT-ALPHA"),
        expect.stringContaining("SAT-BETA"),
      ]);
      expect(run.stdoutWrite).toHaveBeenCalledWith(
        "\r  embedded 1/2  fail=1  elapsed=2.5s",
      );
      expect(run.logSpy).toHaveBeenCalledWith("");
      expect(run.logSpy).toHaveBeenCalledWith("▸ catalog embedding state:", {
        total: 2,
        embedded: 1,
        missing: 1,
      });
      expect(run.errorSpy).not.toHaveBeenCalled();
      expect(run.exitMock).not.toHaveBeenCalled();
    } finally {
      run.restore();
    }
  });

  it("logs and exits when embedding fails after connecting", async () => {
    const run = await loadEmbedCatalogScript({
      apiKey: "voyage-key",
      executeImpl: async () => {
        throw new Error("db exploded");
      },
      fetchImpl: async () => ({
        ok: true,
      }),
    });

    try {
      await vi.waitFor(() => {
        expect(run.exitMock).toHaveBeenCalledWith(1);
      });

      expect(run.poolEnd).toHaveBeenCalledTimes(1);
      expect(run.errorSpy).toHaveBeenCalledWith(
        "\n✗ embed failed:",
        expect.objectContaining({ message: "db exploded" }),
      );
    } finally {
      run.restore();
    }
  });
});
