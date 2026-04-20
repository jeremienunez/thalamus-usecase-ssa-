import type { ReplFollowUpPlanItem } from "@interview/shared";
import { postTurn } from "@/adapters/api/repl-turn";
import { postChatStream, postFollowUpStream } from "@/adapters/sse/repl";
import type { TurnAction } from "@/features/repl/reducer";
import { isSlashCommand } from "@/usecases/repl-command";

type TurnDispatch = (id: string, action: TurnAction) => void;

export async function executeTurnRequest(args: {
  turnId: string;
  input: string;
  sessionId: string;
  signal: AbortSignal;
  dispatch: TurnDispatch;
}): Promise<void> {
  const trimmed = args.input.trim();
  if (isSlashCommand(trimmed)) {
    const response = await postTurn(trimmed, args.sessionId, args.signal);
    args.dispatch(args.turnId, { type: "slash.done", response });
    return;
  }

  await postChatStream(
    trimmed,
    (event) => args.dispatch(args.turnId, { type: "stream", event }),
    args.signal,
  );
}

export async function executeFollowUpRequest(args: {
  turnId: string;
  query: string;
  parentCycleId: string;
  item: ReplFollowUpPlanItem;
  signal: AbortSignal;
  dispatch: TurnDispatch;
}): Promise<void> {
  await postFollowUpStream(
    {
      query: args.query,
      parentCycleId: args.parentCycleId,
      item: args.item,
    },
    (event) => args.dispatch(args.turnId, { type: "stream", event }),
    args.signal,
  );
}
