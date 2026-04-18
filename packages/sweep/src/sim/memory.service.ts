/**
 * Agent memory — append-only pgvector store scoped by (sim_run_id, agent_id).
 *
 * Invariant: every query is filtered by sim_run_id first. Fish must not
 * bleed into each other, so a memory row written for (run=A, agent=X) is
 * unreachable from any turn in (run=B, agent=X) even if the semantic
 * content is similar.
 *
 * Embedding is best-effort: if the embedder returns null (Voyage unset,
 * API failure), vector search falls back to recency within the same scope.
 */

import { createLogger } from "@interview/shared/observability";
import type { MemoryKind } from "./types";
import type { SimRuntimeStore, SimSubjectProvider } from "./ports";

const logger = createLogger("sim-memory");

export type EmbedFn = (text: string) => Promise<number[] | null>;

export interface MemoryRow {
  id: number;
  turnIndex: number;
  kind: MemoryKind;
  content: string;
  score?: number;
}

export interface ObservableTurnRow {
  turnIndex: number;
  actorKind: "agent" | "god" | "system";
  agentId: number | null;
  authorLabel: string | null;
  observableSummary: string;
}

export interface WriteMemoryInput {
  simRunId: number;
  agentId: number;
  turnIndex: number;
  kind: MemoryKind;
  content: string;
}

export interface TopKOpts {
  simRunId: number;
  agentId: number;
  query: string;
  k?: number;
}

export interface RecentObservableOpts {
  simRunId: number;
  sinceTurnIndex: number;
  excludeAgentId?: number;
  limit?: number;
}

export class MemoryService {
  constructor(
    private readonly store: SimRuntimeStore,
    private readonly embed: EmbedFn,
    private readonly subjects: SimSubjectProvider,
  ) {}

  async write(input: WriteMemoryInput): Promise<number> {
    const vec = await this.safelyEmbed(input.content);
    const [id] = await this.store.writeMemoryBatch([
      {
        simRunId: input.simRunId,
        agentId: input.agentId,
        turnIndex: input.turnIndex,
        kind: input.kind,
        content: input.content,
        embedding: vec ?? null,
      },
    ]);
    if (id === undefined) throw new Error("Failed to insert sim_agent_memory");
    return id;
  }

  async writeMany(rows: WriteMemoryInput[]): Promise<number[]> {
    if (rows.length === 0) return [];
    const vectors = await Promise.all(rows.map((r) => this.safelyEmbed(r.content)));
    return this.store.writeMemoryBatch(
      rows.map((r, i) => ({
        simRunId: r.simRunId,
        agentId: r.agentId,
        turnIndex: r.turnIndex,
        kind: r.kind,
        content: r.content,
        embedding: vectors[i] ?? null,
      })),
    );
  }

  async topK(opts: TopKOpts): Promise<MemoryRow[]> {
    const k = opts.k ?? 8;
    const qvec = await this.safelyEmbed(opts.query);

    if (!qvec) {
      return this.store.topKByRecency({
        simRunId: opts.simRunId,
        agentId: opts.agentId,
        k,
      });
    }

    return this.store.topKByVector({
      simRunId: opts.simRunId,
      agentId: opts.agentId,
      vec: qvec,
      k,
    });
  }

  async recentObservable(opts: RecentObservableOpts): Promise<ObservableTurnRow[]> {
    const rows = await this.store.recentObservable({
      simRunId: opts.simRunId,
      sinceTurnIndex: opts.sinceTurnIndex,
      excludeAgentId: opts.excludeAgentId,
      limit: opts.limit ?? 20,
    });

    const authorLabels = await this.lookupAuthorLabels(
      rows
        .map((r) => r.agentId)
        .filter((agentId): agentId is number => agentId !== null),
    );

    return rows.map((r) => ({
      turnIndex: r.turnIndex,
      actorKind: r.actorKind,
      agentId: r.agentId,
      authorLabel: r.agentId !== null ? authorLabels.get(r.agentId) ?? null : null,
      observableSummary: r.observableSummary,
    }));
  }

  private async safelyEmbed(text: string): Promise<number[] | null> {
    try {
      return await this.embed(text);
    } catch (err) {
      logger.warn({ err }, "embed failed; proceeding with null embedding");
      return null;
    }
  }

  private async lookupAuthorLabels(agentIds: number[]): Promise<Map<number, string>> {
    return this.subjects.getAuthorLabels(agentIds);
  }
}
