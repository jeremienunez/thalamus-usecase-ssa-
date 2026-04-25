# Protocole coût et observabilité pour les eval sets

Statut: brouillon de protocole production-grade.

## Objectif

Chaque run d'eval doit produire deux résultats inséparables:

- un score métier reproductible par case, stratégie, provider et modèle;
- une trace coût/fiabilité suffisante pour décider si le run peut être promu,
  répété à plus grande échelle, ou bloqué.

Le protocole couvre les eval sets réels de `docs/evals/README.md`: SSA CDM,
SSA research, Sweep, Sim et HRM. Il ne valide pas seulement la qualité des
réponses: il valide le coût marginal, la latence, les retries, les failures et
la couverture telemetry par appel.

## Modèles et providers dans le périmètre

Les runs doivent enregistrer le provider logique, le modèle demandé, le modèle
effectivement appelé et le rôle du modèle dans le pipeline.

| Provider | Modèles configurés à suivre | Usage attendu |
| --- | --- | --- |
| `kimi` | `kimi-k2-turbo-preview` | planner/cortex par défaut, appels longs non-thinking |
| `openai` | `gpt-5.4-nano`, `gpt-5-nano`, `gpt-5.4-mini` | nano calls, fallback transport, web-search adapter |
| `minimax` | `MiniMax-M2.7` | transport OpenAI-compatible avec `reasoningSplit` possible |
| `local` | Gemma local: `local/gemma-4-26B-A4B-it-Q3_K_M`, `local/gemma-e4b-q8`, ou `local` via transport | llama.cpp local, coût API nul mais coût infra/latence à mesurer |
| `voyage` | Voyage embeddings, notamment `voyage-4-large` quand disponible dans le job | embeddings catalogue/mémoire, coût par batch et par item |

Un run est invalide si une trace contient seulement `model=nano`, `fallback`,
`local`, ou un alias non résolu sans champ `effective_model`.

## Budgets minimum de promotion

Les budgets ci-dessous sont des seuils minimums pour produire des signaux utiles.
Ils ne remplacent pas les caps de sécurité runtime; ils définissent le niveau de
confiance attendu avant une décision go/no-go.

| Niveau | Budget minimum | Portée minimale |
| --- | ---: | --- |
| Smoke réel | 25 USD | Tous les adapters activés au moins une fois, 10 cases par famille critique, vérification des métriques coût/latence/failure. |
| Candidat release | 50 USD | Couverture équilibrée SSA/Sweep/Sim/HRM, seeds répétés, comparaison paired agentic-vs-baseline. |
| Promotion production | 100 USD | Run complet ou stratifié, intervalles de confiance, test de régression coût, revue failure/retry par provider. |

Pour Gemma local, comptabiliser `provider_cost_usd=0` mais garder une ligne de
coût imputé séparée: temps GPU/CPU, durée wall-clock, consommation estimée si
disponible. Le go/no-go ne doit pas masquer une régression de capacité locale
sous prétexte que la facture API est nulle.

## Telemetry obligatoire par appel

Chaque appel LLM ou embedding doit émettre un événement structuré. Champs
minimums:

- identité: `run_id`, `eval_set`, `case_id`, `case_seed`, `strategy`,
  `component`, `call_id`, `parent_call_id`;
- routage: `provider`, `requested_model`, `effective_model`, `endpoint`,
  `transport_mode`, `fixture_id` si replay;
- paramètres: `reasoning_effort`, `verbosity`, `thinking`,
  `reasoning_format`, `reasoning_split`, `temperature`, `max_output_tokens`,
  `top_p` quand applicable;
- volume: `input_tokens`, `output_tokens`, `reasoning_tokens`,
  `cached_input_tokens`, `embedding_items`, `embedding_dimensions`;
- coût: `estimated_cost_usd`, `billed_cost_usd` si connu,
  `pricing_version`, `currency`;
- latence: `started_at`, `ended_at`, `duration_ms`,
  `time_to_first_token_ms` si stream;
- résultat: `status=ok|retry_ok|failed|cancelled|timeout|budget_blocked`,
  `finish_reason`, `output_bytes`, `parsed_json_ok`;
- robustesse: `attempt`, `max_retries`, `retry_reason`, `http_status`,
  `provider_error_code`, `timeout_ms`;
- qualité de parsing: `schema_name`, `schema_version`, `validation_errors`,
  `repair_attempted`, `repair_ok`;
- sécurité: `redaction_applied=true`, aucun secret, aucune donnée brute
  sensible dans les logs.

Les métriques agrégées doivent être calculables sans relire les réponses brutes:
coût total, coût par case, coût par score gagné, p50/p95/p99 latence,
taux de retry, taux d'échec terminal, taux de JSON invalide, taux de timeout,
répartition provider/model, et consommation tokens/embeddings.

## Provider/model usage

Chaque rapport de run doit inclure une table `provider_model_usage` avec:

- appels, cases touchées, tokens entrée/sortie/reasoning;
- coût total et coût moyen par case;
- p50/p95/p99 de latence;
- retries totaux, retries réussis, failures terminaux;
- part du budget utilisée;
- deltas versus le dernier run de référence.

Règles concrètes:

- si `kimi-k2-turbo-preview` dépasse 60 % du budget sur un run non deep, le run
  doit expliquer quelles cases l'ont consommé;
- si `gpt-5.4-nano` ou `gpt-5-nano` produit plus de 2 % de JSON invalide, bloquer
  la promotion jusqu'à correction du parsing ou des prompts;
- si `gpt-5.4-mini` est utilisé comme fallback ou web-search adapter, le rapport
  doit distinguer fallback opportuniste et routage principal;
- si `MiniMax-M2.7` est utilisé avec `reasoningSplit`, vérifier que les tokens de
  raisonnement sont comptés séparément ou marqués explicitement `unknown`;
- si Gemma local est utilisé, reporter séparément disponibilité serveur,
  saturation, timeouts et longueur de file;
- si Voyage est utilisé, reporter coût par batch, batch size réel,
  failures par batch, null embeddings et retries.

## Retries, failures et budgets

Politique par défaut: 2 retries maximum par appel distant, aligné avec
`llmMaxRetries`. Un retry doit conserver le même `call_id` logique et un
`attempt` incrémenté. Un changement de provider ou de modèle après failure crée
un nouvel appel enfant avec `parent_call_id` pointant vers l'appel initial.

Un run doit échouer explicitement si:

- le budget hard est atteint et des cases restent non évaluées;
- plus de 5 % des cases ont au moins un composant terminal failed;
- plus de 10 % des appels d'un provider passent par retry;
- une famille d'eval n'a pas de telemetry coût complète;
- un modèle non autorisé apparaît sans justification dans le manifeste du run.

Les timeouts sont des failures, même si un fallback produit ensuite une réponse.
Le score métier peut utiliser le fallback, mais le rapport coût/fiabilité doit
préserver le timeout initial.

## Multimodal

Le protocole marque le multimodal comme absent actuellement. Les eval sets et
les transports observés sont texte, JSON, embeddings et données tabulaires.

Conséquence pratique:

- champ obligatoire `modalities=["text"]`, `["embedding"]`, ou mixte texte plus
  données structurées;
- `image_input_count`, `audio_input_count`, `video_input_count` doivent être `0`
  ou absents avec `multimodal_supported=false`;
- aucun go/no-go ne doit revendiquer une couverture vision/audio tant qu'un
  adapter multimodal et des cases multimodales réelles ne sont pas ajoutés.

## Artefacts de run

Chaque run promotionnable doit écrire:

- `run-summary.json`: scores, budget, statut go/no-go, versions, git SHA;
- `calls.jsonl`: un événement par appel ou tentative;
- `provider-model-usage.json`: agrégats provider/modèle;
- `failures.jsonl`: failures terminales et retries épuisés;
- `case-results.jsonl`: score métier par case avec pointeurs vers `call_id`;
- `cost-report.md`: synthèse lisible pour revue humaine.

Les artefacts doivent permettre de répondre rapidement à trois questions:

1. Combien a coûté chaque point de métrique gagné versus baseline?
2. Quel provider/modèle porte le risque de coût ou fiabilité?
3. Le run est-il reproductible sans dépendre de logs applicatifs volatils?

## Critères go/no-go

Go uniquement si toutes les conditions suivantes sont vraies:

- budget minimum atteint pour le niveau ciblé: 25, 50 ou 100 USD;
- aucune famille d'eval critique sans résultat;
- telemetry par appel complète pour au moins 99 % des appels;
- coût total inférieur au cap approuvé et coût par case expliqué;
- aucun provider au-dessus de 5 % de failures terminales;
- aucun provider au-dessus de 10 % de retries sauf incident documenté et isolé;
- p95 latence compatible avec le mode visé: smoke tolérant, release borné,
  production sans queue pathologique;
- score métier supérieur ou égal au baseline sur les métriques verrouillées,
  ou régression explicitement acceptée avec justification;
- aucun modèle inattendu, alias non résolu, secret loggé ou réponse brute sensible;
- multimodal déclaré absent si aucune couverture multimodale réelle n'existe.

No-go immédiat si:

- le coût est incomplet ou non attribuable par provider/modèle;
- le budget est consommé avant d'obtenir une couverture représentative;
- un fallback masque une panne systémique du provider principal;
- les outputs ne peuvent pas être reliés aux cases et aux appels;
- les résultats ne permettent pas une comparaison paired contre baseline.

## Décision finale attendue

La revue de run doit produire une décision unique:

- `go`: promouvoir ou augmenter l'échelle;
- `go_with_watch`: promouvoir avec suivi explicite d'un provider, modèle,
  métrique coût ou failure mode;
- `no_go`: bloquer, garder les artefacts, ouvrir une correction ciblée.

Une décision sans lien vers les artefacts coût/observabilité est considérée
invalide, même si les scores métier sont bons.
