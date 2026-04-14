/**
 * SPEC-SH-001 — tryAsync / allSettled
 * Traceability:
 *   AC-1 resolves ok on success
 *   AC-2 preserves thrown Error instance
 *   AC-3 wraps non-Error throws
 *   AC-4 never rejects
 *   AC-5 allSettled preserves order and length
 *   AC-6 allSettled normalizes each entry
 *   AC-7 does not mutate Error fields
 */
import { describe, it, expect } from "vitest";
import { tryAsync, allSettled } from "../src/utils/async-handler";

describe("SPEC-SH-001 tryAsync", () => {
  it("AC-1 resolves ok on success", async () => {
    const res = await tryAsync(async () => 42);
    expect(res).toEqual({ ok: true, value: 42 });
  });

  it("AC-2 preserves thrown Error instance", async () => {
    const err = new RangeError("bad");
    const originalStack = err.stack;
    const res = await tryAsync(async () => {
      throw err;
    });
    expect(res.ok).toBe(false);
    if (!res.ok) {
      expect(res.error).toBe(err);
      expect(res.error.stack).toBe(originalStack);
    }
  });

  it("AC-3 wraps non-Error throws (string)", async () => {
    const res = await tryAsync(async () => {
      throw "boom";
    });
    expect(res.ok).toBe(false);
    if (!res.ok) {
      expect(res.error).toBeInstanceOf(Error);
      expect(res.error.message).toBe("boom");
    }
  });

  it("AC-3 wraps non-Error throws (number)", async () => {
    const res = await tryAsync(async () => {
      throw 404;
    });
    expect(res.ok).toBe(false);
    if (!res.ok) {
      expect(res.error).toBeInstanceOf(Error);
      expect(res.error.message).toBe("404");
    }
  });

  it("AC-3 wraps non-Error throws (object)", async () => {
    const obj = { code: "X" };
    const res = await tryAsync(async () => {
      throw obj;
    });
    expect(res.ok).toBe(false);
    if (!res.ok) {
      expect(res.error).toBeInstanceOf(Error);
      expect(res.error.message).toBe(String(obj));
    }
  });

  it("AC-4 never rejects — .then is enough to observe failures", async () => {
    let observed: unknown;
    const p = tryAsync(async () => {
      throw new Error("no-catch-needed");
    }).then((r) => {
      observed = r;
    });
    await p;
    expect(observed).toMatchObject({ ok: false });
  });

  it("AC-4 never rejects on synchronous throw inside async thunk", async () => {
    const res = await tryAsync(async () => {
      throw new Error("sync-in-async");
    });
    expect(res.ok).toBe(false);
  });

  it("AC-7 does not mutate Error fields", async () => {
    const err = new Error("orig");
    err.name = "Custom";
    const originalMessage = err.message;
    const originalName = err.name;
    const originalStack = err.stack;
    const keysBefore = Object.keys(err).sort();

    const res = await tryAsync(async () => {
      throw err;
    });

    expect(res.ok).toBe(false);
    expect(err.message).toBe(originalMessage);
    expect(err.name).toBe(originalName);
    expect(err.stack).toBe(originalStack);
    expect(Object.keys(err).sort()).toEqual(keysBefore);
  });
});

describe("SPEC-SH-001 allSettled", () => {
  it("AC-5 preserves order and length", async () => {
    const ops = [
      async () => 1,
      async () => {
        throw new Error("e2");
      },
      async () => 3,
    ];
    const results = await allSettled(ops);
    expect(results).toHaveLength(3);
    expect(results[0]).toEqual({ ok: true, value: 1 });
    expect(results[1].ok).toBe(false);
    expect(results[2]).toEqual({ ok: true, value: 3 });
  });

  it("AC-6 normalizes each entry independently (mixed outcomes)", async () => {
    const err = new Error("kaboom");
    const ops = [
      async () => "a",
      async () => {
        throw err;
      },
      async () => {
        throw 7;
      },
    ];
    const [r0, r1, r2] = await allSettled(ops);

    expect(r0).toEqual({ ok: true, value: "a" });

    expect(r1.ok).toBe(false);
    if (!r1.ok) expect(r1.error).toBe(err);

    expect(r2.ok).toBe(false);
    if (!r2.ok) {
      expect(r2.error).toBeInstanceOf(Error);
      expect(r2.error.message).toBe("7");
    }
  });

  it("AC-5 empty input yields empty array", async () => {
    const results = await allSettled([]);
    expect(results).toEqual([]);
  });
});
