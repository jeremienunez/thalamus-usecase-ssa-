import type { DispatchResult } from "@/types/repl-turn";

export function ClarifyRender({
  r,
  onFollowUp,
}: {
  r: Extract<DispatchResult, { kind: "clarify" }>;
  onFollowUp: (input: string) => void;
}) {
  return (
    <div className="flex flex-col gap-1 border border-hairline bg-elevated p-2">
      <div className="mono text-caption text-amber">? {r.question}</div>
      <div className="flex flex-wrap gap-2">
        {r.options.map((opt) => (
          <button
            key={opt}
            onClick={() => onFollowUp(`/${opt} `)}
            className="mono border border-hairline bg-hover px-2 py-1 text-caption text-primary hover:border-cyan"
          >
            /{opt}
          </button>
        ))}
      </div>
    </div>
  );
}
