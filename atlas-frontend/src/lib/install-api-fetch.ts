// Global fetch shim: rewrites bare "/api/*" calls to the external backend
// (API_BASE) and attaches the stored bearer token when present.
// This is installed once at app bootstrap so legacy call sites that use
// `fetch("/api/...")` reach the real backend instead of the preview origin.
import { API_BASE } from "./api";

declare global {
  interface Window {
    __atlasFetchPatched?: boolean;
  }
}

if (typeof window !== "undefined" && !window.__atlasFetchPatched) {
  const originalFetch = window.fetch.bind(window);

  const rewriteUrl = (input: RequestInfo | URL): RequestInfo | URL => {
    try {
      if (typeof input === "string") {
        if (input.startsWith("/api/")) return `${API_BASE}${input}`;
        return input;
      }
      if (input instanceof URL) {
        if (input.origin === window.location.origin && input.pathname.startsWith("/api/")) {
          return new URL(input.pathname + input.search + input.hash, API_BASE);
        }
        return input;
      }
      // Request object
      if (input instanceof Request) {
        const u = new URL(input.url);
        if (u.origin === window.location.origin && u.pathname.startsWith("/api/")) {
          const newUrl = `${API_BASE}${u.pathname}${u.search}${u.hash}`;
          return new Request(newUrl, input);
        }
        return input;
      }
    } catch {
      // fall through
    }
    return input;
  };

  const isApiTarget = (input: RequestInfo | URL): boolean => {
    try {
      if (typeof input === "string") {
        if (input.startsWith("/api/")) return true;
        if (input.startsWith(API_BASE + "/api/")) return true;
        return false;
      }
      if (input instanceof URL) return input.href.startsWith(API_BASE + "/api/");
      if (input instanceof Request) return input.url.startsWith(API_BASE + "/api/");
    } catch {}
    return false;
  };

  window.fetch = async (input: RequestInfo | URL, init?: RequestInit) => {
    const target = rewriteUrl(input);
    let nextInit = init;
    if (isApiTarget(target)) {
      const token = localStorage.getItem("atlas-auth-token");
      if (token) {
        const headers = new Headers(init?.headers ?? (target instanceof Request ? target.headers : undefined));
        if (!headers.has("Authorization")) headers.set("Authorization", `Bearer ${token}`);
        nextInit = { ...(init ?? {}), headers };
      }
    }
    return originalFetch(target as RequestInfo, nextInit);
  };

  window.__atlasFetchPatched = true;
}

export {};
