/**
 * Thin typed wrapper around fetch() for /api/config/runtime/*.
 *
 * Stateless — tests compose calls themselves. `resetAllConfig` is the only
 * helper that iterates, and it's meant for `afterEach` isolation since the
 * e2e harness runs `singleFork: true` (shared Redis state across specs).
 */
import { RUNTIME_CONFIG_DOMAINS } from "@interview/shared/config";

const BASE = process.env.CONSOLE_API_URL ?? "http://localhost:4000";

type DomainEntry = {
  value: Record<string, unknown>;
  defaults: Record<string, unknown>;
  schema: Record<string, unknown>;
  hasOverrides: boolean;
};

/** GET /api/config/runtime — list every registered domain with shape. */
export async function getAllConfig(): Promise<{
  domains: Record<string, DomainEntry>;
}> {
  const res = await fetch(`${BASE}/api/config/runtime`);
  return (await res.json()) as { domains: Record<string, DomainEntry> };
}

/** GET /api/config/runtime/:domain — single domain with value + metadata. */
export async function getConfig(domain: string): Promise<
  { domain: string } & DomainEntry
> {
  const res = await fetch(`${BASE}/api/config/runtime/${domain}`);
  return (await res.json()) as { domain: string } & DomainEntry;
}

/** PATCH /api/config/runtime/:domain — returns raw Response for status checks. */
export async function patchConfig(
  domain: string,
  patch: Record<string, unknown>,
): Promise<Response> {
  return fetch(`${BASE}/api/config/runtime/${domain}`, {
    method: "PATCH",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(patch),
  });
}

/** DELETE /api/config/runtime/:domain — returns raw Response. */
export async function resetConfig(domain: string): Promise<Response> {
  return fetch(`${BASE}/api/config/runtime/${domain}`, { method: "DELETE" });
}

/** DELETE every registered domain. Safe in afterEach; ignores 404s. */
export async function resetAllConfig(): Promise<void> {
  const { domains } = await getAllConfig().catch(() => ({
    domains: Object.fromEntries(
      RUNTIME_CONFIG_DOMAINS.map((d) => [d, null]),
    ) as Record<string, unknown>,
  }));
  await Promise.all(
    Object.keys(domains).map(async (d) => {
      const res = await resetConfig(d);
      if (!res.ok && res.status !== 404) {
        throw new Error(`resetAllConfig: ${d} returned ${res.status}`);
      }
    }),
  );
}
