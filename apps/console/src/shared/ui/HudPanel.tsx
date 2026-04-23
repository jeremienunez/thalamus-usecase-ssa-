import type { ReactNode } from "react";
import { clsx } from "clsx";

export type HudDot = "hot" | "amber" | "cyan" | "cold" | "dim";

type Props = {
  /** Panel title rendered in the header row. If omitted, the panel has no header. */
  title?: string;
  /** Optional left-side dot color. */
  dot?: HudDot;
  /** If true, the dot gets an animated ping overlay (live state). */
  live?: boolean;
  /** Right-aligned header meta text. */
  meta?: ReactNode;
  /** Additional classes for the outer wrapper (positioning, width, pointer-events). */
  className?: string;
  /** If true, wraps in `pointer-events-none` so HUD doesn't block canvas input. */
  passthrough?: boolean;
  children?: ReactNode;
};

const DOT_BG: Record<HudDot, string> = {
  hot: "bg-hot",
  amber: "bg-amber",
  cyan: "bg-cyan",
  cold: "bg-cold",
  dim: "bg-dim",
};

/**
 * The repeated HUD panel chrome: framed box + optional header row with
 * dot/title/meta. One place so variants don't drift between ops/thalamus.
 */
export function HudPanel({
  title,
  dot,
  live = false,
  meta,
  className,
  passthrough = false,
  children,
}: Props) {
  return (
    <div
      className={clsx(
        "overflow-hidden border border-cyan/10 bg-panel/90 shadow-hud backdrop-blur-md ring-1 ring-white/[0.02]",
        passthrough && "pointer-events-none",
        className,
      )}
    >
      {title && (
        <div className="flex items-center gap-2 border-b border-hairline bg-elevated/35 px-3 py-1.5">
          {dot && (
            <span className="relative flex h-1.5 w-1.5">
              {live && (
                <span
                  className={clsx(
                    "absolute inline-flex h-full w-full animate-ping opacity-75",
                    DOT_BG[dot],
                  )}
                />
              )}
              <span className={clsx("relative inline-flex h-1.5 w-1.5", DOT_BG[dot])} />
            </span>
          )}
          <div className="label text-nano text-primary">{title}</div>
          {meta !== undefined && (
            <span className="ml-auto mono text-nano text-dim">{meta}</span>
          )}
        </div>
      )}
      {children}
    </div>
  );
}
