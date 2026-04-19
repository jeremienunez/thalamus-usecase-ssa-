import { useMemo } from "react";
import type { FindingDTO, FindingStatus } from "@/shared/types";
import { STATUS_COLOR } from "@/shared/types/graph-colors";

const STATUSES: FindingStatus[] = ["pending", "in-review", "accepted", "rejected"];
const STATUS_LABEL: Record<FindingStatus, string> = {
  pending: "PENDING",
  "in-review": "IN REVIEW",
  accepted: "ACCEPTED",
  rejected: "REJECTED",
};

/** Findings board: columns = status, rows sorted by priority desc.
 *  Replaces the co-citation graph with a factual, readable pipeline view. */
export function FindingsGraph({
  findings,
  onSelect,
  selectedId,
}: {
  findings: FindingDTO[];
  onSelect: (id: string) => void;
  selectedId: string | null;
}) {
  const columns = useMemo(() => {
    const byStatus = new Map<FindingStatus, FindingDTO[]>();
    for (const s of STATUSES) byStatus.set(s, []);
    for (const f of findings) {
      const arr = byStatus.get(f.status);
      if (arr) arr.push(f);
    }
    for (const arr of byStatus.values()) arr.sort((a, b) => b.priority - a.priority);
    return byStatus;
  }, [findings]);

  return (
    <div className="absolute inset-0 flex gap-0 overflow-hidden bg-base">
      {STATUSES.map((status) => {
        const list = columns.get(status) ?? [];
        const color = STATUS_COLOR[status];
        return (
          <div
            key={status}
            className="flex min-w-0 flex-1 flex-col border-r border-hairline last:border-r-0"
          >
            <div className="flex items-center gap-2 border-b border-hairline bg-panel px-3 py-1.5">
              <span className="h-1.5 w-1.5" style={{ backgroundColor: color }} />
              <span className="label text-nano" style={{ color }}>
                {STATUS_LABEL[status]}
              </span>
              <span className="ml-auto mono text-nano text-dim tabular-nums">
                {list.length}
              </span>
            </div>
            <div className="min-h-0 flex-1 overflow-y-auto px-2 py-2">
              {list.length === 0 ? (
                <div className="px-1 py-2 text-caption text-dim">— empty —</div>
              ) : (
                <ul className="flex flex-col gap-1.5">
                  {list.map((f) => {
                    const selected = selectedId === f.id;
                    return (
                      <li key={f.id}>
                        <button
                          onClick={() => onSelect(f.id)}
                          className={`group w-full cursor-pointer border bg-panel/80 p-2 text-left transition-colors duration-fast ease-palantir hover:bg-hover ${
                            selected ? "border-cyan" : "border-hairline"
                          }`}
                          style={selected ? { boxShadow: "0 0 0 1px #22d3ee55 inset" } : undefined}
                        >
                          <div className="mb-1 flex items-center gap-2">
                            <span
                              className="h-1 w-1 shrink-0"
                              style={{ backgroundColor: color }}
                            />
                            <span className="mono truncate text-nano uppercase tracking-widest text-dim">
                              {f.cortex}
                            </span>
                            <span className="ml-auto mono text-nano text-dim tabular-nums">
                              {f.id}
                            </span>
                          </div>
                          <div className="mb-1.5 line-clamp-2 text-caption leading-snug text-primary">
                            {f.title}
                          </div>
                          <div className="flex items-center gap-2">
                            <div className="relative h-1 flex-1 bg-hairline">
                              <div
                                className="absolute inset-y-0 left-0"
                                style={{
                                  width: `${Math.max(2, Math.min(100, f.priority))}%`,
                                  backgroundColor: color,
                                }}
                              />
                            </div>
                            <span className="mono w-8 shrink-0 text-right text-nano text-muted tabular-nums">
                              p{f.priority}
                            </span>
                            {f.swarmConsensus && (
                              <span className="mono text-nano text-dim tabular-nums">
                                {f.swarmConsensus.accept}/{f.swarmConsensus.k}
                              </span>
                            )}
                          </div>
                        </button>
                      </li>
                    );
                  })}
                </ul>
              )}
            </div>
          </div>
        );
      })}
    </div>
  );
}
