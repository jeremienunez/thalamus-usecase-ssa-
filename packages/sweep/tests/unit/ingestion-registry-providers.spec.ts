/**
 * IngestionRegistry contract test — accepts IngestionSourceProvider[] and
 * dispatches jobs by id without threading any DB or persistence handle
 * through the engine-side context.
 */

import { describe, it, expect } from "vitest";
import { createIngestionRegistry } from "../../src/jobs/ingestion-registry";
import type { IngestionSourceProvider } from "../../src/ports";

describe("createIngestionRegistry — providers[]", () => {
  it("registers the baseline noop fetcher", () => {
    const r = createIngestionRegistry({});
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
      providers: [sourceA, sourceB],
    });
    expect(r.has("foo")).toBe(true);
    expect(r.has("bar")).toBe(true);
    expect(r.has("baz")).toBe(true);
    expect(r.names().sort()).toEqual(["bar", "baz", "foo", "noop"]);
  });

  it("dispatches via `run(jobName)` with a logger-only run context (no DB leak)", async () => {
    let received: { runCtxKeys: string[]; hasLogger: boolean } | null = null;
    const provider: IngestionSourceProvider = {
      register(ctx) {
        ctx.add({
          id: "probe",
          async run(runCtx) {
            received = {
              runCtxKeys: Object.keys(runCtx),
              hasLogger: typeof runCtx.logger.info === "function",
            };
            return { inserted: 1, skipped: 0, notes: "ran" };
          },
        });
      },
    };
    const r = createIngestionRegistry({ providers: [provider] });
    const result = await r.run("probe");
    expect(result.inserted).toBe(1);
    expect(result.notes).toBe("ran");
    expect(received).not.toBeNull();
    expect(received!.hasLogger).toBe(true);
    expect(received!.runCtxKeys).not.toContain("db");
    expect(received!.runCtxKeys).not.toContain("redis");
  });

  it("throws on `run(unknownJobName)` with a helpful `Known:` list", async () => {
    const r = createIngestionRegistry({});
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
      createIngestionRegistry({ providers: [a, b] }),
    ).toThrow(/already registered/);
  });
});
