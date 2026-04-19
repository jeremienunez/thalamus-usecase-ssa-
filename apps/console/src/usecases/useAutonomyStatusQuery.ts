import { useQuery } from "@tanstack/react-query";
import { useApiClient } from "@/adapters/api/ApiClientContext";
import { qk } from "./keys";

export function useAutonomyStatusQuery() {
  const api = useApiClient();
  return useQuery({
    queryKey: qk.autonomyStatus(),
    queryFn: () => api.autonomy.status(),
    refetchInterval: (q) => (q.state.data?.running ? 3000 : false),
  });
}
