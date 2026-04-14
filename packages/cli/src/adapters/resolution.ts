export interface SweepResolutionService {
  resolve(args: {
    suggestionId: string;
    actorId: string;
    source: string;
  }): Promise<{ ok: boolean; delta: unknown }>;
}

export async function acceptAdapter(
  svc: SweepResolutionService,
  q: { suggestionId: string },
): Promise<{ ok: boolean; delta: unknown }> {
  return svc.resolve({
    suggestionId: q.suggestionId,
    actorId: "cli:local",
    source: "cli",
  });
}
