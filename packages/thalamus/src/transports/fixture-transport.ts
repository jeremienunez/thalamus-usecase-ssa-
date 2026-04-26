/**
 * Fixture LLM transport — disk-replay layer for offline / deterministic demos.
 *
 * Fixture file layout: fixtures/recorded/<sha256(systemPrompt + "\n--\n" + userPrompt)>.json
 * Shape: { content: string, provider: "local"|"kimi"|"openai"|"minimax"|"deepseek"|"none", recordedAt: ISO string }
 *
 * Modes:
 *   - "fixtures" (read-only): replays from disk, throws on miss
 *   - "record"  (write-through): delegates to a real transport, persists hits
 */

import { createHash } from "node:crypto";
import { mkdirSync, readFileSync, writeFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { createLogger } from "@interview/shared/observability";
import { defaultFixturesDir } from "../config/transport-config";
import { throwIfAborted } from "./abort";
import type {
  LlmResponse,
  LlmTransport,
  LlmTransportCallOptions,
} from "./types";
import type { ProviderName } from "./providers/types";

const logger = createLogger("fixture-transport");

export type FixtureMode = "fixtures" | "record";

export interface FixtureTransportOpts {
  systemPrompt: string;
  mode: FixtureMode;
  /** Real transport used in "record" mode to capture live responses */
  realTransport?: LlmTransport;
  /** Override fixtures directory (test-friendly) */
  fixturesDir?: string;
  /**
   * Optional fallback fixture filename (relative to fixturesDir, without .json).
   * When set and the hash-specific fixture is missing in `fixtures` mode,
   * this file is replayed instead of throwing. Useful for tests that exercise
   * many prompts with one canned response, and for demos where a new prompt
   * path hasn't been recorded yet. Default: none (strict mode).
   */
  fallbackFixture?: string;
}

interface FixtureFile {
  content: string;
  provider: ProviderName | "none";
  recordedAt: string;
}

export class FixtureLlmTransport {
  private readonly fixturesDir: string;

  constructor(private opts: FixtureTransportOpts) {
    this.fixturesDir = opts.fixturesDir ?? defaultFixturesDir();
  }

  async call(
    userPrompt: string,
    options?: LlmTransportCallOptions,
  ): Promise<LlmResponse> {
    throwIfAborted(options?.signal);
    const hash = hashPrompt(this.opts.systemPrompt, userPrompt);
    const path = join(this.fixturesDir, `${hash}.json`);

    if (this.opts.mode === "fixtures") {
      if (!existsSync(path)) {
        // Try fallback fixture if configured (tests + in-flight demos).
        if (this.opts.fallbackFixture) {
          const fallback = join(
            this.fixturesDir,
            `${this.opts.fallbackFixture}.json`,
          );
          if (existsSync(fallback)) {
            const file = JSON.parse(
              readFileSync(fallback, "utf-8"),
            ) as FixtureFile;
            logger.debug(
              { hash, fallback: this.opts.fallbackFixture },
              "Fallback fixture replayed",
            );
            return { content: file.content, provider: file.provider };
          }
        }
        throw new Error(
          `Fixture missing: ${path}\n` +
            `Re-run with THALAMUS_MODE=record (live API) to record this call, ` +
            `then switch back to THALAMUS_MODE=fixtures.`,
        );
      }
      const file = JSON.parse(readFileSync(path, "utf-8")) as FixtureFile;
      logger.debug({ hash }, "Fixture replayed");
      return { content: file.content, provider: file.provider };
    }

    // record mode
    if (!this.opts.realTransport) {
      throw new Error(
        "FixtureLlmTransport in record mode requires realTransport",
      );
    }
    if (existsSync(path)) {
      const file = JSON.parse(readFileSync(path, "utf-8")) as FixtureFile;
      return { content: file.content, provider: file.provider };
    }
    const response = options
      ? await this.opts.realTransport.call(userPrompt, options)
      : await this.opts.realTransport.call(userPrompt);
    mkdirSync(this.fixturesDir, { recursive: true });
    const file: FixtureFile = {
      content: response.content,
      provider: response.provider,
      recordedAt: new Date().toISOString(),
    };
    writeFileSync(path, JSON.stringify(file, null, 2), "utf-8");
    logger.info({ hash, path }, "Fixture recorded");
    return response;
  }
}

function hashPrompt(systemPrompt: string, userPrompt: string): string {
  return createHash("sha256")
    .update(`${systemPrompt}\n--\n${userPrompt}`)
    .digest("hex");
}
