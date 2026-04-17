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

  async *handleStream(input: string): AsyncGenerator<ReplStreamEvent> {
    const t0 = Date.now();

    const intent = await this.classifier.classify(input);

    yield {
      event: "classified",
      data:
        intent.action === "run_cycle"
          ? { action: "run_cycle", query: intent.query }
          : { action: "chat" },
    };

    if (intent.action === "chat") {
      const { text, provider } = await this.chatReply.reply(input);
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
        triggerType: ResearchCycleTrigger.User,
        triggerSource: "console-chat",
      }),
    );

    // Relay each step event; the generator's final `return` carries the
    // cycle's terminal state ({result, err}).
    let cycleResultId: string | bigint = cycleId;
    let cycleErr: Error | null = null;
    for (;;) {
      const next = await pumpGen.next();
      if (next.done === true) {
        cycleErr = next.value.err;
        if (next.value.result) cycleResultId = next.value.result.id;
        break;
      }
      const stepData = next.value;
      yield { event: "step", data: stepData };
    }

    if (cycleErr) {
      yield { event: "error", data: { message: cycleErr.message } };
      yield {
        event: "done",
        data: {
          provider: "kimi",
          costUsd: 0,
          tookMs: Date.now() - t0,
          findingsCount: 0,
        },
      };
      return;
    }

    const findings = await this.deps.findingRepo.findByCycleId(cycleResultId);
    // Pass the full cycle to the summariser. Slicing at 8 by confidence DESC
    // was excluding briefing_producer findings (the ones that actually answer
    // the user's query) when strategist self-rated higher. The summariser LLM
    // is responsible for relevance — give it the full picture.
    const top = findings.slice(0, 25);
    for (const f of top) {
      yield { event: "finding", data: toReplFindingStreamView(f) };
    }

    const summary = await this.summariser.summarise(
      input,
      String(cycleResultId),
      top.map(toReplFindingSummaryView),
    );
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
