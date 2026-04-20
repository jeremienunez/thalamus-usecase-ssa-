import { AutonomyDecisionEditor } from "./editors/AutonomyDecisionEditor";
import { BudgetsDecisionEditor } from "./editors/BudgetsDecisionEditor";
import { CortexOverridesEditor } from "./editors/CortexOverridesEditor";
import { GenericFieldList } from "./editors/GenericFieldList";
import type { DomainEditorProps } from "./editors/types";

export type { DomainEditorProps } from "./editors/types";

export function DomainEditor(props: DomainEditorProps) {
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
