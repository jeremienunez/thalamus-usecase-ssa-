// apps/console-api/src/services/autonomy.service.ts
import type { FastifyBaseLogger } from "fastify";
import type { AutonomyAction, AutonomyState, AutonomyTick } from "../types";
import { THALAMUS_QUERIES } from "../prompts/autonomy-queries.prompt";
import type { CycleRunnerService } from "./cycle-runner.service";

const ROTATION: AutonomyAction[] = ["thalamus", "sweep-nullscan"];

export class AutonomyService {
  private state: AutonomyState = {
    running: false,
    intervalMs: 45_000,
    tickCount: 0,
    currentTick: null,
    history: [],
    startedAt: null,
    rotationIdx: 0,
    queryIdx: 0,
    timer: null,
    busy: false,
  };

  constructor(
    private readonly cycles: CycleRunnerService,
    private readonly logger: FastifyBaseLogger,
  ) {}

  publicState() {
    return {
      running: this.state.running,
      intervalMs: this.state.intervalMs,
      startedAt: this.state.startedAt,
      tickCount: this.state.tickCount,
      currentTick: this.state.currentTick,
      history: this.state.history.slice(0, 20),
      nextTickInMs:
        this.state.running && this.state.startedAt
          ? Math.max(
              0,
              this.state.intervalMs -
                ((Date.now() -
                  (this.state.history[0]
                    ? new Date(this.state.history[0].startedAt).getTime()
                    : Date.now())) %
                  this.state.intervalMs),
            )
          : null,
    };
  }

  start(intervalSec: number): {
    ok: true;
    alreadyRunning?: boolean;
    state: ReturnType<AutonomyService["publicState"]>;
  } {
    if (this.state.running)
      return { ok: true, alreadyRunning: true, state: this.publicState() };
    // Defense-in-depth: guard against NaN/Infinity that would otherwise
    // propagate through Math.max/Math.min and land in setInterval as NaN,
    // which Node coerces to 1 ms → runaway timer.
    const safe = Number.isFinite(intervalSec) ? intervalSec : 45;
    const sec = Math.max(15, Math.min(600, safe));
    this.state.intervalMs = sec * 1000;
    this.state.running = true;
    this.state.startedAt = new Date().toISOString();
    this.state.timer = setInterval(() => {
      void this.tick();
    }, this.state.intervalMs);
    void this.tick();
    return { ok: true, state: this.publicState() };
  }

  stop(): { ok: true; state: ReturnType<AutonomyService["publicState"]> } {
    if (this.state.timer) clearInterval(this.state.timer);
    this.state.timer = null;
    this.state.running = false;
    return { ok: true, state: this.publicState() };
  }

  private async tick(): Promise<void> {
    if (this.state.busy || !this.state.running) return;
    this.state.busy = true;
    const action = ROTATION[this.state.rotationIdx % ROTATION.length]!;
    this.state.rotationIdx++;
    const id = `a:${Date.now().toString(36)}`;
    const startedAt = new Date().toISOString();
    let queryOrMode = "";
    let emitted = 0;
    let error: string | undefined;

    try {
      if (action === "thalamus") {
        const q =
          THALAMUS_QUERIES[this.state.queryIdx % THALAMUS_QUERIES.length]!;
        this.state.queryIdx++;
        queryOrMode = q;
        this.state.currentTick = {
          id,
          action,
          queryOrMode,
          startedAt,
          completedAt: "",
          emitted: 0,
        };
        emitted = await this.cycles.runThalamus(q);
      } else if (action === "sweep-nullscan") {
        queryOrMode = "nullScan(20 operator-countries)";
        this.state.currentTick = {
          id,
          action,
          queryOrMode,
          startedAt,
          completedAt: "",
          emitted: 0,
        };
        emitted = await this.cycles.runFish();
      } else {
        queryOrMode = "briefing(5 operator-countries)";
        this.state.currentTick = {
          id,
          action,
          queryOrMode,
          startedAt,
          completedAt: "",
          emitted: 0,
        };
        emitted = await this.cycles.runBriefing(5);
      }
    } catch (err) {
      error = err instanceof Error ? err.message : String(err);
      this.logger.error({ err: error, action }, "autonomy tick failed");
    }

    const tick: AutonomyTick = {
      id,
      action,
      queryOrMode,
      startedAt,
      completedAt: new Date().toISOString(),
      emitted,
      ...(error && { error }),
    };
    this.state.history.unshift(tick);
    if (this.state.history.length > 40) this.state.history.pop();
    this.state.currentTick = null;
    this.state.tickCount++;
    this.state.busy = false;
  }
}
