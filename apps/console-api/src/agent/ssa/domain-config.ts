/**
 * SSA DomainConfig builder.
 *
 * Bundles all SSA vocabulary + classifications + pre-built DAGs + prompts
 * into the single `DomainConfig` the kernel consumes. Swapping domains
 * (threat-intel, pharmacovigilance, etc.) = swap this one factory file.
 */

import type { DomainConfig } from "@interview/thalamus";
import { SSA_KEYWORDS } from "./vocabulary";
import {
  USER_SCOPED_CORTICES,
  WEB_ENRICHED_CORTICES,
  RELEVANCE_FILTERED_CORTICES,
  FALLBACK_CORTICES,
} from "./cortex-classifications";
import { SSA_DAEMON_DAGS } from "./daemon-dags";
import { ssaWebSearchPrompt } from "./web-search-prompt";
import { preSummarize } from "./pre-summarize";

/**
 * SSA-specific finding / edge vocabulary. Swapping this list to another
 * domain's entities (threat-indicator, drug-event, …) is how a non-SSA
 * deployment changes the finding-edge shape without touching the kernel.
 */
const SSA_ENTITY_TYPES = [
  "satellite",
  "operator",
  "operator_country",
  "launch",
  "satellite_bus",
  "payload",
  "orbit_regime",
  "conjunction_event",
  "maneuver",
  "finding",
];

/**
 * SSA domain sourcing rules injected into every LLM finding-generation
 * prompt. Extends the kernel's generic SOURCING RULE with SSA-specific
 * anti-hallucination constraints.
 *
 * The NORAD rule is the single most-violated invariant we observed: LLMs
 * will invent NORAD IDs (picking real historical catalog numbers from
 * training data) when asked to name specific satellites that aren't
 * present in DATA. This rule stops that at the prompt layer.
 */
const SSA_SOURCING_RULES = `
ENTITY ID FIDELITY (SSA):
- Every NORAD ID you cite in title / summary / evidence MUST come verbatim from the \`noradId\` field of a DATA row. If you mention a satellite by name (AQUA, COSMOS 2390, …), cite the \`noradId\` from the SAME DATA row — never compose a name from one row with an ID from another.
- If a DATA row has \`noradId: null\`, cite the satellite by name only and add "(NORAD unavailable)" — never fabricate a plausible-looking ID from memory (e.g. short historical catalog numbers like 99 / 184 / 3544 are training-data artefacts, not substitutes).
- Same rule applies to \`primary_norad_id\` and \`secondary_norad_id\` on conjunction rows — each NORAD ID must come from its row's own field.
- Never cite an operator name, mission name, or satellite name that doesn't appear verbatim in a DATA row.

MISSION NAME FIDELITY (SSA):
- Every mission / launch name you cite (e.g. "Kakushin Rising", "Starlink Group 17-22", "BlueBird Block 2 #2") MUST come verbatim from the \`name\` or \`missionName\` field of a DATA row. Never paraphrase, translate, shorten, or nickname.
  • WRONG: DATA says \`missionName: "Kakushin Rising (JAXA Rideshare)"\`, launch site is Mahia NZ → you emit "JAXA rideshare Kiwi". "Kiwi" is a New-Zealand nickname you composed from the launch site — not a mission name.
  • RIGHT: cite "Kakushin Rising" exactly as it appears in \`missionName\`.
- If the DATA row has both \`name\` and \`missionName\`, prefer \`missionName\` for the mission identity; use \`name\` only when \`missionName\` is null.

OPERATOR VS CUSTOMER (SSA):
- The launch OPERATOR is the entity that builds and flies the rocket — cite it verbatim from \`operatorName\`. The operator's country comes from \`operatorCountry\` (ISO-2).
- Rideshare / contract missions also name a CUSTOMER (e.g. JAXA, NASA, ESA, USSF) — this entity is mentioned in \`missionName\` or \`missionDescription\`, NOT in \`operatorName\`. Never substitute the customer for the operator.
  • WRONG: DATA has \`operatorName: "Rocket Lab", operatorCountry: "US"\` and \`missionName: "Kakushin Rising (JAXA Rideshare)"\` → you emit "operator: JAXA, country: Japan". JAXA is the payload customer; Rocket Lab is the operator.
  • RIGHT: emit "operator: Rocket Lab, country: US. Payload customer: JAXA".

NUMERIC FIDELITY (SSA):
- Ratios between countries / regimes / operators ("China vs USA debris ×2.3") require BOTH numerator and denominator to come from DATA rows — not from "I remember roughly that China has more debris".
- Percentage changes over a time window require a before-row AND after-row, both in DATA.
- Any multiplier, ratio, or percentage you cite MUST be derivable from at least TWO explicit numeric values present in DATA rows (numerator AND denominator). This applies to temporal projections too: "densité ×200 future vs actuelle" requires both a baseline row and a target row, with numbers in both. If you cannot identify both, state the claim qualitatively ("significant increase", "major deployment") — never attach an invented numeric factor.
- Never cite tool / model / standard names (ORDEM 3.x, DAS 3.0, NASA-SBN, SGP4 parameters) unless they appear verbatim in a DATA row's evidence.
`.trim();

export function buildSsaDomainConfig(): DomainConfig {
  return {
    keywords: SSA_KEYWORDS,
    userScopedCortices: USER_SCOPED_CORTICES,
    webEnrichedCortices: WEB_ENRICHED_CORTICES,
    relevanceFilteredCortices: RELEVANCE_FILTERED_CORTICES,
    fallbackCortices: FALLBACK_CORTICES,
    daemonDags: SSA_DAEMON_DAGS,
    webSearchPrompt: ssaWebSearchPrompt,
    preSummarize,
    sourcingRules: SSA_SOURCING_RULES,
    entityTypes: SSA_ENTITY_TYPES,
  };
}
