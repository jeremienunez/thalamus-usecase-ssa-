import type { DispatchResult } from "@/lib/repl";

export function ChatRender({ r }: { r: Extract<DispatchResult, { kind: "chat" }> }) {
  return (
    <div className="border-l-2 border-cyan pl-3">
      <div className="whitespace-pre-wrap text-body text-primary">{r.text}</div>
      <div className="mt-1 mono text-caption text-dim">assistant · {r.provider}</div>
    </div>
  );
}
