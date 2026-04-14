import {
  pgTable,
  bigserial,
  text,
  timestamp,
  jsonb,
  real,
  integer,
  index,
} from "drizzle-orm/pg-core";

/**
 * Exploration log — curiosity loop traces.
 *
 * The explorer scout generates speculative queries, the crawler fans them out,
 * the curator scores the results. Each run lands a row here so the next
 * scout call can learn from past successes/failures (see
 * [exploration.repository.ts](../../../thalamus/src/repositories/exploration.repository.ts)
 * and [explorer/scout.ts](../../../thalamus/src/explorer/scout.ts)).
 */
export const explorationLog = pgTable(
  "exploration_log",
  {
    id: bigserial("id", { mode: "bigint" }).primaryKey(),
    query: text("query").notNull(),
    queryType: text("query_type").notNull(),
    signalSource: text("signal_source"),
    urlsCrawled: integer("urls_crawled").notNull().default(0),
    itemsInjected: integer("items_injected").notNull().default(0),
    itemsPromoted: integer("items_promoted").notNull().default(0),
    qualityScore: real("quality_score"),
    explorationMeta: jsonb("exploration_meta"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => ({
    createdIdx: index("idx_exploration_created").on(t.createdAt),
    qualityIdx: index("idx_exploration_quality").on(t.qualityScore),
  }),
);

export type ExplorationLog = typeof explorationLog.$inferSelect;
export type NewExplorationLog = typeof explorationLog.$inferInsert;
