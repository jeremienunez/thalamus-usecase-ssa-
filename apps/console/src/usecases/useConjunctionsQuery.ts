import { useQuery } from "@tanstack/react-query";
import { useApiClient } from "@/adapters/api/ApiClientContext";
import { qk } from "./keys";

export function useConjunctionsQuery(minPc = 0) {
  const api = useApiClient();
  return useQuery({
    queryKey: qk.conjunctions(minPc),
    queryFn: () => api.conjunctions.list(minPc),
  });
}
