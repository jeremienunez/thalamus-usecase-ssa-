import type { Database } from "@interview/db-schema";
import type { IngestionRunContext } from "@interview/sweep";
import { stubLogger } from "@interview/test-kit";

interface MutationOutcome {
  rowCount?: number;
  error?: unknown;
}

interface ExecuteOutcome {
  rows?: Record<string, unknown>[];
  rowCount?: number;
  error?: unknown;
}

export interface InsertCall {
  table: unknown;
  values: unknown;
  mode: "update" | "nothing";
  options: unknown;
}

export interface UpdateCall {
  table: unknown;
  values: unknown;
  where: unknown;
}

export function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

export function textResponse(body: string, status = 200): Response {
  return new Response(body, {
    status,
    headers: { "content-type": "text/plain" },
  });
}

export function makeRunContext() {
  const logger = stubLogger();
  return {
    ctx: {
      logger: {
        info: logger.info,
        warn: logger.warn,
        error: logger.error,
      },
    } satisfies IngestionRunContext,
    logger,
  };
}

export function makeDbDouble(opts: {
  insertOutcomes?: MutationOutcome[];
  updateOutcomes?: MutationOutcome[];
  executeOutcomes?: ExecuteOutcome[];
} = {}) {
  const insertCalls: InsertCall[] = [];
  const updateCalls: UpdateCall[] = [];
  const executeCalls: unknown[] = [];
  let insertIndex = 0;
  let updateIndex = 0;
  let executeIndex = 0;

  function nextInsertOutcome(): { rowCount?: number } {
    const outcome = opts.insertOutcomes?.[insertIndex++] ?? { rowCount: 1 };
    if (outcome.error !== undefined) throw outcome.error;
    return { rowCount: outcome.rowCount };
  }

  function nextUpdateOutcome(): { rowCount?: number } {
    const outcome = opts.updateOutcomes?.[updateIndex++] ?? { rowCount: 0 };
    if (outcome.error !== undefined) throw outcome.error;
    return { rowCount: outcome.rowCount };
  }

  function nextExecuteOutcome(): { rows?: Record<string, unknown>[]; rowCount?: number } {
    const outcome = opts.executeOutcomes?.[executeIndex++] ?? {
      rows: [],
      rowCount: 0,
    };
    if (outcome.error !== undefined) throw outcome.error;
    return {
      ...(outcome.rows === undefined ? {} : { rows: outcome.rows }),
      rowCount: outcome.rowCount,
    };
  }

  const db = {
    insert(table: unknown) {
      return {
        values(values: unknown) {
          return {
            async onConflictDoUpdate(options: unknown) {
              insertCalls.push({ table, values, mode: "update", options });
              return nextInsertOutcome();
            },
            async onConflictDoNothing(options: unknown) {
              insertCalls.push({ table, values, mode: "nothing", options });
              return nextInsertOutcome();
            },
          };
        },
      };
    },
    update(table: unknown) {
      return {
        set(values: unknown) {
          return {
            async where(where: unknown) {
              updateCalls.push({ table, values, where });
              return nextUpdateOutcome();
            },
          };
        },
      };
    },
    async execute(query: unknown) {
      executeCalls.push(query);
      return nextExecuteOutcome();
    },
  } as Database;

  return { db, insertCalls, updateCalls, executeCalls };
}
