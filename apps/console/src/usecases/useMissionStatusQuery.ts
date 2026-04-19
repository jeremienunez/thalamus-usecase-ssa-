import { useQuery } from "@tanstack/react-query";
import { useApiClient } from "@/adapters/api/ApiClientContext";
import { qk } from "./keys";

export function useMissionStatusQuery() {
  const api = useApiClient();
  return useQuery({
    queryKey: qk.missionStatus(),
    queryFn: () => api.mission.status(),
    refetchInterval: (q) => (q.state.data?.running ? 2500 : false),
  });
}
