import { useState } from "react";
import { clsx } from "clsx";
import { useFindings } from "@/usecases";
import { FindingsGraph } from "./FindingsGraph";
import { SweepDrawer } from "./Drawer";
import { SweepOverview } from "./Overview";
import { SweepStats } from "./Stats";
import { SweepSuggestions } from "./Suggestions";
import { useUiStore } from "@/shared/ui/uiStore";
import { useSweepSuggestions } from "@/usecases";

type Tab = "overview" | "suggestions" | "map" | "stats";

export function SweepEntry() {
  const [tab, setTab] = useState<Tab>("map");
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const openDrawer = useUiStore((s) => s.openDrawer);
  const closeDrawer = useUiStore((s) => s.closeDrawer);
  const { data } = useFindings();
  const { data: suggData } = useSweepSuggestions();
  const suggCount = suggData?.items.length ?? 0;

  const switchTab = (t: Tab) => {
    setTab(t);
    setSelectedId(null);
    closeDrawer();
  };

  const handleSelect = (id: string) => {
    setSelectedId(id);
    openDrawer(`f:${id}`);
  };

  const pendingCount = data?.items.filter((f) => f.status === "pending").length ?? 0;
  const acceptedCount = data?.items.filter((f) => f.status === "accepted").length ?? 0;
  const rejectedCount = data?.items.filter((f) => f.status === "rejected").length ?? 0;

  return (
    <div className="relative h-full w-full">
      {/* Tab bar */}
      <div className="flex h-9 shrink-0 items-center justify-between border-b border-hairline bg-panel px-3">
        <nav className="flex h-full items-center gap-0">
          {(["overview", "suggestions", "map", "stats"] as Tab[]).map((t) => (
            <button
              key={t}
              onClick={() => switchTab(t)}
              className={clsx(
                "flex h-9 items-center gap-1.5 border-b-2 px-3 text-label transition-colors duration-fast ease-palantir cursor-pointer",
                tab === t ? "border-cyan text-primary" : "border-transparent text-muted hover:text-primary",
              )}
            >
              {t.toUpperCase()}
              {t === "suggestions" && suggCount > 0 && (
                <span className="mono text-caption text-amber tabular-nums">
                  {suggCount}
                </span>
              )}
            </button>
          ))}
        </nav>
        <div className="flex items-center gap-3 text-caption">
          <span className="label">
            <span className="text-amber">{pendingCount}</span> PENDING
          </span>
          <span className="h-3 w-px bg-hairline" />
          <span className="label">
            <span className="text-cyan">{acceptedCount}</span> ACCEPTED
          </span>
          <span className="h-3 w-px bg-hairline" />
          <span className="label">
            <span className="text-hot">{rejectedCount}</span> REJECTED
          </span>
        </div>
      </div>

      {/* Content */}
      <div className="relative h-[calc(100%-2.25rem)]">
        {tab === "overview" && <SweepOverview onSelect={handleSelect} />}
        {tab === "suggestions" && <SweepSuggestions />}
        {tab === "map" && data && (
          <FindingsGraph findings={data.items} onSelect={handleSelect} selectedId={selectedId} />
        )}
        {tab === "stats" && <SweepStats />}
      </div>

      <SweepDrawer findingId={selectedId} />
    </div>
  );
}
