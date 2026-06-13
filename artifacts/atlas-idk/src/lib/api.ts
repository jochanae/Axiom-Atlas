// Default to the deployed Neon-backed API. Override with VITE_API_URL when needed.
const DEFAULT_API_BASE = "https://axiom-atlas-689827072865.us-east1.run.app";
export const API_BASE = (import.meta.env.VITE_API_URL ?? import.meta.env.VITE_API_BASE_URL ?? DEFAULT_API_BASE).replace(/\/$/, "");

export function apiUrl(path: string): string {
  return `${API_BASE}${path}`;
}

// Auth is cookie-based (atlas-session). All authed fetches must use
// `credentials: "include"`. No Authorization header needed.
export function getAuthHeaders(): Record<string, string> {
  return {};
}
