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
packages/<pkg>/tests/<feature>.spec.ts   ← tests, each tagged with @spec <spec-id>
packages/<pkg>/src/<feature>.ts    ← implementation
```

### Rules

1. Every public module has a spec under `docs/specs/`.
2. Every spec declares **Acceptance Criteria** (AC-1, AC-2, ...) and a **Traceability** table mapping each AC to a test.
3. Every test file starts with `/** @spec docs/specs/<path>.tex */` and each `describe` block references the AC id it covers.
4. CI fails if a test has no AC reference, or if an AC has no test.

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
- `APPROVED` --- frozen contract; tests and code must comply.
- `IMPLEMENTED` --- tests green, code shipped.

## CI hooks (planned)

- `scripts/spec-check.ts` --- walks every test file, extracts `@spec` tags, asserts each AC has a matching test and vice versa.
- `make all` runs in the `spec-build` job; PDFs published as artifacts.
