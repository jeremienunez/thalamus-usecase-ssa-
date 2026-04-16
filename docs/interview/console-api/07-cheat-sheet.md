# 07 - Cheat sheet entretien

## Pitch 30 secondes

"`console-api` est une API Fastify en couches. `server.ts` boote Fastify et le
container. Les routes declarent les endpoints. Les controllers font la
validation HTTP avec Zod et deleguent. Les services portent la logique metier.
Les repositories encapsulent le SQL. Le LLM n'est utilise que dans des zones
bornees, notamment la mission de recherche web et le chat console."

## Pitch 60 secondes sur la mission

"La mission prend des suggestions sweep non reviewees, filtre celles qui
correspondent a des `update_field` sur des champs whitelistes et a des valeurs
encore nulles, puis cree une file de taches. Chaque tache fait deux recherches
independantes via nano avec web search. Si les deux votes convergent, la valeur
est ecrite, auditee et transformee en finding d'enrichment. Sinon la tache est
marquee unobtainable. Le but est d'avoir un enrichissement semi-automatique,
mais avec des garde-fous stricts."

## Pitch 45 secondes sur Reflexion

"Reflexion est une passe analytique zero-LLM. A partir d'un NORAD, on charge la
cible, puis on cherche des voisins orbitaux stricts, un belt d'inclinaison, et
des peers a lineage militaire. Si on detecte soit une proximite militaire, soit
une divergence entre pays declare et belt dominant, on emet un finding."

## Si on te demande "ou est le LLM ?"

Reponse propre :

"Le LLM n'est pas partout. Dans `console-api`, il est surtout borne a
`NanoResearchService` pour l'extraction factuelle avec web search et a
`ReplChatService` pour le routage d'intention et la formulation du chat. Le
reste du code est surtout du SQL, de l'orchestration et des garde-fous."

## Si on te demande "qu'est-ce qui est deterministe ?"

- controllers
- schemas
- repositories
- transformers
- `ReflexionService`
- `KnnPropagationService`
- `ReplTurnService`
- `repl.ts`

## Si on te demande "pourquoi les controllers sont si minces ?"

"Parce que je voulais que la logique reste testable hors HTTP. Les controllers
ne font que valider, mapper les codes de retour et appeler les services."

## Si on te demande "pourquoi avoir des schemas clamps ?"

"Parce qu'il y a une difference entre une erreur semantique et un parametre de
tuning hors plage. Un `noradId` invalide doit etre rejete. En revanche un
`limit=100000` peut etre ramene dans une plage supportee."

## Si on te demande "comment eviter qu'un LLM salisse la base ?"

Tu peux citer les garde-fous concrets :

- JSON strict
- source HTTPS obligatoire
- source coherente avec les URLs ouvertes
- rejet des formulations floues
- controle d'unite
- controle de range
- double vote
- accord obligatoire entre les votes
- audit d'ecriture

## Ce que tu ne dois pas dire

- "Le LLM a fait toute la logique"
- "Je ne sais plus trop pourquoi ce service existe"
- "Les repositories c'est juste du boilerplate"

## Ce que tu peux dire honnêtement

"Je me suis aide d'un LLM comme accelerateur sur certaines parties, mais la
structure finale, les contrats d'entree, les garde-fous et la logique metier,
je peux les expliquer fichier par fichier."

