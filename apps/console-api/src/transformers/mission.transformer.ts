import type { MissionState, MissionStateView } from "../types";

export function toMissionStateView(state: MissionState): MissionStateView {
  return {
    running: state.running,
    startedAt: state.startedAt,
    total: state.tasks.length,
    completed: state.completedCount,
    filled: state.filledCount,
    unobtainable: state.unobtainableCount,
    errors: state.errorCount,
    cursor: state.cursor,
    currentTask:
      state.running && state.cursor > 0 ? state.tasks[state.cursor - 1] ?? null : null,
    recent: state.tasks
      .filter((t) => t.status !== "pending")
      .slice(-20)
      .reverse(),
  };
}
