import { StringArrayInput } from "../StringArrayInput";
import {
  actionLabelLong,
  actionLabelShort,
  AUTONOMY_ACTION_CHOICES,
  CADENCE_PRESETS,
  cadencePresetId,
  coerceAutonomyConfig,
  detectGuardrailMode,
  fmtUsd,
  type GuardrailMode,
  GUARDRAIL_PRESETS,
  ROTATION_PRESETS,
  rotationPresetId,
} from "../config-domain.service";
import {
  DecisionCard,
  DecisionSidebar,
  DecisionStep,
  NumberField,
  ToggleCard,
  TreeLine,
} from "../config-primitives";
import { GenericFieldList } from "./GenericFieldList";
import type { DomainEditorLeafProps } from "./types";

export function AutonomyDecisionEditor({
  payload,
  draft,
  setField,
  errors,
}: DomainEditorLeafProps) {
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
        cfg.monthlyBudgetUsd > 0 ? cfg.monthlyBudgetUsd : defaults.monthlyBudgetUsd,
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
      cfg.monthlyBudgetUsd > 0 ? cfg.monthlyBudgetUsd : defaults.monthlyBudgetUsd,
    );
    setField(
      "maxThalamusCyclesPerDay",
      cfg.maxThalamusCyclesPerDay > 0 ? cfg.maxThalamusCyclesPerDay : 24,
    );
    setField("stopOnBudgetExhausted", true);
  }

  return (
    <div className="space-y-4 p-4">
      <div className="space-y-4">
        <div className="space-y-4">
          <DecisionStep
            index={1}
            title="Loop cadence"
            description="Choose how aggressively the autonomy loop wakes up."
          >
            <div className="grid gap-2 grid-cols-3">
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
            <div className="grid gap-2 grid-cols-2">
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
                <label className="mb-2 block mono text-caption text-dim">Ordered rotation</label>
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
            <div className="grid gap-2 grid-cols-2">
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
            <div className="grid gap-3 grid-cols-1">
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
                  onChange={(value) => setField("maxThalamusCyclesPerDay", value)}
                />
              )}
              {(guardrailMode === "budget" || guardrailMode === "mixed") && (
                <ToggleCard
                  label="Stop on budget exhaustion"
                  description="If disabled, budgets are still tracked but won’t halt the loop."
                  checked={cfg.stopOnBudgetExhausted}
                  onChange={(checked) => setField("stopOnBudgetExhausted", checked)}
                />
              )}
            </div>
            {errors.dailyBudgetUsd && <div className="text-caption text-hot">{errors.dailyBudgetUsd}</div>}
          </DecisionStep>
        </div>

        <div className="space-y-4">
          <DecisionSidebar
            eyebrow="Decision tree"
            title="Autonomy runtime"
            body="Pick a cadence, choose the loop path, then add only the guardrails you actually need."
          >
            <TreeLine active label={`wake every ${cfg.intervalSec}s`} />
            <TreeLine active label={cfg.rotation.map(actionLabelLong).join(" → ")} />
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
            <summary className="cursor-pointer px-4 py-3 mono text-caption text-dim">advanced fields</summary>
            <GenericFieldList
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
