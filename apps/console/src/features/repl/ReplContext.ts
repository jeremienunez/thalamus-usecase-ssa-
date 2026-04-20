import { createContext, useContext } from "react";
import type { ReplFollowUpPlanItem } from "@interview/shared";
import type { Turn } from "@/features/repl/reducer";

export type ReplCtx = {
  open: boolean;
  setOpen: (v: boolean) => void;
  turns: Turn[];
  inFlight: number;
  sendTurn: (input: string) => void;
  runFollowUp: (
    turnId: string,
    query: string,
    parentCycleId: string,
    item: ReplFollowUpPlanItem,
  ) => void;
  cancelTurn: (id: string) => void;
};

export const ReplContext = createContext<ReplCtx | null>(null);

export function useRepl(): ReplCtx {
  const v = useContext(ReplContext);
  if (!v) throw new Error("useRepl must be used inside <ReplProvider>");
  return v;
}
