# 06 - Fichiers support

Cette partie couvre les fichiers qui rendent le reste propre : transformers,
types, prompts, utilitaires, fixtures et moteur REPL.

## Transformers

### `transformers/satellite-view.transformer.ts`

- transforme une row satellite en `SatelliteView`
- derive le regime si besoin
- convertit les champs issus de `telemetry_summary`

### `transformers/conjunction-view.transformer.ts`

- transforme une row conjonction en `ConjunctionView`
- derive :
  - `covarianceQuality`
  - `action`
  - `regime`

### `transformers/kg-view.transformer.ts`

- cree les DTO de noeuds KG :
  - regime
  - operator
  - satellite
  - finding
- cree aussi les edges
- expose `entityRef(type, id)` pour unifier les ids de graphe

### `transformers/finding-status.transformer.ts`

- mappe statuts DB -> statuts front
- mappe statuts front -> statuts DB
- parse un id de finding de type `f:123`

### `transformers/finding-view.transformer.ts`

- construit la vue liste / detail d'un finding
- adapte aussi l'evidence JSONB vers un format simple pour le front

### `transformers/index.ts`

Barrel file de re-export.

## Types

### `types/mission.types.ts`

Definit :

- `MissionTask`
- `MissionState`
- `NanoResult`

Ce sont les structures memoire de la mission.

### `types/autonomy.types.ts`

Definit :

- `AutonomyAction`
- `AutonomyTick`
- `AutonomyState`

### `types/cycle.types.ts`

Definit :

- `CycleKind`
- `CycleRun`

### `types/index.ts`

Re-export des types.

## Prompts

### `prompts/mission-research.prompt.ts`

Prompt systeme du flux mission.

Idee cle :

- JSON only
- source HTTPS obligatoire
- fail closed
- pas de prose
- pas d'approximation

### `prompts/repl-chat.prompt.ts`

Contient :

- prompt de chat console
- prompt de classifier d'intention
- prompt de summarizer

### `prompts/autonomy-queries.prompt.ts`

Liste des requetes de rotation pour le mode autonomie.

### `prompts/index.ts`

Barrel file de re-export.

## Utilitaires

### `utils/field-constraints.ts`

Fichier cle pour mission + KNN.

Il definit :

- les colonnes autorisees
- leur type (`numeric` ou `text`)
- les ranges acceptables
- les unites incompatibles

### `utils/sql-field.ts`

Whiteliste les noms de colonnes SQL interpolables.

C'est une protection importante contre un champ arbitraire injecte depuis une
request ou un payload.

### `utils/fabrication-detector.ts`

Detecte les tokens de hedge / approximation dans une sortie LLM.

Si le nano dit "roughly", "about", "unknown", etc., la reponse est rejetee.

### `utils/regime.ts`

Re-export depuis `@interview/shared` :

- `normaliseRegime`
- `regimeFromMeanMotion`
- `smaFromMeanMotion`

### `utils/classification.ts`

Re-export depuis `@interview/shared` de `classificationTier`.

## `apps/console-api/src/fixtures.ts`

### Role

Generer des fixtures deterministes pour la demo.

### Ce qu'il contient

- types DTO locaux
- PRNG seedee
- `buildFixtures(seed)`
  - satellites
  - conjunctions
  - noeuds KG
  - edges KG
  - findings

### A retenir

Le fichier est la source des donnees demo du REPL legacy.

## `apps/console-api/src/repl.ts`

### Role

Moteur REPL deterministe, d'abord pense pour la CLI puis expose via l'API.

### Ce qu'il fait

- parse des commandes explicites comme `/query`, `/telemetry`, `/logs`
- route aussi du texte libre via heuristiques regex
- dispatch vers des adapters bases sur les fixtures
- renvoie un `DispatchResult`

### Point cle

Le commentaire le dit clairement : la route heuristique est "No LLM".

### Pourquoi c'est utile

Tu peux dire que le projet contient deux experiences conversationnelles :

- `repl-chat.service.ts` : experience LLM
- `repl.ts` + `repl-turn.service.ts` : experience deterministe legacy

