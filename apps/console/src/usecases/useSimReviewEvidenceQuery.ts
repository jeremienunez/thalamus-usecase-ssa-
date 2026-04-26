import { useQuery } from "@tanstack/react-query";
import { useApiClient } from "@/adapters/api/ApiClientContext";
import { qk } from "./keys";

export function useSimReviewEvidenceQuery(swarmId: string | null) {
  const api = useApiClient();
  return useQuery({
    queryKey: qk.operatorReviewEvidence(swarmId ?? ""),
    queryFn: () => api.simOperator.listEvidence(swarmId ?? ""),
    enabled: swarmId !== null,
  });
}
