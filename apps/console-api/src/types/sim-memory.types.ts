import type { MemoryKind } from "@interview/db-schema";

export interface SimMemoryRow {
  id: bigint;
  turnIndex: number;
  kind: MemoryKind;
  content: string;
  /** Cosine similarity in [0,1]; present only on vector-search results. */
  score?: number;
}

export interface SimMemoryWriteRow {
  simRunId: bigint;
  agentId: bigint;
  turnIndex: number;
  kind: MemoryKind;
  content: string;
  embedding: number[] | null;
}

export interface SimMemoryTopKByVectorOpts {
  simRunId: bigint;
  agentId: bigint;
  vec: number[];
  k: number;
}

export interface SimMemoryTopKByRecencyOpts {
  simRunId: bigint;
  agentId: bigint;
  k: number;
}
