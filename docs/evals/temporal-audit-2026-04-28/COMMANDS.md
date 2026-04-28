# Commands And Verification

## Unit And Type Checks

```bash
pnpm exec vitest run --project unit packages/temporal/tests/thl-dod-edge-cases.spec.ts apps/console-api/tests/unit/agent/ssa/temporal/kelvins-temporal-eval.test.ts
```

Result:

- 2 test files passed
- 38 tests passed

```bash
pnpm test:unit
```

Result:

- 232 test files passed
- 1489 tests passed
- Node emitted a `MaxListenersExceededWarning` during Vitest, but the suite completed successfully.

```bash
pnpm run typecheck
```

Result:

- Passed

```bash
git diff --check
```

Result:

- Passed

## CLI Smoke Checks

```bash
pnpm evals:temporal:ssa:blind -- --help
```

Result:

- Passed
- Help now exposes `--limit-events`
- `--limit-rows` is removed and rejected

```bash
pnpm evals:prepare:temporal:ssa -- --help
```

Result:

- Passed
- Help now exposes `--limit-events`

## Episode Miner V2 / Hard Baseline Rerun

These are the current reference commands. They use the big-memory script and emit progress/ETA telemetry to `stderr` while keeping JSON on `stdout`.

### high_risk default

```bash
pnpm evals:temporal:ssa:blind:big -- \
  --zip /tmp/kelvins_train_data.zip \
  --inner train_data.csv \
  --high-risk-threshold -6 \
  --generated-at 2026-04-28T00:00:00.000Z
```

Result:

- Verdict: `falsified`
- THL F1: `0.250896`
- Best baseline: `timestamp_shuffled_thl`
- Best baseline F1: `0.306954`
- Bootstrap 95% CI: `[-0.107115, -0.00543]`

### high_risk physics_only

```bash
pnpm evals:temporal:ssa:blind:big -- \
  --zip /tmp/kelvins_train_data.zip \
  --inner train_data.csv \
  --high-risk-threshold -6 \
  --experiment physics_only \
  --generated-at 2026-04-28T00:00:00.000Z
```

Result:

- Verdict: `falsified`
- THL F1: `0.177515`
- Best baseline: `prefixspan_no_decay`
- Best baseline F1: `0.192308`
- Bootstrap 95% CI: `[-0.02577, -0.006056]`

### risk_escalation default

```bash
pnpm evals:temporal:ssa:blind:big -- \
  --zip /tmp/kelvins_train_data.zip \
  --inner train_data.csv \
  --target-outcome risk_escalation \
  --risk-escalation-delta 1 \
  --high-risk-threshold -6 \
  --generated-at 2026-04-28T00:00:00.000Z
```

Result:

- Verdict: `falsified`
- THL F1: `0.113761`
- Best baseline: `timestamp_shuffled_thl`
- Best baseline F1: `0.133117`
- Bootstrap 95% CI: `[-0.040906, -0.002448]`

### risk_escalation physics_only

```bash
pnpm evals:temporal:ssa:blind:big -- \
  --zip /tmp/kelvins_train_data.zip \
  --inner train_data.csv \
  --target-outcome risk_escalation \
  --risk-escalation-delta 1 \
  --high-risk-threshold -6 \
  --experiment physics_only \
  --generated-at 2026-04-28T00:00:00.000Z
```

Result:

- Verdict: `falsified`
- THL F1: `0.105263`
- Best baseline: `prefixspan_no_decay`
- Best baseline F1: `0.118467`
- Bootstrap 95% CI: `[-0.044876, 0.023293]`

## Legacy Hardened Full Dataset Runs

The original `pnpm evals:temporal:ssa:blind` runs are superseded by the `:big` V2 rerun above because the baseline set and telemetry changed.

## Known Environment Note

Direct `pnpm exec tsx scripts/...` failed in sandbox because `tsx` attempted to create an IPC pipe under `/tmp`. Running through the package scripts with `tsx --tsconfig tsconfig.base.json` worked.
