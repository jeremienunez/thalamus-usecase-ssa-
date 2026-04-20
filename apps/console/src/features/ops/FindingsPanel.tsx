import { useMemo } from "react";
import { clsx } from "clsx";
import { useFindings } from "@/usecases";
import type { FindingDTO, SatelliteDTO } from "@/transformers/http";

/**
 * Recent findings stream — bottom-right. When a satellite is selected,
 * filters to findings whose `linkedEntityIds` contain `sat:{id}`. Otherwise
 * shows the 10 most recent findings across all cortices.
 *
 * Clicking a finding focuses its linked satellite on the globe.
 */
export function FindingsPanel({
  satellites,
  selectedSatellite,
  onFocusSat,
}: {
  satellites: SatelliteDTO[];
  selectedSatellite: SatelliteDTO | null;
  onFocusSat: (sat: SatelliteDTO) => void;
}) {
  const satById = useMemo(() => {
    const m = new Map<number, SatelliteDTO>();
    for (const s of satellites) m.set(s.id, s);
    return m;
  }, [satellites]);

  const { data, isLoading } = useFindings();
  const satKey = selectedSatellite ? `sat:${selectedSatellite.id}` : null;

  const items = useMemo(() => {
    const all = data?.items ?? [];
    const filtered = satKey
      ? all.filter((f) => f.linkedEntityIds.includes(satKey))
      : all;
    return filtered
      .slice()
      .sort(
        (a, b) =>
          new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime(),
      )
      .slice(0, 10);
  }, [data, satKey]);

  const headerLabel = satKey
    ? `FINDINGS · ${selectedSatellite!.name}`
    : "RECENT FINDINGS";

  return (
    <div className="pointer-events-auto relative z-hud w-80 border border-hairline bg-panel/95 shadow-hud backdrop-blur-md">
      <div className="flex items-center gap-2 border-b border-hairline px-3 py-1.5">
        <span className="h-1.5 w-1.5 bg-cyan" />
        <div className="label text-nano">{headerLabel}</div>
        <span className="ml-auto mono text-nano text-dim">
          {isLoading ? "…" : `${items.length}${satKey ? "" : ` / ${data?.count ?? 0}`}`}
        </span>
      </div>
      <div className="max-h-[44vh] overflow-y-auto">
        {items.length === 0 && (
          <div className="px-3 py-3 text-caption text-dim">
            {satKey
              ? "No findings linked to this satellite yet — launch a cycle."
              : "No findings yet — launch a cycle."}
          </div>
        )}
        {items.map((f) => (
          <FindingRow
            key={f.id}
            finding={f}
            onClickSat={(satId) => {
              const sat = satById.get(satId);
              if (sat) onFocusSat(sat);
            }}
          />
        ))}
      </div>
    </div>
  );
}

function FindingRow({
  finding,
  onClickSat,
}: {
  finding: FindingDTO;
  onClickSat: (satId: number) => void;
}) {
  const satLink = finding.linkedEntityIds.find((e) => e.startsWith("sat:"));
  const satId = satLink ? Number(satLink.slice(4)) : null;

  const cortexColor = clsx(
    "mono text-nano",
    finding.cortex === "opacity-scout"
      ? "text-cyan"
      : finding.cortex === "conjunction-analysis"
        ? "text-amber"
        : finding.cortex === "data-auditor" || finding.cortex === "classification-auditor"
          ? "text-cold"
          : "text-dim",
  );
  const statusColor = clsx(
    "mono text-nano",
    finding.status === "pending"
      ? "text-amber"
      : finding.status === "accepted"
        ? "text-cold"
        : finding.status === "rejected"
          ? "text-dim"
          : "text-cyan",
  );

  return (
    <button
      type="button"
      onClick={() => satId && onClickSat(satId)}
      disabled={!satId}
      aria-label={satId ? `Focus satellite ${satId}` : undefined}
      className={clsx(
        "flex w-full flex-col gap-0.5 border-b border-hairline/50 px-3 py-1.5 text-left transition-colors duration-fast ease-palantir last:border-0",
        satId
          ? "cursor-pointer hover:bg-hairline/30"
          : "cursor-default opacity-80",
      )}
    >
      <div className="flex items-baseline justify-between gap-2">
        <span className={cortexColor}>{finding.cortex}</span>
        <span className={statusColor}>{finding.status}</span>
      </div>
      <div className="text-caption text-numeric line-clamp-2">
        {finding.title}
      </div>
    </button>
  );
}
