import React, { useEffect, useState } from "react";
import { Text } from "ink";
import { STEP_REGISTRY, type StepName, type StepPhase } from "@interview/shared";

interface Props {
  step: StepName;
  phase: StepPhase;
  _tickOverride?: number;
}

export function AnimatedEmoji({ step, phase, _tickOverride }: Props): React.JSX.Element {
  const [tick, setTick] = useState(_tickOverride ?? 0);
  useEffect(() => {
    if (_tickOverride !== undefined) return;
    if (phase !== "start") return;
    const id = setInterval(() => setTick((t) => t + 1), 166); // ~6fps
    return () => clearInterval(id);
  }, [phase, _tickOverride]);

  const entry = STEP_REGISTRY[step];
  if (!entry) return <Text>❔</Text>;
  if (phase === "done") return <Text>{entry.terminal}</Text>;
  if (phase === "error") return <Text>{entry.error ?? entry.terminal}</Text>;
  if (entry.instantaneous || !entry.frames || entry.frames.length === 0) {
    return <Text>{entry.terminal}</Text>;
  }
  return <Text>{entry.frames[tick % entry.frames.length]}</Text>;
}
