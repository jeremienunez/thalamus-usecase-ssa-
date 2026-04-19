import { clsx } from "clsx";
import type { DispatchResult } from "@/features/repl/types";

const fmtSci = (v: number): string => v.toExponential(2);

export function PcEstimatorRender({
  r,
  onFollowUp,
}: {
  r: Extract<DispatchResult, { kind: "pc" }>;
  onFollowUp: (input: string) => void;
}) {
  const e = r.estimate;
  const sevClass =
    e.severity === "high" ? "text-hot" : e.severity === "medium" ? "text-amber" : "text-cold";
  const sevLabel =
    e.severity === "high" ? "HIGH" : e.severity === "medium" ? "MEDIUM" : "INFO";
  const maxCount = Math.max(1, ...e.histogramBins.map((b) => b.count));
  return (
    <div className="flex flex-col gap-2 border border-hairline bg-elevated p-2">
      <div className="mono text-caption text-muted">
        pc · conjunction {r.conjunctionId} · n={e.fishCount}
      </div>
      <div className="mono flex items-center gap-3 text-caption">
        <span className={clsx(sevClass, "uppercase")}>[{sevLabel}]</span>
        <span className="text-primary">
          median Pc = <span className="text-numeric">{fmtSci(e.medianPc)}</span>
        </span>
        <span className="text-dim">
          σ(log10)={e.sigmaPc.toFixed(3)} · p5={fmtSci(e.p5Pc)} · p95={fmtSci(e.p95Pc)}
        </span>
      </div>
      <div className="flex flex-col gap-0.5">
        <div className="mono text-caption text-muted">log10(Pc) histogram</div>
        {e.histogramBins.map((b, i) => {
          const barLen = Math.round((b.count / maxCount) * 28);
          return (
            <div
              key={i}
              className="mono grid grid-cols-[80px_1fr_40px] gap-2 text-caption"
            >
              <span className="text-dim">{b.log10Pc.toFixed(2)}</span>
              <span className={clsx(sevClass)}>{"█".repeat(barLen) || "·"}</span>
              <span className="text-numeric">{b.count}</span>
            </div>
          );
        })}
      </div>
      {e.clusters.length > 0 && (
        <div className="flex flex-col gap-0.5">
          <div className="mono text-caption text-cyan">Dissent clusters</div>
          {e.clusters.map((c, i) => (
            <div
              key={i}
              className="mono grid grid-cols-[180px_1fr_160px_40px] gap-2 text-caption"
            >
              <span className="text-primary">{c.mode}</span>
              <span className="text-dim">{c.flags.join(", ")}</span>
              <span className="text-muted">
                [{fmtSci(c.pcRange[0])} .. {fmtSci(c.pcRange[1])}]
              </span>
              <span className="text-numeric">{c.fishCount}</span>
            </div>
          ))}
        </div>
      )}
      {e.suggestionId && (
        <button
          onClick={() => onFollowUp(`/accept ${e.suggestionId}`)}
          className="mono text-left text-caption text-primary hover:text-cyan"
        >
          → /accept {e.suggestionId}
        </button>
      )}
    </div>
  );
}
