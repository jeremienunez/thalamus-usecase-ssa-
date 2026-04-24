// apps/console-api/src/services/repl-chat.service.ts
//
// Thin orchestrator for the console REPL stream. Given a user input, it
// asks the intent classifier which branch to take, then stitches the
// appropriate collaborators into a single event stream:
//   - chat branch:      classified → chat.complete → done
//   - run_cycle branch: classified → cycle.start → step* → finding* →
//                        summary.complete → followup* → briefing? → done
//                       (or …→ error → done on cycle failure)
//
// All LLM work sits behind the `LlmTransportFactory` port, so the service
// and its collaborators never import the thalamus transport directly —
// the concrete factory is wired in `container.ts`.
import { ResearchCycleTrigger } from "@interview/shared/enum";
import type { ReplStreamEvent } from "@interview/shared";
import {
  toReplFindingStreamView,
  toReplFindingSummaryView,
} from "../transformers/repl-chat.transformer";
import type { IntentClassifier } from "./intent-classifier.service";
import type { ChatReplyService } from "./chat-reply.service";
import type { CycleStreamPump } from "./cycle-stream-pump.service";
import type { CycleSummariser } from "./cycle-summariser.service";
import type {
  ReplBriefingAggregator,
  ReplBriefingFollowUpInput,
} from "./repl-briefing-aggregator.service";
import type { ReplFollowUpService } from "./repl-followup.service";

export interface ThalamusChatDep {
  thalamusService: {
    runCycle(args: {
      query: string;
      userId?: bigint;
      triggerType: ResearchCycleTrigger;
      triggerSource: string;
      signal?: AbortSignal;
    }): Promise<{
      id: bigint | string;
      verification?: {
        needsVerification: boolean;
        reasonCodes: string[];
        confidence: number;
        targetHints?: Array<{
          entityType: string | null;
          entityId: bigint | string | null;
          sourceCortex: string | null;
          sourceTitle: string | null;
          confidence: number | null;
        }>;
      };
    }>;
  };
  findingRepo: {
    findByCycleId(
      id: bigint | string,
    ): Promise<
      Array<{
        id: bigint | string;
        title?: string;
        summary?: string;
        cortex?: string;
        findingType?: string;
        urgency?: string;
        confidence?: number | null;
      }>
    >;
  };
}

export class ReplChatService {
  constructor(
    private readonly deps: ThalamusChatDep,
    private readonly classifier: IntentClassifier,
    private readonly chatReply: ChatReplyService,
    private readonly pump: CycleStreamPump,
    private readonly summariser: CycleSummariser,
    private readonly followUps?: ReplFollowUpService,
    private readonly briefingAggregator?: ReplBriefingAggregator,
  ) {}

  async *handleStream(
    input: string,
    userId?: bigint,
    signal?: AbortSignal,
  ): AsyncGenerator<ReplStreamEvent> {
    const t0 = Date.now();
    const aborted = (): boolean => signal?.aborted === true;

    const intent = await this.classifier.classify(input, signal);
    if (aborted()) return;

    yield {
      event: "classified",
      data:
        intent.action === "run_cycle"
          ? { action: "run_cycle", query: intent.query }
          : { action: "chat" },
    };

    if (intent.action === "chat") {
      if (aborted()) return;
      const { text, provider } = await this.chatReply.reply(input, signal);
      if (aborted()) return;
      yield { event: "chat.complete", data: { text, provider } };
      yield {
        event: "done",
        data: {
          provider,
          costUsd: 0,
          tookMs: Date.now() - t0,
          findingsCount: 0,
        },
      };
      return;
    }

    // --- run_cycle ---
    const query = intent.query;
    const cycleId = `cyc:${Date.now().toString(36)}`;
    yield { event: "cycle.start", data: { cycleId, query } };

    const pumpGen = this.pump.pump(() =>
      this.deps.thalamusService.runCycle({
        query,
        userId,
        triggerType: ResearchCycleTrigger.User,
        triggerSource: "console-chat",
        ...(signal ? { signal } : {}),
      }),
    );

    // Relay each step event; the generator's final `return` carries the
    // cycle's terminal state ({result, err}). Stop early if the client
    // disconnected — further LLM/cortex work would be pure token waste.
    let cycleResultId: string | bigint = cycleId;
    let cycleResult:
      | {
          id: bigint | string;
          verification?: {
            needsVerification: boolean;
            reasonCodes: string[];
            confidence: number;
            targetHints?: Array<{
              entityType: string | null;
              entityId: bigint | string | null;
              sourceCortex: string | null;
              sourceTitle: string | null;
              confidence: number | null;
            }>;
          };
        }
      | null = null;
    let cycleErr: Error | null = null;
    for (;;) {
      if (aborted()) return;
      const next = await pumpGen.next();
      if (next.done === true) {
        cycleErr = next.value.err;
        if (next.value.result) {
          cycleResult = next.value.result;
          cycleResultId = next.value.result.id;
        }
        break;
      }
      const stepData = next.value;
      yield { event: "step", data: stepData };
    }
    if (aborted()) return;

    if (cycleErr) {
      yield { event: "error", data: { message: cycleErr.message } };
      yield {
        event: "done",
        data: {
          // No summariser call happened — we genuinely don't know which
          // provider would have served this turn. "unknown" is honest
          // and the UI renders it as-is (vs. falsely attributing to Kimi).
          provider: "unknown",
          costUsd: 0,
          tookMs: Date.now() - t0,
          findingsCount: 0,
        },
      };
      return;
    }

    const findings = await this.deps.findingRepo.findByCycleId(cycleResultId);
    if (aborted()) return;
    // Keep the payload bounded while preserving the repo's confidence-sorted
    // cycle view. The summariser prompt treats these findings as unordered.
    const top = findings.slice(0, 25);
    for (const f of top) {
      if (aborted()) return;
      yield { event: "finding", data: toReplFindingStreamView(f) };
    }

    if (aborted()) return;
    const summary = await this.summariser.summarise(
      query,
      String(cycleResultId),
      top.map(toReplFindingSummaryView),
      signal,
    );
    if (aborted()) return;
    yield {
      event: "summary.complete",
      data: { text: summary.text, provider: summary.provider },
    };

    let terminalProvider = summary.provider;
    const followUpRuns = new Map<string, ReplBriefingFollowUpInput>();

    if (this.followUps && cycleResult) {
      const plan = await this.followUps.plan({
        query,
        parentCycleId: String(cycleResultId),
        verification: cycleResult.verification,
        findings: findings.map(toReplFindingSummaryView),
      });
      yield {
        event: "followup.plan",
        data: {
          parentCycleId: String(cycleResultId),
          autoLaunched: plan.autoLaunched,
          proposed: plan.proposed,
          dropped: plan.dropped,
        },
      };
      for await (const evt of this.followUps.executeAutoLaunched({
        plan,
        query,
        userId,
        parentCycleId: String(cycleResultId),
        signal,
      })) {
        if (aborted()) return;
        collectFollowUpForBriefing(followUpRuns, evt);
        yield evt;
      }
    }

    if (this.briefingAggregator && cycleResult) {
      const briefing = await this.briefingAggregator.aggregate(
        {
          query,
          parentCycleId: String(cycleResultId),
          parent: {
            summary: summary.text,
            findings: top.map(toReplFindingSummaryView),
          },
          followUps: [...followUpRuns.values()],
        },
        signal,
      );
      if (aborted()) return;
      terminalProvider = briefing.provider;
      yield { event: "briefing.complete", data: briefing };
    }

    yield {
      event: "done",
      data: {
        provider: terminalProvider,
        costUsd: 0,
        tookMs: Date.now() - t0,
        findingsCount: findings.length,
      },
    };
  }
}

function collectFollowUpForBriefing(
  runs: Map<string, ReplBriefingFollowUpInput>,
  event: ReplStreamEvent,
): void {
  switch (event.event) {
    case "followup.started": {
      const run = getOrCreateFollowUpRun(runs, event.data.followupId);
      run.kind = event.data.kind;
      run.title = event.data.title;
      run.status = "running";
      break;
    }
    case "followup.finding": {
      const run = getOrCreateFollowUpRun(runs, event.data.followupId);
      run.kind = event.data.kind;
      run.findings.push({
        id: event.data.id,
        title: event.data.title,
        summary: event.data.summary,
        cortex: event.data.cortex,
        findingType: null,
        urgency: event.data.urgency,
        confidence: event.data.confidence,
      });
      break;
    }
    case "followup.summary": {
      const run = getOrCreateFollowUpRun(runs, event.data.followupId);
      run.kind = event.data.kind;
      run.summary = event.data.text;
      break;
    }
    case "followup.done": {
      const run = getOrCreateFollowUpRun(runs, event.data.followupId);
      run.kind = event.data.kind;
      run.status = event.data.status;
      break;
    }
    default:
      break;
  }
}

function getOrCreateFollowUpRun(
  runs: Map<string, ReplBriefingFollowUpInput>,
  followupId: string,
): ReplBriefingFollowUpInput {
  const existing = runs.get(followupId);
  if (existing) return existing;
  const created: ReplBriefingFollowUpInput = {
    followupId,
    kind: "unknown",
    title: followupId,
    status: "running",
    summary: "",
    findings: [],
  };
  runs.set(followupId, created);
  return created;
}
