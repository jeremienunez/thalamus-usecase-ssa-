import { useQuery } from "@tanstack/react-query";
import { useApiClient } from "@/adapters/api/ApiClientContext";
import { qk } from "./keys";

export function useCyclesQuery() {
  const api = useApiClient();
  return useQuery({
    queryKey: qk.cycles(),
    queryFn: () => api.cycles.list(),
  });
}
