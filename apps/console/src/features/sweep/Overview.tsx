import { useFindings } from "@/lib/queries";
import { STATUS_COLOR } from "@/lib/graphColors";
import { useUiStore } from "@/lib/uiStore";

export function SweepOverview({ onSelect }: { onSelect: (id: string) => void }) {
  const { data } = useFindings();
  const openDrawer = useUiStore((s) => s.openDrawer);
  if (!data) return <div className="p-4 text-caption text-dim">loading…</div>;

  const recent = [...data.items]
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
    .slice(0, 40);

  return (
    <div className="h-full overflow-y-auto p-6">
      <div className="label mb-3">RECENT FINDINGS · {data.count} total</div>
      <div className="border border-hairline bg-panel">
        <div className="grid grid-cols-[90px_120px_1fr_80px_140px] border-b border-hairline bg-panel px-3 py-2">
          <span className="label">ID</span>
          <span className="label">CORTEX</span>
          <span className="label">TITLE</span>
          <span className="label text-right">PRIORITY</span>
          <span className="label">STATUS</span>
        </div>
        {recent.map((f) => (
          <button
            key={f.id}
            onClick={() => { onSelect(f.id); openDrawer(`f:${f.id}`); }}
            className="grid w-full grid-cols-[90px_120px_1fr_80px_140px] border-b border-hairline px-3 py-2 text-left last:border-0 hover:bg-hover cursor-pointer"
          >
            <span className="mono text-caption text-numeric">{f.id}</span>
            <span className="mono text-caption text-muted">{f.cortex}</span>
            <span className="truncate text-caption text-primary">{f.title}</span>
            <span className="mono text-caption text-numeric text-right">{f.priority}</span>
            <span
              className="mono text-caption uppercase"
              style={{ color: STATUS_COLOR[f.status] }}
            >
              {f.status}
            </span>
          </button>
        ))}
      </div>
    </div>
  );
}
