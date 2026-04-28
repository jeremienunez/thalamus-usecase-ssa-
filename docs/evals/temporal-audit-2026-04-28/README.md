# Temporal Hypothesis Layer Audit Pack

Date: 2026-04-28  
Repo commit observed in run metadata: `e618afcc8d97a9154d30bbe631d63ae0bcdb0ace`  
Dataset: ESA Kelvins Collision Avoidance Challenge, `train_data.csv` from `/tmp/kelvins_train_data.zip`  
Source artifact hash used by hardened runner: `ba47ce80580d5d6ff523ddc1d724901dbdfb3a5afdc5e755f0ca2bcefe6e4eb6`

## Purpose

This folder packages the observations needed to audit the current Temporal Hypothesis Layer experiment.

The product hypothesis under review:

> Temporal episode patterns learned by THL should improve blind prediction of SSA outcomes over simple non-temporal baselines.

The current empirical conclusion:

> The hypothesis is falsified on the Kelvins dataset under the hardened protocol. THL finds patterns, but they do not beat simple baselines.

## Files

- `OBSERVATIONS.md`: human-readable summary of all important observations.
- `RUN_RESULTS.json`: structured metrics from the hardened full dataset runs.
- `SUBAGENT_FINDINGS.md`: review findings from the 4 xhigh agents and what was fixed.
- `AUDIT_QUESTIONS.md`: questions for GPT-5.5 Pro audit.
- `COMMANDS.md`: commands run and verification status.

## Code Entry Points

- `apps/console-api/src/agent/ssa/temporal/kelvins-temporal-eval.ts`
- `apps/console-api/tests/unit/agent/ssa/temporal/kelvins-temporal-eval.test.ts`
- `scripts/run-ssa-kelvins-blind-temporal-experiment.ts`
- `scripts/prepare-ssa-kelvins-temporal-dataset.ts`

## Protocol Status

Implemented hardening:

- Event-id grouped and outcome-stratified split.
- Split lock with per-split hashes.
- Source artifact hash and command metadata in manifest.
- `--limit-rows` removed; replaced by `--limit-events`.
- Non-blind runner marked smoke-only and blocks `risk_escalation`.
- Blind runner rejects splits without positive and negative examples.
- Blind runner checks precursor events for outcome leakage.
- Prediction matching is bounded by `pattern_window_ms`.
- Popper verdict includes deterministic bootstrap 95% CI for F1 lift over best baseline.

Remaining caveats:

- `minLeadTimeDays` default is still `0`, so blind means final CDM excluded, not a positive forecast horizon.
- Baselines remain simple; no logistic regression, tree, calibrated last-observation baseline, or multi-seed split suite yet.
- High-risk labels are threshold-defined, and related risk threshold features can dominate simple baselines.
- CLI still buffers full CSV content in memory.
- Prepare script writes artifacts non-atomically.
- Results are not auto-persisted as raw JSON files by the CLI yet.

