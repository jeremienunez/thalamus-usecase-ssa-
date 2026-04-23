import type {
  ConjunctionDto,
  FindingDto,
  PayloadDto,
  SatelliteDto,
  TelemetryDto,
} from "@/dto/http";

export function telemetryFixture(
  overrides: Partial<TelemetryDto> = {},
): TelemetryDto {
  return {
    powerDraw: 1200,
    thermalMargin: 4.2,
    pointingAccuracy: 0.012,
    attitudeRate: 0.34,
    linkBudget: 18.5,
    dataRate: 220,
    payloadDuty: 0.72,
    eclipseRatio: 0.35,
    solarArrayHealth: 0.88,
    batteryDepthOfDischarge: 0.21,
    propellantRemaining: 0.63,
    radiationDose: 1.2,
    debrisProximity: 0.08,
    missionAge: 6.4,
    ...overrides,
  };
}

export function satelliteFixture(
  overrides: Partial<SatelliteDto> = {},
): SatelliteDto {
  return {
    id: 100,
    name: "ISS",
    noradId: 25544,
    regime: "LEO",
    operator: "NASA",
    country: "US",
    inclinationDeg: 51.6,
    semiMajorAxisKm: 6791,
    eccentricity: 0.0003,
    raanDeg: 42.2,
    argPerigeeDeg: 91.7,
    meanAnomalyDeg: 12.8,
    meanMotionRevPerDay: 15.49,
    epoch: "2026-04-22T00:00:00.000Z",
    massKg: 420000,
    classificationTier: "unclassified",
    opacityScore: 0.82,
    tleLine1: "1 25544U 98067A   26113.50000000  .00001264  00000+0  29669-4 0  9995",
    tleLine2: "2 25544  51.6434  42.2123 0003050  91.7000  12.8000 15.49000000 00001",
    launchYear: 1998,
    objectClass: "payload",
    photoUrl: "https://example.test/iss.jpg",
    shortDescription: "Crewed orbital laboratory.",
    description: "Crewed orbital laboratory.",
    platformClass: "science",
    busName: "Zarya",
    busGeneration: "Block I",
    telemetry: telemetryFixture(),
    lastTleIngestedAt: "2026-04-22T11:00:00.000Z",
    meanMotionDrift: 0.0004,
    opacityDeficitReasons: ["operator mass unpublished"],
    ...overrides,
  };
}

export function conjunctionFixture(
  overrides: Partial<ConjunctionDto> = {},
): ConjunctionDto {
  return {
    id: 7,
    primaryId: 100,
    secondaryId: 200,
    primaryName: "ISS",
    secondaryName: "STARLINK-1000",
    regime: "LEO",
    epoch: "2026-04-22T00:00:00.000Z",
    minRangeKm: 18.89,
    relativeVelocityKmps: 1.27,
    probabilityOfCollision: 1e-5,
    combinedSigmaKm: 0.36,
    hardBodyRadiusM: 15,
    pcMethod: "foster-gaussian",
    computedAt: "2026-04-22T00:00:00.000Z",
    covarianceQuality: "MED",
    action: "monitor",
    ...overrides,
  };
}

export function findingFixture(
  overrides: Partial<FindingDto> = {},
): FindingDto {
  return {
    id: "f:12",
    title: "Highest priority finding",
    summary: "Summary",
    cortex: "strategist",
    status: "accepted",
    priority: 90,
    createdAt: "2026-04-22T00:00:00.000Z",
    linkedEntityIds: [],
    evidence: [],
    ...overrides,
  };
}

export function payloadFixture(
  overrides: Partial<PayloadDto> = {},
): PayloadDto {
  return {
    id: 1,
    name: "Camera",
    slug: "camera",
    role: "imaging",
    massKg: 12,
    powerW: 34,
    photoUrl: null,
    ...overrides,
  };
}
