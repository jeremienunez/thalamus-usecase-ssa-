import {
  toSatelliteDataAuditView,
  toSatelliteClassificationAuditView,
  toApogeeHistoryView,
} from "../transformers/satellite-audit.transformer";
import type {
  SatelliteDataAuditRow,
  SatelliteClassificationAuditRow,
  ApogeeHistoryRow,
  SatelliteDataAuditView,
  SatelliteClassificationAuditView,
  ApogeeHistoryView,
} from "../types/satellite-audit.types";

// ── Port (structural — repos satisfy by duck typing) ──────────────
export interface SatelliteAuditReadPort {
  auditDataCompleteness(opts: {
    orbitRegime?: string;
    limit?: number;
  }): Promise<SatelliteDataAuditRow[]>;
  auditClassification(opts: {
    limit?: number;
  }): Promise<SatelliteClassificationAuditRow[]>;
  listApogeeHistory(opts: {
    noradId?: string | number;
    windowDays?: number;
    limit?: number;
  }): Promise<ApogeeHistoryRow[]>;
}

export type SatelliteAuditPage<T> = {
  items: T[];
  count: number;
};

export class SatelliteAuditService {
  constructor(private readonly repo: SatelliteAuditReadPort) {}

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
