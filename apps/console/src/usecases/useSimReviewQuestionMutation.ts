import { useMutation, useQueryClient } from "@tanstack/react-query";
import type { AskSimReviewQuestionRequest } from "@/adapters/api/sim-operator";
import { useApiClient } from "@/adapters/api/ApiClientContext";
import { qk } from "./keys";

export function useSimReviewQuestionMutation(swarmId: string | null) {
  const api = useApiClient();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: AskSimReviewQuestionRequest) => {
      if (swarmId === null) {
        throw new Error("swarmId is required before asking a sim review question");
      }
      return api.simOperator.askQuestion(swarmId, body);
    },
    onSuccess: () => {
      if (swarmId !== null) {
        void qc.invalidateQueries({ queryKey: qk.operatorReviewEvidence(swarmId) });
      }
    },
  });
}
