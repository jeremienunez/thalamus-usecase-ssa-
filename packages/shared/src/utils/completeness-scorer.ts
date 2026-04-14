/**
 * SPEC-SH-003 — CompletenessScorer
 * Adaptive weight normalization: weights redistribute across present components
 * so the score stays in [0, 1] regardless of coverage.
 */

export interface ScorerComponent {
  readonly key: string;
  readonly weight: number;
  readonly value: number | null | undefined;
}

export interface CompletenessResult {
  readonly score: number | null;
  readonly coverage: number;
  readonly presentKeys: readonly string[];
  readonly missingKeys: readonly string[];
}

export function scoreCompleteness(
  components: readonly ScorerComponent[],
): CompletenessResult {
  let totalWeight = 0;
  let presentWeight = 0;
  let weightedSum = 0;
  const presentKeys: string[] = [];
  const missingKeys: string[] = [];

  for (const c of components) {
    if (!Number.isFinite(c.weight) || c.weight < 0) {
      throw new RangeError(
        `Invalid weight for component "${c.key}": must be finite and >= 0`,
      );
    }
    totalWeight += c.weight;

    if (c.value === null || c.value === undefined) {
      missingKeys.push(c.key);
      continue;
    }

    if (!Number.isFinite(c.value) || c.value < 0 || c.value > 1) {
      throw new RangeError(
        `Invalid value for component "${c.key}": must be in [0, 1]`,
      );
    }

    presentKeys.push(c.key);
    presentWeight += c.weight;
    weightedSum += c.weight * c.value;
  }

  if (presentWeight === 0) {
    return {
      score: null,
      coverage: 0,
      presentKeys,
      missingKeys,
    };
  }

  const coverage = totalWeight === 0 ? 0 : presentWeight / totalWeight;

  return {
    score: weightedSum / presentWeight,
    coverage,
    presentKeys,
    missingKeys,
  };
}
