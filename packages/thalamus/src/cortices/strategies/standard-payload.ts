import type { CortexInput, DomainConfig } from "../types";
import { sanitizeDataPayload, sanitizeText } from "../guardrails";

export function buildStandardDataPayload({
  domainConfig,
  cortexName,
  authoritativeData,
  webData,
  previousFindings,
}: {
  domainConfig: DomainConfig;
  cortexName: string;
  authoritativeData: unknown[];
  webData: unknown[];
  previousFindings: CortexInput["context"] extends infer C
    ? C extends { previousFindings?: infer F }
      ? F
      : never
    : never;
}): {
  dataPayload: string;
  injections: number;
  filtered: number;
} {
  const authoritative = domainConfig.preSummarize(
    authoritativeData as Record<string, unknown>[],
    cortexName,
  );
  const webContext =
    webData.length > 0
      ? domainConfig.preSummarize(
          webData as Record<string, unknown>[],
          cortexName,
        )
      : [];

  const { sanitized: authoritativePayload, stats } = sanitizeDataPayload(
    authoritative,
    {
      maxItems: 30,
      requireDomainRelevance:
        domainConfig.relevanceFilteredCortices.has(cortexName),
      keywords: domainConfig.keywords,
    },
  );
  const webPayload =
    webContext.length > 0
      ? sanitizeDataPayload(webContext, {
          maxItems: 10,
          requireDomainRelevance:
            domainConfig.relevanceFilteredCortices.has(cortexName),
          keywords: domainConfig.keywords,
        }).sanitized
      : "";

  const contextBlock = buildContextBlock(previousFindings);
  const tieredPayload = webPayload
    ? `## AUTHORITATIVE DATA (from internal SQL + structured sources — scoped by query params)\n${authoritativePayload}\n\n## WEB CONTEXT (unfiltered web-search snippets — advisory only, may include out-of-scope items)\n${webPayload}\n\nIMPORTANT: Ground every finding in AUTHORITATIVE DATA. Use WEB CONTEXT only to cross-reference or flag uncertainty — never cite a specific launch/event/number that appears ONLY in WEB CONTEXT as if it were in scope.`
    : authoritativePayload;

  return {
    dataPayload: tieredPayload + contextBlock,
    injections: stats.injections,
    filtered: stats.filtered,
  };
}

function buildContextBlock(previousFindings: CortexInput["context"] extends infer C
  ? C extends { previousFindings?: infer F }
    ? F
    : never
  : never): string {
  if (!previousFindings?.length) return "";
  const cleanFindings = previousFindings.map((f) => ({
    title: sanitizeText(f.title).clean,
    summary: sanitizeText(f.summary).clean,
    confidence: f.confidence,
  }));
  return `\n\nPREVIOUS FINDINGS FROM UPSTREAM CORTICES:\n${JSON.stringify(cleanFindings, null, 2)}`;
}
