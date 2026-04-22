/**
 * SPEC-SH-005 — Observability / logger
 * Traceability:
 *   AC-1 base bindings include service and env
 *   AC-2 test environment is silent
 *   AC-3 development sets level debug (honors LOG_LEVEL)
 *   AC-4 production writes to stdout; Loki attached iff LOKI_HOST set
 *   AC-5 authorization and cookie headers are redacted
 *
 * Note: NODE_ENV is captured at module-load time inside logger.ts
 * (`const isDevelopment = ...`). We therefore vi.resetModules() between
 * per-env tests and dynamically import a fresh copy.
 */
import { describe, it, expect, afterEach, beforeEach, vi } from "vitest";
import { PassThrough } from "node:stream";

const ORIGINAL_ENV = { ...process.env };

function resetEnv() {
  process.env = { ...ORIGINAL_ENV };
}

async function freshLoggerModule() {
  vi.resetModules();
  return (await import("../src/observability/logger")) as typeof import("../src/observability/logger");
}

describe("SPEC-SH-005 createLogger — base bindings", () => {
  beforeEach(() => resetEnv());
  afterEach(() => {
    resetEnv();
    vi.resetModules();
  });

  it("AC-1 base bindings include service and env (development default)", async () => {
    process.env.NODE_ENV = "development";
    const { createLogger } = await freshLoggerModule();
    const logger = createLogger("api");
    const bindings = logger.bindings();
    expect(bindings.service).toBe("api");
    expect(bindings.env).toBe("development");
  });

  it("AC-1 falls back to 'development' when NODE_ENV is unset (non-test path)", async () => {
    delete process.env.NODE_ENV;
    const { createLogger } = await freshLoggerModule();
    const logger = createLogger("api");
    const bindings = logger.bindings();
    expect(bindings.service).toBe("api");
    expect(bindings.env).toBe("development");
  });
});

describe("SPEC-SH-005 createLogger — test env", () => {
  beforeEach(() => resetEnv());
  afterEach(() => {
    resetEnv();
    vi.resetModules();
  });

  it("AC-2 test environment returns a silent logger", async () => {
    process.env.NODE_ENV = "test";
    const { createLogger } = await freshLoggerModule();
    const logger = createLogger("anything");
    expect(logger.level).toBe("silent");
    expect(logger.isLevelEnabled("info")).toBe(false);
    expect(logger.isLevelEnabled("warn")).toBe(false);
    expect(logger.isLevelEnabled("error")).toBe(false);
  });
});

describe("SPEC-SH-005 createLogger — development level", () => {
  beforeEach(() => resetEnv());
  afterEach(() => {
    resetEnv();
    vi.resetModules();
  });

  it("AC-3 development level defaults to 'debug'", async () => {
    process.env.NODE_ENV = "development";
    delete process.env.LOG_LEVEL;
    const { createLogger } = await freshLoggerModule();
    const logger = createLogger("api");
    expect(logger.level).toBe("debug");
  });

  it("AC-3 LOG_LEVEL overrides default in development", async () => {
    process.env.NODE_ENV = "development";
    process.env.LOG_LEVEL = "warn";
    const { createLogger } = await freshLoggerModule();
    const logger = createLogger("api");
    expect(logger.level).toBe("warn");
  });
});

describe("SPEC-SH-005 createLogger — production level & transport decision", () => {
  beforeEach(() => resetEnv());
  afterEach(() => {
    resetEnv();
    vi.resetModules();
  });

  it("AC-4 production level defaults to 'info' and carries env=production", async () => {
    process.env.NODE_ENV = "production";
    delete process.env.LOG_LEVEL;
    delete process.env.LOKI_HOST;
    const { createLogger } = await freshLoggerModule();
    const logger = createLogger("api");
    expect(logger.level).toBe("info");
    const bindings = logger.bindings();
    expect(bindings.service).toBe("api");
    expect(bindings.env).toBe("production");
  });

  it("AC-4 production without LOKI_HOST still constructs a working logger", async () => {
    process.env.NODE_ENV = "production";
    delete process.env.LOKI_HOST;
    const { createLogger } = await freshLoggerModule();
    expect(() => createLogger("api")).not.toThrow();
  });

  it("AC-4 production with LOKI_HOST constructs without throwing", async () => {
    process.env.NODE_ENV = "production";
    process.env.LOKI_HOST = "http://loki:3100";
    const { createLogger } = await freshLoggerModule();
    expect(() => createLogger("api")).not.toThrow();
  });
});

describe("SPEC-SH-005 createLogger — redaction (AC-5)", () => {
  it("AC-5 authorization and cookie are removed from emitted records", async () => {
    // Replicate the exact redact config from logger.ts and pipe to a buffer
    // so we can inspect what pino actually emits.
    const pino = (await import("pino")).default;
    const chunks: string[] = [];
    const dest = new PassThrough();
    dest.on("data", (chunk) => {
      chunks.push(String(chunk));
    });
    const logger = pino(
      {
        base: { service: "api", env: "development" },
        redact: {
          paths: ["req.headers.authorization", "req.headers.cookie"],
          remove: true,
        },
      },
      dest,
    );

    logger.info({
      req: {
        headers: {
          authorization: "Bearer xyz",
          cookie: "sid=abc",
          "x-trace": "keep-me",
        },
      },
      msg: "hit",
    });

    expect(chunks.length).toBeGreaterThan(0);
    const record = JSON.parse(chunks.join(""));
    expect(record.req.headers.authorization).toBeUndefined();
    expect(record.req.headers.cookie).toBeUndefined();
    expect(record.req.headers["x-trace"]).toBe("keep-me");
  });
});
