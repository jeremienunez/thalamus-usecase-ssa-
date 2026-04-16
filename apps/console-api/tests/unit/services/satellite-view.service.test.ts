import { describe, it, expect, vi } from "vitest";
import { SatelliteViewService } from "../../../src/services/satellite-view.service";
import type {
  SatelliteRepository,
  SatelliteOrbitalRow,
} from "../../../src/repositories/satellite.repository";
import { smaFromMeanMotion } from "@interview/shared";

function mockRepo(): SatelliteRepository {
  return {
    listWithOrbital: vi.fn(),
    findPayloadNamesByIds: vi.fn(),
    updateField: vi.fn(),
    listNullCandidatesForField: vi.fn(),
    knnNeighboursForField: vi.fn(),
  } as unknown as SatelliteRepository;
}

function row(overrides: Partial<SatelliteOrbitalRow> = {}): SatelliteOrbitalRow {
  return {
    id: "42",
    name: "TEST-SAT",
    norad_id: 12345,
    operator: "SPACEX",
    operator_country: "US",
    launch_year: 2020,
    mass_kg: 260,
    classification_tier: "unclassified",
    opacity_score: "0.5",
    telemetry_summary: {
      meanMotion: 15.5,
      inclination: 53,
      eccentricity: 0.0001,
      raan: 120,
      argPerigee: 30,
      meanAnomaly: 45,
      epoch: "2024-01-01T00:00:00.000Z",
    },
    ...overrides,
  };
}

describe("SatelliteViewService.list", () => {
  it("returns empty items/total when repo returns no rows", async () => {
    const repo = mockRepo();
    (repo.listWithOrbital as ReturnType<typeof vi.fn>).mockResolvedValue([]);
    const svc = new SatelliteViewService(repo);
    const res = await svc.list({ limit: 100 });
    expect(res).toEqual({ items: [], total: 0 });
    expect(repo.listWithOrbital).toHaveBeenCalledWith(100);
  });

  it("maps a single row to a SatelliteView with Number-converted id", async () => {
    const repo = mockRepo();
    (repo.listWithOrbital as ReturnType<typeof vi.fn>).mockResolvedValue([
      row({ id: "42" }),
    ]);
    const svc = new SatelliteViewService(repo);
    const { items, total } = await svc.list({ limit: 10 });
    expect(total).toBe(1);
    expect(items[0]!.id).toBe(42);
    expect(items[0]!.name).toBe("TEST-SAT");
    expect(items[0]!.noradId).toBe(12345);
  });

  it("derives regime from telemetry_summary.regime when it is a string (GEO)", async () => {
    const repo = mockRepo();
    (repo.listWithOrbital as ReturnType<typeof vi.fn>).mockResolvedValue([
      row({
        telemetry_summary: {
          regime: "GEO",
          meanMotion: 15.5, // would map to LEO — proves regime wins
          raan: 0,
        },
      }),
    ]);
    const svc = new SatelliteViewService(repo);
    const { items } = await svc.list({ limit: 10 });
    expect(items[0]!.regime).toBe("GEO");
  });

  it("derives regime from meanMotion when telemetry_summary.regime absent", async () => {
    const repo = mockRepo();
    (repo.listWithOrbital as ReturnType<typeof vi.fn>).mockResolvedValue([
      row({
        telemetry_summary: { meanMotion: 1.0, raan: 0 }, // < 1.1 → GEO
      }),
      row({
        id: "43",
        telemetry_summary: { meanMotion: 3.0, raan: 0 }, // < 5 → MEO
      }),
      row({
        id: "44",
        telemetry_summary: { meanMotion: 15.5, raan: 0 }, // >= 11 → LEO
      }),
    ]);
    const svc = new SatelliteViewService(repo);
    const { items } = await svc.list({ limit: 10 });
    expect(items[0]!.regime).toBe("GEO");
    expect(items[1]!.regime).toBe("MEO");
    expect(items[2]!.regime).toBe("LEO");
  });

  it("falls back noradId to 0 when null, operator to 'Unknown', country to '—'", async () => {
    const repo = mockRepo();
    (repo.listWithOrbital as ReturnType<typeof vi.fn>).mockResolvedValue([
      row({ norad_id: null, operator: null, operator_country: null }),
    ]);
    const svc = new SatelliteViewService(repo);
    const { items } = await svc.list({ limit: 10 });
    expect(items[0]!.noradId).toBe(0);
    expect(items[0]!.operator).toBe("Unknown");
    expect(items[0]!.country).toBe("—");
  });

  it("parses opacity_score string to number", async () => {
    const repo = mockRepo();
    (repo.listWithOrbital as ReturnType<typeof vi.fn>).mockResolvedValue([
      row({ opacity_score: "0.73" }),
    ]);
    const svc = new SatelliteViewService(repo);
    const { items } = await svc.list({ limit: 10 });
    expect(items[0]!.opacityScore).toBeCloseTo(0.73);
    expect(typeof items[0]!.opacityScore).toBe("number");
  });

  it("returns null opacityScore when opacity_score is null", async () => {
    const repo = mockRepo();
    (repo.listWithOrbital as ReturnType<typeof vi.fn>).mockResolvedValue([
      row({ opacity_score: null }),
    ]);
    const svc = new SatelliteViewService(repo);
    const { items } = await svc.list({ limit: 10 });
    expect(items[0]!.opacityScore).toBeNull();
  });

  it("computes semiMajorAxisKm from meanMotion via smaFromMeanMotion", async () => {
    const repo = mockRepo();
    const mm = 15.5;
    (repo.listWithOrbital as ReturnType<typeof vi.fn>).mockResolvedValue([
      row({ telemetry_summary: { meanMotion: mm, raan: 0 } }),
    ]);
    const svc = new SatelliteViewService(repo);
    const { items } = await svc.list({ limit: 10 });
    expect(items[0]!.semiMajorAxisKm).toBeCloseTo(smaFromMeanMotion(mm), 4);
  });

  it("derives classificationTier from raw string", async () => {
    const repo = mockRepo();
    (repo.listWithOrbital as ReturnType<typeof vi.fn>).mockResolvedValue([
      row({ id: "1", classification_tier: "restricted" }),
      row({ id: "2", classification_tier: "sensitive" }),
      row({ id: "3", classification_tier: null }),
    ]);
    const svc = new SatelliteViewService(repo);
    const { items } = await svc.list({ limit: 10 });
    expect(items[0]!.classificationTier).toBe("restricted");
    expect(items[1]!.classificationTier).toBe("sensitive");
    expect(items[2]!.classificationTier).toBe("unclassified");
  });

  it("applies regime filter AFTER mapping (keeps only matches)", async () => {
    const repo = mockRepo();
    (repo.listWithOrbital as ReturnType<typeof vi.fn>).mockResolvedValue([
      row({ id: "1", telemetry_summary: { regime: "GEO", raan: 0 } }),
      row({ id: "2", telemetry_summary: { regime: "LEO", raan: 0 } }),
      row({ id: "3", telemetry_summary: { regime: "GEO", raan: 0 } }),
    ]);
    const svc = new SatelliteViewService(repo);
    const { items, total } = await svc.list({ limit: 10, regime: "GEO" });
    expect(items.map((i) => i.id)).toEqual([1, 3]);
    expect(total).toBe(2);
  });

  it("returns empty items when regime filter matches nothing", async () => {
    const repo = mockRepo();
    (repo.listWithOrbital as ReturnType<typeof vi.fn>).mockResolvedValue([
      row({ id: "1", telemetry_summary: { regime: "LEO", raan: 0 } }),
    ]);
    const svc = new SatelliteViewService(repo);
    const res = await svc.list({ limit: 10, regime: "GEO" });
    expect(res).toEqual({ items: [], total: 0 });
  });
});
