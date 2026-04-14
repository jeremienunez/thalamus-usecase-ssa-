import {
  pgTable,
  bigserial,
  bigint,
  text,
  timestamp,
  jsonb,
  boolean,
  real,
  index,
  uniqueIndex,
} from "drizzle-orm/pg-core";
import { sourceKindEnum } from "../enums/source.enum";

/**
 * Unified source ingestion catalogue.
 *
 *   `source`      — one row per registered ingestion lane (RSS feed, arXiv
 *                   query, NTRS query, OSINT scraper, …). Polymorphic via
 *                   `kind` — the fetcher chosen at ingest time keys off it.
 *   `source_item` — one row per fetched document (article, paper, advisory).
 *                   Idempotent on `(source_id, external_id)`.
 *
 * Replaces the legacy `rss_source` / `rss_feed_item` pair — generalised so
 * scientific catalogues (arXiv, NTRS) live alongside news feeds without a
 * second table family.
 */

export const source = pgTable(
  "source",
  {
    id: bigserial("id", { mode: "bigint" }).primaryKey(),
    name: text("name").notNull(),
    slug: text("slug").notNull().unique(),
    kind: sourceKindEnum("kind").notNull(),
    url: text("url").notNull(),
    category: text("category"),
    isEnabled: boolean("is_enabled").notNull().default(true),
    lastFetchedAt: timestamp("last_fetched_at", { withTimezone: true }),
    metadata: jsonb("metadata"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => ({
    kindLastFetchedIdx: index("idx_source_kind_last_fetched").on(
      t.kind,
      t.lastFetchedAt,
    ),
  }),
);

export const sourceItem = pgTable(
  "source_item",
  {
    id: bigserial("id", { mode: "bigint" }).primaryKey(),
    sourceId: bigint("source_id", { mode: "bigint" })
      .notNull()
      .references(() => source.id, { onDelete: "cascade" }),
    externalId: text("external_id"),
    title: text("title").notNull(),
    abstract: text("abstract"),
    body: text("body"),
    authors: text("authors").array(),
    url: text("url"),
    publishedAt: timestamp("published_at", { withTimezone: true }),
    fetchedAt: timestamp("fetched_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    score: real("score"),
    rawMetadata: jsonb("raw_metadata"),
  },
  (t) => ({
    uniqExternal: uniqueIndex("uniq_source_item_external").on(
      t.sourceId,
      t.externalId,
    ),
    sourcePublishedIdx: index("idx_source_item_source_published").on(
      t.sourceId,
      t.publishedAt,
    ),
  }),
);

export type Source = typeof source.$inferSelect;
export type NewSource = typeof source.$inferInsert;

export type SourceItem = typeof sourceItem.$inferSelect;
export type NewSourceItem = typeof sourceItem.$inferInsert;
