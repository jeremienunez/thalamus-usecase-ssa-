import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { postTurn, isSlashCommand } from "@/lib/repl";
import { postChatStream } from "@/lib/repl-stream";
import {
  newTurn,
  turnReducer,
  type Turn,
  type TurnAction,
} from "@/lib/replReducer";
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

  const finish = useCallback((id: string) => {
    inFlightRef.current.delete(id);
    setInFlight(inFlightRef.current.size);
  }, []);

  const start = useCallback((id: string, ctrl: AbortController) => {
    inFlightRef.current.set(id, ctrl);
    setInFlight(inFlightRef.current.size);
  }, []);

  const cancelTurn = useCallback(
    (id: string) => {
      const ctrl = inFlightRef.current.get(id);
      if (!ctrl) return;
      ctrl.abort();
      inFlightRef.current.delete(id);
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

  const value = useMemo<ReplCtx>(
    () => ({ open, setOpen, turns, inFlight, sendTurn, cancelTurn }),
    [open, turns, inFlight, sendTurn, cancelTurn],
  );
  return <ReplContext.Provider value={value}>{children}</ReplContext.Provider>;
}
