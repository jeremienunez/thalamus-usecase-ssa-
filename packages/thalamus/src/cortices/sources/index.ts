export { registerSource, fetchSourcesForCortex } from "./registry";
export type { SourceResult, SourceFetcher, SourceKind } from "./types";
export { fetchRssSource } from "./fetcher-rss";
export { fetchArxivSource } from "./fetcher-arxiv";
export { fetchNtrsSource } from "./fetcher-ntrs";

// Import fetchers to trigger self-registration
import "./fetcher-space-weather";
import "./fetcher-orbit-regime";
import "./fetcher-spectra";
import "./fetcher-bus-archetype";
import "./fetcher-launch-market";
import "./fetcher-regulation";
import "./fetcher-celestrak";
import "./fetcher-knowledge-graph";
