/**
 * Runtime-config HTTP client + react-query hooks.
 *
 * Consumes GET/PATCH/DELETE /api/config/runtime[/:domain] — the single
 * polymorphic surface the console-api exposes for tuning kernel knobs
 * at runtime (no redeploy).
 */

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  fieldChoices,
  fieldKindOf,
  MODEL_FIELD_SUPPORT_MAP,
  MODEL_PRESETS,
  type DomainPayload,
  type FieldKind,
  type FieldSpec,
  type RuntimeConfigListResponse,
  type RuntimeConfigSingleResponse,
} from "@interview/shared/config";

export {
  fieldChoices,
  fieldKindOf,
  MODEL_FIELD_SUPPORT_MAP,
  MODEL_PRESETS,
};
export type {
  DomainPayload,
  FieldKind,
  FieldSpec,
  RuntimeConfigListResponse,
  RuntimeConfigSingleResponse,
};

async function jsonFetch<T>(url: string, init?: RequestInit): Promise<T> {
  const response = await fetch(url, {
    ...init,
    headers: { "Content-Type": "application/json", ...init?.headers },
  });
  if (!response.ok) {
    const body = (await response.json().catch(() => ({}))) as { error?: string };
    throw new Error(body.error ?? `${response.status} ${response.statusText}`);
  }
  return (await response.json()) as T;
}

export function useRuntimeConfigList() {
  return useQuery({
    queryKey: ["runtime-config", "list"],
    queryFn: () => jsonFetch<RuntimeConfigListResponse>("/api/config/runtime"),
    staleTime: 5_000,
  });
}

export function usePatchRuntimeConfig() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (args: { domain: string; patch: Record<string, unknown> }) =>
      jsonFetch<RuntimeConfigSingleResponse>(
        `/api/config/runtime/${encodeURIComponent(args.domain)}`,
        { method: "PATCH", body: JSON.stringify(args.patch) },
      ),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["runtime-config"] });
    },
  });
}

export function useResetRuntimeConfig() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (domain: string) =>
      jsonFetch<RuntimeConfigSingleResponse>(
        `/api/config/runtime/${encodeURIComponent(domain)}`,
        { method: "DELETE" },
      ),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["runtime-config"] });
    },
  });
}
