import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useApiClient } from "@/adapters/api/ApiClientContext";
import type { CycleKind } from "@/adapters/api/cycles";

export function useLaunchCycleMutation() {
  const api = useApiClient();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (kind: CycleKind) => api.cycles.run(kind),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["findings"] });
      qc.invalidateQueries({ queryKey: ["stats"] });
      qc.invalidateQueries({ queryKey: ["cycles"] });
    },
  });
}
