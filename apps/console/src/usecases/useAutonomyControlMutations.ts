import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useApiClient } from "@/adapters/api/ApiClientContext";
import { qk } from "./keys";

export function useAutonomyStartMutation() {
  const api = useApiClient();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (intervalSec?: number) => api.autonomy.start(intervalSec),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: qk.autonomyStatus() });
    },
  });
}

export function useAutonomyStopMutation() {
  const api = useApiClient();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: () => api.autonomy.stop(),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: qk.autonomyStatus() });
    },
  });
}

export function useAutonomyResetMutation() {
  const api = useApiClient();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: () => api.autonomy.reset(),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: qk.autonomyStatus() });
    },
  });
}
