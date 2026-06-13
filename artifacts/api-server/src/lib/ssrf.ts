/**
 * SSRF protection utilities.
 * Shared between browser.ts (on-demand routes) and scheduledChecksWorker.ts.
 */
import dns from "node:dns/promises";

export function isPrivateIp(ip: string): boolean {
  const s = ip.toLowerCase();
  if (s === "localhost" || s === "::1") return true;
  return [
    /^127\./,
    /^10\./,
    /^172\.(1[6-9]|2\d|3[01])\./,
    /^192\.168\./,
    /^169\.254\./,
    /^0\./,
    /^::1$/,
    /^fc00:/i,
    /^fe80:/i,
  ].some(re => re.test(s));
}

export async function assertSafeUrl(rawUrl: string): Promise<void> {
  let parsed: URL;
  try { parsed = new URL(rawUrl); } catch { throw new Error("Invalid URL"); }
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    throw new Error("Only http/https URLs are allowed");
  }
  const host = parsed.hostname.toLowerCase();

  // Reject private/local IPs and special-use patterns including *.localhost subdomains
  if (isPrivateIp(host)) {
    throw new Error("Requests to private/localhost addresses are not allowed");
  }
  if (host.endsWith(".localhost")) {
    throw new Error("Requests to *.localhost addresses are not allowed");
  }

  // DNS resolution — fail-closed: if no IPs resolve we cannot verify the host is public
  const v4 = await dns.resolve4(host).catch(() => [] as string[]);
  const v6 = await dns.resolve6(host).catch(() => [] as string[]);
  const allIps = [...v4, ...v6];

  if (allIps.length === 0) {
    throw new Error("Could not verify host resolves to a public address");
  }

  for (const addr of allIps) {
    if (isPrivateIp(addr)) {
      throw new Error("URL resolves to a private IP address");
    }
  }
}

const MAX_REDIRECT_HOPS = 5;

/**
 * SSRF-safe fetch that follows redirects manually.
 * Each Location hop is validated with assertSafeUrl() before following,
 * preventing open-redirect attacks that bounce through a public URL to reach
 * internal/private network endpoints.
 */
export async function safeFetch(
  url: string,
  options: RequestInit = {}
): Promise<Response> {
  let currentUrl = url;
  for (let hop = 0; hop <= MAX_REDIRECT_HOPS; hop++) {
    const resp = await fetch(currentUrl, { ...options, redirect: "manual" });
    if (resp.status < 300 || resp.status >= 400) return resp;
    const location = resp.headers.get("location");
    if (!location) return resp;
    const nextUrl = new URL(location, currentUrl).href;
    await assertSafeUrl(nextUrl);
    currentUrl = nextUrl;
  }
  throw new Error(`Too many redirects (>${MAX_REDIRECT_HOPS})`);
}
