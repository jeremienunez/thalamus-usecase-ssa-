# 04 - Repositories

Les repositories encapsulent la lecture / ecriture SQL. Leur responsabilite est
deliberement plus basse que celle des services : ils ne portent pas les regles
fonctionnelles de haut niveau.

## `repositories/satellite.repository.ts`

### Role

Acces aux satellites pour les vues et les enrichissements.

### Methodes importantes

- `listWithOrbital(limit, regime?)`
  - lit les satellites avec infos orbitales et operateur
  - pousse le filtre `regime` en SQL
- `findPayloadNamesByIds(ids)`
  - ne retourne que des payloads
- `updateField(satelliteId, field, value)`
  - ecrit un seul champ whitelist via `fieldSqlFor`
- `listNullCandidatesForField(field, limit)`
  - cible les payloads avec embedding et champ null
- `knnNeighboursForField(targetId, field, k)`
  - utilise la distance cosinus sur `embedding`

### Point entretien

Le fichier protege contre l'injection de nom de colonne via `fieldSqlFor`.

## `repositories/conjunction.repository.ts`

### Role

Lire les evenements de conjonction.

### Logique

- joint les deux satellites
- filtre par `probability_of_collision >= minPc`
- trie par Pc decroissante
- limite a 500

## `repositories/kg.repository.ts`

### Role

Lire les sources de noeuds et les edges du graphe.

### Logique

- `loadNodeSources()`
  - charge satellites, operateurs, regimes, findings
- `listRecentEdges(limit)`
  - charge les edges les plus recentes

## `repositories/finding.repository.ts`

### Role

CRUD minimal sur `research_finding`.

### Methodes importantes

- `list({ status, cortex })`
- `findById(id)`
- `updateStatus(id, dbStatus)`
- `insert(input)`

### Point important

Le repository travaille avec les enums DB, pas avec le vocabulaire front.

## `repositories/research-edge.repository.ts`

### Role

Manipuler les liens entre findings et entites.

### Methodes importantes

- `findByFindingIds(ids)`
- `findByFindingId(id, limit)`
- `insert(input)`

### Pourquoi c'est utile

Les findings ne sont pas juste du texte : elles sont reliees au graphe.

## `repositories/enrichment-cycle.repository.ts`

### Role

Gerer le cycle unique "catalog-enrichment".

### Logique

- memoise un `cachedId`
- sinon cherche un cycle existant `trigger_source = 'catalog-enrichment'`
- sinon cree ce cycle

### Point entretien

Le service d'enrichment ne recree pas un cycle a chaque write.

## `repositories/sweep-audit.repository.ts`

### Role

Persister un audit d'enrichment reussi dans `sweep_audit`.

### Logique

- insere une ligne `accepted=true`
- `resolution_status='success'`
- stocke aussi `resolution_payload`

## `repositories/reflexion.repository.ts`

### Role

Porter les requetes SQL d'analyse orbitale.

### Methodes importantes

- `findTarget(norad)`
- `findStrictCoplane(...)`
- `findInclinationBelt(...)`
- `findMilLineagePeers(...)`

### A retenir

Toute la passe Reflexion repose sur ces requetes analytiques.

## `repositories/stats.repository.ts`

### Role

Fournir les compteurs globaux pour le dashboard.

### Methodes importantes

- `aggregates()`
- `findingsByStatus()`
- `findingsByCortex()`

