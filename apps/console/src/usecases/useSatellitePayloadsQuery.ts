import { useQuery } from "@tanstack/react-query";
import { useApiClient } from "@/adapters/api/ApiClientContext";
import { qk } from "./keys";

/**
 * Payload manifest for a single satellite. Gated by a truthy id so the drawer
 * can keep the hook mounted unconditionally without triggering a request on
 * the empty-state (no sat selected) render.
 */
export function useSatellitePayloadsQuery(satelliteId: number | null) {
  const api = useApiClient();
  return useQuery({
    queryKey: qk.satellitePayloads(satelliteId ?? 0),
    queryFn: () => api.payloads.listForSatellite(satelliteId as number),
    enabled: typeof satelliteId === "number" && satelliteId > 0,
  });
}
