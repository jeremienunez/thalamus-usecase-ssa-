import { SatelliteAuditRepository } from "../repositories/satellite-audit.repository";

export class SatelliteAuditService {
  constructor(private readonly repo: SatelliteAuditRepository) {}

  async auditData(opts: { orbitRegime?: string; limit: number }) {
    return this.repo.auditDataCompleteness(opts);
  }

  async auditClassification(opts: { limit: number }) {
    return this.repo.auditClassification(opts);
  }

  async listApogeeHistory(opts: {
    noradId?: string;
    windowDays: number;
    limit: number;
  }) {
    return this.repo.listApogeeHistory(opts);
  }
}
