import {
  AUTONOMY_ACTION_CHOICES,
  DEFAULT_CONSOLE_AUTONOMY_CONFIG,
  DEFAULT_THALAMUS_BUDGETS_CONFIG,
  type ConsoleAutonomyConfig,
  type CortexOverride,
  type DomainPayload,
  type ThalamusBudgetsConfig,
} from "@interview/shared/config";

export type BudgetRow = ThalamusBudgetsConfig["simple"];
export type GuardrailMode = "open" | "budget" | "cycles" | "mixed";

export {
  AUTONOMY_ACTION_CHOICES,
  DEFAULT_CONSOLE_AUTONOMY_CONFIG,
  DEFAULT_THALAMUS_BUDGETS_CONFIG,
};
export type { ConsoleAutonomyConfig, CortexOverride, DomainPayload, ThalamusBudgetsConfig };

export const CADENCE_PRESETS = [
  {
    id: "watch",
    label: "Watch",
    description: "Slow passive patrol, minimal wakeups.",
    intervalSec: 90,
    accent: "text-cold",
  },
  {
    id: "balanced",
    label: "Balanced",
    description: "Default operator loop for day-to-day runtime.",
    intervalSec: 45,
    accent: "text-cyan",
  },
  {
    id: "hot",
    label: "Hot",
    description: "Fast loop for active monitoring windows.",
    intervalSec: 20,
    accent: "text-amber",
  },
] as const;

export const ROTATION_PRESETS = [
  {
    id: "research",
    label: "Research only",
    description: "Thalamus only, no sweep passes.",
    rotation: ["thalamus"],
  },
  {
    id: "audit",
    label: "Research + sweep",
    description: "Loop research and null-scan checks.",
    rotation: ["thalamus", "sweep-nullscan"],
  },
  {
    id: "full",
    label: "Full loop",
    description: "Research, null-scan, then briefing passes.",
    rotation: ["thalamus", "sweep-nullscan", "fish-swarm"],
  },
] as const;

export const GUARDRAIL_PRESETS = [
  {
    id: "open",
    label: "Uncapped",
    description: "No spend caps, no cycle cap.",
  },
  {
    id: "budget",
    label: "Budget capped",
    description: "Stop on daily/monthly spend exhaustion.",
  },
  {
    id: "cycles",
    label: "Cycle capped",
    description: "Cap Thalamus runs per rolling day.",
  },
  {
    id: "mixed",
    label: "Mixed",
    description: "Budget caps and cycle cap together.",
  },
] as const;

export const BUDGET_PROFILES = [
  {
    id: "lean",
    label: "Lean",
    description: "Cheap triage. Short chains, earlier exits.",
    config: {
      simple: {
        maxIterations: 2,
        maxCost: 0.02,
        confidenceTarget: 0.65,
        coverageTarget: 0.45,
        minFindingsToStop: 1,
      },
      moderate: {
        maxIterations: 3,
        maxCost: 0.04,
        confidenceTarget: 0.72,
        coverageTarget: 0.55,
        minFindingsToStop: 2,
      },
      deep: {
        maxIterations: 5,
        maxCost: 0.07,
        confidenceTarget: 0.78,
        coverageTarget: 0.65,
        minFindingsToStop: 3,
      },
    } satisfies ThalamusBudgetsConfig,
  },
  {
    id: "balanced",
    label: "Balanced",
    description: "Current default ladder.",
    config: DEFAULT_THALAMUS_BUDGETS_CONFIG,
  },
  {
    id: "investigate",
    label: "Deep verify",
    description: "Longer chains and more demanding stop targets.",
    config: {
      simple: {
        maxIterations: 3,
        maxCost: 0.04,
        confidenceTarget: 0.72,
        coverageTarget: 0.55,
        minFindingsToStop: 2,
      },
      moderate: {
        maxIterations: 6,
        maxCost: 0.09,
        confidenceTarget: 0.8,
        coverageTarget: 0.68,
        minFindingsToStop: 4,
      },
      deep: {
        maxIterations: 10,
        maxCost: 0.15,
        confidenceTarget: 0.86,
        coverageTarget: 0.78,
        minFindingsToStop: 6,
      },
    } satisfies ThalamusBudgetsConfig,
  },
] as const;

export const CORTEX_SNIPPETS = [
  {
    label: "Pause strategist",
    patch: { strategist: { enabled: false } } satisfies Record<string, CortexOverride>,
  },
  {
    label: "Cap catalog spend",
    patch: { catalog: { costCeilingUsd: 0.02 } } satisfies Record<string, CortexOverride>,
  },
  {
    label: "More time for observations",
    patch: { observations: { callTimeoutMs: 30_000 } } satisfies Record<string, CortexOverride>,
  },
] as const;

export function compareDomains(a: string, b: string): number {
  const priority = ["console.autonomy", "thalamus.budgets"];
  const aIdx = priority.indexOf(a);
  const bIdx = priority.indexOf(b);
  if (aIdx !== -1 || bIdx !== -1) {
    if (aIdx === -1) return 1;
    if (bIdx === -1) return -1;
    return aIdx - bIdx;
  }
  return a.localeCompare(b);
}

export function summarizeDomain(
  domain: string,
  value: Record<string, unknown>,
  hasOverrides: boolean,
): string[] {
  if (domain === "console.autonomy") {
    const rotation = Array.isArray(value.rotation)
      ? value.rotation.map(shortAction).join(" → ")
      : "rotation n/a";
    const caps = [
      typeof value.dailyBudgetUsd === "number" && value.dailyBudgetUsd > 0
        ? `${fmtUsd(value.dailyBudgetUsd)}/day`
        : null,
      typeof value.monthlyBudgetUsd === "number" && value.monthlyBudgetUsd > 0
        ? `${fmtUsd(value.monthlyBudgetUsd)}/mo`
        : null,
      typeof value.maxThalamusCyclesPerDay === "number" && value.maxThalamusCyclesPerDay > 0
        ? `${value.maxThalamusCyclesPerDay} thalamus/day`
        : null,
    ].filter(Boolean) as string[];
    return [
      typeof value.intervalSec === "number" ? `interval ${value.intervalSec}s` : "interval n/a",
      `rotation ${rotation}`,
      caps.length > 0 ? `caps ${caps.join(" · ")}` : "caps none",
      hasOverrides ? "override active" : "defaults active",
    ];
  }
  if (domain === "thalamus.budgets") {
    const levels = ["simple", "moderate", "deep"] as const;
    return levels.flatMap((level) => {
      const row = value[level];
      if (!isBudgetRow(row)) return [];
      return [`${level} ${fmtUsd(row.maxCost)} · ${row.maxIterations} iter`];
    });
  }
  return [];
}

export function domainEditorTitle(domain: string): string {
  if (domain === "console.autonomy") return "Open the loop editor";
  if (domain === "thalamus.budgets") return "Shape the budget ladder";
  if (domain === "thalamus.cortex") return "Adjust only exceptional cortices";
  return "Inspect and edit this domain";
}

export function domainEditorBody(domain: string): string {
  if (domain === "console.autonomy") {
    return "Cadence, rotation, and caps belong in a guided drawer, not directly in the page flow.";
  }
  if (domain === "thalamus.budgets") {
    return "Pick a posture first, then tune simple, moderate, and deep inside the editor.";
  }
  if (domain === "thalamus.cortex") {
    return "Keep the main page readable. Raw overrides stay available, but behind the drawer.";
  }
  return "This page stays read-first. Open the drawer when you actually want to mutate config.";
}

export function formatPreviewValue(value: unknown): string {
  if (typeof value === "string") return value;
  if (typeof value === "number" || typeof value === "boolean") return String(value);
  if (Array.isArray(value)) {
    return value.map((item) => formatPreviewValue(item)).join(", ");
  }
  if (value && typeof value === "object") {
    const keys = Object.keys(value as Record<string, unknown>);
    return keys.length === 0 ? "{}" : `${keys.length} key${keys.length === 1 ? "" : "s"}`;
  }
  return "—";
}

export function guardrailSummary(
  cfg: ConsoleAutonomyConfig,
  mode: GuardrailMode,
): string {
  if (mode === "open") return "no hard stop";
  if (mode === "budget") {
    return `${fmtUsd(cfg.dailyBudgetUsd)}/day · ${fmtUsd(cfg.monthlyBudgetUsd)}/mo`;
  }
  if (mode === "cycles") return `${cfg.maxThalamusCyclesPerDay} Thalamus/day`;
  return `${fmtUsd(cfg.dailyBudgetUsd)}/day + ${cfg.maxThalamusCyclesPerDay}/day`;
}

export function shortAction(value: unknown): string {
  if (value === "thalamus") return "THALAMUS";
  if (value === "sweep-nullscan") return "SWEEP";
  if (value === "fish-swarm") return "BRIEFING";
  return String(value);
}

export function isBudgetRow(value: unknown): value is Pick<BudgetRow, "maxCost" | "maxIterations"> {
  return (
    typeof value === "object" &&
    value !== null &&
    typeof (value as { maxCost?: unknown }).maxCost === "number" &&
    typeof (value as { maxIterations?: unknown }).maxIterations === "number"
  );
}

export function fmtUsd(value: number): string {
  return `$${value.toFixed(value >= 1 ? 2 : 3)}`;
}

export function detectGuardrailMode(cfg: ConsoleAutonomyConfig): GuardrailMode {
  const hasBudget = cfg.dailyBudgetUsd > 0 || cfg.monthlyBudgetUsd > 0;
  const hasCycles = cfg.maxThalamusCyclesPerDay > 0;
  if (hasBudget && hasCycles) return "mixed";
  if (hasBudget) return "budget";
  if (hasCycles) return "cycles";
  return "open";
}

export function cadencePresetId(
  intervalSec: number,
): (typeof CADENCE_PRESETS)[number]["id"] | "custom" {
  const exact = CADENCE_PRESETS.find((preset) => preset.intervalSec === intervalSec);
  return exact?.id ?? "custom";
}

export function rotationPresetId(
  rotation: string[],
): (typeof ROTATION_PRESETS)[number]["id"] | "custom" {
  const exact = ROTATION_PRESETS.find((preset) => sameStringArray(rotation, preset.rotation));
  return exact?.id ?? "custom";
}

export function budgetProfileId(
  cfg: ThalamusBudgetsConfig,
): (typeof BUDGET_PROFILES)[number]["id"] | "custom" {
  const exact = BUDGET_PROFILES.find((profile) => sameBudgetConfig(cfg, profile.config));
  return exact?.id ?? "custom";
}

export function sameStringArray(a: string[], b: readonly string[]): boolean {
  return a.length === b.length && a.every((value, idx) => value === b[idx]);
}

export function sameBudgetConfig(a: ThalamusBudgetsConfig, b: ThalamusBudgetsConfig): boolean {
  return (
    sameBudgetRow(a.simple, b.simple) &&
    sameBudgetRow(a.moderate, b.moderate) &&
    sameBudgetRow(a.deep, b.deep)
  );
}

export function sameBudgetRow(a: BudgetRow, b: BudgetRow): boolean {
  return (
    a.maxIterations === b.maxIterations &&
    a.maxCost === b.maxCost &&
    a.confidenceTarget === b.confidenceTarget &&
    a.coverageTarget === b.coverageTarget &&
    a.minFindingsToStop === b.minFindingsToStop
  );
}

export function applyBudgetProfile(
  config: ThalamusBudgetsConfig,
  setField: (key: string, value: unknown) => void,
) {
  setField("simple", { ...config.simple });
  setField("moderate", { ...config.moderate });
  setField("deep", { ...config.deep });
}

export function coerceAutonomyConfig(input: Record<string, unknown>): ConsoleAutonomyConfig {
  return {
    intervalSec: asNumber(input.intervalSec, DEFAULT_CONSOLE_AUTONOMY_CONFIG.intervalSec),
    rotation: asStringArray(input.rotation, DEFAULT_CONSOLE_AUTONOMY_CONFIG.rotation),
    dailyBudgetUsd: asNumber(input.dailyBudgetUsd, DEFAULT_CONSOLE_AUTONOMY_CONFIG.dailyBudgetUsd),
    monthlyBudgetUsd: asNumber(input.monthlyBudgetUsd, DEFAULT_CONSOLE_AUTONOMY_CONFIG.monthlyBudgetUsd),
    maxThalamusCyclesPerDay: asNumber(
      input.maxThalamusCyclesPerDay,
      DEFAULT_CONSOLE_AUTONOMY_CONFIG.maxThalamusCyclesPerDay,
    ),
    stopOnBudgetExhausted:
      typeof input.stopOnBudgetExhausted === "boolean"
        ? input.stopOnBudgetExhausted
        : DEFAULT_CONSOLE_AUTONOMY_CONFIG.stopOnBudgetExhausted,
  };
}

export function coerceBudgetConfig(input: Record<string, unknown>): ThalamusBudgetsConfig {
  return {
    simple: asBudgetRow(input.simple, DEFAULT_THALAMUS_BUDGETS_CONFIG.simple),
    moderate: asBudgetRow(input.moderate, DEFAULT_THALAMUS_BUDGETS_CONFIG.moderate),
    deep: asBudgetRow(input.deep, DEFAULT_THALAMUS_BUDGETS_CONFIG.deep),
  };
}

export function asBudgetRow(value: unknown, fallback: BudgetRow): BudgetRow {
  if (typeof value !== "object" || value === null) return { ...fallback };
  const row = value as Record<string, unknown>;
  return {
    maxIterations: asNumber(row.maxIterations, fallback.maxIterations),
    maxCost: asNumber(row.maxCost, fallback.maxCost),
    confidenceTarget: asNumber(row.confidenceTarget, fallback.confidenceTarget),
    coverageTarget: asNumber(row.coverageTarget, fallback.coverageTarget),
    minFindingsToStop: asNumber(row.minFindingsToStop, fallback.minFindingsToStop),
  };
}

export function coerceOverrides(value: unknown): Record<string, CortexOverride> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return {};
  }
  return value as Record<string, CortexOverride>;
}

export function asNumber(value: unknown, fallback: number): number {
  return typeof value === "number" && Number.isFinite(value) ? value : fallback;
}

export function asStringArray(value: unknown, fallback: string[]): string[] {
  if (!Array.isArray(value)) return [...fallback];
  return value.filter((item): item is string => typeof item === "string");
}

export function actionLabelShort(action: string): string {
  if (action === "thalamus") return "THAL";
  if (action === "sweep-nullscan") return "SWEEP";
  if (action === "fish-swarm") return "BRIEF";
  return action.toUpperCase();
}

export function actionLabelLong(action: string): string {
  if (action === "thalamus") return "Thalamus";
  if (action === "sweep-nullscan") return "Sweep null-scan";
  if (action === "fish-swarm") return "Fish briefing";
  return action;
}

export function capitalize(value: string): string {
  return value.charAt(0).toUpperCase() + value.slice(1);
}
