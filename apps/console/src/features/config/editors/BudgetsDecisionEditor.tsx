import {
  applyBudgetProfile,
  BUDGET_PROFILES,
  budgetProfileId,
  capitalize,
  coerceBudgetConfig,
  fmtUsd,
  type BudgetRow,
} from "../config-domain.service";
import {
  DecisionCard,
  DecisionSidebar,
  DecisionStep,
  NumberField,
  RangeField,
  TreeLine,
} from "../config-primitives";
import { GenericFieldList } from "./GenericFieldList";
import type { DomainEditorLeafProps } from "./types";

export function BudgetsDecisionEditor({
  payload,
  draft,
  setField,
  errors,
}: DomainEditorLeafProps) {
  const cfg = coerceBudgetConfig(draft);
  const activeProfile = budgetProfileId(cfg);

  return (
    <div className="space-y-4 p-4">
      <div className="space-y-4">
        <div className="space-y-4">
          <DecisionStep
            index={1}
            title="Operating profile"
            description="Set the overall chain depth before fine-tuning each lane."
          >
            <div className="grid gap-2 grid-cols-3">
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
            description="Tune each complexity lane directly instead of editing a generic payload."
          >
            <div className="grid gap-3 grid-cols-1">
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
            <TreeLine active label={`simple ${fmtUsd(cfg.simple.maxCost)} · ${cfg.simple.maxIterations} iter`} />
            <TreeLine active label={`moderate ${fmtUsd(cfg.moderate.maxCost)} · ${cfg.moderate.maxIterations} iter`} />
            <TreeLine active label={`deep ${fmtUsd(cfg.deep.maxCost)} · ${cfg.deep.maxIterations} iter`} />
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
      {Object.values(errors).length > 0 && (
        <div className="text-caption text-hot">{Object.values(errors).join(" · ")}</div>
      )}
    </div>
  );
}

export function BudgetTierCard(props: {
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
          <div className={`mono text-body uppercase ${props.tone}`}>{props.level}</div>
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
          onChange={(value) => props.onChange({ ...props.row, maxIterations: Math.round(value) })}
        />
        <RangeField
          id={`${prefix}-confidence`}
          label={`${capitalize(prefix)} confidence target`}
          hint="Stop once confidence crosses this bar."
          value={props.row.confidenceTarget}
          min={0}
          max={1}
          step={0.05}
          onChange={(value) => props.onChange({ ...props.row, confidenceTarget: value })}
        />
        <RangeField
          id={`${prefix}-coverage`}
          label={`${capitalize(prefix)} coverage target`}
          hint="Expected source / hypothesis coverage."
          value={props.row.coverageTarget}
          min={0}
          max={1}
          step={0.05}
          onChange={(value) => props.onChange({ ...props.row, coverageTarget: value })}
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
