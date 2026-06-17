const API_BASE = (import.meta.env.VITE_API_URL ?? "").replace(/\/$/, "");

const NOISE_PATTERNS = [
  "ResizeObserver",
  "Non-Error promise",
  "Script error",
  "ChunkLoadError",
];

export async function reportError(
  error: Error | null | unknown,
  context?: { route?: string; projectId?: number }
): Promise<void> {
  try {
    if (!error) return;
    const message = error instanceof Error ? error.message : String(error);
    if (NOISE_PATTERNS.some((p) => message.includes(p))) return;
    const stack = error instanceof Error ? (error.stack ?? "") : "";
    await fetch(`${API_BASE}/api/errorlog/ingest`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      credentials: "include",
      body: JSON.stringify({
        error_message: message.slice(0, 500),
        stack_trace: stack.slice(0, 2000),
        route: context?.route ?? window.location.pathname,
        timestamp: new Date().toISOString(),
        project_id: context?.projectId ?? null,
      }),
    });
  } catch {
    // never throw
  }
}
