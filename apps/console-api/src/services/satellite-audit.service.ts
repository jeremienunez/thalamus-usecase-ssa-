import { SatelliteAuditRepository } from "../repositories/satellite-audit.repository";
import {
  toSatelliteDataAuditView,
  toSatelliteClassificationAuditView,
  toApogeeHistoryView,
  type SatelliteDataAuditView,
  type SatelliteClassificationAuditView,
  type ApogeeHistoryView,
} from "../transformers/satellite-audit.transformer";

export type SatelliteAuditPage<T> = {
  items: T[];
  count: number;
};

export class SatelliteAuditService {
  constructor(private readonly repo: SatelliteAuditRepository) {}

  async auditData(opts: {
    orbitRegime?: string;
    limit: number;
  }): Promise<SatelliteAuditPage<SatelliteDataAuditView>> {
    const rows = await this.repo.auditDataCompleteness(opts);
    const items = rows.map(toSatelliteDataAuditView);
    return { items, count: items.length };
  }

  async auditClassification(opts: {
    limit: number;
  }): Promise<SatelliteAuditPage<SatelliteClassificationAuditView>> {
    const rows = await this.repo.auditClassification(opts);
    const items = rows.map(toSatelliteClassificationAuditView);
    return { items, count: items.length };
  }

  async listApogeeHistory(opts: {
    noradId?: string;
    windowDays: number;
    limit: number;
  }): Promise<SatelliteAuditPage<ApogeeHistoryView>> {
    const rows = await this.repo.listApogeeHistory(opts);
    const items = rows.map(toApogeeHistoryView);
    return { items, count: items.length };
  }
}
