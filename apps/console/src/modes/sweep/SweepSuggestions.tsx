import { useState } from "react";
import { Check, X, Radar, Square } from "lucide-react";
import { clsx } from "clsx";
import type { SweepSuggestionDTO } from "@/lib/api";
import {
  useSweepSuggestions,
  useReviewSuggestion,
  useMissionStatus,
  useMissionStart,
  useMissionStop,
} from "@/lib/queries";

const SEVERITY_COLOR: Record<SweepSuggestionDTO["severity"], string> = {
  info: "#6E7681",
  warning: "#f1c40f",
  critical: "#e74c3c",
};

export function SweepSuggestions() {
  const { data, isLoading } = useSweepSuggestions();
  const { data: mission } = useMissionStatus();
  const startMission = useMissionStart();
  const stopMission = useMissionStop();
  const review = useReviewSuggestion();
  const [busyId, setBusyId] = useState<string | null>(null);
  const [toast, setToast] = useState<string | null>(null);

  const missionRunning = mission?.running ?? false;
  const toggleMission = () => {
    if (missionRunning) stopMission.mutate();
    else startMission.mutate();
  };

  const act = (id: string, accept: boolean) => {
    setBusyId(id);
    review.mutate(
      { id, accept },
      {
        onSuccess: (r) => {
          setBusyId(null);
          if (accept) {
            const rows = r.resolution?.affectedRows ?? 0;
            const errs = r.resolution?.errors ?? [];
            setToast(
              errs.length > 0
                ? `accepted — ${rows} row(s), ${errs.length} error(s): ${errs[0]}`
                : `accepted — ${rows} row(s) updated`,
            );
          } else {
            setToast("rejected — feedback logged");
          }
          setTimeout(() => setToast(null), 4000);
        },
        onError: (e: unknown) => {
          setBusyId(null);
          setToast(`error: ${(e as Error).message}`);
          setTimeout(() => setToast(null), 4000);
        },
      },
    );
  };

  if (isLoading) {
    return <div className="p-6 text-caption text-dim">loading suggestions…</div>;
  }
  const items = data?.items ?? [];
  if (items.length === 0) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-2 p-6 text-caption text-dim">
        <div className="label">— NO PENDING SUGGESTIONS —</div>
        <div>Launch a fish swarm from the CYCLE LAUNCHER to populate the queue.</div>
      </div>
    );
  }

  return (
    <div className="relative h-full overflow-y-auto p-6">
      <div className="mb-4 flex items-center justify-between gap-3">
        <div className="min-w-0">
          <div className="label">PENDING SWEEP SUGGESTIONS</div>
          <div className="mono text-caption text-dim">
            concrete field-level fixes emitted by sim-fish swarms · accept to apply, reject to train the model
          </div>
        </div>
        <div className="flex shrink-0 items-center gap-3">
          <span className="mono text-caption text-muted tabular-nums">{items.length} queued</span>
          <button
            onClick={toggleMission}
            disabled={startMission.isPending || stopMission.isPending}
            className={clsx(
              "flex h-7 items-center gap-1.5 border px-2.5 text-label transition-colors cursor-pointer",
              missionRunning
                ? "border-hot/60 bg-hot/10 text-hot hover:bg-hot/20"
                : "border-cyan/60 bg-cyan/10 text-cyan hover:bg-cyan/20",
            )}
            title={missionRunning ? "Stop fish mission" : "Launch fish mission (gpt-5.4-nano + web search)"}
          >
            {missionRunning ? (
              <>
                <Square size={11} strokeWidth={2} />
                STOP MISSION
              </>
            ) : (
              <>
                <Radar size={11} strokeWidth={2} />
                LAUNCH FISH MISSION
              </>
            )}
          </button>
        </div>
      </div>

      {mission && (mission.running || mission.completed > 0) && (
        <div className="mb-4 border border-hairline bg-panel px-3 py-2">
          <div className="flex items-center gap-3">
            <span className={clsx(
              "relative flex h-1.5 w-1.5",
              mission.running ? "" : "hidden",
            )}>
              <span className="absolute inline-flex h-full w-full animate-ping bg-cyan opacity-75" />
              <span className="relative inline-flex h-1.5 w-1.5 bg-cyan" />
            </span>
            <span className="label text-primary">
              {mission.running ? "FISH MISSION · RUNNING" : "FISH MISSION · DONE"}
            </span>
            <span className="ml-auto mono text-caption text-dim tabular-nums">
              {mission.completed}/{mission.total}
            </span>
          </div>
          <div className="mt-2 grid grid-cols-3 gap-3 mono text-caption tabular-nums">
            <span><span className="text-cold">{mission.filled}</span> filled</span>
            <span><span className="text-amber">{mission.unobtainable}</span> unobtainable</span>
            <span><span className="text-hot">{mission.errors}</span> errors</span>
          </div>
          {mission.recent.length > 0 && (
            <ul className="mt-2 max-h-[180px] overflow-y-auto border-t border-hairline pt-2">
              {mission.recent.slice(0, 10).map((t) => (
                <li key={`${t.suggestionId}-${t.completedAt}`} className="flex items-center gap-2 py-0.5 mono text-caption">
                  <span className={clsx(
                    "w-[90px] shrink-0",
                    t.status === "filled" ? "text-cold" :
                    t.status === "unobtainable" ? "text-amber" :
                    t.status === "error" ? "text-hot" : "text-dim",
                  )}>
                    [{t.status}]
                  </span>
                  <span className="w-[120px] shrink-0 text-muted truncate">{t.operatorCountry}</span>
                  <span className="w-[140px] shrink-0 text-primary truncate">{t.field}</span>
                  <span className="w-[100px] shrink-0 text-cyan truncate tabular-nums">
                    {t.value !== null ? String(t.value) : "—"}
                  </span>
                  {t.source && (
                    <a href={t.source} target="_blank" rel="noreferrer" className="ml-auto text-dim hover:text-primary truncate max-w-[200px]">
                      {new URL(t.source).host}
                    </a>
                  )}
                </li>
              ))}
            </ul>
          )}
        </div>
      )}

      <ul className="flex flex-col gap-3">
        {items.map((s) => {
          const color = SEVERITY_COLOR[s.severity];
          const busy = busyId === s.id;
          return (
            <li
              key={s.id}
              className="border border-hairline bg-panel px-4 py-3"
              style={{ borderLeft: `3px solid ${color}` }}
            >
              <div className="flex items-start gap-3">
                <div className="flex min-w-0 flex-1 flex-col gap-1">
                  <div className="flex items-center gap-2">
                    <span
                      className="label"
                      style={{ color }}
                    >
                      {s.severity.toUpperCase()}
                    </span>
                    <span className="mono text-caption text-dim">{s.category}</span>
                    <span className="mono text-caption text-dim">#{s.id}</span>
                    <span className="ml-auto mono text-caption text-dim tabular-nums">
                      {s.affectedSatellites} sat · {s.operatorCountryName}
                    </span>
                  </div>
                  <div className="text-body text-primary">{s.title}</div>
                  {s.description && (
                    <div className="text-caption text-muted line-clamp-3">
                      {s.description}
                    </div>
                  )}
                  <div className="mt-1 flex items-center gap-2 border-t border-hairline pt-2">
                    <span className="label text-cyan">PROPOSED FIX</span>
                    <span className="mono text-caption text-primary">{s.suggestedAction}</span>
                    {!s.hasPayload && (
                      <span className="ml-auto mono text-caption text-amber">
                        ⚠ no executable payload
                      </span>
                    )}
                  </div>
                </div>
                <div className="flex shrink-0 flex-col gap-1.5">
                  <button
                    disabled={busy}
                    onClick={() => act(s.id, true)}
                    className={clsx(
                      "flex h-7 items-center gap-1.5 border border-cold/50 bg-cold/10 px-2 text-label text-cold transition-colors hover:bg-cold/20",
                      busy && "opacity-50 cursor-wait",
                    )}
                  >
                    <Check size={12} strokeWidth={2} /> ACCEPT
                  </button>
                  <button
                    disabled={busy}
                    onClick={() => act(s.id, false)}
                    className={clsx(
                      "flex h-7 items-center gap-1.5 border border-hot/50 bg-hot/10 px-2 text-label text-hot transition-colors hover:bg-hot/20",
                      busy && "opacity-50 cursor-wait",
                    )}
                  >
                    <X size={12} strokeWidth={2} /> REJECT
                  </button>
                </div>
              </div>
            </li>
          );
        })}
      </ul>

      {toast && (
        <div className="fixed bottom-6 right-6 z-50 border border-hairline-hot bg-elevated px-4 py-2 mono text-caption text-primary shadow-lg">
          {toast}
        </div>
      )}
    </div>
  );
}
