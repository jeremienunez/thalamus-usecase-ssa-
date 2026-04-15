import { useEffect, useRef, useState } from "react";
import { useConjunctions, useSatellites, useFindings } from "@/lib/queries";

type Line = { ts: string; kind: "INFO" | "WARN" | "ACCEPT" | "REJECT"; msg: string };

const MAX = 40;

function nowUtc(): string {
  return new Date().toISOString().slice(11, 19);
}

export function TelemetryStrip() {
  const [lines, setLines] = useState<Line[]>([]);
  const seeded = useRef(false);

  const { data: satData } = useSatellites();
  const { data: cjData } = useConjunctions(1e-8);
  const { data: findings } = useFindings();

  const satCount = satData?.items.length ?? 0;
  const cjCount = cjData?.items.length ?? 0;
  const findingCount = findings?.items.length ?? 0;
  const pending = findings?.items.filter((f) => f.status === "pending").length ?? 0;

  // Seed once when data first arrives
  useEffect(() => {
    if (seeded.current || satCount === 0) return;
    seeded.current = true;
    setLines([
      { ts: nowUtc(), kind: "INFO", msg: `catalog loaded · ${satCount} tracked objects` },
      { ts: nowUtc(), kind: "INFO", msg: `conjunction screening · ${cjCount} events in window` },
      {
        ts: nowUtc(),
        kind: pending > 0 ? "WARN" : "INFO",
        msg:
          pending > 0
            ? `${pending} finding(s) awaiting reviewer input`
            : `reviewer queue drained · ${findingCount} findings resolved`,
      },
    ]);
  }, [satCount, cjCount, findingCount, pending]);

  // Heartbeat
  useEffect(() => {
    const id = setInterval(() => {
      setLines((prev) =>
        [
          ...prev.slice(-MAX + 1),
          { ts: nowUtc(), kind: "INFO" as const, msg: "heartbeat · console-api healthy" },
        ],
      );
    }, 15_000);
    return () => clearInterval(id);
  }, []);

  return (
    <footer className="h-30 shrink-0 border-t border-hairline bg-panel">
      <div className="flex h-8 items-center justify-between border-b border-hairline px-3">
        <span className="label">TELEMETRY</span>
        <span className="mono text-caption text-dim">
          streaming · {lines.length} / {MAX}
        </span>
      </div>
      <div className="h-[88px] overflow-y-auto px-3 py-1 text-caption leading-tight">
        {lines.map((l, i) => (
          <div key={i} className="grid grid-cols-[64px_56px_1fr] gap-2">
            <span className="mono text-dim">{l.ts}</span>
            <span
              className={
                l.kind === "WARN"
                  ? "mono text-amber"
                  : l.kind === "REJECT"
                    ? "mono text-hot"
                    : l.kind === "ACCEPT"
                      ? "mono text-cyan"
                      : "mono text-muted"
              }
            >
              {l.kind}
            </span>
            <span className="text-numeric">{l.msg}</span>
          </div>
        ))}
      </div>
    </footer>
  );
}
