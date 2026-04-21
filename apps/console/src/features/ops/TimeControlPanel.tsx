import { Pause, Play } from "lucide-react";
import { HudPanel } from "@/shared/ui/HudPanel";

type Props = {
  paused: boolean;
  speedIdx: number;
  labels: string[];
  fullLabels: string[];
  onTogglePause: () => void;
  onSelectSpeed: (index: number) => void;
};

export function TimeControlPanel({
  paused,
  speedIdx,
  labels,
  fullLabels,
  onTogglePause,
  onSelectSpeed,
}: Props) {
  return (
    <HudPanel
      className="absolute bottom-4 left-1/2 z-hud -translate-x-1/2"
      title="TIME CONTROL"
      meta={
        <span className="text-cyan tabular-nums">
          {paused ? "PAUSED" : fullLabels[speedIdx]}
        </span>
      }
    >
      <div className="flex items-stretch">
        <button
          aria-label={paused ? "Play" : "Pause"}
          onClick={onTogglePause}
          className="flex h-9 w-9 cursor-pointer items-center justify-center border-r border-hairline text-cyan transition-colors duration-fast ease-palantir hover:bg-hover"
        >
          {paused ? <Play size={14} strokeWidth={1.5} /> : <Pause size={14} strokeWidth={1.5} />}
        </button>
        {labels.map((label, index) => {
          const active = !paused && index === speedIdx;
          return (
            <button
              key={label}
              aria-label={`Speed ${fullLabels[index]}`}
              onClick={() => onSelectSpeed(index)}
              className={`relative flex h-9 w-11 items-center justify-center border-r border-hairline mono text-caption tabular-nums transition-colors duration-fast ease-palantir last:border-r-0 ${
                active
                  ? "bg-active text-cyan"
                  : "cursor-pointer text-muted hover:bg-hover hover:text-primary"
              }`}
            >
              {label}
              {active && <span className="absolute inset-x-0 top-0 h-[2px] bg-cyan" />}
            </button>
          );
        })}
      </div>
    </HudPanel>
  );
}
