// apps/console-api/src/services/cycle-runner.service.ts
import type { FastifyBaseLogger } from "fastify";
import type { CycleKind, CycleRun } from "../types";

const TRIGGER_USER = "user" as const;

export interface ThalamusDep {
  thalamusService: {
    runCycle(args: {
      query: string;
      triggerType: never;
      triggerSource: string;
    }): Promise<{ findingsCount?: number | null }>;
  };
}

export interface SweepDep {
  nanoSweepService: {
    sweep(
      limit: number,
      mode: string,
    ): Promise<{ suggestionsStored?: number | null }>;
  };
}

export class CycleRunnerService {
  private history: CycleRun[] = [];

  constructor(
    private readonly thalamus: ThalamusDep,
    private readonly sweep: SweepDep,
    private readonly logger: FastifyBaseLogger,
  ) {}

  listHistory(): CycleRun[] {
    // Defensive copy — callers (controllers, tests) should not be able to
    // mutate internal history by reference.
    return [...this.history];
  }

  async runThalamus(query: string): Promise<number> {
    const cycle = await this.thalamus.thalamusService.runCycle({
      query,
      triggerType: TRIGGER_USER as unknown as never,
      triggerSource: "console-ui",
    });
    return cycle.findingsCount ?? 0;
  }

  async runFish(): Promise<number> {
    const result = await this.sweep.nanoSweepService.sweep(20, "nullScan");
    return result.suggestionsStored ?? 0;
  }

  async runBriefing(limit: number): Promise<number> {
    const r = await this.sweep.nanoSweepService.sweep(limit, "briefing");
    return r.suggestionsStored ?? 0;
  }

  async runUserCycle(
    kind: CycleKind,
    query: string,
  ): Promise<{ cycle: CycleRun }> {
    const startedAt = new Date().toISOString();
    const id = `cyc:${Date.now().toString(36)}`;
    try {
      let emitted = 0;
      const cortices: string[] = [];
      if (kind === "thalamus" || kind === "both") {
        emitted += await this.runThalamus(query);
        cortices.push("thalamus");
      }
      if (kind === "fish" || kind === "both") {
        emitted += await this.runFish();
        cortices.push("nano-sweep");
      }
      const run: CycleRun = {
        id,
        kind,
        startedAt,
        completedAt: new Date().toISOString(),
        findingsEmitted: emitted,
        cortices,
      };
      this.pushHistory(run);
      return { cycle: run };
    } catch (err) {
      const errMsg = err instanceof Error ? err.message : String(err);
      this.logger.error({ err: errMsg, kind }, "cycle run failed");
      const run: CycleRun = {
        id,
        kind,
        startedAt,
        completedAt: new Date().toISOString(),
        findingsEmitted: 0,
        cortices: [],
        error: errMsg,
      };
      this.pushHistory(run);
      // Failure info travels on `cycle.error`; the controller promotes it to a
      // 500 status. Returning a single shape keeps the contract flat.
      return { cycle: run };
    }
  }

  private pushHistory(run: CycleRun): void {
    this.history.unshift(run);
    if (this.history.length > 20) this.history.pop();
  }
}
