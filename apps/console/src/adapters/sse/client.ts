export interface SseSubscription {
  close(): void;
}

export interface SseClient {
  subscribe(
    url: string,
    handlers: {
      onMessage: (data: string) => void;
      onError?: () => void;
    },
  ): SseSubscription;
}

export interface CreateSseClientOpts {
  EventSource?: typeof EventSource;
}

export function createSseClient(opts: CreateSseClientOpts = {}): SseClient {
  const ES = opts.EventSource ?? globalThis.EventSource;
  return {
    subscribe(url, { onMessage, onError }) {
      const es = new ES(url);
      es.onmessage = (ev: MessageEvent) => onMessage(String(ev.data));
      if (onError) es.onerror = () => onError();
      return { close: () => es.close() };
    },
  };
}
