import { useState, useMemo, useEffect, useRef } from "react";
import { Search } from "lucide-react";
import { clsx } from "clsx";
import type { SatelliteDto } from "@/dto/http";

/**
 * HUD search panel — filter satellites by name or NORAD id as you type,
 * pick to focus the camera on the chosen target.
 *
 * Matches are scored by (starts-with > includes) on both name and NORAD
 * string, capped at 8 results to keep the dropdown under the fold.
 */
export function SatelliteSearch({
  satellites,
  onPick,
}: {
  satellites: SatelliteDto[];
  onPick: (sat: SatelliteDto) => void;
}) {
  const [query, setQuery] = useState("");
  const [open, setOpen] = useState(false);
  const [activeIdx, setActiveIdx] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);

  const matches = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return [];
    const results: Array<{ sat: SatelliteDto; rank: number }> = [];
    for (const sat of satellites) {
      const name = sat.name.toLowerCase();
      const norad = String(sat.noradId);
      let rank: number | null = null;
      if (name.startsWith(q)) rank = 0;
      else if (norad.startsWith(q)) rank = 1;
      else if (name.includes(q)) rank = 2;
      else if (norad.includes(q)) rank = 3;
      if (rank != null) results.push({ sat, rank });
    }
    results.sort(
      (a, b) => a.rank - b.rank || a.sat.name.localeCompare(b.sat.name),
    );
    return results.slice(0, 8).map((r) => r.sat);
  }, [query, satellites]);

  useEffect(() => {
    setActiveIdx(0);
  }, [query]);

  // Global `/` shortcut — focus the input without needing to click.
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === "/" && !(e.target as HTMLElement).matches?.("input, textarea")) {
        e.preventDefault();
        inputRef.current?.focus();
        setOpen(true);
      }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, []);

  // Click-outside closes the dropdown.
  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (!containerRef.current?.contains(e.target as Node)) setOpen(false);
    };
    window.addEventListener("mousedown", handler);
    return () => window.removeEventListener("mousedown", handler);
  }, []);

  const commit = (sat: SatelliteDto) => {
    onPick(sat);
    setQuery("");
    setOpen(false);
    inputRef.current?.blur();
  };

  const onKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setActiveIdx((i) => Math.min(matches.length - 1, i + 1));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setActiveIdx((i) => Math.max(0, i - 1));
    } else if (e.key === "Enter" && matches[activeIdx]) {
      e.preventDefault();
      commit(matches[activeIdx]);
    } else if (e.key === "Escape") {
      setQuery("");
      setOpen(false);
      inputRef.current?.blur();
    }
  };

  return (
    <div
      ref={containerRef}
      className="pointer-events-auto relative z-10 w-[280px]"
    >
      <div className="flex items-center gap-2 border border-hairline bg-panel/90 px-2 py-1 backdrop-blur-sm">
        <Search className="h-3 w-3 text-dim" />
        <input
          ref={inputRef}
          value={query}
          onChange={(e) => {
            setQuery(e.target.value);
            setOpen(true);
          }}
          onFocus={() => query && setOpen(true)}
          onKeyDown={onKeyDown}
          placeholder="search satellite / norad ( / )"
          className="mono h-5 w-full bg-transparent text-micro text-numeric placeholder-dim outline-none"
          spellCheck={false}
          autoComplete="off"
        />
        {query && (
          <span className="mono text-nano text-dim">{matches.length}</span>
        )}
      </div>

      {open && matches.length > 0 && (
        <div className="absolute left-0 right-0 top-full z-20 mt-1 border border-hairline bg-panel/95 shadow-elevated backdrop-blur-sm">
          {matches.map((sat, i) => (
            <button
              key={sat.id}
              type="button"
              onMouseEnter={() => setActiveIdx(i)}
              onClick={() => commit(sat)}
              className={clsx(
                "flex w-full items-baseline justify-between gap-3 px-2 py-1 text-left",
                i === activeIdx ? "bg-hairline/50" : "hover:bg-hairline/30",
              )}
            >
              <span className="mono truncate text-micro text-numeric">
                {sat.name}
              </span>
              <span className="mono flex-shrink-0 text-nano text-dim">
                NORAD {sat.noradId} · {sat.regime}
                {typeof sat.opacityScore === "number" && sat.opacityScore > 0 && (
                  <span className="ml-1 text-cyan">
                    gap {sat.opacityScore.toFixed(2)}
                  </span>
                )}
              </span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
