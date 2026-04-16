import { describe, it, expect } from "vitest";
import { ConjunctionViewSchema } from "@interview/shared";

const BASE = process.env.CONSOLE_API_URL ?? "http://localhost:4000";

describe("GET /api/conjunctions", () => {
  it("returns items matching ConjunctionView schema", async () => {
    const res = await fetch(`${BASE}/api/conjunctions?minPc=0`);
    expect(res.ok).toBe(true);
    const body = (await res.json()) as { items: unknown[]; total: number };
    expect(Array.isArray(body.items)).toBe(true);
    expect(body.items.length).toBeGreaterThan(0);
    const parsed = ConjunctionViewSchema.safeParse(body.items[0]);
    expect(
      parsed.success,
      JSON.stringify(parsed.error?.issues ?? {}, null, 2),
    ).toBe(true);
  });
});
