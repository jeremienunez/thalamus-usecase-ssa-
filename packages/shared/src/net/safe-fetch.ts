/**
 * SSRF-safe fetch — validates URLs before fetching to prevent
 * Server-Side Request Forgery targeting internal networks.
 *
 * Rejects: private IPs, loopback, link-local, cloud-metadata endpoints,
 * non-http(s) schemes, known internal hostnames, and DNS rebinding.
 * Follows redirects manually to validate each hop.
 *
 * Shared across the monorepo (sweep, thalamus, db-schema) so every outbound
 * fetch can funnel through one validated entrypoint.
 */

import { lookup } from "node:dns/promises";

const PRIVATE_IP_RANGES = [
  /^127\./, // loopback
  /^10\./, // class A private
  /^172\.(1[6-9]|2\d|3[01])\./, // class B private
  /^192\.168\./, // class C private
  /^169\.254\./, // link-local
  /^0\./, // current network
  /^100\.(6[4-9]|[7-9]\d|1[0-2]\d)\./, // carrier-grade NAT
];

const BLOCKED_HOSTNAMES = new Set([
  "localhost",
  "localhost.localdomain",
  "metadata.google.internal",
  "metadata",
  "instance-data",
]);

/** Default outbound timeout. Applies when caller does not pass an AbortSignal. */
export const DEFAULT_TIMEOUT_MS = 10_000;

function isPrivateIp(ip: string): boolean {
  for (const range of PRIVATE_IP_RANGES) {
    if (range.test(ip)) return true;
  }
  if (ip === "::1" || ip.startsWith("fc") || ip.startsWith("fd")) return true;
  if (ip === "169.254.169.254") return true;
  return false;
}

/**
 * Resolve hostname to IP and verify it doesn't point to internal network.
 * Catches DNS rebinding attacks where a domain resolves to a private IP.
 */
export async function validateDns(hostname: string): Promise<void> {
  if (/^\d+\.\d+\.\d+\.\d+$/.test(hostname) || hostname.startsWith("[")) {
    return;
  }
  try {
    const { address } = await lookup(hostname);
    if (isPrivateIp(address)) {
      throw new Error(`SSRF guard: DNS resolved to private IP`);
    }
  } catch (err) {
    if (err instanceof Error && err.message.startsWith("SSRF guard:"))
      throw err;
    // DNS resolution failure — let fetch handle it
  }
}

/**
 * Validate a URL is safe to fetch (no SSRF).
 * Returns the validated URL string, or throws on rejection.
 */
export function validateExternalUrl(urlInput: string): string {
  let parsed: URL;
  try {
    parsed = new URL(urlInput);
  } catch {
    throw new Error(`SSRF guard: invalid URL`);
  }

  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    throw new Error(`SSRF guard: blocked scheme ${parsed.protocol}`);
  }

  const hostname = parsed.hostname.toLowerCase();
  if (BLOCKED_HOSTNAMES.has(hostname)) {
    throw new Error(`SSRF guard: blocked hostname`);
  }

  if (hostname === "[::1]" || hostname === "::1") {
    throw new Error(`SSRF guard: blocked loopback IPv6`);
  }
  if (hostname.startsWith("[fc") || hostname.startsWith("[fd")) {
    throw new Error(`SSRF guard: blocked private IPv6`);
  }

  for (const range of PRIVATE_IP_RANGES) {
    if (range.test(hostname)) {
      throw new Error(`SSRF guard: blocked private IP`);
    }
  }

  if (
    hostname === "169.254.169.254" ||
    hostname === "metadata.google.internal"
  ) {
    throw new Error(`SSRF guard: blocked metadata endpoint`);
  }

  return parsed.toString();
}

const MAX_REDIRECTS = 5;
const REDIRECT_CODES = new Set([301, 302, 303, 307, 308]);

export interface SafeFetchOptions extends RequestInit {
  /** Abort the request after N ms. Default DEFAULT_TIMEOUT_MS. Ignored if caller passes `signal`. */
  timeoutMs?: number;
}

/**
 * Wrapper around fetch that validates the URL first AND validates
 * every redirect hop to prevent SSRF via open-redirect chains.
 *
 * Adds a default timeout if the caller doesn't provide one — prevents
 * indefinite hangs on network stalls (HIGH finding from codex-type-safety.md).
 */
export async function safeFetch(
  url: string,
  init?: SafeFetchOptions,
): Promise<Response> {
  let currentUrl = validateExternalUrl(url);
  await validateDns(new URL(currentUrl).hostname);

  const { timeoutMs, ...rest } = init ?? {};

  // If caller didn't provide a signal, attach a timeout.
  const signal = rest.signal ?? AbortSignal.timeout(timeoutMs ?? DEFAULT_TIMEOUT_MS);
  const callerWantsRedirect = rest.redirect;

  if (callerWantsRedirect === "error") {
    return fetch(currentUrl, { ...rest, signal });
  }

  const fetchInit: RequestInit = { ...rest, signal, redirect: "manual" };

  for (let hop = 0; hop <= MAX_REDIRECTS; hop++) {
    const res = await fetch(currentUrl, fetchInit);

    if (!REDIRECT_CODES.has(res.status)) {
      return res;
    }

    const location = res.headers.get("location");
    if (!location) {
      return res;
    }

    const resolved = new URL(location, currentUrl).toString();
    currentUrl = validateExternalUrl(resolved);
    await validateDns(new URL(currentUrl).hostname);
  }

  throw new Error(`SSRF guard: too many redirects (max ${MAX_REDIRECTS})`);
}
