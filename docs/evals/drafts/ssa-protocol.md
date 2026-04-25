# Brouillon de protocole SSA pour evals Thalamus / Sweep / Sim

Statut: brouillon de protocole, production-grade mais non encore implémente dans un runner unique.

Objectif: mesurer des comportements SSA defendables sur donnees reelles, avec sources verrouillees, splits explicites, baselines simples et erreurs classees. Le protocole ne doit pas accepter une reponse "plausible" si elle perd les identifiants, invente un chiffre, ignore la fraicheur des donnees ou melange train/eval.

## Sources autorisees

Les sources SSA viennent du manifest `docs/evals/real-eval-manifest.json`. Le runner ne doit pas telecharger d'autres donnees pendant le scoring.

| Dataset manifest | Role | Assets utilises | Usage principal |
| --- | --- | --- | --- |
| `esa-kelvins-collision-avoidance` | gold stable | `zenodo-record-metadata`, `collision-avoidance-dataset-zip` | risque de conjonction, decision manoeuvre/non-manoeuvre, calibration Sim |
| `celestrak-live-ssa` | snapshot live verrouille | `satcat-raw-csv`, `active-gp-csv`, `socrates-max-probability-html`, `socrates-min-range-html` | fidelite NORAD/SATCAT/GP, detection d'elements stale, triage SOCRATES, drift Sweep |
| `noaa-swpc-space-weather` | snapshot live verrouille | `planetary-k-index-observed`, `planetary-k-index-forecast`, `f107-flux-30-day` | contexte meteo spatiale, claims numeriques, correlations Sweep/Sim |

Contraintes:

- Les rapports doivent citer l'identifiant dataset, l'asset, l'URL source et le hash du lockfile pour chaque campagne.
- ESA Kelvins est la seule source gold stable pour les labels de risque; CelesTrak et NOAA sont des verites de snapshot, pas des labels eternels.
- Les donnees CelesTrak SOCRATES sont scorees seulement contre le snapshot locke de la campagne, jamais contre une page live relue plus tard.
- Les produits NOAA peuvent contextualiser un risque, mais ne suffisent pas seuls a confirmer une conjonction ou une manoeuvre.

## Acquisition et lockfiles

Deux profils sont obligatoires:

- `smoke`: acquisition rapide de `zenodo-record-metadata`, CelesTrak et NOAA. Sert aux checks CI-adjacents, parsing, citations et regressions de drift.
- `full`: inclut aussi l'archive ESA `Collision Avoidance Challenge - Dataset.zip`. Sert aux scores officiels de risque, decision et calibration.

Commandes de reference:

```bash
npm run evals:list
npm run evals:fetch:smoke
npm run evals:fetch:full
```

Chaque run d'acquisition ecrit `data/evals/_manifest-lock.json`. Le runner de scoring doit refuser de demarrer si le lockfile manque ou si un asset attendu du profil n'a pas `url`, `bytes`, `sha256` et, quand disponible, `md5`, `etag` ou `lastModified`.

Pour rendre une campagne reproductible:

- copier le contenu logique de `_manifest-lock.json` dans un artefact immuable de run, par exemple `reports/evals/ssa/<run-id>/manifest-lock.json`;
- enregistrer le commit git, la version du manifest, le profil, la seed, le modele, les prompts et les seuils;
- interdire toute reecriture de lockfile pendant le scoring;
- publier les scores uniquement avec l'identifiant du lockfile. Un score sans lockfile est un dry-run non comparable.

## Splits

### ESA Kelvins

Un split ESA est fait au niveau evenement. Aucune ligne CDM d'un meme evenement ne peut apparaitre dans deux partitions.

Split propose pour `full`:

- `train`: 60% des evenements, uniquement pour calibrer seuils, prompts, features et baselines.
- `validation`: 20% des evenements, pour choisir le seuil operationnel de haut risque et de manoeuvre.
- `test_locked`: 20% des evenements, score final. Acces en lecture seulement, pas de tuning apres publication d'un resultat.

Regles:

- hash stable par `event_id` ou identifiant equivalent fourni par le dataset;
- si l'identifiant evenement n'est pas directement expose, le builder doit construire un identifiant canonique documente a partir des colonnes stables de l'evenement, puis stocker la table de mapping dans l'artefact de split;
- les sequences temporelles restent ordonnees; l'eval ne doit pas fournir au modele des CDM posterieurs au cut-off simule;
- la prediction finale d'un evenement est comparee au label final uniquement au dernier instant autorise par le cas.

Artefacts attendus:

- `data/evals/splits/ssa/esa-kelvins-v1/train.jsonl`
- `data/evals/splits/ssa/esa-kelvins-v1/validation.jsonl`
- `data/evals/splits/ssa/esa-kelvins-v1/test_locked.jsonl`
- `data/evals/splits/ssa/esa-kelvins-v1/split-lock.json`

`split-lock.json` contient au minimum: `manifestLockSha256`, `datasetId`, `assetIds`, `splitVersion`, `seed`, `eventCountBySplit`, `caseCountBySplit`, `builderCommit`.

### CelesTrak et NOAA

CelesTrak et NOAA sont des snapshots live. Le split est donc temporel et campagne-specifique.

Pour chaque lockfile:

- `parse_smoke`: tous les assets lockes, pour verifier parsing et fidelite de champs.
- `triage_eval`: top N SOCRATES locke par `MAXPROB` et top N locke par `MINRANGE`, avec deduplication par paire d'objets.
- `drift_eval`: deltas derives entre deux lockfiles consecutifs compatibles, jamais entre un lockfile et le live.
- `weather_context_eval`: fenetres NOAA observe/forecast/F10.7 alignees sur les cas ESA ou CelesTrak quand une date de scoring existe.

Les splits live sont invalides si les deux lockfiles compares n'ont pas le meme manifest version ou si un asset CelesTrak/NOAA attendu manque.

## Cas d'evaluation

### Thalamus SSA

Entree: lignes ESA, CelesTrak et NOAA transformees en evidence rows avec identifiants source, valeurs numeriques et timestamps.

Sortie attendue: findings structures avec titre, resume, urgence, confiance, evidence, entites et edges.

Metriques:

- `norad_id_fidelity`: proportion de NORAD IDs cites qui existent dans les evidence rows du cas.
- `entity_exact_recall`: rappel des satellites, paires ou evenements attendus dans le cas.
- `numeric_fidelity_error_rate`: taux de chiffres non presents, non derivables ou arrondis hors tolerance.
- `citation_coverage`: proportion des claims factuels avec evidence sourcee.
- `hallucinated_id_rate`: identifiants satellite, mission, operateur ou evenement absents des sources.
- `stale_context_error_rate`: utilisation d'un GP, SATCAT, SOCRATES ou produit NOAA hors lockfile ou hors fenetre.
- `finding_json_validity`: proportion de findings conformes au schema attendu.
- `latency_ms` et `cost_usd`: cout et latence par cas.

### Sweep SSA

Entree: snapshots CelesTrak/NOAA lockes, tables internes ou fixtures derivees du snapshot precedent, et regles de drift.

Sortie attendue: suggestions reviewables, chacune avec cible, champ, evidence externe, action proposee, severite et payload de resolution.

Metriques:

- `source_parse_success`: tous les assets attendus sont parses sans fallback silencieux.
- `true_drift_recall`: rappel des changements reels entre lockfiles compatibles.
- `sweep_drift_precision`: precision des suggestions marquees comme drift.
- `resolution_payload_validity`: payload applicable sans champ manquant, type invalide ou identifiant ambigu.
- `duplicate_suggestion_rate`: doublons apres canonicalisation de cible/champ/source.
- `accepted_action_impact`: fraction des suggestions qui corrigeraient effectivement la valeur interne simulee.
- `false_alarm_weather_rate`: alertes meteo spatiale non justifiees par NOAA locke.

### Sim SSA

Entree: sequences ESA par evenement et, quand disponible, contexte NOAA locke aligne temporellement.

Sortie attendue: distribution d'issues, trajectoires de raisonnement courtes, decision manoeuvre/non-manoeuvre et incertitude.

Metriques:

- `event_final_log_risk_mae` et `event_final_log_risk_rmse`: erreur sur le log-risque final.
- `high_risk_auprc`: qualite de ranking des evenements haut risque.
- `maneuver_decision_f1`: F1 a seuil choisi sur validation avant test.
- `calibration_brier`: calibration de la probabilite de haut risque ou de manoeuvre.
- `modal_outcome_accuracy`: issue la plus probable correcte.
- `cluster_coverage`: proportion des modes plausibles retrouves par le swarm.
- `quorum_failure_rate`: cas ou le swarm ne produit pas de decision exploitable.
- `entropy_calibration_error`: ecart entre incertitude annoncee et erreurs observees.

## Baselines

Chaque score agentique doit etre compare a au moins une baseline non-agentique et une baseline LLM simple.

Baselines Thalamus:

- `single_pass_context_only`: un seul appel sur les evidence rows, sans recherche, sans reflexion, sans replan.
- `retrieval_echo`: retourne les entites et chiffres les plus saillants des sources sans synthese strategique.
- `null_finding`: aucun finding sauf si le cas impose une alerte minimale; baseline pour mesurer le faux positif.

Baselines Sweep:

- `no_op`: aucune suggestion.
- `schema_nullscan`: detecte seulement nulls, types invalides et champs obligatoires manquants.
- `snapshot_diff_exact`: compare deux snapshots lockes par cle canonique sans LLM ni heuristique semantique.

Baselines Sim:

- `last_observation`: reutilise le dernier risque observe ou le dernier classement disponible.
- `threshold_validation`: applique le seuil choisi sur validation sans swarm.
- `logistic_or_tree_features`: modele interpretable sur features CDM simples, entraine seulement sur `train`.

Un resultat est publiable seulement si les deltas sont rapportes en paire sur les memes cas: moyenne, intervalle bootstrap, win rate et test des signes unilateraux quand le protocole cherche une amelioration.

## Erreurs et hallucinations

Les erreurs doivent etre annotees par categorie, pas seulement comptees comme "wrong".

Categories bloquantes:

- `invented_identifier`: NORAD ID, event ID, mission, operateur ou source absent des evidence rows.
- `source_substitution`: citation NOAA pour un fait orbital CelesTrak, ou citation CelesTrak pour une meteo spatiale NOAA.
- `future_leakage`: usage d'un CDM, snapshot ou forecast posterieur au cut-off du cas.
- `split_leakage`: evenement ESA present dans plusieurs splits.
- `unlocked_live_access`: lecture reseau ou live pendant le scoring.
- `numeric_fabrication`: chiffre non present et non derivable a partir de valeurs citees.
- `overclaim_correlation`: causalite ou correlation NOAA/risque affirmee sans calcul predefini.
- `action_without_evidence`: suggestion Sweep applicable mais sans evidence externe suffisante.

Categories non bloquantes mais scorees:

- `rounding_drift`: valeur derivee correcte mais tolerance depassee.
- `weak_citation`: source citee au niveau dataset mais pas asset/row.
- `low_specificity`: finding vrai mais trop vague pour agir.
- `duplicate_output`: meme action ou finding emis plusieurs fois.

Une hallucination bloquante met le cas a zero pour la sous-metrique concernee et doit etre visible dans le rapport d'erreurs.

## Conditions minimales defendables

Un run SSA peut etre qualifie de defendable seulement si toutes les conditions suivantes sont satisfaites:

- Tous les assets requis par le profil sont presents dans `data/evals/_manifest-lock.json` avec hash et taille.
- Le scoring n'effectue aucun acces reseau.
- Les splits ESA sont au niveau evenement et verifies par test d'intersection vide.
- Les seuils de risque/manoeuvre sont choisis sur `validation`, jamais sur `test_locked`.
- Les resultats CelesTrak/NOAA mentionnent explicitement le timestamp ou lockfile de snapshot.
- Chaque claim factuel majeur a une evidence sourcee; sinon il est marque inconnu ou non conclu.
- Les hallucinations bloquantes sont rapportees separement des erreurs ordinaires.
- Les couts, latences, seeds, modele, prompts et commit sont enregistres.
- Les scores agentiques sont compares a des baselines sur les memes cas, avec intervalles de confiance.
- Le rapport indique clairement quelles metriques viennent de gold labels ESA et lesquelles viennent de snapshots live.

Seuils minimaux pour une premiere publication interne:

- `finding_json_validity` >= 0.98 sur smoke.
- `source_parse_success` = 1.00 sur smoke.
- `hallucinated_id_rate` <= 0.01 sur Thalamus SSA.
- `numeric_fidelity_error_rate` <= 0.03 sur claims numeriques cites.
- `sweep_drift_precision` >= baseline `snapshot_diff_exact` - 0.02, avec rappel superieur ou egal sur les memes cas.
- `calibration_brier` et `maneuver_decision_f1` meilleurs que `threshold_validation` sur `test_locked`, ou rapport explicite de non-amelioration.

## Rapport attendu

Chaque campagne produit un dossier de rapport contenant:

- `manifest-lock.json`
- `split-lock.json` si ESA est score
- `run-config.json`
- `metrics.json`
- `paired-deltas.json`
- `error-ledger.jsonl`
- `cases/` avec entrees, sorties, evidence references et decisions de scoring

Le resume humain doit tenir sur une page et dire: profil, lockfile, nombre de cas, baselines, principaux deltas, hallucinations bloquantes, cout total et conclusion. La conclusion doit pouvoir etre negative; un protocole production-grade doit rendre visible qu'un systeme n'est pas encore meilleur que sa baseline.
