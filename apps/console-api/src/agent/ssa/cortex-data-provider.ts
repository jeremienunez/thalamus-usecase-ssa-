/**
 * CortexDataProvider — SSA adapter.
 *
 * Maps skill-frontmatter `sqlHelper` names → typed service calls.
 * The kernel consumes this as an opaque Record; every entry returns
 * `unknown[]` because cortex params flow from LLM output and the kernel
 * doesn't know the domain types. Services enforce their own contracts.
 *
 * Also fixes 4 historical frontmatter ↔ function-name mismatches
 * (queryDataAudit, queryClassificationAudit, queryPayloadProfile,
 * queryRegimeProfile) that used to silently return empty data.
 */

import type { CortexDataProvider } from "@interview/thalamus";
import type { SourceDataService } from "../../services/source-data.service";
import type { SatelliteAuditService } from "../../services/satellite-audit.service";
import type { SatelliteEnrichmentService } from "../../services/satellite-enrichment.service";
import type { OrbitalAnalysisService } from "../../services/orbital-analysis.service";
import type { OpacityService } from "../../services/opacity.service";
import type { ConjunctionViewService } from "../../services/conjunction-view.service";

export interface CortexDataProviderDeps {
  sourceData: SourceDataService;
  satelliteAudit: SatelliteAuditService;
  satelliteEnrichment: SatelliteEnrichmentService;
  orbitalAnalysis: OrbitalAnalysisService;
  opacity: OpacityService;
  conjunctionView: ConjunctionViewService;
}

/**
 * `as never` at each call site: params come from LLM-produced skill
 * plans. The kernel passes them through as `Record<string, unknown>`;
 * services re-validate at their boundary. Explicit `never` over `any`
 * so the cast is visible to readers.
 */
export function buildCortexDataProvider(
  deps: CortexDataProviderDeps,
): CortexDataProvider {
  const { sourceData, satelliteAudit, satelliteEnrichment } = deps;
  const { orbitalAnalysis, opacity, conjunctionView } = deps;

  return {
    // sources
    queryAdvisoryFeed: async (p) =>
      (await sourceData.listAdvisory(p as never)).items,
    queryRssItems: async (p) => (await sourceData.listRss(p as never)).items,
    queryManeuverPlan: async (p) =>
      (await sourceData.listManeuverSources(p as never)).items,
    queryObservationIngest: async (p) =>
      (await sourceData.listObservationSources(p as never)).items,
    queryCorrelationMerge: async (p) =>
      (await sourceData.listCorrelationSources(p as never)).items,
    queryOrbitalPrimer: async (p) =>
      (await sourceData.listOrbitalPrimer(p as never)).items,
    // satellite audit — fixes frontmatter name mismatches
    queryDataAudit: async (p) =>
      (await satelliteAudit.auditData(p as never)).items,
    queryClassificationAudit: async (p) =>
      (await satelliteAudit.auditClassification(p as never)).items,
    queryApogeeHistory: async (p) =>
      (await satelliteAudit.listApogeeHistory(p as never)).items,
    // satellite enrichment
    queryCatalogIngest: async (p) =>
      (await satelliteEnrichment.catalogContext(p as never)).items,
    queryReplacementCost: async (p) =>
      (await satelliteEnrichment.replacementCost(p as never)).items,
    querySatelliteLaunchCostContext: async (p) =>
      (await satelliteEnrichment.launchCost(p as never)).items,
    queryPayloadProfile: async (p) =>
      (await satelliteEnrichment.payloadContext(p as never)).items,
    // orbital analysis
    queryOperatorFleet: async (p) =>
      (await orbitalAnalysis.analyzeFleet(p as never)).items,
    queryRegimeProfile: async (p) =>
      (await orbitalAnalysis.profileRegime(p as never)).items,
    queryOrbitSlotPlan: async (p) =>
      (await orbitalAnalysis.planSlots(p as never)).items,
    queryOrbitalTraffic: async (p) =>
      (await orbitalAnalysis.analyzeTraffic(p as never)).items,
    queryDebrisForecast: async (p) =>
      (await orbitalAnalysis.forecastDebris(p as never)).items,
    queryLaunchManifest: async (p) =>
      (await orbitalAnalysis.launchManifest(p as never)).items,
    // opacity + conjunctions
    listOpacityCandidates: (p) =>
      opacity.listCandidates(p as never) as Promise<unknown[]>,
    queryConjunctionScreen: (p) =>
      conjunctionView.screen(p as never) as Promise<unknown[]>,
    queryConjunctionCandidatesKnn: (p) =>
      conjunctionView.knnCandidates(p as never) as Promise<unknown[]>,
  };
}
