/**
 * IngestionSourceProvider — engine → pack.
 *
 * The pack registers its ingestion fetchers with the engine at boot.
 * Each fetcher becomes a BullMQ job kind; the IngestionRegistry (engine)
 * dispatches by name.
 *
 * The engine is DB-agnostic: `IngestionRunContext` carries only a logger
 * and optional abort signal. Fetchers that need a database handle or Redis
 * client capture them via closure at construction (factory pattern) —
 * console-api wires its ingesters with its own Drizzle instance.
 */

export interface IngestionRunContext {
  logger: {
    info: (obj: unknown, msg?: string) => void;
    warn: (obj: unknown, msg?: string) => void;
    error: (obj: unknown, msg?: string) => void;
  };
  signal?: AbortSignal;
}

export interface IngestionSource<TResult = unknown> {
  /**
   * Unique id used as BullMQ job name, scheduler key, and
   * IngestionRegistry.has/dispatch lookup key.
   */
  id: string;
  description?: string;
  /**
   * Optional cron expression. Informational — schedulers.ts owns the
   * authoritative cron configuration.
   */
  cron?: string;
  run(ctx: IngestionRunContext): Promise<TResult>;
}

export interface IngestionRegisterContext {
  add(source: IngestionSource): void;
}

export interface IngestionSourceProvider {
  register(ctx: IngestionRegisterContext): void;
}
