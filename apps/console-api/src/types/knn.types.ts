// apps/console-api/src/types/knn.types.ts
export type KnnPropagateBody = {
  field?: string;
  k?: number;
  minSim?: number;
  limit?: number;
  dryRun?: boolean;
};
