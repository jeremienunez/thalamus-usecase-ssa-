import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import type { ReplFollowUpPlanItem } from "@interview/shared";
import { executeFollowUpRequest, executeTurnRequest } from "@/usecases/repl-execution";
import {
  belongsToTurnRequest,
  createReplSessionId,
  createReplTurnId,
  followUpRequestKey,
} from "@/usecases/repl-session";
import {
  newTurn,
  turnReducer,
  type Turn,
  type TurnAction,
} from "@/features/repl/reducer";
import type { ReplCtx } from "./ReplContext";

export function useReplRuntime(): ReplCtx {
  const [turns, setTurns] = useState<Turn[]>([]);
  const [open, setOpen] = useState(false);
  const inFlightRef = useRef<Map<string, AbortController>>(new Map());
  const [inFlight, setInFlight] = useState(0);
  const sessionIdRef = useRef<string>(createReplSessionId());

  useEffect(() => {
    return () => {
      for (const controller of inFlightRef.current.values()) controller.abort();
      inFlightRef.current.clear();
    };
  }, []);

  const dispatch = useCallback((id: string, action: TurnAction) => {
    setTurns((current) => current.map((turn) => (turn.id === id ? turnReducer(turn, action) : turn)));
  }, []);

  const start = useCallback((key: string, controller: AbortController) => {
    inFlightRef.current.set(key, controller);
    setInFlight(inFlightRef.current.size);
  }, []);

  const finish = useCallback((key: string) => {
    inFlightRef.current.delete(key);
    setInFlight(inFlightRef.current.size);
  }, []);

  const cancelTurn = useCallback(
    (turnId: string) => {
      let aborted = false;
      for (const [key, controller] of inFlightRef.current.entries()) {
        if (!belongsToTurnRequest(key, turnId)) continue;
        controller.abort();
        inFlightRef.current.delete(key);
        aborted = true;
      }
      if (!aborted) return;
      setInFlight(inFlightRef.current.size);
      dispatch(turnId, { type: "fail", error: "cancelled" });
    },
    [dispatch],
  );

  const sendTurn = useCallback(
    (input: string) => {
      const trimmed = input.trim();
      if (!trimmed) return;
      const turnId = createReplTurnId();
      const controller = new AbortController();
      setTurns((current) => [...current, newTurn(turnId, trimmed)]);
      setOpen(true);
      start(turnId, controller);

      executeTurnRequest({
        turnId,
        input: trimmed,
        sessionId: sessionIdRef.current,
        signal: controller.signal,
        dispatch,
      })
        .catch((error: unknown) => {
          if (controller.signal.aborted) return;
          const message = error instanceof Error ? error.message : String(error);
          dispatch(turnId, { type: "fail", error: message });
        })
        .finally(() => finish(turnId));
    },
    [dispatch, finish, start],
  );

  const runFollowUp = useCallback(
    (turnId: string, query: string, parentCycleId: string, item: ReplFollowUpPlanItem) => {
      const controller = new AbortController();
      const key = followUpRequestKey(turnId, item.followupId);
      start(key, controller);
      setOpen(true);

      executeFollowUpRequest({
        turnId,
        query,
        parentCycleId,
        item,
        signal: controller.signal,
        dispatch,
      })
        .catch((error: unknown) => {
          if (controller.signal.aborted) return;
          const message = error instanceof Error ? error.message : String(error);
          dispatch(turnId, { type: "fail", error: message });
        })
        .finally(() => finish(key));
    },
    [dispatch, finish, start],
  );

  return useMemo(
    () => ({
      open,
      setOpen,
      turns,
      inFlight,
      sendTurn,
      runFollowUp,
      cancelTurn,
    }),
    [open, turns, inFlight, sendTurn, runFollowUp, cancelTurn],
  );
}
