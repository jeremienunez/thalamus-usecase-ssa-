import { createLogger } from "@interview/shared/observability";
import type { SourceResult } from "./types";
import { registerSource } from "./registry";

const logger = createLogger("source-launch-market");
const TIMEOUT_MS = 12_000;

/**
 * Launch market fetcher — manifests, rideshare prices, slot availability
 * for upcoming launches. Notional GlobalLaunchScore-style API kept
 * shape-stable for the launch-cost / deal-scanner cortices.
 */

async function fetchGlobalLaunchScore(
  params: Record<string, unknown>,
): Promise<SourceResult[]> {
  const token = process.env.GLOBAL_LAUNCH_SCORE_TOKEN;
  if (!token) return [];

  const satellite =
    (params.satelliteName as string) ??
    (params.operatorCountry as string) ??
    (params.operatorCountryName as string) ??
    "";
  const launchYear = params.launchYear as number | undefined;
  if (!satellite) return [];

  const queryParams = new URLSearchParams({ satellite });
  if (launchYear) queryParams.set("launch_year", String(launchYear));

  const url = `https://api.globallaunchscore.com/launchscores/latest/?${queryParams}`;
  const start = Date.now();
  try {
    const res = await fetch(url, {
      headers: {
        Authorization: `Token ${token}`,
        Accept: "application/json",
      },
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    if (!res.ok) return [];
    const data = (await res.json()) as {
      results: Array<{
        satellite: string;
        satellite_slug: string;
        operator_country: string;
        launch_year: string;
        score: number;
        confidence_index: string;
      }>;
    };
    if (!data.results?.length) return [];

    return data.results.slice(0, 5).map((r) => ({
      type: "global_launch_score",
      source: `GlobalLaunchScore API — ${r.satellite} ${r.launch_year}`,
      url: `https://www.globallaunchscore.com/launch-score/${r.satellite_slug}/${r.launch_year}/`,
      data: {
        satellite: r.satellite,
        operatorCountry: r.operator_country,
        launchYear: r.launch_year,
        score: r.score,
        confidence: r.confidence_index,
      },
      fetchedAt: new Date().toISOString(),
      latencyMs: Date.now() - start,
    }));
  } catch {
    return [];
  }
}

registerSource(
  [
    "value_detective",
    "deal_scanner",
    "critic_radar",
    "trend_spotter",
    "manifest_scout",
  ],
  fetchGlobalLaunchScore,
  "launch-market",
);
