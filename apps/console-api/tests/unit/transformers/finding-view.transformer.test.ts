import { describe, it, expect } from "vitest";
import {
  toFindingDetailView,
  toFindingListView,
} from "../../../src/transformers/finding-view.transformer";
import type {
  FindingDetailRow,
  FindingRow,
} from "../../../src/repositories/finding.repository";

function listRow(over: Partial<FindingRow> = {}): FindingRow {
  return {
    id: "42",
    title: "title",
    summary: "summary",
    cortex: "anomaly",
    status: "active",
    confidence: 0.876,
    created_at: "2024-06-01T00:00:00.000Z",
    research_cycle_id: "7",
    ...over,
  };
}

function detailRow(over: Partial<FindingDetailRow> = {}): FindingDetailRow {
  return {
    ...listRow(),
    evidence: [],
    ...over,
  };
}

describe("toFindingListView", () => {
  it("maps basic fields with f: prefix and rounded priority", () => {
    const v = toFindingListView(listRow());
    expect(v.id).toBe("f:42");
    expect(v.title).toBe("title");
    expect(v.summary).toBe("summary");
    expect(v.cortex).toBe("anomaly");
    expect(v.priority).toBe(88); // round(0.876*100)
  });

  it("maps status via mapFindingStatus (active → pending)", () => {
    const v = toFindingListView(listRow({ status: "active" }));
    expect(v.status).toBe("pending");
  });

  it("maps status via mapFindingStatus (archived → accepted)", () => {
    const v = toFindingListView(listRow({ status: "archived" }));
    expect(v.status).toBe("accepted");
  });

  it("ISO-ifies Date created_at", () => {
    const d = new Date("2024-06-01T00:00:00.000Z");
    const v = toFindingListView(listRow({ created_at: d }));
    expect(v.createdAt).toBe("2024-06-01T00:00:00.000Z");
  });

  it("ISO-ifies string created_at", () => {
    const v = toFindingListView(
      listRow({ created_at: "2024-06-01T00:00:00.000Z" }),
    );
    expect(v.createdAt).toBe("2024-06-01T00:00:00.000Z");
  });

  it("linkedEntityIds and evidence start empty", () => {
    const v = toFindingListView(listRow());
    expect(v.linkedEntityIds).toEqual([]);
    expect(v.evidence).toEqual([]);
  });
});

describe("toFindingDetailView", () => {
  it("builds linkedEntityIds from edge rows via entityRef", () => {
    const v = toFindingDetailView(detailRow(), [
      { entity_type: "satellite", entity_id: "123" },
      { entity_type: "operator", entity_id: "SpaceX" },
      { entity_type: "orbit_regime", entity_id: "LEO" },
      { entity_type: "payload", entity_id: "99" },
    ]);
    expect(v.linkedEntityIds).toEqual([
      "sat:123",
      "op:SpaceX",
      "regime:LEO",
      "payload:99",
    ]);
  });

  it("parses evidence kind field/osint/derived from source", () => {
    const v = toFindingDetailView(
      detailRow({
        evidence: [
          { source: "field", data: { url: "u1", snippet: "s1" } },
          { source: "osint", data: { uri: "u2", snippet: "s2" } },
          { source: "other", data: { url: "u3" } },
        ],
      }),
      [],
    );
    expect(v.evidence[0].kind).toBe("field");
    expect(v.evidence[0].uri).toBe("u1");
    expect(v.evidence[0].snippet).toBe("s1");
    expect(v.evidence[1].kind).toBe("osint");
    expect(v.evidence[1].uri).toBe("u2");
    expect(v.evidence[2].kind).toBe("derived");
    expect(v.evidence[2].uri).toBe("u3");
    expect(v.evidence[2].snippet).toBe("");
  });

  it("missing source defaults to derived", () => {
    const v = toFindingDetailView(
      detailRow({ evidence: [{ data: { url: "u" } }] }),
      [],
    );
    expect(v.evidence[0].kind).toBe("derived");
  });

  it("uri fallback: url → uri → —", () => {
    const v = toFindingDetailView(
      detailRow({
        evidence: [
          { source: "field", data: { url: "use-url", uri: "ignored" } },
          { source: "field", data: { uri: "use-uri" } },
          { source: "field", data: {} },
        ],
      }),
      [],
    );
    expect(v.evidence[0].uri).toBe("use-url");
    expect(v.evidence[1].uri).toBe("use-uri");
    expect(v.evidence[2].uri).toBe("—");
  });

  it("snippet defaults to empty string when absent", () => {
    const v = toFindingDetailView(
      detailRow({ evidence: [{ source: "field", data: {} }] }),
      [],
    );
    expect(v.evidence[0].snippet).toBe("");
  });

  it("non-array evidence yields empty evidence array", () => {
    const v = toFindingDetailView(
      detailRow({ evidence: null as unknown }),
      [],
    );
    expect(v.evidence).toEqual([]);
  });

  it("maps status/priority/createdAt like list view", () => {
    const v = toFindingDetailView(
      detailRow({ status: "archived", confidence: 0.5 }),
      [],
    );
    expect(v.status).toBe("accepted");
    expect(v.priority).toBe(50);
    expect(v.createdAt).toBe("2024-06-01T00:00:00.000Z");
    expect(v.id).toBe("f:42");
  });
});
