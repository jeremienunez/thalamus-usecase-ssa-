/**
 * Aggregator — cluster fish outcomes into a coverage distribution.
 *
 * Input: sim_swarm id. Reads every completed sim_run's terminal agent turn
 * (highest turn_index with actor_kind='agent'), extracts the observable
 * summary embedding, and groups them via cosine k-means++ (inline, no
 * external dep).
 *
 * Output: SwarmAggregate — cluster fractions, modal outcome, divergence.
 *
 * Fallback: if embeddings are unavailable (Voyage not configured) or fewer
 * than 2 distinct vectors, clustering degrades to bucketing by action.kind.
 */

import { createLogger } from "@interview/shared/observability";
import { mapWithConcurrency } from "@interview/shared/utils";
import type { EmbedFn } from "./memory.service";
import type { TurnAction } from "./types";
import type { SimAggregationStrategy, SimSwarmStore } from "./ports";

// Same budget as memory.service — swarms of ~20 fish produce aggregator
// batches around that size; 8 concurrent embeds keeps us off rate limits.
const EMBED_CONCURRENCY = 8;

const logger = createLogger("sim-aggregator");

export interface FishTerminal {
  simRunId: number;
  fishIndex: number;
  agentIndex: number | null;
  action: TurnAction;
  observableSummary: string;
  embedding: number[] | null;
  status: "done" | "failed";
  turnsPlayed: number;
}

export interface Cluster {
  label: string;
  fraction: number;
  memberFishIndexes: number[];
  exemplarSimRunId: number;
  exemplarAction: TurnAction;
  exemplarSummary: string;
  centroid: number[] | null;
}

export interface SwarmAggregate {
  swarmId: number;
  totalFish: number;
  quorumMet: boolean;
  succeededFish: number;
  failedFish: number;
  clusters: Cluster[];
  modal: {
    actionKind: TurnAction["kind"];
    fraction: number;
    exemplarSimRunId: number;
    exemplarAction: TurnAction;
  } | null;
  divergenceScore: number; // 1 - maxClusterFraction; 0 = unanimous, 1 = maximal spread
}

export interface AggregatorDeps {
  swarmStore: Pick<SimSwarmStore, "getSwarm" | "listTerminalsForSwarm">;
  embed?: EmbedFn;
  /** Plan 2 · B.8 — pack-provided label + fallback bucketing. */
  strategy: SimAggregationStrategy;
}

export class AggregatorService {
  constructor(private readonly deps: AggregatorDeps) {}

  async aggregate(swarmId: number): Promise<SwarmAggregate> {
    const [swarm, fish] = await Promise.all([
      this.loadSwarm(swarmId),
      this.loadTerminals(swarmId),
    ]);

    if (!swarm) throw new Error(`sim_swarm ${swarmId} not found`);

    const succeeded = fish.filter((f) => f.status === "done");
    const failed = fish.filter((f) => f.status !== "done").length;
    const quorumRequired = Math.ceil(swarm.size * (swarm.quorumPct ?? 0.8));
    const quorumMet = succeeded.length >= quorumRequired;

    if (!quorumMet) {
      logger.warn(
        { swarmId, succeededFish: succeeded.length, quorumRequired },
        "quorum not met — returning empty aggregate",
      );
      return {
        swarmId,
        totalFish: swarm.size,
        quorumMet: false,
        succeededFish: succeeded.length,
        failedFish: failed,
        clusters: [],
        modal: null,
        divergenceScore: 1,
      };
    }

    const clusters = await this.cluster(succeeded);
    const totalSuccessful = succeeded.length || 1;

    // Modal = largest cluster. If tied, pick the one with the smallest
    // exemplarSimRunId for determinism.
    const sorted = [...clusters].sort((a, b) => {
      if (b.fraction !== a.fraction) return b.fraction - a.fraction;
      return a.exemplarSimRunId - b.exemplarSimRunId;
    });
    const top = sorted[0];

    const divergenceScore = top ? 1 - top.fraction : 1;

    const agg: SwarmAggregate = {
      swarmId,
      totalFish: swarm.size,
      quorumMet: true,
      succeededFish: succeeded.length,
      failedFish: failed,
      clusters: sorted,
      modal: top
        ? {
            actionKind: top.exemplarAction.kind,
            fraction: top.fraction,
            exemplarSimRunId: top.exemplarSimRunId,
            exemplarAction: top.exemplarAction,
          }
        : null,
      divergenceScore,
    };

    logger.info(
      {
        swarmId,
        totalFish: swarm.size,
        succeeded: succeeded.length,
        clusterCount: sorted.length,
        modal: agg.modal?.actionKind,
        modalFraction: agg.modal?.fraction,
        divergenceScore: Number(divergenceScore.toFixed(3)),
      },
      "aggregate complete",
    );

    return agg;
    void totalSuccessful; // reserved for future weighting
  }

  // -------------------------------------------------------------------
  // Loaders
  // -------------------------------------------------------------------

  private async loadSwarm(swarmId: number) {
    const row = await this.deps.swarmStore.getSwarm(swarmId);
    if (!row) return null;
    return { size: row.size, quorumPct: row.config.quorumPct };
  }

  private async loadTerminals(swarmId: number): Promise<FishTerminal[]> {
    const rows = await this.deps.swarmStore.listTerminalsForSwarm(swarmId);

    const terminals: FishTerminal[] = [];
    const textsToEmbed: string[] = [];
    const embedTargets: number[] = [];

    for (const row of rows) {
      if (!row.action || !row.observableSummary) continue;
      const terminal: FishTerminal = {
        simRunId: row.simRunId,
        fishIndex: row.fishIndex,
        agentIndex: row.agentIndex ?? null,
        action: row.action,
        observableSummary: row.observableSummary,
        embedding: null,
        status: row.runStatus === "done" ? "done" : "failed",
        turnsPlayed: row.turnsPlayed,
      };
      terminals.push(terminal);
      if (this.deps.embed) {
        textsToEmbed.push(row.observableSummary);
        embedTargets.push(terminals.length - 1);
      }
    }

    // Batch-embed with bounded concurrency, filling terminal.embedding in
    // place. Each embed is already `.catch`-wrapped so one bad row can't
    // abort the rest.
    if (this.deps.embed && textsToEmbed.length > 0) {
      const embed = this.deps.embed;
      const vectors = await mapWithConcurrency(
        textsToEmbed,
        EMBED_CONCURRENCY,
        (t) => embed(t).catch((): number[] | null => null),
      );
      for (let i = 0; i < vectors.length; i++) {
        terminals[embedTargets[i]].embedding = vectors[i];
      }
    }

    return terminals;
  }

  // -------------------------------------------------------------------
  // Clustering
  // -------------------------------------------------------------------

  private async cluster(fish: FishTerminal[]): Promise<Cluster[]> {
    if (fish.length === 0) return [];
    const withVec = fish.filter((f) => f.embedding && f.embedding.length > 0);

    if (withVec.length < 2) {
      return this.clusterByActionKind(fish);
    }
    // `clusterByActionKind` + `labelFromAction` are proxies for pack-owned logic
    // below; see SimAggregationStrategy port (Plan 2 · B.8).

    // Adaptive k: 1 cluster per ~10 fish, clamped [2, 7].
    const k = Math.max(2, Math.min(7, Math.ceil(withVec.length / 10)));
    const clusters = cosineKMeans(
      withVec.map((f) => f.embedding as number[]),
      k,
      10,
    );

    // Map each fish (including those without vectors) to a cluster:
    //   - Vectored: assigned by k-means.
    //   - Vectorless: bucketed by action.kind into the existing cluster whose
    //     exemplar shares that kind, else into their own fallback cluster.
    const clusterFish: FishTerminal[][] = Array.from(
      { length: k },
      (): FishTerminal[] => [],
    );
    for (let i = 0; i < withVec.length; i++) {
      clusterFish[clusters.assignments[i]].push(withVec[i]);
    }
    const vectorless = fish.filter((f) => !f.embedding || f.embedding.length === 0);
    for (const f of vectorless) {
      const host = clusterFish.findIndex((bucket) =>
        bucket.length > 0 && bucket[0].action.kind === f.action.kind,
      );
      if (host >= 0) clusterFish[host].push(f);
      else clusterFish[0].push(f); // default bucket
    }

    const total = fish.length;
    return clusterFish
      .map((members, idx) => {
        if (members.length === 0) return null;
        const exemplar = members[0];
        return {
          label: this.deps.strategy.labelAction(
            exemplar.action as unknown as Record<string, unknown>,
          ),
          fraction: members.length / total,
          memberFishIndexes: members.map((m) => m.fishIndex).sort((a, b) => a - b),
          exemplarSimRunId: exemplar.simRunId,
          exemplarAction: exemplar.action,
          exemplarSummary: exemplar.observableSummary,
          centroid: clusters.centroids[idx],
        };
      })
      .filter((c): c is Cluster => c !== null);
  }

  private clusterByActionKind(fish: FishTerminal[]): Cluster[] {
    // Bucket membership is decided by the pack.
    // The kernel hydrates the full Cluster with exemplar / centroid data.
    const packClusters = this.deps.strategy.clusterFallback(
      fish.map((f) => ({
        action: f.action as unknown as Record<string, unknown>,
        fishIndex: f.fishIndex,
        embedding: f.embedding,
      })),
    );
    const byFishIndex = new Map<number, FishTerminal>();
    for (const f of fish) byFishIndex.set(f.fishIndex, f);
    return packClusters.map((pc): Cluster => {
      const exemplar = byFishIndex.get(pc.memberFishIndexes[0])!;
      return {
        label: pc.label,
        fraction: pc.fraction,
        memberFishIndexes: pc.memberFishIndexes,
        exemplarSimRunId: exemplar.simRunId,
        exemplarAction: exemplar.action,
        exemplarSummary: exemplar.observableSummary,
        centroid: null,
      };
    });
  }
}

// -----------------------------------------------------------------------
// Inline cosine k-means with k-means++ init.
// Deterministic for fixed input ordering — does NOT use Math.random.
// -----------------------------------------------------------------------

interface KMeansResult {
  centroids: number[][];
  assignments: number[];
}

export function cosineKMeans(
  vectors: number[][],
  k: number,
  maxIters = 10,
): KMeansResult {
  if (vectors.length === 0) return { centroids: [], assignments: [] };
  const n = vectors.length;
  const dim = vectors[0].length;
  const kClamped = Math.min(k, n);

  // Normalise once — cosine similarity = dot product on unit vectors.
  const norms = vectors.map(l2Normalize);

  // k-means++ init (deterministic seed derived from vector content).
  const centroids: number[][] = [];
  const seed = deterministicSeed(norms);
  const firstIdx = seed % n;
  centroids.push(norms[firstIdx].slice());
  while (centroids.length < kClamped) {
    // Pick next centroid weighted by (1 - max cosSim to any existing)^2.
    // Fully deterministic: we pick the argmax of that weight (no RNG).
    let bestIdx = -1;
    let bestWeight = -Infinity;
    for (let i = 0; i < n; i++) {
      let maxSim = -1;
      for (const c of centroids) {
        const sim = dot(norms[i], c);
        if (sim > maxSim) maxSim = sim;
      }
      const weight = (1 - maxSim) * (1 - maxSim);
      if (weight > bestWeight) {
        bestWeight = weight;
        bestIdx = i;
      }
    }
    if (bestIdx === -1) break;
    centroids.push(norms[bestIdx].slice());
  }

  const assignments = new Array<number>(n).fill(0);
  for (let iter = 0; iter < maxIters; iter++) {
    // Assignment.
    let changes = 0;
    for (let i = 0; i < n; i++) {
      let best = 0;
      let bestSim = -Infinity;
      for (let c = 0; c < centroids.length; c++) {
        const sim = dot(norms[i], centroids[c]);
        if (sim > bestSim) {
          bestSim = sim;
          best = c;
        }
      }
      if (assignments[i] !== best) {
        changes++;
        assignments[i] = best;
      }
    }

    // Update centroids to the mean of their members, then re-normalise.
    const newCentroids: number[][] = Array.from({ length: centroids.length }, () =>
      new Array<number>(dim).fill(0),
    );
    const counts = new Array<number>(centroids.length).fill(0);
    for (let i = 0; i < n; i++) {
      const c = assignments[i];
      counts[c]++;
      for (let d = 0; d < dim; d++) {
        newCentroids[c][d] += norms[i][d];
      }
    }
    let delta = 0;
    for (let c = 0; c < centroids.length; c++) {
      if (counts[c] === 0) continue;
      for (let d = 0; d < dim; d++) newCentroids[c][d] /= counts[c];
      const normalized = l2Normalize(newCentroids[c]);
      for (let d = 0; d < dim; d++) {
        const diff = centroids[c][d] - normalized[d];
        delta += diff * diff;
      }
      centroids[c] = normalized;
    }

    if (changes === 0 || delta < 1e-6) break;
  }

  return { centroids, assignments };
}

function l2Normalize(v: number[]): number[] {
  let sq = 0;
  for (const x of v) sq += x * x;
  const norm = Math.sqrt(sq);
  if (norm < 1e-9) return v.slice();
  return v.map((x) => x / norm);
}

function dot(a: number[], b: number[]): number {
  let s = 0;
  for (let i = 0; i < a.length; i++) s += a[i] * b[i];
  return s;
}

function deterministicSeed(vectors: number[][]): number {
  // Sum of first coordinates as a stable, content-derived seed.
  let s = 0;
  for (const v of vectors) s += Math.floor((v[0] ?? 0) * 1e6);
  return Math.abs(s) >>> 0;
}
