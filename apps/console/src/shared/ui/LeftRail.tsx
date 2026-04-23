import { useRouterState } from "@tanstack/react-router";
import { ReactNode } from "react";
import { useUiStore } from "@/shared/ui/uiStore";
import { clsx } from "clsx";
import { PanelLeftClose, PanelLeftOpen } from "lucide-react";
import { useRuntimeConfigList } from "@/features/config/runtime-config";
import { useOpsFilterStore, type RegimeKey } from "@/features/ops/opsFilterStore";

export function LeftRail() {
  const { location } = useRouterState();
  const collapsed = useUiStore((s) => s.railCollapsed);
  const toggle = useUiStore((s) => s.toggleRail);

  const mode = location.pathname.split("/")[1] ?? "ops";

  return (
    <aside
      className={clsx(
        "flex shrink-0 flex-col border-r border-cyan/10 bg-panel/95 transition-[width] duration-med ease-palantir",
        collapsed ? "w-14" : "w-60",
      )}
    >
      <div className="flex h-10 items-center justify-between border-b border-hairline bg-elevated/25 px-3">
        {!collapsed && (
          <span className="label">
            {mode === "config" ? "DOMAINS" : "FILTERS"} · {mode.toUpperCase()}
          </span>
        )}
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
  if (mode === "config") return <ConfigJumpLinks />;
  return null;
}

function ConfigJumpLinks() {
  const { data, isLoading } = useRuntimeConfigList();
  const focusConfigDomain = useUiStore((s) => s.focusConfigDomain);
  if (isLoading || !data) {
    return <div className="p-3 text-caption text-muted">Loading…</div>;
  }
  const grouped = Object.entries(data.domains).reduce<Record<string, string[]>>(
    (acc, [domain]) => {
      const ns = domain.split(".")[0] ?? "other";
      (acc[ns] ??= []).push(domain);
      return acc;
    },
    {},
  );
  const order = ["console", "thalamus", "sim", "sweep"];
  const ordered = [
    ...order.filter((n) => grouped[n]),
    ...Object.keys(grouped).filter((n) => !order.includes(n)).sort(),
  ];

  function jump(domain: string) {
    focusConfigDomain(domain);
  }

  return (
    <div className="space-y-4 p-3">
      {ordered.map((ns) => (
        <section key={ns}>
          <div className="label mb-2">{ns.toUpperCase()}</div>
          <div className="space-y-0.5">
            {grouped[ns]!
              .sort(compareConfigDomains)
              .map((d) => {
                const payload = data.domains[d];
                const nFields = payload
                  ? Object.keys(payload.schema).length
                  : 0;
                const dirty = payload?.hasOverrides;
                const shortName = d.split(".").slice(1).join(".");
                return (
                  <button
                    key={d}
                    onClick={() => jump(d)}
                    className={clsx(
                      "flex w-full items-center justify-between gap-2 px-2 py-1 text-caption mono hover:bg-hairline/40 cursor-pointer text-left",
                      dirty ? "text-amber" : "text-muted hover:text-primary",
                    )}
                  >
                    <span className="truncate">{shortName}</span>
                    <span className="shrink-0 text-numeric opacity-60">
                      {nFields}
                    </span>
                  </button>
                );
              })}
          </div>
        </section>
      ))}
    </div>
  );
}

function compareConfigDomains(a: string, b: string): number {
  const priority = ["console.autonomy", "thalamus.budgets"];
  const aIdx = priority.indexOf(a);
  const bIdx = priority.indexOf(b);
  if (aIdx !== -1 || bIdx !== -1) {
    if (aIdx === -1) return 1;
    if (bIdx === -1) return -1;
    return aIdx - bIdx;
  }
  return a.localeCompare(b);
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
  const regimeVisible = useOpsFilterStore((s) => s.regimeVisible);
  const toggleRegime = useOpsFilterStore((s) => s.toggleRegime);
  const pcExp = useOpsFilterStore((s) => s.pcThresholdExp);
  const setPcExp = useOpsFilterStore((s) => s.setPcThresholdExp);
  const provenance = useOpsFilterStore((s) => s.provenance);
  const toggleProvenance = useOpsFilterStore((s) => s.toggleProvenance);

  const regimes: RegimeKey[] = ["LEO", "MEO", "GEO", "HEO"];
  return (
    <div className="space-y-6 p-3">
      <section>
        <div className="label mb-2">ORBIT REGIME</div>
        <div className="space-y-1">
          {regimes.map((r) => (
            <label key={r} className="flex cursor-pointer items-center gap-2 text-body">
              <input
                type="checkbox"
                checked={regimeVisible[r]}
                onChange={() => toggleRegime(r)}
                className="accent-cyan"
              />
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
            <input
              type="checkbox"
              checked={provenance.osint}
              onChange={() => toggleProvenance("osint")}
              className="accent-cyan"
            />
            <span className="mono text-numeric">OSINT</span>
          </label>
          <label className="flex cursor-pointer items-center gap-2">
            <input
              type="checkbox"
              checked={provenance.field}
              onChange={() => toggleProvenance("field")}
              className="accent-cyan"
            />
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
            <label key={c} className="flex cursor-pointer items-center gap-2">
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
            <label key={e} className="flex cursor-pointer items-center gap-1"><input type="checkbox" defaultChecked className="accent-cyan" /> <span>{e}</span></label>
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
            <label key={s.k} className="flex cursor-pointer items-center gap-2">
              <input type="checkbox" defaultChecked className="accent-cyan" />
              <span className={clsx("mono text-caption", s.c)}>{s.k}</span>
            </label>
          ))}
        </div>
      </section>
      <section>
        <div className="label mb-2">PRIORITY</div>
        <input type="range" min={0} max={100} defaultValue={50} className="w-full cursor-pointer accent-cyan" />
      </section>
    </div>
  );
}
