import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  SweepSuggestionsService,
  type SweepSuggestionsDeps,
} from "../../../src/services/sweep-suggestions.service";

function row(overrides: Partial<{
  id: string;
  title: string;
  description: string;
  suggestedAction: string;
  category: string;
  severity: string;
  operatorCountryName: string | null;
  affectedSatellites: number;
  createdAt: string;
  accepted: boolean;
  resolutionStatus: string;
  resolutionPayload: string | null;
}> = {}) {
  return {
    id: "s:1",
    title: "Example suggestion",
    description: "desc",
    suggestedAction: "review",
    category: "catalog",
    severity: "low",
    operatorCountryName: "US",
    affectedSatellites: 3,
    createdAt: "2026-04-16T00:00:00.000Z",
    accepted: false,
    resolutionStatus: "pending",
    resolutionPayload: null as string | null,
    ...overrides,
  };
}

function mockDeps(): SweepSuggestionsDeps {
  return {
    sweepRepo: {
      list: vi.fn(),
      review: vi.fn(),
    },
    resolutionService: {
      resolve: vi.fn(),
    },
  };
}

describe("SweepSuggestionsService.list", () => {
  let deps: SweepSuggestionsDeps;
  let svc: SweepSuggestionsService;

  beforeEach(() => {
    deps = mockDeps();
    svc = new SweepSuggestionsService(deps);
  });

  it("projects rows to DTO with hasPayload=true when resolutionPayload truthy", async () => {
    (deps.sweepRepo.list as ReturnType<typeof vi.fn>).mockResolvedValue({
      rows: [
        row({ id: "s:1", resolutionPayload: '{"kind":"patch"}' }),
        row({ id: "s:2", resolutionPayload: null }),
      ],
    });
    const { items, count } = await svc.list();
    expect(deps.sweepRepo.list).toHaveBeenCalledWith({
      reviewed: false,
      limit: 100,
    });
    expect(count).toBe(2);
    expect(items[0]).toMatchObject({ id: "s:1", hasPayload: true });
    expect(items[1]).toMatchObject({ id: "s:2", hasPayload: false });
    // ensure resolutionPayload itself is NOT leaked to the DTO
    expect(items[0]).not.toHaveProperty("resolutionPayload");
  });

  it("returns empty shape when repo returns no rows", async () => {
    (deps.sweepRepo.list as ReturnType<typeof vi.fn>).mockResolvedValue({
      rows: [],
    });
    const res = await svc.list();
    expect(res).toEqual({ items: [], count: 0 });
  });
});

describe("SweepSuggestionsService.review", () => {
  let deps: SweepSuggestionsDeps;
  let svc: SweepSuggestionsService;

  beforeEach(() => {
    deps = mockDeps();
    svc = new SweepSuggestionsService(deps);
  });

  it("returns notFound when sweepRepo.review returns false (does NOT call resolve)", async () => {
    (deps.sweepRepo.review as ReturnType<typeof vi.fn>).mockResolvedValue(
      false,
    );
    const res = await svc.review("s:404", true);
    expect(res).toEqual({ ok: false, notFound: true });
    expect(deps.resolutionService.resolve).not.toHaveBeenCalled();
  });

  it("reject path (accept=false): does NOT call resolutionService.resolve", async () => {
    (deps.sweepRepo.review as ReturnType<typeof vi.fn>).mockResolvedValue(true);
    const res = await svc.review("s:1", false, "looks spurious");
    expect(deps.sweepRepo.review).toHaveBeenCalledWith(
      "s:1",
      false,
      "looks spurious",
    );
    expect(deps.resolutionService.resolve).not.toHaveBeenCalled();
    expect(res).toEqual({ ok: true, reviewed: true, resolution: null });
  });

  it("accept path: calls resolutionService.resolve and returns its value", async () => {
    (deps.sweepRepo.review as ReturnType<typeof vi.fn>).mockResolvedValue(true);
    (deps.resolutionService.resolve as ReturnType<typeof vi.fn>).mockResolvedValue({
      applied: true,
      findingId: "f:7",
    });
    const res = await svc.review("s:1", true);
    expect(deps.resolutionService.resolve).toHaveBeenCalledWith("s:1");
    expect(res).toEqual({
      ok: true,
      reviewed: true,
      resolution: { applied: true, findingId: "f:7" },
    });
  });
});
