import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useApiClient } from "@/adapters/api/ApiClientContext";
import { qk } from "./keys";

export function useMissionStartMutation() {
  const api = useApiClient();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: () => api.mission.start(),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: qk.missionStatus() });
      qc.invalidateQueries({ queryKey: qk.sweepSuggestions() });
    },
  });
}

export function useMissionStopMutation() {
  const api = useApiClient();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: () => api.mission.stop(),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: qk.missionStatus() });
    },
  });
}
