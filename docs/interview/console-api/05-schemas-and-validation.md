# 05 - Schemas et validation

La couche schema explique une partie importante de la philosophie du code :

- les identifiants et enums semantiques sont stricts
- les parametres de tuning numeriques sont souvent clamps

## `schemas/clamp.ts`

### Role

Definir deux helpers de normalisation :

- `clampedInt(min, max, dflt)`
- `clampedNumber(min, max, dflt)`

### Idee

On rejette les non-nombres et les `NaN`, mais on clamp les valeurs numeriques
hors plage au lieu d'exploser inutilement.

## `schemas/satellites.schema.ts`

- `regime` est un enum strict
- `limit` est un entier clamped entre 1 et 5000

## `schemas/conjunctions.schema.ts`

- `minPc` est un float clamped entre 0 et 1

## `schemas/findings.schema.ts`

- `status?`
- `cortex?`
- `id` doit matcher `^(f:)?\\d+$`
- `decision` est un `FindingStatusSchema`

Ici on veut etre strict parce qu'on parle d'identite et d'etat metier.

## `schemas/autonomy.schema.ts`

- `intervalSec` est clamped entre 15 et 600, defaut 45

## `schemas/cycles.schema.ts`

- `kind` doit etre `thalamus | fish | both`
- `query?` est une string optionnelle bornee

## `schemas/sweep.schema.ts`

- review :
  - `id` strict
  - `accept` booleen
  - `reason?`
- mission start :
  - `maxSatsPerSuggestion` clamped entre 1 et 20

## `schemas/reflexion.schema.ts`

- `noradId` = entier positif strict
- `dIncMax`, `dRaanMax`, `dMmMax` = floats clamps

Pourquoi ? `noradId` est un identifiant semantique. Les deltas sont des knobs.

## `schemas/knn-propagation.schema.ts`

- `field` = enum strict de champs whitelistes
- `k`, `minSim`, `limit` = clamps
- `dryRun` = booleen coerce

## `schemas/repl.schema.ts`

- `input` doit etre une string non vide
- `sessionId` est borne avec un defaut `anon`

## `schemas/index.ts`

Simple barrel file qui re-exporte tous les schemas.

## Ce qu'il faut dire en entretien

"Je n'ai pas traite tous les mauvais inputs de la meme maniere. Les erreurs de
sens metier sont rejetees strictement, alors que les parametres de tuning sont
normalises dans des plages supportees."

