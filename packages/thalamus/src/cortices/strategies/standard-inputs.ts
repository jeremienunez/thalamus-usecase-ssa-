import type { CortexSkill } from "../registry";
import type { CortexDataProvider } from "../types";
import type { SourceFetcherPort } from "../../ports/source-fetcher.port";
import { isAbortError, throwIfAborted } from "../../transports/abort";

type StrategyLogger = {
  debug: (obj: unknown, msg?: string) => void;
  error: (obj: unknown, msg?: string) => void;
  info: (obj: unknown, msg?: string) => void;
};

const MAX_PROVIDER_NORMALIZE_DEPTH = 8;

export async function runCortexSqlHelper({
  skill,
  params,
  dataProvider,
  signal,
  logger,
}: {
  skill: CortexSkill;
  params: Record<string, unknown>;
  dataProvider: CortexDataProvider;
  signal?: AbortSignal;
  logger: StrategyLogger;
}): Promise<Record<string, unknown>[]> {
  const helperName = skill.header.sqlHelper;
  const helperFn = dataProvider[helperName];

  if (!helperFn) {
    logger.debug(
      { cortex: skill.header.name, sqlHelper: helperName },
      "No data provider mapped, cortex will use raw params as data",
    );
    return [];
  }

  // Planner LLMs sometimes emit param keys with leading/trailing whitespace
  // (e.g. ` rideshare_flag`) which makes the helper silently miss the value.
  const cleanParams: Record<string, unknown> = {};
  const declared = new Set(Object.keys(skill.header.params));
  const unknown: string[] = [];
  for (const [rawKey, value] of Object.entries(params)) {
    const key = rawKey.trim();
    if (!key) continue;
    cleanParams[key] = value;
    if (declared.size > 0 && !declared.has(key)) unknown.push(key);
  }
  if (unknown.length > 0) {
    logger.debug(
      {
        cortex: skill.header.name,
        sqlHelper: helperName,
        declared: [...declared],
        unknown,
      },
      "Planner params diverge from skill frontmatter",
    );
  }

  try {
    throwIfAborted(signal);
    logger.debug(
      {
        cortex: skill.header.name,
        sqlHelper: helperName,
        params: cleanParams,
      },
      "Calling data provider",
    );
    const result = signal
      ? await helperFn(cleanParams, { signal })
      : await helperFn(cleanParams);
    return normalizeProviderRows(result);
  } catch (err) {
    if (isAbortError(err)) throw err;
    logger.error(
      { cortex: skill.header.name, sqlHelper: helperName, err },
      "Data provider call failed",
    );
    return [];
  }
}

export function normalizeProviderRows(input: unknown): Record<string, unknown>[] {
  const rows = Array.isArray(input) ? input : input == null ? [] : [input];
  return rows.map((row) => normalizeProviderRow(row));
}

function normalizeProviderRow(row: unknown): Record<string, unknown> {
  const normalized = normalizeProviderValue(row, new WeakSet(), 0);
  if (isRecord(normalized) && !Array.isArray(normalized)) return normalized;
  return { value: normalized ?? null };
}

function normalizeProviderValue(
  value: unknown,
  seen: WeakSet<object>,
  depth: number,
): unknown {
  if (value == null) return value;
  if (typeof value === "string" || typeof value === "boolean") return value;
  if (typeof value === "number") return Number.isFinite(value) ? value : null;
  if (typeof value === "bigint") return value.toString();
  if (typeof value === "function" || typeof value === "symbol") {
    return undefined;
  }
  if (value instanceof Date) {
    return Number.isNaN(value.getTime()) ? null : value.toISOString();
  }
  if (value instanceof ArrayBuffer) {
    return { type: "binary", bytes: value.byteLength };
  }
  if (ArrayBuffer.isView(value)) {
    return { type: "binary", bytes: value.byteLength };
  }
  if (typeof value !== "object") return value;
  if (seen.has(value)) return "[Circular]";
  if (depth >= MAX_PROVIDER_NORMALIZE_DEPTH) return "[MaxDepth]";

  seen.add(value);
  if (Array.isArray(value)) {
    return value
      .map((item) => normalizeProviderValue(item, seen, depth + 1))
      .filter((item) => item !== undefined);
  }
  if (value instanceof Map) {
    const out: Record<string, unknown> = {};
    for (const [key, item] of value.entries()) {
      const normalized = normalizeProviderValue(item, seen, depth + 1);
      if (normalized !== undefined) out[String(key)] = normalized;
    }
    return out;
  }
  if (value instanceof Set) {
    return [...value]
      .map((item) => normalizeProviderValue(item, seen, depth + 1))
      .filter((item) => item !== undefined);
  }

  const out: Record<string, unknown> = {};
  for (const [key, item] of Object.entries(value)) {
    const normalized = normalizeProviderValue(item, seen, depth + 1);
    if (normalized !== undefined) out[key] = normalized;
  }
  return out;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

export async function fetchStructuredSources({
  sourceFetcher,
  cortexName,
  params,
  signal,
  logger,
}: {
  sourceFetcher: SourceFetcherPort;
  cortexName: string;
  params: Record<string, unknown>;
  signal?: AbortSignal;
  logger: StrategyLogger;
}): Promise<Record<string, unknown>[]> {
  try {
    throwIfAborted(signal);
    const sources = signal
      ? await sourceFetcher.fetchForCortex(cortexName, params, { signal })
      : await sourceFetcher.fetchForCortex(cortexName, params);
    if (sources.length > 0) {
      logger.info(
        {
          cortex: cortexName,
          sources: sources.length,
          types: sources.map((s) => s.type),
        },
        "External sources enriched data",
      );
    }

    return sources.map((s) => ({
      type: s.type,
      _source: s.source,
      _sourceUrl: s.url,
      ...(typeof s.data === "object" && s.data !== null
        ? (s.data as Record<string, unknown>)
        : { value: s.data }),
    }));
  } catch (err) {
    if (isAbortError(err)) throw err;
    logger.debug(
      { cortex: cortexName, err },
      "External source fetch failed (non-blocking)",
    );
    return [];
  }
}
