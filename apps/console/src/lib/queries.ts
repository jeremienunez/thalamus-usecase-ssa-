/** Legacy shim. Consume usecases/* directly. Phase 7 deletes this file. */
export { useSatellitesQuery as useSatellites } from "@/usecases/useSatellitesQuery";
export { useConjunctionsQuery as useConjunctions } from "@/usecases/useConjunctionsQuery";
export { useKgQuery as useKg } from "@/usecases/useKgQuery";
export { useFindingsQuery as useFindings } from "@/usecases/useFindingsQuery";
export { useFindingQuery as useFinding } from "@/usecases/useFindingQuery";
export { useStatsQuery as useStats } from "@/usecases/useStatsQuery";
export { useDecisionMutation as useDecision } from "@/usecases/useDecisionMutation";
export { useSweepSuggestionsQuery as useSweepSuggestions } from "@/usecases/useSweepSuggestionsQuery";
export { useReviewSuggestionMutation as useReviewSuggestion } from "@/usecases/useReviewSuggestionMutation";
export { useMissionStatusQuery as useMissionStatus } from "@/usecases/useMissionStatusQuery";
export {
  useMissionStartMutation as useMissionStart,
  useMissionStopMutation as useMissionStop,
} from "@/usecases/useMissionControlMutations";
export { useAutonomyStatusQuery as useAutonomyStatus } from "@/usecases/useAutonomyStatusQuery";
export {
  useAutonomyStartMutation as useAutonomyStart,
  useAutonomyStopMutation as useAutonomyStop,
} from "@/usecases/useAutonomyControlMutations";
export { useCyclesQuery as useCycles } from "@/usecases/useCyclesQuery";
export { useLaunchCycleMutation as useLaunchCycle } from "@/usecases/useLaunchCycleMutation";
export { qk } from "@/usecases/keys";
