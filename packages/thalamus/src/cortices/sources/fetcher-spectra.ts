import { createLogger } from "@interview/shared/observability";
import type { SourceResult } from "./types";
import { registerSource } from "./registry";

const logger = createLogger("source-spectra");
const TIMEOUT_MS = 12_000;

/**
 * RF / optical spectra and payload signature fetcher.
 *
 * - ITU SRS (Space Radiocommunication Stations) — assigned RF bands
 *   per satellite / payload.
 * - NASA SSC imaging spectra reference — optical band responses.
 */

async function fetchITUSRS(payloadName: string): Promise<SourceResult | null> {
  const apiKey = process.env.ITU_SRS_API_KEY ?? "DEMO_KEY";
  const query = encodeURIComponent(`${payloadName} payload`);
  const url = `https://www.itu.int/ITU-R/space/snl/api/v1/search?api_key=${apiKey}&query=${query}&kind=assignment&pageSize=3`;
  const start = Date.now();
  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(TIMEOUT_MS) });
    if (!res.ok) return null;
    const data = (await res.json()) as {
      assignments: Array<{
        assignmentId: number;
        description: string;
        frequencyBands: Array<{
          bandName: string;
          centerMhz: number;
          bandwidthMhz: string;
        }>;
      }>;
    };
    if (!data.assignments?.length) return null;
    const assignment = data.assignments[0];
    const bands = assignment.frequencyBands
      .filter((b) => b.centerMhz > 0)
      .slice(0, 20)
      .map((b) => ({
        name: b.bandName,
        centerMhz: b.centerMhz,
        bandwidthMhz: b.bandwidthMhz,
      }));
    return {
      type: "itu_srs_assignment",
      source: `ITU SRS — Assignment ID ${assignment.assignmentId}`,
      url: `https://www.itu.int/ITU-R/space/snl/assignment/${assignment.assignmentId}`,
      data: {
        description: assignment.description,
        assignmentId: assignment.assignmentId,
        bands,
      },
      fetchedAt: new Date().toISOString(),
      latencyMs: Date.now() - start,
    };
  } catch {
    return null;
  }
}

async function fetchOpticalSpectrum(
  bandName: string,
): Promise<SourceResult | null> {
  const url = `https://ssd-api.jpl.nasa.gov/spectra.api?band=${encodeURIComponent(bandName)}&format=json`;
  const start = Date.now();
  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(TIMEOUT_MS) });
    if (!res.ok) return null;
    const data = (await res.json()) as {
      spectrum: Array<Record<string, unknown>>;
    };
    const props = data.spectrum?.[0];
    if (!props) return null;
    return {
      type: "optical_spectrum",
      source: `NASA SSD — band ${bandName}`,
      url,
      data: props,
      fetchedAt: new Date().toISOString(),
      latencyMs: Date.now() - start,
    };
  } catch {
    return null;
  }
}

async function fetchSpectraData(
  params: Record<string, unknown>,
): Promise<SourceResult[]> {
  const payloadName =
    (params.payloadName as string) ??
    (params.payloadKind as string) ??
    (params.payload_name as string) ??
    "";
  if (!payloadName) return [];

  const [itu, visible, nearIR] = await Promise.all([
    fetchITUSRS(payloadName),
    fetchOpticalSpectrum("visible"),
    fetchOpticalSpectrum("near-infrared"),
  ]);

  return [itu, visible, nearIR].filter((r): r is SourceResult => r !== null);
}

registerSource(
  ["payload_profiler", "spectrum_manager"],
  fetchSpectraData,
  "spectra",
);
