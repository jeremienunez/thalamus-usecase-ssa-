import {
  pgTable,
  bigserial,
  bigint,
  text,
  timestamp,
  integer,
  real,
  jsonb,
  boolean,
} from "drizzle-orm/pg-core";

/**
 * SSA (Space Situational Awareness) schema.
 *
 * Scope note — where abstraction stops, where the domain begins:
 *   - The orchestrator, cortex pattern, nano-swarm and guardrails are
 *     deliberately generic. They talk about "entities", "findings",
 *     "sources", "edges".
 *   - This file is the first place where the generic machinery meets
 *     the domain. Table and column names reflect the objects we are
 *     actually reasoning about: satellites, payloads, operators,
 *     launches, orbital regimes.
 *   - Downstream layers (repositories, services, cortex skills) must
 *     pick up these names as-is. No "entity" aliasing once we cross
 *     this boundary.
 */

// -----------------------------------------------------------------------
// GeoJSON types — minimal local definitions (swap for @types/geojson later)
// -----------------------------------------------------------------------

type GeoJsonPosition = number[];
interface GeoJsonPoint {
  type: "Point";
  coordinates: GeoJsonPosition;
}
interface GeoJsonPolygon {
  type: "Polygon";
  coordinates: GeoJsonPosition[][];
}
type GeoJsonGeometry =
  | GeoJsonPoint
  | GeoJsonPolygon
  | { type: string; coordinates: unknown };

// -----------------------------------------------------------------------
// Reference tables
// -----------------------------------------------------------------------

/** Orbital regime — LEO, MEO, GEO, SSO, HEO, GTO, etc. */
export const orbitRegime = pgTable("orbit_regime", {
  id: bigserial("id", { mode: "bigint" }).primaryKey(),
  name: text("name").notNull(),
  // Notional apogee / perigee bands are kept as free-form for now;
  // the ingestion cortex derives them from TLE mean motion.
  altitudeBand: text("altitude_band"),
});

/** Platform class — comms, EO, navigation, SIGINT, science, military. */
export const platformClass = pgTable("platform_class", {
  id: bigserial("id", { mode: "bigint" }).primaryKey(),
  name: text("name").notNull(),
});

/**
 * Operator country / agency — NASA, ESA, CNES, ROSCOSMOS, JAXA, DGA, …
 * `doctrine` carries licence-to-operate and sharing policy as JSON
 * (ITU filings, export-control regime, data-sharing agreements).
 */
export const operatorCountry = pgTable("operator_country", {
  id: bigserial("id", { mode: "bigint" }).primaryKey(),
  name: text("name").notNull(),
  slug: text("slug").notNull(),
  orbitRegimeId: bigint("orbit_regime_id", { mode: "bigint" }).references(
    () => orbitRegime.id,
  ),
  doctrine: jsonb("doctrine"),
  bounds: jsonb("bounds").$type<GeoJsonPolygon | Record<string, unknown> | null>(),
  centroid: jsonb("centroid").$type<GeoJsonPoint | Record<string, unknown> | null>(),
  geometry: jsonb("geometry").$type<GeoJsonGeometry | Record<string, unknown> | null>(),
});

/** Payload — instrument or transponder flown aboard a satellite. */
export const payload = pgTable("payload", {
  id: bigserial("id", { mode: "bigint" }).primaryKey(),
  name: text("name").notNull(),
  slug: text("slug").notNull(),
  technicalProfile: jsonb("technical_profile"),
  photoUrl: text("photo_url"),
});

/** Operator — org running the mission (SpaceX, Airbus DS, Thales Alenia Space, NASA, …). */
export const operator = pgTable("operator", {
  id: bigserial("id", { mode: "bigint" }).primaryKey(),
  name: text("name").notNull(),
  slug: text("slug").notNull(),
  latitude: real("latitude"),
  longitude: real("longitude"),
  groundStation: text("ground_station"),
});

// -----------------------------------------------------------------------
// Core entity: Satellite
// -----------------------------------------------------------------------

/**
 * Satellite — the primary entity produced by Thalamus and audited by Sweep.
 * `launchYear` anchors the asset to a launch epoch; `telemetrySummary` is a
 * compact signal fingerprint consumed by the correlation cortex.
 */
export const satellite = pgTable("satellite", {
  id: bigserial("id", { mode: "bigint" }).primaryKey(),
  name: text("name").notNull(),
  slug: text("slug").notNull(),
  launchYear: integer("launch_year"),
  operatorCountryId: bigint("operator_country_id", {
    mode: "bigint",
  }).references(() => operatorCountry.id),
  platformClassId: bigint("platform_class_id", { mode: "bigint" }).references(
    () => platformClass.id,
  ),
  operatorId: bigint("operator_id", { mode: "bigint" }).references(
    () => operator.id,
  ),
  satelliteBusId: bigint("satellite_bus_id", { mode: "bigint" }).references(
    (): any => satelliteBus.id,
  ),
  massKg: real("mass_kg"),
  isExperimental: boolean("is_experimental"),
  rating: real("rating"),
  photoUrl: text("photo_url"),
  temperature: real("temperature"),
  lifetime: real("lifetime"),
  power: real("power"),
  variant: text("variant"),
  isResilient: boolean("is_resilient"),
  classificationTier: text("classification_tier"),
  kMultiplier: real("k_multiplier"),
  descriptions: jsonb("descriptions"),
  gShortDescription: text("g_short_description"),
  gDescription: text("g_description"),
  gOperatorDescription: text("g_operator_description"),
  gOperatorCountryDescription: text("g_operator_country_description"),
  gOrbitRegimeDescription: text("g_orbit_regime_description"),
  gLaunchYearDescription: text("g_launch_year_description"),
  profileMetadata: jsonb("profile_metadata"),
  // Telemetry 14D
  powerDraw: real("power_draw"),
  thermalMargin: real("thermal_margin"),
  pointingAccuracy: real("pointing_accuracy"),
  attitudeRate: real("attitude_rate"),
  linkBudget: real("link_budget"),
  dataRate: real("data_rate"),
  payloadDuty: real("payload_duty"),
  eclipseRatio: real("eclipse_ratio"),
  solarArrayHealth: real("solar_array_health"),
  batteryDepthOfDischarge: real("battery_depth_of_discharge"),
  propellantRemaining: real("propellant_remaining"),
  radiationDose: real("radiation_dose"),
  debrisProximity: real("debris_proximity"),
  missionAge: real("mission_age"),
  telemetrySummary: jsonb("telemetry_summary"),
  metadata: jsonb("metadata"),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
});

// -----------------------------------------------------------------------
// Many-to-many: payloads aboard a satellite
// -----------------------------------------------------------------------

/**
 * Which payloads fly on which satellite, with mass / power budget per payload.
 * Join is typed: every row locks `satellite.id` to `payload.id` at the schema level.
 */
export const satellitePayload = pgTable("satellite_payload", {
  satelliteId: bigint("satellite_id", { mode: "bigint" })
    .notNull()
    .references(() => satellite.id),
  payloadId: bigint("payload_id", { mode: "bigint" })
    .notNull()
    .references(() => payload.id),
  role: text("role"),
  massKg: real("mass_kg"),
  powerW: real("power_w"),
});

// -----------------------------------------------------------------------
// Reference catalog: satellite bus archetypes (Starlink v2, A2100, SpaceBus, LEOStar)
// -----------------------------------------------------------------------

export const satelliteBus = pgTable("satellite_bus", {
  id: bigserial("id", { mode: "bigint" }).primaryKey(),
  name: text("name").notNull(),
  platformClass: text("platform_class"),
  generation: text("generation"),
  payloads: jsonb("payloads"),
  telemetrySummary: jsonb("telemetry_summary"),
  // Telemetry 14D (mirrors satellite for bus-level averages)
  powerDraw: real("power_draw"),
  thermalMargin: real("thermal_margin"),
  pointingAccuracy: real("pointing_accuracy"),
  attitudeRate: real("attitude_rate"),
  linkBudget: real("link_budget"),
  dataRate: real("data_rate"),
  payloadDuty: real("payload_duty"),
  eclipseRatio: real("eclipse_ratio"),
  solarArrayHealth: real("solar_array_health"),
  batteryDepthOfDischarge: real("battery_depth_of_discharge"),
  propellantRemaining: real("propellant_remaining"),
  radiationDose: real("radiation_dose"),
  debrisProximity: real("debris_proximity"),
  missionAge: real("mission_age"),
});

// -----------------------------------------------------------------------
// Inferred types — one source of truth for entity shapes across packages.
// -----------------------------------------------------------------------

export type Satellite = typeof satellite.$inferSelect;
export type NewSatellite = typeof satellite.$inferInsert;
export type OperatorCountry = typeof operatorCountry.$inferSelect;
export type Payload = typeof payload.$inferSelect;
export type PlatformClass = typeof platformClass.$inferSelect;
export type OrbitRegime = typeof orbitRegime.$inferSelect;
export type Operator = typeof operator.$inferSelect;
export type SatellitePayload = typeof satellitePayload.$inferSelect;
export type SatelliteBus = typeof satelliteBus.$inferSelect;
