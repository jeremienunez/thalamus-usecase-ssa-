# Protocole D'Evaluation Production-Grade

Ce document décrit comment évaluer Thalamus, Sweep et Sim contre des baselines
sur des jeux de données réels, avec des runs non déterministes mais comparables.
Le but n'est pas de produire une démo flatteuse: le but est de prouver, sous
budget contrôlé, que l'agentique améliore la fiabilité par rapport aux
baselines.

## Objectif

L'évaluation doit répondre à quatre questions:

1. Thalamus trouve-t-il plus de signaux corrects qu'un passage direct, sans
   inventer d'IDs, de nombres ou de sources?
2. Sweep détecte-t-il de vraies dérives de base de connaissance par rapport à
   des sources officielles, au-delà d'un simple null-scan?
3. Sim couvre-t-il mieux l'espace des issues possibles qu'un unique verdict
   one-shot?
4. Les gains survivent-ils au non-déterminisme quand on compare les mêmes cas,
   les mêmes seeds et les mêmes budgets?

## Corpus

Le corpus source est défini dans
[`real-eval-manifest.json`](real-eval-manifest.json). Les fichiers téléchargés
restent sous `data/evals/`, ignoré par git. Chaque run scoré doit référencer le
lockfile `data/evals/_manifest-lock.json`.

Corpus SSA:

- ESA Kelvins Collision Avoidance Challenge: CDM réels anonymisés, labels de
  risque et données historiques 2015-2019. C'est le gold set pour le risque de
  conjonction et les décisions manoeuvre/non-manoeuvre.
- CelesTrak SATCAT, GP active et SOCRATES: vérité publique vivante pour les IDs
  NORAD, états catalogues, éléments orbitaux, top conjonctions et tests de
  dérive.
- NOAA SWPC Kp/F10.7: contexte space-weather officiel pour vérifier que les
  corrélations et citations restent sourcées.

Corpus HRM:

- ARC-AGI-2 officiel: 1000 tâches training, 120 tâches evaluation.
- Sapient HRM Sudoku Extreme 1k: train, sudoku-bench, hard test.
- Sapient HRM Maze 30x30 Hard 1k: train/test.
- Sapient HRM reference code: protocole et générateurs de référence.

## Acquisition Et Verrouillage

Deux profils d'acquisition sont utilisés:

- `smoke`: acquisition rapide de la metadata ESA, CelesTrak, NOAA et HRM léger.
  Sert aux checks de parsing, citations, drift et smoke HRM.
- `full`: inclut l'archive ESA complète, ARC-AGI-2 repo zip et référence HRM.
  Sert aux scores défendables.

Commandes:

```bash
npm run evals:list
npm run evals:fetch:smoke
npm run evals:fetch:full
```

Le scoring doit refuser de démarrer si:

- `data/evals/_manifest-lock.json` est absent;
- un asset attendu n'a pas `url`, `bytes` et `sha256`;
- un asset ESA avec `expectedMd5` ne matche pas le MD5 attendu;
- le runner tente de relire une source live pendant le scoring.

Pour chaque campagne, copier le lockfile dans le dossier de rapport et calculer
son hash. CelesTrak et NOAA sont des snapshots live: leurs scores ne sont
comparables qu'à l'intérieur du lockfile de campagne ou entre deux lockfiles
explicitement comparés.

## Splits

ESA Kelvins doit être split au niveau événement. Aucune ligne CDM d'un même
événement ne peut apparaître dans deux partitions.

Split recommandé:

- `train`: 60% des événements pour calibrer features, prompts, seuils et
  baselines.
- `validation`: 20% pour choisir les seuils de haut risque/manoeuvre.
- `test_locked`: 20% pour le score final, sans tuning après inspection.

Si l'ID événement n'est pas directement exposé, le builder doit produire un ID
canonique documenté depuis les colonnes stables et stocker la table de mapping
dans le split lock. Les séquences temporelles restent ordonnées: aucune CDM
postérieure au cut-off simulé ne doit être fournie au modèle.

Artefacts attendus:

- `data/evals/splits/ssa/esa-kelvins-v1/train.jsonl`
- `data/evals/splits/ssa/esa-kelvins-v1/validation.jsonl`
- `data/evals/splits/ssa/esa-kelvins-v1/test_locked.jsonl`
- `data/evals/splits/ssa/esa-kelvins-v1/split-lock.json`

Pour CelesTrak/NOAA, les splits sont campagne-spécifiques:

- `parse_smoke`: tous les assets lockés;
- `triage_eval`: top N SOCRATES par `MAXPROB` et `MINRANGE`, dédupliqués par
  paire d'objets;
- `drift_eval`: deltas entre deux lockfiles compatibles;
- `weather_context_eval`: fenêtres Kp/F10.7 alignées sur les cas SSA.

## Strategies Comparees

Chaque case doit exécuter une stratégie agentique et une baseline figée avant
tuning.

Thalamus:

- Agentique: planner DAG, cortices spécialisés, reflexion/replan, persistence
  KG, citations et règles de sourcing actives.
- Baseline: un passage direct sur le même payload, ou retrieval-only +
  synthèse unique, sans boucle reflexion et sans expansion multi-cortex.

Sweep:

- Agentique: `NanoSweepService` en mode audit, avec batching, feedback passé,
  parsing de suggestions et payloads de résolution.
- Baseline: null-scan déterministe sur les mêmes tables/snapshots, sans LLM.

Sim:

- Agentique: swarm multi-fish, perturbations, quorum, agrégation modale et
  divergence.
- Baseline: un seul fish ou un verdict direct sans distribution.

HRM:

- Agentique: solveur avec decomposition, verification, retries bornés et
  auto-check de validité.
- Baseline directe: appel direct au modèle avec le même budget de sortie
  maximal.
- Baseline agentique légère: decomposition, auto-vérification et retry bornés,
  mais sans les mécanismes HRM évalués.

## Conditions De Comparaison

Les comparaisons doivent être appariées:

- même case id;
- même snapshot de données;
- même seed;
- même budget max;
- même modèle, sauf quand le test compare explicitement des modèles;
- même limite de web-search;
- même politique de retry.

Interdit: comparer la moyenne d'un lot aléatoire agentique contre un autre lot
baseline. Cela donne une preuve statistique faible et difficile à défendre.

## Metriques SSA

Thalamus SSA:

- entity-id exact recall: IDs NORAD / objets / événements attendus retrouvés;
- hallucinated-id rate: IDs cités absents du payload ou du snapshot source;
- numeric-fidelity error rate: nombres cités non dérivables de la source;
- citation coverage: proportion de claims avec source officielle exploitable;
- finding recall / precision par type de signal;
- latency, coût, taux d'échec parser/provider.

Sweep:

- recall des dérives réelles depuis CelesTrak/NOAA/ESA lockés;
- precision des suggestions actionnables;
- validité du `resolutionPayload`;
- duplicate rate;
- accepted-action impact quand une résolution est rejouable;
- taux de faux positifs null-scan vs audit agentique.

ESA CDM:

- MAE/RMSE sur le log-risque final par event;
- AUPRC high-risk;
- F1 décision manoeuvre/non-manoeuvre au seuil fixé avant run;
- calibration/Brier score si la sortie est probabiliste.

Sim:

- modal outcome accuracy;
- Brier score sur distribution;
- entropy/divergence score;
- coverage des clusters attendus;
- quorum failure rate;
- coût par swarm et par issue utile.

## Metriques HRM

ARC-AGI-2:

- exact accuracy;
- pass@2 si deux sorties sont autorisées;
- pixel/cell accuracy uniquement comme diagnostic secondaire;
- coût par tâche résolue.

Sudoku:

- exact solution accuracy;
- invalid grid rate;
- contradiction rate;
- latency et coût par grille.

Maze:

- exact path accuracy;
- valid path rate;
- shortest-path optimality gap;
- dead-end / wall-crossing rate.

## Statistiques

Pour chaque métrique principale:

- calculer les deltas appariés `agentic - baseline`;
- reporter moyenne, médiane, win-rate et loss-rate;
- bootstrap confidence interval 95% sur les deltas, idéalement 5000 à 10000
  resamples stratifiés par eval set;
- sign-test one-sided pour tester "agentic > baseline" quand cette hypothèse a
  été déclarée avant le run;
- reporter aussi les regressions, pas seulement les victoires.

Le rapport doit indiquer le nombre de cases, le nombre de seeds et les cas
exclus avec raison explicite.

Pour le sign-test apparié:

- `win`: agentique correct, baseline incorrecte;
- `loss`: agentique incorrect, baseline correcte;
- `tie`: les deux corrects ou les deux incorrects.

Les ties sont exclus du test principal mais rapportés. Une p-value seule ne
suffit pas: exiger aussi un effet pratique minimal et un coût par succès
acceptable.

## Couts Et Modeles Reels Du Repo

La config actuelle utilise:

- `kimi-k2-turbo-preview` pour `thalamus.planner` et les cortices par défaut;
- `gpt-5.4-nano` pour `thalamus.nano`, Sweep audit et Sim fish;
- `gpt-5-nano` comme fallback OpenAI transport;
- `gpt-5.4-mini` pour web search via `OpenAIWebSearchAdapter`;
- `MiniMax-M2.7` comme provider optionnel;
- local Gemma comme provider optionnel sans coût API;
- `voyage-4-lite` et `voyage-4-large` pour embeddings.

Budget tiers:

- `$25` smoke sérieux: prouve que le pipeline réel tourne et donne des premiers
  deltas appariés.
- `$50` minimum défendable: assez de cases/seeds pour commencer à soutenir
  "agentique > baseline" sur un périmètre limité.
- `$100` benchmark interne confortable: meilleure couverture SSA + Sim + HRM
  smoke élargi.
- `$250+` paper-grade interne: plus de seeds, plus de swarms, HRM plus large,
  analyse d'échecs complète.

Le multimodal n'est pas encore un chemin runtime explicite dans ce repo. ARC et
HRM sont évalués en JSON/texte. Toute évaluation image doit ajouter un adapter
multimodal et une ligne de coût séparée.

## Telemetry Obligatoire

Chaque appel modèle doit produire un événement JSONL avec:

- run id, case id, strategy, seed;
- subsystem: `thalamus`, `sweep`, `sim`, `hrm`;
- provider, requested model, effective model, endpoint, mode (`cloud`,
  `record`, `fixtures`);
- reasoning effort, verbosity, thinking, reasoning format/split, temperature,
  max output tokens;
- prompt tokens, completion tokens, reasoning tokens, cached tokens quand
  disponibles;
- estimation de coût, coût provider réel si disponible, pricing version;
- latency, retry count, timeout flag, HTTP status, provider error code;
- web-search calls et URLs citées;
- Voyage embedding calls, dimensions, batch size et tokens;
- parser status: ok, retry_ok, invalid_json, empty_valid,
  degenerate_repetition;
- failure kind: provider_unavailable, timeout, budget_exhausted,
  hallucinated_id, numeric_mismatch, no_evidence.

Sans cette telemetry, le benchmark n'est pas production-grade: il devient
impossible d'expliquer pourquoi un score monte ou baisse.

## Taxonomie D'Erreurs

Erreurs bloquantes:

- `invented_identifier`: NORAD ID, event ID, mission, opérateur ou source absent
  des evidence rows.
- `source_substitution`: mauvaise source utilisée pour justifier un fait.
- `future_leakage`: usage d'une CDM, d'un snapshot ou d'un forecast postérieur
  au cut-off du cas.
- `split_leakage`: même événement ESA présent dans plusieurs splits.
- `unlocked_live_access`: accès réseau ou live pendant le scoring.
- `numeric_fabrication`: chiffre non présent et non dérivable des valeurs
  citées.
- `overclaim_correlation`: causalité NOAA/risque affirmée sans calcul prévu.
- `action_without_evidence`: suggestion Sweep applicable mais sans evidence
  externe suffisante.

Erreurs non bloquantes mais scorées:

- `rounding_drift`: valeur dérivée correcte mais hors tolérance.
- `weak_citation`: source au niveau dataset mais pas asset/row.
- `low_specificity`: finding vrai mais trop vague pour agir.
- `duplicate_output`: même finding ou action répété.

Une hallucination bloquante met le cas à zéro pour la sous-métrique concernée
et doit apparaître dans `failures.md` / `error-ledger.jsonl`.

## Rapports

Chaque run doit produire:

- `eval-run.json`: config complète et références;
- `calls.jsonl`: un événement par appel;
- `cases.jsonl`: résultats par case et seed;
- `provider-model-usage.json`: agrégats appels/tokens/coût/latence/retries par
  provider et modèle;
- `paired-deltas.json`: deltas appariés, CIs, win/loss/tie et sign-test;
- `error-ledger.jsonl`: erreurs classées par taxonomie;
- `summary.md`: tableau lisible;
- `failures.md`: analyse des échecs et hallucinations.

Le rapport doit inclure:

- commit SHA;
- manifest path et hash;
- lockfile path et hash;
- runtime config complète;
- modèles et providers réellement utilisés;
- budget cap et coût réel;
- métriques principales;
- limites connues.

## Go / No-Go

Go minimum:

- corpus réel locké;
- baselines figées;
- au moins 4 seeds appariées;
- budget cap respecté;
- telemetry par appel;
- rapport reproductible;
- aucune hallucination critique non expliquée dans les cas SSA retenus.

No-go:

- absence de lockfile;
- changement de baseline après inspection des résultats;
- comparaison non appariée;
- coût non mesuré;
- provider fallback silencieux;
- métrique principale sans intervalle de confiance;
- claim de gain sans analyse des régressions.

## Plan Minimal Recommande

Phase 1, `$25`:

- 10-15 cases SSA;
- 4 seeds;
- 3-5 swarms Sim de 20 fish;
- HRM: environ 20-40 tâches ARC-AGI-2, 10 Sudoku, 10 Maze;
- web-search borné ou désactivé sauf cases de citation.

Phase 2, `$50`:

- 20-30 cases SSA;
- 8 seeds;
- 5-10 swarms Sim de 20-30 fish;
- HRM: environ 50-80 tâches ARC-AGI-2, 20 Sudoku, 20 Maze;
- `pass@1` et `pass@3` quand le budget le permet;
- premier rapport défendable agentic vs baseline.

Phase 3, `$100+`:

- 50+ cases SSA;
- 16 seeds;
- 20+ swarms Sim;
- HRM: environ 100-150 tâches ARC-AGI-2, 40 Sudoku, 40 Maze, `pass@5` si le
  coût par tentative reste bas;
- analyse détaillée des coûts, retries, hallucinations et failure modes.
