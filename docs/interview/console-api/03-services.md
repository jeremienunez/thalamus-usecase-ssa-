# 03 - Services

Ici se trouve l'essentiel de la logique fonctionnelle. C'est la couche la plus
importante a connaitre.

## `services/satellite-view.service.ts`

### Role

Service de lecture pour la liste des satellites.

### Logique

- appelle `SatelliteRepository.listWithOrbital(limit, regime)`
- transforme les rows avec `toSatelliteView`
- retourne `{ items, count }`

### LLM ?

Non.

## `services/conjunction-view.service.ts`

### Role

Service de lecture pour les conjonctions.

### Logique

- filtre par `minPc`
- lit les rows depuis `ConjunctionRepository`
- transforme via `toConjunctionView`

### LLM ?

Non.

## `services/kg-view.service.ts`

### Role

Construire une vue consommable du graphe de connaissance.

### Logique

- `listNodes()`
  - charge satellites, operateurs, regimes et findings
  - transforme chaque type en noeuds KG
- `listEdges()`
  - charge les edges recentes
  - transforme les rows en DTO

### LLM ?

Non.

## `services/finding-view.service.ts`

### Role

Exposer les findings dans le vocabulaire du front.

### Logique

- filtre les findings
- traduit le statut front -> statut DB
- enrichit la liste avec les entites liees via `research_edge`
- parse les IDs de type `f:123`
- met a jour une decision utilisateur

### Point important

Le service protege la DB contre des statuts arbitraires : seuls les statuts
connus sont traduits.

### LLM ?

Non.

## `services/stats.service.ts`

### Role

Construire le tableau de bord global.

### Logique

- recupere les agregats
- recupere les findings groupees par statut
- recupere les findings groupees par cortex
- remappe les statuts DB en statuts front

### LLM ?

Non.

## `services/sweep-suggestions.service.ts`

### Role

Exposer les suggestions de sweep et appliquer une review utilisateur.

### Logique

- `list()`
  - lit les suggestions non reviewees
  - projette le DTO attendu par le front
  - derive `hasPayload`
- `review()`
  - ecrit la review dans `sweepRepo`
  - si accepte, appelle `resolutionService.resolve(id)`

### LLM ?

Pas directement dans ce fichier.

## `services/mission.service.ts`

### Role

Executer une mission de remplissage de champs catalogue manquants a partir de
suggestions sweep resolvables.

### Logique de haut niveau

1. `start(opts)`
   - empeche le double start
   - recupere les suggestions non reviewees
   - parse leur `resolutionPayload`
   - ne garde que les actions `update_field`
   - ne garde que les champs whitelistes
   - ne garde que les valeurs actuellement nulles
   - charge les satellites payload concernes
   - construit une liste de `MissionTask`
   - demarre un timer avec `tick()`
2. `tick()`
   - evite la concurrence avec `busy`
   - prend la tache courante
   - appelle `runTask()`
   - met a jour les compteurs
3. `runTask(task)`
   - fait 2 appels independants a `NanoResearchService.singleVote()`
   - si un vote echoue -> `unobtainable`
   - si les votes ne convergent pas -> `unobtainable`
   - sinon :
     - marque `filled`
     - calcule une confiance
     - appelle `applyFill(...)`
4. `applyFill(...)`
   - verifie le type du champ
   - convertit la valeur
   - controle le range
   - ecrit la valeur sur le satellite
   - ecrit un audit
   - emet un finding d'enrichment

### Pourquoi c'est important

Ce service n'ecrit pas aveuglement dans la DB. Il fait :

- whitelist de colonnes
- controle de type
- controle de range
- double vote
- verification de convergence
- audit + finding apres ecriture

### LLM ?

Oui, mais borne :

- le LLM ne decide pas librement
- il doit renvoyer du JSON strict
- il doit citer une source HTTPS
- deux appels doivent converger avant ecriture

## `services/nano-research.service.ts`

### Role

Encapsuler un appel nano specialise pour l'extraction d'un champ catalogue a
partir du web.

### Logique

- construit un prompt precis avec satellite + field + angle de recherche
- appelle `callNanoWithMode(...)` avec web search
- rejette la reponse si :
  - pas de JSON
  - JSON invalide
  - pas de valeur
  - confiance < 0.6
  - pas de source HTTPS
  - source non coherente avec les URLs ouvertes
  - unite incoherente
  - langage hedge / fabrication detecte

### Fonctions utiles

- `votesAgree(a, b)`
  - tolerance relative pour les nombres
  - egalite normalisee pour le texte
- `summary(v)`
  - resume un echec pour le logging

### LLM ?

Oui. C'est le point d'entree principal du LLM dans le flux mission.

## `services/enrichment-finding.service.ts`

### Role

Transformer un enrichissement reussi en finding + edges + feedback Redis.

### Logique

- recupere ou cree un cycle d'enrichment
- insere un finding `data_auditor`
- cree un edge `about` vers le satellite cible
- si KNN :
  - cree aussi des edges `similar_to` vers les voisins
- pousse un feedback dans Redis sur `sweep:feedback`

### LLM ?

Non.

## `services/knn-propagation.service.ts`

### Role

Remplir des champs manquants de maniere deterministe a partir des voisins
vectoriels les plus proches.

### Logique

1. recupere les cibles avec valeur nulle
2. pour chaque cible :
   - charge `k` voisins avec embedding
   - impose un seuil de similarite
   - filtre les valeurs invalides / hors range
   - cherche un consensus :
     - mediane + tolerance 10% pour le numerique
     - majorite >= 66% pour le texte
3. si consensus :
   - ecrit la valeur
   - insere un audit
   - emet un finding d'enrichment

### A retenir

C'est du remplissage automatique, mais zero-LLM.

## `services/reflexion.service.ts`

### Role

Detecter des anomalies de classification a partir des elements orbitaux et de
la proximite a des familles connues.

### Logique

- charge la cible par NORAD
- verifie la presence des elements orbitaux utiles
- lance trois recherches SQL en parallele :
  - co-plan strict
  - belt d'inclinaison
  - peers a lineage militaire
- decide s'il faut emettre un finding :
  - si peers militaires trouves
  - ou si le belt dominant diverge du pays declare
- formate une reponse riche pour le front

### A retenir

Le fichier dit explicitement "No LLM" dans le reasoning du finding.

### LLM ?

Non. C'est une passe analytique SQL pure.

## `services/cycle-runner.service.ts`

### Role

Orchestrer le declenchement manuel de cycles externes Thalamus / Sweep.

### Logique

- `runThalamus(query)` appelle `thalamusService.runCycle(...)`
- `runFish()` appelle `nanoSweepService.sweep(20, "nullScan")`
- `runBriefing(limit)` appelle `nanoSweepService.sweep(limit, "briefing")`
- `runUserCycle(kind, query)`
  - lance une ou plusieurs branches selon `kind`
  - construit un objet `CycleRun`
  - garde un historique memoire

### LLM ?

Pas dans ce fichier. Il orchestre des services externes qui peuvent en utiliser.

## `services/autonomy.service.ts`

### Role

Faire tourner automatiquement des cycles selon une rotation planifiee.

### Logique

- maintient un state en memoire
- `start(intervalSec)`
  - clamp defensif
  - demarre un `setInterval`
  - lance un premier `tick()`
- `tick()`
  - evite la re-entrance avec `busy`
  - alterne entre actions de `ROTATION`
  - pour `thalamus`, choisit une query dans `THALAMUS_QUERIES`
  - pour `sweep-nullscan`, lance `runFish()`
  - historise le tick

### Point subtil

Le type `AutonomyAction` prevoit aussi `fish-swarm`, mais la rotation active ne
contient que `thalamus` et `sweep-nullscan`.

### LLM ?

Pas directement ici.

## `services/repl-chat.service.ts`

### Role

Fournir un chat console "assistant operateur".

### Logique

1. passe l'input dans un classifier LLM
2. deux cas :
   - `chat`
     - appelle un transport LLM conversationnel
   - `run_cycle`
     - lance un cycle Thalamus
     - charge les findings du cycle
     - passe le bundle dans un summarizer LLM

### LLM ?

Oui, a deux niveaux :

- classification d'intention
- generation / resume de reponse

## `services/repl-turn.service.ts`

### Role

Exposer l'ancien moteur REPL deterministe via l'API.

### Logique

- wrappe `runTurn(...)` depuis `src/repl.ts`
- utilise un contexte vide par defaut
- garde le controller tres simple

### LLM ?

Non.

