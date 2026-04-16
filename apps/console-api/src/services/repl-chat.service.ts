// apps/console-api/src/services/repl-chat.service.ts
import { createLlmTransportWithMode } from "@interview/thalamus";
import { stepContextStore } from "@interview/shared";
import type { ReplStreamEvent } from "@interview/shared";
import {
  CONSOLE_CHAT_SYSTEM_PROMPT,
  CLASSIFIER_SYSTEM_PROMPT,
  summariserPrompt,
} from "../prompts/repl-chat.prompt";

const TRIGGER_USER = "user" as const;

export interface ThalamusChatDep {
  thalamusService: {
    runCycle(args: {
      query: string;
      triggerType: never;
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

type StepData = Extract<ReplStreamEvent, { event: "step" }>["data"];

export class ReplChatService {
  constructor(private readonly deps: ThalamusChatDep) {}

  async *handleStream(input: string): AsyncGenerator<ReplStreamEvent> {
    const t0 = Date.now();

    const classifier = createLlmTransportWithMode(CLASSIFIER_SYSTEM_PROMPT);
    const routed = await classifier.call(input);
    let intent: { action: "chat" } | { action: "run_cycle"; query: string };
    try {
      const m = routed.content.match(/\{[\s\S]*\}/);
      intent = m ? JSON.parse(m[0]) : { action: "chat" };
    } catch {
      intent = { action: "chat" };
    }

    yield {
      event: "classified",
      data:
        intent.action === "run_cycle"
          ? { action: "run_cycle", query: intent.query }
          : { action: "chat" },
    };

    if (intent.action === "chat") {
      const chat = createLlmTransportWithMode(CONSOLE_CHAT_SYSTEM_PROMPT);
      const response = await chat.call(input);
      yield {
        event: "chat.complete",
        data: { text: response.content, provider: response.provider },
      };
      yield {
        event: "done",
        data: {
          provider: response.provider,
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

    // Queue-based interleaving: runCycle runs inside stepContextStore.run so
    // every stepLog inside the cycle pushes into `pending`. We alternate
    // between draining the queue and waiting for either a new step or the
    // cycle to finish.
    const pending: StepData[] = [];
    let waiter: (() => void) | null = null;
    const wake = (): void => {
      const w = waiter;
      waiter = null;
      if (w) w();
    };
    const t1 = Date.now();
    const onStep = (e: {
      step: string;
      phase: string;
      terminal: string;
    } & Record<string, unknown>): void => {
      pending.push({
        step: e.step as StepData["step"],
        phase: e.phase as StepData["phase"],
        terminal: e.terminal,
        elapsedMs: Date.now() - t1,
        extra: e,
      });
      wake();
    };

    let cycleDone = false;
    let cycleErr: Error | null = null;
    let cycleResultId: string | bigint = cycleId;

    const cycleP = stepContextStore
      .run({ onStep }, () =>
        this.deps.thalamusService.runCycle({
          query,
          triggerType: TRIGGER_USER as unknown as never,
          triggerSource: "console-chat",
        }),
      )
      .then((r) => {
        cycleResultId = r.id;
      })
      .catch((err: unknown) => {
        cycleErr = err instanceof Error ? err : new Error(String(err));
      })
      .finally(() => {
        cycleDone = true;
        wake();
      });

    while (!cycleDone || pending.length > 0) {
      if (pending.length > 0) {
        yield { event: "step", data: pending.shift()! };
        continue;
      }
      if (cycleDone) break;
      await new Promise<void>((resolve) => {
        waiter = resolve;
      });
    }
    await cycleP;

    if (cycleErr) {
      yield {
        event: "error",
        data: { message: (cycleErr as Error).message },
      };
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
    const top = findings.slice(0, 8);
    for (const f of top) {
      yield {
        event: "finding",
        data: {
          id: String(f.id),
          title: f.title ?? f.summary?.slice(0, 80) ?? "(no title)",
          summary: f.summary?.slice(0, 300) ?? null,
          cortex: f.cortex ?? null,
          urgency: f.urgency ?? null,
          confidence: Number(f.confidence ?? 0),
        },
      };
    }

    const summariser = createLlmTransportWithMode(summariserPrompt(input));
    const payload = JSON.stringify(
      {
        cycleId: String(cycleResultId),
        findings: top.map((f) => ({
          id: String(f.id),
          title: f.title ?? f.summary?.slice(0, 80) ?? "(no title)",
          cortex: f.cortex,
          urgency: f.urgency,
          confidence: Number(f.confidence ?? 0),
        })),
      },
      null,
      2,
    );
    const summary = await summariser.call(payload);
    yield {
      event: "summary.complete",
      data: { text: summary.content, provider: summary.provider },
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
