/**
 * SPEC-TH-041 — Field-Correlation Cortex (algorithmic core).
 *
 * Converts a FieldEvent into the right ConfidenceService call (promote /
 * demote / no-op), records latency, emits LatencyBreach when the budget is
 * exceeded, refuses OSINT-originated demotion of FIELD_HIGH, and retains
 * unmatched events in a bounded, TTL-gated queue.
 *
 * Transport and persistence live elsewhere; this module is pure enough to
 * unit-test without a bus or a DB.
 */

import type {
  ConfidenceService,
  SourceClass,
} from "./confidence";

export type Priority = "critical" | "routine" | "background";

export interface FieldEvent {
  id: string;
  stream: string;
  priority: Priority;
  receivedAt: Date;
  subject: { type: string; id: string; aliases?: string[] };
  relation: string;
  object: { type: string; id: string; aliases?: string[] };
  outcome: "confirms" | "contradicts" | "partial";
  payload: Record<string, unknown>;
}

/** Latency budgets per priority (ms) — p99 targets, SPEC-TH-041 AC-2/3. */
export const LATENCY_BUDGET_MS: Record<Priority, number> = {
  critical: 500,
  routine: 2_000,
  background: 10_000,
};

/** Locator: given a FieldEvent, return the candidate edge ids to mutate. */
export type CandidateLookup = (event: FieldEvent) => Promise<number[]>;

export interface CorrelationResult {
  eventId: string;
  matchedEdgeIds: number[];
  outcome:
    | { kind: "promoted"; to: SourceClass }
    | { kind: "demoted"; to: SourceClass }
    | { kind: "no-match" }
    | { kind: "latency-breach"; budgetMs: number; actualMs: number };
  latencyMs: number;
}

export interface LatencyBreach {
  eventId: string;
  priority: Priority;
  budgetMs: number;
  actualMs: number;
}

interface UnmatchedEntry {
  event: FieldEvent;
  enqueuedAt: Date;
}

export interface MetricsSink {
  matchHit(priority: Priority): void;
  matchMiss(): void;
  rejectedDemotion(): void;
  latencyBreach(b: LatencyBreach): void;
}

const NOOP_METRICS: MetricsSink = {
  matchHit() {},
  matchMiss() {},
  rejectedDemotion() {},
  latencyBreach() {},
};

export interface FieldCorrelatorOptions {
  unmatchedTtlMs?: number;
  unmatchedMaxSize?: number;
  clock?: () => number;
  now?: () => Date;
  metrics?: MetricsSink;
}

export class FieldCorrelator {
  private processed = new Set<string>(); // AC-6 idempotence
  private unmatched: UnmatchedEntry[] = [];
  private opts: Required<FieldCorrelatorOptions>;

  constructor(
    private confidence: ConfidenceService,
    private locate: CandidateLookup,
    options: FieldCorrelatorOptions = {},
  ) {
    this.opts = {
      unmatchedTtlMs: options.unmatchedTtlMs ?? 60_000,
      unmatchedMaxSize: options.unmatchedMaxSize ?? 10_000,
      clock: options.clock ?? (() => Date.now()),
      now: options.now ?? (() => new Date()),
      metrics: options.metrics ?? NOOP_METRICS,
    };
  }

  /** Process a FieldEvent end-to-end; returns the outcome. */
  async process(event: FieldEvent): Promise<CorrelationResult> {
    // AC-6 idempotence: replay is a no-op.
    if (this.processed.has(event.id)) {
      return {
        eventId: event.id,
        matchedEdgeIds: [],
        outcome: { kind: "no-match" },
        latencyMs: 0,
      };
    }

    const start = this.opts.clock();
    const budget = LATENCY_BUDGET_MS[event.priority];

    const candidates = await this.locate(event);

    // AC-7 — no match: record and enqueue on the bounded TTL queue.
    if (candidates.length === 0) {
      this.processed.add(event.id);
      this.enqueueUnmatched(event);
      this.opts.metrics.matchMiss();
      return {
        eventId: event.id,
        matchedEdgeIds: [],
        outcome: { kind: "no-match" },
        latencyMs: this.opts.clock() - start,
      };
    }

    // Route by outcome.
    let outcome: CorrelationResult["outcome"];
    if (event.outcome === "contradicts") {
      // AC-4 — demote matched edges. The OSINT actor check is enforced by
      // ConfidenceService's write contract; this cortex is a field actor.
      let lastClass: SourceClass = "OSINT_UNCORROBORATED";
      for (const edgeId of candidates) {
        const next = await this.confidence.demote({
          edgeId,
          evidence: {
            kind: "field-contradiction",
            fieldEventId: event.id,
          },
        });
        lastClass = next.sourceClass;
      }
      outcome = { kind: "demoted", to: lastClass };
    } else {
      const policy: "critical" | "partial" =
        event.outcome === "partial" || event.priority !== "critical"
          ? "partial"
          : "critical";
      let lastClass: SourceClass = "OSINT_UNCORROBORATED";
      for (const edgeId of candidates) {
        const next = await this.confidence.promote({
          edgeId,
          evidence: {
            kind: "field-match",
            fieldEventId: event.id,
            stream: event.stream,
            policy,
          },
        });
        lastClass = next.sourceClass;
      }
      outcome = { kind: "promoted", to: lastClass };
    }

    const latencyMs = this.opts.clock() - start;
    this.processed.add(event.id);
    this.opts.metrics.matchHit(event.priority);

    // AC-9 — latency breach does NOT drop the event; the mutation already
    // happened above. We emit the breach and return a latency-breach outcome.
    if (latencyMs > budget) {
      this.opts.metrics.latencyBreach({
        eventId: event.id,
        priority: event.priority,
        budgetMs: budget,
        actualMs: latencyMs,
      });
      return {
        eventId: event.id,
        matchedEdgeIds: candidates,
        outcome: { kind: "latency-breach", budgetMs: budget, actualMs: latencyMs },
        latencyMs,
      };
    }

    return {
      eventId: event.id,
      matchedEdgeIds: candidates,
      outcome,
      latencyMs,
    };
  }

  /** Drop expired entries; returns the current queue size. */
  sweepUnmatched(): number {
    const cutoff = this.opts.now().getTime() - this.opts.unmatchedTtlMs;
    this.unmatched = this.unmatched.filter(
      (u) => u.enqueuedAt.getTime() >= cutoff,
    );
    return this.unmatched.length;
  }

  unmatchedSize(): number {
    return this.unmatched.length;
  }

  listUnmatched(): FieldEvent[] {
    return this.unmatched.map((u) => u.event);
  }

  private enqueueUnmatched(event: FieldEvent): void {
    this.unmatched.push({ event, enqueuedAt: this.opts.now() });
    // Bounded size — drop oldest.
    while (this.unmatched.length > this.opts.unmatchedMaxSize) {
      this.unmatched.shift();
    }
  }
}
