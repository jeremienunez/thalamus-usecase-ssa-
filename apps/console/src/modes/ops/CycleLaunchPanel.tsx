import { useLaunchCycle, useCycles } from "@/lib/queries";
import { clsx } from "clsx";
import { Brain, Fish, Zap } from "lucide-react";

/**
 * Launch panel — three buttons that kick off research cycles. Each button
 * maps to the backend's `launchCycle(kind)` which synthesises findings and
 * invalidates the findings/stats queries so the UI refreshes on its own.
 *
 * Lives bottom-left of the ops view. Sober styling — same chrome as the
 * telemetry card, just a row of action pills.
 */
export function CycleLaunchPanel() {
  const launch = useLaunchCycle();
  const { data: cycles } = useCycles();
  const latest = cycles?.items[0];

  const run = (kind: "thalamus" | "fish" | "both") => {
    if (launch.isPending) return;
    launch.mutate(kind);
  };

  return (
    <div className="pointer-events-auto border border-hairline bg-panel/90 backdrop-blur-sm">
      <div className="flex items-center gap-2 border-b border-hairline px-3 py-1.5">
        <span
          className={clsx(
            "h-1.5 w-1.5",
            launch.isPending ? "animate-pulse bg-amber" : "bg-cold",
          )}
        />
        <div className="label text-nano">
          {launch.isPending ? "CYCLE · RUNNING" : "CYCLE LAUNCHER"}
        </div>
        <span className="ml-auto mono text-nano text-dim">
          {latest
            ? `last ${latest.kind.toUpperCase()} · +${latest.findingsEmitted}`
            : "no cycle yet"}
        </span>
      </div>
      <div className="flex">
        <LaunchButton
          icon={<Brain className="h-3 w-3" />}
          label="THALAMUS"
          hint="research cycle"
          onClick={() => run("thalamus")}
          disabled={launch.isPending}
        />
        <LaunchButton
          icon={<Fish className="h-3 w-3" />}
          label="FISH"
          hint="data-quality swarm"
          onClick={() => run("fish")}
          disabled={launch.isPending}
        />
        <LaunchButton
          icon={<Zap className="h-3 w-3" />}
          label="BOTH"
          hint="full pipeline"
          onClick={() => run("both")}
          disabled={launch.isPending}
          accent
        />
      </div>
    </div>
  );
}

function LaunchButton({
  icon,
  label,
  hint,
  onClick,
  disabled,
  accent,
}: {
  icon: React.ReactNode;
  label: string;
  hint: string;
  onClick: () => void;
  disabled?: boolean;
  accent?: boolean;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className={clsx(
        "flex flex-col gap-0.5 border-l border-hairline px-3 py-2 text-left first:border-l-0",
        disabled ? "opacity-50 cursor-not-allowed" : "hover:bg-hairline/40",
        accent && !disabled && "text-cyan",
      )}
    >
      <div className="flex items-center gap-1.5">
        {icon}
        <span className="label text-nano">{label}</span>
      </div>
      <span className="mono text-nano text-dim">{hint}</span>
    </button>
  );
}
