/**
 * Voyage Embedder Service — Query-time embedding for satellite / SSA matching.
 *
 * Uses voyage-4-lite (shared embedding space with voyage-4-large) to generate
 * query embeddings for pgvector ANN search against the satellite catalog.
 *
 * Cost: ~$0.02 per 1M tokens (voyage-4-lite).
 * A single catalog query ≈ 15 tokens → ~$0.0000003 per query.
 */

import { createLogger } from "@interview/shared/observability";

const logger = createLogger("voyage-embedder");

const VOYAGE_API_URL = "https://api.voyageai.com/v1/embeddings";
const QUERY_MODEL = "voyage-4-lite";
const DOCUMENT_MODEL = "voyage-4-large";
// voyage-4 Matryoshka supports 256/512/1024/2048. 2048 = max recall,
// at ~2× storage cost vs 1024 (trivial at our scale).
const DIMENSIONS = 2048;
const MAX_BATCH_SIZE = 128;

export class VoyageEmbedder {
  private apiKey: string;

  constructor(apiKey?: string) {
    this.apiKey = apiKey || process.env.VOYAGE_API_KEY || "";
  }

  isAvailable(): boolean {
    return !!this.apiKey;
  }

  /**
   * Embed a single SSA query string (satellite name, operator, etc.) for
   * ANN search. Returns 1024-dim vector or null on failure.
   */
  async embedQuery(text: string): Promise<number[] | null> {
    if (!this.apiKey) {
      logger.warn("VOYAGE_API_KEY not set, embedding disabled");
      return null;
    }

    try {
      const response = await fetch(VOYAGE_API_URL, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${this.apiKey}`,
        },
        body: JSON.stringify({
          model: QUERY_MODEL,
          input: text,
          input_type: "query",
          output_dimension: DIMENSIONS,
          truncation: true,
        }),
      });

      if (!response.ok) {
        const error = await response.text();
        logger.error(
          { status: response.status, error },
          "Voyage embedding API error",
        );
        return null;
      }

      const data = (await response.json()) as {
        data: { embedding: number[] }[];
        usage: { total_tokens: number };
      };

      logger.debug(
        { tokens: data.usage?.total_tokens },
        "Voyage query embedded",
      );

      return data.data?.[0]?.embedding ?? null;
    } catch (error) {
      logger.error({ err: error }, "Voyage embed call failed");
      return null;
    }
  }

  /**
   * Embed multiple documents for storage (voyage-4-large, input_type document).
   * Batches in groups of 128 per API call.
   * Returns array of 1024-dim vectors (null for failures).
   */
  async embedDocuments(texts: string[]): Promise<(number[] | null)[]> {
    if (!this.apiKey) {
      logger.warn("VOYAGE_API_KEY not set, embedding disabled");
      return texts.map((): number[] | null => null);
    }

    if (texts.length === 0) return [];

    const results: (number[] | null)[] = new Array(texts.length).fill(null);

    // Process in batches of MAX_BATCH_SIZE
    for (let i = 0; i < texts.length; i += MAX_BATCH_SIZE) {
      const batch = texts.slice(i, i + MAX_BATCH_SIZE);

      try {
        const response = await fetch(VOYAGE_API_URL, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${this.apiKey}`,
          },
          body: JSON.stringify({
            model: DOCUMENT_MODEL,
            input: batch,
            input_type: "document",
            output_dimension: DIMENSIONS,
            truncation: true,
          }),
        });

        if (!response.ok) {
          const error = await response.text();
          logger.error(
            { status: response.status, error, batchStart: i },
            "Voyage document embedding API error",
          );
          continue;
        }

        const data = (await response.json()) as {
          data: { embedding: number[]; index: number }[];
          usage: { total_tokens: number };
        };

        logger.debug(
          { tokens: data.usage?.total_tokens, batchSize: batch.length },
          "Voyage documents embedded",
        );

        for (const item of data.data) {
          results[i + item.index] = item.embedding;
        }
      } catch (error) {
        logger.error(
          { err: error, batchStart: i },
          "Voyage document embed call failed",
        );
      }
    }

    return results;
  }

  /**
   * Compose a search string from structured satellite / SSA fields.
   * Mirrors the format used when catalog rows were embedded with
   * voyage-4-large (name + operator + orbit regime + platform class +
   * launch year).
   */
  static composeSearchText(fields: {
    name: string;
    operatorCountry?: string;
    platformClass?: string;
    launchYear?: string;
    operator?: string;
  }): string {
    const parts: string[] = [];
    if (fields.name) parts.push(fields.name);
    if (fields.operator && !fields.name.includes(fields.operator)) {
      parts.push(fields.operator);
    }
    if (fields.operatorCountry) parts.push(fields.operatorCountry);
    if (fields.platformClass) parts.push(fields.platformClass);
    if (fields.launchYear) parts.push(fields.launchYear);
    return parts.join(" ").trim();
  }
}
