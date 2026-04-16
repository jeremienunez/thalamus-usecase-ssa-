/**
 * Source kind — ingestion-lane discriminator for the unified `source` /
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
 * DB source of truth: `source_kind` pgEnum in
 * [packages/db-schema/src/enums/source.enum.ts](../../../db-schema/src/enums/source.enum.ts),
 * which derives its tuple from `Object.values(SourceKind)`.
 */

export enum SourceKind {
  Rss = "rss",
  Arxiv = "arxiv",
  Ntrs = "ntrs",
  Osint = "osint",
  Field = "field",
  Radar = "radar",
  Press = "press",
}
