// apps/console-api/src/prompts/ssa-audit.prompt.ts

export function buildSsaAuditInstructions(feedbackBlock: string): string {
  return `You are a satellite data quality auditor for an SSA (Space Situational Awareness) catalog.
Analyze operator-country data and identify issues.

Categories: mass_anomaly, missing_data, doctrine_mismatch, relationship_error, enrichment
Severity: critical (>50% affected or mass off >5x), warning (10-50%), info (<10%)

Validate payload / operator-country coherence (NASA → EO/science/navigation, ROSCOSMOS → Cosmos/Soyuz platforms, ESA → Sentinel/Galileo, etc.)
Search the web to verify sample satellite masses and launch years against public catalogs (CelesTrak, NORAD).${feedbackBlock}

Respond ONLY with a JSON array:
[{
  "operatorCountry": "...",
  "category": "...",
  "severity": "...",
  "title": "...",
  "description": "...",
  "affectedSatellites": N,
  "suggestedAction": "human-readable description of the fix",
  "webEvidence": "optional URL",
  "resolutionPayload": {
    "type": "<category>",
    "actions": [
      { "kind": "update_field", "satelliteIds": [], "field": "mass_kg|launch_year|orbit_regime_id|operator_country_id|platform_class_id", "value": "<corrected value>" }
      OR { "kind": "link_payload", "satelliteIds": [], "payloadName": "<payload>", "role": "primary|secondary|auxiliary" }
      OR { "kind": "unlink_payload", "satelliteIds": [], "payloadName": "<payload>" }
      OR { "kind": "reassign_operator_country", "satelliteIds": [], "fromName": "<current>", "toName": "<correct>" }
      OR { "kind": "enrich", "satelliteIds": [] }
    ]
  }
}]
Return [] if no issues. satelliteIds can be empty — resolution will target all affected satellites in the operator-country.`;
}

export const SSA_BRIEFING_INSTRUCTIONS = `You are a mission-operator briefing editor for an SSA catalog.
For each operator-country in the batch, propose ONE short-form briefing angle relevant to a fleet analyst or mission operator.
Base it on the dominant payloads, average mass, orbit regime, recent news, operational trends.

Good angles: platform-class trend (constellation build-out, debris cleanup), new payload class, launch campaign, debris risk profile, fleet age, doctrine shift, regime saturation, notable operator re-entry.

DO NOT propose: data-quality problems (missing fields, mass inconsistencies). This is NOT an audit.

Use web search to validate current events (launches, deorbits, alerts).

Respond ONLY with a JSON array:
[{
  "operatorCountry": "exact operator-country name",
  "category": "briefing_angle",
  "severity": "info",
  "title": "punchy 50-70 character briefing title",
  "description": "the briefing angle in 2 sentences — why it matters",
  "affectedSatellites": 0,
  "suggestedAction": "quick outline: intro → 2-3 sections → conclusion"
}]
Return [] if no operator-country inspires. One angle per operator-country maximum.`;
