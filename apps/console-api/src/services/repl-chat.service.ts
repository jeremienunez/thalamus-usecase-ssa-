// apps/console-api/src/services/repl-chat.service.ts
//
// Thin orchestrator for the console REPL stream. Given a user input, it
// asks the intent classifier which branch to take, then stitches the
// appropriate collaborators into a single event stream:
//   - chat branch:      classified → chat.complete → done
//   - run_cycle branch: classified → cycle.start → step* → finding* →
//                        summary.complete → done
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

export interface ThalamusChatDep {
  thalamusService: {
    runCycle(args: {
      query: string;
      userId?: bigint;
      triggerType: ResearchCycleTrigger;
      triggerSource: string;
    }): Promise<{ id: bigint | string }>;
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
  ) {}

  async *handleStream(
    input: string,
    userId?: bigint,
    signal?: AbortSignal,
  ): AsyncGenerator<ReplStreamEvent> {
    const t0 = Date.now();
    const aborted = (): boolean => signal?.aborted === true;

    const intent = await this.classifier.classify(input);
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
      const { text, provider } = await this.chatReply.reply(input);
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
      }),
    );

    // Relay each step event; the generator's final `return` carries the
    // cycle's terminal state ({result, err}). Stop early if the client
    // disconnected — further LLM/cortex work would be pure token waste.
    let cycleResultId: string | bigint = cycleId;
    let cycleErr: Error | null = null;
    for (;;) {
      if (aborted()) return;
      const next = await pumpGen.next();
      if (next.done === true) {
        cycleErr = next.value.err;
        if (next.value.result) cycleResultId = next.value.result.id;
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
    );
    if (aborted()) return;
    yield {
      event: "summary.complete",
      data: { text: summary.text, provider: summary.provider },
    };

    yield {
      event: "done",
      data: {
        provider: summary.provider,
        costUsd: 0,
        tookMs: Date.now() - t0,
        findingsCount: findings.length,
      },
    };
  }
}
