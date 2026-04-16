# 09 - Explications de code

Ici, l'objectif est de prendre les morceaux de code qui comptent vraiment et de
les expliquer comme si on faisait une revue ensemble.

## 1. `server.ts` : pourquoi `createApp()` et `startServer()` sont separes

### Ce que le code fait

`createApp()` construit l'application Fastify sans ouvrir de port.

`startServer()` prend cette application et l'attache a un port.

### Pourquoi c'est important

Cette separation evite deux problemes classiques :

1. importer un module qui demarre le serveur tout seul
2. rendre les tests difficiles car ils ouvrent des sockets inutilement

### Comment l'expliquer

"J'ai garde `createApp()` pur cote HTTP. Il construit l'app avec ses routes et
ses dependances. Le demarrage reseau est une etape a part."

## 2. `container.ts` : le vrai point de composition

### Lecture du code

Le fichier :

- ouvre Postgres
- ouvre Redis
- construit Thalamus et Sweep
- instancie les repositories
- instancie les services avec injection de dependances

### Pourquoi c'est important

Si on comprend ce fichier, on comprend le graphe de dependances du backend.

### Ce que tu dois voir

Par exemple :

- `MissionService` depend de `SatelliteRepository`, `SweepAuditRepository`,
  `NanoResearchService`, `EnrichmentFindingService`, `sweepRepo` et du logger
- `KnnPropagationService` depend du repo satellite, de l'audit et du service
  d'enrichment
- `ReplChatService` depend du container Thalamus

### Comment l'expliquer

"J'ai centralise toute la composition pour eviter que les services se
construisent eux-memes. Comme ca, chaque dependance est visible."

## 3. `parseOrReply()` : pourquoi valider avant d'appeler le service

### Ce que le code fait

`parseOrReply(input, schema, reply)` :

- lance `safeParse`
- si echec, envoie un `400`
- sinon retourne les donnees parsees

### Pourquoi c'est important

Le service ne recoit pas une request HTTP brute. Il recoit deja un objet :

- type
- valide
- parfois normalise

### Ce que ca change

Tu reduis le bruit dans les services. Ils n'ont pas besoin de reparser des
strings de query params venues du web.

## 4. `asyncHandler()` : pourquoi les controllers restent lisibles

### Ce que le code fait

Le wrapper capture les erreurs async et :

- loggue
- choisit le bon code HTTP
- masque les 500 en prod

### Pourquoi c'est important

Sans ce wrapper, chaque controller aurait son propre `try/catch`.

### Comment l'expliquer

"J'ai factorise la gestion d'erreur des controllers pour garder la couche HTTP
simple et uniforme."

## 5. `FindingViewService.list()` : un bon exemple de service de projection

### Ce que le code fait

Le service :

1. traduit un `status` front vers le statut DB
2. charge les findings
3. charge en plus les edges des findings recuperes
4. rattache les entites liees a chaque finding

### Pourquoi c'est important

Ce service n'est pas juste un `repo.list()`.

Il :

- protege la DB contre des statuts arbitraires
- enrichit le resultat pour le front
- maintient la separation entre vocabulaire front et vocabulaire DB

### Le vrai point de lecture

Le `KNOWN_DTO_STATUSES` est important : il montre que l'API n'accepte pas
n'importe quelle string pour descendre vers l'enum DB.

## 6. `MissionService.start()` : pourquoi il ne lance pas n'importe quoi

### Ce que le code fait

La methode :

1. verifie qu'une mission n'est pas deja en cours
2. lit les suggestions sweep non reviewees
3. parse `resolutionPayload`
4. ne garde que :
   - une action
   - de type `update_field`
   - sur un champ whiteliste
   - avec une valeur encore vide
5. charge les satellites concernes
6. cree les `MissionTask`
7. initialise l'etat et demarre le timer

### Pourquoi c'est important

Le service ne prend pas "toutes les suggestions". Il fabrique une file de
taches a partir d'un sous-ensemble strictement eligible.

### Ce que tu dois dire

"Le `start()` est en fait une phase de qualification de taches. La mission ne
cherche pas encore les valeurs a ce stade ; elle prepare une file propre."

## 7. `MissionService.tick()` : le garde-fou de concurrence

### Ce que le code fait

`tick()` verifie :

- `busy`
- `running`
- `cursor >= tasks.length`

Puis :

- marque `busy`
- prend la tache courante
- incremente le curseur
- lance `runTask(task)`

### Pourquoi c'est important

Le `busy` evite qu'un `setInterval` lance deux traitements concurrents si une
tache prend plus de temps que l'intervalle.

### Ce que tu dois comprendre

Le code gere une mini file sequentielle en memoire.

## 8. `MissionService.runTask()` : la logique metier critique

### Ce que le code fait

La tache passe par ces etapes :

1. status `researching`
2. premier vote nano
3. second vote nano avec un angle different
4. si un vote echoue -> `unobtainable`
5. si les votes divergent -> `unobtainable`
6. sinon :
   - `filled`
   - confiance calculee
   - `applyFill(...)`

### Pourquoi c'est important

C'est ici qu'on voit que le LLM est encadre. Le systeme ne lui donne pas la
clef de la DB.

### Le vrai message entretien

"Le modele propose une valeur, mais l'application decide si elle est
acceptable."

## 9. `NanoResearchService.singleVote()` : le filtre anti-sortie sale

### Ce que le code fait

Le service nano :

- formule un prompt tres contraint
- appelle nano avec web search
- parse un JSON
- rejette si :
  - pas de valeur
  - faible confiance
  - pas de source HTTPS
  - source non ouverte
  - unite incoherente
  - hedge language detecte

### Pourquoi c'est important

C'est le coeur des garde-fous LLM.

### Deux details qui comptent

1. `detectFabrication(...)`
   - rejette "about", "roughly", "unknown", etc.
2. `unitMismatch(...)`
   - empeche d'ecrire une valeur dans la mauvaise unite

## 10. `fieldSqlFor()` : petit fichier, gros enjeu

### Ce que le code fait

Ce helper transforme un nom de champ logique en colonne SQL autorisee.

Il n'accepte que :

- `variant`
- `lifetime`
- `power`
- `mass_kg`
- `launch_year`

### Pourquoi c'est important

Sans ce type de helper, interpoler une colonne SQL depuis un input serait tres
dangereux.

### Message entretien

"Le nom de colonne n'est jamais libre. Il passe par une whitelist compile-time
et runtime."

## 11. `KnnPropagationService.propagate()` : auto-fill sans LLM

### Ce que le code fait

Pour chaque cible :

1. charge des voisins proches dans l'espace embedding
2. impose un seuil de proximite
3. filtre les valeurs invalides
4. calcule un consensus
5. ecrit seulement si consensus

### Pourquoi c'est important

Ca montre qu'il y a deux styles d'enrichissement dans le codebase :

- enrichissement web avec LLM + verification
- enrichissement vectoriel deterministe par consensus

### Point subtil

Le consensus n'est pas le meme selon le type :

- numerique -> mediane + tolerance relative
- texte -> majorite de 66%

## 12. `ReflexionService.runPass()` : service analytique pur

### Ce que le code fait

Le service :

1. charge la cible
2. verifie les elements orbitaux
3. lance trois requetes analytiques en parallele
4. compare pays declare et belt dominant
5. decide s'il faut emettre un finding

### Pourquoi c'est important

Ce service montre que tout n'est pas "LLM-driven". Il y a une vraie logique
d'analyse explicite et justifiable.

### Ce que tu peux dire

"Reflexion, c'est une regle analytique. Les seuils et les comparaisons sont
dans le code et dans le SQL, pas dans un prompt."

## 13. `CycleRunnerService.runUserCycle()` : orchestration simple mais claire

### Ce que le code fait

Selon `kind`, il declenche :

- Thalamus
- Fish / Sweep
- ou les deux

Puis il construit un objet `CycleRun` avec :

- id
- kind
- dates
- nombre d'emissions
- cortices actives
- eventuelle erreur

### Pourquoi c'est important

Le service se comporte comme une facade d'orchestration. Il ne reimplemente pas
les moteurs, il les coordonne.

## 14. `AutonomyService.tick()` : scheduler applicatif

### Ce que le code fait

Le tick :

- choisit la prochaine action dans une rotation
- choisit une query quand il s'agit de Thalamus
- lance le cycle
- historise le resultat

### Pourquoi c'est important

Ca montre une logique d'automatisation applicative simple, en memoire, avec
suivi d'etat et historique.

### Point a connaitre

Le type d'action inclut `fish-swarm`, mais la rotation active actuelle ne
l'utilise pas.

## 15. `ReplChatService.handle()` : pipeline LLM en deux etages

### Ce que le code fait

1. classifier LLM -> `chat` ou `run_cycle`
2. si `chat`
   - reponse conversationnelle directe
3. si `run_cycle`
   - lancement d'un cycle Thalamus
   - lecture des findings du cycle
   - resume LLM du bundle

### Pourquoi c'est important

Ce n'est pas juste "on envoie l'input au modele". Il y a une petite chaine :

- routage
- eventuelle action systeme
- re-synthese

## 16. `repl.ts` : meme sujet, autre approche

### Ce que le code fait

Le REPL legacy :

- parse des commandes explicites
- route du texte libre via regex heuristiques
- utilise des fixtures deterministes

### Pourquoi c'est important

Il faut que tu saches distinguer :

- experience LLM : `ReplChatService`
- experience deterministe : `repl.ts` + `ReplTurnService`

## 17. Comment lire un morceau de code en entretien

Quand on t'ouvre un fichier, tu peux suivre ce plan :

1. "Quel est son role dans l'architecture ?"
2. "Quelles dependances il consomme ?"
3. "Quel input il prend ?"
4. "Quelles regles il applique ?"
5. "Qu'est-ce qu'il retourne ou ecrit ?"
6. "Quels sont ses garde-fous ?"

Si tu reponds a ces 6 questions proprement, tu ne passeras pas pour quelqu'un
qui subit le code.

