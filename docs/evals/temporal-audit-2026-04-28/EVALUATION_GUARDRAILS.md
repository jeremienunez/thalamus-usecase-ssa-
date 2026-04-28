# Evaluation Guardrails

These guardrails must be implemented before making any future THL temporal-value claim.

## 1. Separate Singletons From Temporal Episodes

Patterns of length 1 are not temporal evidence.

Example:

```text
kelvins.object_type_payload
```

This is a single-event/static-context signal. It belongs to a baseline or prior family, not to a temporal hypothesis claim.

Required reports:

- `length_1_patterns`
- `length_2_patterns`
- `length_3_plus_patterns`

Main comparison:

```text
THL length >= 2
vs
best single-event baseline
```

The key question:

> Do temporal episodes of length 2 or 3 beat single-event signals?

## 2. Measure Lift Over Components

For each pattern:

```text
A -> B -> C
```

Report:

```text
P(y | A)
P(y | B)
P(y | C)
P(y | A,B,C)
best_component_rate
sequence_lift_over_best_component
```

Required fields:

- `best_component_signature`
- `best_component_precision`
- `best_component_f1`
- `best_component_rate`
- `sequence_lift_over_best_component`

A pattern is temporally interesting only if:

```text
P(y | A,B,C) > max(P(y | A), P(y | B), P(y | C))
```

## 3. Prove Order Matters

For selected patterns, compare:

```text
A -> B -> C
C -> B -> A
random shuffle(A,B,C)
unordered co-presence(A,B,C)
```

Expected result:

```text
ordered sequence > reversed sequence
ordered sequence > random shuffle
ordered sequence > unordered co-presence
```

If performance is similar, THL is learning co-presence rather than temporal structure.

## 4. Add Timestamp-Shuffled Control

Keep event frequencies but shuffle timestamps within the evaluation scope.

Expected result:

```text
THL score should collapse or clearly degrade.
```

If THL remains close to the original result, the signal is probably not temporal.

## 5. Add Component Baseline Per Pattern

For every selected pattern, show the best component baseline beside the sequence.

Example:

```text
Pattern:
mahalanobis_low -> relative_speed_high -> chaser_covariance_high

Components:
mahalanobis_low:         precision / F1 / lift
relative_speed_high:     precision / F1 / lift
chaser_covariance_high:  precision / F1 / lift
full sequence:           precision / F1 / lift
```

This is the fastest way to determine whether THL adds anything beyond its inputs.

## 6. Track Temporal Order Quality

Projected events may have the same timestamp or synthetic order.

Every pattern should report:

```text
temporal_order_quality:
  real_time_ordered
  turn_ordered
  same_timestamp_ordered
  synthetic_ordered
```

Strong temporal claims should exclude `synthetic_ordered`.

`same_timestamp_ordered` may be deterministic for reproducibility, but should not be sold as true temporal order.

## 7. Ban Target Proxies In Clean Temporal Claims

For `high_risk`, these features must be tagged as target proxies:

- `risk_high`
- `max_risk_high`
- `risk_increase`
- `pc_estimate_above_threshold`
- any `terminal_status`
- outcome/review/promotion outcome markers

They may be useful operational benchmarks in default mode. They should be excluded from clean temporal-value claims.

## 8. Bootstrap By Event ID

Bootstrap must resample independent `event_id` groups, not rows.

The Kelvins data has:

```text
162634 rows
13154 event_ids
```

Rows within an `event_id` are not independent. Row-level bootstrap would make confidence intervals too optimistic.

Current hardened bootstrap uses event-level predictions/outcomes. Future bootstrap additions must preserve that grouping.

## 9. Required Baseline Set Before Product Claims

THL cannot be promoted unless it beats:

1. outcome prior,
2. frequency single-event,
3. best component baseline,
4. n-gram no-decay baseline,
5. timestamp-shuffled control,
6. last-observation baseline,
7. at least one simple interpretable supervised baseline.

