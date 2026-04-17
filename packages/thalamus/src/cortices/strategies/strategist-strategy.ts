/**
 * Strategist execution strategy — meta-cortex that synthesises previous
 * cortex findings. Skips SQL helpers, external sources, and web search.
 */

import { createLogger } from "@interview/shared/observability";
import { ResearchCortex } from "@interview/shared/enum";
import type { CortexSkill } from "../registry";
import type { CortexInput, CortexOutput, DomainConfig } from "../types";
import { analyzeCortexData } from "../cortex-llm";
import { sanitizeText } from "../guardrails";
import { emptyOutput, normalizeFinding } from "./helpers";
import type { CortexExecutionStrategy } from "./types";

const logger = createLogger("cortex-strategist");

export class StrategistStrategy implements CortexExecutionStrategy {
  constructor(private readonly domainConfig?: DomainConfig) {}

  canHandle(cortexName: string): boolean {
    return cortexName === ResearchCortex.Strategist;
  }

  async execute(skill: CortexSkill, input: CortexInput): Promise<CortexOutput> {
    const start = Date.now();
    const cortexName = skill.header.name;

    const prevFindings = input.context?.previousFindings ?? [];
    if (prevFindings.length === 0) {
      logger.info({ cortex: cortexName }, "No previous findings for strategist");
      return emptyOutput();
    }

    const dataPayload = JSON.stringify(
      prevFindings.map((f) => ({
        title: sanitizeText(f.title).clean,
        summary: sanitizeText(f.summary).clean,
        confidence: f.confidence,
      })),
    );

    const result = await analyzeCortexData({
      cortexName,
      systemPrompt: skill.body,
      dataPayload,
      maxFindings: 4,
      enableWebSearch: false,
      lang: input.lang,
      mode: input.mode,
      sourcingRules: this.domainConfig?.sourcingRules,
      entityTypes: this.domainConfig?.entityTypes,
    });

    const findings = result.findings.map((f) =>
      normalizeFinding(f, cortexName),
    );

    const duration = Date.now() - start;
    logger.info(
      {
        cortex: cortexName,
        findings: findings.length,
        duration,
        sourceFindings: prevFindings.length,
      },
      "Strategist synthesis complete",
    );

    return {
      findings,
      metadata: {
        tokensUsed: result.tokensEstimate,
        duration,
        model: result.model,
      },
    };
  }
}
