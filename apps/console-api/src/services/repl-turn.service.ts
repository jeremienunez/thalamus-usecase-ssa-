// apps/console-api/src/services/repl-turn.service.ts
/**
 * Service wrapper around the legacy REPL `runTurn` from src/repl.
 *
 * The REPL turn engine is a deterministic fixture-backed router originally
 * designed for the CLI. The console-api exposes it at POST /api/repl/turn so
 * the console front-end can drive the same flow. Wrapping it in a service
 * keeps the controller thin and opens the door to injecting alt routers
 * (real KG/finding data) in the future without touching the route handler.
 */
import { buildFixtures } from "../fixtures";
import { runTurn, type Fixtures } from "../repl";

export type TurnContext = Fixtures;

export class ReplTurnService {
  /**
   * Run one REPL turn. When callers don't provide a context, the service
   * materialises the deterministic demo fixtures expected by `runTurn`.
   * This keeps /api/repl/turn usable for accept/explain/telemetry routes
   * instead of passing an empty context that would miss every entity.
   */
  async handle(
    input: string,
    sessionId: string,
    context?: TurnContext,
  ): Promise<Awaited<ReturnType<typeof runTurn>>> {
    return runTurn(input, context ?? buildFixtures(), sessionId);
  }
}
