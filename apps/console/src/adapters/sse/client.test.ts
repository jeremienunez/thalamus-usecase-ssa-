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
    constructor(public url: string) {
      instances.push(this);
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
});
