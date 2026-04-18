// apps/console-api/src/services/mission.service.ts
import type { GenericSuggestionRow } from "@interview/sweep";
import { parseSsaFindingPayload } from "../agent/ssa/sweep";
import type { FastifyBaseLogger } from "fastify";
import type { MissionState, MissionTask } from "../types";
import { toMissionStateView } from "../transformers/mission.transformer";
import type { SweepTaskPlanner, SweepListRow } from "./sweep-task-planner.service";
import type { MissionTaskWorker } from "./mission-worker.service";

const MAX_SATS_PER_SUGGESTION = 5;
const TICK_INTERVAL_MS = 1500;

export interface SweepListProvider {
  list(opts: {
    reviewed: boolean;
    limit: number;
  }): Promise<{ rows: GenericSuggestionRow[] }>;
}

/**
 * Thin orchestrator: owns the `MissionState` + timer, delegates planning
 * to `SweepTaskPlanner` and per-task execution to `MissionTaskWorker`.
 * Keeps only cursor advance, counter bookkeeping, and public state view.
 */
export class MissionService {
  private state: MissionState = {
    running: false,
    startedAt: null,
    tasks: [],
    completedCount: 0,
    filledCount: 0,
    unobtainableCount: 0,
    errorCount: 0,
    cursor: 0,
    timer: null,
    busy: false,
  };

  constructor(
    private readonly planner: SweepTaskPlanner,
    private readonly worker: MissionTaskWorker,
    private readonly sweepRepo: SweepListProvider,
    private readonly logger: FastifyBaseLogger,
  ) {}

  publicState() {
    return toMissionStateView(this.state);
  }

  async start(opts: {
    maxSatsPerSuggestion?: number;
  }): Promise<{
    ok: true;
    alreadyRunning?: boolean;
    state: ReturnType<MissionService["publicState"]>;
  }> {
    if (this.state.running)
      return { ok: true, alreadyRunning: true, state: this.publicState() };
    // Controller-side MissionStartBodySchema already clamps to [1, 20]. We
    // still allow `undefined` for programmatic callers without a schema.
    const cap = opts.maxSatsPerSuggestion ?? MAX_SATS_PER_SUGGESTION;
    const listing = await this.sweepRepo.list({ reviewed: false, limit: 300 });
    const tasks = await this.planner.buildTasks(
      listing.rows
        .map(toSweepListRow)
        .filter((row): row is SweepListRow => row !== null),
      cap,
    );

    this.state = {
      running: true,
      startedAt: new Date().toISOString(),
      tasks,
      completedCount: 0,
      filledCount: 0,
      unobtainableCount: 0,
      errorCount: 0,
      cursor: 0,
      busy: false,
      timer: setInterval(() => {
        void this.tick();
      }, TICK_INTERVAL_MS),
    };
    void this.tick();
    return { ok: true, state: this.publicState() };
  }

  stop(): { ok: true; state: ReturnType<MissionService["publicState"]> } {
    if (this.state.timer) clearInterval(this.state.timer);
    this.state.timer = null;
    this.state.running = false;
    return { ok: true, state: this.publicState() };
  }

  private async tick(): Promise<void> {
    if (this.state.busy || !this.state.running) return;
    if (this.state.cursor >= this.state.tasks.length) {
      this.state.running = false;
      if (this.state.timer) clearInterval(this.state.timer);
      this.state.timer = null;
      return;
    }
    this.state.busy = true;
    const task: MissionTask = this.state.tasks[this.state.cursor]!;
    this.state.cursor++;
    try {
      await this.worker.runTask(task);
      this.state.completedCount++;
      if (task.status === "filled") this.state.filledCount++;
      else if (task.status === "unobtainable") this.state.unobtainableCount++;
      else if (task.status === "error") this.state.errorCount++;
    } finally {
      this.state.busy = false;
    }
  }
}

function toSweepListRow(row: GenericSuggestionRow): SweepListRow | null {
  try {
    const finding = parseSsaFindingPayload(row.domainFields);
    return {
      id: row.id,
      operatorCountryName: finding.operatorCountryName,
      resolutionPayload: row.resolutionPayload,
    };
  } catch {
    return null;
  }
}
