// apps/console-api/src/services/llm-transport.adapter.ts
//
// Concrete binding of the console-api `LlmTransportFactory` port to the
// thalamus `createLlmTransportWithMode` factory. Reads `thalamus.planner`
// runtime config so downstream services (classifier, summariser, chat-reply)
// route through the operator-selected provider instead of the hardcoded
// chain default — without dragging the port into config-land.
import {
  createLlmTransportWithMode,
  getPlannerConfig,
} from "@interview/thalamus";
import type { LlmTransportFactory } from "./llm-transport.port";

function pickProvider(
  v: string | undefined,
): "local" | "kimi" | "openai" | "minimax" | "deepseek" | undefined {
  if (
    v === "local" ||
    v === "kimi" ||
    v === "openai" ||
    v === "minimax" ||
    v === "deepseek"
  ) {
    return v;
  }
  return undefined;
}

export const thalamusLlmTransportFactory: LlmTransportFactory = {
  create: (systemPrompt) => {
    // Transport is created eagerly (synchronous API). We return a wrapper
    // whose `call()` reads the fresh planner config on every invocation
    // and threads preferred provider + per-call overrides down to the
    // underlying transport.
    return {
      async call(input: string, options) {
        const cfg = await getPlannerConfig();
        const transport = createLlmTransportWithMode(systemPrompt, {
          preferredProvider: pickProvider(cfg.provider),
          overrides: {
            model: cfg.model,
            maxOutputTokens: cfg.maxOutputTokens,
            temperature: cfg.temperature,
            reasoningEffort: cfg.reasoningEffort,
            verbosity: cfg.verbosity,
            thinking: cfg.thinking,
            reasoningFormat: cfg.reasoningFormat,
            reasoningSplit: cfg.reasoningSplit,
          },
        });
        return options ? transport.call(input, options) : transport.call(input);
      },
    };
  },
};
