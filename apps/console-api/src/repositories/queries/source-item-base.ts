import { sql } from "drizzle-orm";

// Canonical join for source-backed content reads in console-api repos.
export const sourceItemBaseSql = sql`
  FROM source_item si
  JOIN source s ON s.id = si.source_id
`;
