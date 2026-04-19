import { desc, sql, gt } from "drizzle-orm";
import { explorationLog } from "@interview/db-schema";
import type { Database } from "@interview/db-schema";
import { createLogger } from "@interview/shared/observability";

const logger = createLogger("exploration-repo");

export interface CreateExplorationLogInput {
  query: string;
  queryType: string;
  signalSource: string | null;
  urlsCrawled: number;
  itemsInjected: number;
  itemsPromoted: number;
  qualityScore: number | null;
  explorationMeta: Record<string, unknown> | null;
}

export class ExplorationRepository {
  constructor(private db: Database) {}

  async create(input: CreateExplorationLogInput) {
    const [row] = await this.db
      .insert(explorationLog)
      .values(input)
      .returning();
    return row;
  }

  async findRecent(limit = 20) {
    return this.db
      .select()
      .from(explorationLog)
      .orderBy(desc(explorationLog.createdAt))
      .limit(limit);
  }

  async findHighQuality(minScore = 0.7, limit = 10) {
    return this.db
      .select()
      .from(explorationLog)
      .where(gt(explorationLog.qualityScore, minScore))
      .orderBy(desc(explorationLog.qualityScore))
      .limit(limit);
  }

  async getStats(days = 30) {
    const result = await this.db.execute(sql`
      SELECT
        count(*)::int as total_explorations,
        sum(urls_crawled)::int as total_urls,
        sum(items_injected)::int as total_injected,
        sum(items_promoted)::int as total_promoted,
        avg(quality_score)::numeric(4,2) as avg_quality
      FROM exploration_log
      WHERE created_at > now() - ${days + " days"}::interval
    `);
    return result.rows[0] as {
      total_explorations: number;
      total_urls: number;
      total_injected: number;
      total_promoted: number;
      avg_quality: number;
    };
  }
}
