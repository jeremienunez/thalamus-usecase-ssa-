# Hardening Roadmap

## Runtime correctness

- AbortSignal propagation across DAG executor, cortices, providers, and web search
- explicit LLM unavailable errors
- DAG validation before execution
- cortex result status taxonomy

## Knowledge graph consistency

- transactional write boundary
- partial persistence reporting
- embedding dimension validation
- safe BigInt entity IDs

## Type safety

- strictNullChecks migration
- noUncheckedIndexedAccess migration
- Zod schemas for all LLM outputs

## Architecture gates

- circular dependencies as errors in core packages
- orphan modules as errors in package src
- single quality gate command

## Extraction cleanup

- rename interview-specific package metadata if desired
- isolate legacy SSA seams
- document public/demo boundaries
