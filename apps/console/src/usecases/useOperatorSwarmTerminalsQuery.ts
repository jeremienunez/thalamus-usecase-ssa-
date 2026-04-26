import { useQuery } from "@tanstack/react-query";
import { useApiClient } from "@/adapters/api/ApiClientContext";
import { qk } from "./keys";

export function useOperatorSwarmTerminalsQuery(swarmId: string | null) {
  const api = useApiClient();
  return useQuery({
    queryKey: qk.operatorSwarmTerminals(swarmId ?? ""),
    queryFn: () => api.simOperator.listTerminals(swarmId ?? ""),
    enabled: swarmId !== null,
  });
}
