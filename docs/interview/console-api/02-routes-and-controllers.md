# 02 - Routes et Controllers

Regle simple :

- `routes/*.ts` = declaration des endpoints
- `controllers/*.ts` = glue HTTP

Les controllers font 4 choses :

1. parser l'entree avec Zod
2. gerer les codes HTTP
3. appeler le service
4. renvoyer un JSON stable

## Health

### `routes/health.routes.ts`

- enregistre `GET /health`

### `controllers/health.controller.ts`

- renvoie `{ ok: true, ts }`
- utile pour le ping de vie de l'API

## Satellites

### `routes/satellites.routes.ts`

- enregistre `GET /api/satellites`
- query params :
  - `regime?`
  - `limit?`

### `controllers/satellites.controller.ts`

- parse avec `SatellitesQuerySchema`
- passe `{ limit, regime }` au `SatelliteViewService`

## Conjunctions

### `routes/conjunctions.routes.ts`

- enregistre `GET /api/conjunctions`
- query param :
  - `minPc?`

### `controllers/conjunctions.controller.ts`

- parse avec `ConjunctionsQuerySchema`
- normalise le `minPc`
- appelle `ConjunctionViewService.list({ minPc })`

## KG

### `routes/kg.routes.ts`

- enregistre :
  - `GET /api/kg/nodes`
  - `GET /api/kg/edges`

### `controllers/kg.controller.ts`

- `kgNodesController()` appelle `listNodes()`
- `kgEdgesController()` appelle `listEdges()`

Ce controller est volontairement minimal car il n'a pas d'entree a valider.

## Findings

### `routes/findings.routes.ts`

- enregistre :
  - `GET /api/findings`
  - `GET /api/findings/:id`
  - `POST /api/findings/:id/decision`

### `controllers/findings.controller.ts`

#### `findingsListController`

- parse `status?` et `cortex?`
- appelle `FindingViewService.list()`

#### `findingByIdController`

- parse le param `id`
- appelle `findById(id)`
- mappe les cas :
  - id invalide -> `400`
  - non trouve -> `404`

#### `findingDecisionController`

- parse `id` + body `decision`
- appelle `updateDecision(id, decision)`
- mappe les cas :
  - id invalide -> `400`
  - decision invalide -> `400`
  - finding absente -> `404`
- sinon renvoie `{ ok: true, finding }`

## Stats

### `routes/stats.routes.ts`

- enregistre `GET /api/stats`

### `controllers/stats.controller.ts`

- appelle `StatsService.snapshot()`

## Sweep - suggestions

### `routes/sweep.routes.ts`

Pour la partie suggestions :

- `GET /api/sweep/suggestions`
- `POST /api/sweep/suggestions/:id/review`

### `controllers/sweep-suggestions.controller.ts`

#### `sweepSuggestionsListController`

- appelle `SweepSuggestionsService.list()`

#### `sweepReviewController`

- parse `id`
- parse `accept` + `reason?`
- appelle `review(id, accept, reason)`
- si la suggestion n'existe pas -> `404`

Le type `SweepDeps` defini ici sert aussi au container pour injecter les
dependances venant de `@interview/sweep`.

## Sweep - mission

### `routes/sweep.routes.ts`

Pour la mission :

- `POST /api/sweep/mission/start`
- `POST /api/sweep/mission/stop`
- `GET /api/sweep/mission/status`

### `controllers/sweep-mission.controller.ts`

#### `missionStartController`

- parse `MissionStartBodySchema`
- appelle `MissionService.start(body)`

#### `missionStopController`

- appelle `MissionService.stop()`

#### `missionStatusController`

- appelle `MissionService.publicState()`

## Reflexion

### `routes/reflexion.routes.ts`

- enregistre `POST /api/sweep/reflexion-pass`

### `controllers/reflexion.controller.ts`

- parse `ReflexionPassBodySchema`
- appelle `ReflexionService.runPass(body)`
- si le service renvoie une erreur metier :
  - reprend le code `400` ou `404`

## KNN propagation

### `routes/knn-propagation.routes.ts`

- enregistre `POST /api/sweep/mission/knn-propagate`

### `controllers/knn-propagation.controller.ts`

- parse `KnnPropagateBodySchema`
- transmet les options au `KnnPropagationService`

## Autonomy

### `routes/autonomy.routes.ts`

- enregistre :
  - `POST /api/autonomy/start`
  - `POST /api/autonomy/stop`
  - `GET /api/autonomy/status`

### `controllers/autonomy.controller.ts`

- start :
  - parse `intervalSec`
  - appelle `AutonomyService.start(intervalSec)`
- stop :
  - appelle `stop()`
- status :
  - appelle `publicState()`

## Cycles

### `routes/cycles.routes.ts`

- enregistre :
  - `POST /api/cycles/run`
  - `GET /api/cycles`

### `controllers/cycles.controller.ts`

#### `cycleRunController`

- parse `kind` et `query?`
- si `query` absente, injecte une query par defaut
- appelle `CycleRunnerService.runUserCycle(kind, query)`
- si le service retourne `{ error }`, repond en `500`

#### `cycleHistoryController`

- expose l'historique memoise en memoire

## REPL

### `routes/repl.routes.ts`

- enregistre :
  - `POST /api/repl/chat`
  - `POST /api/repl/turn`

### `controllers/repl.controller.ts`

- `replChatController`
  - parse `input`
  - appelle `ReplChatService.handle(input)`
- `replTurnController`
  - parse `input` + `sessionId`
  - appelle `ReplTurnService.handle(input, sessionId)`

## Ce qu'il faut dire en entretien sur les controllers

- ils sont minces volontairement
- ils ne contiennent pas le SQL
- ils ne contiennent pas la vraie logique metier
- ils protegent les services des inputs HTTP invalides
- ils traduisent les erreurs metier en codes HTTP propres

