import type {
  OperatorSwarmStatusDto,
  SimFishTerminalDto,
  SwarmClustersDto,
} from "@/dto/http";
import type { SseClient, SseSubscription } from "./client";

export interface SimOperatorTerminalsEventDto {
  swarmId: string;
  count: number;
  terminals: SimFishTerminalDto[];
}

export type SimOperatorStreamEvent =
  | { event: "status"; data: OperatorSwarmStatusDto }
  | { event: "aggregate"; data: SwarmClustersDto }
  | { event: "terminals"; data: SimOperatorTerminalsEventDto }
  | { event: "done"; data: { swarmId: string; status: string } }
  | { event: "error"; data: { message: string } };

export function subscribeSimOperatorEvents(
  client: SseClient,
  swarmId: string,
  handlers: {
    onEvent: (event: SimOperatorStreamEvent) => void;
    onError?: () => void;
  },
): SseSubscription {
  const url = `/api/sim/operator/swarms/${encodeURIComponent(swarmId)}/events`;
  return client.subscribeEvents(url, {
    events: {
      status: (data) => emitParsed("status", data, handlers.onEvent),
      aggregate: (data) => emitParsed("aggregate", data, handlers.onEvent),
      terminals: (data) => emitParsed("terminals", data, handlers.onEvent),
      done: (data) => emitParsed("done", data, handlers.onEvent),
      error: (data) => emitParsed("error", data, handlers.onEvent),
    },
    onError: handlers.onError,
  });
}

function emitParsed(
  event: SimOperatorStreamEvent["event"],
  data: string,
  onEvent: (event: SimOperatorStreamEvent) => void,
): void {
  const parsed = parseJson(data);
  if (parsed === null) return;
  onEvent({ event, data: parsed } as SimOperatorStreamEvent);
}

function parseJson(data: string): Record<string, unknown> | null {
  try {
    const parsed = JSON.parse(data);
    return typeof parsed === "object" && parsed !== null && !Array.isArray(parsed)
      ? parsed
      : null;
  } catch {
    return null;
  }
}
