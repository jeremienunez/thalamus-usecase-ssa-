import { describe, it, expect } from "vitest";
import {
  createSseClient,
  type EventSourceCtor,
  type SseClient,
} from "./client";

function makeFakeES() {
  const instances: FakeES[] = [];
  class FakeES {
    public onmessage: ((ev: MessageEvent) => void) | null = null;
    public onerror: (() => void) | null = null;
    public closed = false;
    public listeners = new Map<string, Array<(ev: MessageEvent) => void>>();
    constructor(public url: string) {
      instances.push(this);
    }
    addEventListener(type: string, listener: (ev: MessageEvent) => void) {
      const current = this.listeners.get(type) ?? [];
      current.push(listener);
      this.listeners.set(type, current);
    }
    removeEventListener(type: string, listener: (ev: MessageEvent) => void) {
      this.listeners.set(
        type,
        (this.listeners.get(type) ?? []).filter((candidate) => candidate !== listener),
      );
    }
    emit(type: string, data: string) {
      for (const listener of this.listeners.get(type) ?? []) {
        listener(new MessageEvent(type, { data }));
      }
    }
    close() {
      this.closed = true;
    }
  }
  return { FakeES: FakeES as EventSourceCtor, instances };
}

describe("createSseClient", () => {
  it("opens an EventSource, dispatches messages, closes on unsubscribe", () => {
    const { FakeES, instances } = makeFakeES();
    const client: SseClient = createSseClient({ EventSource: FakeES });
    const received: string[] = [];
    const sub = client.subscribe("/api/stream", {
      onMessage: (d) => received.push(d),
    });
    expect(instances.length).toBe(1);
    expect(instances[0].url).toBe("/api/stream");
    instances[0].onmessage?.(new MessageEvent("message", { data: "hello" }));
    instances[0].onmessage?.(new MessageEvent("message", { data: "world" }));
    expect(received).toEqual(["hello", "world"]);
    sub.close();
    expect(instances[0].closed).toBe(true);
  });

  it("forwards errors when onError handler provided", () => {
    const { FakeES, instances } = makeFakeES();
    const client = createSseClient({ EventSource: FakeES });
    let errored = false;
    client.subscribe("/api/x", {
      onMessage: () => {},
      onError: () => {
        errored = true;
      },
    });
    instances[0].onerror?.();
    expect(errored).toBe(true);
  });

  it("subscribes to named server-sent events and removes listeners on close", () => {
    const { FakeES, instances } = makeFakeES();
    const client = createSseClient({ EventSource: FakeES });
    const received: string[] = [];
    const sub = client.subscribeEvents("/api/sim/operator/swarms/1/events", {
      events: {
        status: (data) => received.push(`status:${data}`),
        aggregate: (data) => received.push(`aggregate:${data}`),
      },
    });

    instances[0].emit("status", '{"status":"running"}');
    instances[0].emit("aggregate", '{"clusters":[]}');
    expect(received).toEqual([
      'status:{"status":"running"}',
      'aggregate:{"clusters":[]}',
    ]);

    sub.close();
    instances[0].emit("status", '{"status":"done"}');
    expect(received).toHaveLength(2);
    expect(instances[0].closed).toBe(true);
  });
});
