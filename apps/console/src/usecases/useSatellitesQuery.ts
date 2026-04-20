import { useQuery } from "@tanstack/react-query";
import { useApiClient } from "@/adapters/api/ApiClientContext";
import { qk } from "./keys";
import type { Regime } from "@/transformers/http";

export function useSatellitesQuery(regime?: Regime) {
  const api = useApiClient();
  return useQuery({
    queryKey: qk.satellites(regime),
    queryFn: () => api.satellites.list(regime),
  });
}
