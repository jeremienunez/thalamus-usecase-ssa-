import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "@tanstack/react-router";
import { Search, Globe2, Network, Radar, Activity } from "lucide-react";
import { clsx } from "clsx";
import { useRepl } from "./ReplPanel";

type Action = {
  id: string;
  label: string;
  hint: string;
  icon: typeof Search;
  run: () => void;
};

export function CommandPalette() {
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState("");
  const navigate = useNavigate();
  const { sendTurn } = useRepl();

  const actions = useMemo<Action[]>(
    () => [
      { id: "ops", label: "Go to OPS", hint: "⌘1", icon: Globe2, run: () => navigate({ to: "/ops" }) },
      { id: "thalamus", label: "Go to THALAMUS", hint: "⌘2", icon: Network, run: () => navigate({ to: "/thalamus" }) },
      { id: "sweep", label: "Go to SWEEP", hint: "⌘3", icon: Radar, run: () => navigate({ to: "/sweep" }) },
      { id: "status", label: "System status", hint: "⌘.", icon: Activity, run: () => console.log("status") },
    ],
    [navigate],
  );

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const meta = e.metaKey || e.ctrlKey;
      if (meta && e.key === "k") {
        e.preventDefault();
        setOpen((v) => !v);
        return;
      }
      if (!open) {
        if (meta && e.key === "1") { e.preventDefault(); navigate({ to: "/ops" }); }
        if (meta && e.key === "2") { e.preventDefault(); navigate({ to: "/thalamus" }); }
        if (meta && e.key === "3") { e.preventDefault(); navigate({ to: "/sweep" }); }
      }
      if (open && e.key === "Escape") setOpen(false);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, navigate]);

  const filtered = actions.filter((a) => a.label.toLowerCase().includes(q.toLowerCase()));

  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-40 flex items-start justify-center bg-base/80 pt-[20vh] backdrop-blur-sm"
      onClick={() => setOpen(false)}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        className="w-[560px] border border-hairline-hot bg-elevated"
      >
        <div className="flex h-11 items-center gap-3 border-b border-hairline px-3">
          <Search size={14} strokeWidth={1.5} className="text-muted" />
          <input
            autoFocus
            value={q}
            onChange={(e) => setQ(e.target.value)}
            onKeyDown={(e) => {
              if (e.key !== "Enter") return;
              const trimmed = q.trim();
              if (!trimmed) return;
              e.preventDefault();
              // slash-command → REPL turn
              if (trimmed.startsWith("/")) {
                sendTurn(trimmed);
                setQ("");
                setOpen(false);
                return;
              }
              // action match? run the top one
              if (filtered.length > 0) {
                filtered[0]!.run();
                setOpen(false);
                return;
              }
              // fallback: anything non-matching → ask the assistant
              sendTurn(trimmed);
              setQ("");
              setOpen(false);
            }}
            placeholder="Command, search, or ask the assistant..."
            className="w-full bg-transparent text-body text-primary placeholder:text-dim focus:outline-none"
          />
          <span className="mono text-caption text-dim">ESC</span>
        </div>
        <div className="max-h-[320px] overflow-y-auto py-1">
          {filtered.length === 0 && q.trim() && (
            <button
              onClick={() => { sendTurn(q.trim()); setQ(""); setOpen(false); }}
              className="flex h-9 w-full items-center justify-between px-3 text-left text-body hover:bg-hover cursor-pointer bg-hover"
            >
              <span className="flex items-center gap-3">
                <Search size={14} strokeWidth={1.5} className="text-muted" />
                <span className="text-primary">Ask assistant: <span className="text-cyan">{q.trim()}</span></span>
              </span>
              <span className="mono text-caption text-dim">↵</span>
            </button>
          )}
          {filtered.length === 0 && !q.trim() && (
            <div className="px-3 py-6 text-center text-caption text-dim">type a command or question</div>
          )}
          {filtered.map((a, i) => {
            const Icon = a.icon;
            return (
              <button
                key={a.id}
                onClick={() => { a.run(); setOpen(false); }}
                className={clsx(
                  "flex h-9 w-full items-center justify-between px-3 text-left text-body hover:bg-hover cursor-pointer",
                  i === 0 && "bg-hover",
                )}
              >
                <span className="flex items-center gap-3">
                  <Icon size={14} strokeWidth={1.5} className="text-muted" />
                  <span className="text-primary">{a.label}</span>
                </span>
                <span className="mono text-caption text-dim">{a.hint}</span>
              </button>
            );
          })}
        </div>
        <div className="flex h-7 items-center justify-between border-t border-hairline px-3 mono text-caption text-dim">
          <span>↵ to run · ? to clarify</span>
          <span>Cmd+K to toggle</span>
        </div>
      </div>
    </div>
  );
}
