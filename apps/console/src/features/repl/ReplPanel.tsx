import { useEffect, useRef, useState } from "react";
import { useNavigate } from "@tanstack/react-router";
import { X, Terminal } from "lucide-react";
import { AnimatedStepBadge } from "@/shared/ui/AnimatedStepBadge";
import type { BriefingUiAction } from "@/features/repl/types";
import { useUiStore } from "@/shared/ui/uiStore";
import { useRepl } from "./ReplContext";
import { TurnView } from "./TurnView";

export function ReplPanel() {
  const navigate = useNavigate();
  const { open, setOpen, turns, inFlight, sendTurn, runFollowUp, cancelTurn } =
    useRepl();
  const setAutonomyFeedOpen = useUiStore((s) => s.setAutonomyFeedOpen);
  const focusConfigDomain = useUiStore((s) => s.focusConfigDomain);
  const [input, setInput] = useState("");
  const scrollRef = useRef<HTMLDivElement | null>(null);
  const returnFocusRef = useRef<HTMLElement | null>(null);

  useEffect(() => {
    if (open) {
      returnFocusRef.current = document.activeElement as HTMLElement | null;
    } else if (returnFocusRef.current && document.contains(returnFocusRef.current)) {
      returnFocusRef.current.focus();
    }
  }, [open]);

  if (!open) return null;

  const handleUiAction = (action: BriefingUiAction) => {
    if (action.kind === "open_feed") {
      setAutonomyFeedOpen(true);
      setOpen(false);
      return;
    }
    focusConfigDomain(action.domain);
    setOpen(false);
    void navigate({ to: "/config" });
  };

  const submit = () => {
    if (!input.trim()) return;
    sendTurn(input);
    setInput("");
    requestAnimationFrame(() => {
      scrollRef.current?.scrollTo({
        top: scrollRef.current.scrollHeight,
        behavior: "smooth",
      });
    });
  };

  return (
    <div
      className="fixed inset-x-0 bottom-0 z-hud animate-fade-in border-t border-hairline-hot bg-panel/95 shadow-pop backdrop-blur-md"
      style={{ height: "40vh" }}
    >
      <div className="flex h-9 items-center gap-3 border-b border-hairline px-3">
        <Terminal size={13} strokeWidth={1.5} className="text-muted" />
        <span className="mono text-caption uppercase tracking-wider text-muted">
          REPL
        </span>
        {inFlight > 0 && (
          <span className="mono text-caption text-cyan">
            <AnimatedStepBadge step="cycle" phase="progress" />{" "}
            {inFlight === 1 ? "running" : `${inFlight} running`}
          </span>
        )}
        <span className="ml-auto mono text-caption text-dim">
          {turns.length} turn(s)
        </span>
        <button
          onClick={() => setOpen(false)}
          className="cursor-pointer text-muted transition-colors duration-fast ease-palantir hover:text-primary"
          aria-label="Close REPL"
          title="Close (Esc)"
        >
          <X size={14} />
        </button>
      </div>

      <div ref={scrollRef} className="h-[calc(40vh-72px)] overflow-y-auto px-3 py-2">
        {turns.length === 0 && (
          <div className="mono text-caption text-dim">
            Enter a slash command (e.g. <code>/query riskiest conjunction</code>) or a
            natural-language prompt.
          </div>
        )}
        {turns.map((t) => (
          <TurnView
            key={t.id}
            turn={t}
            onFollowUp={sendTurn}
            onUiAction={handleUiAction}
            onRunFollowUp={runFollowUp}
            onCancel={() => cancelTurn(t.id)}
          />
        ))}
      </div>

      <div className="flex h-8 items-center gap-2 border-t border-hairline px-3">
        <span className="mono text-caption text-cyan">&gt;</span>
        <input
          autoFocus
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              submit();
            }
            if (e.key === "Escape") {
              e.preventDefault();
              setOpen(false);
            }
          }}
          placeholder="type a slash command or free-text prompt..."
          className="mono h-full w-full bg-transparent text-caption text-primary placeholder:text-dim focus:outline-none"
        />
        <span className="mono text-caption text-dim">↵ run · ESC close</span>
      </div>
    </div>
  );
}
