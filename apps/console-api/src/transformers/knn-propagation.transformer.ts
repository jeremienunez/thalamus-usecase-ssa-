import type { KnnSampleFillView } from "../types/sweep.types";

export function toKnnSampleFillView(args: {
  id: string;
  name: string;
  value: string | number;
  neighbourIds: string[];
  cosSim: number;
}): KnnSampleFillView {
  return {
    id: args.id,
    name: args.name,
    value: args.value,
    neighbourIds: args.neighbourIds.slice(0, 3),
    cosSim: Number(args.cosSim.toFixed(3)),
  };
}
