import { describe, it, expect, vi, beforeEach } from "vitest";
import type { Database } from "@interview/db-schema";
import { fakePort } from "@interview/test-kit";

const mocks = vi.hoisted(() => ({
  createTleHistorySource: vi.fn(),
  createSpaceWeatherSource: vi.fn(),
  createLaunchManifestSource: vi.fn(),
  createNotamSource: vi.fn(),
  createFragmentationEventsSource: vi.fn(),
  createItuFilingsSource: vi.fn(),
}));

vi.mock(
  "../../../../../../src/agent/ssa/sweep/ingesters/tle-history-fetcher",
  () => ({ createTleHistorySource: mocks.createTleHistorySource }),
);
vi.mock(
  "../../../../../../src/agent/ssa/sweep/ingesters/space-weather-fetcher",
  () => ({ createSpaceWeatherSource: mocks.createSpaceWeatherSource }),
);
vi.mock(
  "../../../../../../src/agent/ssa/sweep/ingesters/launch-manifest-fetcher",
  () => ({ createLaunchManifestSource: mocks.createLaunchManifestSource }),
);
vi.mock(
  "../../../../../../src/agent/ssa/sweep/ingesters/notam-fetcher",
  () => ({ createNotamSource: mocks.createNotamSource }),
);
vi.mock(
  "../../../../../../src/agent/ssa/sweep/ingesters/fragmentation-events-fetcher",
  () => ({
    createFragmentationEventsSource: mocks.createFragmentationEventsSource,
  }),
);
vi.mock(
  "../../../../../../src/agent/ssa/sweep/ingesters/itu-filings-fetcher",
  () => ({ createItuFilingsSource: mocks.createItuFilingsSource }),
);

import { createSsaIngestionProvider } from "../../../../../../src/agent/ssa/sweep/ingesters";

beforeEach(() => {
  vi.clearAllMocks();
});

describe("createSsaIngestionProvider", () => {
  it("registers the 6 SSA ingestion sources in the expected order", () => {
    const db = fakePort<Database>({});
    const ctx = { add: vi.fn() };
    const tle = { id: "tle-history" };
    const weather = { id: "space-weather" };
    const launches = { id: "launch-manifest" };
    const notams = { id: "notams" };
    const fragmentation = { id: "fragmentation-events" };
    const filings = { id: "itu-filings" };
    mocks.createTleHistorySource.mockReturnValueOnce(tle);
    mocks.createSpaceWeatherSource.mockReturnValueOnce(weather);
    mocks.createLaunchManifestSource.mockReturnValueOnce(launches);
    mocks.createNotamSource.mockReturnValueOnce(notams);
    mocks.createFragmentationEventsSource.mockReturnValueOnce(fragmentation);
    mocks.createItuFilingsSource.mockReturnValueOnce(filings);

    const provider = createSsaIngestionProvider(db);
    provider.register(ctx);

    expect(mocks.createTleHistorySource).toHaveBeenCalledWith(db);
    expect(mocks.createSpaceWeatherSource).toHaveBeenCalledWith(db);
    expect(mocks.createLaunchManifestSource).toHaveBeenCalledWith(db);
    expect(mocks.createNotamSource).toHaveBeenCalledWith(db);
    expect(mocks.createFragmentationEventsSource).toHaveBeenCalledWith(db);
    expect(mocks.createItuFilingsSource).toHaveBeenCalledWith(db);
    expect(ctx.add.mock.calls).toEqual([
      [tle],
      [weather],
      [launches],
      [notams],
      [fragmentation],
      [filings],
    ]);
  });
});
