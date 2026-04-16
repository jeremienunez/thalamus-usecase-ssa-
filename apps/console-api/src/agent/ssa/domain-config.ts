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
  };
}
