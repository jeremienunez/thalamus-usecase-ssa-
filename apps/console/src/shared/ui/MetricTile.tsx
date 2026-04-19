import { useAnimatedNumber } from "@/hooks/useAnimatedNumber";

export type MetricAccent = "primary" | "hot" | "amber" | "cyan";

const ACCENT_CLASS: Record<MetricAccent, string> = {
  primary: "text-primary",
  hot: "text-hot",
  amber: "text-amber",
  cyan: "text-cyan",
};

type Props = {
  label: string;
  value: number;
  display?: (v: number) => string;
  accent?: MetricAccent;
};

/**
 * Animated label + large mono number stacked in a framed tile. Used in HUD
 * telemetry cards (ops) and graph stats (thalamus).
 */
export function MetricTile({ label, value, display, accent = "primary" }: Props) {
  const animated = useAnimatedNumber(Number.isFinite(value) ? value : 0, 420);
  const rendered = display ? display(animated) : Math.round(animated).toString();
  return (
    <div className="flex flex-col gap-0.5 px-3 py-2 border-l border-hairline first:border-l-0">
      <div className="label text-nano">{label}</div>
      <div className={`mono text-h2 leading-none ${ACCENT_CLASS[accent]} tabular-nums`}>
        {rendered}
      </div>
    </div>
  );
}

export function MetricTilePlaceholder({ label }: { label: string }) {
  return (
    <div className="flex flex-col gap-0.5 px-3 py-2 border-l border-hairline first:border-l-0">
      <div className="label text-nano">{label}</div>
      <div className="mono text-h2 leading-none text-dim tabular-nums">…</div>
    </div>
  );
}
