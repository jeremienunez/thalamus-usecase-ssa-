import { describe, it, expect } from "vitest";

/**
 * Integration — KNN propagation endpoint.
 *
 * Given: a running console-api over a catalogue with payloads embedded.
 * When:  we POST /api/sweep/mission/knn-propagate with various field targets
 * Then:  the endpoint enforces the guardrails (field whitelist, minSim clamp,
 *        dry-run mode, range guards applied to neighbours).
 *
 * These tests do NOT mutate the catalogue (dryRun=true everywhere).
 */

const BASE = process.env.CONSOLE_API_URL ?? "http://localhost:4000";

type PropagateRes = {
  field: string;
  k: number;
  minSim: number;
  attempted: number;
  filled: number;
  disagree: number;
  tooFar: number;
  outOfRange: number;
  sampleFills: Array<{
    id: string;
    name: string;
    value: string | number;
    neighbourIds: string[];
    cosSim: number;
  }>;
};

async function propagate(body: Record<string, unknown>): Promise<PropagateRes> {
  const res = await fetch(`${BASE}/api/sweep/mission/knn-propagate`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  const text = await res.text();
  if (!res.ok) throw new Error(`${res.status}: ${text}`);
  return JSON.parse(text) as PropagateRes;
}

describe("KNN propagation — mission/knn-propagate", () => {
  it("rejects non-writable fields (400)", async () => {
    const res = await fetch(`${BASE}/api/sweep/mission/knn-propagate`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ field: "thermal_margin", dryRun: true }),
    });
    expect(res.status).toBe(400);
  });

  it("returns stats shape with counters for a valid field", async () => {
    const r = await propagate({ field: "lifetime", k: 5, minSim: 0.8, limit: 20, dryRun: true });
    expect(r.field).toBe("lifetime");
    expect(r.k).toBe(5);
    expect(r.minSim).toBeCloseTo(0.8, 6);
    expect(r.attempted).toBeGreaterThanOrEqual(0);
    expect(r.attempted).toBe(r.filled + r.disagree + r.tooFar);
    expect(Array.isArray(r.sampleFills)).toBe(true);
  });

  it("clamps k to [3,15] and minSim to [0.5,0.99]", async () => {
    const r1 = await propagate({ field: "mass_kg", k: 1, minSim: 0.1, limit: 1, dryRun: true });
    expect(r1.k).toBe(3);
    expect(r1.minSim).toBeCloseTo(0.5, 6);

    const r2 = await propagate({ field: "mass_kg", k: 999, minSim: 1.5, limit: 1, dryRun: true });
    expect(r2.k).toBe(15);
    expect(r2.minSim).toBeCloseTo(0.99, 6);
  });

  it("sampleFills carry a neighbour trail + cosine similarity", async () => {
    const r = await propagate({ field: "mass_kg", k: 5, minSim: 0.7, limit: 100, dryRun: true });
    if (r.sampleFills.length === 0) return; // sparse catalogue — skip
    for (const s of r.sampleFills) {
      expect(typeof s.id).toBe("string");
      expect(typeof s.value === "number" || typeof s.value === "string").toBe(true);
      expect(s.neighbourIds.length).toBeGreaterThan(0);
      expect(s.cosSim).toBeGreaterThanOrEqual(0.7);
      expect(s.cosSim).toBeLessThanOrEqual(1);
    }
  });

  it("higher minSim monotonically narrows the candidate set", async () => {
    const loose = await propagate({ field: "mass_kg", minSim: 0.6, limit: 50, dryRun: true });
    const strict = await propagate({ field: "mass_kg", minSim: 0.95, limit: 50, dryRun: true });
    // `tooFar + disagree` should never shrink when raising minSim over the same
    // sample of `attempted` targets — tooFar can only grow.
    expect(strict.tooFar).toBeGreaterThanOrEqual(loose.tooFar);
  });
});
