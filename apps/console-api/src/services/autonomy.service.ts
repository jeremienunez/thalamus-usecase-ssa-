// apps/console-api/src/services/autonomy.service.ts
import type { FastifyBaseLogger } from "fastify";
import type { ConsoleAutonomyConfig } from "@interview/shared/config";
import type { AutonomyAction, AutonomyState, AutonomyTick } from "../types";
import { THALAMUS_QUERIES } from "../prompts/autonomy-queries.prompt";
import { getAutonomyConfig } from "./autonomy-config";
import { SpendLedger } from "./spend-ledger";

export interface CycleOrchestratorPort {
  runThalamus(query: string): Promise<{ emitted: number; costUsd: number }>;
  runFish(): Promise<number>;
  runBriefing(limit: number): Promise<number>;
}

const ROTATION_FALLBACK: AutonomyAction[] = ["thalamus"];

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
    stoppedReason: null,
  };

  constructor(
    private readonly cycles: CycleOrchestratorPort,
    private readonly logger: FastifyBaseLogger,
    private readonly ledger: SpendLedger = new SpendLedger(),
  ) {}

  publicState() {
    const nextTickInMs =
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
        : null;
    return {
      running: this.state.running,
      intervalMs: this.state.intervalMs,
      startedAt: this.state.startedAt,
      tickCount: this.state.tickCount,
      currentTick: this.state.currentTick,
      history: this.state.history.slice(0, 20),
      dailySpendUsd: this.ledger.dailyUsd(),
      monthlySpendUsd: this.ledger.monthlyUsd(),
      thalamusCyclesToday: this.ledger.cyclesInDay(),
      stoppedReason: this.state.stoppedReason,
      nextTickInMs,
    };
  }

  async start(intervalSecOverride?: number): Promise<{
    ok: true;
    alreadyRunning?: boolean;
    state: ReturnType<AutonomyService["publicState"]>;
  }> {
    if (this.state.running)
      return { ok: true, alreadyRunning: true, state: this.publicState() };
    const cfg = await getAutonomyConfig();
    const chosen = intervalSecOverride ?? cfg.intervalSec;
    const safe = Number.isFinite(chosen) ? chosen : cfg.intervalSec;
    const sec = Math.max(15, Math.min(600, safe));
    this.state.intervalMs = sec * 1000;
    this.state.running = true;
    this.state.stoppedReason = null;
    this.state.startedAt = new Date().toISOString();
    this.schedule(this.state.intervalMs);
    void this.tick();
    return { ok: true, state: this.publicState() };
  }

  stop(
    reason: AutonomyState["stoppedReason"] = "stopped_by_operator",
  ): { ok: true; state: ReturnType<AutonomyService["publicState"]> } {
    if (this.state.timer) clearInterval(this.state.timer);
    this.state.timer = null;
    this.state.running = false;
    if (this.state.stoppedReason === null) this.state.stoppedReason = reason;
    return { ok: true, state: this.publicState() };
  }

  resetSpend(): { ok: true; state: ReturnType<AutonomyService["publicState"]> } {
    this.ledger.reset();
    return { ok: true, state: this.publicState() };
  }

  private schedule(intervalMs: number): void {
    if (this.state.timer) clearInterval(this.state.timer);
    this.state.timer = setInterval(() => {
      void this.tick();
    }, intervalMs);
  }

  private async tick(): Promise<void> {
    if (this.state.busy || !this.state.running) return;
    this.state.busy = true;
    try {
      const cfg = await getAutonomyConfig();
      const wantedIntervalMs =
        Math.max(15, Math.min(600, cfg.intervalSec)) * 1000;
      if (wantedIntervalMs !== this.state.intervalMs) {
        this.state.intervalMs = wantedIntervalMs;
        this.schedule(wantedIntervalMs);
      }

      const rotation = this.normalizeRotation(cfg.rotation);
      const action = rotation[this.state.rotationIdx % rotation.length]!;
      this.state.rotationIdx++;

      const id = `a:${Date.now().toString(36)}`;
      const startedAt = new Date().toISOString();
      let queryOrMode = "";
      let emitted = 0;
      let costUsd = 0;
      let error: string | undefined;

      try {
        if (action === "thalamus") {
          const query =
            THALAMUS_QUERIES[this.state.queryIdx % THALAMUS_QUERIES.length]!;
          this.state.queryIdx++;
          queryOrMode = query;
          this.state.currentTick = {
            id,
            action,
            queryOrMode,
            startedAt,
            completedAt: "",
            emitted: 0,
            costUsd: 0,
          };
          const result = await this.cycles.runThalamus(query);
          emitted = result.emitted;
          costUsd = result.costUsd;
        } else if (action === "sweep-nullscan") {
          queryOrMode = "nullScan(20 operator-countries)";
          this.state.currentTick = {
            id,
            action,
            queryOrMode,
            startedAt,
            completedAt: "",
            emitted: 0,
            costUsd: 0,
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
            costUsd: 0,
          };
          emitted = await this.cycles.runBriefing(5);
        }
      } catch (err) {
        error = err instanceof Error ? err.message : String(err);
        this.logger.error({ err: error, action }, "autonomy tick failed");
      }

      this.ledger.record(costUsd, action === "thalamus" ? 1 : 0);

      const tick: AutonomyTick = {
        id,
        action,
        queryOrMode,
        startedAt,
        completedAt: new Date().toISOString(),
        emitted,
        costUsd,
        ...(error && { error }),
      };
      this.state.history.unshift(tick);
      if (this.state.history.length > 40) this.state.history.pop();
      this.state.currentTick = null;
      this.state.tickCount++;

      const stopReason = this.evaluateCaps(cfg);
      if (stopReason && cfg.stopOnBudgetExhausted) {
        this.stop(stopReason);
      }
    } catch (err) {
      this.logger.error(
        { err: err instanceof Error ? err.message : String(err) },
        "autonomy tick setup failed",
      );
    } finally {
      this.state.busy = false;
    }
  }

  private normalizeRotation(rotation: string[]): AutonomyAction[] {
    const filtered = rotation.filter(
      (action): action is AutonomyAction =>
        action === "thalamus" ||
        action === "sweep-nullscan" ||
        action === "fish-swarm",
    );
    return filtered.length > 0 ? filtered : ROTATION_FALLBACK;
  }

  private evaluateCaps(
    cfg: ConsoleAutonomyConfig,
  ): AutonomyState["stoppedReason"] {
    if (cfg.dailyBudgetUsd > 0 && this.ledger.dailyUsd() >= cfg.dailyBudgetUsd) {
      return "daily_budget_exhausted";
    }
    if (
      cfg.monthlyBudgetUsd > 0 &&
      this.ledger.monthlyUsd() >= cfg.monthlyBudgetUsd
    ) {
      return "monthly_budget_exhausted";
    }
    if (
      cfg.maxThalamusCyclesPerDay > 0 &&
      this.ledger.cyclesInDay() >= cfg.maxThalamusCyclesPerDay
    ) {
      return "max_thalamus_cycles_per_day";
    }
    return null;
  }
}
