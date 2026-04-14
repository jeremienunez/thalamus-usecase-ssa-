// server/src/services/finding-routing.ts


/**
 * Inbox routing: maps data sources to tier visibility.
 * Admin always sees ALL — handled separately (not in these maps).
 *
 * Three source types feed the inbox:
 * 1. Thalamus findings (cortex-based routing)
 * 2. Sweep results (nano DB audit) → admin only
 * 3. Research cycle completions → admin only
 */

// ── Cortex → Tier ──

const CORTEX_TIER_MAP: Record<string, string[]> = {
  // Investment-tier cortices
  strategist: ["investment"],
  fleet_analyst: ["investment"],
  launch_scout: ["investment"],
  debris_forecaster: ["investment"],
  advisory_radar: ["investment"],

  // Shared cortices (investment + franchise + enthusiast)
  apogee_tracker: ["investment", "enthusiast", "franchise"],
  payload_profiler: ["franchise"],
  regime_profiler: ["franchise"],

  // Content production — admin only (briefings go through reviewer approval)
  briefing_producer: [],

  // Admin-only cortices (not in map — admin gets all via separate path)
  data_auditor: [],
  classification_auditor: [],
};

/**
 * Returns tier slugs that should receive findings from a given cortex.
 * Always excludes admin (admin gets ALL findings via separate recipient path).
 */
export function getTiersForCortex(cortex: string): string[] {
  return CORTEX_TIER_MAP[cortex] ?? [];
}

// ── Notification Source Types ──

export type InboxSource =
  | "finding"
  | "sweep"
  | "research_cycle"
  | "consumption";

/**
 * Returns tiers that should see a given non-cortex source.
 * Admin always receives via separate path — not listed here.
 */
export function getTiersForSource(source: InboxSource): string[] {
  switch (source) {
    case "sweep":
    case "research_cycle":
      return []; // admin only
    case "consumption":
      return ["investment", "enthusiast", "franchise"]; // all paid tiers
    case "finding":
      return []; // use getTiersForCortex instead
  }
}

// ── Sweep Wiring ──

import type { NanoSweepService, SweepResult } from "./nano-sweep.service";
import type { MessagingService } from "./messaging.service";

/**
 * Wire sweep completion → admin inbox notification.
 * Call once after NanoSweepService is created.
 */
export function wireSweepNotifications(
  sweepService: NanoSweepService,
  deps: {
    findAdminIds: () => Promise<string[]>;
    messagingService: Pick<MessagingService, "send">;
  },
): void {
  sweepService.onComplete(async (result: SweepResult) => {
    const { SenderType, ContentType, Channel, ConversationType } =
      await import("@interview/shared/enum/messaging.enum");

    const adminIds = await deps.findAdminIds();
    if (!adminIds.length) return;

    const subject = `[Sweep] Audit complete — ${result.suggestionsStored} suggestions`;
    const content =
      `**${subject}**\n\n` +
      `- Operator-countries audited: ${result.totalOperatorCountries}\n` +
      `- Suggestions created: ${result.suggestionsStored}\n` +
      `- Estimated cost: $${result.estimatedCost.toFixed(3)}\n` +
      `- Duration: ${(result.wallTimeMs / 1000).toFixed(0)}s`;

    await deps.messagingService.send({
      senderId: "system",
      senderType: SenderType.System,
      senderName: "Nano Sweep",
      content,
      contentType: ContentType.Text,
      channels: [Channel.Inbox],
      recipientIds: adminIds,
      conversationType: ConversationType.System,
      subject,
      metadata: { notificationType: "sweep" },
    });
  });
}
