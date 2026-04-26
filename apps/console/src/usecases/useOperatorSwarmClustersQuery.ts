import { useQuery } from "@tanstack/react-query";
import { useApiClient } from "@/adapters/api/ApiClientContext";
import { qk } from "./keys";

export function useOperatorSwarmClustersQuery(swarmId: string | null) {
  const api = useApiClient();
  return useQuery({
    queryKey: qk.operatorSwarmClusters(swarmId ?? ""),
    queryFn: () => api.simOperator.getClusters(swarmId ?? ""),
    enabled: swarmId !== null,
  });
}
