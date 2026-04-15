import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { api, FindingStatus, Regime } from "./api";

export const qk = {
  satellites: (regime?: Regime) => ["satellites", regime] as const,
  conjunctions: (minPc?: number) => ["conjunctions", minPc] as const,
  kg: () => ["kg"] as const,
  findings: (status?: FindingStatus, cortex?: string) => ["findings", status, cortex] as const,
  finding: (id: string) => ["finding", id] as const,
  stats: () => ["stats"] as const,
};

export const useSatellites = (regime?: Regime) =>
  useQuery({ queryKey: qk.satellites(regime), queryFn: () => api.satellites(regime) });

export const useConjunctions = (minPc = 0) =>
  useQuery({ queryKey: qk.conjunctions(minPc), queryFn: () => api.conjunctions(minPc) });

export const useKg = () =>
  useQuery({
    queryKey: qk.kg(),
    queryFn: async () => {
      const [n, e] = await Promise.all([api.kgNodes(), api.kgEdges()]);
      return { nodes: n.items, edges: e.items };
    },
  });

export const useFindings = (status?: FindingStatus, cortex?: string) =>
  useQuery({ queryKey: qk.findings(status, cortex), queryFn: () => api.findings({ status, cortex }) });

export const useFinding = (id: string | null) =>
  useQuery({
    queryKey: qk.finding(id ?? ""),
    queryFn: () => api.finding(id!),
    enabled: id !== null,
  });

export const useStats = () =>
  useQuery({ queryKey: qk.stats(), queryFn: () => api.stats() });

export const useDecision = () => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, decision, reason }: { id: string; decision: FindingStatus; reason?: string }) =>
      api.decision(id, decision, reason),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["findings"] });
      qc.invalidateQueries({ queryKey: ["stats"] });
    },
  });
};

export const useCycles = () =>
  useQuery({ queryKey: ["cycles"], queryFn: () => api.cycles() });

export const useLaunchCycle = () => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (kind: "thalamus" | "fish" | "both") => api.runCycle(kind),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["findings"] });
      qc.invalidateQueries({ queryKey: ["stats"] });
      qc.invalidateQueries({ queryKey: ["cycles"] });
    },
  });
};
