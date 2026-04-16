/**
 * pcEstimator CLI adapter — thin pass-through to the Pc-estimator swarm.
 *
 * At boot, this adapter is stubbed (no live swarm). The web demo uses the
 * fixture-backed version in apps/console-api/src/repl.ts.
 */

export interface PcEstimatorService {
  estimate(q: { conjunctionId: string }): Promise<{ estimate: unknown }>;
}

export async function estimatePcAdapter(
  svc: PcEstimatorService,
  q: { conjunctionId: string },
): Promise<{ estimate: unknown }> {
  return svc.estimate({ conjunctionId: q.conjunctionId });
}
