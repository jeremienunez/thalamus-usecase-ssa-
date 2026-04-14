import { pgEnum } from "drizzle-orm/pg-core";

/**
 * Source kind — distinguishes ingestion lanes for the unified `source` /
 * `source_item` polymorphic catalogue.
 *
 *   rss     — generic RSS 2.0 / Atom feed
 *   arxiv   — arXiv API (Atom XML)
 *   ntrs    — NASA Technical Reports Server JSON API
 *   osint   — bespoke OSINT scraper output
 *   field   — operator/field reports (manual)
 *   radar   — radar/observation network telemetry
 *   press   — press releases / official agency comms
 *
 * Keep in sync with prelude DDL in
 * [migrations/0000_enums_prelude.sql](../../migrations/0000_enums_prelude.sql).
 */
export const sourceKindEnum = pgEnum("source_kind", [
  "rss",
  "arxiv",
  "ntrs",
  "osint",
  "field",
  "radar",
  "press",
]);
export type SourceKindValue = (typeof sourceKindEnum.enumValues)[number];
