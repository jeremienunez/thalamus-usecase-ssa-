# Product Decision

## Final Decision

No-go product decision:

> THL predicts Kelvins outcomes.

Go experimental decision:

> THL mines reviewable temporal hypotheses and can seed Fish branches.

This distinction matters. The current results do not show an infrastructure failure. They falsify a specific predictive claim on Kelvins under the hardened protocol.

## Decision Matrix

| Usage | Decision | Rationale |
|---|---|---|
| Write into the KG | No | THL outputs hypotheses, not facts. |
| Influence promotion | No | Predictive value is not demonstrated. |
| Serve as Kelvins predictive evidence | No | All hardened runs are falsified. |
| Be visible to general agents | No | Risk of over-treating correlations as facts. |
| Be visible to FollowUp planner | Shadow/audit only | It may suggest investigations, not decisions. |
| Generate reviewable hypotheses | Yes | Pattern mining still works as audit material. |
| Seed Fish branches | Yes, experimental | Must use `seeded_by_pattern_id` and anti-contamination tracking. |
| Human/Sweep review dashboard | Yes | Good fit for explainable hypothesis review. |
| Early-warning experiments | Yes | Needs a separate TCA-aware protocol. |

## Product Framing

Do not say:

> Temporal Hypothesis Layer predicts Kelvins risk outcomes.

Say:

> Temporal Hypothesis Layer mines auditable trajectory hypotheses that may seed follow-up investigations.

For Kelvins specifically:

> The hardened evaluation falsifies THL as a direct predictive evidence layer. THL remains eligible only as an experimental pattern-mining and Fish-branch-seeding layer.

## Why This Is A No-Go For Predictive Evidence

The strongest negative case in the current V2 rerun is `high_risk default`:

```text
THL F1:            0.250896
best baseline:      timestamp_shuffled_thl
best baseline F1:  0.306954
F1 lift:          -0.056058
bootstrap 95% CI: [-0.107115, -0.00543]
```

The interval is entirely negative, and the best baseline is the timestamp-shuffled THL control. This is not merely "not good enough"; it directly weakens the temporal-order claim.

The clean conceptual case is `high_risk physics_only`:

```text
THL F1:            0.177515
best baseline:      prefixspan_no_decay
best baseline F1:  0.192308
F1 lift:          -0.014793
bootstrap 95% CI: [-0.02577, -0.006056]
```

The selected physical patterns are plausible, but the STDP-like decay scorer underperforms the simpler no-decay episode baseline.

The closest case is `risk_escalation default`:

```text
THL F1:            0.113761
best baseline:      timestamp_shuffled_thl
best baseline F1:  0.133117
F1 lift:          -0.019356
bootstrap 95% CI: [-0.040906, -0.002448]
```

The gain is not demonstrated; the shuffled control wins again.

## Core Interpretation

The selected THL patterns often look like combinations of already-strong features, not clearly incremental temporal value.

Examples:

- `kelvins.object_type_rocket_body`
- `kelvins.risk_high -> kelvins.max_risk_high -> kelvins.chaser_covariance_high`
- `kelvins.max_risk_high -> kelvins.object_type_payload`
- `kelvins.cdm_observed -> kelvins.max_risk_high -> kelvins.object_type_payload`

These patterns show that the miner recovers frequent or strong signals. They do not prove that temporal order adds value beyond the components.

## Required Metric Before Reconsidering Product Integration

Add `incremental_temporal_lift`:

```text
P(outcome | sequence)
  - max(P(outcome | each individual event in sequence))
```

A sequence is useful temporal evidence only if it beats its strongest component.

Minimum next requirement:

```text
sequence_lift_over_best_component > 0
```

Stronger requirement:

```text
bootstrap CI lower bound for sequence_lift_over_best_component > 0
```
