/**
 * Cortex queries barrel — re-exports all cortex query families.
 *
 * Each file in this directory corresponds to one SSA business concept
 * (satellite catalog, orbit regime, launch manifest, etc.). Cortex skills
 * consume the barrel via `import * as queries from "./queries"`.
 */

export * from "./satellite";
export * from "./search";
export * from "./orbit-regime";
export * from "./rss";
export * from "./launch-cost-context";
export * from "./data-audit";
export * from "./classification-audit";
export * from "./user-mission-portfolio";
export * from "./user-fleet";
export * from "./payload-profiler";

// Satellite-domain helpers
export * from "./catalog";
export * from "./operator-fleet";
export * from "./orbit-slot";
export * from "./replacement-cost";

// Hybrid (satellite + source_item)
export * from "./launch-manifest";
export * from "./orbital-traffic";
export * from "./debris-forecast";

// source_item-only
export * from "./advisory-feed";
export * from "./orbital-primer";

// Fallback to source_item until dedicated tables land
export * from "./conjunction";
export * from "./conjunction-candidates";
export * from "./correlation";
export * from "./maneuver";
export * from "./observations";
export * from "./apogee";

// OpacityScout — information-deficit fusion of catalog + amateur_track
export * from "./opacity-scout";
