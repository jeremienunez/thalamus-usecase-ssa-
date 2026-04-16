/**
 * Back-compat shim — the SSRF-safe fetch now lives in @interview/shared/net
 * so sweep and db-schema seed scripts can consume the same entrypoint.
 *
 * Prefer importing from "@interview/shared" directly in new code.
 */

export {
  safeFetch,
  validateExternalUrl,
  validateDns,
  DEFAULT_TIMEOUT_MS,
} from "@interview/shared";
export type { SafeFetchOptions } from "@interview/shared";
