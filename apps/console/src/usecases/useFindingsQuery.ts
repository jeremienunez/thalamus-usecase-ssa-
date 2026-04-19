import { useQuery } from "@tanstack/react-query";
import { useApiClient } from "@/adapters/api/ApiClientContext";
import { qk } from "./keys";
import type { FindingStatus } from "@/shared/types";

export function useFindingsQuery(status?: FindingStatus, cortex?: string) {
  const api = useApiClient();
  return useQuery({
    queryKey: qk.findings(status, cortex),
    queryFn: () => api.findings.list({ status, cortex }),
  });
}
