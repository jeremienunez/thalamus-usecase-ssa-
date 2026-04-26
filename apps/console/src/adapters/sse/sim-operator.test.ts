import { describe, expect, it, vi } from "vitest";
import type { SseClient } from "./client";
import { subscribeSimOperatorEvents } from "./sim-operator";

describe("subscribeSimOperatorEvents", () => {
  it("subscribes to the named operator event stream and parses event payloads", () => {
    const eventHandlers: Record<string, (data: string) => void> = {};
    const client: SseClient = {
      subscribe: vi.fn(),
      subscribeEvents: vi.fn((_url, handlers) => {
        Object.assign(eventHandlers, handlers.events);
        return { close: vi.fn() };
      }),
    };
    const onEvent = vi.fn();

    subscribeSimOperatorEvents(client, "swarm/1", { onEvent });

    expect(client.subscribeEvents).toHaveBeenCalledWith(
      "/api/sim/operator/swarms/swarm%2F1/events",
      expect.objectContaining({
        events: expect.objectContaining({
          status: expect.any(Function),
          aggregate: expect.any(Function),
          terminals: expect.any(Function),
          done: expect.any(Function),
          error: expect.any(Function),
        }),
      }),
    );

    eventHandlers.status?.('{"swarmId":"1","status":"running"}');
    eventHandlers.aggregate?.('{"swarmId":"1","clusters":[{"label":"hold"}]}');
    eventHandlers.terminals?.(
      '{"swarmId":"1","count":1,"terminals":[{"fishIndex":0,"runStatus":"done"}]}',
    );
    eventHandlers.done?.('{"swarmId":"1","status":"done"}');
    eventHandlers.error?.('{"message":"stream failed"}');
    eventHandlers.status?.("not json");

    expect(onEvent).toHaveBeenCalledTimes(5);
    expect(onEvent).toHaveBeenNthCalledWith(1, {
      event: "status",
      data: { swarmId: "1", status: "running" },
    });
    expect(onEvent).toHaveBeenNthCalledWith(2, {
      event: "aggregate",
      data: { swarmId: "1", clusters: [{ label: "hold" }] },
    });
    expect(onEvent).toHaveBeenNthCalledWith(5, {
      event: "error",
      data: { message: "stream failed" },
    });
  });
});
