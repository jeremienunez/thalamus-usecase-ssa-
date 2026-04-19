import { useQuery } from "@tanstack/react-query";
import { useApiClient } from "@/adapters/api/ApiClientContext";
import { qk } from "./keys";

export function useKgQuery() {
  const api = useApiClient();
  return useQuery({
    queryKey: qk.kg(),
    queryFn: async () => {
      const [n, e] = await Promise.all([api.kg.listNodes(), api.kg.listEdges()]);
      return { nodes: n.items, edges: e.items };
    },
  });
}
