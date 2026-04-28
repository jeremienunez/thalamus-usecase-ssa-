# Commands And Verification

## Unit And Type Checks

```bash
pnpm exec vitest run --project unit apps/console-api/tests/unit/agent/ssa/temporal/kelvins-temporal-eval.test.ts
```

Result:

- 1 test file passed
- 18 tests passed

```bash
pnpm --filter @interview/console-api typecheck
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

## Hardened Full Dataset Runs

### high_risk default

```bash
pnpm evals:temporal:ssa:blind -- \
  --zip /tmp/kelvins_train_data.zip \
  --inner train_data.csv \
  --high-risk-threshold -6 \
  --generated-at 2026-04-28T00:00:00.000Z
```

Result:

- Verdict: `falsified`
- THL F1: `0.244813`
- Best baseline: `frequency_single_event`
- Best baseline F1: `0.300926`
- Bootstrap 95% CI: `[-0.0786, -0.036012]`

### high_risk physics_only

```bash
pnpm evals:temporal:ssa:blind -- \
  --zip /tmp/kelvins_train_data.zip \
  --inner train_data.csv \
  --high-risk-threshold -6 \
  --experiment physics_only \
  --generated-at 2026-04-28T00:00:00.000Z
```

Result:

- Verdict: `falsified`
- THL F1: `0.095652`
- Best baseline: `frequency_single_event`
- Best baseline F1: `0.111369`
- Bootstrap 95% CI: `[-0.071111, 0.032953]`

### risk_escalation default

```bash
pnpm evals:temporal:ssa:blind -- \
  --zip /tmp/kelvins_train_data.zip \
  --inner train_data.csv \
  --target-outcome risk_escalation \
  --risk-escalation-delta 1 \
  --high-risk-threshold -6 \
  --generated-at 2026-04-28T00:00:00.000Z
```

Result:

- Verdict: `falsified`
- THL F1: `0.115942`
- Best baseline: `risk_increase_rule`
- Best baseline F1: `0.116883`
- Bootstrap 95% CI: `[-0.043913, 0.039292]`

### risk_escalation physics_only

```bash
pnpm evals:temporal:ssa:blind -- \
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
- THL F1: `0.09863`
- Best baseline: `frequency_single_event`
- Best baseline F1: `0.110747`
- Bootstrap 95% CI: `[-0.049768, 0.030845]`

## Known Environment Note

Direct `pnpm exec tsx scripts/...` failed in sandbox because `tsx` attempted to create an IPC pipe under `/tmp`. Running through the package scripts with `tsx --tsconfig tsconfig.base.json` worked.

