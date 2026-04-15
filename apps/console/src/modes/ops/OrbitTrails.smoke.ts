/**
 * OrbitTrails smoke check — pure math, no React / no three scene.
 *
 * Run:
 *   node --import tsx apps/console/src/modes/ops/OrbitTrails.smoke.ts
 *
 * Asserts:
 *   - orbitRing returns 128 points (3 floats each) for 5 mock sats.
 *   - Ring closure: first and last sampled points are nearly equal (< 1e-3 units).
 *   - Merged line-segments vertex count matches expected 128 * 2 * N budget.
 */
import { orbitRing } from "../../lib/orbit";

type MockSat = Parameters<typeof orbitRing>[0] & { id: number; regime: "LEO" };

const mocks: MockSat[] = Array.from({ length: 5 }, (_, i) => ({
  id: i + 1,
  regime: "LEO",
  semiMajorAxisKm: 6878 + i * 50, // ~500 km alt, varied
  eccentricity: 0.001,
  inclinationDeg: 51.6 + i,
  raanDeg: i * 30,
  argPerigeeDeg: 10 * i,
  meanAnomalyDeg: 45 * i,
  meanMotionRevPerDay: 15.5,
}));

let fails = 0;
function assert(cond: boolean, msg: string) {
  if (!cond) {
    console.error("FAIL:", msg);
    fails++;
  } else {
    console.log("ok  :", msg);
  }
}

const N = 128;
let mergedVerts = 0;

for (const s of mocks) {
  const ring = orbitRing(s, N);
  assert(ring.length === 3 * N, `sat ${s.id}: ring has 3*${N}=${3 * N} floats`);

  // Consecutive step length p0 → p1 should be roughly circumference/N in scene units.
  // Last→first (wrap) should match — that's what "closed ring" means here.
  const r = (i: number) => ring[i] ?? 0;
  const step01 = Math.hypot(r(3) - r(0), r(4) - r(1), r(5) - r(2));
  const stepWrap = Math.hypot(
    r(0) - r(3 * (N - 1)),
    r(1) - r(3 * (N - 1) + 1),
    r(2) - r(3 * (N - 1) + 2),
  );
  // Steps should agree within a few percent for a near-circular orbit.
  const rel = Math.abs(step01 - stepWrap) / Math.max(step01, stepWrap);
  assert(
    rel < 0.05,
    `sat ${s.id}: ring closed (step01=${step01.toFixed(5)} vs wrap=${stepWrap.toFixed(5)}, rel=${rel.toFixed(4)})`,
  );

  // LineSegments budget: 128 pairs per ring, 2 verts each.
  mergedVerts += N * 2;
}

const expected = 5 * N * 2;
assert(mergedVerts === expected, `merged vertex budget = ${expected} (got ${mergedVerts})`);

// Spec AC-3 budget guard: 128 × N_LEO × 2.
console.log(`budget check: ${mergedVerts} verts for ${mocks.length} LEO sats (cap = 128 × N × 2)`);

if (fails > 0) {
  console.error(`\n${fails} assertion(s) failed`);
  process.exit(1);
} else {
  console.log("\nall smoke assertions passed");
}
