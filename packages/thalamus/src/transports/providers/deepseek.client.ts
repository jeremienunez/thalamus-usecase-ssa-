import type { DeepSeekConfig } from "../../config/enrichment";
import { throwIfAborted } from "../abort";

export interface DeepSeekChatRequest {
  systemPrompt: string;
  userPrompt: string;
  model?: string;
  maxOutputTokens?: number;
  thinking?: boolean;
  reasoningEffort?: string;
  responseFormat?: "json_object";
  signal?: AbortSignal;
}

export interface DeepSeekChatResult {
  content: string;
  reasoningContent: string;
  finishReason?: string;
  usage?: {
    prompt_tokens?: number;
    completion_tokens?: number;
    total_tokens?: number;
    completion_tokens_details?: { reasoning_tokens?: number };
  };
}

function normalizeDeepSeekUrl(url: string): string {
  const trimmed = url.replace(/\/+$/, "");
  if (trimmed.endsWith("/chat/completions")) return trimmed;
  return `${trimmed}/chat/completions`;
}

function normalizeReasoningEffort(effort: string | undefined): string | undefined {
  if (effort === "high" || effort === "xhigh" || effort === "max") {
    return "high";
  }
  return undefined;
}

export function buildDeepSeekChatBody(
  config: DeepSeekConfig,
  req: DeepSeekChatRequest,
): Record<string, unknown> {
  const model = req.model ?? config.model;
  const maxTokens =
    req.maxOutputTokens && req.maxOutputTokens > 0
      ? req.maxOutputTokens
      : config.maxTokens;
  const body: Record<string, unknown> = {
    model,
    messages: [
      { role: "system", content: req.systemPrompt },
      { role: "user", content: req.userPrompt },
    ],
    max_tokens: maxTokens,
    stream: false,
  };

  if (typeof req.thinking === "boolean") {
    body.thinking = { type: req.thinking ? "enabled" : "disabled" };
  }
  if (req.thinking === true) {
    const effort = normalizeReasoningEffort(req.reasoningEffort);
    if (effort) body.reasoning_effort = effort;
  }
  if (req.responseFormat) {
    body.response_format = { type: req.responseFormat };
  }

  return body;
}

export async function callDeepSeekChatCompletion(
  config: DeepSeekConfig,
  req: DeepSeekChatRequest,
): Promise<DeepSeekChatResult> {
  throwIfAborted(req.signal);
  const response = await fetch(normalizeDeepSeekUrl(config.url), {
    method: "POST",
    headers: {
      Authorization: `Bearer ${config.apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(buildDeepSeekChatBody(config, req)),
    ...(req.signal ? { signal: req.signal } : {}),
  });

  if (!response.ok) {
    const body = await response.text();
    throw new Error(`DeepSeek API error ${response.status}: ${body}`);
  }

  const data = (await response.json()) as {
    choices?: Array<{
      finish_reason?: string;
      message?: {
        content?: string | null;
        reasoning_content?: string | null;
      };
    }>;
    usage?: DeepSeekChatResult["usage"];
  };
  const choice = data.choices?.[0];
  const message = choice?.message;
  return {
    content: message?.content ?? "",
    reasoningContent: message?.reasoning_content ?? "",
    finishReason: choice?.finish_reason,
    usage: data.usage,
  };
}
