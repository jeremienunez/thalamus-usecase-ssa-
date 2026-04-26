import { useMemo, useState, type ReactNode } from "react";
import type {
  FishSceneClusterFilter,
  FishSceneFilters,
  FishSceneModel,
  FishSceneNode,
  FishSceneStatusFilter,
  FishSceneTerminalFilter,
} from "./fish-scene-model";
import {
  useOperatorFishTimelineQuery,
  useSimReviewEvidenceQuery,
  useSimReviewQuestionMutation,
} from "@/usecases";

type AskScope = "swarm" | "fish" | "cluster";

// ---------- Filters panel (left rail) ----------

export function FishFiltersPanel({
  swarmId,
  model,
  filters,
  onFiltersChange,
  onClearAll,
}: {
  swarmId: string;
  model: FishSceneModel | null;
  filters: FishSceneFilters;
  onFiltersChange: (f: FishSceneFilters) => void;
  onClearAll: () => void;
}) {
  if (!model) {
    return (
      <Card>
        <h2 className="text-sm font-semibold tracking-tight text-slate-900">Swarm Operator</h2>
        <p className="mt-2 text-xs text-slate-500">Awaiting swarm…</p>
      </Card>
    );
  }
  const namedClusters = Object.keys(model.summary.byCluster).filter((c) => c !== "unclustered");
  const hasNamedClusters = namedClusters.length > 0;
  return (
    <Card>
      <div className="mb-3 flex items-center justify-between">
        <h2 className="text-sm font-semibold tracking-tight text-slate-900">Swarm Operator</h2>
        <button
          type="button"
          onClick={onClearAll}
          className="cursor-pointer text-[10px] font-semibold uppercase tracking-widest text-cyan-700 hover:text-cyan-800"
          data-testid="fish-operator-clear-selection"
        >
          Clear
        </button>
      </div>
      <Stat label="Swarm" value={swarmId.split("-")[0] ?? swarmId} mono />
      <Stat label="Total" value={model.summary.total} mono />
      <Stat label="Visible" value={model.summary.visible} mono />

      <Divider />

      <FilterBlock label="Status">
        <Select
          testId="fish-status-filter"
          value={filters.status}
          onChange={(v) => onFiltersChange({ ...filters, status: v as FishSceneStatusFilter })}
          options={[
            { value: "all", label: "All" },
            ...Object.entries(model.summary.byStatus)
              .filter(([, count]) => count > 0)
              .map(([k, v]) => ({
                value: k,
                label: `${k} (${v})`,
              })),
          ]}
        />
      </FilterBlock>

      <FilterBlock
        label={hasNamedClusters ? "Cluster" : "Cluster (none yet)"}
      >
        <Select
          testId="fish-cluster-filter"
          value={filters.cluster}
          onChange={(v) =>
            onFiltersChange({ ...filters, cluster: v as FishSceneClusterFilter })
          }
          options={[
            { value: "all", label: "All" },
            ...(hasNamedClusters
              ? [
                  { value: "unclustered", label: "Unclustered" },
                  ...namedClusters.map((c) => ({
                    value: c,
                    label: `${c} (${model.summary.byCluster[c]})`,
                  })),
                ]
              : []),
          ]}
        />
      </FilterBlock>

      <FilterBlock label="Terminal Action">
        <Select
          testId="fish-action-filter"
          value={filters.terminalAction}
          onChange={(v) =>
            onFiltersChange({ ...filters, terminalAction: v as FishSceneTerminalFilter })
          }
          options={[
            { value: "all", label: "All" },
            { value: "none", label: "None" },
            ...Object.keys(model.summary.byTerminalAction)
              .filter((k) => k !== "none")
              .map((k) => ({
                value: k,
                label: `${k} (${model.summary.byTerminalAction[k]})`,
              })),
          ]}
        />
      </FilterBlock>
    </Card>
  );
}

// ---------- Evidence panel (left rail, below filters) ----------

export function FishEvidencePanel({ swarmId }: { swarmId: string }) {
  const { data: evidence } = useSimReviewEvidenceQuery(swarmId);
  if (!evidence || evidence.length === 0) return null;
  return (
    <Card className="max-h-72 overflow-y-auto">
      <h3 className="mb-2 text-xs font-semibold tracking-tight text-slate-900">
        Review Evidence
      </h3>
      <div className="flex flex-col gap-3">
        {evidence.map((ev) => (
          <div key={ev.id} className="border-l-2 border-cyan-600 pl-2">
            <div className="mb-1 font-mono text-[10px] uppercase tracking-widest text-slate-500">
              [{ev.scope}] Q: {stripMarkdown(ev.question)}
            </div>
            <div className="text-xs text-slate-800">{stripMarkdown(ev.answer)}</div>
          </div>
        ))}
      </div>
    </Card>
  );
}

function stripMarkdown(input: string): string {
  // Lightweight cleanup so LLM-emitted markdown doesn't render as literal
  // **bold** / `code` inside the evidence column. We don't render markdown;
  // we just unwrap the marks and leave the text.
  return input
    .replace(/```[\s\S]*?```/g, " ")
    .replace(/`([^`]*)`/g, "$1")
    .replace(/\*\*([^*]+)\*\*/g, "$1")
    .replace(/\*([^*]+)\*/g, "$1")
    .replace(/_([^_]+)_/g, "$1")
    .replace(/^\s*#+\s*/gm, "")
    .replace(/\s+/g, " ")
    .trim();
}

// ---------- Inspector panel (right rail) — fish detail or swarm summary ----------

export function FishInspectorPanel({
  swarmId,
  model,
  selectedFishIndex,
  selectedTurnIndex,
  onSelectFish,
  onSelectTurn,
  filters,
}: {
  swarmId: string;
  model: FishSceneModel | null;
  selectedFishIndex: number | null;
  selectedTurnIndex: number | null;
  onSelectFish: (idx: number) => void;
  onSelectTurn: (idx: number | null) => void;
  filters: FishSceneFilters;
}) {
  const selected =
    selectedFishIndex !== null && selectedFishIndex >= 0 && model
      ? model.nodes[selectedFishIndex]
      : null;

  const { data: timeline } = useOperatorFishTimelineQuery(
    swarmId,
    selected ? selected.fishIndex : null,
  );

  if (!model) return null;

  if (!selected) {
    return <SwarmSummaryCard model={model} filters={filters} />;
  }

  return (
    <Card>
      <div className="mb-3 flex items-center justify-between">
        <h2 className="text-sm font-semibold tracking-tight text-slate-900">
          Fish {selected.fishIndex}
        </h2>
        <button
          type="button"
          onClick={() => onSelectFish(-1)}
          className="cursor-pointer text-slate-400 hover:text-slate-700"
          aria-label="Close fish panel"
        >
          ✕
        </button>
      </div>
      <Stat label="Status" value={selected.status} accentColor={selected.color} />
      <Stat label="Cluster" value={selected.clusterLabel ?? "Unclustered"} />
      <Stat label="Action" value={selected.terminalActionKind ?? "—"} />
      <Stat
        label="Progress"
        value={`${Math.round(selected.turnProgress * 100)}%`}
        mono
      />

      {timeline && timeline.turns.length > 0 && (
        <>
          <Divider />
          <div className="mb-2 flex items-center justify-between">
            <h3 className="text-[10px] font-semibold uppercase tracking-widest text-slate-500">
              Timeline
            </h3>
            <span className="font-mono text-[10px] text-cyan-700">
              {selectedTurnIndex !== null
                ? `Turn ${selectedTurnIndex + 1} / ${timeline.turns.length}`
                : `${timeline.turns.length} turns`}
            </span>
          </div>
          <input
            type="range"
            min={0}
            max={timeline.turns.length - 1}
            step={1}
            value={selectedTurnIndex ?? timeline.turns.length - 1}
            onChange={(e) => onSelectTurn(Number(e.target.value))}
            className="w-full cursor-pointer accent-cyan-600"
            data-testid="fish-timeline-scrubber"
          />
          <div className="mt-2 flex max-h-44 flex-col gap-1.5 overflow-y-auto pr-1">
            {timeline.turns.map((t, idx) => {
              const active = selectedTurnIndex === idx;
              return (
                <button
                  key={t.id}
                  type="button"
                  onClick={() => onSelectTurn(idx)}
                  className={`cursor-pointer rounded border p-2 text-left text-xs transition-colors ${
                    active
                      ? "border-cyan-300 bg-cyan-50"
                      : "border-transparent bg-slate-50 hover:bg-slate-100"
                  }`}
                >
                  <div className="mb-1 flex justify-between font-mono text-[10px] text-cyan-700">
                    <span>Turn {t.turnIndex}</span>
                    {t.llmCostUsd !== null && <span>${t.llmCostUsd.toFixed(4)}</span>}
                  </div>
                  <div className="line-clamp-2 text-slate-700" title={t.observableSummary}>
                    {t.observableSummary}
                  </div>
                  {t.rationale && (
                    <div className="mt-1 text-[10px] italic text-slate-400">{t.rationale}</div>
                  )}
                </button>
              );
            })}
          </div>
        </>
      )}
    </Card>
  );
}

function SwarmSummaryCard({
  model,
  filters,
}: {
  model: FishSceneModel;
  filters: FishSceneFilters;
}) {
  const topClusters = useMemo(() => {
    return Object.entries(model.summary.byCluster)
      .filter(([key]) => key !== "unclustered")
      .sort((a, b) => b[1] - a[1])
      .slice(0, 4);
  }, [model.summary.byCluster]);

  const topActions = useMemo(() => {
    return Object.entries(model.summary.byTerminalAction)
      .filter(([key]) => key !== "none")
      .sort((a, b) => b[1] - a[1])
      .slice(0, 4);
  }, [model.summary.byTerminalAction]);

  return (
    <Card>
      <h2 className="mb-1 text-sm font-semibold tracking-tight text-slate-900">
        Swarm Summary
      </h2>
      <div className="mb-3">
        <SectionLabel>Status mix</SectionLabel>
        <div className="flex flex-col gap-1">
          {Object.entries(model.summary.byStatus)
            .filter(([, count]) => count > 0)
            .sort((a, b) => b[1] - a[1])
            .map(([status, count]) => (
              <Bar
                key={status}
                label={status}
                count={count}
                total={model.summary.total}
                color={statusColor(model, status)}
              />
            ))}
        </div>
      </div>

      {topClusters.length > 0 && (
        <div className="mb-3">
          <SectionLabel>Top clusters</SectionLabel>
          <div className="flex flex-col gap-1">
            {topClusters.map(([label, count]) => (
              <Bar
                key={label}
                label={label}
                count={count}
                total={model.summary.total}
                color="#0891B2"
              />
            ))}
          </div>
        </div>
      )}

      {topActions.length > 0 && (
        <div>
          <SectionLabel>Terminal actions</SectionLabel>
          <div className="flex flex-col gap-1">
            {topActions.map(([action, count]) => (
              <Bar
                key={action}
                label={action}
                count={count}
                total={model.summary.total}
                color="#475569"
              />
            ))}
          </div>
        </div>
      )}

      {filters.cluster !== "all" || filters.status !== "all" || filters.terminalAction !== "all" ? (
        <div className="mt-3 rounded bg-slate-50 px-2 py-1.5 text-[10px] text-slate-500">
          {model.summary.visible} of {model.summary.total} match active filters.
        </div>
      ) : null}
    </Card>
  );
}

function statusColor(model: FishSceneModel, status: string): string {
  const node = model.nodes.find((n) => n.status === status);
  return node?.color ?? "#94A3B8";
}

// ---------- Ask panel (right rail, bottom) ----------

export function FishAskPanel({
  swarmId,
  model,
  selectedFishIndex,
  filters,
}: {
  swarmId: string;
  model: FishSceneModel | null;
  selectedFishIndex: number | null;
  filters: FishSceneFilters;
}) {
  const [question, setQuestion] = useState("");
  const [scope, setScope] = useState<AskScope>("swarm");
  const qaMutation = useSimReviewQuestionMutation(swarmId);

  const selected: FishSceneNode | null =
    selectedFishIndex !== null && selectedFishIndex >= 0 && model
      ? model.nodes[selectedFishIndex] ?? null
      : null;

  const clusterTarget = useMemo(() => {
    if (selected?.clusterLabel) {
      return {
        clusterIndex: selected.clusterIndex ?? undefined,
        clusterLabel: selected.clusterLabel,
      };
    }
    if (filters.cluster !== "all" && filters.cluster !== "unclustered") {
      return { clusterLabel: filters.cluster };
    }
    return null;
  }, [selected, filters.cluster]);

  const canAskFish = selected !== null;
  const canAskCluster = clusterTarget !== null;
  const effectiveScope: AskScope = canScopeBeUsed(scope, canAskFish, canAskCluster) ? scope : "swarm";

  const handleAsk = () => {
    if (!question.trim()) return;
    if (effectiveScope === "fish" && selected) {
      qaMutation.mutate({ scope: "fish", question, fishIndex: selected.fishIndex });
    } else if (effectiveScope === "cluster" && clusterTarget) {
      qaMutation.mutate({
        scope: "cluster",
        question,
        clusterIndex: clusterTarget.clusterIndex,
        clusterLabel: clusterTarget.clusterLabel,
      });
    } else {
      qaMutation.mutate({ scope: "swarm", question });
    }
    setQuestion("");
  };

  return (
    <Card>
      <div className="mb-2 flex items-center justify-between">
        <h3 className="text-xs font-semibold tracking-tight text-slate-900">
          Ask {scopeLabel(effectiveScope, selected, clusterTarget)}
        </h3>
        <div className="flex gap-1" role="tablist" aria-label="Question scope">
          <ScopeTab value="swarm" current={scope} onChange={setScope} disabled={false} />
          <ScopeTab value="cluster" current={scope} onChange={setScope} disabled={!canAskCluster} />
          <ScopeTab value="fish" current={scope} onChange={setScope} disabled={!canAskFish} />
        </div>
      </div>
      <textarea
        className="w-full resize-none rounded border border-slate-200 bg-slate-50 p-2 text-xs text-slate-900 focus:border-cyan-500 focus:outline-none focus:ring-1 focus:ring-cyan-500"
        rows={3}
        placeholder="Interrogate rationale..."
        value={question}
        onChange={(e) => setQuestion(e.target.value)}
        data-testid="fish-ask-input"
      />
      <button
        type="button"
        className="mt-2 w-full cursor-pointer rounded bg-cyan-600 px-3 py-1.5 text-xs font-semibold tracking-tight text-white transition-colors hover:bg-cyan-700 disabled:cursor-not-allowed disabled:opacity-50"
        onClick={handleAsk}
        disabled={!question.trim() || qaMutation.isPending}
        data-testid="fish-ask-submit"
      >
        {qaMutation.isPending ? "Querying…" : "Interrogate"}
      </button>
    </Card>
  );
}

// ---------- shared primitives ----------

function Card({ children, className = "" }: { children: ReactNode; className?: string }) {
  return (
    <div className={`rounded-lg border border-slate-200 bg-white p-4 shadow-sm ${className}`}>
      {children}
    </div>
  );
}

function Stat({
  label,
  value,
  mono = false,
  accentColor,
}: {
  label: string;
  value: string | number;
  mono?: boolean;
  accentColor?: string;
}) {
  return (
    <div className="mb-1 flex justify-between text-xs">
      <span className="text-slate-500">{label}</span>
      <span
        className={mono ? "font-mono tabular-nums text-slate-900" : "capitalize text-slate-900"}
        style={accentColor ? { color: accentColor } : undefined}
      >
        {value}
      </span>
    </div>
  );
}

function Divider() {
  return <div className="my-3 border-t border-slate-200" />;
}

function FilterBlock({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="mb-2">
      <div className="mb-1 text-[10px] font-semibold uppercase tracking-widest text-slate-500">
        {label}
      </div>
      {children}
    </div>
  );
}

function SectionLabel({ children }: { children: ReactNode }) {
  return (
    <div className="mb-1.5 text-[10px] font-semibold uppercase tracking-widest text-slate-500">
      {children}
    </div>
  );
}

function Bar({
  label,
  count,
  total,
  color,
}: {
  label: string;
  count: number;
  total: number;
  color: string;
}) {
  const pct = total > 0 ? Math.round((count / total) * 100) : 0;
  return (
    <div className="text-xs">
      <div className="mb-0.5 flex justify-between">
        <span className="capitalize text-slate-700">{label}</span>
        <span className="font-mono tabular-nums text-slate-500">
          {count} <span className="text-slate-400">· {pct}%</span>
        </span>
      </div>
      <div className="h-1 w-full rounded bg-slate-100">
        <div
          className="h-full rounded"
          style={{ width: `${pct}%`, background: color, transition: "width 280ms ease-out" }}
        />
      </div>
    </div>
  );
}

function Select({
  value,
  onChange,
  options,
  testId,
}: {
  value: string;
  onChange: (next: string) => void;
  options: Array<{ value: string; label: string }>;
  testId?: string;
}) {
  return (
    <select
      data-testid={testId}
      className="w-full cursor-pointer rounded border border-slate-200 bg-white px-2 py-1 text-xs text-slate-900 focus:border-cyan-500 focus:outline-none focus:ring-1 focus:ring-cyan-500"
      value={value}
      onChange={(e) => onChange(e.target.value)}
    >
      {options.map((opt) => (
        <option key={opt.value} value={opt.value}>
          {opt.label}
        </option>
      ))}
    </select>
  );
}

function ScopeTab({
  value,
  current,
  disabled,
  onChange,
}: {
  value: AskScope;
  current: AskScope;
  disabled: boolean;
  onChange: (v: AskScope) => void;
}) {
  const active = current === value;
  return (
    <button
      type="button"
      role="tab"
      aria-selected={active}
      disabled={disabled}
      onClick={() => onChange(value)}
      className={`cursor-pointer rounded border px-2 py-0.5 text-[10px] font-semibold uppercase tracking-widest transition-colors ${
        active
          ? "border-cyan-600 bg-cyan-50 text-cyan-700"
          : "border-slate-200 text-slate-500 hover:text-slate-800"
      } disabled:cursor-not-allowed disabled:opacity-30`}
      data-testid={`fish-ask-scope-${value}`}
    >
      {value}
    </button>
  );
}

function canScopeBeUsed(scope: AskScope, canAskFish: boolean, canAskCluster: boolean): boolean {
  if (scope === "fish") return canAskFish;
  if (scope === "cluster") return canAskCluster;
  return true;
}

function scopeLabel(
  scope: AskScope,
  fish: { fishIndex: number } | null,
  cluster: { clusterLabel?: string | null } | null,
): string {
  if (scope === "fish" && fish) return `Fish ${fish.fishIndex}`;
  if (scope === "cluster" && cluster?.clusterLabel) return `Cluster ${cluster.clusterLabel}`;
  return "Swarm";
}
