import { createLogger } from "@interview/shared/observability";
import type { EntityCatalogPort } from "../ports/entity-catalog.port";
import type { FindingsGraphPort } from "./research-graph.types";

const logger = createLogger("finding-archive");

export class FindingArchiveService {
  constructor(
    private readonly findingRepo: FindingsGraphPort,
    private readonly entityCatalog: EntityCatalogPort,
  ) {}

  async archiveFinding(id: bigint): Promise<void> {
    await this.findingRepo.archive(id);
  }

  async expireAndClean(): Promise<{ expired: number; orphans: number }> {
    const expired = await this.findingRepo.expireOld();
    const orphans = await this.entityCatalog.cleanOrphans();
    logger.info({ expired, orphans }, "Expire and clean completed");
    return { expired, orphans };
  }
}
