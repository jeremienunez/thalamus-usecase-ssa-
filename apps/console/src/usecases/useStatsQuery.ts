import { useQuery } from "@tanstack/react-query";
import { useApiClient } from "@/adapters/api/ApiClientContext";
import { qk } from "./keys";

export function useStatsQuery() {
  const api = useApiClient();
  return useQuery({
    queryKey: qk.stats(),
    queryFn: () => api.stats.get(),
  });
}
