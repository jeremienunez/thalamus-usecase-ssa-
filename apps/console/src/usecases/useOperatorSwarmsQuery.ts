import { useQuery } from "@tanstack/react-query";
import type { ListOperatorSwarmsQuery } from "@/adapters/api/sim-operator";
import { useApiClient } from "@/adapters/api/ApiClientContext";
import { qk } from "./keys";

export function useOperatorSwarmsQuery(query: ListOperatorSwarmsQuery = {}) {
  const api = useApiClient();
  return useQuery({
    queryKey: qk.operatorSwarms(query.status, query.kind, query.cursor),
    queryFn: () => api.simOperator.listSwarms(query),
  });
}
