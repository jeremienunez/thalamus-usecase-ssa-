import { describe, it, expect, vi, beforeEach } from "vitest";
import type { ReplStreamEvent } from "@interview/shared";

// Module-scoped steerable mock outputs — each test overwrites in beforeEach.
let classifierContent = JSON.stringify({ action: "chat" });
let summariserContent = "summary";
let chatContent = "chat-reply";
let lastSystemPrompt = "";
let lastSummariserPayload = "";

vi.mock("@interview/thalamus", async () => {
  const actual = await vi.importActual<typeof import("@interview/thalamus")>(
    "@interview/thalamus",
  );
  return {
    ...actual,
    createLlmTransportWithMode: (sys: string) => ({
      call: async (input: string) => {
        lastSystemPrompt = sys;
        if (sys.includes("intent router"))
          return { content: classifierContent, provider: "kimi" };
        if (sys.includes("final synthesis briefer")) {
          lastSummariserPayload = input;
          return { content: summariserContent, provider: "kimi" };
        }
        return { content: chatContent, provider: "kimi" };
      },
    }),
  };
});

// Import AFTER vi.mock so the mocked transport is bound.
import { ReplChatService } from "../../../src/services/repl-chat.service";
import { IntentClassifier } from "../../../src/services/intent-classifier.service";
import { ChatReplyService } from "../../../src/services/chat-reply.service";
import { CycleStreamPump } from "../../../src/services/cycle-stream-pump.service";
import { CycleSummariser } from "../../../src/services/cycle-summariser.service";
import { thalamusLlmTransportFactory } from "../../../src/services/llm-transport.adapter";

function buildReplChat(
  deps: ConstructorParameters<typeof ReplChatService>[0],
): ReplChatService {
  const factory = thalamusLlmTransportFactory;
  return new ReplChatService(
    deps,
    new IntentClassifier(factory),
    new ChatReplyService(factory),
    new CycleStreamPump(),
    new CycleSummariser(factory),
  );
}

async function drain(
  gen: AsyncGenerator<ReplStreamEvent>,
): Promise<ReplStreamEvent[]> {
  const out: ReplStreamEvent[] = [];
  for await (const e of gen) out.push(e);
  return out;
}

describe("ReplChatService.handleStream — chat branch", () => {
  beforeEach(() => {
    classifierContent = JSON.stringify({ action: "chat" });
    summariserContent = "summary";
    chatContent = "echo:bonjour";
    lastSystemPrompt = "";
    lastSummariserPayload = "";
  });

  it("emits classified → chat.complete → done when classifier routes to chat", async () => {
    const svc = buildReplChat({
      thalamusService: { runCycle: vi.fn() as never },
      findingRepo: { findByCycleId: vi.fn() as never },
    });

    const events = await drain(svc.handleStream("bonjour"));
    const types = events.map((e) => e.event);
    expect(types).toEqual(["classified", "chat.complete", "done"]);

    const [classified, chat, done] = events;
    expect(classified).toMatchObject({
      event: "classified",
      data: { action: "chat" },
    });
    expect(chat).toMatchObject({
      event: "chat.complete",
      data: { text: "echo:bonjour", provider: "kimi" },
    });
    expect(done).toMatchObject({ event: "done", data: { findingsCount: 0 } });
    expect(
      (done as { data: { tookMs: number } }).data.tookMs,
    ).toBeGreaterThanOrEqual(0);
  });
});

import { stepLog } from "@interview/shared";

describe("ReplChatService.handleStream — run_cycle branch", () => {
  beforeEach(() => {
    classifierContent = JSON.stringify({
      action: "run_cycle",
      query: "conjonctions",
    });
    summariserContent = "n=1 finding resume";
    chatContent = "chat unused";
    lastSystemPrompt = "";
    lastSummariserPayload = "";
  });

  it("emits classified → cycle.start → step* → finding* → summary.complete → done", async () => {
    // runCycle emits step events — because CycleStreamPump wraps this call in
    // stepContextStore.run, those events reach the generator via the ALS hook.
    const runCycle = vi.fn(async () => {
      const logger = { info: () => {} } as unknown as Parameters<typeof stepLog>[0];
      stepLog(logger, "cycle", "start", { cycleId: "cyc:42" });
      await Promise.resolve();
      stepLog(logger, "planner", "start");
      stepLog(logger, "planner", "done");
      stepLog(logger, "cortex", "done", { cortex: "catalog" });
      return { id: "cyc:42" };
    });

    const svc = buildReplChat({
      thalamusService: { runCycle } as never,
      findingRepo: {
        findByCycleId: async () => [
          {
            id: "f:1",
            title: "Conjonction serrée",
            summary: "Pc=1.2e-08 for AQUA and BEESAT-1",
            cortex: "catalog",
            findingType: "alert",
            urgency: "medium",
            confidence: 0.82,
          },
        ],
      },
    });

    const events = await drain(svc.handleStream("scan conjonctions", 7n));
    const types = events.map((e) => e.event);
    expect(types[0]).toBe("classified");
    expect(types[1]).toBe("cycle.start");
    expect(types.filter((t) => t === "step").length).toBeGreaterThanOrEqual(3);
    expect(types.filter((t) => t === "finding").length).toBe(1);
    expect(types.at(-2)).toBe("summary.complete");
    expect(types.at(-1)).toBe("done");

    expect(runCycle).toHaveBeenCalledOnce();
    expect(runCycle).toHaveBeenCalledWith({
      query: "conjonctions",
      userId: 7n,
      triggerType: "user",
      triggerSource: "console-chat",
    });
    expect(lastSystemPrompt).toContain('Executed research query: "conjonctions"');
    expect(lastSystemPrompt).toContain(
      'Every bullet must include citations in the exact form "#id: title".',
    );
    expect(lastSystemPrompt).toContain("Do not infer chronology");
    expect(lastSystemPrompt).toContain(
      "Never mention an operator, satellite name, NORAD id, Pc, date, or action unless it appears verbatim in the payload.",
    );

    const payload = JSON.parse(lastSummariserPayload) as {
      cycleId: string;
      findings: Array<{ summary: string | null; findingType: string | null }>;
    };
    expect(payload.cycleId).toBe("cyc:42");
    expect(payload.findings).toHaveLength(1);
    expect(payload.findings[0]).toMatchObject({
      summary: "Pc=1.2e-08 for AQUA and BEESAT-1",
      findingType: "alert",
    });
  });
});
