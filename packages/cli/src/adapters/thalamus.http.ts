import type {
  CycleRunFindingDto,
  CycleRunResponseDto,
} from "@interview/shared/dto/cycle-run.dto";
import type { GraphTree } from "./graph";

/**
 * Thin fetch wrapper for `POST /api/cycles/run`.
 *
 * The CLI consumes the console-api HTTP contract instead of building a
 * ThalamusContainer in-process (CLAUDE.md §3.1 "no private bypass"). This
 * keeps the kernel/app boundary strict: one contract, one transport.
 *
 * The server returns `{ cycle: { findings, costUsd, ... } }`; this client
 * projects the adapter's expected `{ findings, costUsd }` shape out of it.
 */

export type ThalamusHttpFinding = CycleRunFindingDto;

export interface ThalamusHttpRunCycleInput {
  query: string;
  /** Correlation id for the calling turn (forwarded as trace context). */
  traceId?: string;
}

export interface ThalamusHttpRunCycleResult {
  findings: ThalamusHttpFinding[];
  costUsd: number;
}

type ThalamusHttpKgNode = {
  id: string;
};

type ThalamusHttpKgEdge = {
  id: string;
  source: string;
  target: string;
};

type ThalamusHttpKgGraphResponse = {
  root: string;
  nodes: ThalamusHttpKgNode[];
  edges: ThalamusHttpKgEdge[];
};

type CyclesRunResponseBody = CycleRunResponseDto;

export class ThalamusHttpClient {
  constructor(
    private readonly baseUrl: string,
    private readonly auth?: string,
  ) {}

  async runCycle(
    input: ThalamusHttpRunCycleInput,
  ): Promise<ThalamusHttpRunCycleResult> {
    const headers: Record<string, string> = {
      "content-type": "application/json",
    };
    if (this.auth) headers.authorization = `Bearer ${this.auth}`;
    if (input.traceId) headers["x-trace-id"] = input.traceId;

    const res = await fetch(`${this.baseUrl}/api/cycles/run`, {
      method: "POST",
      headers,
      body: JSON.stringify({ kind: "thalamus", query: input.query }),
    });

    const raw = (await res.json().catch((): null => null)) as
      | (CyclesRunResponseBody & { error?: string })
      | null;

    if (!res.ok) {
      const msg =
        raw && typeof raw === "object" && "error" in raw && raw.error
          ? String(raw.error)
          : `status=${res.status}`;
      throw new Error(`thalamus/runCycle failed: ${msg}`);
    }
    if (!raw || !("cycle" in raw) || !raw.cycle) {
      throw new Error(
        `thalamus/runCycle: malformed response (no cycle field)`,
      );
    }
    if (raw.cycle.error) {
      throw new Error(`thalamus/runCycle: ${raw.cycle.error}`);
    }
    return {
      findings: raw.cycle.findings ?? [],
      costUsd: raw.cycle.costUsd ?? 0,
    };
  }

  async getGraphNeighbourhood(input: {
    entity: string;
    depth?: number;
  }): Promise<GraphTree> {
    const headers: Record<string, string> = {};
    if (this.auth) headers.authorization = `Bearer ${this.auth}`;

    const url = new URL(
      `${this.baseUrl}/api/kg/graph/${encodeURIComponent(input.entity)}`,
    );
    if (input.depth !== undefined) {
      url.searchParams.set("depth", String(input.depth));
    }

    const res = await fetch(url, { headers });
    const raw = (await res.json().catch((): null => null)) as
      | (ThalamusHttpKgGraphResponse & { error?: string })
      | null;

    if (!res.ok) {
      const msg =
        raw && typeof raw === "object" && "error" in raw && raw.error
          ? String(raw.error)
          : `status=${res.status}`;
      throw new Error(`thalamus/getGraphNeighbourhood failed: ${msg}`);
    }
    if (!raw || !Array.isArray(raw.nodes) || !Array.isArray(raw.edges)) {
      throw new Error(
        "thalamus/getGraphNeighbourhood: malformed response",
      );
    }

    const adjacency = new Map<string, string[]>();
    const connect = (from: string, to: string): void => {
      adjacency.set(from, [...(adjacency.get(from) ?? []), to]);
    };
    raw.edges.forEach((edge) => {
      connect(edge.source, edge.target);
      connect(edge.target, edge.source);
    });

    const traversalRoot = raw.root ?? input.entity;
    const displayRoot = input.entity;
    const knownNodes = new Set(raw.nodes.map((node) => node.id));
    knownNodes.add(traversalRoot);
    const seen = new Set<string>([traversalRoot]);
    const levels: GraphTree["levels"] = [{ depth: 0, nodes: [displayRoot] }];
    let frontier = [traversalRoot];
    let currentDepth = 1;

    while (frontier.length > 0) {
      const next: string[] = [];
      for (const nodeId of frontier) {
        for (const neighbor of adjacency.get(nodeId) ?? []) {
          if (!knownNodes.has(neighbor) || seen.has(neighbor)) continue;
          seen.add(neighbor);
          next.push(neighbor);
        }
      }
      if (next.length === 0) break;
      levels.push({ depth: currentDepth, nodes: next });
      frontier = next;
      currentDepth += 1;
    }

    return { root: displayRoot, levels };
  }
}
