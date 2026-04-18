/**
 * Runtime-tunable configuration shared across packages.
 *
 * Each domain exposes a narrow config interface. Defaults are the values
 * that used to live as hardcoded constants — callers that don't wire a
 * provider get the same behaviour as before the refactor.
 *
 * Storage + HTTP exposure live in apps/console-api. The kernel-side code
 * consumes these values through `ConfigProvider<T>` (provider.ts).
 */

// ─── thalamus.nano — OpenAI Responses call ───────────────────────────
export interface NanoConfig {
  model: string;
  callTimeoutMs: number;
}

export const DEFAULT_NANO_CONFIG: NanoConfig = {
  model: "gpt-5.4-nano",
  callTimeoutMs: 45_000,
};

// ─── thalamus.nanoSwarm — explorer wave executor ─────────────────────
export interface NanoSwarmConfig {
  waveSize: number;
  waveDelayMs: number;
  maxMicroQueries: number;
}

export const DEFAULT_NANO_SWARM_CONFIG: NanoSwarmConfig = {
  waveSize: 5,
  waveDelayMs: 2_000,
  maxMicroQueries: 50,
};

// ─── sweep.nanoSweep — SSA audit nano batching ───────────────────────
export interface NanoSweepConfig {
  /** Operator-countries per nano call. */
  batchSize: number;
  /** Upper bound on satellite ids bundled in a single null-scan suggestion. */
  nullScanMaxIdsPerSuggestion: number;
}

export const DEFAULT_NANO_SWEEP_CONFIG: NanoSweepConfig = {
  batchSize: 10,
  nullScanMaxIdsPerSuggestion: 200,
};

// ─── Registry of all runtime config domains ──────────────────────────
export type RuntimeConfigDomain =
  | "thalamus.nano"
  | "thalamus.nanoSwarm"
  | "sweep.nanoSweep";

export interface RuntimeConfigMap {
  "thalamus.nano": NanoConfig;
  "thalamus.nanoSwarm": NanoSwarmConfig;
  "sweep.nanoSweep": NanoSweepConfig;
}

export const RUNTIME_CONFIG_DEFAULTS: {
  [D in RuntimeConfigDomain]: RuntimeConfigMap[D];
} = {
  "thalamus.nano": DEFAULT_NANO_CONFIG,
  "thalamus.nanoSwarm": DEFAULT_NANO_SWARM_CONFIG,
  "sweep.nanoSweep": DEFAULT_NANO_SWEEP_CONFIG,
};

export const RUNTIME_CONFIG_DOMAINS: RuntimeConfigDomain[] = [
  "thalamus.nano",
  "thalamus.nanoSwarm",
  "sweep.nanoSweep",
];
