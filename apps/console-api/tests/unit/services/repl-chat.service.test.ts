import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@interview/thalamus", () => ({
  createLlmTransportWithMode: vi.fn(),
}));

import { createLlmTransportWithMode } from "@interview/thalamus";
import { ReplChatService } from "../../../src/services/repl-chat.service";
import {
  CLASSIFIER_SYSTEM_PROMPT,
  CONSOLE_CHAT_SYSTEM_PROMPT,
  summariserPrompt,
} from "../../../src/prompts/repl-chat.prompt";

function mockDeps() {
  return {
    thalamusService: {
      runCycle: vi.fn(),
    },
    findingRepo: {
      findByCycleId: vi.fn(),
    },
  };
}

function transport(content: string, provider = "mock-provider") {
  return {
    call: vi.fn().mockResolvedValue({ content, provider }),
  };
}

describe("ReplChatService.handle", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("falls back to plain chat when the classifier response is not parseable JSON", async () => {
    const deps = mockDeps();
    const classifier = transport("not json at all", "router");
    const chat = transport("Bonjour, ici l'etat du catalogue.", "chat-model");
    vi.mocked(createLlmTransportWithMode)
      .mockReturnValueOnce(classifier as never)
      .mockReturnValueOnce(chat as never);
    vi.spyOn(Date, "now").mockReturnValueOnce(1_000).mockReturnValueOnce(1_180);

    const result = await new ReplChatService(deps as never).handle("bonjour");

    expect(createLlmTransportWithMode).toHaveBeenNthCalledWith(
      1,
      CLASSIFIER_SYSTEM_PROMPT,
    );
    expect(createLlmTransportWithMode).toHaveBeenNthCalledWith(
      2,
      CONSOLE_CHAT_SYSTEM_PROMPT,
    );
    expect(classifier.call).toHaveBeenCalledWith("bonjour");
    expect(chat.call).toHaveBeenCalledWith("bonjour");
    expect(deps.thalamusService.runCycle).not.toHaveBeenCalled();
    expect(result).toEqual({
      kind: "chat",
      text: "Bonjour, ici l'etat du catalogue.",
      provider: "chat-model",
      tookMs: 180,
    });
    vi.restoreAllMocks();
  });

  it("uses the chat lane when the classifier explicitly returns action=chat", async () => {
    const deps = mockDeps();
    const classifier = transport('{"action":"chat"}', "router");
    const chat = transport("Pas de cycle lance.", "chat-model");
    vi.mocked(createLlmTransportWithMode)
      .mockReturnValueOnce(classifier as never)
      .mockReturnValueOnce(chat as never);

    const result = await new ReplChatService(deps as never).handle("explique le feed");

    expect(result.text).toBe("Pas de cycle lance.");
    expect(deps.thalamusService.runCycle).not.toHaveBeenCalled();
  });

  it("dispatches a Thalamus cycle, summarises the top 8 findings, and prefixes the response", async () => {
    const deps = mockDeps();
    const classifier = transport(
      '{"action":"run_cycle","query":"analyse les anomalies GEO"}',
      "router",
    );
    const summariser = transport("Resume concentre des findings.", "summary-model");
    vi.mocked(createLlmTransportWithMode)
      .mockReturnValueOnce(classifier as never)
      .mockReturnValueOnce(summariser as never);
    vi.spyOn(Date, "now").mockReturnValueOnce(2_000).mockReturnValueOnce(2_250);
    deps.thalamusService.runCycle.mockResolvedValue({ id: 99n });
    deps.findingRepo.findByCycleId.mockResolvedValue([
      {
        id: 1n,
        title: "Finding 1",
        summary: "Short summary 1",
        cortex: "catalog",
        urgency: "low",
        confidence: 0.7,
      },
      {
        id: 2n,
        summary: "S".repeat(400),
        cortex: "correlation",
        urgency: "high",
        confidence: null,
      },
      {
        id: 3n,
        title: "Finding 3",
        summary: "Short summary 3",
        cortex: "reflexion",
        urgency: "medium",
        confidence: 0.9,
      },
      { id: 4n, title: "Finding 4", summary: "Short summary 4" },
      { id: 5n, title: "Finding 5", summary: "Short summary 5" },
      { id: 6n, title: "Finding 6", summary: "Short summary 6" },
      { id: 7n, title: "Finding 7", summary: "Short summary 7" },
      { id: 8n, title: "Finding 8", summary: "Short summary 8" },
      { id: 9n, title: "Finding 9", summary: "Short summary 9" },
    ]);

    const result = await new ReplChatService(deps as never).handle(
      "analyse les anomalies GEO",
    );

    expect(deps.thalamusService.runCycle).toHaveBeenCalledWith({
      query: "analyse les anomalies GEO",
      triggerType: "user",
      triggerSource: "console-chat",
    });
    expect(deps.findingRepo.findByCycleId).toHaveBeenCalledWith(99n);
    expect(createLlmTransportWithMode).toHaveBeenNthCalledWith(
      2,
      summariserPrompt("analyse les anomalies GEO"),
    );
    expect(summariser.call).toHaveBeenCalledTimes(1);

    const payload = JSON.parse(
      String(summariser.call.mock.calls[0]![0]),
    ) as {
      cycleId: string;
      findings: Array<{
        id: string;
        title: string;
        summary: string | null;
        cortex?: string;
        urgency?: string;
        confidence: number;
      }>;
    };

    expect(payload.cycleId).toBe("99");
    expect(payload.findings).toHaveLength(8);
    expect(payload.findings[0]).toEqual({
      id: "1",
      title: "Finding 1",
      summary: "Short summary 1",
      cortex: "catalog",
      urgency: "low",
      confidence: 0.7,
    });
    expect(payload.findings[1]).toEqual({
      id: "2",
      title: "S".repeat(80),
      summary: "S".repeat(300),
      cortex: "correlation",
      urgency: "high",
      confidence: 0,
    });
    expect(payload.findings[7]!.id).toBe("8");

    expect(result).toEqual({
      kind: "chat",
      text: "▶ dispatched Thalamus cycle (9 findings)\n\nResume concentre des findings.",
      provider: "summary-model",
      tookMs: 250,
    });
    vi.restoreAllMocks();
  });

  it("uses singular wording when exactly one finding is returned", async () => {
    const deps = mockDeps();
    const classifier = transport('{"action":"run_cycle","query":"audit payload"}');
    const summariser = transport("Un seul finding a signaler.");
    vi.mocked(createLlmTransportWithMode)
      .mockReturnValueOnce(classifier as never)
      .mockReturnValueOnce(summariser as never);
    deps.thalamusService.runCycle.mockResolvedValue({ id: "cycle-1" });
    deps.findingRepo.findByCycleId.mockResolvedValue([
      { id: "f:1", title: "Finding unique", summary: "Only one" },
    ]);

    const result = await new ReplChatService(deps as never).handle("audit payload");

    expect(result.text.startsWith("▶ dispatched Thalamus cycle (1 finding)\n\n")).toBe(
      true,
    );
  });
});
