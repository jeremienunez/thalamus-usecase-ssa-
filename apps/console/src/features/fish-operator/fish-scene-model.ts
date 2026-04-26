import type {
  OperatorSwarmStatusDto,
  SimFishTerminalDto,
  SimRunStatusDto,
  SwarmClustersDto,
} from "@/dto/http";

export type FishSceneStatusFilter = "all" | SimRunStatusDto;
export type FishSceneClusterFilter = "all" | "unclustered" | string;
export type FishSceneTerminalFilter = "all" | "none" | string;

export interface FishSceneFilters {
  status: FishSceneStatusFilter;
  cluster: FishSceneClusterFilter;
  terminalAction: FishSceneTerminalFilter;
}

export interface FishSceneInput {
  status: OperatorSwarmStatusDto;
  clusters?: SwarmClustersDto | null;
  terminals?: SimFishTerminalDto[];
  selectedFishIndex?: number | null;
  filters?: Partial<FishSceneFilters>;
}

export interface FishSceneNode {
  id: string;
  pickableId: string;
  fishIndex: number;
  status: SimRunStatusDto;
  clusterIndex: number | null;
  clusterLabel: string | null;
  terminalActionKind: string | null;
  selected: boolean;
  color: string;
  turnProgress: number;
  costScore: number;
}

export interface FishSceneModel {
  swarmId: string;
  nodes: FishSceneNode[];
  visibleNodes: FishSceneNode[];
  summary: {
    total: number;
    visible: number;
    byStatus: Record<SimRunStatusDto, number>;
    byCluster: Record<string, number>;
    byTerminalAction: Record<string, number>;
  };
}

const DEFAULT_FILTERS: FishSceneFilters = {
  status: "all",
  cluster: "all",
  terminalAction: "all",
};

const FILL_STATUS_ORDER: SimRunStatusDto[] = [
  "running",
  "pending",
  "done",
  "failed",
  "timeout",
  "paused",
];

const STATUS_COLORS: Record<SimRunStatusDto, string> = {
  pending: "#FBBF24",
  running: "#67E8F9",
  paused: "#94A3B8",
  done: "#34D399",
  failed: "#FB7185",
  timeout: "#C084FC",
};

export function buildFishSceneModel(input: FishSceneInput): FishSceneModel {
  const filters = { ...DEFAULT_FILTERS, ...input.filters };
  const clusterByFish = mapClusters(input.clusters?.clusters ?? []);
  const terminalByFish = new Map(
    (input.terminals ?? []).map((terminal) => [terminal.fishIndex, terminal]),
  );
  const inferredStatuses = inferStatuses(input.status, terminalByFish);

  const maxTurns = computeMaxTurns(input.terminals ?? []);
  const nodes = Array.from({ length: input.status.size }, (_item, fishIndex) => {
    const terminal = terminalByFish.get(fishIndex);
    const cluster = clusterByFish.get(fishIndex) ?? null;
    const status = terminal?.runStatus ?? inferredStatuses[fishIndex] ?? "pending";
    return {
      id: `fish:${fishIndex}`,
      pickableId: `${input.status.swarmId}:${fishIndex}`,
      fishIndex,
      status,
      clusterIndex: cluster?.index ?? null,
      clusterLabel: cluster?.label ?? null,
      terminalActionKind: actionKindOf(terminal?.action ?? null),
      selected: input.selectedFishIndex === fishIndex,
      color: STATUS_COLORS[status],
      turnProgress: turnProgressFor(terminal, maxTurns),
      costScore: costScoreFor(terminal),
    };
  });

  const visibleNodes = nodes.filter((node) => matchesFilters(node, filters));

  return {
    swarmId: input.status.swarmId,
    nodes,
    visibleNodes,
    summary: {
      total: nodes.length,
      visible: visibleNodes.length,
      byStatus: countByStatus(nodes),
      byCluster: countByCluster(nodes),
      byTerminalAction: countByTerminalAction(nodes),
    },
  };
}

function mapClusters(
  clusters: Array<Record<string, unknown>>,
): Map<number, { index: number; label: string | null }> {
  const mapped = new Map<number, { index: number; label: string | null }>();
  clusters.forEach((cluster, index) => {
    const label = typeof cluster.label === "string" ? cluster.label : null;
    for (const fishIndex of fishIndexesOf(cluster)) {
      mapped.set(fishIndex, { index, label });
    }
  });
  return mapped;
}

function fishIndexesOf(cluster: Record<string, unknown>): number[] {
  const direct =
    readNumberArray(cluster.memberFishIndexes) ??
    readNumberArray(cluster.fishIndexes) ??
    readNumberArray(cluster.members);
  if (direct) return direct;

  if (!Array.isArray(cluster.members)) return [];
  return cluster.members
    .map((member) => {
      if (typeof member === "number") return member;
      if (isRecord(member) && typeof member.fishIndex === "number") {
        return member.fishIndex;
      }
      return null;
    })
    .filter((value): value is number => value !== null);
}

function readNumberArray(value: unknown): number[] | null {
  return Array.isArray(value) && value.every((item) => typeof item === "number")
    ? value
    : null;
}

function inferStatuses(
  status: OperatorSwarmStatusDto,
  terminalByFish: Map<number, SimFishTerminalDto>,
): SimRunStatusDto[] {
  const counts: Record<SimRunStatusDto, number> = {
    pending: status.pending,
    running: status.running,
    paused: 0,
    done: status.done,
    failed: status.failed,
    timeout: status.timeout,
  };
  for (const terminal of terminalByFish.values()) {
    counts[terminal.runStatus] = Math.max(0, counts[terminal.runStatus] - 1);
  }

  const inferred: SimRunStatusDto[] = [];
  for (let fishIndex = 0; fishIndex < status.size; fishIndex++) {
    const terminal = terminalByFish.get(fishIndex);
    if (terminal) {
      inferred[fishIndex] = terminal.runStatus;
      continue;
    }

    const next = FILL_STATUS_ORDER.find((candidate) => counts[candidate] > 0);
    if (next) {
      inferred[fishIndex] = next;
      counts[next] -= 1;
    } else {
      inferred[fishIndex] = status.status === "running" ? "running" : "pending";
    }
  }
  return inferred;
}

function actionKindOf(action: Record<string, unknown> | null): string | null {
  return typeof action?.kind === "string" ? action.kind : null;
}

function computeMaxTurns(terminals: SimFishTerminalDto[]): number {
  let max = 1;
  for (const t of terminals) {
    if (t.turnsPlayed > max) max = t.turnsPlayed;
  }
  return max;
}

function turnProgressFor(
  terminal: SimFishTerminalDto | undefined,
  maxTurns: number,
): number {
  const played = terminal?.turnsPlayed ?? 0;
  if (maxTurns <= 0) return 0;
  const raw = played / maxTurns;
  return raw < 0 ? 0 : raw > 1 ? 1 : raw;
}

function costScoreFor(terminal: SimFishTerminalDto | undefined): number {
  // The terminal DTO does not carry per-fish cost — it lives on the per-fish
  // timeline, only fetched on selection. Use turnsPlayed as a stable proxy so
  // the swarm-wide plot has a meaningful radius channel.
  if (!terminal) return 0;
  return Math.sqrt(Math.max(0, terminal.turnsPlayed));
}

function matchesFilters(node: FishSceneNode, filters: FishSceneFilters): boolean {
  if (filters.status !== "all" && node.status !== filters.status) return false;
  if (filters.cluster !== "all") {
    if (filters.cluster === "unclustered") {
      if (node.clusterLabel !== null) return false;
    } else if (node.clusterLabel !== filters.cluster) {
      return false;
    }
  }
  if (filters.terminalAction !== "all") {
    if (filters.terminalAction === "none") {
      if (node.terminalActionKind !== null) return false;
    } else if (node.terminalActionKind !== filters.terminalAction) {
      return false;
    }
  }
  return true;
}

function countByStatus(nodes: FishSceneNode[]): Record<SimRunStatusDto, number> {
  const counts: Record<SimRunStatusDto, number> = {
    pending: 0,
    running: 0,
    paused: 0,
    done: 0,
    failed: 0,
    timeout: 0,
  };
  for (const node of nodes) counts[node.status] += 1;
  return counts;
}

function countByCluster(nodes: FishSceneNode[]): Record<string, number> {
  const counts: Record<string, number> = {};
  for (const node of nodes) {
    const key = node.clusterLabel ?? "unclustered";
    counts[key] = (counts[key] ?? 0) + 1;
  }
  return counts;
}

function countByTerminalAction(nodes: FishSceneNode[]): Record<string, number> {
  const counts: Record<string, number> = {};
  for (const node of nodes) {
    const key = node.terminalActionKind ?? "none";
    counts[key] = (counts[key] ?? 0) + 1;
  }
  return counts;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
