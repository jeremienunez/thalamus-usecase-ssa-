export const TELEMETRY_SCALAR_KEYS = [
  "powerDraw",
  "thermalMargin",
  "pointingAccuracy",
  "attitudeRate",
  "linkBudget",
  "dataRate",
  "payloadDuty",
  "eclipseRatio",
] as const;

export type TelemetryScalarKey = (typeof TELEMETRY_SCALAR_KEYS)[number];

export const TELEMETRY_SCALAR_COLUMN: Record<TelemetryScalarKey, string> = {
  powerDraw: "power_draw",
  thermalMargin: "thermal_margin",
  pointingAccuracy: "pointing_accuracy",
  attitudeRate: "attitude_rate",
  linkBudget: "link_budget",
  dataRate: "data_rate",
  payloadDuty: "payload_duty",
  eclipseRatio: "eclipse_ratio",
};
