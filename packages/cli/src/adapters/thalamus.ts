export interface ThalamusService {
  runCycle(q: { query: string; cycleId: string }): Promise<{ findings: unknown[]; costUsd: number }>;
}

export async function runCycleAdapter(
  svc: ThalamusService,
  q: { query: string; cycleId: string },
): Promise<{ findings: unknown[]; costUsd: number }> {
  return svc.runCycle(q);
}
