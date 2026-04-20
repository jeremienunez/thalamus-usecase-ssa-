import { JsonTextarea } from "../JsonTextarea";
import {
  CORTEX_SNIPPETS,
  coerceOverrides,
} from "../config-domain.service";
import {
  DecisionCard,
  DecisionSidebar,
  DecisionStep,
  TreeLine,
} from "../config-primitives";
import type { DomainEditorLeafProps } from "./types";

export function CortexOverridesEditor({
  draft,
  setField,
  errors,
}: DomainEditorLeafProps) {
  const overrides = coerceOverrides(draft.overrides);
  const activeNames = Object.keys(overrides);

  return (
    <div className="space-y-4 p-4">
      <div className="space-y-4">
        <DecisionStep
          index={1}
          title="Override only the outliers"
          description="Use the shared operating defaults first. Per-cortex overrides are for isolated exceptions."
        >
          <div className="grid gap-2 grid-cols-1">
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
              <div className="mono text-body text-primary">Advanced override map</div>
              <div className="text-caption text-muted">
                Fields omitted here keep the shared defaults.
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
          {errors.overrides && <div className="mt-2 text-caption text-hot">{errors.overrides}</div>}
        </div>
      </div>

      <DecisionSidebar
        eyebrow="Decision tree"
        title="Per-cortex escape hatch"
        body="1. Adjust the shared defaults if the problem is global. 2. Tune budgets if the issue is cost or depth. 3. Override a single cortex only when one lane is the outlier."
      >
        <TreeLine active={activeNames.length === 0} label="shared defaults first" />
        <TreeLine
          active={activeNames.length > 0}
          label={activeNames.length > 0 ? `${activeNames.length} cortex override active` : "no overrides active"}
        />
      </DecisionSidebar>
    </div>
  );
}
