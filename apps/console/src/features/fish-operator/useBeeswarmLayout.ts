import { useMemo } from "react";
import {
  forceCollide,
  forceSimulation,
  forceX,
  forceY,
  type SimulationNodeDatum,
} from "d3-force";
import type { FishSceneModel, FishSceneNode } from "./fish-scene-model";

export interface BeeswarmDot {
  fishIndex: number;
  cx: number;
  cy: number;
  r: number;
  fill: string;
  stroke: string | null;
  strokeOpacity: number;
  isVisible: boolean;
}

export interface BeeswarmBand {
  key: string;
  label: string;
  count: number;
  y0: number;
  y1: number;
  isUnclustered: boolean;
}

export interface BeeswarmLayout {
  dots: BeeswarmDot[];
  bands: BeeswarmBand[];
  width: number;
  height: number;
  padding: { left: number; right: number; top: number; bottom: number };
}

export interface BeeswarmInput {
  width: number;
  height: number;
  model: FishSceneModel | null;
}

const MIN_BAND = 56;
const PADDING = { left: 96, right: 32, top: 36, bottom: 40 };
const RADIUS_RANGE: readonly [number, number] = [3.5, 8];
const COLLISION_PADDING = 1.5;
const TICK_COUNT = 160;

interface SimNode extends SimulationNodeDatum {
  fishIndex: number;
  bandY: number;
  targetX: number;
  r: number;
}

export function useBeeswarmLayout(input: BeeswarmInput): BeeswarmLayout {
  return useMemo(() => computeBeeswarmLayout(input), [input.model, input.width, input.height]);
}

export function computeBeeswarmLayout(input: BeeswarmInput): BeeswarmLayout {
  const { width, height, model } = input;
  if (!model) {
    return { dots: [], bands: [], width, height, padding: PADDING };
  }

  const innerWidth = Math.max(1, width - PADDING.left - PADDING.right);
  const innerHeight = Math.max(1, height - PADDING.top - PADDING.bottom);

  const bands = computeBands(model, innerHeight);
  const bandByKey = new Map(bands.map((b) => [b.key, b]));

  const radiusFor = makeRadiusScale(model.nodes);

  const visibleSet = new Set(model.visibleNodes.map((n) => n.id));
  const visibleNodes = model.nodes.filter((n) => visibleSet.has(n.id));

  // Bucket nodes by (band, rounded turnProgress). Any bucket with >1 fish is
  // a "stack" — their X targets collapse on top of each other. We replace
  // those identical targets with an evenly-distributed micro-spread so the
  // operator sees the cohort as a horizontal column rather than a single dot.
  // This handles the all-terminated, uniform-progress case where the entire
  // swarm has the same turnProgress and would otherwise pile on one X.
  const bucketKey = (band: string, progress: number): string =>
    `${band}|${Math.round(progress * 1000) / 1000}`;
  const bucketCounts = new Map<string, number>();
  for (const node of visibleNodes) {
    const k = bucketKey(bandKeyOf(node), node.turnProgress);
    bucketCounts.set(k, (bucketCounts.get(k) ?? 0) + 1);
  }
  const bucketCursors = new Map<string, number>();

  // Width of the micro-spread (in pixels) for a stacked cohort. Capped so a
  // single uniform-progress cohort still reads as "all near this progress".
  const COHORT_SPREAD = Math.min(innerWidth * 0.6, 480);
  // If a cohort represents >50% of the band, expand the spread so they fill
  // the plot — which is the case the user is hitting (100% of fish at 1.0).
  const bandCounts = new Map<string, number>();
  for (const node of visibleNodes) {
    const key = bandKeyOf(node);
    bandCounts.set(key, (bandCounts.get(key) ?? 0) + 1);
  }

  const simNodes: SimNode[] = visibleNodes.map((node) => {
    const key = bandKeyOf(node);
    const band = bandByKey.get(key) ?? bands[bands.length - 1];
    if (!band) {
      return {
        fishIndex: node.fishIndex,
        bandY: 0,
        targetX: 0,
        r: radiusFor(node.costScore),
      };
    }
    const baseX = PADDING.left + node.turnProgress * innerWidth;
    const k = bucketKey(key, node.turnProgress);
    const cohortSize = bucketCounts.get(k) ?? 1;
    let targetX = baseX;
    if (cohortSize > 1) {
      const cursor = bucketCursors.get(k) ?? 0;
      bucketCursors.set(k, cursor + 1);
      const t = cohortSize <= 1 ? 0.5 : cursor / (cohortSize - 1);
      // If the cohort is the whole band, span the full inner width centered.
      const bandTotal = bandCounts.get(key) ?? cohortSize;
      const spreadWidth =
        cohortSize >= bandTotal * 0.9
          ? innerWidth - 24
          : Math.min(COHORT_SPREAD, innerWidth - 24);
      const cohortLeft = Math.max(
        PADDING.left + 12,
        Math.min(width - PADDING.right - 12 - spreadWidth, baseX - spreadWidth / 2),
      );
      targetX = cohortLeft + t * spreadWidth;
    }
    const bandY = (band.y0 + band.y1) / 2 + PADDING.top;
    return {
      fishIndex: node.fishIndex,
      bandY,
      targetX,
      x: targetX,
      y: bandY,
      r: radiusFor(node.costScore),
    };
  });

  const sim = forceSimulation<SimNode>(simNodes)
    .force("x", forceX<SimNode>((d) => d.targetX).strength(0.85))
    .force("y", forceY<SimNode>((d) => d.bandY).strength(0.18))
    .force(
      "collide",
      forceCollide<SimNode>((d) => d.r + COLLISION_PADDING).iterations(2),
    )
    .stop();

  const xMin = PADDING.left;
  const xMax = width - PADDING.right;
  for (let i = 0; i < TICK_COUNT; i++) {
    sim.tick();
    for (const sn of simNodes) {
      if (typeof sn.x === "number") {
        if (sn.x < xMin + sn.r) sn.x = xMin + sn.r;
        else if (sn.x > xMax - sn.r) sn.x = xMax - sn.r;
      }
    }
  }

  const positionByIndex = new Map<number, { cx: number; cy: number; r: number }>();
  for (const sn of simNodes) {
    const cx = typeof sn.x === "number" && Number.isFinite(sn.x) ? sn.x : sn.targetX;
    const cy = typeof sn.y === "number" && Number.isFinite(sn.y) ? sn.y : sn.bandY;
    positionByIndex.set(sn.fishIndex, { cx, cy, r: sn.r });
  }

  const dots: BeeswarmDot[] = model.nodes.map((node) => {
    const placed = positionByIndex.get(node.fishIndex);
    const fallback = { cx: PADDING.left, cy: PADDING.top, r: radiusFor(node.costScore) };
    const placement = placed ?? fallback;
    return {
      fishIndex: node.fishIndex,
      cx: placement.cx,
      cy: placement.cy,
      r: placement.r,
      fill: node.color,
      stroke: strokeFor(node),
      strokeOpacity: node.terminalActionKind === "maneuver" ? 1 : 0.6,
      isVisible: visibleSet.has(node.id),
    };
  });

  return { dots, bands, width, height, padding: PADDING };
}

function computeBands(model: FishSceneModel, innerHeight: number): BeeswarmBand[] {
  const counts = model.summary.byCluster;

  const ordered = Object.entries(counts)
    .filter(([key]) => key !== "unclustered")
    .sort((a, b) => b[1] - a[1])
    .map(([key, count]) => ({ key, count, isUnclustered: false }));

  const unclusteredCount = counts["unclustered"] ?? 0;
  // When the swarm has no clusters at all, treat everyone as one band keyed
  // "unclustered" so bandKeyOf(node) matches.
  if (ordered.length === 0) {
    return [
      {
        key: "unclustered",
        label: "All fish",
        count: model.summary.total,
        y0: 0,
        y1: innerHeight,
        isUnclustered: true,
      },
    ];
  }

  if (unclusteredCount > 0) {
    ordered.push({ key: "unclustered", count: unclusteredCount, isUnclustered: true });
  }

  // Reserve unclustered band at MIN_BAND, distribute the rest proportionally.
  const reservedForUnclustered = ordered.some((b) => b.isUnclustered) ? MIN_BAND : 0;
  const remaining = Math.max(0, innerHeight - reservedForUnclustered);
  const proportionable = ordered.filter((b) => !b.isUnclustered);
  const propTotal = Math.max(1, proportionable.reduce((acc, b) => acc + b.count, 0));

  // First pass: proportional with MIN_BAND floor.
  let allocated = 0;
  const heights = proportionable.map((b) => {
    const proportional = remaining * (b.count / propTotal);
    const h = Math.max(MIN_BAND, proportional);
    allocated += h;
    return h;
  });

  // If proportional+floors overshoot remaining, scale down (but never below MIN_BAND).
  if (allocated > remaining && proportionable.length > 0) {
    const overshoot = allocated - remaining;
    const slack = heights.reduce((acc, h) => acc + Math.max(0, h - MIN_BAND), 0);
    if (slack > 0) {
      for (let i = 0; i < heights.length; i++) {
        const headroom = Math.max(0, (heights[i] ?? MIN_BAND) - MIN_BAND);
        const cut = (headroom / slack) * overshoot;
        heights[i] = Math.max(MIN_BAND, (heights[i] ?? MIN_BAND) - cut);
      }
    }
  }

  const bands: BeeswarmBand[] = [];
  let cursor = 0;
  for (let i = 0; i < proportionable.length; i++) {
    const meta = proportionable[i];
    const height = heights[i];
    if (!meta || height === undefined) continue;
    bands.push({
      key: meta.key,
      label: meta.key,
      count: meta.count,
      y0: cursor,
      y1: cursor + height,
      isUnclustered: false,
    });
    cursor += height;
  }
  if (reservedForUnclustered > 0) {
    bands.push({
      key: "unclustered",
      label: "Unclustered",
      count: unclusteredCount,
      y0: cursor,
      y1: cursor + reservedForUnclustered,
      isUnclustered: true,
    });
  }

  return bands;
}

function bandKeyOf(node: FishSceneNode): string {
  return node.clusterLabel ?? "unclustered";
}

function makeRadiusScale(nodes: FishSceneNode[]): (cost: number) => number {
  let max = 0;
  for (const n of nodes) {
    if (n.costScore > max) max = n.costScore;
  }
  if (max <= 0) return () => RADIUS_RANGE[0];
  const [rMin, rMax] = RADIUS_RANGE;
  return (cost) => {
    const t = cost <= 0 ? 0 : Math.min(1, cost / max);
    return rMin + t * (rMax - rMin);
  };
}

function strokeFor(node: FishSceneNode): string | null {
  if (!node.terminalActionKind) return null;
  if (node.terminalActionKind === "maneuver") return darken(node.color, 0.35);
  return darken(node.color, 0.2);
}

function darken(hex: string, amount: number): string {
  const m = /^#([0-9a-f]{6})$/i.exec(hex);
  if (!m || !m[1]) return hex;
  const v = parseInt(m[1], 16);
  const r = Math.max(0, Math.round(((v >> 16) & 0xff) * (1 - amount)));
  const g = Math.max(0, Math.round(((v >> 8) & 0xff) * (1 - amount)));
  const b = Math.max(0, Math.round((v & 0xff) * (1 - amount)));
  return `#${[r, g, b].map((c) => c.toString(16).padStart(2, "0")).join("")}`;
}
