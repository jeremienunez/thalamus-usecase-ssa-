/**
 * Shared nano HTTP caller — used by both nano-swarm (explorer) and nano-sweep (audit).
 * Single responsibility: call gpt-5.4-nano via OpenAI Responses API.
 */

import { createHash } from "node:crypto";
import { mkdirSync, readFileSync, writeFileSync, existsSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { createLogger } from "@interview/shared/observability";

const logger = createLogger("nano-caller");

export const NANO_MODEL = "gpt-5.4-nano";
const CALL_TIMEOUT_MS = 45_000;

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

function hashNano(instructions: string, input: string, model: string): string {
  return createHash("sha256")
    .update(`${model}\n--nano--\n${instructions}\n--\n${input}`)
    .digest("hex");
}

export interface NanoRequest {
  instructions: string;
  input: string;
  enableWebSearch?: boolean;
}

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

  const start = Date.now();
  try {
    const res = await fetch("https://api.openai.com/v1/responses", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${openaiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: NANO_MODEL,
        instructions: req.instructions,
        input: req.input,
        reasoning: { effort: "low" },
        ...(req.enableWebSearch !== false
          ? { tools: [{ type: "web_search_preview" }] }
          : {}),
      }),
      signal: AbortSignal.timeout(CALL_TIMEOUT_MS),
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
    const text = extractResponseText(data);
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
 * Hash key: sha256(model + "\n--nano--\n" + instructions + "\n--\n" + input).
 * Distinct from LlmChatTransport's key so nano + Kimi fixtures don't collide.
 */
export async function callNanoWithMode(req: NanoRequest): Promise<NanoResponse> {
  const mode = (process.env.THALAMUS_MODE ?? "cloud").toLowerCase();
  if (mode === "cloud") return callNano(req);

  const hash = hashNano(req.instructions, req.input, NANO_MODEL);
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
      model: NANO_MODEL,
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
      model: NANO_MODEL,
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
