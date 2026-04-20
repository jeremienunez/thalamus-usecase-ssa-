import { useEffect, useMemo, useState, type ReactNode } from "react";
import { RotateCcw, Save, AlertCircle, CheckCircle2 } from "lucide-react";
import { clsx } from "clsx";
import { useDraft } from "@/hooks/useDraft";
import { useUiStore } from "@/shared/ui/uiStore";
import {
  useRuntimeConfigList,
  usePatchRuntimeConfig,
  useResetRuntimeConfig,
  MODEL_PRESETS,
  MODEL_FIELD_SUPPORT_MAP,
  type DomainPayload,
} from "@/features/config/runtime-config";
import { FieldRow } from "./FieldRow";
import { JsonTextarea } from "./JsonTextarea";
import { StringArrayInput } from "./StringArrayInput";

type BudgetRow = {
  maxIterations: number;
  maxCost: number;
  confidenceTarget: number;
  coverageTarget: number;
  minFindingsToStop: number;
};

type ThalamusBudgetsConfig = {
  simple: BudgetRow;
  moderate: BudgetRow;
  deep: BudgetRow;
};

type ConsoleAutonomyConfig = {
  intervalSec: number;
  rotation: string[];
  dailyBudgetUsd: number;
  monthlyBudgetUsd: number;
  maxThalamusCyclesPerDay: number;
  stopOnBudgetExhausted: boolean;
};

type CortexOverride = {
  enabled?: boolean;
  costCeilingUsd?: number;
  callTimeoutMs?: number;
  provider?: string;
  model?: string;
  reasoningEffort?: string;
  verbosity?: string;
  thinking?: boolean;
  reasoningFormat?: string;
  reasoningSplit?: boolean;
  maxOutputTokens?: number;
  temperature?: number;
};

const AUTONOMY_ACTION_CHOICES = [
  "thalamus",
  "sweep-nullscan",
  "fish-swarm",
] as const;

const DEFAULT_CONSOLE_AUTONOMY_CONFIG: ConsoleAutonomyConfig = {
  intervalSec: 45,
  rotation: ["thalamus", "sweep-nullscan"],
  dailyBudgetUsd: 0.5,
  monthlyBudgetUsd: 5,
  maxThalamusCyclesPerDay: 0,
  stopOnBudgetExhausted: true,
};

const DEFAULT_THALAMUS_BUDGETS_CONFIG: ThalamusBudgetsConfig = {
  simple: {
    maxIterations: 2,
    maxCost: 0.03,
    confidenceTarget: 0.7,
    coverageTarget: 0.5,
    minFindingsToStop: 2,
  },
  moderate: {
    maxIterations: 4,
    maxCost: 0.06,
    confidenceTarget: 0.75,
    coverageTarget: 0.6,
    minFindingsToStop: 3,
  },
  deep: {
    maxIterations: 8,
    maxCost: 0.1,
    confidenceTarget: 0.8,
    coverageTarget: 0.7,
    minFindingsToStop: 5,
  },
};

export function ConfigEntry() {
  const { data, isLoading, error } = useRuntimeConfigList();

  if (isLoading) {
    return (
      <div className="p-6 text-muted">Loading runtime config…</div>
    );
  }
  if (error) {
    return (
      <div className="p-6 text-hot">
        Error: {(error as Error).message}
      </div>
    );
  }
  if (!data) return null;

  // Group by package namespace (console.* / thalamus.* / sim.* / sweep.*)
  const grouped = Object.entries(data.domains).reduce<
    Record<string, Array<[string, DomainPayload]>>
  >((acc, [domain, payload]) => {
    const ns = domain.split(".")[0] ?? "other";
    (acc[ns] ??= []).push([domain, payload]);
    return acc;
  }, {});
  const nsOrder = ["console", "thalamus", "sim", "sweep"];
  const orderedNs = [
    ...nsOrder.filter((ns) => grouped[ns]),
    ...Object.keys(grouped).filter((ns) => !nsOrder.includes(ns)).sort(),
  ];
  const totalDomains = Object.keys(data.domains).length;
  const liveOverrides = Object.values(data.domains).filter(
    (domain) => domain.hasOverrides,
  ).length;

  return (
    <div className="h-full overflow-y-auto">
      <div className="mx-auto max-w-6xl p-6 space-y-8">
        <div>
          <h1 className="text-xl font-semibold text-primary">
            Runtime configuration
          </h1>
          <p className="mt-1 text-caption text-muted">
            Single polymorphic endpoint (<code className="mono">/api/config/runtime/:domain</code>).
            Changes apply immediately — kernel reads fresh on every call, no redeploy.
          </p>
        </div>

        <div className="grid gap-3 md:grid-cols-3">
          <GuideCard
            eyebrow="01"
            title="Pick the operating path"
            body="Use the guided cards for autonomy and budget posture first. They’re the safe levers."
            meta={`${totalDomains} live domains`}
          />
          <GuideCard
            eyebrow="02"
            title="Tune hard limits"
            body="Cadence, spend ceilings, and research depth should stay legible without raw JSON."
            meta={`${liveOverrides} override${liveOverrides === 1 ? "" : "s"} active`}
          />
          <GuideCard
            eyebrow="03"
            title="Use raw overrides last"
            body="Cortex-specific JSON remains available, but only as an escape hatch after planner and budgets."
            meta="decision tree first"
          />
        </div>

        {orderedNs.map((ns) => (
          <section key={ns} className="space-y-3">
            <h2 className="label text-primary border-b border-hairline pb-1">
              {ns.toUpperCase()}
            </h2>
            {grouped[ns]!
              .sort(([a], [b]) => compareDomains(a, b))
              .map(([domain, payload]) => (
                <DomainCard
                  key={domain}
                  domain={domain}
                  payload={payload}
                />
              ))}
          </section>
        ))}
      </div>
    </div>
  );
}

function DomainCard({
  domain,
  payload,
}: {
  domain: string;
  payload: DomainPayload;
}) {
  const patch = usePatchRuntimeConfig();
  const reset = useResetRuntimeConfig();
  const configFocus = useUiStore((s) => s.configFocus);
  const clearConfigFocus = useUiStore((s) => s.clearConfigFocus);
  const { draft, errors, setErrors, dirty, diff, setField, replace } = useDraft(
    payload.value,
  );
  const [flashFocused, setFlashFocused] = useState(false);
  const isFocused = flashFocused || configFocus?.domain === domain;
  const summary = useMemo(() => summarizeDomain(domain, draft, payload.hasOverrides), [
    domain,
    draft,
    payload.hasOverrides,
  ]);

  useEffect(() => {
    if (configFocus?.domain !== domain) return;
    const id = window.setTimeout(() => {
      document.getElementById(`domain-${domain}`)?.scrollIntoView({
        behavior: "smooth",
        block: "start",
      });
      setFlashFocused(true);
      clearConfigFocus();
    }, 0);
    const resetId = window.setTimeout(() => {
      setFlashFocused(false);
    }, 2_000);
    return () => {
      window.clearTimeout(id);
      window.clearTimeout(resetId);
    };
  }, [clearConfigFocus, configFocus, domain]);

  function onSave() {
    patch.mutate(
      { domain, patch: diff },
      {
        onError: (err) => setErrors({ __root: (err as Error).message }),
        onSuccess: (resp) => replace(resp.value),
      },
    );
  }

  function onReset() {
    reset.mutate(domain, {
      onSuccess: (resp) => replace(resp.value),
    });
  }

  return (
    <section
      id={`domain-${domain}`}
      className={clsx(
        "scroll-mt-12 border bg-panel transition-colors duration-med ease-palantir",
        isFocused ? "border-cyan/70 shadow-[0_0_0_1px_rgba(34,211,238,0.2)]" : "border-hairline",
      )}
    >
      <header className="flex items-center justify-between border-b border-hairline px-4 py-3">
        <div className="min-w-0">
          <div className="flex items-center gap-3">
            <span className="mono text-label text-primary">{domain}</span>
            {payload.hasOverrides ? (
              <span className="label flex items-center gap-1 text-amber">
                <AlertCircle size={12} strokeWidth={1.5} />
                OVERRIDE ACTIVE
              </span>
            ) : (
              <span className="label flex items-center gap-1 text-muted">
                <CheckCircle2 size={12} strokeWidth={1.5} />
                DEFAULTS
              </span>
            )}
          </div>
          {summary.length > 0 && (
            <div className="mt-1 flex flex-wrap gap-1">
              {summary.map((item) => (
                <span
                  key={item}
                  className="border border-hairline px-2 py-0.5 mono text-caption text-dim"
                >
                  {item}
                </span>
              ))}
            </div>
          )}
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={onReset}
            disabled={!payload.hasOverrides || reset.isPending}
            className={clsx(
              "flex items-center gap-1 border border-hairline px-2 py-1 text-caption",
              payload.hasOverrides
                ? "text-muted hover:text-primary hover:border-primary cursor-pointer"
                : "cursor-not-allowed opacity-40",
            )}
          >
            <RotateCcw size={12} strokeWidth={1.5} />
            Reset
          </button>
          <button
            onClick={onSave}
            disabled={!dirty || patch.isPending}
            className={clsx(
              "flex items-center gap-1 border px-2 py-1 text-caption",
              dirty && !patch.isPending
                ? "border-cyan text-cyan hover:bg-cyan hover:text-black cursor-pointer"
                : "cursor-not-allowed border-hairline opacity-40",
            )}
          >
            <Save size={12} strokeWidth={1.5} />
            {patch.isPending ? "Saving…" : "Save"}
          </button>
        </div>
      </header>

      {errors.__root && (
        <div className="border-b border-hot/40 bg-hot/10 px-4 py-2 text-caption text-hot">
          {errors.__root}
        </div>
      )}

      <DomainEditor
        domain={domain}
        payload={payload}
        draft={draft}
        errors={errors}
        setField={setField}
      />
    </section>
  );
}

function GuideCard(props: {
  eyebrow: string;
  title: string;
  body: string;
  meta: string;
}) {
  return (
    <div className="rounded-xl border border-hairline bg-[linear-gradient(180deg,rgba(255,255,255,0.02),rgba(255,255,255,0.01))] p-4">
      <div className="mono text-caption text-cyan">{props.eyebrow}</div>
      <div className="mt-2 text-body text-primary">{props.title}</div>
      <p className="mt-1 text-caption text-muted">{props.body}</p>
      <div className="mt-4 mono text-caption text-dim">{props.meta}</div>
    </div>
  );
}

function compareDomains(a: string, b: string): number {
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

function summarizeDomain(
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
      typeof value.maxThalamusCyclesPerDay === "number" &&
        value.maxThalamusCyclesPerDay > 0
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
      return [
        `${level} ${fmtUsd(row.maxCost)} · ${row.maxIterations} iter`,
      ];
    });
  }
  return [];
}

function shortAction(value: unknown): string {
  if (value === "thalamus") return "THALAMUS";
  if (value === "sweep-nullscan") return "SWEEP";
  if (value === "fish-swarm") return "BRIEFING";
  return String(value);
}

function isBudgetRow(value: unknown): value is {
  maxCost: number;
  maxIterations: number;
} {
  return (
    typeof value === "object" &&
    value !== null &&
    typeof (value as { maxCost?: unknown }).maxCost === "number" &&
    typeof (value as { maxIterations?: unknown }).maxIterations === "number"
  );
}

function fmtUsd(value: number): string {
  return `$${value.toFixed(value >= 1 ? 2 : 3)}`;
}

type DomainEditorProps = {
  domain: string;
  payload: DomainPayload;
  draft: Record<string, unknown>;
  errors: Record<string, string>;
  setField: (key: string, value: unknown) => void;
};

const CADENCE_PRESETS = [
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

const ROTATION_PRESETS = [
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

const GUARDRAIL_PRESETS = [
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

const BUDGET_PROFILES = [
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

const CORTEX_SNIPPETS = [
  {
    label: "Pause strategist",
    patch: { strategist: { enabled: false } } satisfies Record<
      string,
      CortexOverride
    >,
  },
  {
    label: "Cap catalog spend",
    patch: { catalog: { costCeilingUsd: 0.02 } } satisfies Record<
      string,
      CortexOverride
    >,
  },
  {
    label: "More time for observations",
    patch: { observations: { callTimeoutMs: 30_000 } } satisfies Record<
      string,
      CortexOverride
    >,
  },
] as const;

function DomainEditor(props: DomainEditorProps) {
  if (props.domain === "console.autonomy") {
    return <AutonomyDecisionEditor {...props} />;
  }
  if (props.domain === "thalamus.budgets") {
    return <BudgetsDecisionEditor {...props} />;
  }
  if (props.domain === "thalamus.cortex") {
    return <CortexOverridesEditor {...props} />;
  }
  return <GenericFieldList {...props} />;
}

function GenericFieldList({
  payload,
  draft,
  errors,
  setField,
}: DomainEditorProps) {
  return (
    <div className="divide-y divide-hairline/50">
      {Object.entries(payload.schema).map(([key, spec]) => {
        const selectedModel =
          typeof draft.model === "string" ? draft.model : "";
        const preset = MODEL_PRESETS.find((p) => p.value === selectedModel);
        const supportKey = MODEL_FIELD_SUPPORT_MAP[key];
        const unsupported =
          preset && supportKey ? preset.supports[supportKey] !== true : false;
        const handleChange = (v: unknown) => {
          if (key === "model" && typeof v === "string") {
            const p = MODEL_PRESETS.find((x) => x.value === v);
            if (p && "provider" in payload.schema) {
              setField("model", v);
              setField("provider", p.provider);
              return;
            }
          }
          setField(key, v);
        };
        return (
          <FieldRow
            key={key}
            keyName={key}
            spec={spec}
            value={draft[key]}
            defaultValue={payload.defaults[key]}
            onChange={handleChange}
            error={errors[key]}
            unsupported={unsupported}
            unsupportedReason={
              unsupported
                ? `Ignored by ${preset?.label ?? selectedModel}`
                : undefined
            }
          />
        );
      })}
    </div>
  );
}

function AutonomyDecisionEditor({
  payload,
  draft,
  setField,
  errors,
}: DomainEditorProps) {
  const cfg = coerceAutonomyConfig(draft);
  const defaults = coerceAutonomyConfig(payload.defaults);
  const activeCadence = cadencePresetId(cfg.intervalSec);
  const activeRotation = rotationPresetId(cfg.rotation);
  const guardrailMode = detectGuardrailMode(cfg);

  function applyGuardrail(mode: GuardrailMode) {
    if (mode === "open") {
      setField("dailyBudgetUsd", 0);
      setField("monthlyBudgetUsd", 0);
      setField("maxThalamusCyclesPerDay", 0);
      setField("stopOnBudgetExhausted", false);
      return;
    }
    if (mode === "budget") {
      setField(
        "dailyBudgetUsd",
        cfg.dailyBudgetUsd > 0 ? cfg.dailyBudgetUsd : defaults.dailyBudgetUsd,
      );
      setField(
        "monthlyBudgetUsd",
        cfg.monthlyBudgetUsd > 0
          ? cfg.monthlyBudgetUsd
          : defaults.monthlyBudgetUsd,
      );
      setField("maxThalamusCyclesPerDay", 0);
      setField("stopOnBudgetExhausted", true);
      return;
    }
    if (mode === "cycles") {
      setField("dailyBudgetUsd", 0);
      setField("monthlyBudgetUsd", 0);
      setField(
        "maxThalamusCyclesPerDay",
        cfg.maxThalamusCyclesPerDay > 0 ? cfg.maxThalamusCyclesPerDay : 24,
      );
      setField("stopOnBudgetExhausted", true);
      return;
    }
    setField(
      "dailyBudgetUsd",
      cfg.dailyBudgetUsd > 0 ? cfg.dailyBudgetUsd : defaults.dailyBudgetUsd,
    );
    setField(
      "monthlyBudgetUsd",
      cfg.monthlyBudgetUsd > 0
        ? cfg.monthlyBudgetUsd
        : defaults.monthlyBudgetUsd,
    );
    setField(
      "maxThalamusCyclesPerDay",
      cfg.maxThalamusCyclesPerDay > 0 ? cfg.maxThalamusCyclesPerDay : 24,
    );
    setField("stopOnBudgetExhausted", true);
  }

  return (
    <div className="space-y-4 p-4">
      <div className="grid gap-4 xl:grid-cols-[minmax(0,1.45fr)_300px]">
        <div className="space-y-4">
          <DecisionStep
            index={1}
            title="Loop cadence"
            description="Choose how aggressively the autonomy loop wakes up."
          >
            <div className="grid gap-3 md:grid-cols-3">
              {CADENCE_PRESETS.map((preset) => (
                <DecisionCard
                  key={preset.id}
                  selected={activeCadence === preset.id}
                  label={preset.label}
                  description={preset.description}
                  meta={`${preset.intervalSec}s`}
                  accent={preset.accent}
                  onClick={() => setField("intervalSec", preset.intervalSec)}
                />
              ))}
            </div>
            {activeCadence === "custom" && (
              <div className="rounded-md border border-hairline bg-base/40 p-3">
                <NumberField
                  id="autonomy-interval-sec"
                  label="Custom interval"
                  hint="Allowed range 15s → 600s."
                  value={cfg.intervalSec}
                  min={15}
                  max={600}
                  step={5}
                  onChange={(value) => setField("intervalSec", value)}
                />
              </div>
            )}
          </DecisionStep>

          <DecisionStep
            index={2}
            title="Research mix"
            description="Define the path each loop follows before it sleeps again."
          >
            <div className="grid gap-3 md:grid-cols-3 xl:grid-cols-4">
              {ROTATION_PRESETS.map((preset) => (
                <DecisionCard
                  key={preset.id}
                  selected={activeRotation === preset.id}
                  label={preset.label}
                  description={preset.description}
                  meta={preset.rotation.map(actionLabelShort).join(" → ")}
                  onClick={() => setField("rotation", [...preset.rotation])}
                />
              ))}
              <DecisionCard
                selected={activeRotation === "custom"}
                label="Custom"
                description="Manual stage ordering."
                meta="operator-defined"
                onClick={() => {
                  if (activeRotation === "custom") return;
                  setField("rotation", [...cfg.rotation]);
                }}
              />
            </div>
            {activeRotation === "custom" && (
              <div className="rounded-md border border-hairline bg-base/40 p-3">
                <label className="mb-2 block mono text-caption text-dim">
                  Ordered rotation
                </label>
                <StringArrayInput
                  value={cfg.rotation}
                  choices={AUTONOMY_ACTION_CHOICES}
                  onChange={(value) => setField("rotation", value)}
                />
              </div>
            )}
          </DecisionStep>

          <DecisionStep
            index={3}
            title="Guardrails"
            description="Decide whether the loop stops on spend, on cycle count, or both."
          >
            <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
              {GUARDRAIL_PRESETS.map((preset) => (
                <DecisionCard
                  key={preset.id}
                  selected={guardrailMode === preset.id}
                  label={preset.label}
                  description={preset.description}
                  onClick={() => applyGuardrail(preset.id)}
                />
              ))}
            </div>
            <div className="grid gap-3 md:grid-cols-2">
              {(guardrailMode === "budget" || guardrailMode === "mixed") && (
                <>
                  <NumberField
                    id="autonomy-daily-budget"
                    label="Daily budget"
                    hint="USD spent over the rolling day window."
                    value={cfg.dailyBudgetUsd}
                    min={0}
                    max={1000}
                    step={0.05}
                    onChange={(value) => setField("dailyBudgetUsd", value)}
                  />
                  <NumberField
                    id="autonomy-monthly-budget"
                    label="Monthly budget"
                    hint="USD spent over the rolling 30d window."
                    value={cfg.monthlyBudgetUsd}
                    min={0}
                    max={10_000}
                    step={0.1}
                    onChange={(value) => setField("monthlyBudgetUsd", value)}
                  />
                </>
              )}
              {(guardrailMode === "cycles" || guardrailMode === "mixed") && (
                <NumberField
                  id="autonomy-thalamus-cap"
                  label="Thalamus cycles / day"
                  hint="Rolling-day cap. 0 means unlimited."
                  value={cfg.maxThalamusCyclesPerDay}
                  min={0}
                  max={10_000}
                  step={1}
                  onChange={(value) =>
                    setField("maxThalamusCyclesPerDay", value)
                  }
                />
              )}
              {(guardrailMode === "budget" || guardrailMode === "mixed") && (
                <ToggleCard
                  label="Stop on budget exhaustion"
                  description="If disabled, budgets are still tracked but won’t halt the loop."
                  checked={cfg.stopOnBudgetExhausted}
                  onChange={(checked) =>
                    setField("stopOnBudgetExhausted", checked)
                  }
                />
              )}
            </div>
            {errors.dailyBudgetUsd && (
              <div className="text-caption text-hot">{errors.dailyBudgetUsd}</div>
            )}
          </DecisionStep>
        </div>

        <div className="space-y-4">
          <DecisionSidebar
            eyebrow="Decision tree"
            title="Autonomy runtime"
            body="Pick a cadence, choose the loop path, then add only the guardrails you actually need."
          >
            <TreeLine active label={`wake every ${cfg.intervalSec}s`} />
            <TreeLine
              active
              label={cfg.rotation.map(actionLabelLong).join(" → ")}
            />
            <TreeLine
              active
              label={
                guardrailMode === "open"
                  ? "no hard stop"
                  : guardrailMode === "budget"
                    ? `${fmtUsd(cfg.dailyBudgetUsd)}/day · ${fmtUsd(cfg.monthlyBudgetUsd)}/mo`
                    : guardrailMode === "cycles"
                      ? `${cfg.maxThalamusCyclesPerDay} Thalamus/day`
                      : `${fmtUsd(cfg.dailyBudgetUsd)}/day + ${cfg.maxThalamusCyclesPerDay}/day`
              }
            />
          </DecisionSidebar>

          <details className="rounded-xl border border-hairline bg-base/30">
            <summary className="cursor-pointer px-4 py-3 mono text-caption text-dim">
              raw fields
            </summary>
            <GenericFieldList
              domain="console.autonomy"
              payload={payload}
              draft={draft}
              errors={errors}
              setField={setField}
            />
          </details>
        </div>
      </div>
    </div>
  );
}

function BudgetsDecisionEditor({
  payload,
  draft,
  setField,
  errors,
}: DomainEditorProps) {
  const cfg = coerceBudgetConfig(draft);
  const activeProfile = budgetProfileId(cfg);

  return (
    <div className="space-y-4 p-4">
      <div className="grid gap-4 xl:grid-cols-[minmax(0,1.45fr)_300px]">
        <div className="space-y-4">
          <DecisionStep
            index={1}
            title="Operating profile"
            description="Set the overall chain depth before fine-tuning each lane."
          >
            <div className="grid gap-3 md:grid-cols-3">
              {BUDGET_PROFILES.map((profile) => (
                <DecisionCard
                  key={profile.id}
                  selected={activeProfile === profile.id}
                  label={profile.label}
                  description={profile.description}
                  meta={profile.id === "balanced" ? "default ladder" : "preset"}
                  onClick={() => applyBudgetProfile(profile.config, setField)}
                />
              ))}
            </div>
          </DecisionStep>

          <DecisionStep
            index={2}
            title="Budget ladder"
            description="Tune each complexity lane directly instead of editing raw JSON."
          >
            <div className="grid gap-4 xl:grid-cols-3">
              <BudgetTierCard
                tone="text-cold"
                level="simple"
                row={cfg.simple}
                onChange={(next) => setField("simple", next)}
              />
              <BudgetTierCard
                tone="text-cyan"
                level="moderate"
                row={cfg.moderate}
                onChange={(next) => setField("moderate", next)}
              />
              <BudgetTierCard
                tone="text-amber"
                level="deep"
                row={cfg.deep}
                onChange={(next) => setField("deep", next)}
              />
            </div>
          </DecisionStep>
        </div>

        <div className="space-y-4">
          <DecisionSidebar
            eyebrow="Decision tree"
            title="Research budgeting"
            body="Choose a global posture first, then shape each lane around spend, chain depth, and stop thresholds."
          >
            <TreeLine
              active
              label={`simple ${fmtUsd(cfg.simple.maxCost)} · ${cfg.simple.maxIterations} iter`}
            />
            <TreeLine
              active
              label={`moderate ${fmtUsd(cfg.moderate.maxCost)} · ${cfg.moderate.maxIterations} iter`}
            />
            <TreeLine
              active
              label={`deep ${fmtUsd(cfg.deep.maxCost)} · ${cfg.deep.maxIterations} iter`}
            />
          </DecisionSidebar>

          <details className="rounded-xl border border-hairline bg-base/30">
            <summary className="cursor-pointer px-4 py-3 mono text-caption text-dim">
              raw JSON rows
            </summary>
            <GenericFieldList
              domain="thalamus.budgets"
              payload={payload}
              draft={draft}
              errors={errors}
              setField={setField}
            />
          </details>
        </div>
      </div>
      {Object.values(errors).length > 0 && (
        <div className="text-caption text-hot">
          {Object.values(errors).join(" · ")}
        </div>
      )}
    </div>
  );
}

function CortexOverridesEditor({
  draft,
  setField,
  errors,
}: DomainEditorProps) {
  const overrides = coerceOverrides(draft.overrides);
  const activeNames = Object.keys(overrides);

  return (
    <div className="grid gap-4 p-4 xl:grid-cols-[minmax(0,1.25fr)_300px]">
      <div className="space-y-4">
        <DecisionStep
          index={1}
          title="Override only the outliers"
          description="Use planner defaults and budget ladders first. Cortex overrides are for isolated exceptions."
        >
          <div className="grid gap-3 md:grid-cols-3">
            {CORTEX_SNIPPETS.map((snippet) => (
              <DecisionCard
                key={snippet.label}
                selected={false}
                label={snippet.label}
                description="Insert a starter patch, then edit the raw map below."
                onClick={() =>
                  setField("overrides", {
                    ...overrides,
                    ...snippet.patch,
                  })
                }
              />
            ))}
          </div>
        </DecisionStep>

        <div className="rounded-xl border border-hairline bg-base/30 p-4">
          <div className="mb-3 flex items-center justify-between gap-3">
            <div>
              <div className="mono text-body text-primary">Raw override map</div>
              <div className="text-caption text-muted">
                Fields omitted here fall back to `thalamus.planner`.
              </div>
            </div>
            <span className="mono text-caption text-dim">
              {activeNames.length} active key{activeNames.length === 1 ? "" : "s"}
            </span>
          </div>
          {activeNames.length > 0 && (
            <div className="mb-3 flex flex-wrap gap-1">
              {activeNames.map((name) => (
                <span
                  key={name}
                  className="border border-hairline px-2 py-0.5 mono text-caption text-dim"
                >
                  {name}
                </span>
              ))}
            </div>
          )}
          <JsonTextarea
            value={overrides}
            onChange={(value) => setField("overrides", coerceOverrides(value))}
          />
          {errors.overrides && (
            <div className="mt-2 text-caption text-hot">{errors.overrides}</div>
          )}
        </div>
      </div>

      <DecisionSidebar
        eyebrow="Decision tree"
        title="Per-cortex escape hatch"
        body="1. Fix the shared planner if the problem is global. 2. Tune budgets if the issue is cost/depth. 3. Override a single cortex only when one lane is the outlier."
      >
        <TreeLine active={activeNames.length === 0} label="planner / budgets first" />
        <TreeLine
          active={activeNames.length > 0}
          label={
            activeNames.length > 0
              ? `${activeNames.length} cortex override active`
              : "no overrides active"
          }
        />
      </DecisionSidebar>
    </div>
  );
}

function BudgetTierCard(props: {
  level: "simple" | "moderate" | "deep";
  row: BudgetRow;
  tone: string;
  onChange: (next: BudgetRow) => void;
}) {
  const prefix = props.level;
  return (
    <div className="rounded-xl border border-hairline bg-base/30 p-4">
      <div className="mb-4 flex items-start justify-between gap-3">
        <div>
          <div className={clsx("mono text-body uppercase", props.tone)}>
            {props.level}
          </div>
          <div className="text-caption text-muted">
            {fmtUsd(props.row.maxCost)} cap · {props.row.maxIterations} iterations
          </div>
        </div>
        <div className="label text-dim">lane</div>
      </div>

      <div className="space-y-3">
        <NumberField
          id={`${prefix}-max-cost`}
          label={`${capitalize(prefix)} max spend`}
          hint="Hard USD ceiling per chain."
          value={props.row.maxCost}
          min={0}
          max={10}
          step={0.01}
          onChange={(value) => props.onChange({ ...props.row, maxCost: value })}
        />
        <NumberField
          id={`${prefix}-max-iterations`}
          label={`${capitalize(prefix)} max iterations`}
          hint="Upper bound on reflexion / replan turns."
          value={props.row.maxIterations}
          min={1}
          max={20}
          step={1}
          onChange={(value) =>
            props.onChange({ ...props.row, maxIterations: Math.round(value) })
          }
        />
        <RangeField
          id={`${prefix}-confidence`}
          label={`${capitalize(prefix)} confidence target`}
          hint="Stop once confidence crosses this bar."
          value={props.row.confidenceTarget}
          min={0}
          max={1}
          step={0.05}
          onChange={(value) =>
            props.onChange({ ...props.row, confidenceTarget: value })
          }
        />
        <RangeField
          id={`${prefix}-coverage`}
          label={`${capitalize(prefix)} coverage target`}
          hint="Expected source / hypothesis coverage."
          value={props.row.coverageTarget}
          min={0}
          max={1}
          step={0.05}
          onChange={(value) =>
            props.onChange({ ...props.row, coverageTarget: value })
          }
        />
        <NumberField
          id={`${prefix}-min-findings`}
          label={`${capitalize(prefix)} findings before stop`}
          hint="Minimum emitted findings before short-circuit."
          value={props.row.minFindingsToStop}
          min={0}
          max={50}
          step={1}
          onChange={(value) =>
            props.onChange({
              ...props.row,
              minFindingsToStop: Math.round(value),
            })
          }
        />
      </div>
    </div>
  );
}

function DecisionStep(props: {
  index: number;
  title: string;
  description: string;
  children: ReactNode;
}) {
  return (
    <section className="rounded-xl border border-hairline bg-base/30 p-4">
      <div className="mb-3 flex items-start gap-3">
        <div className="flex h-7 w-7 shrink-0 items-center justify-center border border-cyan/40 bg-cyan/10 mono text-caption text-cyan">
          {props.index}
        </div>
        <div>
          <h3 className="text-body text-primary">{props.title}</h3>
          <p className="text-caption text-muted">{props.description}</p>
        </div>
      </div>
      {props.children}
    </section>
  );
}

function DecisionCard(props: {
  selected: boolean;
  label: string;
  description: string;
  meta?: string;
  accent?: string;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={props.onClick}
      className={clsx(
        "rounded-xl border p-3 text-left transition-colors duration-fast ease-palantir cursor-pointer",
        props.selected
          ? "border-cyan bg-cyan/10"
          : "border-hairline bg-base/30 hover:border-cyan/50 hover:bg-base/50",
      )}
    >
      <div className={clsx("mono text-caption", props.accent ?? "text-primary")}>
        {props.label}
      </div>
      <div className="mt-1 text-caption text-muted">{props.description}</div>
      {props.meta && (
        <div className="mt-3 mono text-caption text-dim">{props.meta}</div>
      )}
    </button>
  );
}

function DecisionSidebar(props: {
  eyebrow: string;
  title: string;
  body: string;
  children: ReactNode;
}) {
  return (
    <aside className="rounded-xl border border-hairline bg-[radial-gradient(circle_at_top_left,rgba(34,211,238,0.08),transparent_55%)] p-4">
      <div className="label text-cyan">{props.eyebrow}</div>
      <h3 className="mt-2 text-body text-primary">{props.title}</h3>
      <p className="mt-1 text-caption text-muted">{props.body}</p>
      <div className="mt-4 space-y-2">{props.children}</div>
    </aside>
  );
}

function TreeLine(props: { active?: boolean; label: string }) {
  return (
    <div className="flex items-start gap-2">
      <span
        className={clsx(
          "mt-1 h-2 w-2 shrink-0 rounded-full",
          props.active ? "bg-cyan" : "bg-hairline",
        )}
      />
      <span
        className={clsx(
          "mono text-caption",
          props.active ? "text-primary" : "text-dim",
        )}
      >
        {props.label}
      </span>
    </div>
  );
}

function NumberField(props: {
  id: string;
  label: string;
  hint: string;
  value: number;
  min: number;
  max: number;
  step: number;
  onChange: (value: number) => void;
}) {
  return (
    <label className="block">
      <div className="flex items-center justify-between gap-2">
        <span className="mono text-caption text-primary">{props.label}</span>
        <span className="mono text-caption text-dim">{props.value}</span>
      </div>
      <div className="mt-1 text-caption text-muted">{props.hint}</div>
      <input
        id={props.id}
        aria-label={props.label}
        type="number"
        className="mt-2 w-full border border-hairline bg-black/40 px-3 py-2 mono text-body text-primary focus:border-cyan focus:outline-none"
        value={props.value}
        min={props.min}
        max={props.max}
        step={props.step}
        onChange={(e) => props.onChange(Number(e.target.value))}
      />
    </label>
  );
}

function RangeField(props: {
  id: string;
  label: string;
  hint: string;
  value: number;
  min: number;
  max: number;
  step: number;
  onChange: (value: number) => void;
}) {
  return (
    <label className="block">
      <div className="flex items-center justify-between gap-2">
        <span className="mono text-caption text-primary">{props.label}</span>
        <span className="mono text-caption text-dim">
          {props.value.toFixed(2)}
        </span>
      </div>
      <div className="mt-1 text-caption text-muted">{props.hint}</div>
      <input
        id={props.id}
        aria-label={props.label}
        type="range"
        className="mt-2 w-full accent-cyan"
        value={props.value}
        min={props.min}
        max={props.max}
        step={props.step}
        onChange={(e) => props.onChange(Number(e.target.value))}
      />
    </label>
  );
}

function ToggleCard(props: {
  label: string;
  description: string;
  checked: boolean;
  onChange: (checked: boolean) => void;
}) {
  return (
    <label className="flex h-full cursor-pointer flex-col justify-between rounded-xl border border-hairline bg-base/30 p-4">
      <div>
        <div className="mono text-caption text-primary">{props.label}</div>
        <div className="mt-1 text-caption text-muted">{props.description}</div>
      </div>
      <div className="mt-4 flex items-center gap-2">
        <input
          type="checkbox"
          className="accent-cyan"
          checked={props.checked}
          onChange={(e) => props.onChange(e.target.checked)}
        />
        <span className="mono text-caption text-dim">
          {props.checked ? "enabled" : "disabled"}
        </span>
      </div>
    </label>
  );
}

type GuardrailMode = "open" | "budget" | "cycles" | "mixed";

function detectGuardrailMode(cfg: ConsoleAutonomyConfig): GuardrailMode {
  const hasBudget = cfg.dailyBudgetUsd > 0 || cfg.monthlyBudgetUsd > 0;
  const hasCycles = cfg.maxThalamusCyclesPerDay > 0;
  if (hasBudget && hasCycles) return "mixed";
  if (hasBudget) return "budget";
  if (hasCycles) return "cycles";
  return "open";
}

function cadencePresetId(
  intervalSec: number,
): (typeof CADENCE_PRESETS)[number]["id"] | "custom" {
  const exact = CADENCE_PRESETS.find(
    (preset) => preset.intervalSec === intervalSec,
  );
  return exact?.id ?? "custom";
}

function rotationPresetId(
  rotation: string[],
): (typeof ROTATION_PRESETS)[number]["id"] | "custom" {
  const exact = ROTATION_PRESETS.find((preset) =>
    sameStringArray(rotation, preset.rotation),
  );
  return exact?.id ?? "custom";
}

function budgetProfileId(
  cfg: ThalamusBudgetsConfig,
): (typeof BUDGET_PROFILES)[number]["id"] | "custom" {
  const exact = BUDGET_PROFILES.find((profile) =>
    sameBudgetConfig(cfg, profile.config),
  );
  return exact?.id ?? "custom";
}

function sameStringArray(a: string[], b: readonly string[]): boolean {
  return a.length === b.length && a.every((value, idx) => value === b[idx]);
}

function sameBudgetConfig(a: ThalamusBudgetsConfig, b: ThalamusBudgetsConfig): boolean {
  return (
    sameBudgetRow(a.simple, b.simple) &&
    sameBudgetRow(a.moderate, b.moderate) &&
    sameBudgetRow(a.deep, b.deep)
  );
}

function sameBudgetRow(a: BudgetRow, b: BudgetRow): boolean {
  return (
    a.maxIterations === b.maxIterations &&
    a.maxCost === b.maxCost &&
    a.confidenceTarget === b.confidenceTarget &&
    a.coverageTarget === b.coverageTarget &&
    a.minFindingsToStop === b.minFindingsToStop
  );
}

function applyBudgetProfile(
  config: ThalamusBudgetsConfig,
  setField: (key: string, value: unknown) => void,
) {
  setField("simple", { ...config.simple });
  setField("moderate", { ...config.moderate });
  setField("deep", { ...config.deep });
}

function coerceAutonomyConfig(
  input: Record<string, unknown>,
): ConsoleAutonomyConfig {
  return {
    intervalSec: asNumber(
      input.intervalSec,
      DEFAULT_CONSOLE_AUTONOMY_CONFIG.intervalSec,
    ),
    rotation: asStringArray(
      input.rotation,
      DEFAULT_CONSOLE_AUTONOMY_CONFIG.rotation,
    ),
    dailyBudgetUsd: asNumber(
      input.dailyBudgetUsd,
      DEFAULT_CONSOLE_AUTONOMY_CONFIG.dailyBudgetUsd,
    ),
    monthlyBudgetUsd: asNumber(
      input.monthlyBudgetUsd,
      DEFAULT_CONSOLE_AUTONOMY_CONFIG.monthlyBudgetUsd,
    ),
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

function coerceBudgetConfig(input: Record<string, unknown>): ThalamusBudgetsConfig {
  return {
    simple: asBudgetRow(input.simple, DEFAULT_THALAMUS_BUDGETS_CONFIG.simple),
    moderate: asBudgetRow(
      input.moderate,
      DEFAULT_THALAMUS_BUDGETS_CONFIG.moderate,
    ),
    deep: asBudgetRow(input.deep, DEFAULT_THALAMUS_BUDGETS_CONFIG.deep),
  };
}

function asBudgetRow(value: unknown, fallback: BudgetRow): BudgetRow {
  if (typeof value !== "object" || value === null) return { ...fallback };
  const row = value as Record<string, unknown>;
  return {
    maxIterations: asNumber(row.maxIterations, fallback.maxIterations),
    maxCost: asNumber(row.maxCost, fallback.maxCost),
    confidenceTarget: asNumber(
      row.confidenceTarget,
      fallback.confidenceTarget,
    ),
    coverageTarget: asNumber(row.coverageTarget, fallback.coverageTarget),
    minFindingsToStop: asNumber(
      row.minFindingsToStop,
      fallback.minFindingsToStop,
    ),
  };
}

function coerceOverrides(value: unknown): Record<string, CortexOverride> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return {};
  }
  return value as Record<string, CortexOverride>;
}

function asNumber(value: unknown, fallback: number): number {
  return typeof value === "number" && Number.isFinite(value) ? value : fallback;
}

function asStringArray(value: unknown, fallback: string[]): string[] {
  if (!Array.isArray(value)) return [...fallback];
  return value.filter((item): item is string => typeof item === "string");
}

function actionLabelShort(action: string): string {
  if (action === "thalamus") return "THAL";
  if (action === "sweep-nullscan") return "SWEEP";
  if (action === "fish-swarm") return "BRIEF";
  return action.toUpperCase();
}

function actionLabelLong(action: string): string {
  if (action === "thalamus") return "Thalamus";
  if (action === "sweep-nullscan") return "Sweep null-scan";
  if (action === "fish-swarm") return "Fish briefing";
  return action;
}

function capitalize(value: string): string {
  return value.charAt(0).toUpperCase() + value.slice(1);
}
