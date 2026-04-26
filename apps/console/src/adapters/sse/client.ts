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
  subscribeEvents(
    url: string,
    handlers: {
      events: Record<string, (data: string) => void>;
      onError?: () => void;
    },
  ): SseSubscription;
}

export interface CreateSseClientOpts {
  EventSource?: EventSourceCtor;
}

export interface EventSourceLike {
  onmessage: ((ev: MessageEvent) => void) | null;
  onerror: (() => void) | null;
  addEventListener?: (type: string, listener: (ev: MessageEvent) => void) => void;
  removeEventListener?: (
    type: string,
    listener: (ev: MessageEvent) => void,
  ) => void;
  close(): void;
}

export type EventSourceCtor = new (url: string) => EventSourceLike;

export function createSseClient(opts: CreateSseClientOpts = {}): SseClient {
  const ES = opts.EventSource ?? globalThis.EventSource;
  return {
    subscribe(url, { onMessage, onError }) {
      const es = new ES(url);
      es.onmessage = (ev: MessageEvent) => onMessage(String(ev.data));
      if (onError) es.onerror = () => onError();
      return { close: () => es.close() };
    },
    subscribeEvents(url, { events, onError }) {
      const es = new ES(url);
      const listeners = Object.entries(events).map(([event, handler]) => {
        const listener = (ev: MessageEvent) => handler(String(ev.data));
        es.addEventListener?.(event, listener);
        return { event, listener };
      });
      if (onError) es.onerror = () => onError();
      return {
        close: () => {
          for (const { event, listener } of listeners) {
            es.removeEventListener?.(event, listener);
          }
          es.close();
        },
      };
    },
  };
}
