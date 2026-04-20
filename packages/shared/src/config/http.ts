import type { FieldSpec } from "./types";

export const MODEL_FIELD_SUPPORT_MAP = {
  reasoningEffort: "reasoningEffort",
  maxOutputTokens: "maxOutputTokens",
  verbosity: "verbosity",
  thinking: "thinking",
  reasoningFormat: "reasoningFormat",
  reasoningSplit: "reasoningSplit",
  temperature: "temperature",
} as const;

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
