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

export const useSweepSuggestions = () =>
  useQuery({
    queryKey: ["sweep-suggestions"] as const,
    queryFn: () => api.sweepSuggestions(),
    refetchInterval: 15_000,
  });

export const useReviewSuggestion = () => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, accept, reason }: { id: string; accept: boolean; reason?: string }) =>
      api.reviewSuggestion(id, accept, reason),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["sweep-suggestions"] });
      qc.invalidateQueries({ queryKey: ["findings"] });
      qc.invalidateQueries({ queryKey: ["stats"] });
    },
  });
};

export const useMissionStatus = () =>
  useQuery({
    queryKey: ["sweep-mission-status"] as const,
    queryFn: () => api.missionStatus(),
    refetchInterval: 2500,
  });

export const useMissionStart = () => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: () => api.missionStart(),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["sweep-mission-status"] });
      qc.invalidateQueries({ queryKey: ["sweep-suggestions"] });
    },
  });
};

export const useMissionStop = () => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: () => api.missionStop(),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["sweep-mission-status"] });
    },
  });
};

export const useAutonomyStatus = () =>
  useQuery({
    queryKey: ["autonomy-status"] as const,
    queryFn: () => api.autonomyStatus(),
    refetchInterval: 3000,
  });

export const useAutonomyStart = () => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (intervalSec?: number) => api.autonomyStart(intervalSec),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["autonomy-status"] });
    },
  });
};

export const useAutonomyStop = () => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: () => api.autonomyStop(),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["autonomy-status"] });
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
