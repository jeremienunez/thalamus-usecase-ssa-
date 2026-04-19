import type { ReplStreamEvent } from "@interview/shared";
import type { ReplFindingSummaryView } from "../types/repl-chat.types";
import type {
  FollowUpPlan,
  FollowUpVerification,
} from "../agent/ssa/followup";
import {
  SsaReplFollowUpExecutor,
  SsaReplFollowUpPolicy,
} from "../agent/ssa/followup";

export class ReplFollowUpService {
  constructor(
    private readonly policy: SsaReplFollowUpPolicy,
    private readonly executor: SsaReplFollowUpExecutor,
  ) {}

  async plan(input: {
    query: string;
    parentCycleId: string;
    verification: FollowUpVerification | undefined;
    findings: ReplFindingSummaryView[];
  }): Promise<FollowUpPlan> {
    return this.policy.plan(input);
  }

  async *executeAutoLaunched(input: {
    plan: FollowUpPlan;
    query: string;
    userId?: bigint;
    parentCycleId: string;
    signal?: AbortSignal;
  }): AsyncGenerator<ReplStreamEvent> {
    yield* this.executor.executeAutoLaunched(input);
  }
}
