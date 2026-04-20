/**
 * Thin fetch wrapper for `POST /api/cycles/run`.
 *
 * The CLI consumes the console-api HTTP contract instead of building a
 * ThalamusContainer in-process (CLAUDE.md §3.1 "no private bypass"). This
 * keeps the kernel/app boundary strict: one contract, one transport.
 *
 * The server returns `{ cycle: { findings, costUsd, ... } }`; this client
 * projects the adapter's expected `{ findings, costUsd }` shape out of it.
 */

export interface ThalamusHttpFinding {
  id: string;
  summary: string;
  title: string;
  sourceClass: string;
  confidence: number;
  evidenceRefs: string[];
}

export interface ThalamusHttpRunCycleInput {
  query: string;
  /** Correlation id for the calling turn (forwarded as trace context). */
  traceId?: string;
}

export interface ThalamusHttpRunCycleResult {
  findings: ThalamusHttpFinding[];
  costUsd: number;
}

type CyclesRunResponseBody = {
  cycle: {
    id: string;
    kind: "thalamus" | "fish" | "both";
    startedAt: string;
    completedAt: string;
    findingsEmitted: number;
    cortices: string[];
    findings?: ThalamusHttpFinding[];
    costUsd?: number;
    error?: string;
  };
};

export class ThalamusHttpClient {
  constructor(
    private readonly baseUrl: string,
    private readonly auth?: string,
  ) {}

  async runCycle(
    input: ThalamusHttpRunCycleInput,
  ): Promise<ThalamusHttpRunCycleResult> {
    const headers: Record<string, string> = {
      "content-type": "application/json",
    };
    if (this.auth) headers.authorization = `Bearer ${this.auth}`;
    if (input.traceId) headers["x-trace-id"] = input.traceId;

    const res = await fetch(`${this.baseUrl}/api/cycles/run`, {
      method: "POST",
      headers,
      body: JSON.stringify({ kind: "thalamus", query: input.query }),
    });

    const raw = (await res.json().catch((): null => null)) as
      | (CyclesRunResponseBody & { error?: string })
      | null;

    if (!res.ok) {
      const msg =
        raw && typeof raw === "object" && "error" in raw && raw.error
          ? String(raw.error)
          : `status=${res.status}`;
      throw new Error(`thalamus/runCycle failed: ${msg}`);
    }
    if (!raw || !("cycle" in raw) || !raw.cycle) {
      throw new Error(
        `thalamus/runCycle: malformed response (no cycle field)`,
      );
    }
    if (raw.cycle.error) {
      throw new Error(`thalamus/runCycle: ${raw.cycle.error}`);
    }
    return {
      findings: raw.cycle.findings ?? [],
      costUsd: raw.cycle.costUsd ?? 0,
    };
  }
}
