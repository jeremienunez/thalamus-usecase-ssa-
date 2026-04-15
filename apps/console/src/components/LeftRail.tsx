import { useRouterState } from "@tanstack/react-router";
import { ReactNode, useState } from "react";
import { useUiStore } from "@/lib/uiStore";
import { clsx } from "clsx";
import { PanelLeftClose, PanelLeftOpen } from "lucide-react";

export function LeftRail() {
  const { location } = useRouterState();
  const collapsed = useUiStore((s) => s.railCollapsed);
  const toggle = useUiStore((s) => s.toggleRail);

  const mode = location.pathname.split("/")[1] ?? "ops";

  return (
    <aside
      className={clsx(
        "flex shrink-0 flex-col border-r border-hairline bg-panel transition-[width] duration-med ease-palantir",
        collapsed ? "w-14" : "w-60",
      )}
    >
      <div className="flex h-10 items-center justify-between border-b border-hairline px-3">
        {!collapsed && <span className="label">FILTERS · {mode.toUpperCase()}</span>}
        <button
          onClick={toggle}
          aria-label={collapsed ? "Expand rail" : "Collapse rail"}
          className="flex h-7 w-7 items-center justify-center text-muted hover:text-primary cursor-pointer"
        >
          {collapsed ? (
            <PanelLeftOpen size={14} strokeWidth={1.5} />
          ) : (
            <PanelLeftClose size={14} strokeWidth={1.5} />
          )}
        </button>
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto">
        {!collapsed && <RailContent mode={mode} />}
      </div>
    </aside>
  );
}

function RailContent({ mode }: { mode: string }): ReactNode {
  if (mode === "ops") return <OpsFilters />;
  if (mode === "thalamus") return <ThalamusFilters />;
  if (mode === "sweep") return <SweepFilters />;
  return null;
}

const SUPERSCRIPT: Record<string, string> = {
  "-": "⁻",
  "0": "⁰",
  "1": "¹",
  "2": "²",
  "3": "³",
  "4": "⁴",
  "5": "⁵",
  "6": "⁶",
  "7": "⁷",
  "8": "⁸",
  "9": "⁹",
  ".": "·",
};
function sup(s: string): string {
  return s
    .split("")
    .map((c) => SUPERSCRIPT[c] ?? c)
    .join("");
}

function OpsFilters() {
  const [pcExp, setPcExp] = useState(-4);
  return (
    <div className="space-y-6 p-3">
      <section>
        <div className="label mb-2">ORBIT REGIME</div>
        <div className="space-y-1">
          {["LEO", "MEO", "GEO", "HEO"].map((r) => (
            <label key={r} className="flex cursor-pointer items-center gap-2 text-body">
              <input type="checkbox" defaultChecked className="accent-cyan" />
              <span className="mono text-numeric">{r}</span>
            </label>
          ))}
        </div>
      </section>
      <section>
        <div className="label mb-2">P(C) THRESHOLD</div>
        <input
          type="range"
          min={-8}
          max={-2}
          step={0.5}
          value={pcExp}
          onChange={(e) => setPcExp(parseFloat(e.target.value))}
          className="w-full accent-cyan cursor-pointer"
        />
        <div className="mono text-caption text-muted tabular-nums">
          ≥ 10{sup(pcExp.toString())}
        </div>
      </section>
      <section>
        <div className="label mb-2">PROVENANCE</div>
        <div className="space-y-1 text-body">
          <label className="flex cursor-pointer items-center gap-2">
            <input type="checkbox" defaultChecked className="accent-cyan" />
            <span className="mono text-numeric">OSINT</span>
          </label>
          <label className="flex cursor-pointer items-center gap-2">
            <input type="checkbox" defaultChecked className="accent-cyan" />
            <span className="mono text-numeric">FIELD</span>
          </label>
        </div>
      </section>
    </div>
  );
}

function ThalamusFilters() {
  return (
    <div className="space-y-6 p-3">
      <section>
        <div className="label mb-2">CORTEX</div>
        <div className="space-y-1 text-body">
          {["catalog", "observations", "conjunction-analysis", "correlation", "maneuver-planning"].map((c) => (
            <label key={c} className="flex items-center gap-2">
              <input type="checkbox" defaultChecked className="accent-cyan" />
              <span className="mono text-caption text-numeric">{c}</span>
            </label>
          ))}
        </div>
      </section>
      <section>
        <div className="label mb-2">ENTITY CLASS</div>
        <div className="grid grid-cols-2 gap-1 text-caption">
          {["Satellite", "Debris", "Operator", "Payload", "Regime", "Event", "Maneuver"].map((e) => (
            <label key={e} className="flex items-center gap-1"><input type="checkbox" defaultChecked className="accent-cyan" /> <span>{e}</span></label>
          ))}
        </div>
      </section>
    </div>
  );
}

function SweepFilters() {
  return (
    <div className="space-y-6 p-3">
      <section>
        <div className="label mb-2">STATUS</div>
        <div className="space-y-1 text-body">
          {[
            { k: "pending", c: "text-amber" },
            { k: "accepted", c: "text-cyan" },
            { k: "rejected", c: "text-hot" },
            { k: "in-review", c: "text-muted" },
          ].map((s) => (
            <label key={s.k} className="flex items-center gap-2">
              <input type="checkbox" defaultChecked className="accent-cyan" />
              <span className={clsx("mono text-caption", s.c)}>{s.k}</span>
            </label>
          ))}
        </div>
      </section>
      <section>
        <div className="label mb-2">PRIORITY</div>
        <input type="range" min={0} max={100} defaultValue={50} className="w-full accent-cyan" />
      </section>
    </div>
  );
}
