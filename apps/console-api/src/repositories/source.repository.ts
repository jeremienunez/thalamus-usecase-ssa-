import { sql } from "drizzle-orm";
import type { NodePgDatabase } from "drizzle-orm/node-postgres";
import type * as schema from "@interview/db-schema";
import type {
  AdvisoryRow,
  RssTrendRow,
  ManeuverPlanRow,
  ObservationIngestRow,
  CorrelationMergeRow,
  OrbitalPrimerRow,
} from "../types/source-data.types";
import { sourceItemBaseSql } from "./queries/source-item-base";

export type {
  AdvisoryRow,
  RssTrendRow,
  ManeuverPlanRow,
  ObservationIngestRow,
  CorrelationMergeRow,
  OrbitalPrimerRow,
} from "../types/source-data.types";

export class SourceRepository {
  constructor(private readonly db: NodePgDatabase<typeof schema>) {}

  // ← absorbed from cortices/queries/advisory-feed.ts
  async listAdvisoryFeed(
    opts: {
      sinceIso?: string;
      operatorId?: string | number | bigint;
      category?: string;
      limit?: number;
    } = {},
  ): Promise<AdvisoryRow[]> {
    const sinceFilter = opts.sinceIso
      ? sql`AND si.fetched_at > ${opts.sinceIso}::timestamptz`
      : sql``;
    const categoryFilter = opts.category
      ? sql`AND s.category = ${opts.category}`
      : sql``;

    const results = await this.db.execute<AdvisoryRow>(sql`
      SELECT
        s.name                        AS "sourceName",
        s.kind::text                  AS "sourceKind",
        si.title                      AS "title",
        si.abstract                   AS "summary",
        si.url                        AS "url",
        si.published_at::text         AS "publishedAt",
        si.score                      AS "score"
      ${sourceItemBaseSql}
      WHERE s.kind IN ('rss','press','field','osint')
        AND (
          s.category ILIKE '%advisor%'
          OR s.category ILIKE '%alert%'
          OR si.title  ILIKE '%advisory%'
          OR si.title  ILIKE '%bulletin%'
          OR si.title  ILIKE '%NOTAM%'
          OR si.title  ILIKE '%alert%'
          OR si.title  ILIKE '%warning%'
        )
        ${sinceFilter}
        ${categoryFilter}
      ORDER BY si.published_at DESC NULLS LAST, si.score DESC NULLS LAST
      LIMIT ${opts.limit ?? 25}
    `);

    return results.rows;
  }

  // ← absorbed from cortices/queries/rss.ts
  async listRssItems(
    opts: { category?: string; days?: number; limit?: number },
  ): Promise<RssTrendRow[]> {
    const days = opts.days ?? 7;
    const categoryFilter = opts.category
      ? sql`AND s.category = ${opts.category}`
      : sql``;

    const results = await this.db.execute<RssTrendRow>(sql`
      SELECT s.category as "sourceCategory", s.name as "sourceName",
        si.title, si.abstract as "summary", si.url as "link",
        si.published_at as "publishedAt",
        si.score
      ${sourceItemBaseSql}
      WHERE s.kind = 'rss'
        AND si.fetched_at > now() - ${days + " days"}::interval
        ${categoryFilter}
      ORDER BY si.score DESC NULLS LAST, si.published_at DESC NULLS LAST
      LIMIT ${opts.limit ?? 50}
    `);

    return results.rows;
  }

  // ← absorbed from cortices/queries/maneuver.ts
  async listManeuverPlanSources(
    opts: {
      conjunctionEventId?: string | number | bigint;
      maxDeltaVmps?: number;
      limit?: number;
    } = {},
  ): Promise<ManeuverPlanRow[]> {
    const results = await this.db.execute<ManeuverPlanRow>(sql`
      SELECT
        s.name                         AS "sourceName",
        s.kind::text                   AS "sourceKind",
        si.title                       AS "title",
        si.abstract                    AS "summary",
        si.url                         AS "url",
        si.published_at::text          AS "publishedAt"
      ${sourceItemBaseSql}
      WHERE
        si.title    ILIKE '%maneuver%'
        OR si.title ILIKE '%burn%'
        OR si.title ILIKE '%delta-v%'
        OR si.title ILIKE '%station-keeping%'
        OR si.title ILIKE '%avoidance%'
        OR si.abstract ILIKE '%delta-v%'
      ORDER BY si.published_at DESC NULLS LAST
      LIMIT ${opts.limit ?? 15}
    `);

    return results.rows;
  }

  // ← absorbed from cortices/queries/observations.ts
  async listObservationSources(
    opts: {
      stationId?: string;
      windowMinutes?: number;
      limit?: number;
    } = {},
  ): Promise<ObservationIngestRow[]> {
    const limit = opts.limit ?? 20;

    const preferred = await this.db.execute<ObservationIngestRow>(sql`
      SELECT
        s.name                  AS "sourceName",
        s.kind::text            AS "sourceKind",
        si.title                AS "title",
        si.abstract             AS "summary",
        si.url                  AS "url",
        si.published_at::text   AS "publishedAt"
      ${sourceItemBaseSql}
      WHERE s.kind IN ('radar','field')
      ORDER BY si.published_at DESC NULLS LAST
      LIMIT ${limit}
    `);

    if (preferred.rows.length > 0) {
      return preferred.rows;
    }

    const fallback = await this.db.execute<ObservationIngestRow>(sql`
      SELECT
        s.name                  AS "sourceName",
        s.kind::text            AS "sourceKind",
        si.title                AS "title",
        si.abstract             AS "summary",
        si.url                  AS "url",
        si.published_at::text   AS "publishedAt"
      ${sourceItemBaseSql}
      WHERE s.kind = 'rss'
        AND (
          si.title    ILIKE '%tracking%'
          OR si.title ILIKE '%observation%'
          OR si.title ILIKE '%radar%'
          OR si.title ILIKE '%telescope%'
          OR si.title ILIKE '%SSA%'
        )
      ORDER BY si.published_at DESC NULLS LAST
      LIMIT ${limit}
    `);

    return fallback.rows;
  }

  // ← absorbed from cortices/queries/correlation.ts
  async listCorrelationSources(
    opts: {
      conjunctionEventId?: string | number | bigint;
      limit?: number;
    } = {},
  ): Promise<CorrelationMergeRow[]> {
    const perBranchLimit = Math.max(5, Math.ceil((opts.limit ?? 20) / 2));
    const totalLimit = opts.limit ?? 20;

    const results = await this.db.execute<CorrelationMergeRow>(sql`
      (
        SELECT
          'field'::text                   AS "streamKind",
          s.name                          AS "sourceName",
          si.title                        AS "title",
          si.abstract                     AS "summary",
          si.url                          AS "url",
          si.published_at::text           AS "publishedAt",
          si.score                        AS "score"
        ${sourceItemBaseSql}
        WHERE s.kind IN ('field','radar')
        ORDER BY si.published_at DESC NULLS LAST
        LIMIT ${perBranchLimit}
      )
      UNION ALL
      (
        SELECT
          'osint'::text                   AS "streamKind",
          s.name                          AS "sourceName",
          si.title                        AS "title",
          si.abstract                     AS "summary",
          si.url                          AS "url",
          si.published_at::text           AS "publishedAt",
          si.score                        AS "score"
        ${sourceItemBaseSql}
        WHERE s.kind IN ('rss','press','osint')
        ORDER BY si.published_at DESC NULLS LAST
        LIMIT ${perBranchLimit}
      )
      LIMIT ${totalLimit}
    `);

    return results.rows;
  }

  // ← absorbed from cortices/queries/orbital-primer.ts
  async listOrbitalPrimerSources(
    opts: {
      topic?: string;
      stakeholderLevel?: string;
      limit?: number;
    } = {},
  ): Promise<OrbitalPrimerRow[]> {
    const pattern = opts.topic ? `%${opts.topic}%` : null;
    const topicFilter = pattern
      ? sql`AND (si.title ILIKE ${pattern} OR si.abstract ILIKE ${pattern})`
      : sql``;

    const perBranchLimit = Math.max(4, Math.ceil((opts.limit ?? 20) / 3));
    const totalLimit = opts.limit ?? 20;

    const results = await this.db.execute<OrbitalPrimerRow>(sql`
      (
        SELECT
          'paper'::text                 AS "kind",
          si.title                      AS "title",
          si.abstract                   AS "abstract",
          si.authors                    AS "authors",
          si.url                        AS "url",
          si.published_at::text         AS "publishedAt",
          s.name                        AS "sourceName"
        ${sourceItemBaseSql}
        WHERE s.kind IN ('arxiv','ntrs')
          ${topicFilter}
        ORDER BY si.published_at DESC NULLS LAST
        LIMIT ${perBranchLimit}
      )
      UNION ALL
      (
        SELECT
          'news'::text                  AS "kind",
          si.title                      AS "title",
          si.abstract                   AS "abstract",
          si.authors                    AS "authors",
          si.url                        AS "url",
          si.published_at::text         AS "publishedAt",
          s.name                        AS "sourceName"
        ${sourceItemBaseSql}
        WHERE s.kind = 'rss'
          ${topicFilter}
        ORDER BY si.published_at DESC NULLS LAST
        LIMIT ${perBranchLimit}
      )
      UNION ALL
      (
        SELECT
          'finding'::text               AS "kind",
          rf.title                      AS "title",
          rf.summary                    AS "abstract",
          NULL::text[]                  AS "authors",
          NULL::text                    AS "url",
          rf.created_at::text           AS "publishedAt",
          NULL::text                    AS "sourceName"
        FROM research_finding rf
        WHERE rf.cortex = 'orbital_analyst'
        ORDER BY rf.created_at DESC
        LIMIT 3
      )
      LIMIT ${totalLimit}
    `);

    return results.rows;
  }
}
