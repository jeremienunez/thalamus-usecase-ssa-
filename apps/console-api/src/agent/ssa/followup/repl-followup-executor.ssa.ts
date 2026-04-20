import type { ReplFollowUpPlanItem, ReplStreamEvent } from "@interview/shared";
import { ResearchCycleTrigger } from "@interview/shared";
import type { CycleStreamPump } from "../../../services/cycle-stream-pump.service";
import type { CycleSummariser } from "../../../services/cycle-summariser.service";
import {
  toReplFindingStreamView,
  toReplFindingSummaryView,
} from "../../../transformers/repl-chat.transformer";
import type {
  ChildCycleResult,
  FollowUpPlan,
  SsaReplFollowUpDeps,
} from "./repl-followup.types.ssa";

export class SsaReplFollowUpExecutor {
  constructor(
    private readonly deps: SsaReplFollowUpDeps,
    private readonly pump: CycleStreamPump,
    private readonly summariser: CycleSummariser,
  ) {}

  async *executeAutoLaunched(input: {
    plan: FollowUpPlan;
    query: string;
    userId?: bigint;
    parentCycleId: string;
    signal?: AbortSignal;
  }): AsyncGenerator<ReplStreamEvent> {
    for (const item of input.plan.autoLaunched) {
      yield* this.executeItem(item, input);
    }
  }

  async *executeSelected(input: {
    item: ReplFollowUpPlanItem;
    query: string;
    userId?: bigint;
    parentCycleId: string;
    signal?: AbortSignal;
  }): AsyncGenerator<ReplStreamEvent> {
    yield* this.executeItem(input.item, input);
  }

  private async *executeItem(
    item: ReplFollowUpPlanItem,
    input: {
      query: string;
      userId?: bigint;
      parentCycleId: string;
      signal?: AbortSignal;
    },
  ): AsyncGenerator<ReplStreamEvent> {
    if (input.signal?.aborted) return;
    yield {
      event: "followup.started",
      data: {
        parentCycleId: input.parentCycleId,
        followupId: item.followupId,
        kind: item.kind,
        auto: item.auto,
        title: item.title,
      },
    };

    switch (item.kind) {
      case "deep_research_30d":
        yield* this.executeDeepResearch(item, input);
        break;
      case "sim_pc_verification":
        yield* this.executePcVerification(item, input);
        break;
      case "sim_telemetry_verification":
        yield* this.executeTelemetryVerification(item, input);
        break;
      case "sweep_targeted_audit":
        yield* this.executeTargetedSweep(item, input);
        break;
    }
  }

  private async *executeDeepResearch(
    item: ReplFollowUpPlanItem,
    input: {
      query: string;
      userId?: bigint;
      parentCycleId: string;
      signal?: AbortSignal;
    },
  ): AsyncGenerator<ReplStreamEvent> {
    const startedAt = Date.now();
    const query = build30DayQuery(input.query, input.parentCycleId);
    const pumpGen = this.pump.pump(() =>
      this.deps.thalamusService.runCycle({
        query,
        userId: input.userId,
        triggerType: ResearchCycleTrigger.User,
        triggerSource: `console-followup:30d:${input.parentCycleId}`,
      }),
    );

    let result: ChildCycleResult | null = null;
    let err: Error | null = null;
    for (;;) {
      if (input.signal?.aborted) return;
      const next = await pumpGen.next();
      if (next.done === true) {
        result = next.value.result;
        err = next.value.err;
        break;
      }
      yield {
        event: "followup.step",
        data: {
          parentCycleId: input.parentCycleId,
          followupId: item.followupId,
          kind: item.kind,
          auto: item.auto,
          ...next.value,
        },
      };
    }

    if (err || !result) {
      yield {
        event: "followup.done",
        data: {
          parentCycleId: input.parentCycleId,
          followupId: item.followupId,
          kind: item.kind,
          auto: item.auto,
          provider: "unknown",
          tookMs: Date.now() - startedAt,
          status: "failed",
        },
      };
      return;
    }

    const findings = await this.deps.findingRepo.findByCycleId(result.id);
    const top = findings.slice(0, 10);
    for (const finding of top) {
      yield {
        event: "followup.finding",
        data: {
          parentCycleId: input.parentCycleId,
          followupId: item.followupId,
          kind: item.kind,
          auto: item.auto,
          ...toReplFindingStreamView(finding),
        },
      };
    }

    const summary = await this.summariser.summarise(
      query,
      String(result.id),
      top.map(toReplFindingSummaryView),
    );
    yield {
      event: "followup.summary",
        data: {
          parentCycleId: input.parentCycleId,
          followupId: item.followupId,
          kind: item.kind,
          auto: item.auto,
          text: summary.text,
          provider: summary.provider,
        },
    };
    yield {
      event: "followup.done",
        data: {
          parentCycleId: input.parentCycleId,
          followupId: item.followupId,
          kind: item.kind,
          auto: item.auto,
          provider: summary.provider,
          tookMs: Date.now() - startedAt,
          status: "completed",
      },
    };
  }

  private async *executePcVerification(
    item: ReplFollowUpPlanItem,
    input: {
      parentCycleId: string;
      signal?: AbortSignal;
    },
  ): AsyncGenerator<ReplStreamEvent> {
    if (!this.deps.sim?.launcher || !this.deps.sim?.swarm) {
      yield* this.failUnavailable(item, input.parentCycleId);
      return;
    }
    const conjunctionId = Number(
      item.target?.refs?.conjunctionId ?? item.target?.entityId,
    );
    if (!Number.isFinite(conjunctionId)) {
      yield* this.failUnavailable(item, input.parentCycleId);
      return;
    }

    const startedAt = Date.now();
    const fishCount = item.gateScore >= 0.85 ? 50 : undefined;
    const launch = this.pump.pump(() =>
      this.deps.sim!.launcher.startPc({ conjunctionId, fishCount }),
    );

    let swarmId: number | null = null;
    let err: Error | null = null;
    for (;;) {
      if (input.signal?.aborted) return;
      const next = await launch.next();
      if (next.done === true) {
        swarmId = next.value.result?.swarmId ?? null;
        err = next.value.err;
        break;
      }
      yield {
        event: "followup.step",
        data: {
          parentCycleId: input.parentCycleId,
          followupId: item.followupId,
          kind: item.kind,
          auto: item.auto,
          step: next.value.step === "unknown" ? "swarm" : next.value.step,
          phase: next.value.phase,
          terminal: next.value.terminal,
          elapsedMs: next.value.elapsedMs,
          extra: next.value.extra,
        },
      };
    }

    if (err || swarmId === null) {
      yield {
        event: "followup.done",
        data: {
          parentCycleId: input.parentCycleId,
          followupId: item.followupId,
          kind: item.kind,
          auto: item.auto,
          provider: "system",
          tookMs: Date.now() - startedAt,
          status: "failed",
        },
      };
      return;
    }

    yield* this.awaitSwarmTerminal(
      item,
      input.parentCycleId,
      swarmId,
      startedAt,
      input.signal,
    );
  }

  private async *executeTelemetryVerification(
    item: ReplFollowUpPlanItem,
    input: {
      parentCycleId: string;
      signal?: AbortSignal;
    },
  ): AsyncGenerator<ReplStreamEvent> {
    if (!this.deps.sim?.launcher || !this.deps.sim?.swarm) {
      yield* this.failUnavailable(item, input.parentCycleId);
      return;
    }
    const satelliteId = Number(
      item.target?.refs?.satelliteId ?? item.target?.entityId,
    );
    if (!Number.isFinite(satelliteId)) {
      yield* this.failUnavailable(item, input.parentCycleId);
      return;
    }

    const startedAt = Date.now();
    const fishCount = item.gateScore >= 0.85 ? 50 : undefined;
    const launch = this.pump.pump(() =>
      this.deps.sim!.launcher.startTelemetry({ satelliteId, fishCount }),
    );

    let swarmId: number | null = null;
    let err: Error | null = null;
    for (;;) {
      if (input.signal?.aborted) return;
      const next = await launch.next();
      if (next.done === true) {
        swarmId = next.value.result?.swarmId ?? null;
        err = next.value.err;
        break;
      }
      yield {
        event: "followup.step",
        data: {
          parentCycleId: input.parentCycleId,
          followupId: item.followupId,
          kind: item.kind,
          auto: item.auto,
          step: next.value.step === "unknown" ? "swarm" : next.value.step,
          phase: next.value.phase,
          terminal: next.value.terminal,
          elapsedMs: next.value.elapsedMs,
          extra: next.value.extra,
        },
      };
    }

    if (err || swarmId === null) {
      yield {
        event: "followup.done",
        data: {
          parentCycleId: input.parentCycleId,
          followupId: item.followupId,
          kind: item.kind,
          auto: item.auto,
          provider: "system",
          tookMs: Date.now() - startedAt,
          status: "failed",
        },
      };
      return;
    }

    yield* this.awaitSwarmTerminal(
      item,
      input.parentCycleId,
      swarmId,
      startedAt,
      input.signal,
    );
  }

  private async *executeTargetedSweep(
    item: ReplFollowUpPlanItem,
    input: {
      parentCycleId: string;
      signal?: AbortSignal;
    },
  ): AsyncGenerator<ReplStreamEvent> {
    if (
      !this.deps.sweep?.nanoSweepService ||
      item.target?.entityType !== "operator_country"
    ) {
      yield* this.failUnavailable(item, input.parentCycleId);
      return;
    }
    const startedAt = Date.now();
    const result = await this.deps.sweep.nanoSweepService.sweep(1, "nullScan", {
      entityType: item.target.entityType ?? undefined,
      entityIds: item.target.entityId ? [item.target.entityId] : undefined,
      reasonCodes: item.reasonCodes,
      parentCycleId: input.parentCycleId,
    });
    if (input.signal?.aborted) return;

    yield {
      event: "followup.summary",
        data: {
          parentCycleId: input.parentCycleId,
          followupId: item.followupId,
          kind: item.kind,
          auto: item.auto,
          text:
            `Targeted sweep audit stored ${result.suggestionsStored} suggestion(s) ` +
            `for ${item.target.entityType} ${item.target.entityId}.`,
        provider: "system",
      },
    };
    yield {
      event: "followup.done",
        data: {
          parentCycleId: input.parentCycleId,
          followupId: item.followupId,
          kind: item.kind,
          auto: item.auto,
          provider: "system",
          tookMs: Date.now() - startedAt,
          status: "completed",
      },
    };
  }

  private async *awaitSwarmTerminal(
    item: ReplFollowUpPlanItem,
    parentCycleId: string,
    swarmId: number,
    startedAt: number,
    signal?: AbortSignal,
  ): AsyncGenerator<ReplStreamEvent> {
    const swarmIdBig = BigInt(swarmId);
    for (;;) {
      if (signal?.aborted) return;
      const [swarm, counts] = await Promise.all([
        this.deps.sim!.swarm.findById(swarmIdBig),
        this.deps.sim!.swarm.countFishByStatus(swarmIdBig),
      ]);
      if (!swarm) {
        yield* this.failUnavailable(item, parentCycleId);
        return;
      }

      yield {
        event: "followup.step",
        data: {
          parentCycleId,
          followupId: item.followupId,
          kind: item.kind,
          auto: item.auto,
          step: "swarm",
          phase:
            swarm.status === "done"
              ? "done"
              : swarm.status === "failed"
                ? "error"
                : "start",
          terminal:
            swarm.status === "done"
              ? "🏁"
              : swarm.status === "failed"
                ? "⚠️"
                : "🐟",
          elapsedMs: Date.now() - startedAt,
          extra: {
            swarmId,
            status: swarm.status,
            counts,
          },
        },
      };

      if (swarm.status === "done" || swarm.status === "failed") {
        if (swarm.outcomeReportFindingId && this.deps.findingRepo.findById) {
          const finding = await this.deps.findingRepo.findById(
            swarm.outcomeReportFindingId,
          );
          if (finding) {
            yield {
              event: "followup.finding",
              data: {
                parentCycleId,
                followupId: item.followupId,
                kind: item.kind,
                auto: item.auto,
                id: String(finding.id),
                title: finding.title,
                summary: finding.summary,
                cortex: finding.cortex,
                urgency: null,
                confidence: finding.confidence,
              },
            };
            yield {
              event: "followup.summary",
              data: {
                parentCycleId,
                followupId: item.followupId,
                kind: item.kind,
                auto: item.auto,
                text: finding.summary,
                provider: "system",
              },
            };
          }
        }
        if (!swarm.outcomeReportFindingId) {
          yield {
            event: "followup.summary",
            data: {
              parentCycleId,
              followupId: item.followupId,
              kind: item.kind,
              auto: item.auto,
              text:
                `Verification swarm ${swarmId} finished with status ${swarm.status}. ` +
                `Done=${counts.done}, failed=${counts.failed}, pending=${counts.pending}.`,
              provider: "system",
            },
          };
        }
        yield {
          event: "followup.done",
          data: {
            parentCycleId,
            followupId: item.followupId,
            kind: item.kind,
            auto: item.auto,
            provider: "system",
            tookMs: Date.now() - startedAt,
            status: swarm.status === "done" ? "completed" : "failed",
          },
        };
        return;
      }

      await sleep(1000, signal);
    }
  }

  private async *failUnavailable(
    item: ReplFollowUpPlanItem,
    parentCycleId: string,
  ): AsyncGenerator<ReplStreamEvent> {
    yield {
      event: "followup.summary",
      data: {
        parentCycleId,
        followupId: item.followupId,
        kind: item.kind,
        auto: item.auto,
        text: `Follow-up ${item.kind} is unavailable in this runtime.`,
        provider: "system",
      },
    };
    yield {
      event: "followup.done",
      data: {
        parentCycleId,
        followupId: item.followupId,
        kind: item.kind,
        auto: item.auto,
        provider: "system",
        tookMs: 0,
        status: "failed",
      },
    };
  }
}

function build30DayQuery(query: string, parentCycleId: string): string {
  return (
    `${query}\n\n` +
    `Verification follow-up for parent cycle ${parentCycleId}. ` +
    `Extend the horizon to 30 days, corroborate the highest-risk findings, ` +
    `and focus on operator-scoped conclusions where attribution is explicit.`
  );
}

async function sleep(ms: number, signal?: AbortSignal): Promise<void> {
  if (signal?.aborted) return;
  await new Promise<void>((resolve) => {
    const timer = setTimeout(() => {
      signal?.removeEventListener("abort", onAbort);
      resolve();
    }, ms);
    const onAbort = (): void => {
      clearTimeout(timer);
      signal?.removeEventListener("abort", onAbort);
      resolve();
    };
    signal?.addEventListener("abort", onAbort, { once: true });
  });
}
