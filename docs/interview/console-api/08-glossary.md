# 08 - Glossaire

Ce glossaire sert a traduire le vocabulaire du repo en langage entretien.

## API

Dans ce repo, l'API est le backend HTTP Fastify expose par `console-api`.

Concretement :

- elle recoit des requetes HTTP
- elle valide les entrees
- elle appelle les services metier
- elle renvoie du JSON

## Route

Une route est l'association entre :

- une methode HTTP (`GET`, `POST`)
- une URL (`/api/findings`, `/api/sweep/mission/start`)
- un handler

Dans ce projet, les routes sont definies dans `src/routes/*.ts`.

## Controller

Le controller est la couche HTTP.

Il fait surtout :

- validation d'entree
- mapping d'erreurs en codes HTTP
- appel du service

Il ne doit pas porter la vraie logique metier.

## Service

Le service porte la logique metier ou l'orchestration.

Exemples :

- `MissionService`
- `ReflexionService`
- `KnnPropagationService`

Quand on te demande "ou est l'intelligence du backend", la reponse est souvent :
"dans les services".

## Repository

Le repository encapsule les acces DB.

Il contient les requetes SQL et renvoie des rows ou execute des writes.

Dans ce projet :

- pas de logique HTTP
- peu de logique metier de haut niveau
- responsabilite centree sur la persistence

## Transformer

Un transformer convertit une row interne en DTO pour le front.

Exemple :

- row SQL -> `SatelliteView`
- row SQL -> `FindingView`

Le but est de decoupler le schema DB du contrat expose.

## DTO

DTO = Data Transfer Object.

C'est la forme de donnees qu'on renvoie a l'UI ou qu'on transporte entre
couches.

Exemple :

- `SatelliteView`
- `FindingView`

## Schema Zod

Un schema Zod decrit et valide la forme d'une entree.

Dans ce repo, il sert a :

- parser les body / query / params
- rejeter les requetes invalides
- normaliser certains parametres

## Strict

Quand une validation est "strict", une valeur invalide est rejetee.

Exemples :

- `noradId`
- `decision`
- `kind`
- `field`

On fait ca pour les valeurs semantiques.

## Clamped

Quand une valeur est "clamped", on la ramene dans une plage supportee.

Exemple :

- `limit`
- `intervalSec`
- `minPc`

On fait ca pour les knobs de tuning plutot que pour les identifiants.

## Composition root

Le composition root est l'endroit ou toute l'application est assemblee.

Ici, c'est `src/container.ts`.

On y choisit :

- quelles dependances ouvrir
- quels repositories creer
- quels services injecter

## Dependency injection

La dependency injection consiste a passer explicitement les dependances a un
objet au lieu qu'il les cree lui-meme.

Exemple :

- `new MissionService(satelliteRepo, auditRepo, nanoResearch, ...)`

Interet :

- dependances visibles
- code plus testable
- moins de couplage cache

## Side effect

Un side effect est un effet produit automatiquement a l'import ou a l'execution
d'un module.

Exemple de side effect qu'on veut eviter :

- demarrer le serveur juste en faisant un `import`

`server.ts` evite ca avec la separation `createApp()` / `startServer()`.

## Public state

Un `publicState()` expose un etat interne en version safe pour l'API.

Exemples :

- `MissionService.publicState()`
- `AutonomyService.publicState()`

Le but est de montrer l'etat utile sans exposer toute la structure interne.

## Finding

Un finding est un resultat analytique ou un signal produit par le systeme.

Il peut venir :

- d'un cycle Thalamus
- d'un enrichissement KNN
- d'une mission web
- d'une passe Reflexion

## Cortex

`cortex` est le nom du sous-systeme analytique qui a produit un finding.

Exemples :

- `data_auditor`
- `classification_auditor`
- d'autres venant de Thalamus

En entretien, tu peux le presenter comme "l'origine analytique du finding".

## KG

KG = Knowledge Graph.

Dans ce projet, c'est le graphe de liens entre findings et entites :

- satellites
- operateurs
- regimes
- etc.

## Research edge

Un `research_edge` relie un finding a une entite du graphe.

Exemples de relations :

- `about`
- `similar_to`
- `derived_from`

## Sweep

`Sweep` est ici le systeme qui emet des suggestions ou des resolutions autour
de cas a verifier / remplir / traiter.

Dans `console-api`, on consomme surtout :

- `sweepRepo.list(...)`
- `sweepRepo.review(...)`
- `resolutionService.resolve(...)`

## Mission

La mission est un job d'enrichissement par web research.

Elle prend des suggestions sweep, cree des taches, appelle nano deux fois par
tache, puis decide si elle ecrit ou non.

## KNN propagation

Remplissage automatique d'un champ manquant a partir des voisins vectoriels les
plus proches.

Ici :

- embeddings existants
- seuil de similarite
- consensus sur les voisins
- pas de LLM

## Reflexion

Passe analytique orbitale et classificatoire.

Elle compare :

- elements orbitaux
- belt d'inclinaison
- lineage militaire
- pays declare

Le tout sans LLM.

## Thalamus

Dependance externe du monorepo utilisee pour lancer des cycles de recherche.

Dans `console-api`, on ne reimplemente pas Thalamus ; on l'orchestre.

## Nano

Modele / transport LLM utilise pour de l'extraction ou du chat sur certaines
parties.

Dans `console-api`, nano est surtout utilise dans :

- `NanoResearchService`
- `ReplChatService`

## Web search

Capacite donnee au nano pour aller chercher une information sourcee sur le web.

Dans la mission, c'est critique, car la valeur doit etre documentee.

## Two-vote corroboration

Strategie de verification dans `MissionService` :

- premier vote avec un angle de recherche
- second vote avec un angle de recherche different
- on n'ecrit que si les deux convergent

Tu peux presenter ca comme un garde-fou anti-hallucination.

## Fail closed

Principe selon lequel, en cas de doute, on n'agit pas.

Ici :

- si la sortie LLM n'est pas exploitable -> on rejette
- si les votes divergent -> on n'ecrit pas
- si la valeur est hors range -> on n'ecrit pas

## Audit

Trace persistante d'une action d'enrichissement.

Dans ce repo, l'audit est ecrit dans `sweep_audit`.

## Feedback Redis

Petit signal pousse dans Redis pour alimenter une boucle de feedback.

Dans `EnrichmentFindingService`, les enrichissements sont aussi pushes vers
`sweep:feedback`.

## Embedding

Vecteur numerique representant un satellite dans un espace semantique.

Ici, il sert a trouver des voisins similaires via distance cosinus.

## Cosine distance / cosine similarity

- cosine distance faible = objets proches
- cosine similarity forte = objets proches

Le code passe souvent de l'un a l'autre avec :

- `maxDist = 1 - minSim`
- `cosSim = 1 - cos_distance`

## Consensus

Accord minimal suffisant pour ecrire une valeur.

Dans ce repo :

- numerique : mediane + tolerance relative
- texte : frequence majoritaire >= 66%
- mission web : accord entre deux votes nano

