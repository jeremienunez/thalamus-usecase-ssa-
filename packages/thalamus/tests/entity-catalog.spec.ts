/**
 * EntityCatalogPort — Phase 3 · Task 3.1 of thalamus agnosticity cleanup.
 *
 * The port lets the kernel resolve KG-edge display names and clean orphan
 * edges without hardcoding SSA tables (satellite, operator, orbit_regime…).
 * Each domain ships its own adapter. The package ships a Noop default so
 * standalone usage (tests, non-cycle CLIs) stays runnable.
 */

import { describe, it, expect } from "vitest";
import {
  NoopEntityCatalog,
  type EntityCatalogPort,
  type EntityRef,
} from "../src";

describe("NoopEntityCatalog — default when no domain adapter is injected", () => {
  it("returns an empty Map for any batch of refs", async () => {
    const c: EntityCatalogPort = new NoopEntityCatalog();
    const refs: EntityRef[] = [
      { entityType: "satellite", entityId: 1n },
      { entityType: "operator", entityId: 42n },
    ];
    const result = await c.resolveNames(refs);
    expect(result.size).toBe(0);
  });

  it("reports zero cleaned orphans", async () => {
    const c: EntityCatalogPort = new NoopEntityCatalog();
    expect(await c.cleanOrphans()).toBe(0);
  });

  it("accepts an empty batch without throwing", async () => {
    const c: EntityCatalogPort = new NoopEntityCatalog();
    const result = await c.resolveNames([]);
    expect(result.size).toBe(0);
  });
});
