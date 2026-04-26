import { Link, useRouterState } from "@tanstack/react-router";
import { Globe2, Network, Radar, SlidersHorizontal } from "lucide-react";
import { clsx } from "clsx";
import { useUtcClock } from "@/hooks/useUtcClock";
import { AutonomyControl } from "@/features/autonomy/Control";

const modes = [
  { to: "/ops", label: "OPS", icon: Globe2, hint: "⌘1" },
  { to: "/thalamus", label: "THALAMUS", icon: Network, hint: "⌘2" },
  { to: "/sweep", label: "SWEEP", icon: Radar, hint: "⌘3" },
  { to: "/fish", label: "FISH", icon: Radar, hint: "⌘4" },
  { to: "/config", label: "CONFIG", icon: SlidersHorizontal, hint: "⌘5" },
] as const;

export function TopBar() {
  const { utc } = useUtcClock();
  const { location } = useRouterState();

  return (
    <header className="flex h-10 shrink-0 items-center justify-between border-b border-cyan/10 bg-panel/95 px-3 shadow-[0_1px_0_rgba(255,255,255,0.03)_inset]">
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
                    ? "border-cyan bg-active/40 text-primary"
                    : "border-transparent text-muted hover:bg-hover/60 hover:text-primary",
                )}
              >
                <Icon size={14} strokeWidth={1.5} />
                {m.label}
                <span className="hidden mono text-nano text-dim xl:inline">{m.hint}</span>
              </Link>
            );
          })}
        </nav>
      </div>
      <div className="relative flex items-center gap-3">
        <AutonomyControl />
        <span className="h-4 w-px bg-hairline" />
        <span className="mono text-caption text-numeric">{utc} UTC</span>
      </div>
    </header>
  );
}
