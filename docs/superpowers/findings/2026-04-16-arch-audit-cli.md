# Arch audit — packages/cli/

## Summary
Verdict: l'hypothese "cli est 100% domain" est fausse au niveau fichier par fichier, mais vraie au niveau boundary de package.

`packages/cli/src/` contient un petit noyau Ink/REPL reutilisable: prompt, scroll, buffer de conversation, cout, ETA, ring buffer logs et quelques renderers structurels. En revanche le package publie `bin: ssa`, depend directement de `@interview/thalamus`, `@interview/sweep`, `@interview/db-schema`, Postgres et Redis, et son routeur encode les commandes `/query`, `/telemetry`, `/graph`, `/logs`, `/accept`, `/explain`, `/pc`, `/candidates`.

Le grep demande (`satellite|conjunction|SSA|NORAD|thalamus|sweep`) confirme des fuites directes dans `boot.ts`, `app.tsx`, `router/*`, `adapters/telemetry.ts`, `adapters/pcEstimator.ts`, `renderers/pcEstimator.tsx` et `renderers/candidates.tsx`. Un grep plus large montre aussi `researchCycle`, `researchFinding`, `researchEdge`, `finding`, `source_item`, `FIELD/OSINT/SIM`, `fish`, `payload`, `rocket_stage`, `debris`, `cortex`.

## Kernel-pure (si ya)
- `src/index.ts` — entrypoint minimal qui appelle `main()` sans logique SSA propre.
- `src/memory/buffer.ts` — buffer de tours conversationnels generique, pas de commande metier.
- `src/memory/palace.ts` — memoire vectorielle de session generique; le nom `SimMemoryRepo` est faible mais pas SSA-specific dans le comportement.
- `src/memory/tokens.ts` — comptage tiktoken generique.
- `src/components/Prompt.tsx` — input Ink generique avec submit/backspace.
- `src/components/ScrollView.tsx` — wrapper layout Ink generique.
- `src/components/StatusFooter.tsx` — footer session/tokens/cout/last action generique pour REPL LLM.
- `src/util/costMeter.ts` — accumulateur de cout generique.
- `src/util/etaStore.ts` — stockage local de durees par cle `(kind, subject)`, generique.
- `src/util/pinoRingBuffer.ts` — ring buffer Pino generique.
- `src/adapters/logs.ts` — tail de logs par niveau/service/temps, pas couple au domaine SSA.
- `src/renderers/clarify.tsx` — rendu d'une question de clarification et d'options, generique.
- `src/renderers/graphTree.tsx` — rendu d'un arbre de graphe `{ root, levels }`, pas de schema SSA dans le composant.

## Domain-leaked
- `src/boot.ts` — composition root Thalamus/Sweep: imports `@interview/thalamus`, `@interview/sweep`, `@interview/db-schema`, Pool Postgres, Redis, `ResearchCycleTrigger`, wiring telemetry swarm, resolution sweep, KNN conjunction candidates, SQL `research_edge`, `research_finding`, `source_item`, URL DB `thalamus`.
- `src/app.tsx` — shell REPL melange avec resultats metier: `cycleId`, `cortex`, resume "Research cycle", dispatch vers renderers telemetry/Pc/candidates/why.
- `src/adapters/thalamus.ts` — adapter explicite `ThalamusService.runCycle`.
- `src/adapters/telemetry.ts` — API `satelliteId`/`satId`.
- `src/adapters/pcEstimator.ts` — adapter Pc-estimator sur `conjunctionId`.
- `src/adapters/graph.ts` — BFS generique en forme, mais interface `ResearchGraphRepo` et usage attendu research graph.
- `src/adapters/resolution.ts` — `SweepResolutionService`, `suggestionId`, `actorId: cli:local`, `source: cli`.
- `src/adapters/why.ts` — provenance `finding`, `edge`, `source_item`, `sourceClass` field/osint/sim/derived.
- `src/router/dispatch.ts` — union `DispatchResult` et `Adapters` hardcodees pour query/telemetry/logs/graph/accept/explain/pc/candidates; types `satId`, `conjunctionId`, `targetNoradId`, object classes orbitaux.
- `src/router/interpreter.ts` — lit le prompt `../../../thalamus/src/cortices/skills/interpreter.md`; le parser LLM n'est pas autonome.
- `src/router/parser.ts` — parser explicite des verbes domaine `/query`, `/telemetry`, `/graph`, `/accept`, `/explain`, `/pc`, `/candidates`, avec `payload`, `rocket_stage`, `debris`, `unknown`.
- `src/router/schema.ts` — schema Zod des actions domaine: `satId`, `findingId`, `conjunctionId`, `targetNoradId`, classes orbitales.
- `src/components/AnimatedEmoji.tsx` — depend de `STEP_REGISTRY`, `StepName`, `StepPhase` depuis `@interview/shared`; rendu couple aux etapes internes du systeme.
- `src/components/SatelliteLoader.tsx` — loader visuel satellite et copie "running"; signe fort d'UI SSA.
- `src/renderers/briefing.tsx` — findings, evidence refs, source classes FIELD/OSINT/SIM/KG.
- `src/renderers/logTail.tsx` — logs generiques en surface mais enrichis via `AnimatedEmoji` et `StepName`/`StepPhase` du shared metier.
- `src/renderers/pcEstimator.tsx` — Pc, `conjunctionId`, fish count, clusters, severite, `/accept`.
- `src/renderers/candidates.tsx` — KNN conjunction candidates, NORAD, classes payload/rocket_stage/debris, altitude overlap, narrow-phase cortex.
- `src/renderers/whyTree.tsx` — provenance research: `finding`, `edge`, `source_item`, source classes.
- `src/renderers/telemetry.tsx` — telemetry satellite avec `satId`, distributions scalaires et envelope.
- `src/util/colors.ts` — palette liee aux `SourceClass` FIELD/OSINT/SIM.

## Target
`packages/cli` ne devrait pas rester un package reusable tel quel. La cible saine est de le fusionner dans `apps/` comme application domaine, par exemple `apps/ssa-cli` ou `apps/console-cli`, parce que son API publique, son binaire (`ssa`) et son boot runtime appartiennent au produit SSA/Thalamus/Sweep.

Ne garder un package separe que si on extrait d'abord un vrai noyau reutilisable (`packages/repl-kernel` ou `packages/ink-repl`) limite aux primitives Prompt/ScrollView/ConversationBuffer/CostMeter/EtaStore/PinoRingBuffer/ClarifyRenderer, et seulement s'il existe au moins un second consommateur. Sinon, laisser ces helpers app-local evite de fabriquer une abstraction prematuree.

## Estimated refactor
- Deplacer `packages/cli` vers `apps/ssa-cli` avec son `package.json`, son binaire `ssa`, ses tests e2e, et mettre a jour les scripts workspace.
- Garder dans l'app le routeur domaine (`schema.ts`, `parser.ts`, `dispatch.ts`) et les renderers SSA (`briefing`, `telemetry`, `pcEstimator`, `candidates`, `whyTree`).
- Transformer `boot.ts` en composition root d'app; pousser les details SQL/provenance ou adapters live vers les packages proprietaires (`thalamus`/`sweep`) si ces contrats doivent etre reutilises.
- Optionnel: extraire un noyau Ink/REPL uniquement apres usage par un second CLI; candidats: `Prompt`, `ScrollView`, `StatusFooter`, `ConversationBuffer`, `CostMeter`, `EtaStore`, `PinoRingBuffer`, `ClarifyRenderer`, eventuellement `GraphTreeRenderer`.
- Renommer les types ambigus avant extraction (`SimMemoryRepo`, `ResearchGraphRepo`, `SourceClass`) ou les laisser cote app pour eviter les fuites conceptuelles.
- Ajuster les tests: conserver les tests routeur/adapters/renderers domaine dans `apps/ssa-cli/tests`; ne migrer vers un package kernel que les tests des primitives vraiment generiques.
