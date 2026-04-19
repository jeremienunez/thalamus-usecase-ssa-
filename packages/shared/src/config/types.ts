/**
 * Runtime-tunable configuration shared across packages.
 *
 * Each domain exposes a narrow config interface. Defaults are the values
 * that used to live as hardcoded constants — callers that don't wire a
 * provider get the same behaviour as before the refactor.
 *
 * Storage + HTTP exposure live in apps/console-api. Kernel-side code
 * consumes these values through `ConfigProvider<T>` (provider.ts).
 *
 * New domains register themselves at boot via `RuntimeConfigRegistrar`
 * (see console-api RuntimeConfigService). The service has no hardcoded
 * schema table — it stays closed to modification when packages add
 * domains (OCP).
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

// ─── thalamus.planner — DAG planner / cortex dispatcher ──────────────
export interface ThalamusPlannerConfig {
  /** Maximum cortices per plan (mirrors prompt rubric; hard cap enforced
   *  by post-filter in thalamus-planner.service.ts). */
  maxCortices: number;
  /** If true, `strategist` is injected as a dependsOn terminal node even
   *  when the LLM planner omitted it. */
  mandatoryStrategist: boolean;
  /** Preferred LLM provider. The transport still falls back through the
   *  chain if the preferred provider is unavailable. */
  provider: string;
  /** Model id within the selected provider (informational; planner log). */
  model: string;
  callTimeoutMs: number;
  /** Hard USD cap per research cycle. Lower than complexity defaults wins. */
  maxCostUsd: number;
  /** GPT-5.4 Responses API `reasoning.effort`. Valid values
   *  `none|low|medium|high|xhigh`. Other providers ignore it. */
  reasoningEffort: string;
  /** Cap on generated tokens per LLM call. 0 = provider default. Maps to
   *  `max_output_tokens` (OpenAI Responses) / `max_completion_tokens`
   *  (Kimi, MiniMax) / `max_tokens` (llama.cpp). */
  maxOutputTokens: number;
  /** Sampling temperature. Ignored by thinking models that force 1.0. */
  temperature: number;
  /** GPT-5 `text.verbosity` — `low|medium|high`. Ignored elsewhere. */
  verbosity: string;
  /** Kimi K2.5 / K2-thinking / Gemma 4 — turn thinking on. Mapped by the
   *  provider to its native shape (Kimi: `thinking: {type:"enabled"}`;
   *  Gemma 4 via llama.cpp: `chat_template_kwargs.enable_thinking`). */
  thinking: boolean;
  /** llama.cpp `reasoning_format` — `none|deepseek|deepseek-legacy`.
   *  Routes `<think>`-style blocks back into a separate channel. Local
   *  provider only. */
  reasoningFormat: string;
  /** MiniMax OpenAI-compat `reasoning_split` — separate reasoning tokens
   *  into `reasoning_details` instead of inline `<think>`. MiniMax only. */
  reasoningSplit: boolean;
  /** Cortex names injected into every plan regardless of LLM output. */
  forcedCortices: string[];
  /** Cortex names stripped from every plan regardless of LLM output. */
  disabledCortices: string[];
}

export const DEFAULT_THALAMUS_PLANNER_CONFIG: ThalamusPlannerConfig = {
  maxCortices: 5,
  mandatoryStrategist: true,
  provider: "kimi",
  model: "kimi-k2",
  callTimeoutMs: 45_000,
  maxCostUsd: 0.5,
  reasoningEffort: "medium",
  maxOutputTokens: 0,
  temperature: 1.0,
  verbosity: "medium",
  thinking: false,
  reasoningFormat: "none",
  reasoningSplit: false,
  forcedCortices: [],
  disabledCortices: [],
};

// GPT-5.4 Responses API `reasoning.effort` valid enum
// (per platform.openai.com docs — `minimal` is gpt-5-only, not gpt-5.4).
export const REASONING_EFFORT_CHOICES: readonly string[] = [
  "none",
  "low",
  "medium",
  "high",
  "xhigh",
];

export const VERBOSITY_CHOICES: readonly string[] = [
  "low",
  "medium",
  "high",
];

// llama.cpp server `reasoning_format` valid enum. Controls how the server
// parses model output (DeepSeek-R1 / Gemma 4 style <|think|> blocks).
export const REASONING_FORMAT_CHOICES: readonly string[] = [
  "none",
  "deepseek",
  "deepseek-legacy",
];

// ─── thalamus.cortex — per-cortex overrides by name ──────────────────
export interface CortexOverride {
  /** Kill switch — when false, dispatch is skipped. */
  enabled?: boolean;
  costCeilingUsd?: number;
  callTimeoutMs?: number;
  // LLM routing — mirror of ThalamusPlannerConfig shape.
  provider?: string;
  model?: string;
  reasoningEffort?: string;
  verbosity?: string;
  thinking?: boolean;
  reasoningFormat?: string;
  reasoningSplit?: boolean;
  maxOutputTokens?: number;
  temperature?: number;
}

export interface ThalamusCortexConfig {
  /** Overrides keyed by cortex name. Fields omitted fall back to planner
   *  defaults. UI exposes this as a JSON textarea for flexibility. */
  overrides: Record<string, CortexOverride>;
}

export const DEFAULT_THALAMUS_CORTEX_CONFIG: ThalamusCortexConfig = {
  overrides: {},
};

// ─── thalamus.reflexion — cycle reflexion / replan loop ──────────────
export interface ThalamusReflexionConfig {
  maxIterations: number;
  /** Minimum confidence on the previous pass to skip replan. */
  minConfidenceToStop: number;
  /** If true, replan only when new gaps are listed; otherwise stop. */
  stopOnNoNewFindings: boolean;
}

export const DEFAULT_THALAMUS_REFLEXION_CONFIG: ThalamusReflexionConfig = {
  maxIterations: 2,
  minConfidenceToStop: 0.7,
  stopOnNoNewFindings: true,
};

// ─── sim.swarm — default swarm knobs for new sim runs ────────────────
export interface SimSwarmConfig {
  /** Default fish (agent-turn) concurrency used when an orchestrator
   *  doesn't pin its own. Clamped at the schema level [1..50]. */
  defaultFishConcurrency: number;
  /** Default quorum fraction [0..1] required before aggregate fires. */
  defaultQuorumPct: number;
}

export const DEFAULT_SIM_SWARM_CONFIG: SimSwarmConfig = {
  defaultFishConcurrency: 8,
  defaultQuorumPct: 0.8,
};

// ─── sim.fish — LLM knobs for fish (agent-turn) calls ─────────────────
export interface SimFishConfig {
  /** Model id for fish turns. Empty = use thalamus.nano default. */
  model: string;
  /** Reasoning effort (GPT-5 series). Fish use it to think harder when
   *  the simulation calls for deeper deliberation. */
  reasoningEffort: string;
  /** Cap on generated tokens per fish turn. 0 = provider default. */
  maxOutputTokens: number;
  temperature: number;
  /** Enable thinking mode (Kimi K2.5 / Gemma 4 locally). */
  thinking: boolean;
}

export const DEFAULT_SIM_FISH_CONFIG: SimFishConfig = {
  model: "",
  reasoningEffort: "low",
  maxOutputTokens: 0,
  temperature: 0.7,
  thinking: false,
};

// ─── sim.embedding — vectorisation throughput ────────────────────────
export interface SimEmbeddingConfig {
  /** Max concurrent Voyage embedding calls inside memory.service and
   *  aggregator.service. Used to replace the hardcoded EMBED_CONCURRENCY. */
  embedConcurrency: number;
}

export const DEFAULT_SIM_EMBEDDING_CONFIG: SimEmbeddingConfig = {
  embedConcurrency: 8,
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
  | "thalamus.planner"
  | "thalamus.cortex"
  | "thalamus.reflexion"
  | "sim.swarm"
  | "sim.fish"
  | "sim.embedding"
  | "sweep.nanoSweep";

export interface RuntimeConfigMap {
  "thalamus.nano": NanoConfig;
  "thalamus.nanoSwarm": NanoSwarmConfig;
  "thalamus.planner": ThalamusPlannerConfig;
  "thalamus.cortex": ThalamusCortexConfig;
  "thalamus.reflexion": ThalamusReflexionConfig;
  "sim.swarm": SimSwarmConfig;
  "sim.fish": SimFishConfig;
  "sim.embedding": SimEmbeddingConfig;
  "sweep.nanoSweep": NanoSweepConfig;
}

export const RUNTIME_CONFIG_DEFAULTS: {
  [D in RuntimeConfigDomain]: RuntimeConfigMap[D];
} = {
  "thalamus.nano": DEFAULT_NANO_CONFIG,
  "thalamus.nanoSwarm": DEFAULT_NANO_SWARM_CONFIG,
  "thalamus.planner": DEFAULT_THALAMUS_PLANNER_CONFIG,
  "thalamus.cortex": DEFAULT_THALAMUS_CORTEX_CONFIG,
  "thalamus.reflexion": DEFAULT_THALAMUS_REFLEXION_CONFIG,
  "sim.swarm": DEFAULT_SIM_SWARM_CONFIG,
  "sim.fish": DEFAULT_SIM_FISH_CONFIG,
  "sim.embedding": DEFAULT_SIM_EMBEDDING_CONFIG,
  "sweep.nanoSweep": DEFAULT_NANO_SWEEP_CONFIG,
};

export const RUNTIME_CONFIG_DOMAINS: RuntimeConfigDomain[] = [
  "thalamus.nano",
  "thalamus.nanoSwarm",
  "thalamus.planner",
  "thalamus.cortex",
  "thalamus.reflexion",
  "sim.swarm",
  "sim.fish",
  "sim.embedding",
  "sweep.nanoSweep",
];

// ─── Field kinds + schema types (shared by service + registrars) ─────

/**
 * Scalar kinds the registry understands when (de)serializing Redis hash
 * values. `"json"` is a structural escape hatch for nested objects /
 * records; no deep validation, trust the admin caller.
 */
export type FieldKind =
  | "string"
  | "number"
  | "boolean"
  | "string[]"
  | "json";

/**
 * Either a plain kind or `{kind, choices}` for enum-style string fields.
 * The service treats `{kind:"string", choices:[...]}` exactly like a plain
 * string at serialization time — `choices` is a UI hint only, not
 * enforced server-side. Admin callers can still PATCH arbitrary strings
 * if they know what they're doing.
 */
export type FieldSpec =
  | FieldKind
  | { kind: FieldKind; choices: readonly string[] };

export function fieldKindOf(spec: FieldSpec): FieldKind {
  return typeof spec === "string" ? spec : spec.kind;
}

export type DomainSchema<D extends RuntimeConfigDomain> = {
  [K in keyof RuntimeConfigMap[D]]: FieldSpec;
};

/**
 * Curated model presets the UI renders in the `model` dropdown. The list
 * is advisory — server accepts any string so ops can push a new model id
 * without a shared-types release.
 */
export const MODEL_PRESETS: Array<{
  value: string;
  provider: "local" | "kimi" | "openai" | "minimax";
  label: string;
  /** Tunables the provider actually reads. UI greys out others. */
  supports: {
    reasoningEffort?: boolean;
    maxOutputTokens?: boolean;
    verbosity?: boolean;
    thinking?: boolean;
    reasoningFormat?: boolean;
    reasoningSplit?: boolean;
    temperature?: boolean;
    topP?: boolean;
  };
}> = [
  {
    value: "gpt-5.4-nano",
    provider: "openai",
    label: "OpenAI · gpt-5.4-nano",
    supports: {
      reasoningEffort: true,
      maxOutputTokens: true,
      verbosity: true,
      temperature: true,
      topP: true,
    },
  },
  {
    value: "gpt-5.4",
    provider: "openai",
    label: "OpenAI · gpt-5.4",
    supports: {
      reasoningEffort: true,
      maxOutputTokens: true,
      verbosity: true,
      temperature: true,
      topP: true,
    },
  },
  {
    value: "kimi-k2",
    provider: "kimi",
    label: "Kimi · K2 (non-thinking)",
    supports: { maxOutputTokens: true, temperature: true, topP: true },
  },
  {
    value: "kimi-k2-thinking",
    provider: "kimi",
    label: "Kimi · K2-thinking",
    supports: {
      thinking: true,
      maxOutputTokens: true,
      temperature: true,
      topP: true,
    },
  },
  {
    value: "kimi-k2.5",
    provider: "kimi",
    label: "Kimi · K2.5 (thinking toggle)",
    supports: {
      thinking: true,
      maxOutputTokens: true,
      temperature: true,
      topP: true,
    },
  },
  {
    value: "MiniMax-M2.7",
    provider: "minimax",
    label: "MiniMax · M2.7",
    supports: {
      reasoningSplit: true,
      maxOutputTokens: true,
      temperature: true,
      topP: true,
    },
  },
  {
    value: "local/gemma-4-26B-A4B-it-Q3_K_M",
    provider: "local",
    label: "Local · Gemma 4 26B MoE Q3 (llama.cpp)",
    supports: {
      thinking: true,
      reasoningFormat: true,
      maxOutputTokens: true,
      temperature: true,
      topP: true,
    },
  },
  {
    value: "local/gemma-e4b-q8",
    provider: "local",
    label: "Local · Gemma E4B Q8 (fast)",
    supports: {
      thinking: true,
      reasoningFormat: true,
      maxOutputTokens: true,
      temperature: true,
      topP: true,
    },
  },
];

export const PROVIDER_CHOICES: readonly string[] = [
  "local",
  "kimi",
  "openai",
  "minimax",
];

export interface DomainSpec<D extends RuntimeConfigDomain> {
  defaults: RuntimeConfigMap[D];
  schema: DomainSchema<D>;
}

/**
 * Port the concrete RuntimeConfigService (console-api) implements.
 * Packages (thalamus, sweep, sim) register their domains against this
 * port at boot — they do NOT import console-api internals.
 */
export interface RuntimeConfigRegistrar {
  registerDomain<D extends RuntimeConfigDomain>(
    domain: D,
    spec: DomainSpec<D>,
  ): void;
}
