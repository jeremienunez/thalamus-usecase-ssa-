# CLAUDE.md

This file defines the non-negotiable architecture rules for this repo.
Treat them as laws, not preferences.

## 1. Core invariant

The refactor is only complete when the kernel-facing boundaries for
`thalamus`, `sweep`, and `sim` are consumed through the `console-api` HTTP
routes.

If a capability crosses the app/domain boundary, the kernel must consume the
route contract, not a private in-process service/repository shortcut.

There must be one public contract, not two.

## 2. What this means in practice

- `apps/console-api` owns the HTTP surface.
- `packages/*` must not bypass that surface to call private app internals.
- If the kernel needs a capability and no route exists yet, the work is to
  add the route, controller, schema, service wiring, and contract tests.
- Do not "temporarily" solve a missing route with a direct import or helper.
- Do not add a shim that recreates a private path in parallel to HTTP.

Existing repo structure also matters:

- shared/local shape definitions belong in `src/types/*`
- DTO definitions and edge-shape mapping belong in `src/transformers/*`,
  including `*.dto.ts` files when the repo already uses that pattern
- transformers map data; they do not justify a private cross-boundary call
- a DTO file is not a second contract path; the HTTP route remains the
  contract

## 3. Absolute rules

### 3.1 No private bypass

Forbidden:

- `packages/*` importing from `apps/console-api/src/*`
- kernel code calling app services or repositories directly
- presentation/app callers importing `@interview/sweep` or
  `@interview/thalamus` internals when the boundary is supposed to be HTTP
- adding "just one small helper" instead of exposing a route

Required:

- route -> controller -> service -> repository on the app side
- HTTP client -> route contract on the kernel side

### 3.2 No second contract

If a route exists, it is the contract.

Do not keep a direct service/repository path alive "for convenience",
"performance", "temporary migration", or "to avoid boilerplate".

If both HTTP and direct in-process consumption exist for the same boundary,
the refactor is not finished.

### 3.3 Missing route means incomplete architecture

If a use case cannot be reached through HTTP:

1. do not bypass it
2. define the contract
3. add/update the route
4. wire controller/service/repository
5. consume that route from the kernel

## 4. Allowed local concerns

These may stay local to the kernel when they are not app-boundary concerns:

- prompt rendering
- LLM transport calls
- `buildTurnResponseSchema`
- pack-supplied `ActionSchemaProvider`
- pure math / clustering / deterministic transforms
- local orchestration that does not cross into app-owned persistence or queue
  boundaries

This exception is narrow.

Persistence, promotion, queue enqueue, status reads, target loading, auth,
SSA translation, and other app/domain boundary concerns must go through HTTP.

## 5. Queue rule

`/api/sim/queue/*` is kernel-only infrastructure.

- kernel clients may call it with kernel auth
- humans/admin users do not enqueue raw jobs directly
- human flows go through higher-level routes like `/telemetry/start`,
  `/pc/start`, `/standalone/start`

## 6. Completion criteria

A refactor is done only when all of the following are true:

- the kernel consumes the relevant `console-api` routes
- there is no private in-process shortcut for the same boundary
- no `packages/* -> apps/*` dependency was introduced
- schemas/contracts are explicit and tested
- HTTP smoke tests cover the path actually used by callers

## 7. Review checklist

Before approving or implementing a change, verify:

- Is there any direct import from `apps/console-api/src/*` inside `packages/*`?
  If yes, stop.
- Is a new helper/shim being proposed instead of a route? If yes, stop.
- Is the design creating a "temporary" second path next to HTTP? If yes, stop.
- Does the caller consume the public route contract or a private service?
- If a route is missing, was the route added instead of bypassed?

## 8. Guidance for LLM agents

LLM agents tend to choose the shortest local path.
In this repo, that instinct is wrong.

When in doubt:

- prefer adding or consuming a route
- prefer one explicit contract
- prefer deleting shortcuts over preserving them

Remember:

- no tweak
- no bypass
- no second contract
