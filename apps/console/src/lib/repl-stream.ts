import type { ReplStreamEvent } from "@interview/shared";

export type StreamHandler = (evt: ReplStreamEvent) => void;

/**
 * POST JSON to /api/repl/chat, parse the SSE stream, invoke `onEvent` for
 * each message. Resolves when the server closes the connection (after
 * `done` or `error`). Throws on non-2xx or network failure.
 */
export async function postChatStream(
  input: string,
  onEvent: StreamHandler,
  signal?: AbortSignal,
): Promise<void> {
  const res = await fetch("/api/repl/chat", {
    method: "POST",
    headers: { "content-type": "application/json", accept: "text/event-stream" },
    body: JSON.stringify({ input }),
    signal,
  });
  if (!res.ok || !res.body) throw new Error(`${res.status} ${res.statusText}`);

  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buf = "";

  while (true) {
    const { value, done } = await reader.read();
    if (done) break;
    buf += decoder.decode(value, { stream: true });

    // SSE messages are separated by a blank line ("\n\n").
    let sep: number;
    while ((sep = buf.indexOf("\n\n")) !== -1) {
      const raw = buf.slice(0, sep);
      buf = buf.slice(sep + 2);
      const parsed = parseSseMessage(raw);
      if (parsed) onEvent(parsed);
    }
  }
}

function parseSseMessage(raw: string): ReplStreamEvent | null {
  let event = "";
  let data = "";
  for (const line of raw.split("\n")) {
    if (line.startsWith("event:")) event = line.slice(6).trim();
    else if (line.startsWith("data:")) data += line.slice(5).trim();
  }
  if (!event || !data) return null;
  try {
    return { event, data: JSON.parse(data) } as ReplStreamEvent;
  } catch {
    return null;
  }
}
