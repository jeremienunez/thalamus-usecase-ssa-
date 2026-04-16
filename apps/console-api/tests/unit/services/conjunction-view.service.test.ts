import { describe, it, expect, vi } from "vitest";
import { ConjunctionViewService } from "../../../src/services/conjunction-view.service";
import type {
  ConjunctionRepository,
  ConjunctionRow,
} from "../../../src/repositories/conjunction.repository";

function mockRepo(): ConjunctionRepository {
  return {
    listAboveMinPc: vi.fn(),
  } as unknown as ConjunctionRepository;
}

function row(overrides: Partial<ConjunctionRow> = {}): ConjunctionRow {
  return {
    id: "7",
    primary_id: "1",
    secondary_id: "2",
    primary_name: "SAT-A",
    secondary_name: "SAT-B",
    primary_mm: 15.5,
    epoch: "2024-01-01T00:00:00.000Z",
    min_range_km: 2.5,
    relative_velocity_kmps: 14.2,
    probability_of_collision: 1e-5,
    combined_sigma_km: 0.5,
    hard_body_radius_m: 5,
    pc_method: "foster-gaussian",
    computed_at: "2024-01-02T00:00:00.000Z",
    ...overrides,
  };
}

describe("ConjunctionViewService.list", () => {
  it("returns empty when repo returns no rows", async () => {
    const repo = mockRepo();
    (repo.listAboveMinPc as ReturnType<typeof vi.fn>).mockResolvedValue([]);
    const svc = new ConjunctionViewService(repo);
    const res = await svc.list({ minPc: 0 });
    expect(res).toEqual({ items: [], count: 0 });
    expect(repo.listAboveMinPc).toHaveBeenCalledWith(0);
  });

  it("forwards minPc to the repo", async () => {
    const repo = mockRepo();
    (repo.listAboveMinPc as ReturnType<typeof vi.fn>).mockResolvedValue([]);
    const svc = new ConjunctionViewService(repo);
    await svc.list({ minPc: 1e-4 });
    expect(repo.listAboveMinPc).toHaveBeenCalledWith(1e-4);
  });

  it("maps high Pc (1e-3) to action 'maneuver_candidate'", async () => {
    const repo = mockRepo();
    (repo.listAboveMinPc as ReturnType<typeof vi.fn>).mockResolvedValue([
      row({ probability_of_collision: 1e-3 }),
    ]);
    const svc = new ConjunctionViewService(repo);
    const { items } = await svc.list({ minPc: 0 });
    expect(items[0]!.action).toBe("maneuver_candidate");
  });

  it("maps medium Pc (5e-5) to action 'monitor'", async () => {
    const repo = mockRepo();
    (repo.listAboveMinPc as ReturnType<typeof vi.fn>).mockResolvedValue([
      row({ probability_of_collision: 5e-5 }),
    ]);
    const svc = new ConjunctionViewService(repo);
    const { items } = await svc.list({ minPc: 0 });
    expect(items[0]!.action).toBe("monitor");
  });

  it("maps null Pc to 0 and action 'no_action'", async () => {
    const repo = mockRepo();
    (repo.listAboveMinPc as ReturnType<typeof vi.fn>).mockResolvedValue([
      row({ probability_of_collision: null }),
    ]);
    const svc = new ConjunctionViewService(repo);
    const { items } = await svc.list({ minPc: 0 });
    expect(items[0]!.probabilityOfCollision).toBe(0);
    expect(items[0]!.action).toBe("no_action");
  });

  it("maps small sigma (0.05) to covarianceQuality 'HIGH'", async () => {
    const repo = mockRepo();
    (repo.listAboveMinPc as ReturnType<typeof vi.fn>).mockResolvedValue([
      row({ combined_sigma_km: 0.05 }),
    ]);
    const svc = new ConjunctionViewService(repo);
    const { items } = await svc.list({ minPc: 0 });
    expect(items[0]!.covarianceQuality).toBe("HIGH");
  });

  it("maps medium sigma (0.5) to covarianceQuality 'MED'", async () => {
    const repo = mockRepo();
    (repo.listAboveMinPc as ReturnType<typeof vi.fn>).mockResolvedValue([
      row({ combined_sigma_km: 0.5 }),
    ]);
    const svc = new ConjunctionViewService(repo);
    const { items } = await svc.list({ minPc: 0 });
    expect(items[0]!.covarianceQuality).toBe("MED");
  });

  it("maps null sigma to fallback 10 and covarianceQuality 'LOW'", async () => {
    const repo = mockRepo();
    (repo.listAboveMinPc as ReturnType<typeof vi.fn>).mockResolvedValue([
      row({ combined_sigma_km: null }),
    ]);
    const svc = new ConjunctionViewService(repo);
    const { items } = await svc.list({ minPc: 0 });
    expect(items[0]!.combinedSigmaKm).toBe(10);
    expect(items[0]!.covarianceQuality).toBe("LOW");
  });

  it("derives regime from primary_mm (low mm → GEO)", async () => {
    const repo = mockRepo();
    (repo.listAboveMinPc as ReturnType<typeof vi.fn>).mockResolvedValue([
      row({ primary_mm: 1.0 }),
    ]);
    const svc = new ConjunctionViewService(repo);
    const { items } = await svc.list({ minPc: 0 });
    expect(items[0]!.regime).toBe("GEO");
  });

  it("derives regime LEO for high mm", async () => {
    const repo = mockRepo();
    (repo.listAboveMinPc as ReturnType<typeof vi.fn>).mockResolvedValue([
      row({ primary_mm: 15.5 }),
    ]);
    const svc = new ConjunctionViewService(repo);
    const { items } = await svc.list({ minPc: 0 });
    expect(items[0]!.regime).toBe("LEO");
  });

  it("falls back null relative_velocity to 0", async () => {
    const repo = mockRepo();
    (repo.listAboveMinPc as ReturnType<typeof vi.fn>).mockResolvedValue([
      row({ relative_velocity_kmps: null }),
    ]);
    const svc = new ConjunctionViewService(repo);
    const { items } = await svc.list({ minPc: 0 });
    expect(items[0]!.relativeVelocityKmps).toBe(0);
  });

  it("falls back null hard_body_radius_m to 20", async () => {
    const repo = mockRepo();
    (repo.listAboveMinPc as ReturnType<typeof vi.fn>).mockResolvedValue([
      row({ hard_body_radius_m: null }),
    ]);
    const svc = new ConjunctionViewService(repo);
    const { items } = await svc.list({ minPc: 0 });
    expect(items[0]!.hardBodyRadiusM).toBe(20);
  });

  it("falls back null pc_method to 'foster-gaussian'", async () => {
    const repo = mockRepo();
    (repo.listAboveMinPc as ReturnType<typeof vi.fn>).mockResolvedValue([
      row({ pc_method: null }),
    ]);
    const svc = new ConjunctionViewService(repo);
    const { items } = await svc.list({ minPc: 0 });
    expect(items[0]!.pcMethod).toBe("foster-gaussian");
  });

  it("falls back null primary_name/secondary_name to sat-${id}", async () => {
    const repo = mockRepo();
    (repo.listAboveMinPc as ReturnType<typeof vi.fn>).mockResolvedValue([
      row({
        primary_id: "100",
        secondary_id: "200",
        primary_name: null as unknown as string,
        secondary_name: null as unknown as string,
      }),
    ]);
    const svc = new ConjunctionViewService(repo);
    const { items } = await svc.list({ minPc: 0 });
    expect(items[0]!.primaryName).toBe("sat-100");
    expect(items[0]!.secondaryName).toBe("sat-200");
  });

  it("normalises Date epoch to ISO string", async () => {
    const repo = mockRepo();
    const d = new Date("2024-05-01T12:00:00.000Z");
    (repo.listAboveMinPc as ReturnType<typeof vi.fn>).mockResolvedValue([
      row({ epoch: d, computed_at: d }),
    ]);
    const svc = new ConjunctionViewService(repo);
    const { items } = await svc.list({ minPc: 0 });
    expect(items[0]!.epoch).toBe("2024-05-01T12:00:00.000Z");
    expect(items[0]!.computedAt).toBe("2024-05-01T12:00:00.000Z");
  });

  it("normalises string epoch to ISO string", async () => {
    const repo = mockRepo();
    (repo.listAboveMinPc as ReturnType<typeof vi.fn>).mockResolvedValue([
      row({
        epoch: "2024-05-01T12:00:00Z",
        computed_at: "2024-05-02T08:30:00Z",
      }),
    ]);
    const svc = new ConjunctionViewService(repo);
    const { items } = await svc.list({ minPc: 0 });
    expect(items[0]!.epoch).toBe("2024-05-01T12:00:00.000Z");
    expect(items[0]!.computedAt).toBe("2024-05-02T08:30:00.000Z");
  });

  it("converts string ids to numbers", async () => {
    const repo = mockRepo();
    (repo.listAboveMinPc as ReturnType<typeof vi.fn>).mockResolvedValue([
      row({ id: "77", primary_id: "42", secondary_id: "99" }),
    ]);
    const svc = new ConjunctionViewService(repo);
    const { items } = await svc.list({ minPc: 0 });
    expect(items[0]!.id).toBe(77);
    expect(items[0]!.primaryId).toBe(42);
    expect(items[0]!.secondaryId).toBe(99);
  });

  it("returns count matching items length", async () => {
    const repo = mockRepo();
    (repo.listAboveMinPc as ReturnType<typeof vi.fn>).mockResolvedValue([
      row({ id: "1" }),
      row({ id: "2" }),
      row({ id: "3" }),
    ]);
    const svc = new ConjunctionViewService(repo);
    const { items, count } = await svc.list({ minPc: 0 });
    expect(items.length).toBe(3);
    expect(count).toBe(3);
  });
});
