/**
 * Runtime-config HTTP client + react-query hooks.
 *
 * Consumes GET/PATCH/DELETE /api/config/runtime[/:domain] — the single
 * polymorphic surface the console-api exposes for tuning kernel knobs
 * at runtime (no redeploy).
 */

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

export type FieldKind = "string" | "number" | "boolean" | "string[]" | "json";

export type FieldSpec =
  | FieldKind
  | { kind: FieldKind; choices: readonly string[] };

export function fieldKindOf(spec: FieldSpec): FieldKind {
  return typeof spec === "string" ? spec : spec.kind;
}

export function fieldChoices(spec: FieldSpec): readonly string[] | null {
  return typeof spec === "object" && Array.isArray(spec.choices)
    ? spec.choices
    : null;
}

export type ModelPreset = {
  value: string;
  provider: string;
  label: string;
  supports: {
    reasoningEffort?: boolean;
    maxOutputTokens?: boolean;
    verbosity?: boolean;
    thinking?: boolean;
    reasoningFormat?: boolean;
    reasoningSplit?: boolean;
    temperature?: boolean;
    topP?: boolean;
  };
};

export const MODEL_PRESETS: ModelPreset[] = [
  {
    value: "gpt-5.4-nano",
    provider: "openai",
    label: "OpenAI · gpt-5.4-nano",
    supports: {
      reasoningEffort: true,
      maxOutputTokens: true,
      verbosity: true,
      temperature: true,
      topP: true,
    },
  },
  {
    value: "gpt-5.4",
    provider: "openai",
    label: "OpenAI · gpt-5.4",
    supports: {
      reasoningEffort: true,
      maxOutputTokens: true,
      verbosity: true,
      temperature: true,
      topP: true,
    },
  },
  // Moonshot K2 family — canonical ids per api.moonshot.ai/v1 docs.
  // Bare "kimi-k2" is not a valid model id.
  {
    value: "kimi-k2.5",
    provider: "kimi",
    label: "Kimi · K2.5 (thinking toggle, 256k)",
    supports: {
      thinking: true,
      maxOutputTokens: true,
      temperature: true,
      topP: true,
    },
  },
  {
    value: "kimi-k2-thinking",
    provider: "kimi",
    label: "Kimi · K2-thinking (256k)",
    supports: {
      thinking: true,
      maxOutputTokens: true,
      temperature: true,
      topP: true,
    },
  },
  {
    value: "kimi-k2-thinking-turbo",
    provider: "kimi",
    label: "Kimi · K2-thinking-turbo (256k, fast)",
    supports: {
      thinking: true,
      maxOutputTokens: true,
      temperature: true,
      topP: true,
    },
  },
  {
    value: "kimi-k2-turbo-preview",
    provider: "kimi",
    label: "Kimi · K2 turbo-preview (non-thinking, 256k)",
    supports: { maxOutputTokens: true, temperature: true, topP: true },
  },
  {
    value: "kimi-k2-0905-preview",
    provider: "kimi",
    label: "Kimi · K2 0905-preview (256k)",
    supports: { maxOutputTokens: true, temperature: true, topP: true },
  },
  {
    value: "MiniMax-M2.7",
    provider: "minimax",
    label: "MiniMax · M2.7",
    supports: {
      reasoningSplit: true,
      maxOutputTokens: true,
      temperature: true,
      topP: true,
    },
  },
  {
    value: "local/gemma-4-26B-A4B-it-Q3_K_M",
    provider: "local",
    label: "Local · Gemma 4 26B MoE Q3 (llama.cpp)",
    supports: {
      thinking: true,
      reasoningFormat: true,
      maxOutputTokens: true,
      temperature: true,
      topP: true,
    },
  },
  {
    value: "local/gemma-e4b-q8",
    provider: "local",
    label: "Local · Gemma E4B Q8 (fast)",
    supports: {
      thinking: true,
      reasoningFormat: true,
      maxOutputTokens: true,
      temperature: true,
      topP: true,
    },
  },
];

/** Map camelCase config key → ModelPreset.supports key. Used by the UI to
 *  grey-out fields that the selected model doesn't honour. */
export const MODEL_FIELD_SUPPORT_MAP: Record<string, keyof ModelPreset["supports"]> = {
  reasoningEffort: "reasoningEffort",
  maxOutputTokens: "maxOutputTokens",
  verbosity: "verbosity",
  thinking: "thinking",
  reasoningFormat: "reasoningFormat",
  reasoningSplit: "reasoningSplit",
  temperature: "temperature",
};

export type DomainPayload = {
  value: Record<string, unknown>;
  defaults: Record<string, unknown>;
  schema: Record<string, FieldSpec>;
  hasOverrides: boolean;
};

export type RuntimeConfigListResponse = {
  domains: Record<string, DomainPayload>;
};

export type RuntimeConfigSingleResponse = {
  domain: string;
  value: Record<string, unknown>;
  defaults: Record<string, unknown>;
  schema: Record<string, FieldSpec>;
  hasOverrides: boolean;
};

async function jsonFetch<T>(url: string, init?: RequestInit): Promise<T> {
  const res = await fetch(url, {
    ...init,
    headers: { "Content-Type": "application/json", ...init?.headers },
  });
  if (!res.ok) {
    const body = (await res.json().catch(() => ({}))) as { error?: string };
    throw new Error(body.error ?? `${res.status} ${res.statusText}`);
  }
  return (await res.json()) as T;
}

export function useRuntimeConfigList() {
  return useQuery({
    queryKey: ["runtime-config", "list"],
    queryFn: () =>
      jsonFetch<RuntimeConfigListResponse>("/api/config/runtime"),
    staleTime: 5_000,
  });
}

export function usePatchRuntimeConfig() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (args: {
      domain: string;
      patch: Record<string, unknown>;
    }) =>
      jsonFetch<RuntimeConfigSingleResponse>(
        `/api/config/runtime/${encodeURIComponent(args.domain)}`,
        { method: "PATCH", body: JSON.stringify(args.patch) },
      ),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["runtime-config"] });
    },
  });
}

export function useResetRuntimeConfig() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (domain: string) =>
      jsonFetch<RuntimeConfigSingleResponse>(
        `/api/config/runtime/${encodeURIComponent(domain)}`,
        { method: "DELETE" },
      ),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["runtime-config"] });
    },
  });
}
