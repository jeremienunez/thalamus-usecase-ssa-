import { useEffect, useState } from "react";
import {
  STEP_REGISTRY,
  type StepName,
} from "@interview/shared/observability-browser";

export type StepPhase = "start" | "progress" | "done" | "error";

/**
 * Matches the Ink AnimatedEmoji: 6 fps frame cycle while active,
 * freezes to terminal on done, error icon on error.
 */
export function AnimatedStepBadge({
  step,
  phase = "progress",
  title,
}: {
  step: StepName;
  phase?: StepPhase;
  title?: string;
}) {
  const entry = STEP_REGISTRY[step];
  const [idx, setIdx] = useState(0);
  const animated = phase === "start" || phase === "progress";

  useEffect(() => {
    if (!animated) return;
    if ("instantaneous" in entry && entry.instantaneous) return;
    const id = setInterval(() => setIdx((n) => n + 1), 1000 / 6);
    return () => clearInterval(id);
  }, [animated, entry]);

  let glyph: string;
  if ("instantaneous" in entry && entry.instantaneous) {
    glyph = entry.terminal;
  } else if (phase === "error") {
    glyph = entry.error!;
  } else if (phase === "done") {
    glyph = entry.terminal;
  } else {
    const frames = entry.frames!;
    glyph = frames[idx % frames.length]!;
  }

  return (
    <span
      className="inline-flex w-5 items-center justify-center text-caption leading-none"
      title={title ?? `${step} · ${phase}`}
    >
      {glyph}
    </span>
  );
}
