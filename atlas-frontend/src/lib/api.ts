// API base = Cloud Run (Express backend). DB underneath is Supabase Postgres,
// but the code is db-neutral (DATABASE_URL env var on Cloud Run). Override at
// build time with VITE_API_URL when pointing at a different backend.
const DEFAULT_API_BASE = "https://axiom-atlas-689827072865.us-east1.run.app";
const configuredApiBase = import.meta.env.VITE_API_URL || import.meta.env.VITE_API_BASE_URL || DEFAULT_API_BASE;
export const API_BASE = configuredApiBase.replace(/\/$/, "");

export function apiUrl(path: string): string {
  return `${API_BASE}${path}`;
}

// Auth is cookie-based (atlas-session, httpOnly, sameSite=lax) PLUS a bearer
// token stored in localStorage as "atlas-auth-token" for cross-origin calls
// (Lovable preview → Cloud Run). The global fetch shim in
// src/lib/install-api-fetch.ts attaches both automatically. Most call sites
// can keep using bare fetch("/api/..."); use apiUrl() only for non-fetch URLs
// (window.location redirects, <a href>, OAuth start).
export function getAuthHeaders(): Record<string, string> {
  return {};
}
