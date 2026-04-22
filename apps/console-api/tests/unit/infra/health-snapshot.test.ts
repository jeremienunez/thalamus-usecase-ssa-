import { describe, it, expect, vi } from "vitest";
import { snapshotHealth } from "../../../src/infra/health-snapshot";

function renderSql(query: {
  toQuery: (config: {
    escapeName: (name: string) => string;
    escapeParam: () => string;
    escapeString: (value: string) => string;
    casing: { getColumnCasing: (column: string) => string };
  }) => { sql: string };
}): string {
  return query.toQuery({
    escapeName: (name) => `"${name}"`,
    escapeParam: () => "?",
    escapeString: (value) => `'${value}'`,
    casing: { getColumnCasing: (column) => column },
  }).sql;
}

function mockDb(answers: {
  pgvector?: string | null | Error;
  satellites?: number | null | Error;
  regimes?: number | null | Error;
}) {
  return {
    execute: vi.fn(async (q: Parameters<typeof renderSql>[0]) => {
      const raw = renderSql(q);
      if (raw.includes("pg_extension")) {
        if (answers.pgvector instanceof Error) throw answers.pgvector;
        return { rows: answers.pgvector == null ? [] : [{ extversion: answers.pgvector }] };
      }
      if (raw.includes("count(*)")) {
        if (answers.satellites instanceof Error) throw answers.satellites;
        return { rows: [{ n: answers.satellites ?? null }] };
      }
      if (raw.includes("count(distinct")) {
        if (answers.regimes instanceof Error) throw answers.regimes;
        return { rows: [{ n: answers.regimes ?? null }] };
      }
      throw new Error(`unmocked SQL: ${raw}`);
    }),
  };
}

function mockRedis(pong: "PONG" | Error) {
  return {
    ping: vi.fn(async () => {
      if (pong instanceof Error) throw pong;
      return pong;
    }),
  };
}

describe("snapshotHealth", () => {
  it("returns counts + versions when every probe succeeds", async () => {
    const db = mockDb({ pgvector: "0.8.0", satellites: 500, regimes: 37 });
    const redis = mockRedis("PONG");

    const s = await snapshotHealth(db, redis, 29);

    expect(s.postgres.ok).toBe(true);
    expect(s.postgres.pgvector).toBe("0.8.0");
    expect(s.redis.ok).toBe(true);
    expect(s.cortices).toBe(29);
    expect(s.catalog.satellites).toBe(500);
    expect(s.catalog.regimes).toBe(37);
    expect(db.execute).toHaveBeenCalledTimes(3);
  });

  it("returns postgres.ok=false when pgvector query throws", async () => {
    const db = mockDb({
      pgvector: new Error("connection refused"),
      satellites: new Error("connection refused"),
      regimes: new Error("connection refused"),
    });
    const redis = mockRedis("PONG");

    const s = await snapshotHealth(db, redis, 29);

    expect(s.postgres.ok).toBe(false);
    expect(s.postgres.pgvector).toBeNull();
    expect(s.catalog.satellites).toBeNull();
    expect(s.catalog.regimes).toBeNull();
    expect(s.redis.ok).toBe(true);
  });

  it("returns redis.ok=false when ping throws", async () => {
    const db = mockDb({ pgvector: "0.8.0", satellites: 0, regimes: 0 });
    const redis = mockRedis(new Error("redis down"));

    const s = await snapshotHealth(db, redis, 0);

    expect(s.redis.ok).toBe(false);
    expect(s.postgres.ok).toBe(true);
  });
});
