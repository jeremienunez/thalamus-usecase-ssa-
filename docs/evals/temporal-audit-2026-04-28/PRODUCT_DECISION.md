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

The strongest negative case is `high_risk default`:

```text
THL F1:            0.244813
best baseline F1:  0.300926
F1 lift:          -0.056113
bootstrap 95% CI: [-0.0786, -0.036012]
```

The interval is entirely negative. This is not merely "not good enough"; it is evidence that THL underperforms a simple single-event baseline for this claim.

The clean conceptual case is `high_risk physics_only`:

```text
THL F1:            0.095652
best baseline F1:  0.111369
F1 lift:          -0.015717
bootstrap 95% CI: [-0.071111, 0.032953]
```

The selected pattern is physically plausible, but not discriminative enough.

The closest case is `risk_escalation default`:

```text
THL F1:            0.115942
best baseline F1:  0.116883
F1 lift:          -0.000941
bootstrap 95% CI: [-0.043913, 0.039292]
```

At best, the gain is not demonstrated.

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

