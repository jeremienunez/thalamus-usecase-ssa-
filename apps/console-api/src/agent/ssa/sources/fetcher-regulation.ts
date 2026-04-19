import { createLogger } from "@interview/shared/observability";
import type { SourceResult } from "./types";
import { registerSource } from "./registry";

const logger = createLogger("source-regulation");
const TIMEOUT_MS = 12_000;

/**
 * Regulation fetcher — ITU filings (frequency assignments / orbital
 * slots), FAA AST launch permits, ECC registrations. Used by the
 * orbit-regime profiler and the data / classification auditors.
 */

async function fetchITUFilings(
  params: Record<string, unknown>,
): Promise<SourceResult[]> {
  const operatorCountry =
    (params.operatorCountry as string) ??
    (params.operatorCountryName as string) ??
    "";
  if (!operatorCountry) return [];

  const query = encodeURIComponent(operatorCountry);
  const url = `https://www.itu.int/ITU-R/space/snl/api/v1/filings?where=search(notifying_administration,"${query}")&limit=5`;
  const start = Date.now();
  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(TIMEOUT_MS) });
    if (!res.ok) return [];
    const data = (await res.json()) as {
      results: Array<Record<string, unknown>>;
    };
    if (!data.results?.length) return [];

    return [
      {
        type: "itu_filing",
        source: "ITU SNS — Notification of Space Stations",
        url: "https://www.itu.int/ITU-R/space/snl/",
        data: data.results.slice(0, 3),
        fetchedAt: new Date().toISOString(),
        latencyMs: Date.now() - start,
      },
    ];
  } catch {
    return [];
  }
}

async function fetchFaaLaunchPermits(): Promise<SourceResult[]> {
  const url = "https://www.faa.gov/data_research/commercial_space_data/launches";
  const start = Date.now();
  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(TIMEOUT_MS) });
    if (!res.ok) return [];
    const data = await res.json();
    return [
      {
        type: "faa_launch_permits",
        source: "FAA AST — Commercial Space Launch Permits",
        url,
        data: { permits: (data as unknown[]).slice(0, 10) },
        fetchedAt: new Date().toISOString(),
        latencyMs: Date.now() - start,
      },
    ];
  } catch {
    return [];
  }
}

async function fetchEccRegistrations(): Promise<SourceResult[]> {
  const url = "https://efis.cept.org/api/eccdec/space";
  const start = Date.now();
  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(TIMEOUT_MS) });
    if (!res.ok) return [];
    const data = await res.json();
    return [
      {
        type: "ecc_registration",
        source: "CEPT ECC — Space Service Decisions",
        url,
        data: { decisions: (data as unknown[]).slice(0, 10) },
        fetchedAt: new Date().toISOString(),
        latencyMs: Date.now() - start,
      },
    ];
  } catch {
    return [];
  }
}

async function fetchRegulationData(
  params: Record<string, unknown>,
): Promise<SourceResult[]> {
  const [itu, faa, ecc] = await Promise.all([
    fetchITUFilings(params),
    fetchFaaLaunchPermits(),
    fetchEccRegistrations(),
  ]);
  return [...itu, ...faa, ...ecc];
}

registerSource(
  [
    "orbit_regime_profiler",
    "value_detective",
    "data_auditor",
    "classification_auditor",
  ],
  fetchRegulationData,
  "regulation",
);
