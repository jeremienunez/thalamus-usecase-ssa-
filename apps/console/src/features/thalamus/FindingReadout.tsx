import { useEffect, useId, useRef, useState } from "react";
import { X } from "lucide-react";
import { clsx } from "clsx";
import { useFindingQuery } from "@/usecases/useFindingQuery";
import type { FindingDTO } from "@/shared/types";

type Props = {
  /** Numeric id stripped from `finding:NNN` (or null when nothing selected). */
  findingId: number | null;
  onClose: () => void;
  onFocusEntity?: (entityId: string) => void;
};

/**
 * "Synaptic readout" — the panel that fires open when a neuron in the
 * THALAMUS graph is clicked. Brain-themed alternative to the generic Drawer:
 * 11 sections of cerebral cortex iconography around the title, ASCII firing
 * bar, and full finding payload pulled live from /api/findings/:id.
 */
export function FindingReadout({ findingId, onClose, onFocusEntity }: Props) {
  const open = findingId !== null;
  const titleId = useId();
  const closeRef = useRef<HTMLButtonElement | null>(null);

  const { data, isLoading, error } = useFindingQuery(
    findingId !== null ? String(findingId) : null,
  );

  useEffect(() => {
    if (!open) return;
    closeRef.current?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        onClose();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  return (
    <aside
      role="complementary"
      aria-hidden={!open}
      aria-labelledby={open ? titleId : undefined}
      // @ts-expect-error inert is HTML; React 19 will type it
      inert={!open ? "" : undefined}
      className={clsx(
        "absolute right-0 top-0 z-drawer flex h-full w-[480px] flex-col border-l border-hairline-hot bg-base/95 shadow-pop backdrop-blur-md transition-transform duration-med ease-palantir",
        open ? "translate-x-0" : "translate-x-full pointer-events-none",
      )}
    >
      <ReadoutChrome titleId={titleId} closeRef={closeRef} onClose={onClose} />
      <div className="min-h-0 flex-1 overflow-y-auto">
        {!findingId ? (
          <EmptyState />
        ) : isLoading ? (
          <LoadingState findingId={findingId} />
        ) : error || !data ? (
          <ErrorState findingId={findingId} />
        ) : (
          <ReadoutBody data={data} onFocusEntity={onFocusEntity} />
        )}
      </div>
    </aside>
  );
}

function ReadoutChrome({
  titleId,
  closeRef,
  onClose,
}: {
  titleId: string;
  closeRef: React.MutableRefObject<HTMLButtonElement | null>;
  onClose: () => void;
}) {
  return (
    <div className="flex h-12 shrink-0 items-center justify-between border-b border-hairline-hot bg-elevated px-4">
      <div className="flex min-w-0 items-center gap-2">
        <span className="h-1.5 w-1.5 animate-ping bg-cyan" />
        <span id={titleId} className="label text-cyan tracking-widest">
          SYNAPTIC READOUT
        </span>
      </div>
      <button
        ref={closeRef}
        onClick={onClose}
        aria-label="Close synaptic readout"
        title="Close (Esc)"
        className="flex h-7 w-7 cursor-pointer items-center justify-center text-muted transition-colors duration-fast ease-palantir hover:text-primary"
      >
        <X size={14} strokeWidth={1.5} />
      </button>
    </div>
  );
}

function EmptyState() {
  return (
    <div className="flex h-full items-center justify-center px-8 text-center">
      <div className="text-caption text-dim">
        click a finding-neuron in the cortex to capture its synaptic activity
      </div>
    </div>
  );
}

function LoadingState({ findingId }: { findingId: number }) {
  return (
    <div className="flex h-full flex-col items-center justify-center gap-2">
      <span className="h-1.5 w-1.5 animate-ping bg-cyan" />
      <span className="mono text-label text-cyan tracking-widest">
        FIRING F#{findingId}
      </span>
    </div>
  );
}

function ErrorState({ findingId }: { findingId: number }) {
  return (
    <div className="px-4 py-6">
      <div className="border border-hairline-hot bg-panel/95 p-3">
        <div className="label mb-1 text-hot">SIGNAL LOST</div>
        <div className="mono text-caption text-muted">
          could not fetch <span className="text-primary">F#{findingId}</span>
          {" "}— upstream returned 4xx/5xx or finding was promoted.
        </div>
      </div>
    </div>
  );
}

const CORTEX_REGION: Record<string, { region: string; lobe: string; color: string }> = {
  classification_auditor: { region: "AUDITORY", lobe: "Temporal", color: "#34D399" },
  data_auditor: { region: "MEMORY", lobe: "Hippocampal", color: "#22D3EE" },
  conjunction_analysis: { region: "MOTOR", lobe: "Frontal", color: "#F87171" },
  opacity_scout: { region: "VISUAL", lobe: "Occipital", color: "#A78BFA" },
  strategist: { region: "EXECUTIVE", lobe: "Pre-frontal", color: "#F59E0B" },
  pc_estimator_agent: { region: "PROBABILITY", lobe: "Parietal", color: "#60A5FA" },
  correlation: { region: "ASSOCIATIVE", lobe: "Inter-cortical", color: "#22D3EE" },
  observations: { region: "SENSORY", lobe: "Somato-sensory", color: "#34D399" },
  catalog: { region: "ARCHIVE", lobe: "Library", color: "#8B949E" },
  maneuver_planning: { region: "PLANNING", lobe: "Frontal", color: "#F59E0B" },
};

function regionFor(cortex: string | null | undefined) {
  const key = (cortex ?? "").replace(/-/g, "_");
  return (
    CORTEX_REGION[key] ?? {
      region: "ASSOCIATIVE",
      lobe: "Inter-cortical",
      color: "#8B949E",
    }
  );
}

function ReadoutBody({
  data,
  onFocusEntity,
}: {
  data: FindingDTO;
  onFocusEntity?: (entityId: string) => void;
}) {
  const numeric = data.id.replace(/^f:/, "");
  const region = regionFor(data.cortex);
  const priority = typeof data.priority === "number" ? data.priority : 0;
  const created = new Date(data.createdAt);
  const status = data.status;

  return (
    <div className="flex flex-col gap-0">
      <CortexBand region={region} numeric={numeric} cortex={data.cortex} />
      <TitleBlock title={data.title} status={status} priority={priority} />
      <PrioritySpike priority={priority} color={region.color} />
      <Section title="SUMMARY">
        <p className="text-body leading-relaxed text-primary">{data.summary}</p>
      </Section>
      <Section title="CORTEX METADATA">
        <DataRow label="Cortex" value={data.cortex || "—"} mono color={region.color} />
        <DataRow label="Region" value={region.region} mono color={region.color} />
        <DataRow label="Lobe" value={region.lobe} mono />
        <DataRow label="Status" value={status.toUpperCase()} mono color={statusColor(status)} />
        <DataRow label="Captured" value={created.toISOString().slice(0, 19) + "Z"} mono />
      </Section>
      {data.linkedEntityIds && data.linkedEntityIds.length > 0 && (
        <Section title={`AXON ENDPOINTS · ${data.linkedEntityIds.length}`}>
          <div className="flex flex-col gap-1">
            {data.linkedEntityIds.map((eid) => (
              <button
                key={eid}
                onClick={() => onFocusEntity?.(eid)}
                disabled={!onFocusEntity}
                className={clsx(
                  "group flex items-center gap-2 border-l-2 border-cyan/40 bg-panel/40 px-3 py-1.5 text-left transition-colors duration-fast ease-palantir",
                  onFocusEntity
                    ? "cursor-pointer hover:border-cyan hover:bg-hover"
                    : "cursor-default",
                )}
              >
                <span className="mono text-nano uppercase tracking-widest text-dim">
                  {entityKind(eid)}
                </span>
                <span className="mono text-caption text-primary">
                  {eid.replace(/^[a-z]+:/, "")}
                </span>
                {onFocusEntity && (
                  <span className="ml-auto mono text-nano text-dim opacity-0 transition-opacity group-hover:opacity-100">
                    focus →
                  </span>
                )}
              </button>
            ))}
          </div>
        </Section>
      )}
      {data.evidence && data.evidence.length > 0 && (
        <Section title={`EVIDENCE · ${data.evidence.length}`}>
          <div className="flex flex-col gap-1">
            {data.evidence.map((e, i) => (
              <div
                key={i}
                className="border border-hairline bg-panel/60 p-2 text-caption"
              >
                <div className="mb-0.5 flex items-center gap-2">
                  <span
                    className="mono text-nano uppercase tracking-widest"
                    style={{ color: sourceClassColor(e.kind) }}
                  >
                    {e.kind}
                  </span>
                  <span className="mono truncate text-nano text-dim">{e.uri}</span>
                </div>
                {e.snippet && (
                  <div className="mono whitespace-pre-wrap text-nano leading-tight text-muted">
                    {e.snippet}
                  </div>
                )}
              </div>
            ))}
          </div>
        </Section>
      )}
    </div>
  );
}

function CortexBand({
  region,
  numeric,
  cortex,
}: {
  region: { region: string; lobe: string; color: string };
  numeric: string;
  cortex: string;
}) {
  return (
    <div
      className="flex items-center justify-between border-b border-hairline px-4 py-2"
      style={{
        background: `linear-gradient(90deg, ${region.color}22 0%, ${region.color}05 70%, transparent 100%)`,
      }}
    >
      <div className="flex items-center gap-2">
        <span
          className="mono text-nano uppercase tracking-widest"
          style={{ color: region.color }}
        >
          {region.region}
        </span>
        <span className="mono text-nano text-dim">·</span>
        <span className="mono text-nano text-muted">{region.lobe}</span>
      </div>
      <div className="flex items-center gap-2">
        <span className="mono text-nano text-dim">{cortex || "—"}</span>
        <span className="mono text-nano text-dim">·</span>
        <span className="mono text-caption text-primary">F#{numeric}</span>
      </div>
    </div>
  );
}

function TitleBlock({
  title,
  status,
  priority,
}: {
  title: string;
  status: FindingDTO["status"];
  priority: number;
}) {
  return (
    <div className="flex flex-col gap-2 px-4 py-3">
      <div className="flex items-center gap-2">
        <span
          className="inline-flex h-5 items-center border px-2 mono text-nano uppercase tracking-widest"
          style={{
            color: statusColor(status),
            borderColor: statusColor(status) + "55",
            backgroundColor: statusColor(status) + "11",
          }}
        >
          {status}
        </span>
        <span className="mono text-nano text-dim">priority</span>
        <span className="mono text-caption text-primary tabular-nums">
          {priority.toFixed(0)}
          <span className="ml-0.5 text-dim">/100</span>
        </span>
      </div>
      <h2 className="text-h2 leading-tight text-primary">{title}</h2>
    </div>
  );
}

function PrioritySpike({ priority, color }: { priority: number; color: string }) {
  // ASCII firing bar, 32 cells, intensity scaled by priority.
  const cells = 32;
  const filled = Math.max(0, Math.min(cells, Math.round((priority / 100) * cells)));
  const bar =
    "▁▃▅▇█".repeat(Math.ceil(filled / 5)).slice(0, filled) +
    "·".repeat(Math.max(0, cells - filled));
  return (
    <div className="flex items-center gap-3 border-y border-hairline bg-panel/40 px-4 py-2">
      <span className="mono text-nano uppercase tracking-widest text-dim">spike</span>
      <pre
        className="mono flex-1 whitespace-pre text-caption leading-none"
        style={{ color }}
      >
        {bar}
      </pre>
      <span
        className="mono text-nano tabular-nums"
        style={{ color }}
      >
        {priority.toFixed(0)}
      </span>
    </div>
  );
}

function Section({
  title,
  children,
}: {
  title: string;
  children: React.ReactNode;
}) {
  return (
    <section className="border-b border-hairline px-4 py-3 last:border-0">
      <div className="label mb-2 text-nano">{title}</div>
      {children}
    </section>
  );
}

function DataRow({
  label,
  value,
  mono,
  color,
}: {
  label: string;
  value: React.ReactNode;
  mono?: boolean;
  color?: string;
}) {
  return (
    <div className="grid grid-cols-[112px_1fr] items-baseline gap-3 py-1 text-body">
      <span className="text-caption text-muted">{label}</span>
      <span
        className={clsx(mono ? "mono text-numeric" : "text-primary")}
        style={color ? { color } : undefined}
      >
        {value}
      </span>
    </div>
  );
}

function entityKind(eid: string): string {
  const prefix = eid.split(":")[0] ?? "";
  switch (prefix) {
    case "sat":
      return "satellite";
    case "op":
      return "operator";
    case "regime":
      return "regime";
    case "finding":
      return "finding";
    case "payload":
      return "payload";
    default:
      return prefix || "entity";
  }
}

function statusColor(status: FindingDTO["status"]): string {
  switch (status) {
    case "pending":
      return "#F59E0B";
    case "accepted":
      return "#34D399";
    case "rejected":
      return "#F87171";
    case "in-review":
      return "#22D3EE";
    default:
      return "#8B949E";
  }
}

function sourceClassColor(kind: string): string {
  switch (kind) {
    case "field":
      return "#A78BFA";
    case "osint":
      return "#60A5FA";
    case "sim":
      return "#F59E0B";
    case "derived":
      return "#8B949E";
    default:
      return "#8B949E";
  }
}
