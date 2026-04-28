# Audit Questions For GPT-5.5 Pro

## Primary Verdict

1. Given the hardened run results, is the THL predictive hypothesis falsified on Kelvins?
2. Is it fair to say THL extracts temporal motifs but does not provide predictive value over simple baselines here?
3. Are there any signs in the selected patterns that indicate useful temporal structure, or mostly static/categorical shortcuts?

## Protocol Review

4. Is `event_id_grouped_outcome_stratified_hash_no_row_leakage` sufficient for this dataset?
5. Is the bootstrap F1 lift CI an acceptable first guard against point-estimate conclusions?
6. Should the protocol require multiple split seeds before any `survived` verdict?
7. Should `minLeadTimeDays` default be changed from `0` to a positive value for all real predictive claims?
8. Should high-risk default runs be considered contaminated because risk threshold features are derived from the same signal family as the label?

## Baseline Review

9. Are the current baselines too weak, despite beating THL?
10. Which baselines should be added before final publication?
11. Should we add a last-observation baseline, logistic regression, small decision tree, or calibrated threshold model?
12. Should baseline selection be per target outcome and per feature family?

## Modeling Review

13. Is temporal episode mining the wrong shape for Kelvins final classification?
14. Would a time-to-TCA-aware representation be more appropriate than synthetic event timestamps?
15. Should THL score lead-time utility instead of final classification F1?
16. Should episodes be constrained by physical variable families rather than generic event signatures?
17. Is `physics_only` the better scientific test even if it scores lower?

## Product Decision

18. Should THL remain experimental only?
19. Should it be integrated only as a reviewable hypothesis miner for Sweep?
20. Should it be used to seed Fish branches, but not exposed as predictive evidence?
21. What result would be strong enough to justify product integration?

## Recommended Challenge To The Current Conclusion

Please actively look for ways the negative conclusion could be wrong:

- Did the hardened split accidentally disadvantage THL?
- Did the `pattern_window_ms` matching change unfairly penalize episodes?
- Is F1 the wrong metric for this use case?
- Could precision at low recall be more valuable than F1?
- Are selected patterns with low F1 still operationally useful as investigation triggers?

