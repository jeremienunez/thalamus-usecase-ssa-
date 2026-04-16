// apps/console-api/src/services/nano-research.service.ts
import { BAS_NIVEAU_LOGIT_BIAS, callNanoWithMode } from "@interview/thalamus";
import {
  MISSION_SYSTEM_PROMPT,
  MISSION_RESPONSE_FORMAT,
} from "../prompts/mission-research.prompt";
import { detectFabrication } from "../utils/fabrication-detector";
import { unitMismatch } from "../utils/field-constraints";
import type { MissionTask, NanoResult } from "../types";

const failed = (reason: string): NanoResult => ({
  ok: false,
  value: null,
  confidence: 0,
  source: "",
  unit: "",
  reason,
});

export class NanoResearchService {
  async singleVote(task: MissionTask, angle: string): Promise<NanoResult> {
    const noradPart = task.noradId ? ` (NORAD ${task.noradId})` : "";
    const userPrompt = `Satellite: ${task.satelliteName}${noradPart}, operated by ${task.operatorCountry}.
Field to fill: "${task.field}".
${angle}
Find the exact documented value for THIS specific satellite. JSON only. Cite the URL you opened.`;

    const nano = await callNanoWithMode({
      instructions: MISSION_SYSTEM_PROMPT,
      input: userPrompt,
      enableWebSearch: true,
      responseFormat: MISSION_RESPONSE_FORMAT,
      logitBias: BAS_NIVEAU_LOGIT_BIAS,
    });
    if (!nano.ok) return failed(nano.error ?? "nano call failed");

    const hedge = detectFabrication(nano.text);
    if (hedge) return failed(`hedging "${hedge}"`);

    const match = nano.text.match(/\{[\s\S]*\}/);
    if (!match) return failed("no JSON");
    let parsed: {
      value: string | number | null;
      unit?: string;
      confidence: number;
      source?: string;
    };
    try {
      parsed = JSON.parse(match[0]);
    } catch {
      return failed("invalid JSON");
    }

    const source = (parsed.source ?? "").trim();
    if (parsed.value === null) return failed("no value");
    if (parsed.confidence < 0.6)
      return failed(`low confidence ${parsed.confidence}`);
    if (!/^https:\/\/[^\s]+$/.test(source)) return failed("no https source");
    if (!nano.urls.some((u) => u.includes(new URL(source).host)))
      return failed("source not cited");
    if (unitMismatch(task.field, parsed.unit ?? ""))
      return failed(`unit "${parsed.unit}"`);

    return {
      ok: true,
      value: parsed.value,
      confidence: parsed.confidence,
      source,
      unit: parsed.unit ?? "",
      reason: "",
    };
  }

  votesAgree(a: string | number, b: string | number): boolean {
    if (typeof a === "number" && typeof b === "number") {
      const denom = Math.max(Math.abs(a), Math.abs(b), 1e-9);
      return Math.abs(a - b) / denom <= 0.1;
    }
    return String(a).trim().toLowerCase() === String(b).trim().toLowerCase();
  }

  summary(v: NanoResult): string {
    return v.ok ? "ok" : v.reason;
  }
}
