import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  ResearchFindingType,
  ResearchUrgency,
} from "@interview/shared/enum";
import type { CortexFinding } from "../src/cortices/types";

const mocks = vi.hoisted(() => ({
  callMock: vi.fn(),
  createLlmTransportMock: vi.fn(),
  parseJsonMock: vi.fn(),
  buildPromptMock: vi.fn(),
}));

vi.mock("../src/transports/llm-chat", () => ({
  createLlmTransport: mocks.createLlmTransportMock,
  LlmChatTransport: {
    parseJson: mocks.parseJsonMock,
  },
}));

vi.mock("../src/prompts", () => ({
  buildReflexionSystemPrompt: mocks.buildPromptMock,
}));

import { ThalamusReflexion } from "../src/services/thalamus-reflexion.service";

function makeFinding(
  overrides: Partial<CortexFinding> = {},
): CortexFinding {
  return {
    title: "Nominal finding",
    summary: "Nominal summary",
    findingType: ResearchFindingType.Insight,
    urgency: ResearchUrgency.Low,
    evidence: [{ source: "fixture", data: { id: 1 }, weight: 1 }],
    confidence: 0.8,
    impactScore: 4,
    edges: [],
    ...overrides,
  };
}

beforeEach(() => {
  mocks.callMock.mockReset();
  mocks.createLlmTransportMock.mockReset();
  mocks.createLlmTransportMock.mockReturnValue({
    call: mocks.callMock,
  });
  mocks.parseJsonMock.mockReset();
  mocks.buildPromptMock.mockReset();
  mocks.buildPromptMock.mockReturnValue("REFLEXION_PROMPT");
});

describe("ThalamusReflexion.evaluate", () => {
  it("short-circuits a truly empty round without building a prompt or transport", async () => {
    const service = new ThalamusReflexion();

    const result = await service.evaluate("Check the corridor", [], [], 2);

    expect(result).toEqual({
      replan: false,
      notes: "No findings produced — nothing to evaluate",
      overallConfidence: 0,
    });
    expect(mocks.buildPromptMock).not.toHaveBeenCalled();
    expect(mocks.createLlmTransportMock).not.toHaveBeenCalled();
    expect(mocks.callMock).not.toHaveBeenCalled();
    expect(mocks.parseJsonMock).not.toHaveBeenCalled();
  });

  it("sends the low-confidence marker and kept placeholder when raw findings exist but none are kept", async () => {
    const service = new ThalamusReflexion();
    const rawFindings = [
      makeFinding({
        title: "Solar array current spike",
        findingType: ResearchFindingType.Anomaly,
        confidence: 0.42,
        evidence: [
          { source: "sensor-a", data: { amp: 17 }, weight: 1 },
          { source: "sensor-b", data: { amp: 16 }, weight: 1 },
        ],
      }),
    ];

    mocks.callMock.mockResolvedValue({
      content: '{"replan":true}',
      provider: "kimi",
    });
    mocks.parseJsonMock.mockReturnValue({
      replan: true,
      notes: "Need corroborating telemetry.",
      gaps: ["Need corroborating telemetry"],
      overallConfidence: 0.41,
    });

    const result = await service.evaluate(
      "Investigate the power anomaly",
      rawFindings,
      [],
      3,
      {
        complexity: "deep",
        remainingBudget: 0.12,
        maxIterations: 8,
      },
    );

    expect(mocks.buildPromptMock).toHaveBeenCalledWith({
      complexity: "deep",
      remainingBudget: 0.12,
      maxIterations: 8,
      iteration: 3,
    });
    expect(mocks.createLlmTransportMock).toHaveBeenCalledWith(
      "REFLEXION_PROMPT",
      { maxRetries: 1 },
    );
    expect(mocks.callMock).toHaveBeenCalledWith(
      expect.stringContaining(
        'Research intent: "Investigate the power anomaly"\nIteration: 3\nLow-confidence round: 1 raw, 0 kept.\n',
      ),
    );
    expect(mocks.callMock).toHaveBeenCalledWith(
      expect.stringContaining(
        "RAW findings:\n1. [anomaly] Solar array current spike (confidence: 0.42, evidence: 2 items)",
      ),
    );
    expect(mocks.callMock).toHaveBeenCalledWith(
      expect.stringContaining(
        "KEPT findings:\n(none — all raw findings below confidence gate)",
      ),
    );
    expect(mocks.parseJsonMock).toHaveBeenCalledWith(
      '{"replan":true}',
      expect.any(Object),
    );
    expect(result).toEqual({
      replan: true,
      notes: "Need corroborating telemetry.",
      gaps: ["Need corroborating telemetry"],
      overallConfidence: 0.41,
    });
  });

  it("falls back to approving kept findings when the transport fails", async () => {
    const service = new ThalamusReflexion();
    const rawFindings = [
      makeFinding({
        title: "Primary track drift",
        confidence: 0.92,
      }),
      makeFinding({
        title: "Shadowing candidate",
        confidence: 0.74,
        findingType: ResearchFindingType.Alert,
      }),
    ];
    const keptFindings = [
      rawFindings[0]!,
      rawFindings[1]!,
    ];

    mocks.callMock.mockRejectedValue(new Error("provider down"));

    const result = await service.evaluate(
      "Assess the object cluster",
      rawFindings,
      keptFindings,
      4,
    );

    expect(mocks.buildPromptMock).toHaveBeenCalledWith({
      iteration: 4,
    });
    expect(mocks.callMock).toHaveBeenCalledWith(
      expect.stringContaining(
        'Research intent: "Assess the object cluster"\nIteration: 4\n',
      ),
    );
    expect(mocks.callMock).toHaveBeenCalledWith(
      expect.not.stringContaining("Low-confidence round:"),
    );
    expect(mocks.callMock).toHaveBeenCalledWith(
      expect.stringContaining(
        "KEPT findings:\n1. [insight] Primary track drift (confidence: 0.92, evidence: 1 items)\n2. [alert] Shadowing candidate (confidence: 0.74, evidence: 1 items)",
      ),
    );
    expect(mocks.parseJsonMock).not.toHaveBeenCalled();
    expect(result).toEqual({
      replan: false,
      notes: "Reflexion failed — approving findings as-is",
      overallConfidence: 0.8300000000000001,
    });
  });

  it("returns parsed results even when the reflexion payload omits gaps", async () => {
    const service = new ThalamusReflexion();
    const keptFindings = [
      makeFinding({
        title: "Catalog gap narrowed",
        confidence: 0.88,
      }),
    ];

    mocks.callMock.mockResolvedValue({
      content: '{"replan":false}',
      provider: "openai",
    });
    mocks.parseJsonMock.mockReturnValue({
      replan: false,
      notes: "Sufficient evidence gathered.",
      overallConfidence: 0.88,
    });

    const result = await service.evaluate(
      "Check whether the gap is closed",
      keptFindings,
      keptFindings,
      5,
      { remainingBudget: 0.02 },
    );

    expect(mocks.buildPromptMock).toHaveBeenCalledWith({
      remainingBudget: 0.02,
      iteration: 5,
    });
    expect(result).toEqual({
      replan: false,
      notes: "Sufficient evidence gathered.",
      overallConfidence: 0.88,
    });
  });

  it("passes AbortSignal to the reflexion LLM and rethrows aborts", async () => {
    const service = new ThalamusReflexion();
    const controller = new AbortController();
    const abort = new Error("reflexion cancelled");
    abort.name = "AbortError";
    const keptFindings = [
      makeFinding({
        title: "Abortable finding",
        confidence: 0.88,
      }),
    ];
    mocks.callMock.mockRejectedValue(abort);

    await expect(
      service.evaluate("Abort reflexion", keptFindings, keptFindings, 5, {
        signal: controller.signal,
      }),
    ).rejects.toThrow("reflexion cancelled");
    expect(mocks.callMock).toHaveBeenCalledWith(
      expect.stringContaining('Research intent: "Abort reflexion"'),
      { signal: controller.signal },
    );
    expect(mocks.parseJsonMock).not.toHaveBeenCalled();
  });

  it("stringifies non-Error transport failures and returns zero confidence when nothing was kept", async () => {
    const service = new ThalamusReflexion();
    const rawFindings = [
      makeFinding({
        title: "Weak signal only",
        confidence: 0.31,
      }),
    ];

    mocks.callMock.mockRejectedValue("timeout");

    const result = await service.evaluate(
      "Re-check the weak signal",
      rawFindings,
      [],
      6,
    );

    expect(mocks.parseJsonMock).not.toHaveBeenCalled();
    expect(result).toEqual({
      replan: false,
      notes: "Reflexion failed — approving findings as-is",
      overallConfidence: 0,
    });
  });
});
