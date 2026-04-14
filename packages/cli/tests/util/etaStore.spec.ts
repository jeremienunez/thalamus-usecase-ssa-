import { describe, it, expect, beforeEach } from "vitest";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { EtaStore } from "../../src/util/etaStore";

let dir: string;
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "eta-"));
});

describe("EtaStore", () => {
  it("returns 'estimating' when no samples", () => {
    const s = new EtaStore(join(dir, "eta.json"));
    expect(s.estimate("cortex", "conjunction-analysis")).toEqual({ status: "estimating" });
  });
  it("computes p50/p95 after samples", () => {
    const s = new EtaStore(join(dir, "eta.json"));
    for (const d of [1000, 2000, 3000, 4000, 5000]) s.record("cortex", "x", d);
    const e = s.estimate("cortex", "x") as { status: "known"; p50Ms: number; p95Ms: number };
    expect(e.status).toBe("known");
    expect(e.p50Ms).toBe(3000);
    expect(e.p95Ms).toBeGreaterThanOrEqual(4000);
  });
  it("persists across instances", () => {
    const p = join(dir, "eta.json");
    const a = new EtaStore(p);
    a.record("cortex", "x", 1000);
    a.flush();
    const b = new EtaStore(p);
    const e = b.estimate("cortex", "x");
    expect(e.status).toBe("estimating-soon");
  });
});
