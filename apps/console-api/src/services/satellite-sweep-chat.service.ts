/**
 * Satellite Sweep Chat Service — orchestrates nano streaming analysis for individual satellites.
 * Loads full satellite context (profile, lifetime, ephemeris history), streams gpt-5.4-nano response,
 * extracts structured findings, persists everything in Redis.
 */

import { createLogger } from "@interview/shared/observability";
import type { SatelliteSweepChatRepository } from "../repositories/satellite-sweep-chat.repository";

/**
 * Rich satellite profile the chat service needs (operator detail, doctrine,
 * bus telemetry, payloads). Declared locally as a structural port so this
 * file no longer depends on the legacy package-side SatelliteRepository.
 * Any concrete repo whose findByIdFull returns this shape can be injected.
 */
export interface SatelliteFullProfile {
  name: string;
  operatorCountryName: string | null;
  classificationName?: string | null;
  launchYear: number | null;
  platformClass?: string | null;
  platformClassName?: string | null;
  massKg?: number | null;
  telemetrySummary?: Record<string, unknown> | null;
  operatorDetail?: {
    name: string;
    latitude?: number | null;
    longitude?: number | null;
    groundStation?: string | null;
  } | null;
  doctrine?: Record<string, unknown> | null;
  satelliteBus?: {
    id: string;
    name: string;
    telemetrySummary: Record<string, number | null>;
  } | null;
  payloads?: Array<{
    name: string;
    role?: string | null;
    massKg?: number | null;
    powerW?: number | null;
  }>;
}

export interface SatelliteFullProfileRepo {
  findByIdFull(id: bigint): Promise<SatelliteFullProfile | null>;
}
import type { LifetimeCurve, VizService } from "./viz.service";
import type {
  EphemerisHistoryPoint,
  SatelliteService,
} from "./satellite-ephemeris.service";
import {
  callNano,
  callNanoStream,
} from "@interview/thalamus";
import type {
  SweepFinding,
  SweepChatMessage,
  SweepChatState,
} from "../transformers/satellite-sweep-chat.dto";
import {
  SATELLITE_SWEEP_CHAT_ROLE,
  SATELLITE_SWEEP_CHAT_INSTRUCTIONS,
  buildSweepFindingsExtractorInstructions,
} from "../prompts";

const logger = createLogger("satellite-sweep-chat");

export interface ChatStreamEvent {
  type: "delta" | "finding" | "error" | "done";
  data: unknown;
}

export class SatelliteSweepChatService {
  constructor(
    private satelliteRepo: SatelliteFullProfileRepo,
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
    signal?: AbortSignal,
  ): AsyncGenerator<ChatStreamEvent> {
    const aborted = (): boolean => signal?.aborted === true;

    // Rate limit check
    const allowed = await this.sweepRepo.checkRateLimit(userId);
    if (!allowed) {
      yield {
        type: "error",
        data: { error: "Rate limit exceeded (10/min)" },
      };
      return;
    }
    if (aborted()) return;

    // 1. Load ALL satellite data (dump everything into 400k context)
    const satellite = await this.satelliteRepo.findByIdFull(BigInt(satelliteId));
    if (!satellite) {
      yield { type: "error", data: { error: "Satellite not found" } };
      return;
    }
    if (aborted()) return;

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
    if (aborted()) return;

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
    if (aborted()) return;

    // 5. Stream response — break out of the nano stream as soon as the
    // caller disconnects so we don't keep buffering tokens we'll never write.
    let fullResponse = "";
    try {
      for await (const event of callNanoStream({
        instructions,
        input,
        enableWebSearch: true,
        enableCodeInterpreter: true,
      })) {
        if (aborted()) return;
        if (event.type === "delta") {
          fullResponse += event.text;
          yield { type: "delta", data: { text: event.text } };
        }
      }
    } catch (err) {
      if (aborted()) return;
      logger.error({ err, satelliteId }, "Nano stream error");
      yield { type: "error", data: { error: "Analysis failed" } };
      return;
    }
    if (aborted()) return;

    // 6. Store assistant message
    await this.sweepRepo.appendMessage(satelliteId, userId, {
      role: "assistant",
      content: fullResponse,
      timestamp: new Date().toISOString(),
    });
    if (aborted()) return;

    // 7. Extract and store findings
    const findings = await this.extractFindings(satelliteId, fullResponse);
    if (aborted()) return;
    for (const f of findings) {
      if (aborted()) return;
      const stored = await this.sweepRepo.storeFinding(satelliteId, f);
      yield { type: "finding", data: stored };
    }

    yield { type: "done", data: {} };
  }

  private buildSystemPrompt(
    satellite: SatelliteFullProfile,
    lifetimeCurve: unknown,
    ephemerisHistory: unknown[],
    findings: SweepFinding[],
  ): string {
    const parts: string[] = [
      ...SATELLITE_SWEEP_CHAT_ROLE,
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

    parts.push("", "## INSTRUCTIONS", ...SATELLITE_SWEEP_CHAT_INSTRUCTIONS);

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
        instructions: buildSweepFindingsExtractorInstructions(satelliteId),
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
