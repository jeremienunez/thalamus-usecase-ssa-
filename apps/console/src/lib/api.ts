/** Legacy shim. DTOs live in shared/types; keep re-exports until all consumers migrate (Phase 7 deletes this file). */
export type {
  Regime,
  SourceClass,
  FindingStatus,
  EntityClass,
  SatelliteDTO,
  ConjunctionDTO,
  KgNodeDTO,
  KgEdgeDTO,
  FindingDTO,
  SweepSuggestionDTO,
  MissionTaskDTO,
  MissionStateDTO,
  AutonomyTickDTO,
  AutonomyStateDTO,
  CycleDTO,
} from "@/shared/types";

import type {
  Regime,
  FindingStatus,
  ConjunctionDTO,
  KgNodeDTO,
  KgEdgeDTO,
  FindingDTO,
  SweepSuggestionDTO,
  MissionStateDTO,
  AutonomyStateDTO,
  CycleDTO,
} from "@/shared/types";
import { createFetchApiClient } from "@/adapters/api/client";
import { createSatellitesApi } from "@/adapters/api/satellites";

const _fetcher = createFetchApiClient();
const _satellites = createSatellitesApi(_fetcher);

async function getJson<T>(url: string): Promise<T> {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`${res.status} ${res.statusText}`);
  return (await res.json()) as T;
}

export const api = {
  satellites: (regime?: Regime) => _satellites.list(regime),
  conjunctions: (minPc = 0) =>
    getJson<{ items: ConjunctionDTO[]; count: number }>(`/api/conjunctions?minPc=${minPc}`),
  kgNodes: () => getJson<{ items: KgNodeDTO[] }>(`/api/kg/nodes`),
  kgEdges: () => getJson<{ items: KgEdgeDTO[] }>(`/api/kg/edges`),
  findings: (params?: { status?: FindingStatus; cortex?: string }) => {
    const qs = new URLSearchParams();
    if (params?.status) qs.set("status", params.status);
    if (params?.cortex) qs.set("cortex", params.cortex);
    return getJson<{ items: FindingDTO[]; count: number }>(
      `/api/findings${qs.toString() ? `?${qs}` : ""}`,
    );
  },
  finding: (id: string) => getJson<FindingDTO>(`/api/findings/${encodeURIComponent(id)}`),
  decision: async (id: string, decision: FindingStatus, reason?: string) => {
    const res = await fetch(`/api/findings/${encodeURIComponent(id)}/decision`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ decision, reason }),
    });
    if (!res.ok) throw new Error(`${res.status}`);
    return (await res.json()) as { ok: boolean; finding: FindingDTO };
  },
  stats: () =>
    getJson<{
      satellites: number;
      conjunctions: number;
      kgNodes: number;
      kgEdges: number;
      findings: number;
      byStatus: Record<string, number>;
      byCortex: Record<string, number>;
    }>(`/api/stats`),
  runCycle: async (kind: "thalamus" | "fish" | "both") => {
    const res = await fetch(`/api/cycles/run`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ kind }),
    });
    if (!res.ok) throw new Error(`${res.status}`);
    return (await res.json()) as { cycle: CycleDTO };
  },
  cycles: () => getJson<{ items: CycleDTO[] }>(`/api/cycles`),
  sweepSuggestions: () =>
    getJson<{ items: SweepSuggestionDTO[]; count: number }>(`/api/sweep/suggestions`),
  missionStatus: () => getJson<MissionStateDTO>(`/api/sweep/mission/status`),
  missionStart: async () => {
    const res = await fetch(`/api/sweep/mission/start`, { method: "POST" });
    if (!res.ok) throw new Error(`${res.status}`);
    return (await res.json()) as { ok: boolean; state: MissionStateDTO };
  },
  missionStop: async () => {
    const res = await fetch(`/api/sweep/mission/stop`, { method: "POST" });
    if (!res.ok) throw new Error(`${res.status}`);
    return (await res.json()) as { ok: boolean; state: MissionStateDTO };
  },
  autonomyStatus: () => getJson<AutonomyStateDTO>(`/api/autonomy/status`),
  autonomyStart: async (intervalSec?: number) => {
    const res = await fetch(`/api/autonomy/start`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ intervalSec }),
    });
    if (!res.ok) throw new Error(`${res.status}`);
    return (await res.json()) as { ok: boolean; state: AutonomyStateDTO };
  },
  autonomyStop: async () => {
    const res = await fetch(`/api/autonomy/stop`, { method: "POST" });
    if (!res.ok) throw new Error(`${res.status}`);
    return (await res.json()) as { ok: boolean; state: AutonomyStateDTO };
  },
  reviewSuggestion: async (id: string, accept: boolean, reason?: string) => {
    const res = await fetch(`/api/sweep/suggestions/${encodeURIComponent(id)}/review`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ accept, reason }),
    });
    if (!res.ok) throw new Error(`${res.status}`);
    return (await res.json()) as {
      ok: boolean;
      reviewed: boolean;
      resolution: { status: string; affectedRows: number; errors?: string[] } | null;
    };
  },
};
