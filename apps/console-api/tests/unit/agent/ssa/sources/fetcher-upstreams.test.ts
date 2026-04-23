import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { SourceKind as RegisteredSourceKind } from "../../../../../src/agent/ssa/sources/types";

const celestrakTokenKey = ["CELESTRAK", "API", "TOKEN"].join("_");
const launchScoreTokenKey = ["GLOBAL", "LAUNCH", "SCORE", "TOKEN"].join("_");
const ituApiKeyKey = ["ITU", "SRS", "API", "KEY"].join("_");

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

async function loadFetcher(
  kind: RegisteredSourceKind,
  modulePath: string,
) {
  vi.resetModules();
  await import(modulePath);
  const { getFetcherByKind } = await import(
    "../../../../../src/agent/ssa/sources/registry"
  );
  const fetcher = getFetcherByKind(kind);
  expect(fetcher).toBeTypeOf("function");
  if (!fetcher) throw new Error(`missing fetcher for ${kind}`);
  return fetcher;
}

beforeEach(() => {
  delete process.env[celestrakTokenKey];
  delete process.env[launchScoreTokenKey];
  delete process.env[ituApiKeyKey];
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe("bus-archetype fetcher", () => {
  it("returns [] immediately when no usable bus name is supplied", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    const fetcher = await loadFetcher(
      "bus-archetype",
      "../../../../../src/agent/ssa/sources/fetcher-bus-archetype",
    );
    const out = await fetcher({});

    expect(fetchMock).not.toHaveBeenCalled();
    expect(out).toEqual([]);
  });

  it("sanitizes bus names and maps english SPARQL hits", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      jsonResponse({
        results: {
          bindings: [
            {
              bus: { value: "https://www.wikidata.org/wiki/Q123" },
              busLabel: { value: "A2100" },
              noradId: { value: "25544" },
              generationLabel: { value: "Gen 2" },
              primeLabel: { value: "Lockheed Martin" },
              parent1Label: { value: "A2100 family" },
              parent2Label: { value: "Payload bus" },
              image: { value: "https://img.test/a2100.png" },
            },
          ],
        },
      }),
    );
    vi.stubGlobal("fetch", fetchMock);

    const fetcher = await loadFetcher(
      "bus-archetype",
      "../../../../../src/agent/ssa/sources/fetcher-bus-archetype",
    );
    const out = await fetcher({ busName: " \"A2100\"\u0000 " });

    const query = decodeURIComponent(
      new URL(String(fetchMock.mock.calls[0]?.[0])).searchParams.get("query") ??
        "",
    );
    expect(query).toContain('rdfs:label "A2100"@en.');
    expect(out).toEqual([
      expect.objectContaining({
        type: "wikidata_bus_archetype",
        source: "Wikidata SPARQL (Q191857 satellite bus)",
        url: "https://www.wikidata.org/wiki/Q123",
        data: {
          wikidataId: "Q123",
          name: "A2100",
          noradId: "25544",
          generation: "Gen 2",
          primeContractor: "Lockheed Martin",
          parent1: "A2100 family",
          parent2: "Payload bus",
          imageUrl: "https://img.test/a2100.png",
        },
      }),
    ]);
  });

  it("falls back to french when the english query misses and returns [] on fetch errors", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse({ results: { bindings: [] } }))
      .mockResolvedValueOnce(
        jsonResponse({
          results: {
            bindings: [
              {
                bus: { value: "https://www.wikidata.org/wiki/Q456" },
                busLabel: { value: "SpaceBus" },
              },
            ],
          },
        }),
      );
    vi.stubGlobal("fetch", fetchMock);

    const fetcher = await loadFetcher(
      "bus-archetype",
      "../../../../../src/agent/ssa/sources/fetcher-bus-archetype",
    );
    const out = await fetcher({ busArchetype: "SpaceBus" });

    const frQuery = decodeURIComponent(
      new URL(String(fetchMock.mock.calls[1]?.[0])).searchParams.get("query") ??
        "",
    );
    expect(frQuery).toContain('rdfs:label "SpaceBus"@fr.');
    expect(out).toHaveLength(1);

    fetchMock.mockRejectedValueOnce(new Error("wikidata down"));
    await expect(fetcher({ bus_name: "Broken" })).resolves.toEqual([]);
  });

  it("returns [] when both english and french SPARQL attempts miss", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse({}, 503))
      .mockResolvedValueOnce(jsonResponse({ results: { bindings: [] } }));
    vi.stubGlobal("fetch", fetchMock);

    const fetcher = await loadFetcher(
      "bus-archetype",
      "../../../../../src/agent/ssa/sources/fetcher-bus-archetype",
    );

    await expect(fetcher({ busName: "No hit" })).resolves.toEqual([]);
  });
});

describe("CelesTrak fetcher", () => {
  it("returns the orbital reference immediately when no lookup key is present", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    const fetcher = await loadFetcher(
      "celestrak",
      "../../../../../src/agent/ssa/sources/fetcher-celestrak",
    );
    const out = await fetcher({});

    expect(fetchMock).not.toHaveBeenCalled();
    expect(out).toEqual([
      expect.objectContaining({
        type: "orbit_model_reference",
        url: "https://celestrak.org/publications/AIAA/2006-6753/",
      }),
    ]);
  });

  it("appends catalog data for NORAD queries and forwards the auth token", async () => {
    process.env[celestrakTokenKey] = "celestrak-secret";
    const fetchMock = vi.fn().mockResolvedValue(
      jsonResponse([
        {
          OBJECT_NAME: "ISS (ZARYA)",
          NORAD_CAT_ID: 25544,
          EPOCH: "2026-04-21T00:00:00Z",
          MEAN_MOTION: 15.5,
          ECCENTRICITY: 0.0002,
          INCLINATION: 51.6,
        },
      ]),
    );
    vi.stubGlobal("fetch", fetchMock);

    const fetcher = await loadFetcher(
      "celestrak",
      "../../../../../src/agent/ssa/sources/fetcher-celestrak",
    );
    const out = await fetcher({ noradId: 25544 });

    expect(String(fetchMock.mock.calls[0]?.[0])).toContain("CATNR=25544");
    expect(String(fetchMock.mock.calls[0]?.[0])).toContain("FORMAT=JSON");
    expect(fetchMock.mock.calls[0]?.[1]).toEqual(
      expect.objectContaining({
        headers: expect.objectContaining({
          Authorization: "Token celestrak-secret",
          Accept: "application/json",
        }),
      }),
    );
    expect(out).toHaveLength(2);
    expect(out[1]).toMatchObject({
      type: "tle_catalog",
      source: "CelesTrak — 25544",
      data: [
        {
          objectName: "ISS (ZARYA)",
          noradId: 25544,
          epoch: "2026-04-21T00:00:00Z",
          meanMotion: 15.5,
          eccentricity: 0.0002,
          inclination: 51.6,
        },
      ],
    });
  });

  it("supports operator+launch queries and tolerates empty, non-ok, and failed upstream calls", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse([]))
      .mockResolvedValueOnce(jsonResponse({}, 503))
      .mockRejectedValueOnce(new Error("celestrak down"));
    vi.stubGlobal("fetch", fetchMock);

    const fetcher = await loadFetcher(
      "celestrak",
      "../../../../../src/agent/ssa/sources/fetcher-celestrak",
    );

    await expect(
      fetcher({ operatorCountry: "France", launchYear: 2024 }),
    ).resolves.toEqual([
      expect.objectContaining({ type: "orbit_model_reference" }),
    ]);
    expect(String(fetchMock.mock.calls[0]?.[0])).toContain("OPERATOR=France");
    expect(String(fetchMock.mock.calls[0]?.[0])).toContain("LAUNCH_YEAR=2024");
    expect(fetchMock.mock.calls[0]?.[1]).toEqual(
      expect.objectContaining({
        headers: expect.not.objectContaining({
          Authorization: expect.anything(),
        }),
      }),
    );

    await expect(
      fetcher({ operatorCountryName: "Japan", launchYear: 2025 }),
    ).resolves.toEqual([
      expect.objectContaining({ type: "orbit_model_reference" }),
    ]);

    await expect(fetcher({ noradId: 1 })).resolves.toEqual([
      expect.objectContaining({ type: "orbit_model_reference" }),
    ]);
  });

  it("uses the operator country label in the result source when no NORAD id is provided", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      jsonResponse([
        {
          OBJECT_NAME: "Demo payload",
          NORAD_CAT_ID: 99999,
          EPOCH: "2026-04-21T00:00:00Z",
          MEAN_MOTION: 12.5,
          ECCENTRICITY: 0.001,
          INCLINATION: 98.7,
        },
      ]),
    );
    vi.stubGlobal("fetch", fetchMock);

    const fetcher = await loadFetcher(
      "celestrak",
      "../../../../../src/agent/ssa/sources/fetcher-celestrak",
    );
    const out = await fetcher({ operatorCountryName: "Japan", launchYear: 2028 });

    expect(out[1]).toMatchObject({
      source: "CelesTrak — Japan 2028",
    });
  });
});

describe("launch-market fetcher", () => {
  it("returns [] when no launch-score token is configured", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    const fetcher = await loadFetcher(
      "launch-market",
      "../../../../../src/agent/ssa/sources/fetcher-launch-market",
    );
    const out = await fetcher({ satelliteName: "Starlink" });

    expect(fetchMock).not.toHaveBeenCalled();
    expect(out).toEqual([]);
  });

  it("maps launch-score rows, slices to five items, and supports fallback input keys", async () => {
    process.env[launchScoreTokenKey] = "launch-secret";
    const fetchMock = vi.fn().mockResolvedValue(
      jsonResponse({
        results: Array.from({ length: 6 }, (_, i) => ({
          satellite: `Sat-${i + 1}`,
          satellite_slug: `sat-${i + 1}`,
          operator_country: "France",
          launch_year: "2027",
          score: 75 + i,
          confidence_index: "high",
        })),
      }),
    );
    vi.stubGlobal("fetch", fetchMock);

    const fetcher = await loadFetcher(
      "launch-market",
      "../../../../../src/agent/ssa/sources/fetcher-launch-market",
    );
    const out = await fetcher({
      operatorCountryName: "France",
      launchYear: 2027,
    });

    expect(String(fetchMock.mock.calls[0]?.[0])).toContain("satellite=France");
    expect(String(fetchMock.mock.calls[0]?.[0])).toContain("launch_year=2027");
    expect(fetchMock.mock.calls[0]?.[1]).toEqual(
      expect.objectContaining({
        headers: expect.objectContaining({
          Authorization: "Token launch-secret",
          Accept: "application/json",
        }),
      }),
    );
    expect(out).toHaveLength(5);
    expect(out[0]).toMatchObject({
      type: "global_launch_score",
      source: "GlobalLaunchScore API — Sat-1 2027",
      url: "https://www.globallaunchscore.com/launch-score/sat-1/2027/",
      data: {
        satellite: "Sat-1",
        operatorCountry: "France",
        launchYear: "2027",
        score: 75,
        confidence: "high",
      },
    });
  });

  it("returns [] on missing satellites, non-ok responses, and rejected requests", async () => {
    process.env[launchScoreTokenKey] = "launch-secret";
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse({}, 503))
      .mockRejectedValueOnce(new Error("down"));
    vi.stubGlobal("fetch", fetchMock);

    const fetcher = await loadFetcher(
      "launch-market",
      "../../../../../src/agent/ssa/sources/fetcher-launch-market",
    );

    await expect(fetcher({ launchYear: 2029 })).resolves.toEqual([]);
    await expect(fetcher({ satelliteName: "Sat-X" })).resolves.toEqual([]);
    await expect(fetcher({ satelliteName: "Sat-Y" })).resolves.toEqual([]);
  });

  it("returns [] when the upstream answers with an empty result list", async () => {
    process.env[launchScoreTokenKey] = "launch-secret";
    const fetchMock = vi.fn().mockResolvedValue(
      jsonResponse({ results: [] }),
    );
    vi.stubGlobal("fetch", fetchMock);

    const fetcher = await loadFetcher(
      "launch-market",
      "../../../../../src/agent/ssa/sources/fetcher-launch-market",
    );

    await expect(fetcher({ satelliteName: "Empty" })).resolves.toEqual([]);
  });
});

describe("space-weather fetcher", () => {
  it("classifies annual solar activity envelopes across all threshold bands", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-06-15T00:00:00.000Z"));
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    const fetcher = await loadFetcher(
      "space-weather",
      "../../../../../src/agent/ssa/sources/fetcher-space-weather",
    );

    const cases = [
      { mean: 0, cls: "deep_min", year: 2025 },
      { mean: 90, cls: "low", year: 2024 },
      { mean: 140, cls: "moderate", year: 2023 },
      { mean: 180, cls: "high", year: 2022 },
      { mean: 220, cls: "very_high", year: 2021 },
    ];

    for (const [index, c] of cases.entries()) {
      fetchMock.mockResolvedValueOnce(
        jsonResponse({
          daily: {
            f107_flux: c.mean === 0 ? [] : [c.mean, c.mean],
            kp_index: index === 0 ? [] : [2.1, 3.9],
            radiation_belt_flux: index === 0 ? [] : [15, 42],
            total_electron_content: index === 0 ? [] : [9, 11],
          },
        }),
      );

      const out = await fetcher({
        latitude: 48.8,
        longitude: 2.3,
        ...(index === 0 ? {} : { year: c.year }),
      });

      expect(out[0]).toMatchObject({
        type: "space_weather_indices",
        data: expect.objectContaining({
          year: c.year,
          solarActivityClass: c.cls,
        }),
      });
    }

    expect(String(fetchMock.mock.calls[0]?.[0])).toContain("start_date=2025-01-01");
  });

  it("returns [] when coordinates are missing or the upstream throws", async () => {
    const fetchMock = vi.fn().mockRejectedValue(new Error("swpc down"));
    vi.stubGlobal("fetch", fetchMock);

    const fetcher = await loadFetcher(
      "space-weather",
      "../../../../../src/agent/ssa/sources/fetcher-space-weather",
    );

    await expect(fetcher({ latitude: 1 })).resolves.toEqual([]);
    await expect(fetcher({ latitude: 1, longitude: 2, year: 2024 })).resolves.toEqual([]);
  });

  it("returns [] when the NOAA endpoint answers with a non-ok status", async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse({}, 503));
    vi.stubGlobal("fetch", fetchMock);

    const fetcher = await loadFetcher(
      "space-weather",
      "../../../../../src/agent/ssa/sources/fetcher-space-weather",
    );

    await expect(
      fetcher({ latitude: 1, longitude: 2, year: 2024 }),
    ).resolves.toEqual([]);
  });
});

describe("orbit-regime fetcher", () => {
  it("returns debris-density and altitude samples when both upstreams succeed", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        jsonResponse({
          features: [
            {
              properties: {
                CLASS: "dense",
                DESCR: "Crowded shell",
                EPOCH: "2026-04-01",
              },
            },
          ],
        }),
      )
      .mockResolvedValueOnce(
        jsonResponse({
          elevations: [{ z: 1234 }],
        }),
      );
    vi.stubGlobal("fetch", fetchMock);

    const fetcher = await loadFetcher(
      "orbit-regime",
      "../../../../../src/agent/ssa/sources/fetcher-orbit-regime",
    );
    const out = await fetcher({ latitude: 48.8566, longitude: 2.3522 });

    expect(String(fetchMock.mock.calls[0]?.[0])).toContain("BBOX=48.8466,2.3422,48.8666,2.362");
    expect(fetchMock.mock.calls[1]?.[1]).toEqual(
      expect.objectContaining({
        method: "POST",
        body: JSON.stringify({ lon: "2.3522", lat: "48.8566" }),
      }),
    );
    expect(out).toEqual([
      expect.objectContaining({
        type: "debris_density",
        data: {
          debrisClass: "dense",
          description: "Crowded shell",
          epoch: "2026-04-01",
        },
      }),
      expect.objectContaining({
        type: "ground_track_elevation",
        data: { elevationM: 1234 },
      }),
    ]);
  });

  it("returns [] when coordinates are missing or both upstreams fail", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse({}, 500))
      .mockRejectedValueOnce(new Error("alt down"));
    vi.stubGlobal("fetch", fetchMock);

    const fetcher = await loadFetcher(
      "orbit-regime",
      "../../../../../src/agent/ssa/sources/fetcher-orbit-regime",
    );

    await expect(fetcher({ longitude: 2.3 })).resolves.toEqual([]);
    await expect(fetcher({ latitude: 48.8, longitude: 2.3 })).resolves.toEqual([]);
  });

  it("handles missing debris features, missing property fields, and empty altitude payloads", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse({ features: [] }))
      .mockResolvedValueOnce(jsonResponse({ elevations: [{ z: null }] }))
      .mockResolvedValueOnce(
        jsonResponse({
          features: [{ properties: {} }],
        }),
      )
      .mockResolvedValueOnce(jsonResponse({}, 500));
    vi.stubGlobal("fetch", fetchMock);

    const fetcher = await loadFetcher(
      "orbit-regime",
      "../../../../../src/agent/ssa/sources/fetcher-orbit-regime",
    );

    await expect(
      fetcher({ latitude: 10, longitude: 20 }),
    ).resolves.toEqual([]);

    await expect(
      fetcher({ latitude: 11, longitude: 21 }),
    ).resolves.toEqual([
      expect.objectContaining({
        type: "debris_density",
        data: {
          debrisClass: "unknown",
          description: "",
          epoch: "",
        },
      }),
    ]);
  });

  it("keeps the altitude sample when the debris lookup throws", async () => {
    const fetchMock = vi
      .fn()
      .mockRejectedValueOnce(new Error("debris down"))
      .mockResolvedValueOnce(
        jsonResponse({
          elevations: [{ z: 456 }],
        }),
      );
    vi.stubGlobal("fetch", fetchMock);

    const fetcher = await loadFetcher(
      "orbit-regime",
      "../../../../../src/agent/ssa/sources/fetcher-orbit-regime",
    );

    await expect(
      fetcher({ latitude: 12.3, longitude: 45.6 }),
    ).resolves.toEqual([
      expect.objectContaining({
        type: "ground_track_elevation",
        data: { elevationM: 456 },
      }),
    ]);
  });
});

describe("regulation fetcher", () => {
  it("combines ITU, FAA, and ECC results and slices the external payloads", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        jsonResponse({
          results: [{ id: 1 }, { id: 2 }, { id: 3 }, { id: 4 }],
        }),
      )
      .mockResolvedValueOnce(jsonResponse(Array.from({ length: 12 }, (_, i) => ({ permit: i + 1 }))))
      .mockResolvedValueOnce(jsonResponse(Array.from({ length: 11 }, (_, i) => ({ decision: i + 1 }))));
    vi.stubGlobal("fetch", fetchMock);

    const fetcher = await loadFetcher(
      "regulation",
      "../../../../../src/agent/ssa/sources/fetcher-regulation",
    );
    const out = await fetcher({ operatorCountryName: "France" });

    expect(String(fetchMock.mock.calls[0]?.[0])).toContain(
      'search(notifying_administration,"France")',
    );
    expect(out).toEqual([
      expect.objectContaining({
        type: "itu_filing",
        data: [{ id: 1 }, { id: 2 }, { id: 3 }],
      }),
      expect.objectContaining({
        type: "faa_launch_permits",
        data: { permits: Array.from({ length: 10 }, (_, i) => ({ permit: i + 1 })) },
      }),
      expect.objectContaining({
        type: "ecc_registration",
        data: { decisions: Array.from({ length: 10 }, (_, i) => ({ decision: i + 1 })) },
      }),
    ]);
  });

  it("returns [] when country-specific ITU lookup is skipped and the shared upstreams fail", async () => {
    const fetchMock = vi
      .fn()
      .mockRejectedValueOnce(new Error("faa down"))
      .mockRejectedValueOnce(new Error("ecc down"));
    vi.stubGlobal("fetch", fetchMock);

    const fetcher = await loadFetcher(
      "regulation",
      "../../../../../src/agent/ssa/sources/fetcher-regulation",
    );
    const out = await fetcher({});

    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(out).toEqual([]);
  });

  it("returns [] when ITU has no data and the FAA/ECC endpoints answer non-ok", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse({ results: [] }))
      .mockResolvedValueOnce(jsonResponse({}, 503))
      .mockResolvedValueOnce(jsonResponse({}, 503));
    vi.stubGlobal("fetch", fetchMock);

    const fetcher = await loadFetcher(
      "regulation",
      "../../../../../src/agent/ssa/sources/fetcher-regulation",
    );

    await expect(fetcher({ operatorCountry: "France" })).resolves.toEqual([]);
  });

  it("drops ITU results when the ITU lookup is non-ok or throws while keeping FAA and ECC data", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse({}, 503))
      .mockResolvedValueOnce(jsonResponse([{ permit: 1 }]))
      .mockResolvedValueOnce(jsonResponse([{ decision: 1 }]))
      .mockRejectedValueOnce(new Error("itu down"))
      .mockResolvedValueOnce(jsonResponse([{ permit: 2 }]))
      .mockResolvedValueOnce(jsonResponse([{ decision: 2 }]));
    vi.stubGlobal("fetch", fetchMock);

    const fetcher = await loadFetcher(
      "regulation",
      "../../../../../src/agent/ssa/sources/fetcher-regulation",
    );

    await expect(fetcher({ operatorCountry: "France" })).resolves.toEqual([
      expect.objectContaining({
        type: "faa_launch_permits",
        data: { permits: [{ permit: 1 }] },
      }),
      expect.objectContaining({
        type: "ecc_registration",
        data: { decisions: [{ decision: 1 }] },
      }),
    ]);

    await expect(fetcher({ operatorCountryName: "Japan" })).resolves.toEqual([
      expect.objectContaining({
        type: "faa_launch_permits",
        data: { permits: [{ permit: 2 }] },
      }),
      expect.objectContaining({
        type: "ecc_registration",
        data: { decisions: [{ decision: 2 }] },
      }),
    ]);
  });
});

describe("spectra fetcher", () => {
  it("returns [] when no payload name is supplied", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    const fetcher = await loadFetcher(
      "spectra",
      "../../../../../src/agent/ssa/sources/fetcher-spectra",
    );
    const out = await fetcher({});

    expect(fetchMock).not.toHaveBeenCalled();
    expect(out).toEqual([]);
  });

  it("maps ITU assignments and optical spectra with the demo API key fallback", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        jsonResponse({
          assignments: [
            {
              assignmentId: 88,
              description: "Ka-band downlink",
              frequencyBands: [
                { bandName: "Ignore", centerMhz: 0, bandwidthMhz: "0" },
                { bandName: "Ka", centerMhz: 20500, bandwidthMhz: "500" },
              ],
            },
          ],
        }),
      )
      .mockResolvedValueOnce(jsonResponse({ spectrum: [{ label: "VIS" }] }))
      .mockResolvedValueOnce(jsonResponse({ spectrum: [{ label: "NIR" }] }));
    vi.stubGlobal("fetch", fetchMock);

    const fetcher = await loadFetcher(
      "spectra",
      "../../../../../src/agent/ssa/sources/fetcher-spectra",
    );
    const out = await fetcher({ payloadKind: "SAR" });

    expect(String(fetchMock.mock.calls[0]?.[0])).toContain("api_key=DEMO_KEY");
    expect(String(fetchMock.mock.calls[0]?.[0])).toContain("query=SAR%20payload");
    expect(out).toEqual([
      expect.objectContaining({
        type: "itu_srs_assignment",
        data: {
          description: "Ka-band downlink",
          assignmentId: 88,
          bands: [{ name: "Ka", centerMhz: 20500, bandwidthMhz: "500" }],
        },
      }),
      expect.objectContaining({
        type: "optical_spectrum",
        source: "NASA SSD — band visible",
        data: { label: "VIS" },
      }),
      expect.objectContaining({
        type: "optical_spectrum",
        source: "NASA SSD — band near-infrared",
        data: { label: "NIR" },
      }),
    ]);
  });

  it("keeps only successful subresults and honors a configured ITU API key", async () => {
    process.env[ituApiKeyKey] = "itu-secret";
    const fetchMock = vi
      .fn()
      .mockRejectedValueOnce(new Error("itu down"))
      .mockResolvedValueOnce(jsonResponse({ spectrum: [{ label: "VIS" }] }))
      .mockRejectedValueOnce(new Error("nir down"));
    vi.stubGlobal("fetch", fetchMock);

    const fetcher = await loadFetcher(
      "spectra",
      "../../../../../src/agent/ssa/sources/fetcher-spectra",
    );
    const out = await fetcher({ payload_name: "Optical imager" });

    expect(String(fetchMock.mock.calls[0]?.[0])).toContain("api_key=itu-secret");
    expect(out).toEqual([
      expect.objectContaining({
        type: "optical_spectrum",
        source: "NASA SSD — band visible",
      }),
    ]);
  });

  it("returns [] for non-ok and empty-spectrum upstream responses", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse({}, 503))
      .mockResolvedValueOnce(jsonResponse({}, 503))
      .mockResolvedValueOnce(jsonResponse({ spectrum: [] }))
      .mockResolvedValueOnce(jsonResponse({ assignments: [] }))
      .mockResolvedValueOnce(jsonResponse({ spectrum: [{ label: "VIS" }] }))
      .mockResolvedValueOnce(jsonResponse({ spectrum: [{ label: "NIR" }] }));
    vi.stubGlobal("fetch", fetchMock);

    const fetcher = await loadFetcher(
      "spectra",
      "../../../../../src/agent/ssa/sources/fetcher-spectra",
    );

    await expect(fetcher({ payloadName: "Payload A" })).resolves.toEqual([]);
    await expect(fetcher({ payloadName: "Payload B" })).resolves.toEqual([
      expect.objectContaining({
        type: "optical_spectrum",
        source: "NASA SSD — band visible",
      }),
      expect.objectContaining({
        type: "optical_spectrum",
        source: "NASA SSD — band near-infrared",
      }),
    ]);
  });
});
