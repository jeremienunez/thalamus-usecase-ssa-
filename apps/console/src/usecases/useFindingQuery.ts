import { useQuery } from "@tanstack/react-query";
import { useApiClient } from "@/adapters/api/ApiClientContext";
import { qk } from "./keys";

export function useFindingQuery(id: string | null) {
  const api = useApiClient();
  return useQuery({
    queryKey: qk.finding(id ?? ""),
    queryFn: () => api.findings.findById(id!),
    enabled: id !== null,
  });
}
