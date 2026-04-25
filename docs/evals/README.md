# Real Evaluation Sets

This directory defines the real-data evaluation corpus for Thalamus, Sweep,
and Sim. It intentionally does not contain synthetic fixtures or model-shaped
gold labels.

## Principle

The evals must answer engineering questions, not marketing questions:

- Does Thalamus preserve entity IDs, numeric values, and evidence provenance
  while improving recall over a single-pass baseline?
- Does Sweep find actionable data-quality drift against external truth sources,
  not just easy nulls?
- Does Sim produce calibrated outcome distributions from real conjunction
  sequences, not a single brittle verdict?
- Do repeated nondeterministic runs improve paired metrics versus the baseline
  with confidence intervals and sign-test evidence?

## Corpus

The manifest is [`real-eval-manifest.json`](real-eval-manifest.json).
The production-grade scoring protocol is
[`evaluation-protocol.md`](evaluation-protocol.md).

SSA sources:

- ESA Kelvins Collision Avoidance Challenge dataset, mirrored on Zenodo:
  real CDM time series from ESA operations, anonymized and released with labels.
  This is the gold dataset for conjunction-risk and maneuver/no-maneuver evals.
- CelesTrak SOCRATES Plus, SATCAT, and GP data: live public orbital catalog and
  conjunction snapshots for ingestion, citation, and drift checks.
- NOAA SWPC planetary K-index products: live and historical space-weather
  inputs for evidence-grounding and correlation checks.

HRM-style reasoning sources:

- ARC-AGI-2 official public training/evaluation repository.
- Sapient HRM public Sudoku Extreme 1k and Maze 30x30 Hard 1k datasets.

## Acquisition

List datasets:

```bash
npm run evals:list
```

Fetch small, practical smoke corpus:

```bash
npm run evals:fetch:smoke
```

Fetch the full corpus, including the 221 MB ESA collision-avoidance archive:

```bash
npm run evals:fetch:full
```

Downloaded files go under `data/evals/`, which is intentionally ignored by git.
Every fetch writes `data/evals/_manifest-lock.json` with URL, byte count,
SHA-256, MD5, ETag, and Last-Modified where available.

## Scoring Contract

The runner built on top of these assets should report paired agentic-vs-baseline
metrics by eval case:

- SSA CDM risk: event-level MAE/RMSE on final log-risk, high-risk AUPRC, and
  decision F1 at the operating threshold chosen before the run.
- SSA research: exact entity ID recall, numeric-fidelity error rate,
  citation/source coverage, hallucinated-ID rate, cost, and latency.
- Sweep: true drift recall/precision from official-source deltas, resolution
  payload validity, duplicate rate, and accepted-action impact.
- Sim: modal outcome accuracy, Brier score, entropy/calibration, cluster
  coverage, quorum failures, and cost/latency.
- HRM sets: exact accuracy/pass@2 for ARC, exact solution rate for Sudoku and
  Maze, plus token/cost/latency if an LLM adapter is used.

For nondeterminism, run each strategy over the same case seeds and report paired
deltas, bootstrap confidence intervals, win rate, and a one-sided sign-test
p-value. Do not compare unrelated random samples.

## Drafts

The `drafts/` directory contains specialized notes produced during protocol
design:

- `ssa-protocol.md` — SSA source/split/metric details.
- `hrm-statistics-protocol.md` — HRM scoring and statistical design.
- `cost-observability-protocol.md` — provider, cost and telemetry rules.

The canonical protocol is `evaluation-protocol.md`; drafts are supporting
material and should not be treated as separate scoring contracts.
