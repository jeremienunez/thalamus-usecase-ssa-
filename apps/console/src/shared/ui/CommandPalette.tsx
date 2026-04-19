import { useEffect, useId, useMemo, useRef, useState } from "react";
import { useNavigate } from "@tanstack/react-router";
import { Search, Globe2, Network, Radar, Activity } from "lucide-react";
import { clsx } from "clsx";
import { useRepl } from "@/features/repl/ReplContext";

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
  const [activeIdx, setActiveIdx] = useState(0);
  const navigate = useNavigate();
  const { sendTurn } = useRepl();
  const inputRef = useRef<HTMLInputElement | null>(null);
  const returnFocusRef = useRef<HTMLElement | null>(null);
  const listboxId = useId();
  const optionId = (i: number) => `${listboxId}-opt-${i}`;

  const actions = useMemo<Action[]>(
    () => [
      { id: "ops", label: "Go to OPS", hint: "⌘1", icon: Globe2, run: () => navigate({ to: "/ops" }) },
      { id: "thalamus", label: "Go to THALAMUS", hint: "⌘2", icon: Network, run: () => navigate({ to: "/thalamus" }) },
      { id: "sweep", label: "Go to SWEEP", hint: "⌘3", icon: Radar, run: () => navigate({ to: "/sweep" }) },
      { id: "status", label: "System status", hint: "⌘.", icon: Activity, run: () => navigate({ to: "/" }) },
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
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, navigate]);

  // Focus management on open/close
  useEffect(() => {
    if (open) {
      returnFocusRef.current = document.activeElement as HTMLElement | null;
      setActiveIdx(0);
      requestAnimationFrame(() => inputRef.current?.focus());
    } else if (returnFocusRef.current && document.contains(returnFocusRef.current)) {
      returnFocusRef.current.focus();
    }
  }, [open]);

  const filtered = useMemo(
    () => actions.filter((a) => a.label.toLowerCase().includes(q.toLowerCase())),
    [actions, q],
  );

  // Reset active index when filter changes
  useEffect(() => {
    setActiveIdx(0);
  }, [q]);

  if (!open) return null;

  const trimmed = q.trim();
  const showAskFallback = filtered.length === 0 && trimmed.length > 0;
  const optionsCount = showAskFallback ? 1 : filtered.length;

  const runActive = () => {
    if (trimmed.startsWith("/")) {
      sendTurn(trimmed);
      setQ("");
      setOpen(false);
      return;
    }
    if (showAskFallback) {
      sendTurn(trimmed);
      setQ("");
      setOpen(false);
      return;
    }
    const a = filtered[activeIdx];
    if (a) {
      a.run();
      setOpen(false);
    }
  };

  const onInputKey = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Escape") {
      e.preventDefault();
      setOpen(false);
      return;
    }
    if (e.key === "Tab") {
      // Trap focus inside the palette — input is the only focusable element.
      e.preventDefault();
      return;
    }
    if (e.key === "Enter") {
      e.preventDefault();
      if (!trimmed) return;
      runActive();
      return;
    }
    if (optionsCount === 0) return;
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setActiveIdx((i) => (i + 1) % optionsCount);
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setActiveIdx((i) => (i - 1 + optionsCount) % optionsCount);
    } else if (e.key === "Home") {
      e.preventDefault();
      setActiveIdx(0);
    } else if (e.key === "End") {
      e.preventDefault();
      setActiveIdx(optionsCount - 1);
    }
  };

  return (
    <div
      className="fixed inset-0 z-palette flex items-start justify-center bg-base/80 pt-[20vh] animate-fade-in backdrop-blur-sm"
      onClick={() => setOpen(false)}
      role="presentation"
    >
      <div
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-modal="true"
        aria-label="Command palette"
        className="w-[560px] border border-hairline-hot bg-elevated shadow-pop"
      >
        <div className="flex h-11 items-center gap-3 border-b border-hairline px-3">
          <Search size={14} strokeWidth={1.5} className="text-muted" />
          <input
            ref={inputRef}
            value={q}
            onChange={(e) => setQ(e.target.value)}
            onKeyDown={onInputKey}
            role="combobox"
            aria-expanded="true"
            aria-controls={listboxId}
            aria-activedescendant={optionsCount > 0 ? optionId(activeIdx) : undefined}
            aria-autocomplete="list"
            placeholder="Command, search, or ask the assistant..."
            className="w-full bg-transparent text-body text-primary placeholder:text-dim focus:outline-none"
          />
          <span className="mono text-caption text-dim">ESC</span>
        </div>
        <ul
          id={listboxId}
          role="listbox"
          aria-label="Available commands"
          className="max-h-[320px] overflow-y-auto py-1"
        >
          {showAskFallback && (
            <li
              id={optionId(0)}
              role="option"
              aria-selected={activeIdx === 0}
              onMouseEnter={() => setActiveIdx(0)}
              onClick={() => {
                sendTurn(trimmed);
                setQ("");
                setOpen(false);
              }}
              className={clsx(
                "flex h-9 w-full cursor-pointer items-center justify-between px-3 text-left text-body transition-colors duration-fast ease-palantir hover:bg-hover",
                activeIdx === 0 && "bg-hover",
              )}
            >
              <span className="flex items-center gap-3">
                <Search size={14} strokeWidth={1.5} className="text-muted" />
                <span className="text-primary">
                  Ask assistant: <span className="text-cyan">{trimmed}</span>
                </span>
              </span>
              <span className="mono text-caption text-dim">↵</span>
            </li>
          )}
          {!showAskFallback && filtered.length === 0 && !trimmed && (
            <li className="px-3 py-6 text-center text-caption text-dim" aria-disabled="true">
              type a command or question
            </li>
          )}
          {!showAskFallback &&
            filtered.map((a, i) => {
              const Icon = a.icon;
              const active = i === activeIdx;
              return (
                <li
                  key={a.id}
                  id={optionId(i)}
                  role="option"
                  aria-selected={active}
                  onMouseEnter={() => setActiveIdx(i)}
                  onClick={() => {
                    a.run();
                    setOpen(false);
                  }}
                  className={clsx(
                    "flex h-9 w-full cursor-pointer items-center justify-between px-3 text-left text-body transition-colors duration-fast ease-palantir hover:bg-hover",
                    active && "bg-hover",
                  )}
                >
                  <span className="flex items-center gap-3">
                    <Icon size={14} strokeWidth={1.5} className="text-muted" />
                    <span className="text-primary">{a.label}</span>
                  </span>
                  <span className="mono text-caption text-dim">{a.hint}</span>
                </li>
              );
            })}
        </ul>
        <div className="flex h-7 items-center justify-between border-t border-hairline px-3 mono text-caption text-dim">
          <span>↑↓ navigate · ↵ run · ESC close</span>
          <span>Cmd+K to toggle</span>
        </div>
      </div>
    </div>
  );
}
