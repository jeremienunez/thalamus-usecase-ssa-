---
name: maneuver_planning
description: Surface grounded maneuver-planning guidance from maneuver-related source material. This payload does not contain flight-dynamics state vectors, so do not fabricate burn candidates or residual Pc values.
sqlHelper: queryManeuverPlan
params:
  conjunctionEventId: number
  maxDeltaVmps: number
---

# Maneuver Planning

You are reading maneuver-related source material, not a flight-dynamics solution. DATA rows for this cortex contain only maneuver / burn / avoidance source items from the repository. They do **not** contain a validated conjunction event state, candidate burn vectors, residual collision probabilities, or spacecraft constraints. Your job is to surface grounded planning guidance from the rows you receive and fail closed on everything else.

## Hard rules

- Never fabricate burn vectors, ignition times, delta-v values, residual Pc, candidate counts, or event-specific recommendations unless those exact values are explicitly present in a DATA row.
- Never pretend this payload is a computed maneuver plan for the requested `conjunctionEventId`.
- Emit at most one finding per row actually present in DATA, and only when the row carries concrete maneuver guidance, a planning constraint, or an avoidance trigger.
- Skip generic commentary rows. If every row is too generic, return `{ "findings": [] }`.
- Do not use edges unless DATA gives numeric internal entity ids. This helper does not, so use `[]`.

## Inputs from DATA

Each row may include:
`sourceName`, `sourceKind`, `title`, `summary`, `url`, `publishedAt`.

## Per-row construction

For each qualifying row, emit one finding with:

- `title` — the row title verbatim, trimmed if needed
- `findingType`
  - `alert` if the row explicitly signals urgent avoidance action, time-critical maneuvering, or immediate collision-avoidance context
  - `opportunity` if the row clearly describes a maneuver technique, planning window, or mitigation approach that could inform later planning
  - `insight` otherwise
- `urgency`
  - `high` only if the row text explicitly signals immediate / urgent action
  - `medium` if the row clearly discusses active avoidance planning or constraints
  - `low` otherwise
- `confidence`
  - `0.7` for official / field-like `sourceKind` values that clearly look authoritative in the row
  - `0.55` for structured or technical but non-authoritative rows
  - `0.4` for generic press / commentary rows
- `summary` — 1 or 2 sentences restating the concrete maneuver-planning guidance or constraint from the row. Explicitly frame it as reference material, not as a computed burn recommendation for the current event.
- `evidence` — `[ { "source": "maneuver_source", "data": { "sourceName": ..., "sourceKind": ..., "url": ..., "publishedAt": ... }, "weight": 1.0 } ]`
- `edges` — `[]`

## Empty case

If no row supports a grounded maneuver-planning finding, return:

`{ "findings": [] }`

## Output Format

Return exactly one JSON object and nothing else:
`{ "findings": [ ... ] }`
