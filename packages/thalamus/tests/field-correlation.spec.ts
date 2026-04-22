/**
 * SPEC-TH-041 — Field-Correlation Cortex
 *
 * Tests against the pure FieldCorrelator (no bus, no DB). Wraps
 * ConfidenceService with lookup + latency discipline.
 *
 * Traceability covered:
 *   AC-2 critical path completes end-to-end (timing checked via an injected
 *        clock — p99 assertion over synthetic events lives in an integration
 *        load test; here we assert a single event routes through promote()
 *        within the budget and sets FIELD_HIGH)
 *   AC-4 contradicting field event demotes FIELD_* edge
 *   AC-5 analyst override demotes FIELD_HIGH; plain OSINT corroboration
 *        does not spoof a field promotion
 *   AC-6 replay of same FieldEvent.id is a no-op
 *   AC-7 miss routes to bounded unmatched queue, match_miss metric emitted
 *   AC-8 every mutation emits an EdgeProvenanceEvent with actor=field-correlation
 *   AC-9 LatencyBreach emitted without dropping the event; mutation still landed
 *
 * Skipped:
 *   AC-1 registry discovery — needs a field-correlation.md skill file
 *   AC-3 routine/background p99 — load test
 *   AC-10 observability leakage — integration test with log capture
 */
import { describe, it, expect, beforeEach, vi } from "vitest";
import { ConfidenceService } from "../src/cortices/confidence";
import {
  FieldCorrelator,
  type FieldEvent,
  type MetricsSink,
} from "../src/cortices/field-correlation";

function criticalEvent(overrides: Partial<FieldEvent> = {}): FieldEvent {
  return {
    id: "fe-1",
    stream: "tactical-link",
    priority: "critical",
    receivedAt: new Date("2026-04-14T10:00:00Z"),
    subject: { type: "satellite", id: "sat-1" },
    relation: "associatedWith",
    object: { type: "operator", id: "op-1" },
    outcome: "confirms",
    payload: { classification: "C-level" },
    ...overrides,
  };
}

let svc: ConfidenceService;
let metrics: MetricsSink;

beforeEach(() => {
  svc = new ConfidenceService();
  metrics = {
    matchHit: vi.fn(),
    matchMiss: vi.fn(),
    rejectedDemotion: vi.fn(),
    latencyBreach: vi.fn(),
  };
  // Seed an edge to correlate against.
  svc.initialWrite(1);
});

describe("SPEC-TH-041 AC-2 — critical event promotes matched edge to FIELD_HIGH", () => {
  it("single-edge match promotes to FIELD_HIGH within budget", async () => {
    const correlator = new FieldCorrelator(svc, async () => [1], {
      metrics,
      clock: () => 0, // clock never advances → synthetic "instant"
    });
    const r = await correlator.process(criticalEvent());

    expect(r.outcome).toEqual({ kind: "promoted", to: "FIELD_HIGH" });
    expect(r.matchedEdgeIds).toEqual([1]);
    expect(r.latencyMs).toBe(0);
    const ec = await svc.read(1);
    expect(ec.sourceClass).toBe("FIELD_HIGH");
    expect(ec.fieldEventId).toBe("fe-1");
    expect(metrics.matchHit).toHaveBeenCalledWith("critical");
  });

  it("routine event with 'partial' outcome promotes to FIELD_LOW", async () => {
    const correlator = new FieldCorrelator(svc, async () => [1], {
      metrics,
      clock: () => 0,
    });
    const r = await correlator.process(
      criticalEvent({
        id: "fe-routine",
        priority: "routine",
        outcome: "partial",
      }),
    );
    expect(r.outcome).toEqual({ kind: "promoted", to: "FIELD_LOW" });
  });
});

describe("SPEC-TH-041 AC-4 — contradicting field event demotes FIELD_*", () => {
  it("field-contradiction on FIELD_HIGH → OSINT_UNCORROBORATED, confidence ≤ 0.20", async () => {
    const correlator = new FieldCorrelator(svc, async () => [1]);
    await correlator.process(criticalEvent({ id: "fe-confirm" }));
    const r = await correlator.process(
      criticalEvent({ id: "fe-contradict", outcome: "contradicts" }),
    );
    expect(r.outcome).toEqual({ kind: "demoted", to: "OSINT_UNCORROBORATED" });
    const ec = await svc.read(1);
    expect(ec.value).toBeLessThanOrEqual(0.2);
    expect(ec.sourceClass).toBe("OSINT_UNCORROBORATED");
  });
});

describe("SPEC-TH-041 AC-5 — analyst override demotes FIELD_HIGH, but OSINT corroboration does not spoof field authority", () => {
  it("analyst-override on a FIELD_HIGH edge demotes it to OSINT_UNCORROBORATED", async () => {
    // First promote to FIELD_HIGH via a field event.
    const correlator = new FieldCorrelator(svc, async () => [1]);
    await correlator.process(criticalEvent({ id: "fe-promote" }));
    const before = await svc.read(1);
    expect(before.sourceClass).toBe("FIELD_HIGH");

    await svc.demote({
      edgeId: 1,
      evidence: {
        kind: "analyst-override",
        analystId: 7,
        note: "manual downgrade",
      },
    });

    const after = await svc.read(1);
    expect(after.sourceClass).toBe("OSINT_UNCORROBORATED");
    expect(after.value).toBeLessThanOrEqual(0.5);
    expect(after.value).toBeLessThan(before.value);
  });

  it("plain OSINT corroboration leaves a FIELD_HIGH edge unchanged", async () => {
    const correlator = new FieldCorrelator(svc, async () => [1]);
    await correlator.process(criticalEvent({ id: "fe-promote" }));
    const before = await svc.read(1);
    expect(before.sourceClass).toBe("FIELD_HIGH");

    // A direct OSINT corroboration is a no-op (field dominance).
    await svc.promote({
      edgeId: 1,
      evidence: { kind: "osint-corroboration", sources: ["late-osint"] },
    });
    const after = await svc.read(1);
    expect(after.sourceClass).toBe("FIELD_HIGH");
    expect(after.value).toBe(before.value);
  });
});

describe("SPEC-TH-041 AC-6 — replay is idempotent", () => {
  it("processing the same FieldEvent.id twice does not mutate twice", async () => {
    const lookup = vi.fn(async () => [1]);
    const correlator = new FieldCorrelator(svc, lookup);
    await correlator.process(criticalEvent());
    const before = await svc.read(1);

    const r2 = await correlator.process(criticalEvent());
    const after = await svc.read(1);

    expect(r2.outcome).toEqual({ kind: "no-match" });
    expect(after.value).toBe(before.value);
    expect(after.sourceClass).toBe(before.sourceClass);
    expect(lookup).toHaveBeenCalledTimes(1); // second call short-circuited
  });
});

describe("SPEC-TH-041 AC-7 — no-match routes to unmatched queue", () => {
  it("no candidates → queue grows, match_miss emitted, no mutation", async () => {
    const correlator = new FieldCorrelator(svc, async () => [], {
      metrics,
      unmatchedMaxSize: 100,
    });
    const r = await correlator.process(criticalEvent({ id: "fe-orphan" }));
    expect(r.outcome).toEqual({ kind: "no-match" });
    expect(correlator.unmatchedSize()).toBe(1);
    expect(correlator.listUnmatched()[0]!.id).toBe("fe-orphan");
    expect(metrics.matchMiss).toHaveBeenCalledTimes(1);
  });

  it("bounded queue drops oldest when full", async () => {
    const correlator = new FieldCorrelator(svc, async () => [], {
      unmatchedMaxSize: 2,
    });
    await correlator.process(criticalEvent({ id: "a" }));
    await correlator.process(criticalEvent({ id: "b" }));
    await correlator.process(criticalEvent({ id: "c" }));
    expect(correlator.unmatchedSize()).toBe(2);
    expect(correlator.listUnmatched().map((e) => e.id)).toEqual(["b", "c"]);
  });

  it("sweepUnmatched drops entries older than TTL", async () => {
    let t = 0;
    const correlator = new FieldCorrelator(svc, async () => [], {
      unmatchedTtlMs: 1_000,
      now: () => new Date(t),
    });
    await correlator.process(criticalEvent({ id: "stale" }));
    t = 2_000;
    correlator.sweepUnmatched();
    expect(correlator.unmatchedSize()).toBe(0);
  });
});

describe("SPEC-TH-041 AC-8 — provenance actor = field-correlation on mutations", () => {
  it("successful promotion emits an EdgeProvenanceEvent with actor=field-correlation", async () => {
    const correlator = new FieldCorrelator(svc, async () => [1]);
    await correlator.process(criticalEvent());
    const hist = await svc.history(1);
    const last = hist[hist.length - 1]!;
    expect(last.actor).toBe("field-correlation");
    expect(last.next.sourceClass).toBe("FIELD_HIGH");
  });
});

describe("SPEC-TH-041 AC-9 — latency breach emits without dropping the event", () => {
  it("exceeding the critical budget returns latency-breach AND the mutation landed", async () => {
    // Clock advances by 700ms between start and end → > critical 500ms budget.
    let ticks = 0;
    const correlator = new FieldCorrelator(svc, async () => [1], {
      metrics,
      clock: () => (ticks++ === 0 ? 0 : 700),
    });
    const r = await correlator.process(criticalEvent());
    expect(r.outcome).toMatchObject({
      kind: "latency-breach",
      budgetMs: 500,
      actualMs: 700,
    });
    // Mutation still landed.
    const ec = await svc.read(1);
    expect(ec.sourceClass).toBe("FIELD_HIGH");
    expect(metrics.latencyBreach).toHaveBeenCalledOnce();
    expect(metrics.latencyBreach).toHaveBeenCalledWith(
      expect.objectContaining({ priority: "critical", budgetMs: 500 }),
    );
  });

  it("routine-priority budget is 2000ms (event not dropped)", async () => {
    let ticks = 0;
    const correlator = new FieldCorrelator(svc, async () => [1], {
      metrics,
      clock: () => (ticks++ === 0 ? 0 : 1_500),
    });
    const r = await correlator.process(
      criticalEvent({ priority: "routine", outcome: "partial" }),
    );
    // 1500ms < 2000ms → no breach.
    expect(r.outcome).toMatchObject({ kind: "promoted" });
    expect(metrics.latencyBreach).not.toHaveBeenCalled();
  });
});
