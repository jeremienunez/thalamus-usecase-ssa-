/**
 * Satellite Sweep Chat Service — orchestrates nano streaming analysis for individual satellites.
 * Loads full satellite context (profile, lifetime, ephemeris history), streams gpt-5.4-nano response,
 * extracts structured findings, persists everything in Redis.
 */

import { createLogger } from "@interview/shared/observability";
// NOTE: chat service uses sweep-side SatelliteRepository's richer findByIdFull
// (returns operator detail + doctrine + bus joins). Console-api's own
// findByIdFull has a thinner projection and doesn't carry those fields.
// Phase 4+ may unify the shapes; for Plan 1 we keep using sweep's.
import type { SatelliteRepository } from "@interview/sweep";
import type { SatelliteSweepChatRepository } from "../repositories/satellite-sweep-chat.repository";
import type { LifetimeCurve, VizService } from "./viz.service";
import type {
  EphemerisHistoryPoint,
  SatelliteService,
} from "./satellite-ephemeris.service";
import {
  callNano,
  callNanoStream,
} from "@interview/thalamus/explorer/nano-caller";
import type {
  SweepFinding,
  SweepChatMessage,
  SweepChatState,
} from "../transformers/satellite-sweep-chat.dto";

const logger = createLogger("satellite-sweep-chat");

export interface ChatStreamEvent {
  type: "delta" | "finding" | "error" | "done";
  data: unknown;
}

export class SatelliteSweepChatService {
  constructor(
    private satelliteRepo: SatelliteRepository,
    private sweepRepo: SatelliteSweepChatRepository,
    private vizService: VizService,
    private satelliteService: SatelliteService,
  ) {}

  async getState(
    satelliteId: string,
    userId: string,
  ): Promise<SweepChatState> {
    return this.sweepRepo.getState(satelliteId, userId);
  }

  async *chat(
    satelliteId: string,
    userId: string,
    message: string,
  ): AsyncGenerator<ChatStreamEvent> {
    // Rate limit check
    const allowed = await this.sweepRepo.checkRateLimit(userId);
    if (!allowed) {
      yield {
        type: "error",
        data: { error: "Rate limit exceeded (10/min)" },
      };
      return;
    }

    // 1. Load ALL satellite data (dump everything into 400k context)
    const satellite = await this.satelliteRepo.findByIdFull(BigInt(satelliteId));
    if (!satellite) {
      yield { type: "error", data: { error: "Satellite not found" } };
      return;
    }

    // Load lifetime curve + ephemeris history + chat context in parallel
    const [lifetimeCurve, ephemerisHistory, history, pastFindings] =
      await Promise.all([
        this.vizService
          .getLifetimeCurve(Number(satelliteId))
          .catch((): LifetimeCurve | null => null),
        this.satelliteService
          .getEphemerisHistory(Number(satelliteId))
          .catch((): EphemerisHistoryPoint[] => []),
        this.sweepRepo.getHistory(satelliteId, userId),
        this.sweepRepo.getFindings(satelliteId),
      ]);

    // 3. Build prompt with ALL data
    const instructions = this.buildSystemPrompt(
      satellite,
      lifetimeCurve,
      ephemerisHistory,
      pastFindings,
    );
    const input = this.buildChatInput(history, message);

    // 4. Store user message
    await this.sweepRepo.appendMessage(satelliteId, userId, {
      role: "user",
      content: message,
      timestamp: new Date().toISOString(),
    });

    // 5. Stream response
    let fullResponse = "";
    try {
      for await (const event of callNanoStream({
        instructions,
        input,
        enableWebSearch: true,
        enableCodeInterpreter: true,
      })) {
        if (event.type === "delta") {
          fullResponse += event.text;
          yield { type: "delta", data: { text: event.text } };
        }
      }
    } catch (err) {
      logger.error({ err, satelliteId }, "Nano stream error");
      yield { type: "error", data: { error: "Analysis failed" } };
      return;
    }

    // 6. Store assistant message
    await this.sweepRepo.appendMessage(satelliteId, userId, {
      role: "assistant",
      content: fullResponse,
      timestamp: new Date().toISOString(),
    });

    // 7. Extract and store findings
    const findings = await this.extractFindings(satelliteId, fullResponse);
    for (const f of findings) {
      const stored = await this.sweepRepo.storeFinding(satelliteId, f);
      yield { type: "finding", data: stored };
    }

    yield { type: "done", data: {} };
  }

  private buildSystemPrompt(
    satellite: NonNullable<
      Awaited<ReturnType<SatelliteRepository["findByIdFull"]>>
    >,
    lifetimeCurve: unknown,
    ephemerisHistory: unknown[],
    findings: SweepFinding[],
  ): string {
    const parts: string[] = [
      "You are a space situational awareness analyst with deep expertise in orbital mechanics, mission operations, and satellite catalog integrity.",
      "You have access to web search for real-time data and code interpreter for calculations.",
      "When you discover a noteworthy insight, state it clearly with supporting evidence.",
      "",
      "## SATELLITE DATA",
      `Name: ${satellite.name}`,
      `Operator: ${satellite.operatorDetail?.name ?? "Unknown"}`,
      `OperatorCountry: ${satellite.operatorCountryName ?? "Unknown"}`,
      `Classification: ${satellite.classificationName ?? "N/A"}`,
      `LaunchYear: ${satellite.launchYear ?? "N/A"}`,
      `PlatformClass: ${satellite.platformClass}`,
      `Mass: ${satellite.massKg ? satellite.massKg + "kg" : "Unknown"}`,
    ];

    // Payloads
    if (satellite.payloads?.length) {
      parts.push("", "## PAYLOADS");
      for (const p of satellite.payloads) {
        const budget = p.massKg ? `${p.massKg}kg` : "";
        parts.push(`- ${p.name} (${p.role}) ${budget}`);
      }
    }

    // Telemetry summary
    if (satellite.telemetrySummary) {
      parts.push(
        "",
        "## TELEMETRY SUMMARY",
        JSON.stringify(satellite.telemetrySummary),
      );
    }

    // Orbit regime
    if (satellite.operatorDetail) {
      parts.push("", "## ORBIT / GROUND STATION");
      if (satellite.operatorDetail.groundStation)
        parts.push(
          `Ground station: ${satellite.operatorDetail.groundStation}`,
        );
      if (satellite.operatorDetail.latitude)
        parts.push(
          `GPS: ${satellite.operatorDetail.latitude}, ${satellite.operatorDetail.longitude}`,
        );
    }

    // Ephemeris History
    if (ephemerisHistory.length > 0) {
      parts.push(
        "",
        "## EPHEMERIS HISTORY (all snapshots)",
        JSON.stringify(ephemerisHistory),
      );
    }

    // Lifetime Curve
    if (lifetimeCurve) {
      parts.push("", "## LIFETIME CURVE", JSON.stringify(lifetimeCurve));
    }

    // Doctrine
    if (satellite.doctrine) {
      parts.push(
        "",
        "## DOCTRINE (OPERATOR COUNTRY LICENCE / SHARING POLICY)",
        JSON.stringify(satellite.doctrine),
      );
    }

    // Satellite Bus template
    if (satellite.satelliteBus) {
      parts.push(
        "",
        "## SATELLITE BUS TEMPLATE",
        JSON.stringify(satellite.satelliteBus),
      );
    }

    // Past findings
    if (findings.length > 0) {
      parts.push("", "## PREVIOUS FINDINGS (from past analysis sessions)");
      for (const f of findings) {
        parts.push(
          `- [${f.category}] ${f.title}: ${f.summary} (confidence: ${f.confidence})`,
        );
      }
    }

    parts.push(
      "",
      "## INSTRUCTIONS",
      "- Answer in the same language the user uses",
      "- Use web search to find current TLEs, recent maneuver alerts, advisory bulletins, launch news",
      "- Use code interpreter for calculations when needed (propagation, conjunction screening, delta-v budgets)",
      "- Be specific with numbers, dates, and sources",
      "- Cross-reference the satellite data above with your web findings",
    );

    return parts.join("\n");
  }

  private buildChatInput(history: SweepChatMessage[], message: string): string {
    const lines: string[] = [];
    for (const msg of history.slice(-20)) {
      lines.push(
        `${msg.role === "user" ? "User" : "Assistant"}: ${msg.content}`,
      );
    }
    lines.push(`User: ${message}`);
    return lines.join("\n\n");
  }

  private async extractFindings(
    satelliteId: string,
    response: string,
  ): Promise<Omit<SweepFinding, "id" | "createdAt">[]> {
    if (response.length < 100) return [];

    try {
      const result = await callNano({
        instructions: `Extract structured findings from this satellite SSA analysis response.
Return a JSON array (or empty array if no concrete findings).
Each finding: { "satelliteId": "${satelliteId}", "category": "orbit"|"advisory"|"mission"|"regime"|"maneuver"|"conjunction"|"lifetime"|"general", "title": "short title", "summary": "1-2 sentence summary", "confidence": 0.0-1.0, "evidence": ["url or data point"] }
Only extract concrete, actionable insights with specific data — not generic observations.`,
        input: response,
        enableWebSearch: false,
      });

      const jsonMatch = result.text.match(/\[[\s\S]*\]/);
      if (!jsonMatch) return [];

      const parsed = JSON.parse(jsonMatch[0]);
      if (!Array.isArray(parsed)) return [];

      return parsed
        .filter(
          (f: Record<string, unknown>) =>
            f.title && f.summary && f.satelliteId,
        )
        .slice(0, 5);
    } catch (err) {
      logger.warn({ err }, "Failed to extract findings");
      return [];
    }
  }
}
