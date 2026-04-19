import { useStats } from "@/lib/queries";
import { STATUS_COLOR } from "@/lib/graphColors";

export function SweepStats() {
  const { data } = useStats();
  if (!data) return <div className="p-4 text-caption text-dim">loading stats…</div>;

  const total = data.findings;
  const accRate = data.byStatus.accepted ? (data.byStatus.accepted / total) * 100 : 0;
  const maxCortex = Math.max(...Object.values(data.byCortex));

  return (
    <div className="h-full overflow-y-auto p-6">
      <div className="grid grid-cols-4 gap-3">
        <Card label="TOTAL FINDINGS" value={total.toString()} />
        <Card label="ACCEPTANCE RATE" value={`${accRate.toFixed(1)}%`} tone="cold" />
        <Card label="KG NODES" value={data.kgNodes.toString()} />
        <Card label="CONJUNCTIONS" value={data.conjunctions.toString()} tone="amber" />
      </div>

      <div className="mt-8">
        <div className="label mb-3">BY STATUS</div>
        <div className="space-y-2">
          {(Object.keys(data.byStatus) as (keyof typeof STATUS_COLOR)[]).map((k) => {
            const v = data.byStatus[k] ?? 0;
            const pct = (v / total) * 100;
            return (
              <div key={k} className="grid grid-cols-[120px_1fr_80px] items-center gap-3">
                <span
                  className="mono text-caption uppercase"
                  style={{ color: STATUS_COLOR[k] }}
                >
                  {k}
                </span>
                <div className="h-4 border border-hairline bg-base">
                  <div
                    className="h-full"
                    style={{ width: `${pct}%`, backgroundColor: STATUS_COLOR[k] + "AA" }}
                  />
                </div>
                <span className="mono text-caption text-numeric text-right">
                  {v} · {pct.toFixed(1)}%
                </span>
              </div>
            );
          })}
        </div>
      </div>

      <div className="mt-8">
        <div className="label mb-3">BY CORTEX</div>
        <div className="space-y-2">
          {Object.entries(data.byCortex)
            .sort((a, b) => b[1] - a[1])
            .map(([k, v]) => {
              const pct = (v / maxCortex) * 100;
              return (
                <div key={k} className="grid grid-cols-[180px_1fr_80px] items-center gap-3">
                  <span className="mono text-caption text-numeric">{k}</span>
                  <div className="h-4 border border-hairline bg-base">
                    <div className="h-full bg-cyan/70" style={{ width: `${pct}%` }} />
                  </div>
                  <span className="mono text-caption text-numeric text-right">{v}</span>
                </div>
              );
            })}
        </div>
      </div>
    </div>
  );
}

function Card({ label, value, tone }: { label: string; value: string; tone?: "cold" | "amber" }) {
  const color = tone === "cold" ? "text-cold" : tone === "amber" ? "text-amber" : "text-primary";
  return (
    <div className="border border-hairline bg-panel px-4 py-3">
      <div className="label">{label}</div>
      <div className={`mono text-display font-mono ${color}`}>{value}</div>
    </div>
  );
}
