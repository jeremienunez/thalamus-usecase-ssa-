import { mkdtempSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  defaultFixturesDir,
} from "../src/config/transport-config";
import { FixtureLlmTransport } from "../src/transports/fixture-transport";

const logger = vi.hoisted(() => ({
  debug: vi.fn(),
  info: vi.fn(),
  warn: vi.fn(),
  error: vi.fn(),
}));

vi.mock("@interview/shared/observability", () => ({
  createLogger: () => logger,
}));

const tempDirs: string[] = [];

function makeFixturesDir(): string {
  const dir = mkdtempSync(join(tmpdir(), "thalamus-fixtures-"));
  tempDirs.push(dir);
  return dir;
}

afterEach(() => {
  for (const dir of tempDirs.splice(0)) {
    rmSync(dir, { recursive: true, force: true });
  }
  vi.restoreAllMocks();
  logger.debug.mockReset();
  logger.info.mockReset();
  logger.warn.mockReset();
  logger.error.mockReset();
});

describe("FixtureLlmTransport", () => {
  it("defaults to the repo fixtures directory when no override is provided", () => {
    const transport = new FixtureLlmTransport({
      systemPrompt: "SYSTEM",
      mode: "fixtures",
    });

    expect(Reflect.get(transport, "fixturesDir")).toBe(defaultFixturesDir());
  });

  it("records a new response once, then replays the cached fixture on later calls", async () => {
    const fixturesDir = makeFixturesDir();
    const realTransport = {
      call: vi.fn(async () => ({
        content: "recorded answer",
        provider: "openai" as const,
      })),
    };
    const recordTransport = new FixtureLlmTransport({
      systemPrompt: "SYSTEM",
      mode: "record",
      realTransport,
      fixturesDir,
    });

    const first = await recordTransport.call("USER");
    const second = await recordTransport.call("USER");
    const replay = await new FixtureLlmTransport({
      systemPrompt: "SYSTEM",
      mode: "fixtures",
      fixturesDir,
    }).call("USER");

    expect(first).toEqual({
      content: "recorded answer",
      provider: "openai",
    });
    expect(second).toEqual(first);
    expect(replay).toEqual(first);
    expect(realTransport.call).toHaveBeenCalledTimes(1);
    expect(readdirSync(fixturesDir)).toHaveLength(1);
  });

  it("replays the configured fallback fixture when the hash-specific file is missing", async () => {
    const fixturesDir = makeFixturesDir();
    writeFileSync(
      join(fixturesDir, "fallback.json"),
      JSON.stringify({
        content: "fallback answer",
        provider: "none",
        recordedAt: new Date("2026-04-22T00:00:00Z").toISOString(),
      }),
      "utf8",
    );

    const transport = new FixtureLlmTransport({
      systemPrompt: "SYSTEM",
      mode: "fixtures",
      fixturesDir,
      fallbackFixture: "fallback",
    });

    await expect(transport.call("missing prompt")).resolves.toEqual({
      content: "fallback answer",
      provider: "none",
    });
  });

  it("throws a helpful error when no fixture exists and no fallback is configured", async () => {
    const fixturesDir = makeFixturesDir();
    const transport = new FixtureLlmTransport({
      systemPrompt: "SYSTEM",
      mode: "fixtures",
      fixturesDir,
    });

    await expect(transport.call("missing prompt")).rejects.toThrow(
      "THALAMUS_MODE=record",
    );
  });

  it("throws when a fallback fixture id is configured but the fallback file is absent", async () => {
    const fixturesDir = makeFixturesDir();
    const transport = new FixtureLlmTransport({
      systemPrompt: "SYSTEM",
      mode: "fixtures",
      fixturesDir,
      fallbackFixture: "missing-fallback",
    });

    await expect(transport.call("missing prompt")).rejects.toThrow(
      "Fixture missing:",
    );
  });

  it("requires a real transport in record mode", async () => {
    const fixturesDir = makeFixturesDir();
    const transport = new FixtureLlmTransport({
      systemPrompt: "SYSTEM",
      mode: "record",
      fixturesDir,
    });

    await expect(transport.call("USER")).rejects.toThrow(
      "FixtureLlmTransport in record mode requires realTransport",
    );
  });
});
