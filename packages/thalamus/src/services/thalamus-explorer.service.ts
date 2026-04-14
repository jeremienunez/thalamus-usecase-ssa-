/**
 * Thalamus Explorer Service — service-layer façade for the exploration pipeline.
 *
 * Pipeline lives in agent/cortices/explorer/ (scout → crawler → curator).
 * This service handles DI wiring and exposes a clean entry point.
 */

import type { Database } from "@interview/db-schema";
import { ExplorationRepository } from "../repositories/exploration.repository";
import { ExplorerOrchestrator } from "../explorer/orchestrator";

export class ThalamusExplorerService {
  private orchestrator: ExplorerOrchestrator;

  constructor(db: Database) {
    const explorationRepo = new ExplorationRepository(db);
    this.orchestrator = new ExplorerOrchestrator(db, explorationRepo);
  }

  async explore() {
    return this.orchestrator.explore();
  }
}
