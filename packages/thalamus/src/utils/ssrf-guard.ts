/**
 * SSRF Guard — validates URLs before fetching to prevent
 * Server-Side Request Forgery targeting internal networks.
 *
 * Rejects: private IPs, loopback, link-local, metadata endpoints,
 * non-http(s) schemes, known internal hostnames, and DNS rebinding.
 * Follows redirects manually to validate each hop.
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

/** Check if an IP address is private/internal */
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
  // Skip for raw IPs — already checked by validateExternalUrl
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

  // Only allow http/https
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    throw new Error(`SSRF guard: blocked scheme ${parsed.protocol}`);
  }

  // Block known internal hostnames
  const hostname = parsed.hostname.toLowerCase();
  if (BLOCKED_HOSTNAMES.has(hostname)) {
    throw new Error(`SSRF guard: blocked hostname`);
  }

  // Block IPv6 loopback and private
  if (hostname === "[::1]" || hostname === "::1") {
    throw new Error(`SSRF guard: blocked loopback IPv6`);
  }
  if (hostname.startsWith("[fc") || hostname.startsWith("[fd")) {
    throw new Error(`SSRF guard: blocked private IPv6`);
  }

  // Block private IPv4
  for (const range of PRIVATE_IP_RANGES) {
    if (range.test(hostname)) {
      throw new Error(`SSRF guard: blocked private IP`);
    }
  }

  // Block AWS/GCP/Azure metadata endpoints
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

/**
 * Wrapper around fetch that validates the URL first AND validates
 * every redirect hop to prevent SSRF via open-redirect chains.
 * Drop-in replacement: `safeFetch(url, opts)` instead of `fetch(url, opts)`.
 */
export async function safeFetch(
  url: string,
  init?: RequestInit,
): Promise<Response> {
  let currentUrl = validateExternalUrl(url);
  await validateDns(new URL(currentUrl).hostname);

  const callerWantsRedirect = init?.redirect;

  // If caller explicitly wants "error" or already handles redirects, respect that
  if (callerWantsRedirect === "error") {
    return fetch(currentUrl, init);
  }

  // Override to manual so we can validate each hop
  const fetchInit = { ...init, redirect: "manual" as RequestRedirect };

  for (let hop = 0; hop <= MAX_REDIRECTS; hop++) {
    const res = await fetch(currentUrl, fetchInit);

    if (!REDIRECT_CODES.has(res.status)) {
      return res;
    }

    const location = res.headers.get("location");
    if (!location) {
      return res; // redirect without Location header — return as-is
    }

    // Resolve relative redirects against the current URL
    const resolved = new URL(location, currentUrl).toString();

    // Validate the redirect target — throws if it points to internal network
    currentUrl = validateExternalUrl(resolved);
    await validateDns(new URL(currentUrl).hostname);
  }

  throw new Error(`SSRF guard: too many redirects (max ${MAX_REDIRECTS})`);
}
