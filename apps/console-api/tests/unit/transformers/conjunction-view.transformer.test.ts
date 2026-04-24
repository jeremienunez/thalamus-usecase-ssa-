import { describe, it, expect } from "vitest";
import { toConjunctionView } from "../../../src/transformers/conjunction-view.transformer";
import type { ConjunctionRow } from "../../../src/types/conjunction.types";

function row(over: Partial<ConjunctionRow> = {}): ConjunctionRow {
  return {
    id: "1",
    primary_id: "123",
    secondary_id: "456",
    primary_name: "PRIMARY",
    secondary_name: "SECONDARY",
    primary_norad_id: 25544,
    secondary_norad_id: 58042,
    primary_mm: 15,
    epoch: "2024-06-01T00:00:00.000Z",
    min_range_km: 1.2,
    relative_velocity_kmps: 7.5,
    probability_of_collision: 1e-5,
    combined_sigma_km: 0.5,
    hard_body_radius_m: 20,
    pc_method: "foster-gaussian",
    computed_at: "2024-06-01T00:00:00.000Z",
    ...over,
  };
}

describe("toConjunctionView — action derivation", () => {
  it("Pc=1e-3 → maneuver_candidate", () => {
    const v = toConjunctionView(row({ probability_of_collision: 1e-3 }));
    expect(v.action).toBe("maneuver_candidate");
  });

  it("Pc=5e-5 → monitor", () => {
    const v = toConjunctionView(row({ probability_of_collision: 5e-5 }));
    expect(v.action).toBe("monitor");
  });

  it("Pc=0 → no_action", () => {
    const v = toConjunctionView(row({ probability_of_collision: 0 }));
    expect(v.action).toBe("no_action");
  });
});

describe("toConjunctionView — covariance quality derivation", () => {
  it("sigma=0.05 → HIGH", () => {
    const v = toConjunctionView(row({ combined_sigma_km: 0.05 }));
    expect(v.covarianceQuality).toBe("HIGH");
  });

  it("sigma=0.5 → MED", () => {
    const v = toConjunctionView(row({ combined_sigma_km: 0.5 }));
    expect(v.covarianceQuality).toBe("MED");
  });

  it("sigma=5 → LOW", () => {
    const v = toConjunctionView(row({ combined_sigma_km: 5 }));
    expect(v.covarianceQuality).toBe("LOW");
  });

  it("null sigma → fallback 10 → LOW", () => {
    const v = toConjunctionView(row({ combined_sigma_km: null }));
    expect(v.combinedSigmaKm).toBe(10);
    expect(v.covarianceQuality).toBe("LOW");
  });
});

describe("toConjunctionView — fallbacks & formatting", () => {
  it("null primary_name → sat-<primary_id>", () => {
    const v = toConjunctionView(row({ primary_name: null, primary_id: "123" }));
    expect(v.primaryName).toBe("sat-123");
  });

  it("null secondary_name → sat-<secondary_id>", () => {
    const v = toConjunctionView(
      row({ secondary_name: null, secondary_id: "456" }),
    );
    expect(v.secondaryName).toBe("sat-456");
  });

  it("Date object for epoch → ISO string", () => {
    const d = new Date("2024-06-01T00:00:00.000Z");
    const v = toConjunctionView(row({ epoch: d }));
    expect(v.epoch).toBe("2024-06-01T00:00:00.000Z");
  });

  it("null pc_method → foster-gaussian default", () => {
    const v = toConjunctionView(row({ pc_method: null }));
    expect(v.pcMethod).toBe("foster-gaussian");
  });

  it("null hard_body_radius_m → 20 default", () => {
    const v = toConjunctionView(row({ hard_body_radius_m: null }));
    expect(v.hardBodyRadiusM).toBe(20);
  });

  it("null relative_velocity_kmps → 0 default", () => {
    const v = toConjunctionView(row({ relative_velocity_kmps: null }));
    expect(v.relativeVelocityKmps).toBe(0);
  });

  it("null probability_of_collision → 0 default → no_action", () => {
    const v = toConjunctionView(row({ probability_of_collision: null }));
    expect(v.probabilityOfCollision).toBe(0);
    expect(v.action).toBe("no_action");
  });
});
