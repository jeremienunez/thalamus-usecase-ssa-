import { clsx } from "clsx";
import type { BriefingFinding, DispatchResult } from "@/features/repl/types";
import { confidenceBar } from "@/shared/ui/sparkline";

const DOT_COLOR: Record<BriefingFinding["sourceClass"], string> = {
  field: "text-cold",
  osint: "text-amber",
  derived: "text-dim",
};

export function BriefingRender({
  r,
  onFollowUp,
}: {
  r: Extract<DispatchResult, { kind: "briefing" }>;
  onFollowUp: (input: string) => void;
}) {
  return (
    <div className="flex flex-col gap-2 border border-hairline bg-elevated p-2">
      <div className="border-l-2 border-cyan pl-2 text-caption text-muted italic">
        {r.executiveSummary}
      </div>
      <div className="flex flex-col gap-1">
        {r.findings.map((f) => (
          <div key={f.id} className="mono flex items-center gap-2 text-caption">
            <span className={clsx(DOT_COLOR[f.sourceClass])}>●</span>
            <span className="text-primary">{f.id}</span>
            <span className={clsx(DOT_COLOR[f.sourceClass])}>{f.sourceClass}</span>
            <span className={clsx(DOT_COLOR[f.sourceClass])}>{confidenceBar(f.confidence)}</span>
            <span className="text-muted">{f.summary}</span>
            <span className="text-dim">({f.evidenceRefs.join(", ")})</span>
          </div>
        ))}
      </div>
      {r.recommendedActions.length > 0 && (
        <div className="flex flex-col gap-0.5">
          <div className="mono text-caption text-cyan">Recommended actions</div>
          {r.recommendedActions.map((a, i) => (
            <button
              key={i}
              onClick={() => onFollowUp(a)}
              className="mono text-left text-caption text-primary hover:text-cyan"
            >
              → {a}
            </button>
          ))}
        </div>
      )}
      {r.followUpPrompts.length > 0 && (
        <div className="flex flex-col gap-0.5">
          <div className="mono text-caption text-dim">Try next</div>
          {r.followUpPrompts.map((q, i) => (
            <button
              key={i}
              onClick={() => onFollowUp(q)}
              className="mono text-left text-caption text-muted hover:text-primary"
            >
              • {q}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
