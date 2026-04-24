import type { CortexOutput } from "../cortices/types";

type Pricing = {
  promptUsdPerMillion: number;
  completionUsdPerMillion: number;
};

const TOKENS_PER_MILLION = 1_000_000;
const DEFAULT_PROMPT_SHARE = 0.75;
const LEGACY_FLAT_USD_PER_MILLION = 2;

/**
 * Budget estimator, not a billing authority. Providers expose uneven usage
 * detail, so cycle control uses price-class defaults plus prompt/completion
 * estimates when the cortex strategy can provide them.
 */
export function estimateCortexOutputCostUsd(output: CortexOutput): number {
  const tokens = Math.max(0, output.metadata.tokensUsed);
  if (tokens === 0) return 0;

  const pricing = pricingForModel(output.metadata.model);
  if (
    pricing.promptUsdPerMillion === 0 &&
    pricing.completionUsdPerMillion === 0
  ) {
    return 0;
  }

  const split = tokenSplit({
    tokens,
    promptTokens: output.metadata.promptTokens,
    completionTokens: output.metadata.completionTokens,
  });

  return (
    (split.promptTokens * pricing.promptUsdPerMillion +
      split.completionTokens * pricing.completionUsdPerMillion) /
    TOKENS_PER_MILLION
  );
}

function tokenSplit(input: {
  tokens: number;
  promptTokens?: number;
  completionTokens?: number;
}): { promptTokens: number; completionTokens: number } {
  const prompt =
    input.promptTokens !== undefined && input.promptTokens >= 0
      ? input.promptTokens
      : undefined;
  const completion =
    input.completionTokens !== undefined && input.completionTokens >= 0
      ? input.completionTokens
      : undefined;

  if (prompt !== undefined && completion !== undefined) {
    return { promptTokens: prompt, completionTokens: completion };
  }
  if (prompt !== undefined) {
    return {
      promptTokens: prompt,
      completionTokens: Math.max(0, input.tokens - prompt),
    };
  }
  if (completion !== undefined) {
    return {
      promptTokens: Math.max(0, input.tokens - completion),
      completionTokens: completion,
    };
  }
  

  const promptTokens = Math.round(input.tokens * DEFAULT_PROMPT_SHARE);
  return {
    promptTokens,
    completionTokens: Math.max(0, input.tokens - promptTokens),
  };
}

function pricingForModel(model: string): Pricing {
  const normalized = model.toLowerCase();
  if (
    normalized === "none" ||
    normalized === "disabled" ||
    normalized === "error" ||
    normalized.endsWith(":invalid")
  ) {
    return { promptUsdPerMillion: 0, completionUsdPerMillion: 0 };
  }
  if (normalized.includes("local")) {
    return { promptUsdPerMillion: 0, completionUsdPerMillion: 0 };
  }
  if (normalized.includes("kimi")) {
    return { promptUsdPerMillion: 0.6, completionUsdPerMillion: 2.5 };
  }
  if (normalized.includes("minimax")) {
    return { promptUsdPerMillion: 0.3, completionUsdPerMillion: 1.2 };
  }
  if (normalized.includes("openai") || normalized.includes("gpt-")) {
    return openAiPricingForModel(normalized);
  }

  return {
    promptUsdPerMillion: LEGACY_FLAT_USD_PER_MILLION,
    completionUsdPerMillion: LEGACY_FLAT_USD_PER_MILLION,
  };
}

function openAiPricingForModel(model: string): Pricing {
  if (model.includes("nano")) {
    return { promptUsdPerMillion: 0.05, completionUsdPerMillion: 0.4 };
  }
  if (model.includes("mini")) {
    return { promptUsdPerMillion: 0.4, completionUsdPerMillion: 1.6 };
  }
  return { promptUsdPerMillion: 1.25, completionUsdPerMillion: 10 };
}
