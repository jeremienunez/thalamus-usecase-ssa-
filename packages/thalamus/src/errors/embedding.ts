import { EMBEDDING_DIMENSIONS } from "@interview/db-schema";

export type EmbeddingOperation =
  | "storeFinding"
  | "semanticSearch"
  | "createFinding"
  | "upsertByDedupHash"
  | "findSimilar"
  | "searchBySimilarity";

export class InvalidEmbeddingDimensionError extends Error {
  readonly expected: number;
  readonly actual: number;
  readonly embedderName: string;
  readonly operation: EmbeddingOperation;

  constructor(opts: {
    expected?: number;
    actual: number;
    embedderName: string;
    operation: EmbeddingOperation;
  }) {
    const expected = opts.expected ?? EMBEDDING_DIMENSIONS;
    super(
      `Invalid embedding dimension from ${opts.embedderName} for ${opts.operation}: expected ${expected}, got ${opts.actual}`,
    );
    this.name = "InvalidEmbeddingDimensionError";
    this.expected = expected;
    this.actual = opts.actual;
    this.embedderName = opts.embedderName;
    this.operation = opts.operation;
  }
}

export function assertEmbeddingDimension(
  embedding: number[] | null,
  opts: { embedderName: string; operation: EmbeddingOperation },
): number[] | null {
  if (embedding === null) return null;

  if (
    embedding.length !== EMBEDDING_DIMENSIONS ||
    embedding.some((value) => !Number.isFinite(value))
  ) {
    throw new InvalidEmbeddingDimensionError({
      actual: embedding.length,
      embedderName: opts.embedderName,
      operation: opts.operation,
    });
  }

  return embedding;
}
