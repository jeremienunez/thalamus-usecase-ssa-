/**
 * mode-instructions.spec.ts — Phase 9 of thalamus agnosticity cleanup.
 *
 * Proves that mode-specific user-prompt instructions (ternary previously
 * hardcoded in cortex-llm.ts with SSA vocabulary like "conjunctions",
 * "fleet health", "stale epochs") are injected via DomainConfig.
 *
 * Contract:
 *   - When DomainConfig.modeInstructions.{audit,investment} is provided,
 *     the kernel uses those strings verbatim.
 *   - When absent, the kernel falls back to generic domain-neutral strings
 *     (no mention of satellites / conjunctions / fleets / epochs).
 *   - noopDomainConfig does NOT define modeInstructions.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import type { DomainConfig } from "../src/cortices/types";
import { noopDomainConfig } from "../src/cortices/types";

// Mock the LLM transport so we can capture the userPrompt without a real call.
const capturedPrompts: string[] = [];
vi.mock("../src/transports/llm-chat", () => ({
  createLlmTransport: () => ({
    call: async (userPrompt: string) => {
      capturedPrompts.push(userPrompt);
      return {
        content: JSON.stringify({ findings: [] }),
        provider: "test",
      };
    },
  }),
}));

// Mock runtime-config so analyzeCortexData's Promise.all resolves deterministically.
vi.mock("../src/config/runtime-config", () => ({
  getCortexConfig: async () => ({ overrides: {} }),
  getPlannerConfig: async () => ({
    maxFindingsPerCortex: 3,
    provider: undefined,
    model: undefined,
    maxOutputTokens: undefined,
    temperature: undefined,
    reasoningEffort: undefined,
    verbosity: undefined,
    thinking: undefined,
    reasoningFormat: undefined,
    reasoningSplit: undefined,
  }),
}));

describe("cortex-llm modeInstruction — injection via DomainConfig seam", () => {
  beforeEach(() => {
    capturedPrompts.length = 0;
  });

  it("uses the domain-provided audit string verbatim when mode=audit", async () => {
    const { analyzeCortexData } = await import("../src/cortices/cortex-llm");
    const domainAudit =
      "DOMAIN_AUDIT_MARKER: hunt provenance gaps in the custom domain.";
    await analyzeCortexData({
      cortexName: "test_cortex",
      systemPrompt: "You are a test cortex.",
      dataPayload: "[]",
      mode: "audit",
      modeInstructions: { audit: domainAudit, investment: "ignored" },
    });
    expect(capturedPrompts.length).toBe(1);
    expect(capturedPrompts[0]).toContain(domainAudit);
  });

  it("uses the domain-provided investment string verbatim when mode=investment", async () => {
    const { analyzeCortexData } = await import("../src/cortices/cortex-llm");
    const domainInvestment =
      "DOMAIN_INVESTMENT_MARKER: highlight custom-domain opportunities.";
    await analyzeCortexData({
      cortexName: "test_cortex",
      systemPrompt: "You are a test cortex.",
      dataPayload: "[]",
      mode: "investment",
      modeInstructions: {
        audit: "ignored",
        investment: domainInvestment,
      },
    });
    expect(capturedPrompts.length).toBe(1);
    expect(capturedPrompts[0]).toContain(domainInvestment);
  });

  it("falls back to a domain-neutral default when modeInstructions is absent", async () => {
    const { analyzeCortexData } = await import("../src/cortices/cortex-llm");
    await analyzeCortexData({
      cortexName: "test_cortex",
      systemPrompt: "You are a test cortex.",
      dataPayload: "[]",
      mode: "investment",
      // No modeInstructions — kernel fallback must kick in.
    });
    expect(capturedPrompts.length).toBe(1);
    // Kernel default must NOT leak SSA vocabulary.
    const prompt = capturedPrompts[0];
    expect(prompt).not.toMatch(
      /conjunctions|maneuver opportunities|debris risk|fleet health|launch-window|stale epochs|misclassifications/i,
    );
  });

  it("kernel audit default stays domain-neutral when mode=audit and seam absent", async () => {
    const { analyzeCortexData } = await import("../src/cortices/cortex-llm");
    await analyzeCortexData({
      cortexName: "test_cortex",
      systemPrompt: "You are a test cortex.",
      dataPayload: "[]",
      mode: "audit",
    });
    const prompt = capturedPrompts[0];
    expect(prompt).not.toMatch(
      /stale epochs|misclassifications|conjunctions|fleet/i,
    );
    // Generic audit framing is still present (DATA QUALITY hint).
    expect(prompt).toMatch(/DATA QUALITY|data-quality|anomaly/i);
  });

  it("noopDomainConfig does not define modeInstructions", () => {
    expect(noopDomainConfig.modeInstructions).toBeUndefined();
  });

  it("accepts a DomainConfig with only audit populated (partial seam)", () => {
    const cfg: DomainConfig = {
      ...noopDomainConfig,
      modeInstructions: { audit: "only audit override" },
    };
    expect(cfg.modeInstructions?.audit).toBe("only audit override");
    expect(cfg.modeInstructions?.investment).toBeUndefined();
  });
});
