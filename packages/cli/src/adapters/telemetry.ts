export interface TelemetrySwarmService {
  start(q: { satelliteId: string }): Promise<{ distribution: unknown }>;
}

export async function startTelemetryAdapter(
  svc: TelemetrySwarmService,
  q: { satId: string },
): Promise<{ distribution: unknown }> {
  return svc.start({ satelliteId: q.satId });
}
