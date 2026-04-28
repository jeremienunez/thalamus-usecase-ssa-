# Subagent Findings And Resolution Status

Four xhigh agents reviewed the Kelvins THL evaluation work.

## Hume: Code And Outcome Correctness

Findings:

- Main blind `risk_escalation` derivation and evaluation flow looked plausible.
- Non-blind `runKelvinsTemporalEvaluation` accepted arbitrary targets, which could silently produce bogus zero results.
- `--limit-rows` truncated before grouping by `event_id`, which could corrupt full event histories.
- Baseline wording was high-risk specific even for risk escalation.

Resolution:

- Non-blind runner now refuses non-`high_risk` targets and is marked smoke-only.
- `--limit-rows` removed and replaced by `--limit-events`.
- Baseline wording was generalized by target label.

Residual:

- Non-blind runner still exists for projection smoke only. It must not be used as evidence.

## Locke: Protocol And Leakage

Findings:

- High-risk threshold defines both label and risk features.
- Popper verdicts were point estimates only.
- Event splits were grouped by `event_id` but not outcome-stratified.
- `minLeadDays=0` is not a meaningful forecast horizon.
- Non-blind runner leaks outcomes by design and should be smoke-only.
- Baselines are too narrow for a broad claim.
- `--limit-rows` corrupts histories.

Resolution:

- Outcome-stratified event-id splits added.
- Split lock and per-split hashes added.
- Bootstrap 95% CI over F1 lift added to Popper verdict.
- Non-blind runner marked smoke-only and restricted.
- `--limit-rows` removed.
- `minLeadTimeDays=0` now emits a manifest warning.

Residual:

- `minLeadTimeDays=0` remains the default.
- Baselines remain simple.
- No multi-seed or repeated split suite yet.
- High-risk threshold feature leakage is still conceptually present in default high-risk runs.

## Jason: Tests And Edge Cases

Findings:

- Blind fixture had no negative class, so always-positive behavior could pass.
- `outcomeHiddenDuringPrediction` was asserted as a flag, not by inspecting event payloads.
- Risk-removal and physics-only tests could pass with zero selected patterns.
- `risk_escalation` boundary behavior was not tested.
- Baseline metric behavior was weakly asserted.
- Prediction matching had no temporal window bound.

Resolution:

- Mixed positive/negative fixture added.
- Blind experiment now rejects splits lacking target or non-target outcomes.
- Precursor events checked for outcome leakage.
- Risk-removal and physics-only tests require non-empty selected signatures and blacklist direct risk signals.
- `risk_escalation` boundary tests added.
- Prediction matching now respects `pattern_window_ms`.

Residual:

- Baseline metric tests are still not exhaustive.
- There is no detailed false-positive/false-negative audit fixture yet.

## Anscombe: CLI, Reproducibility, Performance

Findings:

- Runs lacked source hash, split lock, command, commit, and audit-grade metadata.
- `--limit-rows` corrupted histories.
- CLI buffers the entire CSV in memory.
- Scripts default to `test_data.csv`.
- `generatedAt` was nondeterministic by default.
- Prepare script writes output non-atomically.

Resolution:

- Manifest now includes input hash, source artifact hash, source description, command, commit, split lock, and warnings.
- `--generated-at` supported for reproducibility.
- `--limit-events` replaces `--limit-rows`.
- CLI stdout now exposes the key hashes and split lock.

Residual:

- CLI still buffers full CSV.
- Default data path is still `test_data.csv`.
- Prepare artifacts are still written non-atomically.

## Overall Review Conclusion

The hardening addressed the major protocol blockers needed for a first audit pass.

The remaining issues do not reverse the current empirical result. If anything, stronger baselines, positive lead-time requirements, and repeated splits are likely to make the current THL claim harder to support.

