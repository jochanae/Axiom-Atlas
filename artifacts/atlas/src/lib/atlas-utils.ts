export function extractApiErrorMessage(err: unknown, fallback = "Something went wrong. Please try again."): string {
  if (err && typeof err === "object") {
    const e = err as Record<string, unknown>;
    if (e["data"] && typeof e["data"] === "object") {
      const msg = (e["data"] as Record<string, unknown>)["message"];
      if (typeof msg === "string" && msg.trim()) return msg.trim();
    }
    if (typeof e["message"] === "string" && e["message"].trim()) return e["message"].trim();
  }
  return fallback;
}

export function relativeTime(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime();
  const m = Math.floor(diff / 60000);
  if (m < 1) return "just now";
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  const d = Math.floor(h / 24);
  if (d < 30) return `${d}d ago`;
  const mo = Math.floor(d / 30);
  return `${mo}mo ago`;
}

export function formatCost(cost: number | null | undefined): string {
  if (cost == null) return "";
  return `$${cost.toLocaleString(undefined, { minimumFractionDigits: 0, maximumFractionDigits: 2 })}`;
}
