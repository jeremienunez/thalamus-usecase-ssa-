# Observations

## Executive Conclusion

The current Temporal Hypothesis Layer implementation should not be promoted as predictive evidence on Kelvins.

Product decision:

- No-go for `THL predicts Kelvins outcomes`.
- Go only for `THL mines reviewable temporal hypotheses / Fish branch seeds`.

This is not a failure of the THL infrastructure. It is a falsification of the current predictive claim on this dataset and target.

Across the hardened full `train_data.csv` runs:

- All Popper verdicts are `falsified`.
- THL does not beat the best simple baseline on F1.
- Bootstrap confidence intervals do not support a positive F1 lift.
- The cleanest variants, especially `physics_only`, remain below baseline.

The practical read:

- THL can extract temporal patterns.
- Those patterns are not strong enough on this dataset.
- Kelvins appears better captured by simple instantaneous or single-event signals than by the current temporal episode scorer.
- Many selected THL patterns look like combinations of already-strong features, not clear incremental temporal value.

Missing critical metric:

```text
incremental_temporal_lift =
  P(outcome | sequence)
  - max(P(outcome | each individual event in sequence))
```

Without this metric, THL may simply re-express a frequent single-event baseline as a temporal sequence.

## Hardened Full Dataset Runs

Common setup:

- Row count: `162634`
- Event ID count: `13154`
- Split policy: `event_id_grouped_outcome_stratified_hash_no_row_leakage`
- Split ratios: train `0.6`, validation `0.2`, test `0.2`
- Popper criteria:
  - `minTestPrecision >= 0.2`
  - `minTestF1 >= 0.2`
  - `minF1LiftOverBestBaseline >= 0.02`
- Bootstrap: deterministic, 500 iterations, 95% CI over F1 lift vs best baseline.

### 1. high_risk default

Verdict: `falsified`

- THL precision: `0.144254`
- THL recall: `0.808219`
- THL F1: `0.244813`
- Best baseline: `frequency_single_event`
- Best baseline precision: `0.181058`
- Best baseline F1: `0.300926`
- F1 lift: `-0.056113`
- Bootstrap 95% CI: `[-0.0786, -0.036012]`

Observation:

THL passes the absolute F1 threshold but loses clearly to the single-event frequency baseline. The confidence interval is entirely negative. This is a strong falsification for `high_risk` default.

Selected THL patterns:

- `kelvins.object_type_rocket_body`
- `kelvins.mahalanobis_low -> kelvins.chaser_covariance_high -> kelvins.object_type_debris`
- `kelvins.risk_high -> kelvins.max_risk_high -> kelvins.chaser_covariance_high`

Interpretation:

The selected patterns include categorical object type and direct risk features. Even with these features available, THL underperforms the simpler `risk_high` single-event baseline.

### 2. high_risk physics_only

Verdict: `falsified`

- THL precision: `0.070064`
- THL recall: `0.150685`
- THL F1: `0.095652`
- Best baseline: `frequency_single_event`
- Best baseline precision: `0.067039`
- Best baseline F1: `0.111369`
- F1 lift: `-0.015717`
- Bootstrap 95% CI: `[-0.071111, 0.032953]`

Observation:

The clean physical-only variant is weak. Precision is low, recall drops, and F1 remains below baseline.

Selected THL pattern:

- `kelvins.mahalanobis_low -> kelvins.relative_speed_high -> kelvins.chaser_covariance_high`

Interpretation:

This is physically plausible, but not sufficiently discriminative.

### 3. risk_escalation default

Verdict: `falsified`

- THL precision: `0.084848`
- THL recall: `0.183007`
- THL F1: `0.115942`
- Best baseline: `risk_increase_rule`
- Best baseline precision: `0.064244`
- Best baseline F1: `0.116883`
- F1 lift: `-0.000941`
- Bootstrap 95% CI: `[-0.043913, 0.039292]`

Observation:

This is the closest run, but still does not beat baseline. The bootstrap interval crosses zero and does not clear the required positive lift.

Selected THL patterns:

- `kelvins.object_type_payload`
- `kelvins.relative_speed_high -> kelvins.chaser_covariance_high -> kelvins.object_type_payload`
- `kelvins.max_risk_high -> kelvins.object_type_payload`
- `kelvins.cdm_observed -> kelvins.max_risk_high -> kelvins.object_type_payload`
- `kelvins.chaser_covariance_high -> kelvins.object_type_payload`
- `kelvins.target_covariance_high -> kelvins.chaser_covariance_high -> kelvins.object_type_debris`

Interpretation:

The default `risk_escalation` run is contaminated by object type and direct risk-ish features. It still only matches, but does not beat, a simple risk increase rule.

### 4. risk_escalation physics_only

Verdict: `falsified`

- THL precision: `0.084906`
- THL recall: `0.117647`
- THL F1: `0.098630`
- Best baseline: `frequency_single_event`
- Best baseline precision: `0.059081`
- Best baseline F1: `0.110747`
- F1 lift: `-0.012117`
- Bootstrap 95% CI: `[-0.049768, 0.030845]`

Observation:

This is the cleanest conceptual test. It fails. THL has higher precision than the best baseline but lower recall and lower F1.

Selected THL patterns:

- `kelvins.mahalanobis_low -> kelvins.relative_speed_high -> kelvins.chaser_covariance_high`
- `kelvins.relative_speed_high -> kelvins.target_covariance_high -> kelvins.chaser_covariance_high`
- `kelvins.target_covariance_high -> kelvins.chaser_covariance_high`

Interpretation:

These are plausible physical trajectories, but they do not produce enough useful coverage.

## Smoke Run Observation

Hardened default `high_risk` on `test_data.csv`:

- Row count: `24484`
- Event ID count: `2167`
- THL F1: `0.168224`
- Best baseline: `frequency_single_event`
- Best baseline F1: `0.555556`
- F1 lift: `-0.387332`
- Bootstrap 95% CI: `[-0.45762, -0.310238]`

Observation:

The smoke run is also strongly negative, but it is not the primary evidence because `test_data.csv` is smaller.

## Pre-Hardening Observations

These runs are superseded by the hardened protocol but explain why hardening was needed.

- `risk_features_removed`, target `high_risk`:
  - THL precision `0.102041`
  - THL F1 `0.136364`
  - Best baseline F1 `0.110132`
  - F1 lift `+0.026232`
  - Still falsified because absolute precision/F1 were too low.

- `physics_only`, target `high_risk`:
  - THL precision `0.070064`
  - THL F1 `0.095652`
  - Best baseline F1 `0.111369`
  - Falsified.

- `physics_only`, target `high_risk`, `minLeadDays=1`:
  - THL precision `0.040984`
  - THL F1 `0.051282`
  - Best baseline F1 `0.082262`
  - Falsified.

- `risk_escalation`, default:
  - THL precision `0.084848`
  - THL recall `0.189189`
  - THL F1 `0.117155`
  - Best baseline `risk_increase_rule`, F1 `0.112626`
  - F1 lift `+0.004529`
  - Not meaningful under hardened criteria.

- `risk_escalation`, `physics_only`:
  - THL precision `0.080189`
  - THL recall `0.114865`
  - THL F1 `0.094444`
  - Best baseline `frequency_single_event`, F1 `0.107686`
  - Falsified.

## What This Suggests

The current THL framing is probably not the right product claim for Kelvins.

Better next hypotheses:

1. THL as an early-warning lead-time signal, not a final classifier.
2. THL as a triage pattern miner for human/Sweep review, not a predictive layer.
3. THL as a branch generator for Fish experiments, evaluated by downstream utility rather than direct F1.
4. THL with stronger feature discretization and time-to-TCA-aware windows.

## Decision Recommendation

Do not integrate THL as a predictive product feature yet.

Keep it as experimental infrastructure only if it helps:

- generate reviewable hypotheses,
- seed Fish branches,
- inspect trajectory motifs,
- support future early-warning experiments.
