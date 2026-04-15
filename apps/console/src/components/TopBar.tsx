import { Link, useRouterState } from "@tanstack/react-router";
import { Activity, Globe2, Network, Radar } from "lucide-react";
import { clsx } from "clsx";
import { useUtcClock } from "@/lib/useUtcClock";

const modes = [
  { to: "/ops", label: "OPS", icon: Globe2, hint: "⌘1" },
  { to: "/thalamus", label: "THALAMUS", icon: Network, hint: "⌘2" },
  { to: "/sweep", label: "SWEEP", icon: Radar, hint: "⌘3" },
] as const;

export function TopBar() {
  const utc = useUtcClock();
  const { location } = useRouterState();

  return (
    <header className="flex h-10 shrink-0 items-center justify-between border-b border-hairline bg-panel px-3">
      <div className="flex items-center gap-3">
        <div className="flex items-center gap-2">
          <div className="h-2 w-2 bg-cyan" />
          <span className="label text-primary">THALAMUS · OPERATOR CONSOLE</span>
        </div>
        <span className="h-4 w-px bg-hairline" />
        <nav className="flex items-center gap-0">
          {modes.map((m) => {
            const active = location.pathname.startsWith(m.to);
            const Icon = m.icon;
            return (
              <Link
                key={m.to}
                to={m.to}
                className={clsx(
                  "flex h-10 items-center gap-2 border-b-2 px-3 text-label transition-colors duration-fast ease-palantir",
                  active
                    ? "border-cyan text-primary"
                    : "border-transparent text-muted hover:text-primary",
                )}
              >
                <Icon size={14} strokeWidth={1.5} />
                {m.label}
              </Link>
            );
          })}
        </nav>
      </div>
      <div className="flex items-center gap-4">
        <div className="flex items-center gap-2 text-caption">
          <Activity size={12} strokeWidth={1.5} className="text-cold" />
          <span className="label">SWARM</span>
          <span className="mono text-cold">NOMINAL</span>
        </div>
        <span className="h-4 w-px bg-hairline" />
        <div className="flex items-center gap-2 text-caption">
          <span className="label">PENDING</span>
          <span className="mono text-amber">0</span>
        </div>
        <span className="h-4 w-px bg-hairline" />
        <span className="mono text-caption text-numeric">{utc} UTC</span>
      </div>
    </header>
  );
}
