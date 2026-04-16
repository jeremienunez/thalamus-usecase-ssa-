import { beforeEach, describe, expect, it, vi } from "vitest";
import type { MissionTask } from "../../../src/types";

vi.mock("@interview/thalamus", () => ({
  BAS_NIVEAU_LOGIT_BIAS: { 1: -100 },
  callNanoWithMode: vi.fn(),
}));

import { callNanoWithMode } from "@interview/thalamus";
import { NanoResearchService } from "../../../src/services/nano-research.service";

function task(overrides: Partial<MissionTask> = {}): MissionTask {
  return {
    suggestionId: "s-1",
    satelliteId: "42",
    satelliteName: "FENGYUN 3A",
    noradId: 32958,
    field: "lifetime",
    operatorCountry: "China",
    status: "pending",
    value: null,
    confidence: 0,
    source: null,
    ...overrides,
  };
}

describe("NanoResearchService.singleVote", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns a parsed vote and includes NORAD in the prompt when present", async () => {
    vi.mocked(callNanoWithMode).mockResolvedValue({
      ok: true,
      text: JSON.stringify({
        value: 12,
        unit: "years",
        confidence: 0.82,
        source: "https://example.org/fengyun-3a",
      }),
      urls: ["https://example.org/fengyun-3a"],
      latencyMs: 120,
    });

    const result = await new NanoResearchService().singleVote(
      task(),
      "Check the operator page first.",
    );

    expect(result).toEqual({
      ok: true,
      value: 12,
      confidence: 0.82,
      source: "https://example.org/fengyun-3a",
      unit: "years",
      reason: "",
    });
    expect(callNanoWithMode).toHaveBeenCalledOnce();
    expect(vi.mocked(callNanoWithMode).mock.calls[0]![0]).toMatchObject({
      enableWebSearch: true,
    });
    expect(String(vi.mocked(callNanoWithMode).mock.calls[0]![0].input)).toContain(
      "FENGYUN 3A (NORAD 32958)",
    );
  });

  it("omits the NORAD suffix when the task has no noradId", async () => {
    vi.mocked(callNanoWithMode).mockResolvedValue({
      ok: true,
      text: JSON.stringify({
        value: "FY-3A bus",
        unit: "",
        confidence: 0.8,
        source: "https://example.org/fy3a",
      }),
      urls: ["https://example.org/fy3a"],
      latencyMs: 50,
    });

    await new NanoResearchService().singleVote(
      task({ noradId: null, field: "variant" }),
      "Use the operator's product sheet.",
    );

    expect(String(vi.mocked(callNanoWithMode).mock.calls[0]![0].input)).toContain(
      "Satellite: FENGYUN 3A, operated by China.",
    );
    expect(String(vi.mocked(callNanoWithMode).mock.calls[0]![0].input)).not.toContain(
      "NORAD",
    );
  });

  it("returns the transport error when the nano call fails", async () => {
    vi.mocked(callNanoWithMode).mockResolvedValue({
      ok: false,
      text: "",
      urls: [],
      latencyMs: 0,
      error: "timeout",
    });

    await expect(
      new NanoResearchService().singleVote(task(), "Check official docs."),
    ).resolves.toEqual({
      ok: false,
      value: null,
      confidence: 0,
      source: "",
      unit: "",
      reason: "timeout",
    });
  });

  it("rejects hedged wording before JSON parsing", async () => {
    vi.mocked(callNanoWithMode).mockResolvedValue({
      ok: true,
      text: '{"value":12,"unit":"years","confidence":0.9,"source":"https://example.org"} approximately',
      urls: ["https://example.org"],
      latencyMs: 0,
    });

    await expect(
      new NanoResearchService().singleVote(task(), "Check official docs."),
    ).resolves.toMatchObject({
      ok: false,
      reason: 'hedging "approximately"',
    });
  });

  it("rejects missing JSON, invalid JSON, null values, and low confidence", async () => {
    vi.mocked(callNanoWithMode)
      .mockResolvedValueOnce({
        ok: true,
        text: "no structured answer",
        urls: [],
        latencyMs: 0,
      })
      .mockResolvedValueOnce({
        ok: true,
        text: '{"value": 12,',
        urls: [],
        latencyMs: 0,
      })
      .mockResolvedValueOnce({
        ok: true,
        text: '{"value":null,"confidence":0.9,"source":"https://example.org"}',
        urls: ["https://example.org"],
        latencyMs: 0,
      })
      .mockResolvedValueOnce({
        ok: true,
        text: '{"value":12,"confidence":0.59,"source":"https://example.org"}',
        urls: ["https://example.org"],
        latencyMs: 0,
      });

    const svc = new NanoResearchService();

    await expect(svc.singleVote(task(), "A")).resolves.toMatchObject({
      ok: false,
      reason: "no JSON",
    });
    await expect(svc.singleVote(task(), "B")).resolves.toMatchObject({
      ok: false,
      reason: "no JSON",
    });
    await expect(svc.singleVote(task(), "C")).resolves.toMatchObject({
      ok: false,
      reason: "no value",
    });
    await expect(svc.singleVote(task(), "D")).resolves.toMatchObject({
      ok: false,
      reason: "low confidence 0.59",
    });
  });

  it("rejects non-https sources and uncited hosts", async () => {
    vi.mocked(callNanoWithMode)
      .mockResolvedValueOnce({
        ok: true,
        text: '{"value":12,"confidence":0.9,"source":"http://example.org"}',
        urls: ["http://example.org"],
        latencyMs: 0,
      })
      .mockResolvedValueOnce({
        ok: true,
        text: '{"value":12,"confidence":0.9,"source":"https://example.org/fact"}',
        urls: ["https://other-site.org/fact"],
        latencyMs: 0,
      });

    const svc = new NanoResearchService();

    await expect(svc.singleVote(task(), "A")).resolves.toMatchObject({
      ok: false,
      reason: "no https source",
    });
    await expect(svc.singleVote(task(), "B")).resolves.toMatchObject({
      ok: false,
      reason: "source not cited",
    });
  });

  it("rejects unit mismatches for constrained numeric fields", async () => {
    vi.mocked(callNanoWithMode).mockResolvedValue({
      ok: true,
      text: '{"value":12,"unit":"months","confidence":0.9,"source":"https://example.org"}',
      urls: ["https://example.org/spec"],
      latencyMs: 0,
    });

    await expect(
      new NanoResearchService().singleVote(task({ field: "lifetime" }), "A"),
    ).resolves.toMatchObject({
      ok: false,
      reason: 'unit "months"',
    });
  });
});

describe("NanoResearchService.votesAgree", () => {
  const svc = new NanoResearchService();

  it("accepts numeric votes within 10 percent relative delta", () => {
    expect(svc.votesAgree(100, 109)).toBe(true);
    expect(svc.votesAgree(0.1, 0.109)).toBe(true);
  });

  it("rejects numeric votes beyond 10 percent relative delta", () => {
    expect(svc.votesAgree(100, 112)).toBe(false);
  });

  it("compares text votes case-insensitively after trimming", () => {
    expect(svc.votesAgree("  CNES  ", "cnes")).toBe(true);
    expect(svc.votesAgree("CNES", "ESA")).toBe(false);
  });
});

describe("NanoResearchService.summary", () => {
  const svc = new NanoResearchService();

  it("returns ok for successful votes and the reason otherwise", () => {
    expect(
      svc.summary({
        ok: true,
        value: 1,
        confidence: 0.8,
        source: "https://example.org",
        unit: "",
        reason: "",
      }),
    ).toBe("ok");
    expect(
      svc.summary({
        ok: false,
        value: null,
        confidence: 0,
        source: "",
        unit: "",
        reason: "source not cited",
      }),
    ).toBe("source not cited");
  });
});
