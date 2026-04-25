# Specs

LaTeX specifications, one file per module. Specs are **the contract**: written before (or extracted from) code, tests trace back to acceptance criteria, CI refuses PRs without a matching spec.

## Why LaTeX

- Versioned with the code, reviewable in PRs
- Compiles to PDF for stakeholders who do not read TypeScript
- Structure enforced by the preamble + template (consistent across authors)
- Survives formatting changes, tool changes, and copy-paste into external docs

## Workflow

```
docs/specs/<area>/<feature>.tex    ← spec (Context / Goals / Invariants / Scenarios / AC)
packages/<pkg>/tests/<feature>.spec.ts   ← unit evidence
apps/console-api/tests/integration/*.spec.ts ← integration evidence
apps/console-api/tests/e2e/*.spec.ts    ← e2e evidence
packages/<pkg>/src/<feature>.ts    ← implementation
```

### Rules

1. Every public module has a spec under `docs/specs/`.
2. Every spec declares **Acceptance Criteria** (AC-1, AC-2, ...) and a **Traceability** table mapping each AC to `unit`, `integration`, and `e2e` evidence rows.
3. Every trace row names the concrete test file and test name that covers that AC at that layer.
4. CI fails if an `APPROVED` or `IMPLEMENTED` spec is missing any layer, references a missing file, or references a test name that is not present.

## Structure

- `preamble.tex` --- shared style, custom environments (`invariant`, `scenario`, `ac`).
- `template.tex` --- reference template for new specs. Copy and fill.
- `shared/`, `db-schema/`, `thalamus/`, `sweep/` --- one subfolder per package.

## Writing a new spec

```bash
cp template.tex thalamus/my-feature.tex
# edit: specID, specTitle, fill sections
make thalamus/my-feature.pdf
```

## Building

```bash
make         # build all PDFs
make clean   # remove aux files
make list    # list spec files
make watch   # live rebuild (latexmk -pvc)
```

Requires `latexmk` and `pdflatex` (TeX Live full or `texlive-latex-recommended + texlive-latex-extra`).

## Status lifecycle

Each spec declares `\specStatus{...}`:

- `DRAFT` --- being written, not yet reviewable.
- `REVIEW` --- open for comment.
- `APPROVED` --- frozen contract; `pnpm spec:check`, `pnpm test:unit`, `pnpm test:integration`, and `pnpm test:e2e` must pass for every AC.
- `IMPLEMENTED` --- tri-layer evidence is green, code shipped.

Architecture overview docs may use `OVERVIEW` while they are reader-facing prose only. Convert them to AC-bearing specs before moving them to `REVIEW` or `APPROVED`.

## CI hooks

- `scripts/spec-check.ts` --- asserts each enforced AC has `unit`, `integration`, and `e2e` trace rows and that every referenced test exists.
- The `spec-validation` CI job runs `pnpm spec:check`, `pnpm test:unit`, `pnpm test:integration`, and `pnpm test:e2e` in order. This is the validation path for moving specs to `APPROVED` / `IMPLEMENTED`.
- `make all` runs in the `spec-build` job; PDFs published as artifacts.
