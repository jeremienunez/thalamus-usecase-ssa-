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
import { runTurn, type Fixtures } from "../repl";

export type TurnContext = Fixtures;

const EMPTY_CONTEXT: TurnContext = {
  satellites: [],
  kgNodes: [],
  kgEdges: [],
  findings: [],
};

export class ReplTurnService {
  /**
   * Run one REPL turn. Context is empty by default — this mirrors the
   * previous inline controller behaviour which used the fixture-backed
   * router regardless of the real DB state.
   */
  async handle(
    input: string,
    sessionId: string,
    context: TurnContext = EMPTY_CONTEXT,
  ): Promise<Awaited<ReturnType<typeof runTurn>>> {
    return runTurn(input, context, sessionId);
  }
}
