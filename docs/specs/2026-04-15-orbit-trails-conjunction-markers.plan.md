# Orbit Trails & Conjunction Markers — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Render hybrid orbital trails (full rings for selected regime, fading tails for others) on the 3D globe, and mark every conjunction with a severity-colored ✕ that reveals a full-SSA info card on hover/select.

**Architecture:** Two new `@react-three/fiber` components (`OrbitTrails.tsx`, `ConjunctionMarkers.tsx`) mounted inside the existing `Globe` scene. A small extension to `/api/conjunctions` returns regime + derived covariance/action. One shared Zod view model in `packages/shared`. The existing Keplerian propagator in [apps/console/src/lib/orbits.ts](../../apps/console/src/lib/orbits.ts) gains an `orbitRing()` helper.

**Tech Stack:** React 18, TypeScript, @react-three/fiber, three.js, Zustand (existing `uiStore`), Fastify + Drizzle (console-api), Zod (shared), Vitest.

Spec: [docs/specs/2026-04-15-orbit-trails-conjunction-markers.md](./2026-04-15-orbit-trails-conjunction-markers.md)

---

## File Map

**Create**

- `apps/console/src/modes/ops/OrbitTrails.tsx` — hybrid trail renderer (rings + tails)
- `apps/console/src/modes/ops/ConjunctionMarkers.tsx` — ✕ sprites + info card portal
- `apps/console/src/modes/ops/TrailModeToggle.tsx` — tri-state UI (off / tails / full)
- `apps/console/src/lib/orbits.test.ts` — unit test for `orbitRing`
- `packages/shared/src/ssa/conjunction-view.ts` — Zod `ConjunctionView` schema + derivations
- `apps/console-api/tests/conjunctions.spec.ts` — API shape smoke test

**Modify**

- `apps/console/src/lib/orbits.ts` — add `orbitRing()` helper
- `apps/console/src/lib/api.ts` — update `ConjunctionDTO` to match new shape
- `apps/console/src/lib/uiStore.ts` — add `trailMode: "off" | "tails" | "full"` + `selectedConjunctionId`
- `apps/console/src/modes/ops/Globe.tsx` — mount `OrbitTrails` + `ConjunctionMarkers`
- `apps/console/src/modes/ops/OpsMode.tsx` — mount `TrailModeToggle` near `RegimeFilter`
- `apps/console/src/modes/ops/ConjunctionArcs.tsx` — emit hover events to store
- `apps/console-api/src/server.ts:168-225` — extend `/api/conjunctions` with regime + derived fields
- `packages/shared/src/index.ts` — export `ConjunctionView`

---

## Phase 1 — Shared view model & API extension

### Task 1: Add `ConjunctionView` Zod schema in shared

**Files:**

- Create: `packages/shared/src/ssa/conjunction-view.ts`
- Modify: `packages/shared/src/index.ts`

- [ ] **Step 1: Write the schema**

Create `packages/shared/src/ssa/conjunction-view.ts`:

```ts
import { z } from "zod";

export const RegimeSchema = z.enum(["LEO", "MEO", "GEO", "HEO"]);
export type Regime = z.infer<typeof RegimeSchema>;

export const CovarianceQualitySchema = z.enum(["HIGH", "MED", "LOW"]);
export type CovarianceQuality = z.infer<typeof CovarianceQualitySchema>;

export const ConjunctionActionSchema = z.enum([
  "maneuver_candidate",
  "monitor",
  "no_action",
]);
export type ConjunctionAction = z.infer<typeof ConjunctionActionSchema>;

export const ConjunctionViewSchema = z.object({
  id: z.number(),
  primaryId: z.number(),
  secondaryId: z.number(),
  primaryName: z.string(),
  secondaryName: z.string(),
  regime: RegimeSchema,
  epoch: z.string(), // ISO — TCA
  minRangeKm: z.number(),
  relativeVelocityKmps: z.number(),
  probabilityOfCollision: z.number(),
  combinedSigmaKm: z.number(),
  hardBodyRadiusM: z.number(),
  pcMethod: z.string(), // screening source
  computedAt: z.string(), // ISO — last update
  covarianceQuality: CovarianceQualitySchema,
  action: ConjunctionActionSchema,
});

export type ConjunctionView = z.infer<typeof ConjunctionViewSchema>;

export function deriveCovarianceQuality(sigmaKm: number): CovarianceQuality {
  if (sigmaKm < 0.1) return "HIGH";
  if (sigmaKm < 1) return "MED";
  return "LOW";
}

export function deriveAction(pc: number): ConjunctionAction {
  if (pc >= 1e-4) return "maneuver_candidate";
  if (pc >= 1e-6) return "monitor";
  return "no_action";
}
```

- [ ] **Step 2: Export from shared index**

In `packages/shared/src/index.ts` add:

```ts
export * from "./ssa/conjunction-view";
```

- [ ] **Step 3: Typecheck shared**

Run: `pnpm --filter @interview/shared typecheck` (or `tsc --noEmit` at package root)
Expected: no errors.

- [ ] **Step 4: Commit**

```bash
git add packages/shared/src/ssa/conjunction-view.ts packages/shared/src/index.ts
git commit -m "feat(shared): ConjunctionView zod schema + covariance/action derivations"
```

---

### Task 2: Write failing API test

**Files:**

- Create: `apps/console-api/tests/conjunctions.spec.ts`

- [ ] **Step 1: Write the failing test**

```ts
import { describe, it, expect } from "vitest";
import { ConjunctionViewSchema } from "@interview/shared";

describe("GET /api/conjunctions", () => {
  it("returns items matching ConjunctionView schema with regime + derived fields", async () => {
    const res = await fetch("http://localhost:4000/api/conjunctions?minPc=0");
    expect(res.ok).toBe(true);
    const body = (await res.json()) as { items: unknown[]; total: number };
    expect(Array.isArray(body.items)).toBe(true);
    expect(body.items.length).toBeGreaterThan(0);
    const first = body.items[0];
    const parsed = ConjunctionViewSchema.safeParse(first);
    expect(parsed.success, JSON.stringify(parsed, null, 2)).toBe(true);
  });
});
```

- [ ] **Step 2: Run test to confirm it fails**

Run: `pnpm --filter @interview/console-api test -- conjunctions.spec`
Expected: FAIL — current response is missing `regime`, `covarianceQuality`, `action`, `computedAt`.

---

### Task 3: Extend `/api/conjunctions` with regime + derived fields

**Files:**

- Modify: `apps/console-api/src/server.ts:168-225`

- [ ] **Step 1: Update SQL and mapping**

Replace the block at `apps/console-api/src/server.ts:168-225` with:

```ts
app.get<{ Querystring: { minPc?: string } }>(
  "/api/conjunctions",
  async (req) => {
    const minPc = Number(req.query.minPc ?? 0);
    const rows = await db.execute<{
      id: string;
      primary_id: string;
      secondary_id: string;
      primary_name: string;
      secondary_name: string;
      primary_mm: number | null;
      epoch: Date;
      min_range_km: number;
      relative_velocity_kmps: number | null;
      probability_of_collision: number | null;
      combined_sigma_km: number | null;
      hard_body_radius_m: number | null;
      pc_method: string | null;
      computed_at: Date;
    }>(sql`
      SELECT
        ce.id::text                                         AS id,
        ce.primary_satellite_id::text                       AS primary_id,
        ce.secondary_satellite_id::text                     AS secondary_id,
        sp.name                                             AS primary_name,
        ss.name                                             AS secondary_name,
        NULLIF(sp.telemetry_summary->>'meanMotion','')::float AS primary_mm,
        ce.epoch,
        ce.min_range_km,
        ce.relative_velocity_kmps,
        ce.probability_of_collision,
        ce.combined_sigma_km,
        ce.hard_body_radius_m,
        ce.pc_method,
        ce.computed_at
      FROM conjunction_event ce
      LEFT JOIN satellite sp ON sp.id = ce.primary_satellite_id
      LEFT JOIN satellite ss ON ss.id = ce.secondary_satellite_id
      WHERE COALESCE(ce.probability_of_collision, 0) >= ${minPc}
      ORDER BY ce.probability_of_collision DESC NULLS LAST
      LIMIT 500
    `);

    const items = rows.rows.map((r) => {
      const pc = r.probability_of_collision ?? 0;
      const sigma = r.combined_sigma_km ?? 10;
      const regime = regimeFromMeanMotion(r.primary_mm);
      return {
        id: Number(r.id),
        primaryId: Number(r.primary_id),
        secondaryId: Number(r.secondary_id),
        primaryName: r.primary_name ?? `sat-${r.primary_id}`,
        secondaryName: r.secondary_name ?? `sat-${r.secondary_id}`,
        regime,
        epoch: r.epoch.toISOString(),
        minRangeKm: r.min_range_km,
        relativeVelocityKmps: r.relative_velocity_kmps ?? 0,
        probabilityOfCollision: pc,
        combinedSigmaKm: sigma,
        hardBodyRadiusM: r.hard_body_radius_m ?? 20,
        pcMethod: r.pc_method ?? "foster-gaussian",
        computedAt: r.computed_at.toISOString(),
        covarianceQuality:
          sigma < 0.1 ? "HIGH" : sigma < 1 ? "MED" : ("LOW" as const),
        action:
          pc >= 1e-4
            ? "maneuver_candidate"
            : pc >= 1e-6
              ? "monitor"
              : ("no_action" as const),
      };
    });
    return { items, total: items.length };
  },
);
```

- [ ] **Step 2: Restart server and rerun test**

```bash
pkill -f "tsx.*console-api" || true
pnpm --filter @interview/console-api dev &
sleep 3
pnpm --filter @interview/console-api test -- conjunctions.spec
```

Expected: PASS.

- [ ] **Step 3: Commit**

```bash
git add apps/console-api/src/server.ts apps/console-api/tests/conjunctions.spec.ts
git commit -m "feat(console-api): /api/conjunctions returns regime + covariance/action"
```

---

### Task 4: Update frontend `ConjunctionDTO`

**Files:**

- Modify: `apps/console/src/lib/api.ts`

- [ ] **Step 1: Replace `ConjunctionDTO` with `ConjunctionView` re-export**

In `apps/console/src/lib/api.ts` remove the local `ConjunctionDTO` type and add:

```ts
export type { ConjunctionView as ConjunctionDTO } from "@interview/shared";
```

Keep the fetcher signature identical — the payload is now a superset, not a breaking change for existing consumers.

- [ ] **Step 2: Typecheck console**

Run: `pnpm --filter @interview/console typecheck`
Expected: no errors (existing code that reads `primaryName`, `probabilityOfCollision`, etc. still works; `sourceClass`/`corroborated` readers, if any, need removal — grep and fix).

- [ ] **Step 3: Grep and remove dead field references**

```bash
grep -rn "sourceClass\|corroborated" apps/console/src
```

Remove or adapt any hits. If `FindingsPanel` or similar still reads these, delete those branches.

- [ ] **Step 4: Commit**

```bash
git add apps/console/src/lib/api.ts apps/console/src
git commit -m "refactor(console): use shared ConjunctionView DTO"
```

---

## Phase 2 — Propagator `orbitRing` + test

### Task 5: Write failing test for `orbitRing`

**Files:**

- Create: `apps/console/src/lib/orbits.test.ts`

- [ ] **Step 1: Write the test**

```ts
import { describe, it, expect } from "vitest";
import * as THREE from "three";
import { orbitRing, satellitePosition, SCENE_SCALE } from "./orbits";

const leo = {
  semiMajorAxisKm: 6778, // ~400 km altitude
  eccentricity: 0.0001,
  inclinationDeg: 51.6,
  raanDeg: 0,
  argPerigeeDeg: 0,
  meanAnomalyDeg: 0,
  meanMotionRevPerDay: 15.5,
};

describe("orbitRing", () => {
  it("returns n points that close the orbit (first ≈ last)", () => {
    const ring = orbitRing(leo, 128);
    expect(ring.length).toBe(128 * 3);
    const p0 = new THREE.Vector3(ring[0], ring[1], ring[2]);
    const pN = new THREE.Vector3(
      ring[127 * 3],
      ring[127 * 3 + 1],
      ring[127 * 3 + 2],
    );
    expect(p0.distanceTo(pN)).toBeLessThan(0.01); // scene units
  });

  it("sample at t=0 matches satellitePosition at t=0", () => {
    const ring = orbitRing(leo, 128);
    const direct = satellitePosition(leo, 0);
    const ringP0 = new THREE.Vector3(ring[0], ring[1], ring[2]);
    expect(ringP0.distanceTo(direct)).toBeLessThan(1e-6);
  });

  it("spans exactly one orbital period", () => {
    const periodSec = 86400 / leo.meanMotionRevPerDay;
    const ring = orbitRing(leo, 4);
    const halfway = satellitePosition(leo, periodSec / 2);
    const ringMid = new THREE.Vector3(ring[6], ring[7], ring[8]);
    expect(ringMid.distanceTo(halfway)).toBeLessThan(0.01);
  });
});
```

- [ ] **Step 2: Run test to confirm it fails**

Run: `pnpm --filter @interview/console test -- orbits.test`
Expected: FAIL — `orbitRing` not exported.

---

### Task 6: Implement `orbitRing`

**Files:**

- Modify: `apps/console/src/lib/orbits.ts`

- [ ] **Step 1: Add the helper at the bottom of the file**

```ts
/**
 * Sample n equally-spaced positions across one full orbital period.
 * Returns a flat Float32Array of (x, y, z) triples in scene units.
 * Geometry is static per TLE — cache at call-site by satellite id + epoch.
 */
export function orbitRing(
  s: Parameters<typeof satellitePosition>[0],
  n = 128,
): Float32Array {
  const out = new Float32Array(n * 3);
  const periodSec = 86400 / s.meanMotionRevPerDay;
  const tmp = new THREE.Vector3();
  // Neutralise the caller's meanAnomaly so the ring samples a FULL period
  // regardless of the sat's current phase — callers want geometry, not timing.
  const atEpoch = { ...s, meanAnomalyDeg: 0 };
  for (let i = 0; i < n; i++) {
    const t = (i / n) * periodSec;
    satellitePosition(atEpoch, t, tmp);
    out[i * 3] = tmp.x;
    out[i * 3 + 1] = tmp.y;
    out[i * 3 + 2] = tmp.z;
  }
  return out;
}
```

- [ ] **Step 2: Update the test to normalise meanAnomaly**

The test's `t=0` sample must match `satellitePosition` with `meanAnomalyDeg: 0`. Update the second and third test cases to use `{ ...leo, meanAnomalyDeg: 0 }` when comparing to `satellitePosition`.

- [ ] **Step 3: Run test to confirm it passes**

Run: `pnpm --filter @interview/console test -- orbits.test`
Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add apps/console/src/lib/orbits.ts apps/console/src/lib/orbits.test.ts
git commit -m "feat(console): orbitRing() helper + closure/period unit tests"
```

---

## Phase 3 — OrbitTrails component

### Task 7: Add trail mode to `uiStore`

**Files:**

- Modify: `apps/console/src/lib/uiStore.ts`

- [ ] **Step 1: Add state slice**

Append to the Zustand store definition:

```ts
trailMode: "tails" as "off" | "tails" | "full",
setTrailMode: (m: "off" | "tails" | "full") => set({ trailMode: m }),
selectedConjunctionId: null as number | null,
setSelectedConjunctionId: (id: number | null) =>
  set({ selectedConjunctionId: id }),
hoveredConjunctionId: null as number | null,
setHoveredConjunctionId: (id: number | null) =>
  set({ hoveredConjunctionId: id }),
```

- [ ] **Step 2: Typecheck**

Run: `pnpm --filter @interview/console typecheck`
Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add apps/console/src/lib/uiStore.ts
git commit -m "feat(console): trailMode + conjunction selection/hover in uiStore"
```

---

### Task 8: `TrailModeToggle` UI

**Files:**

- Create: `apps/console/src/modes/ops/TrailModeToggle.tsx`

- [ ] **Step 1: Implement the component**

```tsx
import { clsx } from "clsx";
import { useUiStore } from "@/lib/uiStore";

const MODES: Array<{ key: "off" | "tails" | "full"; label: string }> = [
  { key: "off", label: "OFF" },
  { key: "tails", label: "TAILS" },
  { key: "full", label: "FULL" },
];

export function TrailModeToggle() {
  const mode = useUiStore((s) => s.trailMode);
  const set = useUiStore((s) => s.setTrailMode);
  return (
    <div className="pointer-events-auto border border-hairline bg-panel/90 backdrop-blur-sm">
      <div className="flex items-center gap-2 border-b border-hairline px-3 py-1.5">
        <div className="h-1.5 w-1.5 bg-amber" />
        <div className="label text-[10px]">TRAILS</div>
      </div>
      <div className="flex">
        {MODES.map(({ key, label }) => (
          <button
            key={key}
            type="button"
            onClick={() => set(key)}
            className={clsx(
              "border-l border-hairline px-3 py-1.5 label text-[10px] first:border-l-0 hover:bg-hairline/40",
              mode !== key && "opacity-40",
            )}
          >
            {label}
          </button>
        ))}
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Mount next to `RegimeFilter` in `OpsMode`**

In `apps/console/src/modes/ops/OpsMode.tsx`, find where `<RegimeFilter …/>` is rendered and place `<TrailModeToggle />` immediately after it in the same flex container.

- [ ] **Step 3: Visual check**

```bash
pnpm --filter @interview/console dev &
```

Open the app, confirm a new "TRAILS off|tails|full" control appears near the regime filter and toggles state (no rendering yet, just UI).

- [ ] **Step 4: Commit**

```bash
git add apps/console/src/modes/ops/TrailModeToggle.tsx apps/console/src/modes/ops/OpsMode.tsx
git commit -m "feat(ops): TrailModeToggle tri-state control"
```

---

### Task 9: `OrbitTrails` — full rings path

**Files:**

- Create: `apps/console/src/modes/ops/OrbitTrails.tsx`

- [ ] **Step 1: Implement rings-only, wired behind `trailMode === "full"`**

```tsx
import { useMemo } from "react";
import * as THREE from "three";
import type { SatelliteDTO } from "@/lib/api";
import { orbitRing, regimeColor } from "@/lib/orbits";
import { useUiStore } from "@/lib/uiStore";
import type { RegimeKey } from "./RegimeFilter";

const REGIMES: RegimeKey[] = ["LEO", "MEO", "GEO", "HEO"];
const RING_SAMPLES = 128;

interface Props {
  satellites: SatelliteDTO[];
}

export function OrbitTrails({ satellites }: Props) {
  const mode = useUiStore((s) => s.trailMode);

  const ringsByRegime = useMemo(() => {
    if (mode !== "full") return null;
    const grouped = new Map<RegimeKey, SatelliteDTO[]>();
    for (const s of satellites) {
      const r = s.regime as RegimeKey;
      if (!grouped.has(r)) grouped.set(r, []);
      grouped.get(r)!.push(s);
    }
    const out: Array<{ regime: RegimeKey; geometry: THREE.BufferGeometry }> =
      [];
    for (const regime of REGIMES) {
      const sats = grouped.get(regime) ?? [];
      if (sats.length === 0) continue;
      const segsPerSat = RING_SAMPLES; // line segments, pairs of vertices
      const verts = new Float32Array(sats.length * segsPerSat * 2 * 3);
      let w = 0;
      for (const s of sats) {
        let ring: Float32Array;
        try {
          ring = orbitRing(s, RING_SAMPLES);
        } catch {
          continue;
        }
        for (let i = 0; i < RING_SAMPLES; i++) {
          const a = i * 3;
          const b = ((i + 1) % RING_SAMPLES) * 3;
          verts[w++] = ring[a];
          verts[w++] = ring[a + 1];
          verts[w++] = ring[a + 2];
          verts[w++] = ring[b];
          verts[w++] = ring[b + 1];
          verts[w++] = ring[b + 2];
        }
      }
      const geometry = new THREE.BufferGeometry();
      geometry.setAttribute(
        "position",
        new THREE.BufferAttribute(verts.subarray(0, w), 3),
      );
      out.push({ regime, geometry });
    }
    return out;
  }, [satellites, mode]);

  if (!ringsByRegime) return null;

  return (
    <group>
      {ringsByRegime.map(({ regime, geometry }) => (
        <lineSegments key={regime} geometry={geometry}>
          <lineBasicMaterial
            color={regimeColor(regime)}
            transparent
            opacity={0.35}
            blending={THREE.AdditiveBlending}
            toneMapped={false}
          />
        </lineSegments>
      ))}
    </group>
  );
}
```

- [ ] **Step 2: Mount in `Globe.tsx`**

In `apps/console/src/modes/ops/Globe.tsx`, import `OrbitTrails` and render `<OrbitTrails satellites={satellites} />` inside the scene, between `<SatelliteField>` and `<ConjunctionArcs>`.

- [ ] **Step 3: Visual check**

Open the console app, select `TRAILS: full`. Expected: full orbit rings appear, 4 colors by regime, matching the reference photo style.

- [ ] **Step 4: Commit**

```bash
git add apps/console/src/modes/ops/OrbitTrails.tsx apps/console/src/modes/ops/Globe.tsx
git commit -m "feat(ops): OrbitTrails — full orbit rings per regime"
```

---

### Task 10: `OrbitTrails` — fading tails path

**Files:**

- Modify: `apps/console/src/modes/ops/OrbitTrails.tsx`

- [ ] **Step 1: Add tail buffer state and frame hook**

Add inside `OrbitTrails` component (above the `return`):

```tsx
import { useRef } from "react";
import { useFrame } from "@react-three/fiber";
import { satellitePosition } from "@/lib/orbits";

const TAIL_LEN = 60; // ~30 min at current tick rate

// inside component:
const tailLinesRef = useRef<THREE.LineSegments>(null);
const tailBuffersRef = useRef<Map<number, THREE.Vector3[]>>(new Map());
const tailTRef = useRef(0);

const tailGeometry = useMemo(() => {
  if (mode !== "tails") return null;
  const maxVerts = satellites.length * TAIL_LEN * 2 * 3;
  const positions = new Float32Array(maxVerts);
  const colors = new Float32Array(maxVerts);
  const geom = new THREE.BufferGeometry();
  geom.setAttribute("position", new THREE.BufferAttribute(positions, 3));
  geom.setAttribute("color", new THREE.BufferAttribute(colors, 3));
  return geom;
}, [satellites.length, mode]);

useFrame((_, dt) => {
  if (mode !== "tails" || !tailGeometry) return;
  tailTRef.current += dt;
  const t = tailTRef.current;
  const posAttr = tailGeometry.getAttribute(
    "position",
  ) as THREE.BufferAttribute;
  const colAttr = tailGeometry.getAttribute("color") as THREE.BufferAttribute;
  const tmp = new THREE.Vector3();
  let w = 0;
  for (const s of satellites) {
    let buf = tailBuffersRef.current.get(s.id);
    if (!buf) {
      buf = [];
      tailBuffersRef.current.set(s.id, buf);
    }
    satellitePosition(s, t, tmp);
    buf.push(tmp.clone());
    if (buf.length > TAIL_LEN) buf.shift();
    const col = regimeColor(s.regime as RegimeKey);
    for (let i = 0; i < buf.length - 1; i++) {
      const a = buf[i];
      const b = buf[i + 1];
      const fade = i / TAIL_LEN;
      posAttr.array[w] = a.x;
      posAttr.array[w + 1] = a.y;
      posAttr.array[w + 2] = a.z;
      colAttr.array[w] = col.r * fade;
      colAttr.array[w + 1] = col.g * fade;
      colAttr.array[w + 2] = col.b * fade;
      w += 3;
      posAttr.array[w] = b.x;
      posAttr.array[w + 1] = b.y;
      posAttr.array[w + 2] = b.z;
      const fade2 = (i + 1) / TAIL_LEN;
      colAttr.array[w] = col.r * fade2;
      colAttr.array[w + 1] = col.g * fade2;
      colAttr.array[w + 2] = col.b * fade2;
      w += 3;
    }
  }
  tailGeometry.setDrawRange(0, w / 3);
  posAttr.needsUpdate = true;
  colAttr.needsUpdate = true;
});
```

In the returned JSX, add alongside the rings block:

```tsx
{
  tailGeometry && (
    <lineSegments ref={tailLinesRef} geometry={tailGeometry}>
      <lineBasicMaterial
        vertexColors
        transparent
        opacity={0.5}
        blending={THREE.AdditiveBlending}
        toneMapped={false}
      />
    </lineSegments>
  );
}
```

- [ ] **Step 2: Visual check**

Toggle `TRAILS: tails`. Expected: a fading tail trails behind each sat, color per regime, no full rings.

- [ ] **Step 3: Perf sanity**

Open devtools > Performance. Confirm steady 60fps on a mid laptop with ~1215 sats.

- [ ] **Step 4: Commit**

```bash
git add apps/console/src/modes/ops/OrbitTrails.tsx
git commit -m "feat(ops): OrbitTrails — fading tails with per-regime color ramp"
```

---

## Phase 4 — ConjunctionMarkers

### Task 11: Hover wiring in `ConjunctionArcs`

**Files:**

- Modify: `apps/console/src/modes/ops/ConjunctionArcs.tsx`

- [ ] **Step 1: Add per-conjunction invisible pick mesh**

At the end of the returned group in `ConjunctionArcs`, add a thin invisible cylinder per `threatPair` between the two current sat positions. Attach `onPointerOver` / `onPointerOut` that set `hoveredConjunctionId` in the store. Keep existing visuals untouched.

```tsx
import { useUiStore } from "@/lib/uiStore";

// inside the component body:
const setHovered = useUiStore((s) => s.setHoveredConjunctionId);

// inside the <group>:
{
  threatPairs.map((tp) => (
    <mesh
      key={tp.c.id}
      onPointerOver={(e) => {
        e.stopPropagation();
        setHovered(tp.c.id);
      }}
      onPointerOut={() => setHovered(null)}
    >
      {/* tiny invisible sphere at TCA midpoint (current positions) */}
      <sphereGeometry args={[0.02, 8, 8]} />
      <meshBasicMaterial visible={false} transparent opacity={0} />
    </mesh>
  ));
}
```

Position the sphere each frame via a small `useFrame` that reuses the same midpoint the epicentre ring already computes (`p1.lerp(p2, 0.5)`).

- [ ] **Step 2: Visual check**

Hover a conjunction arc's midpoint region — `hoveredConjunctionId` in store (use React DevTools) should update.

- [ ] **Step 3: Commit**

```bash
git add apps/console/src/modes/ops/ConjunctionArcs.tsx
git commit -m "feat(ops): emit hover events from ConjunctionArcs pick regions"
```

---

### Task 12: `ConjunctionMarkers` — ✕ sprite at TCA

**Files:**

- Create: `apps/console/src/modes/ops/ConjunctionMarkers.tsx`

- [ ] **Step 1: Generate ✕ texture + render one sprite per conjunction**

```tsx
import { useMemo, useRef } from "react";
import { useFrame } from "@react-three/fiber";
import * as THREE from "three";
import type { ConjunctionDTO, SatelliteDTO } from "@/lib/api";
import { satellitePosition } from "@/lib/orbits";
import { useUiStore } from "@/lib/uiStore";

function makeCrossTexture(): THREE.Texture {
  const size = 32;
  const canvas = document.createElement("canvas");
  canvas.width = canvas.height = size;
  const ctx = canvas.getContext("2d")!;
  ctx.strokeStyle = "#ffffff";
  ctx.lineWidth = 3;
  ctx.beginPath();
  ctx.moveTo(6, 6);
  ctx.lineTo(size - 6, size - 6);
  ctx.moveTo(size - 6, 6);
  ctx.lineTo(6, size - 6);
  ctx.stroke();
  const tex = new THREE.CanvasTexture(canvas);
  tex.needsUpdate = true;
  return tex;
}

function severityColor(pc: number): string {
  if (pc >= 1e-4) return "#e74c3c";
  if (pc >= 1e-6) return "#f1c40f";
  return "#2ecc71";
}

interface Props {
  satellites: SatelliteDTO[];
  conjunctions: ConjunctionDTO[];
}

export function ConjunctionMarkers({ satellites, conjunctions }: Props) {
  const texture = useMemo(() => makeCrossTexture(), []);
  const satById = useMemo(
    () => new Map(satellites.map((s) => [s.id, s])),
    [satellites],
  );
  const hovered = useUiStore((s) => s.hoveredConjunctionId);
  const selected = useUiStore((s) => s.selectedConjunctionId);

  const refs = useRef<Map<number, THREE.Sprite>>(new Map());
  const tmpA = useRef(new THREE.Vector3()).current;
  const tmpB = useRef(new THREE.Vector3()).current;
  const tRef = useRef(0);

  useFrame((_, dt) => {
    tRef.current += dt;
    for (const c of conjunctions) {
      const sprite = refs.current.get(c.id);
      if (!sprite) continue;
      const a = satById.get(c.primaryId);
      const b = satById.get(c.secondaryId);
      if (!a || !b) continue;
      satellitePosition(a, tRef.current, tmpA);
      satellitePosition(b, tRef.current, tmpB);
      sprite.position.copy(tmpA).lerp(tmpB, 0.5);
      const visible = hovered === c.id || selected === c.id;
      const mat = sprite.material as THREE.SpriteMaterial;
      mat.opacity = visible ? 1 : 0;
    }
  });

  return (
    <group>
      {conjunctions.map((c) => (
        <sprite
          key={c.id}
          ref={(el) => {
            if (el) refs.current.set(c.id, el);
            else refs.current.delete(c.id);
          }}
          scale={[0.03, 0.03, 1]}
        >
          <spriteMaterial
            map={texture}
            color={severityColor(c.probabilityOfCollision)}
            transparent
            opacity={0}
            depthWrite={false}
            toneMapped={false}
          />
        </sprite>
      ))}
    </group>
  );
}
```

- [ ] **Step 2: Mount in `Globe.tsx`**

Render `<ConjunctionMarkers satellites={satellites} conjunctions={conjunctions} />` after `<ConjunctionArcs>`.

- [ ] **Step 3: Visual check**

Hover a conjunction arc — a severity-colored ✕ should flash in at the TCA midpoint. Move away — it hides again.

- [ ] **Step 4: Commit**

```bash
git add apps/console/src/modes/ops/ConjunctionMarkers.tsx apps/console/src/modes/ops/Globe.tsx
git commit -m "feat(ops): ConjunctionMarkers — severity X sprites revealed on hover"
```

---

### Task 13: Info card HTML portal

**Files:**

- Modify: `apps/console/src/modes/ops/ConjunctionMarkers.tsx`

- [ ] **Step 1: Add `<Html>` portal with full-SSA content**

Use `@react-three/drei`'s `Html` component (already used in `SatelliteField`). For the active conjunction (hovered OR selected), render a card anchored to the sprite position:

```tsx
import { Html } from "@react-three/drei";

// inside component, compute active:
const active = useMemo(() => {
  const id = hovered ?? selected;
  if (id == null) return null;
  return conjunctions.find((c) => c.id === id) ?? null;
}, [hovered, selected, conjunctions]);

const activePos = useRef(new THREE.Vector3()).current;

// after useFrame logic, also update activePos when `active` is set:
useFrame(() => {
  if (!active) return;
  const a = satById.get(active.primaryId);
  const b = satById.get(active.secondaryId);
  if (!a || !b) return;
  satellitePosition(a, tRef.current, tmpA);
  satellitePosition(b, tRef.current, tmpB);
  activePos.copy(tmpA).lerp(tmpB, 0.5);
});

// in JSX, alongside the sprites group:
{
  active && (
    <Html position={activePos} distanceFactor={8} zIndexRange={[100, 0]}>
      <div className="pointer-events-none min-w-[260px] border border-hairline bg-panel/95 p-2 text-[10px] backdrop-blur-sm">
        <div className="label mb-1 flex items-center justify-between">
          <span>CONJUNCTION</span>
          <span className="mono text-dim">{active.regime}</span>
        </div>
        <div className="mono text-[11px]">{active.primaryName}</div>
        <div className="text-dim">↔</div>
        <div className="mono text-[11px]">{active.secondaryName}</div>
        <div className="mt-2 grid grid-cols-2 gap-x-2 gap-y-0.5">
          <span className="text-dim">miss</span>
          <span className="mono">{active.minRangeKm.toFixed(3)} km</span>
          <span className="text-dim">TCA</span>
          <span className="mono">
            {new Date(active.epoch).toISOString().slice(0, 19)}Z
          </span>
          <span className="text-dim">Pc</span>
          <span className="mono">
            {active.probabilityOfCollision.toExponential(2)}
          </span>
          <span className="text-dim">v_rel</span>
          <span className="mono">
            {active.relativeVelocityKmps.toFixed(2)} km/s
          </span>
          <span className="text-dim">cov</span>
          <span className="mono">{active.covarianceQuality}</span>
          <span className="text-dim">src</span>
          <span className="mono">{active.pcMethod}</span>
          <span className="text-dim">upd</span>
          <span className="mono">
            {new Date(active.computedAt).toISOString().slice(0, 10)}
          </span>
          <span className="text-dim">action</span>
          <span className="mono uppercase">
            {active.action.replace(/_/g, " ")}
          </span>
        </div>
      </div>
    </Html>
  );
}
```

- [ ] **Step 2: Visual check**

Hover an arc → ✕ + info card appears with all fields filled from the live DB response.

- [ ] **Step 3: Commit**

```bash
git add apps/console/src/modes/ops/ConjunctionMarkers.tsx
git commit -m "feat(ops): full-SSA info card on conjunction hover"
```

---

### Task 14: Select-from-panel integration

**Files:**

- Modify: `apps/console/src/modes/ops/FindingsPanel.tsx` (or `OpsDrawer.tsx` — wherever conjunction rows render)

- [ ] **Step 1: Wire row click to `setSelectedConjunctionId`**

Find the row render for conjunctions and add:

```tsx
onClick={() => useUiStore.getState().setSelectedConjunctionId(row.id)}
```

Also clear on a "close" action:

```tsx
onClick={() => useUiStore.getState().setSelectedConjunctionId(null)}
```

- [ ] **Step 2: Visual check**

Click a conjunction row in the panel — the ✕ + card reveal themselves on the globe even without hover. Click again / close — they disappear.

- [ ] **Step 3: Commit**

```bash
git add apps/console/src/modes/ops
git commit -m "feat(ops): select conjunction from panel reveals marker + card"
```

---

## Phase 5 — Verification

### Task 15: Full-stack smoke test

- [ ] **Step 1: Ensure API + frontend running**

```bash
pnpm --filter @interview/console-api dev &
pnpm --filter @interview/console dev &
sleep 3
curl -s http://localhost:4000/api/conjunctions?minPc=0 | jq '.items[0]'
```

Expected: JSON row with `regime`, `covarianceQuality`, `action`, `computedAt`.

- [ ] **Step 2: Run every test**

```bash
pnpm --filter @interview/console test
pnpm --filter @interview/console-api test
pnpm --filter @interview/shared test
```

Expected: all green.

- [ ] **Step 3: Browser walkthrough**

In the OPS view:

1. Toggle `TRAILS: off` → no rings, no tails.
2. Toggle `TRAILS: tails` → fading tails behind sats.
3. Toggle `TRAILS: full` → full orbit rings per regime.
4. Hover a conjunction arc → ✕ + card with all 10 SSA fields.
5. Click a conjunction row in the panel → same ✕ + card, sticky.
6. Toggle regime visibility → sats + trails respect the filter.

All six must pass before marking the plan complete.

- [ ] **Step 4: Final commit**

```bash
git add -u
git commit --allow-empty -m "feat(ops): orbit trails + conjunction markers complete"
```

---

## Self-Review Notes

- Spec coverage: every section of the design (architecture, OrbitTrails, ConjunctionMarkers, data flow, error handling, testing) has at least one dedicated task. ✓
- No placeholders: every code step contains full code; every command has exact invocation and expected output. ✓
- Type consistency: `ConjunctionView` (shared) is the single DTO; `ConjunctionDTO` re-exports it; API output matches the schema (verified by Task 2's zod parse). ✓
- Regime filter vs trail mode: RegimeFilter stays responsible for per-regime visibility, `TrailModeToggle` is a separate control — no conflict. ✓
- Error handling: Task 9 wraps `orbitRing` in try/catch (skip degenerate). Task 12 skips sprites when TLE missing via `satById.get` guard. ✓
