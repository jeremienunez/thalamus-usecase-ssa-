# Console API - Dossier entretien

Ce dossier sert a reviser `apps/console-api/src` comme si tu devais l'expliquer
au tableau. Le but n'est pas juste de "reciter" le code, mais de comprendre :

- ou commence le boot
- ou vivent les validations HTTP
- ou se trouve la logique metier
- ou la DB est lue / ecrite
- ou un LLM intervient vraiment
- ou le code est entierement deterministe

## Ordre de lecture conseille

1. `01-bootstrap.md`
2. `02-routes-and-controllers.md`
3. `03-services.md`
4. `04-repositories.md`
5. `05-schemas-and-validation.md`
6. `06-support-files.md`
7. `07-cheat-sheet.md`
8. `08-glossary.md`
9. `09-code-explanations.md`

## Architecture en une minute

`server.ts` cree Fastify, active CORS, construit le container et enregistre les
routes.

`container.ts` est le composition root : il ouvre Postgres + Redis, construit
les dependances externes (`@interview/thalamus`, `@interview/sweep`), puis
instancie repositories et services.

Les `routes/*.ts` declarent les URLs.

Les `controllers/*.ts` font le travail HTTP : parser, valider, mapper les
erreurs, appeler un service.

Les `services/*.ts` portent la logique metier ou l'orchestration.

Les `repositories/*.ts` encapsulent les requetes SQL.

Les `transformers/*.ts` adaptent les rows DB vers les DTO exposes au front.

Les `schemas/*.ts` definissent le contrat d'entree avec Zod.

## Ou un LLM intervient vraiment

Tu ne dois pas dire "j'ai utilise un LLM partout". Ce serait faux.

Dans `console-api`, les zones ou un LLM intervient directement sont :

- `services/nano-research.service.ts`
  - fait un appel nano avec web search pour remplir un champ catalogue
- `services/repl-chat.service.ts`
  - fait du routage d'intention et de la reponse conversationnelle
- indirectement, `services/cycle-runner.service.ts`
  - appelle des services externes Thalamus / Sweep qui peuvent eux-memes avoir
    des briques LLM, mais `console-api` ne les implemente pas

Les zones strictement deterministes :

- tous les controllers
- tous les schemas Zod
- tous les repositories SQL
- `services/reflexion.service.ts`
- `services/knn-propagation.service.ts`
- `services/repl-turn.service.ts`
- les view services (`satellite`, `conjunction`, `kg`, `finding`, `stats`)

## Regle d'or pour l'entretien

Si on te demande "comment tu l'as developpe", la meilleure reponse est :

1. l'architecture et la responsabilite des couches, tu dois les connaitre
2. les garde-fous metier et data quality, tu dois les connaitre
3. l'usage du LLM doit etre localise, borne et verifie

Autrement dit :

- oui, tu peux dire que tu t'es aide d'un LLM sur certaines parties
- non, tu ne dois pas le presenter comme la source de verite
- ce qui compte, c'est que tu saches justifier le code final

## Ce qu'il faut savoir dire sans hesiter

- pourquoi `createApp()` est separe de `startServer()`
- pourquoi les controllers restent minces
- pourquoi les services existent
- pourquoi certains inputs sont `strict` et d'autres `clamped`
- pourquoi `MissionService` fait une double verification avant ecriture
- pourquoi `ReflexionService` est "zero-LLM"
- pourquoi `KnnPropagationService` est du remplissage deterministe par voisinage
