import type { ReplFollowUpPlanItem, ReplStreamEvent } from "@interview/shared";

export type StreamHandler = (evt: ReplStreamEvent) => void;

/**
 * POST JSON to /api/repl/chat, parse the SSE stream, invoke `onEvent` for
 * each message. Resolves when the server closes or the signal aborts.
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

  try {
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      buf += decoder.decode(value, { stream: true });

      // SSE messages are separated by a blank line; tolerate \n\n and \r\n\r\n.
      let sep: number;
      // eslint-disable-next-line no-cond-assign
      while ((sep = nextMessageBoundary(buf)) !== -1) {
        const raw = buf.slice(0, sep);
        buf = buf.slice(sep + (buf[sep] === "\r" ? 4 : 2));
        const parsed = parseSseMessage(raw);
        if (parsed) onEvent(parsed);
      }
    }
    const tail = parseSseMessage(buf);
    if (tail) onEvent(tail);
  } finally {
    try {
      reader.releaseLock();
    } catch {
      /* already released */
    }
  }
}

export async function postFollowUpStream(
  input: {
    query: string;
    parentCycleId: string;
    item: ReplFollowUpPlanItem;
  },
  onEvent: StreamHandler,
  signal?: AbortSignal,
): Promise<void> {
  const res = await fetch("/api/repl/followups/run", {
    method: "POST",
    headers: { "content-type": "application/json", accept: "text/event-stream" },
    body: JSON.stringify(input),
    signal,
  });
  if (!res.ok || !res.body) throw new Error(`${res.status} ${res.statusText}`);

  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buf = "";

  try {
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      buf += decoder.decode(value, { stream: true });

      let sep: number;
      while ((sep = nextMessageBoundary(buf)) !== -1) {
        const raw = buf.slice(0, sep);
        buf = buf.slice(sep + (buf[sep] === "\r" ? 4 : 2));
        const parsed = parseSseMessage(raw);
        if (parsed) onEvent(parsed);
      }
    }
    const tail = parseSseMessage(buf);
    if (tail) onEvent(tail);
  } finally {
    try {
      reader.releaseLock();
    } catch {
      /* already released */
    }
  }
}

function nextMessageBoundary(buf: string): number {
  const a = buf.indexOf("\n\n");
  const b = buf.indexOf("\r\n\r\n");
  if (a === -1) return b;
  if (b === -1) return a;
  return Math.min(a, b);
}

function stripField(line: string, field: string): string {
  let v = line.slice(field.length);
  if (v.startsWith(" ")) v = v.slice(1);
  return v;
}

function parseSseMessage(raw: string): ReplStreamEvent | null {
  if (!raw) return null;
  let event = "";
  const dataLines: string[] = [];
  for (const line of raw.split(/\r?\n/)) {
    if (!line || line.startsWith(":")) continue; // comment/heartbeat
    if (line.startsWith("event:")) event = stripField(line, "event:").trim();
    else if (line.startsWith("data:")) dataLines.push(stripField(line, "data:"));
    // id:/retry: intentionally ignored
  }
  if (!event || dataLines.length === 0) return null;
  const data = dataLines.join("\n");
  try {
    return { event, data: JSON.parse(data) } as ReplStreamEvent;
  } catch {
    return null;
  }
}
