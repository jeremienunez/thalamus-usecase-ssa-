// apps/console-api/src/services/cycle-runner.service.ts
import type { FastifyBaseLogger } from "fastify";
import { ResearchCycleTrigger } from "@interview/shared";
import type { CycleKind, CycleRun, CycleRunFinding } from "../types";
import {
  projectThalamusFinding,
  type ThalamusFindingLike,
} from "../transformers/cycle-run.transformer";

export interface ThalamusDep {
  thalamusService: {
    runCycle(args: {
      query: string;
      triggerType: ResearchCycleTrigger;
      triggerSource: string;
    }): Promise<{
      id?: bigint | number | string;
      findingsCount?: number | null;
      totalCost?: number | null;
    }>;
  };
  graphService: {
    listFindings(opts?: {
      limit?: number;
      minConfidence?: number;
    }): Promise<ThalamusFindingLike[]>;
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

/**
 * Output of a thalamus branch when the cycle runner wants the full
 * CLI-compatible payload. `runThalamus` returns just the autonomy-facing
 * count + cost subset of this shape.
 */
interface ThalamusRunDetail {
  count: number;
  findings: CycleRunFinding[];
  costUsd: number;
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

  async runThalamus(
    query: string,
  ): Promise<{ emitted: number; costUsd: number }> {
    const detail = await this.runThalamusDetail(query);
    return { emitted: detail.count, costUsd: detail.costUsd };
  }

  /**
   * Run a thalamus cycle and return the finding projection the CLI HTTP
   * contract exposes plus the total cost. The autonomous tick path still
   * calls {@link runThalamus} and only sees the count, so the
   * CycleOrchestratorPort surface stays intact.
   *
   * Row → CycleRunFinding shaping is delegated to
   * `projectThalamusFinding` in transformers/cycle-run.transformer — the
   * service stays free of wire-shape concerns.
   */
  private async runThalamusDetail(query: string): Promise<ThalamusRunDetail> {
    const cycle = await this.thalamus.thalamusService.runCycle({
      query,
      triggerType: ResearchCycleTrigger.User,
      triggerSource: "console-ui",
    });
    // Scope findings to the current cycle so stale rows from prior runs
    // don't leak into the response. Fallback: return the full listing so
    // callers don't see a mysteriously empty payload if cycle-id matching
    // misses (bigint/string coercion edge cases, reruns against fixtures).
    const all = await this.thalamus.graphService.listFindings({
      limit: 5,
      minConfidence: 0.5,
    });
    const cycleIdStr = cycle.id !== undefined ? String(cycle.id) : null;
    const scoped =
      cycleIdStr !== null
        ? all.filter((f) => String(f.researchCycleId) === cycleIdStr)
        : all;
    const projected = (scoped.length > 0 ? scoped : all).map(
      projectThalamusFinding,
    );
    return {
      count: cycle.findingsCount ?? 0,
      findings: projected,
      costUsd: cycle.totalCost ?? 0,
    };
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
      let findings: CycleRunFinding[] | undefined;
      let costUsd: number | undefined;
      if (kind === "thalamus" || kind === "both") {
        const t = await this.runThalamusDetail(query);
        emitted += t.count;
        cortices.push("thalamus");
        findings = t.findings;
        costUsd = t.costUsd;
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
        ...(findings !== undefined ? { findings } : {}),
        ...(costUsd !== undefined ? { costUsd } : {}),
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
