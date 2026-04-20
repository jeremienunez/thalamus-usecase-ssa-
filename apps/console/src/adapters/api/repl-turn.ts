import type { TurnResponse } from "@/types/repl-turn";

export async function postTurn(
  input: string,
  sessionId: string,
  signal?: AbortSignal,
): Promise<TurnResponse> {
  const response = await fetch("/api/repl/turn", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ input, sessionId }),
    signal,
  });
  if (!response.ok) throw new Error(`${response.status} ${response.statusText}`);
  return (await response.json()) as TurnResponse;
}
