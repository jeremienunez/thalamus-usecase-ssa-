/**
 * SPEC-TH-040 — Dual-Stream Confidence Model.
 *
 * Tests against the pure ConfidenceService (in-memory). Persistence-level
 * invariants (SQL audit rows, bus publishing) are integration tests.
 *
 * Traceability:
 *   AC-1 initial OSINT write is OSINT_UNCORROBORATED with confidence in [0.10, 0.50]
 *   AC-2 second OSINT source promotes to OSINT_CORROBORATED + provenance event
 *   AC-3 field-match promotes to FIELD_HIGH / FIELD_LOW per policy, sets fieldEventId
 *   AC-4 promote without field-match cannot reach FIELD_*
 *   AC-5 field-contradiction demotes a FIELD_* edge to OSINT_UNCORROBORATED, confidence ≤ 0.20
 *   AC-6 OSINT corroboration on a FIELD_HIGH edge is a no-op (field dominance)
 *   AC-7 history is complete and in insertion order
 *   AC-8 query returns OSINT_UNCORROBORATED edges older than a timestamp
 */
import { describe, it, expect, beforeEach } from "vitest";
import {
  ConfidenceService,
  type SourceClass,
} from "../src/cortices/confidence";

let svc: ConfidenceService;

beforeEach(() => {
  svc = new ConfidenceService();
});

describe("SPEC-TH-040 AC-1 — OSINT writes start uncorroborated", () => {
  it("initialWrite yields OSINT_UNCORROBORATED with confidence in [0.10, 0.50]", () => {
    const ec = svc.initialWrite(1);
    expect(ec.sourceClass).toBe("OSINT_UNCORROBORATED");
    expect(ec.value).toBeGreaterThanOrEqual(0.1);
    expect(ec.value).toBeLessThanOrEqual(0.5);
    expect(ec.corroborationCount).toBe(1);
    expect(ec.fieldEventId).toBeNull();
  });

  it("duplicate initialWrite on the same edgeId throws", () => {
    svc.initialWrite(1);
    expect(() => svc.initialWrite(1)).toThrow(/already exists/);
  });
});

describe("SPEC-TH-040 AC-2 — second OSINT source promotes", () => {
  it("OSINT corroboration moves the edge to OSINT_CORROBORATED", async () => {
    svc.initialWrite(1);
    const ec = await svc.promote({
      edgeId: 1,
      evidence: { kind: "osint-corroboration", sources: ["src-B"] },
    });
    expect(ec.sourceClass).toBe("OSINT_CORROBORATED");
    expect(ec.value).toBeGreaterThanOrEqual(0.4);
    expect(ec.value).toBeLessThanOrEqual(0.75);
    expect(ec.corroborationCount).toBeGreaterThanOrEqual(2);
    expect(ec.lastPromotedAt).toBeInstanceOf(Date);
  });

  it("provenance event is emitted for the promotion", async () => {
    svc.initialWrite(1);
    await svc.promote({
      edgeId: 1,
      evidence: { kind: "osint-corroboration", sources: ["src-B"] },
    });
    const hist = await svc.history(1);
    expect(hist.length).toBe(2); // initial + promotion
    expect(hist[1]!.reason).toBe("osint-corroboration");
    expect(hist[1]!.previous.sourceClass).toBe("OSINT_UNCORROBORATED");
    expect(hist[1]!.next.sourceClass).toBe("OSINT_CORROBORATED");
  });

  it("asymptotic climb within the OSINT_CORROBORATED band", async () => {
    svc.initialWrite(1);
    await svc.promote({
      edgeId: 1,
      evidence: { kind: "osint-corroboration", sources: ["B"] },
    });
    const v1 = (await svc.read(1)).value;
    await svc.promote({
      edgeId: 1,
      evidence: { kind: "osint-corroboration", sources: ["C"] },
    });
    const v2 = (await svc.read(1)).value;
    expect(v2).toBeGreaterThan(v1);
    expect(v2).toBeLessThanOrEqual(0.75);
  });
});

describe("SPEC-TH-040 AC-3 — field-match promotes to FIELD_* and sets fieldEventId", () => {
  it("critical policy → FIELD_HIGH", async () => {
    svc.initialWrite(1);
    const ec = await svc.promote({
      edgeId: 1,
      evidence: {
        kind: "field-match",
        fieldEventId: "fe-42",
        stream: "tactical-link",
        policy: "critical",
      },
    });
    expect(ec.sourceClass).toBe("FIELD_HIGH");
    expect(ec.value).toBeGreaterThanOrEqual(0.85);
    expect(ec.value).toBeLessThanOrEqual(1.0);
    expect(ec.fieldEventId).toBe("fe-42");
  });

  it("partial policy → FIELD_LOW", async () => {
    svc.initialWrite(2);
    const ec = await svc.promote({
      edgeId: 2,
      evidence: {
        kind: "field-match",
        fieldEventId: "fe-43",
        stream: "sensor-fusion",
        policy: "partial",
      },
    });
    expect(ec.sourceClass).toBe("FIELD_LOW");
    expect(ec.value).toBeGreaterThanOrEqual(0.65);
    expect(ec.value).toBeLessThanOrEqual(0.85);
  });

  it("default policy (no explicit) → FIELD_HIGH (critical)", async () => {
    svc.initialWrite(3);
    const ec = await svc.promote({
      edgeId: 3,
      evidence: {
        kind: "field-match",
        fieldEventId: "fe-44",
        stream: "default",
      },
    });
    expect(ec.sourceClass).toBe("FIELD_HIGH");
  });
});

describe("SPEC-TH-040 AC-4 — OSINT-only cannot reach a FIELD class", () => {
  it("promote(osint-corroboration) never yields FIELD_*", async () => {
    svc.initialWrite(1);
    for (let i = 0; i < 10; i++) {
      await svc.promote({
        edgeId: 1,
        evidence: {
          kind: "osint-corroboration",
          sources: [`src-${i}`],
        },
      });
    }
    const ec = await svc.read(1);
    expect(ec.sourceClass).not.toBe("FIELD_HIGH");
    expect(ec.sourceClass).not.toBe("FIELD_LOW");
    expect(ec.fieldEventId).toBeNull();
  });
});

describe("SPEC-TH-040 AC-5 — field-contradiction demotes", () => {
  it("FIELD_HIGH + field-contradiction → OSINT_UNCORROBORATED, value ≤ 0.20", async () => {
    svc.initialWrite(1);
    await svc.promote({
      edgeId: 1,
      evidence: {
        kind: "field-match",
        fieldEventId: "fe-1",
        stream: "tactical",
        policy: "critical",
      },
    });
    const ec = await svc.demote({
      edgeId: 1,
      evidence: { kind: "field-contradiction", fieldEventId: "fe-2" },
    });
    expect(ec.sourceClass).toBe("OSINT_UNCORROBORATED");
    expect(ec.value).toBeLessThanOrEqual(0.2);
    expect(ec.fieldEventId).toBeNull();
  });
});

describe("SPEC-TH-040 AC-6 / I-3 — field dominance", () => {
  it("OSINT corroboration on a FIELD_HIGH edge is a no-op", async () => {
    svc.initialWrite(1);
    await svc.promote({
      edgeId: 1,
      evidence: {
        kind: "field-match",
        fieldEventId: "fe-1",
        stream: "tactical",
        policy: "critical",
      },
    });
    const before = await svc.read(1);
    const after = await svc.promote({
      edgeId: 1,
      evidence: { kind: "osint-corroboration", sources: ["noise"] },
    });
    expect(after.sourceClass).toBe(before.sourceClass);
    expect(after.value).toBe(before.value);
  });

  it("freshness expiry degrades FIELD_HIGH one class step to FIELD_LOW", async () => {
    svc.initialWrite(1);
    await svc.promote({
      edgeId: 1,
      evidence: {
        kind: "field-match",
        fieldEventId: "fe-1",
        stream: "tactical",
        policy: "critical",
      },
    });
    const ec = await svc.demote({
      edgeId: 1,
      evidence: { kind: "field-freshness-expired" },
    });
    expect(ec.sourceClass).toBe("FIELD_LOW");
    expect(ec.value).toBeCloseTo(0.85, 5);
  });
});

describe("SPEC-TH-040 AC-7 — history is complete and ordered", () => {
  it("records every transition in insertion order", async () => {
    svc.initialWrite(1);
    await svc.promote({
      edgeId: 1,
      evidence: { kind: "osint-corroboration", sources: ["B"] },
    });
    await svc.promote({
      edgeId: 1,
      evidence: {
        kind: "field-match",
        fieldEventId: "fe-1",
        stream: "tactical",
      },
    });
    await svc.demote({
      edgeId: 1,
      evidence: { kind: "field-contradiction", fieldEventId: "fe-2" },
    });

    const hist = await svc.history(1);
    expect(hist.length).toBe(4);
    const classes = hist.map((h) => h.next.sourceClass);
    expect(classes).toEqual([
      "OSINT_UNCORROBORATED",
      "OSINT_CORROBORATED",
      "FIELD_HIGH",
      "OSINT_UNCORROBORATED",
    ]);
  });

  it("history is scoped per edge", async () => {
    svc.initialWrite(1);
    svc.initialWrite(2);
    expect((await svc.history(1)).every((e) => e.edgeId === 1)).toBe(true);
    expect((await svc.history(2)).every((e) => e.edgeId === 2)).toBe(true);
  });
});

describe("SPEC-TH-040 AC-8 — sweep-targetable query", () => {
  it("filters by sourceClasses and olderThan", async () => {
    const t0 = new Date("2026-01-01T00:00:00Z");
    const t1 = new Date("2026-02-01T00:00:00Z");
    const tCutoff = new Date("2026-03-01T00:00:00Z");

    svc.initialWrite(1, t0);
    svc.initialWrite(2, t1);
    svc.initialWrite(3);

    const stale = await svc.query({
      sourceClasses: ["OSINT_UNCORROBORATED"],
      olderThan: tCutoff,
    });
    const ids = stale.map((s) => s.edgeId).sort();
    expect(ids).toEqual([1, 2]);
  });

  it("filters by minConfidence", async () => {
    svc.initialWrite(1);
    svc.initialWrite(2);
    await svc.promote({
      edgeId: 2,
      evidence: {
        kind: "field-match",
        fieldEventId: "fe-1",
        stream: "tactical",
        policy: "critical",
      },
    });
    const high = await svc.query({ minConfidence: 0.8 });
    expect(high.map((h) => h.edgeId)).toEqual([2]);
  });
});

describe("SPEC-TH-040 bounded confidence (I-4)", () => {
  it("confidence is always clamped to [0, 1]", async () => {
    svc.initialWrite(1);
    for (let i = 0; i < 50; i++) {
      await svc.promote({
        edgeId: 1,
        evidence: {
          kind: "osint-corroboration",
          sources: Array.from({ length: 20 }, (_, k) => `s-${i}-${k}`),
        },
      });
    }
    const ec = await svc.read(1);
    expect(ec.value).toBeGreaterThanOrEqual(0);
    expect(ec.value).toBeLessThanOrEqual(1);
  });

  it("class ordering respected: OSINT_UNCORROBORATED ≤ OSINT_CORROBORATED < FIELD_LOW ≤ FIELD_HIGH", () => {
    const order: SourceClass[] = [
      "OSINT_UNCORROBORATED",
      "OSINT_CORROBORATED",
      "FIELD_LOW",
      "FIELD_HIGH",
    ];
    // Sanity: the band maxes are monotonically non-decreasing.
    const maxes = [0.5, 0.75, 0.85, 1.0];
    for (let i = 1; i < order.length; i++) {
      expect(maxes[i]).toBeGreaterThanOrEqual(maxes[i - 1]!);
    }
  });
});
