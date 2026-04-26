import { useQuery } from "@tanstack/react-query";
import { useApiClient } from "@/adapters/api/ApiClientContext";
import { qk } from "./keys";

export function useOperatorFishTimelineQuery(
  swarmId: string | null,
  fishIndex: number | null,
) {
  const api = useApiClient();
  const enabled = swarmId !== null && fishIndex !== null;
  return useQuery({
    queryKey: qk.operatorFishTimeline(swarmId ?? "", fishIndex ?? -1),
    queryFn: () => api.simOperator.getFishTimeline(swarmId ?? "", fishIndex ?? 0),
    enabled,
  });
}
