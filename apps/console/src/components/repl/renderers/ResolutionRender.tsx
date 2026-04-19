import { CheckCircle2 } from "lucide-react";
import type { DispatchResult } from "@/lib/repl";

export function ResolutionRender({
  r,
}: {
  r: Extract<DispatchResult, { kind: "resolution" }>;
}) {
  return (
    <div className="flex items-center gap-2 border border-hairline bg-elevated p-2">
      <CheckCircle2 size={14} className={r.ok ? "text-cold" : "text-hot"} />
      <span className="mono text-caption text-primary">{r.suggestionId}</span>
      <span className="mono text-caption text-cold">accepted</span>
      <span className="mono text-caption text-dim">delta.findingId = {r.delta.findingId}</span>
    </div>
  );
}
