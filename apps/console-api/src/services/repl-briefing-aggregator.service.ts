import type {
  ReplBriefingEvidence,
  ReplBriefingReport,
  ReplBriefingSection,
} from "@interview/shared";
import { aggregateBriefingPrompt } from "../prompts/repl-chat.prompt";
import type { ReplFindingSummaryView } from "../types/repl-chat.types";
import type { LlmTransportFactory } from "./llm-transport.port";

export interface ReplBriefingFollowUpInput {
  followupId: string;
  kind: string;
  title: string;
  status: "completed" | "failed" | "proposed" | "dropped" | "running";
  summary: string;
  findings: ReplFindingSummaryView[];
}

export interface ReplBriefingAggregateInput {
  query: string;
  parentCycleId: string;
  parent: {
    summary: string;
    findings: ReplFindingSummaryView[];
  };
  followUps: ReplBriefingFollowUpInput[];
}

export class ReplBriefingAggregator {
  constructor(private readonly llm: LlmTransportFactory) {}

  async aggregate(
    input: ReplBriefingAggregateInput,
  ): Promise<ReplBriefingReport> {
    const transport = this.llm.create(aggregateBriefingPrompt(input.query));
    const response = await transport.call(JSON.stringify(input, null, 2));
    const parsed = parseReport(response.content, input);

    return {
      parentCycleId: input.parentCycleId,
      ...parsed,
      evidence: buildEvidence(input),
      provider: response.provider,
    };
  }
}

function parseReport(
  content: string,
  input: ReplBriefingAggregateInput,
): Omit<ReplBriefingReport, "parentCycleId" | "evidence" | "provider"> {
  const fallback = fallbackReport(input);
  const raw = parseJsonObject(content);
  if (!raw) return fallback;

  return {
    title: boundedString(raw.title, fallback.title, 80),
    summary: boundedString(raw.summary, fallback.summary, 700),
    sections: normalizeSections(raw.sections, fallback.sections),
    nextActions: normalizeStringList(raw.nextActions, 3, 140),
  };
}

function parseJsonObject(content: string): Record<string, unknown> | null {
  const trimmed = content.trim();
  const withoutFence = trimmed
    .replace(/^```(?:json)?\s*/i, "")
    .replace(/\s*```$/i, "")
    .trim();
  const direct = tryParseObject(withoutFence);
  if (direct) return direct;

  const start = withoutFence.indexOf("{");
  const end = withoutFence.lastIndexOf("}");
  if (start === -1 || end <= start) return null;
  return tryParseObject(withoutFence.slice(start, end + 1));
}

function tryParseObject(value: string): Record<string, unknown> | null {
  try {
    const parsed: unknown = JSON.parse(value);
    return isRecord(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

function normalizeSections(
  value: unknown,
  fallback: ReplBriefingSection[],
): ReplBriefingSection[] {
  if (!Array.isArray(value)) return fallback;
  const sections = value
    .filter(isRecord)
    .slice(0, 5)
    .map((section, index) => ({
      title: boundedString(section.title, `Section ${index + 1}`, 80),
      body: boundedString(section.body, "", 600),
      bullets: normalizeStringList(section.bullets, 8, 220),
    }))
    .filter((section) => section.title || section.body || section.bullets.length > 0);
  return sections.length > 0 ? sections : fallback;
}

function normalizeStringList(
  value: unknown,
  maxItems: number,
  maxLength: number,
): string[] {
  if (!Array.isArray(value)) return [];
  return value
    .map((item) => boundedString(item, "", maxLength))
    .filter((item) => item.length > 0)
    .slice(0, maxItems);
}

function fallbackReport(
  input: ReplBriefingAggregateInput,
): Omit<ReplBriefingReport, "parentCycleId" | "evidence" | "provider"> {
  const french = /\b(rapport|lancement|analyse|flotte|risque|prochain|jours|audit)\b/i.test(
    input.query,
  );
  const followUpSummaries = input.followUps
    .map((followUp) => followUp.summary.trim())
    .filter(Boolean);
  const parentSummary = input.parent.summary.trim();
  const summary =
    followUpSummaries[0] ||
    parentSummary ||
    (french
      ? "Le cycle est termine, mais aucun resume exploitable n'a ete retourne."
      : "The cycle completed, but no usable summary was returned.");

  return {
    title: french ? "Synthese finale" : "Final briefing",
    summary: trimTo(summary, 700),
    sections: [
      {
        title: french ? "Resume executif" : "Executive summary",
        body: trimTo(parentSummary || summary, 600),
        bullets: input.parent.findings
          .slice(0, 4)
          .map((finding) => `#${finding.id}: ${finding.title}`),
      },
      ...buildFollowUpFallbackSections(input, french),
      {
        title: french ? "Limites" : "Limits",
        body: french
          ? "Cette synthese reprend uniquement les findings fournis par le cycle et ses follow-ups."
          : "This briefing only uses findings returned by the cycle and its follow-ups.",
        bullets: [],
      },
    ].slice(0, 5),
    nextActions: [],
  };
}

function buildFollowUpFallbackSections(
  input: ReplBriefingAggregateInput,
  french: boolean,
): ReplBriefingSection[] {
  if (input.followUps.length === 0) return [];
  return [
    {
      title: french ? "Verification" : "Verification",
      body: french
        ? "Les follow-ups executes sont integres dans cette synthese."
        : "Executed follow-ups are folded into this briefing.",
      bullets: input.followUps
        .slice(0, 4)
        .map((followUp) => `${followUp.title}: ${followUp.status}`),
    },
  ];
}

function buildEvidence(
  input: ReplBriefingAggregateInput,
): ReplBriefingEvidence[] {
  const parentEvidence = input.parent.findings.map((finding) =>
    toEvidence(finding, "parent", null),
  );
  const followUpEvidence = input.followUps.flatMap((followUp) =>
    followUp.findings.map((finding) =>
      toEvidence(finding, "followup", followUp.followupId),
    ),
  );
  return [...parentEvidence, ...followUpEvidence].slice(0, 18);
}

function toEvidence(
  finding: ReplFindingSummaryView,
  source: ReplBriefingEvidence["source"],
  followupId: string | null,
): ReplBriefingEvidence {
  return {
    id: finding.id,
    title: finding.title,
    cortex: finding.cortex,
    confidence: Number.isFinite(finding.confidence) ? finding.confidence : 0,
    source,
    followupId,
  };
}

function boundedString(
  value: unknown,
  fallback: string,
  maxLength: number,
): string {
  return trimTo(typeof value === "string" ? value : fallback, maxLength);
}

function trimTo(value: string, maxLength: number): string {
  const clean = value.replace(/\s+/g, " ").trim();
  if (clean.length <= maxLength) return clean;
  return `${clean.slice(0, Math.max(0, maxLength - 1)).trim()}...`;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
