// apps/console-api/tests/unit/transformers/cycle-run.transformer.test.ts
//
// BDD for the cycle-run wire projection. The transformer is the single
// bridge between the service-internal CycleRun and the HTTP response
// consumed by packages/cli/src/adapters/thalamus.http.ts — any drift
// there is a breaking contract change, so we pin the shape explicitly.
import { describe, expect, it } from "vitest";
import type {
  CycleRun,
  CycleRunFinding,
} from "../../../src/types/cycle.types";
import {
  toCycleRunDto,
  toCycleRunFindingDto,
  toCycleRunResponseDto,
} from "../../../src/transformers/cycle-run.transformer";

function baseFinding(over: Partial<CycleRunFinding> = {}): CycleRunFinding {
  return {
    id: "11",
    title: "t-1",
    summary: "s-1",
    sourceClass: "KG",
    confidence: 0.9,
    evidenceRefs: [],
    ...over,
  };
}

function baseCycle(over: Partial<CycleRun> = {}): CycleRun {
  return {
    id: "cyc:abc",
    kind: "thalamus",
    startedAt: "2026-04-19T10:00:00.000Z",
    completedAt: "2026-04-19T10:00:01.000Z",
    findingsEmitted: 2,
    cortices: ["thalamus"],
    ...over,
  };
}

describe("toCycleRunFindingDto", () => {
  it("copies all declared fields", () => {
    const dto = toCycleRunFindingDto(
      baseFinding({ evidenceRefs: ["ev:1", "ev:2"] }),
    );
    expect(dto).toEqual({
      id: "11",
      title: "t-1",
      summary: "s-1",
      sourceClass: "KG",
      confidence: 0.9,
      evidenceRefs: ["ev:1", "ev:2"],
    });
  });

  it("returns a fresh evidenceRefs array (no alias back to source)", () => {
    const src = baseFinding({ evidenceRefs: ["ev:1"] });
    const dto = toCycleRunFindingDto(src);
    expect(dto.evidenceRefs).not.toBe(src.evidenceRefs);
    expect(dto.evidenceRefs).toEqual(["ev:1"]);
  });
});

describe("toCycleRunDto", () => {
  it("maps a minimal cycle (no findings, no costUsd, no error)", () => {
    const dto = toCycleRunDto(
      baseCycle({ kind: "fish", cortices: ["nano-sweep"], findingsEmitted: 3 }),
    );
    expect(dto).toEqual({
      id: "cyc:abc",
      kind: "fish",
      startedAt: "2026-04-19T10:00:00.000Z",
      completedAt: "2026-04-19T10:00:01.000Z",
      findingsEmitted: 3,
      cortices: ["nano-sweep"],
    });
    expect(dto).not.toHaveProperty("findings");
    expect(dto).not.toHaveProperty("costUsd");
    expect(dto).not.toHaveProperty("error");
  });

  it("includes findings + costUsd when the thalamus branch ran", () => {
    const dto = toCycleRunDto(
      baseCycle({
        findings: [baseFinding(), baseFinding({ id: "12", title: "t-2" })],
        costUsd: 0.123,
      }),
    );
    expect(dto.findings).toHaveLength(2);
    expect(dto.findings![0]!.id).toBe("11");
    expect(dto.findings![1]!.id).toBe("12");
    expect(dto.costUsd).toBe(0.123);
  });

  it("preserves error on the failure path", () => {
    const dto = toCycleRunDto(baseCycle({ error: "boom", findingsEmitted: 0 }));
    expect(dto.error).toBe("boom");
  });

  it("defensively copies cortices so mutation of the DTO does not leak", () => {
    const src = baseCycle({ cortices: ["thalamus", "nano-sweep"] });
    const dto = toCycleRunDto(src);
    expect(dto.cortices).not.toBe(src.cortices);
    dto.cortices.push("mutated");
    expect(src.cortices).toEqual(["thalamus", "nano-sweep"]);
  });
});

describe("toCycleRunResponseDto", () => {
  it("wraps the projected cycle under a top-level { cycle } envelope", () => {
    const dto = toCycleRunResponseDto(baseCycle());
    expect(dto).toEqual({
      cycle: {
        id: "cyc:abc",
        kind: "thalamus",
        startedAt: "2026-04-19T10:00:00.000Z",
        completedAt: "2026-04-19T10:00:01.000Z",
        findingsEmitted: 2,
        cortices: ["thalamus"],
      },
    });
  });
});
