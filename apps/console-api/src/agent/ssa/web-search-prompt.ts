/**
 * SSA web-search prompt templates.
 *
 * Consumed by the kernel via DomainConfig.webSearchPrompt. The kernel
 * passes (query, cortexName) and receives the formatted prompt body.
 */

type Prompt = { searchQuery: string; instruction: string };

const CORTEX_SEARCH_PROMPTS: Record<string, (q: string) => Prompt> = {
  payload_profiler: (q) => ({
    searchQuery: `payload instrument spectrometer radar bus ${q}`.slice(0, 200),
    instruction: `Search for technical data about the payload / instrument referenced in: ${q}. Look for manufacturer specs, instrument class (radar, EO, comms, SIGINT), mission heritage and bus integration. Cite sources.`,
  }),
  regime_profiler: (q) => ({
    searchQuery: `orbit regime altitude inclination LEO MEO GEO ${q}`.slice(
      0,
      200,
    ),
    instruction: `Search for orbit-regime context relevant to: ${q}. Focus on altitude bands, inclination, station-keeping duty cycle, congestion and debris profile. Cite sources.`,
  }),
  launch_scout: (q) => ({
    searchQuery: `launch manifest rideshare fairing slot pricing ${q}`.slice(
      0,
      200,
    ),
    instruction: `Search for upcoming launches, manifests, rideshare availability and slot economics relevant to: ${q}. Include LSP, vehicle, trajectory, and price per kg where available.`,
  }),
};

export function ssaWebSearchPrompt(query: string, cortexName: string): Prompt {
  const template = CORTEX_SEARCH_PROMPTS[cortexName];
  if (template) return template(query);

  const label = cortexName.replace(/_/g, " ");
  return {
    searchQuery: `space situational awareness ${label} ${query}`.slice(0, 200),
    instruction: `Search for authoritative SSA / space-traffic data relevant to: ${label} ${query}. Prioritise CelesTrak, Space-Track, ESA, NASA CNEOS, operator advisories and peer-reviewed sources. Return key facts, numbers, epochs and provenance.`,
  };
}
