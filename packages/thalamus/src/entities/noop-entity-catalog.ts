import type {
  EntityCatalogPort,
  EntityRef,
} from "../ports/entity-catalog.port";

/**
 * Default `EntityCatalogPort` for kernel builds without a domain adapter.
 * Returns empty resolutions and cleans nothing — enough to keep the KG
 * write path green in tests and standalone demos. SSA + other domains
 * replace this with their own adapter at container boot.
 */
export class NoopEntityCatalog implements EntityCatalogPort {
  async resolveNames(_refs: EntityRef[]): Promise<Map<string, string>> {
    return new Map();
  }
  async cleanOrphans(): Promise<number> {
    return 0;
  }
}
