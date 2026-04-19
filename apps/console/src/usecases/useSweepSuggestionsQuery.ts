import { useQuery } from "@tanstack/react-query";
import { useApiClient } from "@/adapters/api/ApiClientContext";
import { qk } from "./keys";

export function useSweepSuggestionsQuery() {
  const api = useApiClient();
  return useQuery({
    queryKey: qk.sweepSuggestions(),
    queryFn: () => api.sweep.listSuggestions(),
    refetchInterval: 15_000,
  });
}
