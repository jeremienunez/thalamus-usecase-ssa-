# Brouillon de protocole HRM + statistiques pour eval sets

## Objectif

Mesurer si une approche HRM apporte un gain robuste sur des jeux d'evaluation de raisonnement structurel, en separant clairement:

- la performance brute sur taches completes;
- le gain par rapport a des baselines directes et agentiques;
- l'incertitude statistique sous budget limite;
- les limites d'interpretation quand les volumes restent faibles.

Le protocole doit produire des resultats comparables, reproductibles et assez simples pour etre executes avec des budgets de 25 USD, 50 USD ou 100 USD.

## Jeux d'evaluation

Inclure au minimum trois familles d'evals:

- `ARC-AGI-2`: puzzles de generalisation visuelle et symbolique. A traiter comme l'eval principale, car elle mesure l'adaptation hors distribution et penalise les heuristiques superficielles.
- `Sapient HRM Sudoku Extreme`: grilles Sudoku difficiles utilisees pour verifier la capacite de recherche contrainte et de raisonnement exact.
- `Sapient HRM Maze 30x30`: labyrinthes 30x30 utilises pour verifier la planification spatiale, la recherche de chemin et la robustesse aux instances longues.

Pour chaque famille, construire un manifeste fige listant:

- `task_id`;
- source et version du dataset;
- split utilise;
- seed de generation ou d'echantillonnage;
- format d'entree;
- format de sortie attendu;
- fonction de scoring exacte.

Ne pas melanger les resultats entre familles: presenter les scores par eval set, puis seulement ensuite une moyenne macro optionnelle.

## Systemes compares

Comparer HRM a deux types de baselines.

### Baselines directes

Une baseline directe recoit l'instance et produit une reponse en un seul appel ou une seule tentative, sans boucle externe de verification.

Exemples:

- modele texte seul, temperature basse, une tentative;
- modele multimodal direct pour ARC-AGI-2 si le format d'entree le requiert;
- solveur direct sans self-consistency;
- prompt standardise sans outils externes.

Cette baseline repond a la question: "HRM bat-il une prediction directe sous meme budget par instance ?"

### Baselines agentiques

Une baseline agentique peut utiliser une boucle explicite:

- decomposition;
- scratchpad ou plan intermediaire;
- auto-verification;
- retry;
- vote majoritaire;
- usage d'un solveur externe autorise, si HRM y a aussi acces ou si la comparaison est declaree comme outillee.

Cette baseline repond a la question: "HRM bat-il une approche agentique raisonnable, pas seulement un appel naif ?"

Chaque baseline doit declarer:

- nombre maximal d'appels par instance;
- budget maximal par instance;
- temperature et top-p;
- outils autorises;
- strategie de retry;
- critere d'arret;
- version exacte du modele.

## Appariement et seeds

Utiliser des seeds appairees pour reduire la variance:

- les memes `task_id` sont donnes a tous les systemes;
- les memes seeds d'echantillonnage selectionnent les subsets;
- les memes seeds de generation pilotent les variantes stochastiques quand le systeme le permet;
- pour `pass@k`, les `k` tentatives sont regroupees par `task_id` et comparees instance par instance.

Schema recommande:

- fixer `S = {0, 1, 2, 3, 4}` pour les petits budgets;
- pour chaque seed, tirer un subset stratifie par eval set;
- executer toutes les methodes sur le meme subset avant de passer a la seed suivante;
- stocker une ligne par `(eval_set, task_id, method, seed, attempt_id)`.

L'analyse principale doit etre appairee par `task_id`: comparer les differences de succes sur les memes instances, pas seulement les moyennes globales independantes.

## Metriques

### Exact accuracy

Pour chaque eval set:

```text
exact_accuracy = nombre_instances_resolues / nombre_instances_total
```

Une instance est resolue seulement si la sortie correspond exactement au format attendu et passe le scorer officiel ou local fige.

Pour ARC-AGI-2, ne pas attribuer de credit partiel dans l'analyse principale. Les credits partiels peuvent etre rapportes en annexe si le scorer les definit explicitement.

### Pass@k

Pour les methodes multi-tentatives:

```text
pass@k = proportion d'instances avec au moins une tentative correcte parmi k
```

Rapporter au minimum:

- `pass@1`, comparable a l'exact accuracy directe;
- `pass@3`, utile sous budget modere;
- `pass@5` si le budget le permet.

Toujours indiquer le cout total associe a `k`. Un `pass@5` plus haut mais cinq fois plus cher ne doit pas etre presente comme un gain gratuit.

### Cout et efficience

Rapporter:

- cout total en USD;
- cout moyen par instance;
- cout moyen par instance resolue;
- latence mediane par instance si disponible;
- nombre moyen d'appels par instance.

Une methode est plus interessante seulement si son gain statistique reste visible a budget comparable, ou si son cout par succes baisse.

## Intervalles de confiance bootstrap

Utiliser un bootstrap par instance, stratifie par eval set.

Procedure:

1. Pour chaque eval set, resampler les `task_id` avec remise.
2. Garder toutes les lignes associees a chaque `task_id` resample: methodes, seeds et tentatives.
3. Recalculer `exact_accuracy`, `pass@k` et les deltas appaires.
4. Repeter au moins `B = 5000` fois si le volume est faible; `B = 10000` si possible.
5. Rapporter l'intervalle percentile 95% pour chaque score et chaque delta.

Priorite de reporting:

- score absolu par methode;
- delta HRM moins baseline directe;
- delta HRM moins baseline agentique.

Si les subsets sont tres petits, indiquer explicitement que l'intervalle bootstrap est descriptif et non une garantie forte de generalisation.

## Sign-test appaire

Utiliser un sign-test sur les differences par instance pour tester la direction du gain.

Pour chaque paire `(HRM, baseline)`:

- `win`: HRM correct, baseline incorrect;
- `loss`: HRM incorrect, baseline correct;
- `tie`: les deux corrects ou les deux incorrects.

Ignorer les ties dans le test principal. Sous l'hypothese nulle, wins et losses sont equiprobables.

Rapporter:

- `wins`;
- `losses`;
- `ties`;
- p-value bilaterale;
- p-value unilaterale seulement si l'hypothese directionnelle a ete declaree avant l'execution;
- delta d'exact accuracy avec IC bootstrap 95%.

Ne pas conclure a un gain robuste uniquement sur une p-value. Exiger aussi un effet pratique minimal, par exemple `+3` a `+5` points selon la taille du subset et le cout.

## Analyse par eval set

### ARC-AGI-2

Analyse principale:

- `exact_accuracy`;
- `pass@3` si plusieurs tentatives sont autorisees;
- delta HRM vs baseline directe;
- delta HRM vs baseline agentique;
- sign-test appaire par `task_id`.

Points de controle:

- verifier que les prompts ne contiennent pas d'exemples de test;
- separer les erreurs de format des erreurs de raisonnement;
- inspecter manuellement un petit echantillon d'echecs pour detecter les sorties non parseables.

### Sapient HRM Sudoku Extreme

Analyse principale:

- exactitude de grille complete;
- nombre de grilles resolues;
- taux de sorties invalides;
- cout par grille resolue.

Points de controle:

- verifier chaque grille avec un validateur Sudoku deterministe;
- distinguer solution incorrecte et solution non conforme;
- ne pas donner de credit partiel pour des cases correctes dans le score principal.

### Sapient HRM Maze 30x30

Analyse principale:

- chemin valide oui/non;
- optimalite optionnelle si une distance optimale est connue;
- taux de chemins invalides;
- cout par labyrinthe resolu.

Points de controle:

- valider que le chemin reste dans la grille;
- valider qu'il ne traverse pas de murs;
- valider qu'il relie depart et arrivee;
- rapporter separement "chemin valide" et "chemin optimal" si les deux sont mesures.

## Format minimal des donnees

Chaque tentative doit produire une ligne structuree:

```text
eval_set,task_id,method,seed,attempt_id,k,correct,valid_output,cost_usd,latency_ms,raw_output_path,scorer_version
```

Chaque run doit aussi avoir un manifeste:

```text
run_id,started_at,git_sha,model,method_config_path,dataset_manifest_path,budget_usd,total_cost_usd
```

Les sorties brutes doivent etre conservees pour audit, mais les statistiques doivent partir des fichiers scores figes, pas d'une relecture manuelle.

## Plan minimal par budget

### Budget 25 USD

Objectif: obtenir un signal directionnel, pas une conclusion forte.

- Eval sets: ARC-AGI-2 prioritaire, puis un petit echantillon Sudoku Extreme et Maze 30x30.
- Methodes: HRM, baseline directe, une baseline agentique legere.
- Seeds: `S = {0, 1, 2}`.
- Tentatives: `pass@1` obligatoire, `pass@3` seulement sur ARC-AGI-2 si le cout le permet.
- Taille cible: environ 20 a 40 instances ARC-AGI-2, 10 Sudoku, 10 Maze.
- Stats: exact accuracy, pass@k disponible, delta appaire, bootstrap 95%, sign-test descriptif.

Conclusion autorisee: "signal preliminaire favorable/defavorable". Pas de claim de superiorite generale.

### Budget 50 USD

Objectif: comparer serieusement HRM aux deux familles de baseline sur un subset encore modeste.

- Eval sets: les trois familles incluses.
- Methodes: HRM, baseline directe, baseline agentique.
- Seeds: `S = {0, 1, 2, 3, 4}`.
- Tentatives: `pass@1` et `pass@3` pour toutes les methodes compatibles.
- Taille cible: environ 50 a 80 instances ARC-AGI-2, 20 Sudoku, 20 Maze.
- Stats: bootstrap stratifie 95%, sign-test appaire HRM vs chaque baseline, cout par succes.

Conclusion autorisee: "gain observe sur ce protocole budgete" si le delta est positif, l'IC n'est pas trop large, et les wins depassent clairement les losses.

### Budget 100 USD

Objectif: produire le premier tableau defendable pour decision interne.

- Eval sets: couverture plus large des trois familles.
- Methodes: HRM, baseline directe, baseline agentique, et variante HRM ablatee si disponible.
- Seeds: `S = {0, 1, 2, 3, 4}` au minimum; ajouter `5-9` si le cout par tentative est bas.
- Tentatives: `pass@1`, `pass@3`, `pass@5`.
- Taille cible: environ 100 a 150 instances ARC-AGI-2, 40 Sudoku, 40 Maze.
- Stats: bootstrap 10000 repetitions, sign-test appaire, analyse par cout, analyse des sorties invalides.

Conclusion autorisee: "evidence interne moderee" si HRM bat la baseline agentique sur au moins deux eval sets, avec delta pratique positif et cout par succes acceptable.

## Limites d'interpretation

Ce protocole ne prouve pas une capacite generale de raisonnement. Il mesure une performance sur trois familles de taches, sous prompts, budgets, seeds et scorers fixes.

Limites principales:

- les petits subsets donnent des intervalles larges;
- ARC-AGI-2 peut etre sensible au format de representation;
- Sudoku Extreme et Maze 30x30 peuvent favoriser des routines specialisees;
- `pass@k` melange competence et depense de budget;
- les baselines agentiques peuvent etre sous-optimisees ou sur-optimisees;
- les resultats peuvent changer avec une nouvelle version de modele;
- le sign-test ignore l'amplitude de difficulte entre instances;
- le bootstrap suppose que le subset represente raisonnablement la population cible.

Toute communication externe doit inclure:

- taille exacte des subsets;
- cout total;
- configuration des baselines;
- IC bootstrap;
- resultats par eval set;
- date et version des modeles;
- mention claire que les resultats sont budgetes et non exhaustifs.

## Tableau de sortie recommande

```text
eval_set | method | n | pass@1 | pass@3 | pass@5 | cost_usd | cost_per_success | invalid_rate
```

Pour les comparaisons:

```text
eval_set | comparison | delta_pass@1 | ci95_low | ci95_high | wins | losses | ties | sign_p_value
```

La lecture principale doit commencer par HRM vs baseline agentique. HRM vs baseline directe reste utile, mais moins probant si la baseline directe est trop faible.
