import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import type { ReplFollowUpPlanItem } from "@interview/shared";
import { postTurn, isSlashCommand } from "@/features/repl/types";
import { postChatStream, postFollowUpStream } from "@/adapters/sse/repl";
import {
  newTurn,
  turnReducer,
  type Turn,
  type TurnAction,
} from "@/features/repl/reducer";
import { ReplContext, type ReplCtx } from "./ReplContext";

export function ReplProvider({ children }: { children: ReactNode }) {
  const [turns, setTurns] = useState<Turn[]>([]);
  const [open, setOpen] = useState(false);
  const inFlightRef = useRef<Map<string, AbortController>>(new Map());
  const [inFlight, setInFlight] = useState(0);
  const sessionIdRef = useRef<string>(`sess-${Math.random().toString(36).slice(2, 9)}`);

  useEffect(() => {
    return () => {
      for (const ctrl of inFlightRef.current.values()) ctrl.abort();
      inFlightRef.current.clear();
    };
  }, []);

  const dispatch = useCallback((id: string, action: TurnAction) => {
    setTurns((ts) => ts.map((t) => (t.id === id ? turnReducer(t, action) : t)));
  }, []);

  const finish = useCallback((key: string) => {
    inFlightRef.current.delete(key);
    setInFlight(inFlightRef.current.size);
  }, []);

  const start = useCallback((key: string, ctrl: AbortController) => {
    inFlightRef.current.set(key, ctrl);
    setInFlight(inFlightRef.current.size);
  }, []);

  const cancelTurn = useCallback(
    (id: string) => {
      let aborted = false;
      for (const [key, ctrl] of inFlightRef.current.entries()) {
        if (key === id || key.startsWith(`${id}:`)) {
          ctrl.abort();
          inFlightRef.current.delete(key);
          aborted = true;
        }
      }
      if (!aborted) return;
      setInFlight(inFlightRef.current.size);
      dispatch(id, { type: "fail", error: "cancelled" });
    },
    [dispatch],
  );

  const sendTurn = useCallback(
    (input: string) => {
      const trimmed = input.trim();
      if (!trimmed) return;
      const id = `t-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
      const ctrl = new AbortController();
      setTurns((t) => [...t, newTurn(id, trimmed)]);
      setOpen(true);
      start(id, ctrl);

      if (isSlashCommand(trimmed)) {
        postTurn(trimmed, sessionIdRef.current, ctrl.signal)
          .then((response) => dispatch(id, { type: "slash.done", response }))
          .catch((err: unknown) => {
            if (ctrl.signal.aborted) return;
            const msg = err instanceof Error ? err.message : String(err);
            dispatch(id, { type: "fail", error: msg });
          })
          .finally(() => finish(id));
        return;
      }

      postChatStream(
        trimmed,
        (evt) => dispatch(id, { type: "stream", event: evt }),
        ctrl.signal,
      )
        .catch((err: unknown) => {
          if (ctrl.signal.aborted) return;
          const msg = err instanceof Error ? err.message : String(err);
          dispatch(id, { type: "fail", error: msg });
        })
        .finally(() => finish(id));
    },
    [dispatch, start, finish],
  );

  const runFollowUp = useCallback(
    (
      turnId: string,
      query: string,
      parentCycleId: string,
      item: ReplFollowUpPlanItem,
    ) => {
      const ctrl = new AbortController();
      const key = `${turnId}:${item.followupId}`;
      start(key, ctrl);
      setOpen(true);

      postFollowUpStream(
        { query, parentCycleId, item },
        (evt) => dispatch(turnId, { type: "stream", event: evt }),
        ctrl.signal,
      )
        .catch((err: unknown) => {
          if (ctrl.signal.aborted) return;
          const msg = err instanceof Error ? err.message : String(err);
          dispatch(turnId, { type: "fail", error: msg });
        })
        .finally(() => finish(key));
    },
    [dispatch, finish, start],
  );

  const value = useMemo<ReplCtx>(
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
  return <ReplContext.Provider value={value}>{children}</ReplContext.Provider>;
}
