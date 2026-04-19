import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useApiClient } from "@/adapters/api/ApiClientContext";

export function useReviewSuggestionMutation() {
  const api = useApiClient();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({
      id,
      accept,
      reason,
    }: {
      id: string;
      accept: boolean;
      reason?: string;
    }) => api.sweep.review(id, accept, reason),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["sweep-suggestions"] });
      qc.invalidateQueries({ queryKey: ["findings"] });
      qc.invalidateQueries({ queryKey: ["stats"] });
    },
  });
}
