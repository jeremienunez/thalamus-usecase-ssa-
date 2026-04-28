# Next Experiments

The next work should not tune STDP-like scoring until the target task is reframed.

## Experiment 1: Pure Early Warning

New target:

```text
future_high_risk_within_H
```

Horizons:

```text
H = 1 day
H = 3 days
H = 7 days
```

Lead-time constraints:

```text
minLeadDays = 1
minLeadDays = 3
```

Metrics:

- `precision_at_k`
- `event_level_recall`
- `alerts_per_100_events`
- `median_lead_time_days`
- `useful_alert_rate`

Goal:

> Alert before the simple risk signal becomes obvious, not after it already exists.

## Experiment 2: TCA-Aware Windows

Replace raw synthetic time windows with `time_to_tca` buckets.

Candidate buckets:

```text
TCA -14d to -7d
TCA -7d to -3d
TCA -3d to -1d
TCA -1d to 0d
```

Hypothesis:

> The same signal can have different meaning depending on distance to TCA.

Example:

```text
relative_speed_high at TCA -14d
```

may not mean the same thing as:

```text
relative_speed_high at TCA -1d
```

## Experiment 3: Sequence Synergy Only

Filter patterns to keep only sequences that beat their components.

Candidate criterion:

```text
sequence_lift_over_best_component >= 0.02
min_support >= N
bootstrap CI lower bound > 0
```

Interpretation:

- If few patterns survive, the dataset may not contain exploitable temporal value for this approach.
- If some survive, those are the only patterns worth considering for THL review.

## Experiment 4: Branch-Generation Utility

Evaluate THL as Fish branch-seeding infrastructure, not as a classifier.

Question:

> When THL seeds a Fish branch, does that branch produce more useful evidence than an unseeded or baseline-seeded branch?

Metrics:

- `useful_review_evidence_rate`
- `sweep_acceptance_rate`
- `fish_branch_yield`
- `cost_per_useful_evidence`
- `delta_vs_random_branch_seed`
- `delta_vs_frequency_baseline_seed`

This is likely the strongest future use-case for THL.

## Implementation Priority

1. Add pattern length reporting and exclude length-1 patterns from temporal claims.
2. Add component baselines and `sequence_lift_over_best_component`.
3. Add order-shuffle and timestamp-shuffle controls.
4. Add `temporal_order_quality`.
5. Add target-proxy tagging.
6. Implement early-warning target generation.
7. Implement TCA-aware event projection.
8. Evaluate Fish branch utility.

## Stop Condition

If sequence synergy and timestamp-shuffle controls fail, do not continue tuning the scorer for Kelvins final-outcome prediction.

At that point, THL should remain only:

- a hypothesis miner,
- a review dashboard input,
- a Fish branch seed generator.

