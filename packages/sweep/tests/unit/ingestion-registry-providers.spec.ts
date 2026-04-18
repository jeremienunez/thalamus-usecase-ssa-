/**
 * Task 2.4 contract test — IngestionRegistry accepts
 * IngestionSourceProvider[] while preserving has/names/noop.
 */

import { describe, it, expect } from "vitest";
import { createIngestionRegistry } from "../../src/jobs/ingestion-registry";
import type { IngestionSourceProvider } from "../../src/ports";

function fakeDb() {
  return {} as never;
}

describe("createIngestionRegistry — providers[]", () => {
  it("registers the baseline noop fetcher", () => {
    const r = createIngestionRegistry({ db: fakeDb() });
    expect(r.has("noop")).toBe(true);
    expect(r.names()).toContain("noop");
  });

  it("registers every source from every provider", () => {
    const sourceA: IngestionSourceProvider = {
      register(ctx) {
        ctx.add({ id: "foo", async run() { return { inserted: 0, skipped: 0 }; } });
        ctx.add({ id: "bar", async run() { return { inserted: 0, skipped: 0 }; } });
      },
    };
    const sourceB: IngestionSourceProvider = {
      register(ctx) {
        ctx.add({ id: "baz", async run() { return { inserted: 0, skipped: 0 }; } });
      },
    };
    const r = createIngestionRegistry({
      db: fakeDb(),
      providers: [sourceA, sourceB],
    });
    expect(r.has("foo")).toBe(true);
    expect(r.has("bar")).toBe(true);
    expect(r.has("baz")).toBe(true);
    expect(r.names().sort()).toEqual(["bar", "baz", "foo", "noop"]);
  });

  it("dispatches via `run(jobName)` to the registered source, threading db + logger", async () => {
    let received: { hasDb: boolean; hasLogger: boolean } | null = null;
    const provider: IngestionSourceProvider = {
      register(ctx) {
        ctx.add({
          id: "probe",
          async run(runCtx) {
            received = {
              hasDb: runCtx.db !== undefined,
              hasLogger: typeof runCtx.logger.info === "function",
            };
            return { inserted: 1, skipped: 0, notes: "ran" };
          },
        });
      },
    };
    const r = createIngestionRegistry({
      db: fakeDb(),
      providers: [provider],
    });
    const result = await r.run("probe");
    expect(result.inserted).toBe(1);
    expect(result.notes).toBe("ran");
    expect(received).toEqual({ hasDb: true, hasLogger: true });
  });

  it("throws on `run(unknownJobName)` with a helpful `Known:` list", async () => {
    const r = createIngestionRegistry({ db: fakeDb() });
    await expect(r.run("ghost")).rejects.toThrow(/Known: noop/);
  });

  it("rejects duplicate job ids across providers", () => {
    const a: IngestionSourceProvider = {
      register(ctx) {
        ctx.add({ id: "dupe", async run() { return { inserted: 0, skipped: 0 }; } });
      },
    };
    const b: IngestionSourceProvider = {
      register(ctx) {
        ctx.add({ id: "dupe", async run() { return { inserted: 0, skipped: 0 }; } });
      },
    };
    expect(() =>
      createIngestionRegistry({ db: fakeDb(), providers: [a, b] }),
    ).toThrow(/already registered/);
  });
});
