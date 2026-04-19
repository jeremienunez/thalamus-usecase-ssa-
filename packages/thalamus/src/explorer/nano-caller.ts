/**
 * Shared nano HTTP caller — used by both nano-swarm (explorer) and nano-sweep (audit).
 * Single responsibility: call gpt-5.4-nano via OpenAI Responses API.
 */

import { createHash } from "node:crypto";
import { mkdirSync, readFileSync, writeFileSync, existsSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { createLogger } from "@interview/shared/observability";
import {
  type ConfigProvider,
  type NanoConfig,
  DEFAULT_NANO_CONFIG,
  StaticConfigProvider,
} from "@interview/shared/config";
import { stripThinkingChannels } from "../transports/providers/strip-thinking";

const logger = createLogger("nano-caller");

/**
 * Runtime-tunable nano config (model name + call timeout). Defaults to
 * the legacy hardcoded constants; console-api overrides via
 * `setNanoConfigProvider(redisBackedProvider)` at container boot so ops
 * can tune via HTTP (PATCH /api/config/runtime/thalamus.nano).
 */
let nanoConfigProvider: ConfigProvider<NanoConfig> =
  new StaticConfigProvider(DEFAULT_NANO_CONFIG);

export function setNanoConfigProvider(
  provider: ConfigProvider<NanoConfig>,
): void {
  nanoConfigProvider = provider;
}

/** Back-compat re-export: a few tests + log lines reference NANO_MODEL. */
export const NANO_MODEL = DEFAULT_NANO_CONFIG.model;

const __dirname = dirname(fileURLToPath(import.meta.url));

function fixturesDir(): string {
  if (process.env.FIXTURES_DIR) return process.env.FIXTURES_DIR;
  return join(__dirname, "..", "..", "..", "..", "fixtures", "recorded");
}

interface NanoFixtureFile {
  text: string;
  model: string;
  recordedAt: string;
}

export interface NanoResponseFormat {
  type: "json_schema";
  name: string;
  schema: Record<string, unknown>;
  strict: boolean;
}

export interface NanoRequest {
  instructions: string;
  input: string;
  enableWebSearch?: boolean;
  responseFormat?: NanoResponseFormat;
  logitBias?: Record<number, number>;
  /** Per-call overrides that win over the NanoConfig defaults. Used by sim
   *  fish turns (read from sim.fish) and future per-call tuning. Empty or
   *  undefined fields fall back to NanoConfig / hardcoded defaults. */
  overrides?: {
    model?: string;
    reasoningEffort?: string;
    maxOutputTokens?: number;
    temperature?: number;
  };
}

function sortForHash(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sortForHash);
  if (value && typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value as Record<string, unknown>).sort(([a], [b]) =>
      a.localeCompare(b),
    )) {
      out[k] = sortForHash(v);
    }
    return out;
  }
  return value;
}

function hashNano(req: NanoRequest, model: string): string {
  const formatPart = JSON.stringify(sortForHash(req.responseFormat ?? null));
  const biasPart = JSON.stringify(sortForHash(req.logitBias ?? null));
  return createHash("sha256")
    .update(
      `${model}\n--nano--\n${req.instructions}\n--\n${req.input}\n--format--\n${formatPart}\n--bias--\n${biasPart}`,
    )
    .digest("hex");
}

// Decode-time token bans for BAS-NIVEAU anti-hedging constraints.
export const BAS_NIVEAU_LOGIT_BIAS: Record<number, number> = {
  2846: -100,
  3352: -100,
  5355: -100,
  5694: -100,
  5890: -100,
  5985: -100,
  6971: -100,
  8614: -100,
  9630: -100,
  10269: -100,
  11076: -100,
  12190: -100,
  12695: -100,
  13729: -100,
  13955: -100,
  14537: -100,
  14782: -100,
  14882: -100,
  14899: -100,
  16679: -100,
  17927: -100,
  19261: -100,
  19271: -100,
  19827: -100,
  20051: -100,
  20102: -100,
  20402: -100,
  20967: -100,
  22378: -100,
  24560: -100,
  24572: -100,
  26714: -100,
  28034: -100,
  28125: -100,
  30233: -100,
  31074: -100,
  31571: -100,
  33269: -100,
  33936: -100,
  33956: -100,
  36144: -100,
  36336: -100,
  36419: -100,
  41855: -100,
  42235: -100,
  44130: -100,
  44689: -100,
  46975: -100,
  47245: -100,
  48812: -100,
  50500: -100,
  50956: -100,
  51083: -100,
  51777: -100,
  56622: -100,
  58435: -100,
  62309: -100,
  64968: -100,
  65484: -100,
  68753: -100,
  76710: -100,
  76945: -100,
  77091: -100,
  78435: -100,
  89236: -100,
  93476: -100,
  96023: -100,
  96726: -100,
  105622: -100,
  110129: -100,
  110243: -100,
  111766: -100,
  112838: -100,
  114843: -100,
  116014: -100,
  120237: -100,
  123857: -100,
  132620: -100,
  134017: -100,
  140634: -100,
  143793: -100,
  147682: -100,
  148621: -100,
  160401: -100,
  164657: -100,
  166832: -100,
  175054: -100,
  176916: -100,
  178374: -100,
  184812: -100,
  188276: -100,
};

export interface NanoResponse {
  ok: boolean;
  text: string;
  urls: string[];
  latencyMs: number;
  error?: string;
}

/**
 * Call gpt-5.4-nano with optional web search.
 */
export async function callNano(req: NanoRequest): Promise<NanoResponse> {
  const openaiKey = process.env.OPENAI_API_KEY;
  if (!openaiKey) {
    return {
      ok: false,
      text: "",
      urls: [],
      latencyMs: 0,
      error: "OPENAI_API_KEY missing",
    };
  }

  const cfg = await nanoConfigProvider.get();
  const ov = req.overrides ?? {};
  const model = ov.model && ov.model !== "" ? ov.model : cfg.model;
  const effort = ov.reasoningEffort ?? "low";
  const start = Date.now();
  const bodyBase: Record<string, unknown> = {
    model,
    instructions: req.instructions,
    input: req.input,
    reasoning: { effort },
  };
  if (req.responseFormat) bodyBase.text = { format: req.responseFormat };
  if (ov.maxOutputTokens && ov.maxOutputTokens > 0) {
    bodyBase.max_output_tokens = ov.maxOutputTokens;
  }
  if (typeof ov.temperature === "number") {
    bodyBase.temperature = ov.temperature;
  }
  if (req.enableWebSearch !== false) {
    bodyBase.tools = [{ type: "web_search_preview" }];
  }
  try {
    const res = await fetch("https://api.openai.com/v1/responses", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${openaiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(bodyBase),
      signal: AbortSignal.timeout(cfg.callTimeoutMs),
    });

    const latencyMs = Date.now() - start;
    if (!res.ok) {
      const errBody = await res.text().catch(() => "");
      return {
        ok: false,
        text: "",
        urls: [],
        latencyMs,
        error: `HTTP ${res.status}: ${errBody.slice(0, 100)}`,
      };
    }

    const data = (await res.json()) as Record<string, unknown>;
    const text = stripThinkingChannels(extractResponseText(data));
    const urls = extractUrls(text);

    return { ok: true, text, urls, latencyMs };
  } catch (err: unknown) {
    return {
      ok: false,
      text: "",
      urls: [],
      latencyMs: Date.now() - start,
      error: err instanceof Error ? err.message.slice(0, 80) : "Unknown error",
    };
  }
}

/**
 * Mode-aware nano call — honours THALAMUS_MODE=fixtures|record|cloud.
 *
 * fixtures: replays from fixturesDir/<hash>.json; throws on miss unless
 *           FIXTURES_FALLBACK is set (then reads fixturesDir/<fallback>.json).
 * record:   delegates to callNano(), persists the response to disk on hit.
 * cloud:    passthrough to callNano().
 *
 * Hash key includes prompt + guardrails (schema + logit bias) to avoid fixture bleed.
 * Distinct from LlmChatTransport's key so nano + Kimi fixtures don't collide.
 */
export async function callNanoWithMode(req: NanoRequest): Promise<NanoResponse> {
  const mode = (process.env.THALAMUS_MODE ?? "cloud").toLowerCase();
  if (mode === "cloud") return callNano(req);

  const cfg = await nanoConfigProvider.get();
  const hash = hashNano(req, cfg.model);
  const dir = fixturesDir();
  const path = join(dir, `${hash}.json`);

  if (mode === "fixtures") {
    if (existsSync(path)) {
      const f = JSON.parse(readFileSync(path, "utf-8")) as NanoFixtureFile;
      return { ok: true, text: f.text, urls: extractUrls(f.text), latencyMs: 0 };
    }
    const fallback = process.env.FIXTURES_FALLBACK;
    if (fallback) {
      const fb = join(dir, `${fallback}.json`);
      if (existsSync(fb)) {
        const f = JSON.parse(readFileSync(fb, "utf-8")) as Record<string, unknown>;
        // Support both nano-format {text} and chat-format {content} for one file.
        const text = (f.text as string | undefined) ?? (f.content as string | undefined) ?? "";
        logger.debug({ hash, fallback }, "Fallback nano fixture replayed");
        return { ok: true, text, urls: extractUrls(text), latencyMs: 0 };
      }
    }
    throw new Error(
      `Nano fixture missing: ${path}\n` +
        `Re-run with THALAMUS_MODE=record (live API) to record this call.`,
    );
  }

  // record mode
  if (existsSync(path)) {
    const f = JSON.parse(readFileSync(path, "utf-8")) as NanoFixtureFile;
    return { ok: true, text: f.text, urls: extractUrls(f.text), latencyMs: 0 };
  }
  const live = await callNano(req);
  if (live.ok) {
    mkdirSync(dir, { recursive: true });
    const file: NanoFixtureFile = {
      text: live.text,
      model: cfg.model,
      recordedAt: new Date().toISOString(),
    };
    writeFileSync(path, JSON.stringify(file, null, 2), "utf-8");
    logger.info({ hash, path }, "Nano fixture recorded");
  }
  return live;
}

/**
 * Execute calls in waves (5 parallel, 2s delay) to respect rate limits.
 */
export async function callNanoWaves<T>(
  items: T[],
  buildRequest: (item: T) => NanoRequest,
  waveSize = 5,
  delayMs = 2_000,
): Promise<Array<NanoResponse & { index: number }>> {
  const results: Array<NanoResponse & { index: number }> = [];
  const totalWaves = Math.ceil(items.length / waveSize);

  for (let w = 0; w < items.length; w += waveSize) {
    const wave = items.slice(w, w + waveSize);
    const waveNum = Math.floor(w / waveSize) + 1;

    logger.info(
      { wave: waveNum, total: totalWaves, size: wave.length },
      "Nano wave starting",
    );

    const waveResults = await Promise.all(
      wave.map(async (item, i) => {
        const res = await callNano(buildRequest(item));
        return { ...res, index: w + i };
      }),
    );

    results.push(...waveResults);

    const ok = waveResults.filter((r) => r.ok).length;
    logger.info(
      { wave: waveNum, ok, failed: wave.length - ok },
      "Nano wave complete",
    );

    if (w + waveSize < items.length) {
      await new Promise((r) => setTimeout(r, delayMs));
    }
  }

  return results;
}

// ─── Streaming ──────────────────────────────────────────────────────

export interface NanoStreamRequest {
  instructions: string;
  input: string;
  enableWebSearch?: boolean;
  enableCodeInterpreter?: boolean;
}

export interface NanoStreamEvent {
  type: "delta" | "done";
  text: string;
}

/**
 * Streaming variant of callNano — yields text deltas as they arrive.
 * Uses OpenAI Responses API with stream: true.
 */
export async function* callNanoStream(
  req: NanoStreamRequest,
): AsyncGenerator<NanoStreamEvent> {
  const openaiKey = process.env.OPENAI_API_KEY;
  if (!openaiKey) throw new Error("OPENAI_API_KEY not set");

  const cfg = await nanoConfigProvider.get();
  const tools: Array<Record<string, unknown>> = [];
  if (req.enableWebSearch !== false) tools.push({ type: "web_search_preview" });
  if (req.enableCodeInterpreter)
    tools.push({ type: "code_interpreter", container: { type: "auto" } });

  const res = await fetch("https://api.openai.com/v1/responses", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${openaiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: cfg.model,
      instructions: req.instructions,
      input: req.input,
      reasoning: { effort: "low" },
      tools: tools.length > 0 ? tools : undefined,
      stream: true,
    }),
    signal: AbortSignal.timeout(120_000),
  });

  if (!res.ok) {
    const errText = await res.text();
    throw new Error(`Nano stream error ${res.status}: ${errText}`);
  }

  const reader = res.body?.getReader();
  if (!reader) throw new Error("No response body reader");

  const decoder = new TextDecoder();
  let buffer = "";

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split("\n");
      buffer = lines.pop() ?? "";

      for (const line of lines) {
        if (!line.startsWith("data: ")) continue;
        const data = line.slice(6);
        if (data === "[DONE]") return;

        try {
          const parsed = JSON.parse(data);
          if (parsed.type === "response.output_text.delta" && parsed.delta) {
            yield { type: "delta", text: parsed.delta };
          }
        } catch {
          // skip unparseable SSE frames
        }
      }
    }
  } finally {
    reader.releaseLock();
  }

  yield { type: "done", text: "" };
}

// ─── Response parsing ────────────────────────────────────────────────

function extractResponseText(data: Record<string, unknown>): string {
  const output = data.output as Array<Record<string, unknown>> | undefined;
  if (!output) return "";
  return output
    .filter((o) => o.type === "message")
    .flatMap((o) => (o.content as Array<Record<string, unknown>>) ?? [])
    .filter((c) => c.type === "output_text")
    .map((c) => (c.text as string) ?? "")
    .join("\n");
}

export function extractUrls(text: string): string[] {
  const matches = text.match(/https?:\/\/[^\s)"'\]>]+/g) ?? [];
  return [
    ...new Set(
      matches
        .map((u) => u.replace(/[`*_~]+$/g, "").replace(/[.,;:!?)]+$/g, ""))
        .map((u) => u.replace(/[?&]utm_source=[^&]+/g, ""))
        .map((u) => u.replace(/\/+$/, "")),
    ),
  ].filter((u) => u.length > 15 && !u.includes("google.com/search"));
}
