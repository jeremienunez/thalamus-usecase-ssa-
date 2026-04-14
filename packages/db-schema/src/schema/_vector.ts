import { customType } from "drizzle-orm/pg-core";

/**
 * pgvector column helper.
 *
 * DDL: `embedding halfvec(2048)` (Voyage-4 Matryoshka max recall).
 *
 * Why halfvec: pgvector's HNSW index caps at 2000 dims for full `vector`.
 * `halfvec` (IEEE float16) supports HNSW up to 4000 dims at half the storage
 * and within-noise recall for cosine similarity on embedding vectors.
 *
 * The runtime representation is `number[]` on the TS side; pgvector accepts
 * the same `[n,n,n]` wire format for both `vector` and `halfvec`. ANN queries
 * must cast the parameter with `::halfvec` (see repositories).
 */
export const vector = (name: string, { dimensions }: { dimensions: number }) =>
  customType<{ data: number[]; driverData: string }>({
    dataType() {
      return `halfvec(${dimensions})`;
    },
    toDriver(value: number[]): string {
      return `[${value.join(",")}]`;
    },
    fromDriver(value: string): number[] {
      return value.slice(1, -1).split(",").map(Number);
    },
  })(name);

export const EMBEDDING_DIMENSIONS = 2048;
