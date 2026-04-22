/**
 * SimTargetService — server-side composer for the `targets` bag served
 * at `GET /api/sim/runs/:simRunId/targets` (§5.7 of the HTTP contract).
 *
 * Given a sim_run id, reads its seed_applied JSONB and composes up to two
 * sub-bags:
 *   - `telemetryTarget` — populated iff seed.telemetryTargetSatelliteId
 *     is set (loaded via SatelliteRepository.findByIdFull with busName
 *     from Plan 5 · 1.A.7).
 *   - `pcEstimatorTarget` — populated iff seed.pcEstimatorTarget is set
 *     (loaded via ConjunctionRepository.findByIdWithSatellites from
 *     Plan 5 · 1.A.8).
 *
 * Introduced: Plan 5 Task 1.B.7 (DIP-refactored by 1.B cleanup).
 */

import type { FindByIdFullRow } from "../types/satellite.types";
import type { ConjunctionWithSatellitesRow } from "../types/conjunction.types";
import type { SimRunRow } from "../types/sim-run.types";
import type {
  PcEstimatorTargetView,
  SimTargetsBag,
  TelemetryTargetView,
} from "../types/sim-target.types";
import type { SsaSeedRefs } from "../agent/ssa/sim/action-schema";

// ── Ports (structural — repos satisfy these by duck typing) ─────────

export interface SimRunSeedReadPort {
  findById(simRunId: bigint): Promise<Pick<SimRunRow, "seedApplied"> | null>;
}

export interface SatelliteFullReadPort {
  findByIdFull(id: bigint | number): Promise<FindByIdFullRow | null>;
}

export interface ConjunctionWithSatellitesReadPort {
  findByIdWithSatellites(
    conjunctionId: bigint,
  ): Promise<ConjunctionWithSatellitesRow | null>;
}

export class SimTargetService {
  constructor(
    private readonly simRunRepo: SimRunSeedReadPort,
    private readonly satelliteRepo: SatelliteFullReadPort,
    private readonly conjunctionRepo: ConjunctionWithSatellitesReadPort,
  ) {}

  async loadTargets(simRunId: bigint): Promise<SimTargetsBag> {
    const run = await this.simRunRepo.findById(simRunId);
    if (!run) throw notFound(simRunId);
    const seed = run.seedApplied as SsaSeedRefs;
    const [telemetryTarget, pcEstimatorTarget] = await Promise.all([
      this.composeTelemetryTarget(seed),
      this.composePcTarget(seed),
    ]);
    return { telemetryTarget, pcEstimatorTarget };
  }

  // -------------------------------------------------------------------
  // Internals
  // -------------------------------------------------------------------

  private async composeTelemetryTarget(
    seed: SsaSeedRefs,
  ): Promise<TelemetryTargetView | null> {
    const satelliteId = seed.telemetryTargetSatelliteId;
    if (satelliteId == null) return null;

    const full = await this.satelliteRepo.findByIdFull(BigInt(satelliteId));
    if (!full) {
      return {
        satelliteId,
        satelliteName: `(unknown sat id=${satelliteId})`,
        noradId: null,
        regime: null,
        launchYear: null,
        busArchetype: seed.busDatasheetPrior?.busArchetype ?? null,
        busDatasheetPrior:
          (seed.busDatasheetPrior?.scalars as TelemetryTargetView["busDatasheetPrior"]) ??
          null,
        sources: [],
      };
    }

    return {
      satelliteId: Number(full.id),
      satelliteName: full.name,
      noradId: full.noradId,
      regime: full.orbitRegimeName,
      launchYear: full.launchYear,
      busArchetype: seed.busDatasheetPrior?.busArchetype ?? full.busName,
      busDatasheetPrior:
        (seed.busDatasheetPrior?.scalars as TelemetryTargetView["busDatasheetPrior"]) ??
        null,
      sources: [],
    };
  }

  private async composePcTarget(
    seed: SsaSeedRefs,
  ): Promise<PcEstimatorTargetView | null> {
    const conjId = seed.pcEstimatorTarget;
    if (conjId == null) return null;

    const conj = await this.conjunctionRepo.findByIdWithSatellites(BigInt(conjId));
    if (!conj) {
      return {
        conjunctionId: conjId,
        tca: null,
        missDistanceKm: null,
        relativeVelocityKmps: null,
        currentPc: null,
        hardBodyRadiusMeters: null,
        combinedSigmaKm: null,
        primary: { id: 0, name: `(unknown conj=${conjId})`, noradId: null, bus: null },
        secondary: { id: 0, name: "(unknown)", noradId: null, bus: null },
        assumptions:
          (seed.pcAssumptions as PcEstimatorTargetView["assumptions"]) ?? null,
      };
    }

    return {
      conjunctionId: Number(conj.id),
      tca: conj.epoch,
      missDistanceKm: conj.minRangeKm,
      relativeVelocityKmps: conj.relativeVelocityKmps,
      currentPc: conj.probabilityOfCollision,
      hardBodyRadiusMeters: conj.hardBodyRadiusM,
      combinedSigmaKm: conj.combinedSigmaKm,
      primary: {
        id: Number(conj.primary.id),
        name: conj.primary.name ?? `sat#${conj.primary.id}`,
        noradId: conj.primary.noradId,
        bus: conj.primary.busName,
      },
      secondary: {
        id: Number(conj.secondary.id),
        name: conj.secondary.name ?? `sat#${conj.secondary.id}`,
        noradId: conj.secondary.noradId,
        bus: conj.secondary.busName,
      },
      assumptions:
        (seed.pcAssumptions as PcEstimatorTargetView["assumptions"]) ?? null,
    };
  }
}

function notFound(simRunId: bigint): Error {
  const e = new Error(`sim_run ${simRunId} not found`);
  (e as Error & { statusCode?: number }).statusCode = 404;
  return e;
}
