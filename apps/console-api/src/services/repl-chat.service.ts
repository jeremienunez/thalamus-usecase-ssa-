// apps/console-api/src/services/repl-chat.service.ts
import { createLlmTransportWithMode } from "@interview/thalamus";
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

export type ChatResponse = {
  kind: "chat";
  text: string;
  provider: string;
  tookMs: number;
};

export class ReplChatService {
  constructor(private readonly thalamus: ThalamusChatDep) {}

  async handle(input: string): Promise<ChatResponse> {
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

    if (intent.action === "chat") {
      const transport = createLlmTransportWithMode(CONSOLE_CHAT_SYSTEM_PROMPT);
      const response = await transport.call(input);
      return {
        kind: "chat",
        text: response.content,
        provider: response.provider,
        tookMs: Date.now() - t0,
      };
    }

    const cycle = await this.thalamus.thalamusService.runCycle({
      query: intent.query,
      triggerType: TRIGGER_USER as unknown as never,
      triggerSource: "console-chat",
    });
    const findings = await this.thalamus.findingRepo.findByCycleId(cycle.id);
    const top = findings.slice(0, 8).map((f) => ({
      id: String(f.id),
      title: f.title ?? f.summary?.slice(0, 80) ?? "(no title)",
      summary: f.summary?.slice(0, 300) ?? null,
      cortex: f.cortex,
      urgency: f.urgency,
      confidence: Number(f.confidence ?? 0),
    }));
    const summariser = createLlmTransportWithMode(summariserPrompt(input));
    const payload = JSON.stringify(
      { cycleId: String(cycle.id), findings: top },
      null,
      2,
    );
    const summary = await summariser.call(payload);
    return {
      kind: "chat",
      text:
        `▶ dispatched Thalamus cycle (${findings.length} finding${findings.length === 1 ? "" : "s"})\n\n` +
        summary.content,
      provider: summary.provider,
      tookMs: Date.now() - t0,
    };
  }
}
