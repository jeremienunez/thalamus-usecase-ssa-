import { useRef, useState } from "react";

export const TIME_SPEEDS = [1, 60, 600, 3600];

/**
 * Time controller for the 3D ops scene: speed preset + pause + last-known
 * speed for resume. `effectiveSpeed` folds pause into the numeric value
 * callers hand to renderers.
 */
export function useTimeControl(initialSpeedIdx = 1) {
  const [speedIdx, setSpeedIdx] = useState(initialSpeedIdx);
  const [paused, setPaused] = useState(false);
  const prevSpeedIdx = useRef(initialSpeedIdx);

  const effectiveSpeed = paused ? 0 : TIME_SPEEDS[speedIdx];

  const togglePause = () => {
    setPaused((p) => {
      if (!p) prevSpeedIdx.current = speedIdx;
      return !p;
    });
  };

  const selectSpeed = (i: number) => {
    setSpeedIdx(i);
    setPaused(false);
    prevSpeedIdx.current = i;
  };

  return { speedIdx, paused, effectiveSpeed, togglePause, selectSpeed };
}
