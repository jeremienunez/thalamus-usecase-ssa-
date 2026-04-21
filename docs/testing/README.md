# Testability Strategy

## Goal

A test is executable evidence of one expected behavior at one explicit seam.

If a test fails, only two explanations are acceptable:

1. the product behavior is wrong and the test found a real bug,
2. the test asserted the wrong expected behavior and must be rewritten.

Anything else is noise and does not belong in CI.

## What a test must prove

Every test must make these four things obvious:

- the seam under test: function, service, repository, route, workflow, or guardrail,
- the starting state or fixture,
- the trigger,
- the observable outcome.

Observable outcomes are limited to behavior visible at the seam:

- returned values and DTOs,
- persisted state or repository results,
- emitted calls at owned port boundaries,
- HTTP status, headers, and body,
- repository, file-system, architecture, or spec invariants.

## What does not belong in a test

- private helper details inside the same module,
- incidental call ordering unless ordering is the contract,
- vague assertions and vague names such as `works`, `basic`, `happy path`, `smoke`, or `should work`,
- placeholder suites (`it.todo`, `test.todo`),
- disabled or focused suites/tests (`skip`, `only`, `failing`, `xit`, `xtest`, `xdescribe`),
- hidden live infrastructure inside unit or contract tests.

No grandfathering applies. If an existing test violates this strategy, CI is expected to fail until the test is replaced with an executable behavior test or removed.

## Structural rules

These are hard CI rules, not guidelines:

- every test file must contain at least one executable test,
- every test file must contain `describe(...)` naming the seam under test,
- every executable test must live under `describe(...)`,
- every executable test must assert directly with `expect(...)` in its own body,
- test titles must be explicit, non-empty, and unique within the file,
- nested tests and nested suites inside a test body are forbidden.

## Layer contract

### Unit and contract tests

Use deterministic inputs, fakes, mocks, in-memory harnesses, or static repo fixtures. These tests must not depend on live Postgres, live Redis, or a booted `CONSOLE_API_URL`.

`app.inject()` against an in-memory Fastify instance is acceptable here because it stays inside the process. `ioredis-mock` is acceptable here because it is not live infrastructure.

### Integration tests

May use real infrastructure such as Postgres or Redis, but must stay below the HTTP boundary. Their job is to prove wiring and persistence contracts, not transport behavior.

### E2E tests

Prove user-visible transport and stack behavior through the real application surface.

## Naming

Preferred forms:

- `given ..., when ..., then ...`
- verb-first behavior statements such as `returns 400 on invalid body`

Avoid names that merely restate implementation or intent without a behavior. The title should tell a reviewer what must stay true after a refactor.

## CI gates

The repository enforces this strategy with:

- `pnpm test:policy` for structural test rules,
- `pnpm spec:check` for spec-to-test traceability,
- `pnpm test` for executable behavior.

If `pnpm test:policy` fails, the fix is not to mute CI. The fix is to rewrite the test so that it proves expected behavior at the correct seam.

## Running Tests

Use the workspace-level scripts so each layer runs in isolation:

```bash
# full workspace run
pnpm test

# one layer only
pnpm test:unit
pnpm test:integration
pnpm test:e2e
```

`pnpm test:unit` runs only deterministic unit/contract tests. It must not boot
the Fastify app, read `CONSOLE_API_URL`, or depend on live Postgres / Redis.

`pnpm test:integration` runs only repository wiring against a live Postgres.
If the integration project matches zero tests, the command fails loudly.

`pnpm test:e2e` runs only HTTP-stack tests. It requires both Postgres and
Redis, and it boots the real `console-api` app through Vitest global setup.

## Local Infra

Start the local services with Docker Compose:

```bash
docker compose up -d postgres
docker compose up -d redis
```

Local defaults:

- `DATABASE_URL=postgres://thalamus:thalamus@localhost:5433/thalamus`
- `REDIS_URL=redis://localhost:6380`

Before `integration` or `e2e`, apply the production migration stack to the
test database:

```bash
pnpm tsx scripts/test-db-migrate.ts
```

That wrapper applies the extension bootstrap from `infra/postgres/init.sql`
and then runs the Drizzle migration journal plus the raw SQL companion files.
