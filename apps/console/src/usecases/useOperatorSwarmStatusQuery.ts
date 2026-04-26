import { useQuery } from "@tanstack/react-query";
import { useApiClient } from "@/adapters/api/ApiClientContext";
import { qk } from "./keys";

export function useOperatorSwarmStatusQuery(swarmId: string | null) {
  const api = useApiClient();
  return useQuery({
    queryKey: qk.operatorSwarmStatus(swarmId ?? ""),
    queryFn: () => api.simOperator.getStatus(swarmId ?? ""),
    enabled: swarmId !== null,
  });
}
