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

type Params<F> = F extends (args: infer A) => unknown ? A : never;

/**
 * Pick the first numeric value from `raw` under any of the supplied key
 * aliases. Used to absorb planner drift (snake_case vs camelCase, synonymous
 * names like `window_days` vs `horizonDays`) without hardcoding the union
 * upstream at every skill.
 */
function pickNumber(
  raw: Record<string, unknown>,
  keys: string[],
): number | undefined {
  for (const k of keys) {
    const v = raw[k];
    if (typeof v === "number" && Number.isFinite(v)) return v;
    if (typeof v === "string" && v.trim() !== "" && !Number.isNaN(Number(v))) {
      return Number(v);
    }
  }
  return undefined;
}

export function buildCortexDataProvider(
  deps: CortexDataProviderDeps,
): CortexDataProvider {
  const { sourceData, satelliteAudit, satelliteEnrichment } = deps;
  const { orbitalAnalysis, opacity, conjunctionView } = deps;

  return {
    queryAdvisoryFeed: async (p) =>
      (await sourceData.listAdvisory(p as Params<typeof sourceData.listAdvisory>)).items,
    queryRssItems: async (p) =>
      (await sourceData.listRss(p as Params<typeof sourceData.listRss>)).items,
    queryManeuverPlan: async (p) =>
      (await sourceData.listManeuverSources(p as Params<typeof sourceData.listManeuverSources>)).items,
    queryObservationIngest: async (p) =>
      (await sourceData.listObservationSources(p as Params<typeof sourceData.listObservationSources>)).items,
    queryCorrelationMerge: async (p) =>
      (await sourceData.listCorrelationSources(p as Params<typeof sourceData.listCorrelationSources>)).items,
    queryOrbitalPrimer: async (p) =>
      (await sourceData.listOrbitalPrimer(p as Params<typeof sourceData.listOrbitalPrimer>)).items,

    queryDataAudit: async (p) =>
      (await satelliteAudit.auditData(p as Params<typeof satelliteAudit.auditData>)).items,
    queryClassificationAudit: async (p) =>
      (await satelliteAudit.auditClassification(p as Params<typeof satelliteAudit.auditClassification>)).items,
    queryApogeeHistory: async (p) =>
      (await satelliteAudit.listApogeeHistory(p as Params<typeof satelliteAudit.listApogeeHistory>)).items,

    queryCatalogIngest: async (p) =>
      (await satelliteEnrichment.catalogContext(p as Params<typeof satelliteEnrichment.catalogContext>)).items,
    queryReplacementCost: async (p) =>
      (await satelliteEnrichment.replacementCost(p as Params<typeof satelliteEnrichment.replacementCost>)).items,
    querySatelliteLaunchCostContext: async (p) =>
      (await satelliteEnrichment.launchCost(p as Params<typeof satelliteEnrichment.launchCost>)).items,
    queryPayloadProfile: async (p) =>
      (await satelliteEnrichment.payloadContext(p as Params<typeof satelliteEnrichment.payloadContext>)).items,

    queryOperatorFleet: async (p) =>
      (await orbitalAnalysis.analyzeFleet(p as Params<typeof orbitalAnalysis.analyzeFleet>)).items,
    queryRegimeProfile: async (p) =>
      (await orbitalAnalysis.profileRegime(p as Params<typeof orbitalAnalysis.profileRegime>)).items,
    queryOrbitSlotPlan: async (p) =>
      (await orbitalAnalysis.planSlots(p as Params<typeof orbitalAnalysis.planSlots>)).items,
    queryOrbitalTraffic: async (p) =>
      (await orbitalAnalysis.analyzeTraffic(p as Params<typeof orbitalAnalysis.analyzeTraffic>)).items,
    queryDebrisForecast: async (p) =>
      (await orbitalAnalysis.forecastDebris(p as Params<typeof orbitalAnalysis.forecastDebris>)).items,
    queryLaunchManifest: async (p) => {
      // Planners are LLMs and routinely emit param names that drift from
      // the helper signature (`window_days`, `windowDays`, `days`, `horizon`)
      // instead of `horizonDays`. Without normalization, the param is
      // silently dropped and the helper's default (30d) is used — so a
      // "next 7 days" query returns a 30-day manifest, and the LLM then
      // cites J+10 launches as in-window. Normalise every common variant.
      const raw = (p as Record<string, unknown>) ?? {};
      const horizonDays =
        pickNumber(raw, [
          "horizonDays",
          "horizon_days",
          "window_days",
          "windowDays",
          "days",
          "horizon",
        ]) ?? 14;
      const limit = pickNumber(raw, ["limit", "size_max", "sizeMax", "max"]) ?? 30;
      return (
        await orbitalAnalysis.launchManifest({
          horizonDays,
          limit,
        })
      ).items;
    },

    listOpacityCandidates: async (p) =>
      (await opacity.listCandidates(p as Params<typeof opacity.listCandidates>)).items,
    queryConjunctionScreen: async (p) =>
      (await conjunctionView.screen(p as Params<typeof conjunctionView.screen>)).items,
    queryConjunctionCandidatesKnn: async (p) =>
      (await conjunctionView.knnCandidates(p as Params<typeof conjunctionView.knnCandidates>)).items,
  };
}
