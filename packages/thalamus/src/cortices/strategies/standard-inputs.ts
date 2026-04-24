import type { CortexSkill } from "../registry";
import type { CortexDataProvider } from "../types";
import type { SourceFetcherPort } from "../../ports/source-fetcher.port";
import { isAbortError, throwIfAborted } from "../../transports/abort";

type StrategyLogger = {
  debug: (obj: unknown, msg?: string) => void;
  error: (obj: unknown, msg?: string) => void;
  info: (obj: unknown, msg?: string) => void;
};

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
}): Promise<unknown[]> {
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
    if (Array.isArray(result)) return result;
    return result == null ? [] : [result as unknown];
  } catch (err) {
    if (isAbortError(err)) throw err;
    logger.error(
      { cortex: skill.header.name, sqlHelper: helperName, err },
      "Data provider call failed",
    );
    return [];
  }
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
