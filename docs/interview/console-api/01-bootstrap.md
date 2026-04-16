# 01 - Bootstrap

Cette partie couvre les fichiers qui demarrent l'application et definissent le
cadre commun du traitement HTTP.

## `apps/console-api/src/server.ts`

### But

Construire l'application Fastify et la demarrer sans melanger boot HTTP et
logique metier.

### Ce que fait le fichier

- `createApp()`
  - cree Fastify
  - active CORS
  - appelle `buildContainer()`
  - enregistre toutes les routes
  - retourne un `close()` propre
- `startServer()`
  - lit le port
  - valide le port
  - appelle `createApp()`
  - fait `listen()`
- `main()`
  - lance le serveur hors contexte test

### Pourquoi c'est bien pense

- pas d'effet de bord a l'import
- testable : on peut construire l'app sans ouvrir de port
- shutdown propre : `close()` ferme Fastify puis les ressources du container

### A savoir dire

"J'ai separe la construction de l'app et la mise en ecoute. Ca rend les tests
plus simples et evite les side effects."

## `apps/console-api/src/container.ts`

### But

Centraliser toute la composition de dependances.

### Ce que fait le fichier

- lit `DATABASE_URL` et `REDIS_URL`
- ouvre le pool Postgres
- cree le client Redis
- construit les containers externes :
  - `buildThalamusContainer({ db })`
  - `buildSweepContainer({ db, redis })`
- instancie les repositories
- instancie les services
- retourne :
  - `services`
  - `close()`
  - `info` de boot

### Idee d'architecture

`container.ts` est le vrai "composition root". C'est la ou l'on decide quelle
implementation concrete est injectee partout.

### A savoir dire

"Les controllers ne construisent rien eux-memes. Tout passe par le container,
ce qui rend les dependances explicites."

## `apps/console-api/src/routes/index.ts`

### But

Assembler les domaines fonctionnels en branchant chaque route sur le bon
service.

### Ce que fait le fichier

- declare le type `AppServices`
- expose `registerAllRoutes(app, services)`
- enregistre toutes les familles de routes :
  - health
  - satellites
  - conjunctions
  - kg
  - findings
  - stats
  - sweep
  - reflexion
  - knn propagation
  - autonomy
  - cycles
  - repl

### A retenir

Les fichiers `routes/*.ts` ne vont pas chercher les dependances dans un global.
On les leur passe explicitement.

## `apps/console-api/src/utils/parse-request.ts`

### But

Factoriser la validation d'entree.

### Ce que fait le fichier

- prend `input`, `schema`, `reply`
- fait `schema.safeParse(input)`
- si echec :
  - renvoie un `400`
  - expose une liste `issues`
  - retourne `null`
- si succes :
  - retourne les donnees parsees

### A retenir

Le controller appelle toujours `parseOrReply(...)`. Donc la logique metier ne
recoit pas d'input HTTP brut.

## `apps/console-api/src/utils/async-handler.ts`

### But

Factoriser le `try/catch` des controllers.

### Ce que fait le fichier

- wrappe un handler async
- si tout va bien, retourne le resultat
- si une erreur est levee :
  - loggue l'erreur
  - choisit le bon status code
  - masque les 500 internes en production

### A retenir

Les controllers restent courts parce que la gestion d'erreur commune est deja
prise en charge ici.

## Flow complet du boot

1. `server.ts` appelle `createApp()`
2. `createApp()` appelle `buildContainer()`
3. `container.ts` construit DB, Redis, repos et services
4. `registerAllRoutes()` branche les endpoints
5. une requete arrive
6. route -> controller -> service -> repository

