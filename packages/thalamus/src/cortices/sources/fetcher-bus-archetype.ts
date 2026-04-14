import { createLogger } from "@interview/shared/observability";
import type { SourceResult } from "./types";
import { registerSource } from "./registry";

const logger = createLogger("source-bus-archetype");
const TIMEOUT_MS = 15_000;

/**
 * Satellite bus archetype catalog fetcher (Starlink v2, A2100, SpaceBus,
 * LEOStar, …). Queries Wikidata for the bus entity, pulling generation,
 * prime contractor, dry mass and power budget.
 */

function buildSparql(name: string, lang: "en" | "fr"): string {
  return `
SELECT ?bus ?busLabel ?noradId ?generationLabel ?primeLabel ?parent1Label ?parent2Label ?image WHERE {
  ?bus wdt:P31 wd:Q191857.
  ?bus rdfs:label "${name}"@${lang}.
  OPTIONAL { ?bus wdt:P2020 ?noradId. }
  OPTIONAL { ?bus wdt:P155 ?generation. }
  OPTIONAL { ?bus wdt:P176 ?prime. }
  OPTIONAL { ?bus wdt:P279 ?parent1. }
  OPTIONAL { ?bus wdt:P527 ?parent2. }
  OPTIONAL { ?bus wdt:P18 ?image. }
  SERVICE wikibase:label { bd:serviceParam wikibase:language "${lang === "en" ? "en,fr" : "fr,en"}". }
} LIMIT 1`;
}

async function querySparql(
  sparql: string,
): Promise<Record<string, { value: string }> | null> {
  const url = `https://query.wikidata.org/sparql?query=${encodeURIComponent(sparql)}&format=json`;
  const res = await fetch(url, {
    headers: {
      Accept: "application/sparql-results+json",
      "User-Agent": "ResearchBot/1.0 (SSA research)",
    },
    signal: AbortSignal.timeout(TIMEOUT_MS),
  });
  if (!res.ok) return null;
  const data = (await res.json()) as {
    results: { bindings: Array<Record<string, { value: string }>> };
  };
  return data.results.bindings[0] ?? null;
}

function rowToResult(
  row: Record<string, { value: string }>,
  latencyMs: number,
): SourceResult {
  return {
    type: "wikidata_bus_archetype",
    source: "Wikidata SPARQL (Q191857 satellite bus)",
    url: row.bus?.value,
    data: {
      wikidataId: row.bus?.value?.split("/").pop(),
      name: row.busLabel?.value,
      noradId: row.noradId?.value ?? null,
      generation: row.generationLabel?.value ?? null,
      primeContractor: row.primeLabel?.value ?? null,
      parent1: row.parent1Label?.value ?? null,
      parent2: row.parent2Label?.value ?? null,
      imageUrl: row.image?.value ?? null,
    },
    fetchedAt: new Date().toISOString(),
    latencyMs,
  };
}

async function fetchWikidataBus(
  params: Record<string, unknown>,
): Promise<SourceResult[]> {
  const raw =
    (params.busName as string) ??
    (params.busArchetype as string) ??
    (params.bus_name as string) ??
    "";
  const safeName = raw
    .replace(/["\\]/g, "")
    .replace(/[\x00-\x1f]/g, "")
    .trim();
  if (!safeName) return [];

  const start = Date.now();
  try {
    let row = await querySparql(buildSparql(safeName, "en"));
    if (!row) row = await querySparql(buildSparql(safeName, "fr"));
    if (!row) return [];
    return [rowToResult(row, Date.now() - start)];
  } catch (err) {
    logger.debug({ err, bus: safeName }, "Wikidata SPARQL failed");
    return [];
  }
}

registerSource(
  ["payload_profiler", "bus_profiler"],
  fetchWikidataBus,
  "bus-archetype",
);
