import type { CSSProperties } from "react";

export const ICON_TOUCH_TARGET_STYLE: CSSProperties = { minWidth: 34, minHeight: 34, padding: 6 };
export const COLLAPSE_LINES = 3;

export type PlanState = "pending" | "reviewing" | "executing" | "completed" | "skipped";

export function formatTimestamp(iso?: string): string {
  if (!iso) return "";
  const d = new Date(iso);
  const now = new Date();
  const diffMs = now.getTime() - d.getTime();
  const diffMin = Math.floor(diffMs / 60000);
  if (diffMin < 1) return "just now";
  if (diffMin < 60) return `${diffMin}m ago`;
  const diffH = Math.floor(diffMin / 60);
  if (diffH < 24) return `${diffH}h ago`;
  return d.toLocaleDateString("en-US", { month: "short", day: "numeric" });
}

// ── Diff utilities ────────────────────────────────────────────────────────────
export type DiffLine = { type: "added" | "removed" | "context"; line: string };
export type DiffItem = DiffLine | { type: "ellipsis"; count: number };

export function computeLineDiff(before: string, after: string): DiffLine[] {
  const a = before.split("\n");
  const b = after.split("\n");
  const m = a.length, n = b.length;
  if (m > 400 || n > 400) {
    return b.map((line) => ({ type: "added" as const, line }));
  }
  const dp: number[][] = Array.from({ length: m + 1 }, () => new Array(n + 1).fill(0));
  for (let i = 1; i <= m; i++) {
    for (let j = 1; j <= n; j++) {
      dp[i][j] = a[i - 1] === b[j - 1] ? dp[i - 1][j - 1] + 1 : Math.max(dp[i - 1][j], dp[i][j - 1]);
    }
  }
  const result: DiffLine[] = [];
  let i = m, j = n;
  while (i > 0 || j > 0) {
    if (i > 0 && j > 0 && a[i - 1] === b[j - 1]) {
      result.unshift({ type: "context", line: a[i - 1] });
      i--; j--;
    } else if (j > 0 && (i === 0 || dp[i][j - 1] >= dp[i - 1][j])) {
      result.unshift({ type: "added", line: b[j - 1] });
      j--;
    } else {
      result.unshift({ type: "removed", line: a[i - 1] });
      i--;
    }
  }
  return result;
}

export function collapseDiff(lines: DiffLine[], ctx = 3): DiffItem[] {
  const relevant = new Set<number>();
  lines.forEach((l, i) => {
    if (l.type !== "context") {
      for (let k = Math.max(0, i - ctx); k <= Math.min(lines.length - 1, i + ctx); k++) relevant.add(k);
    }
  });
  if (relevant.size === 0) {
    const preview = lines.slice(0, ctx);
    const rest = lines.length - preview.length;
    return [...preview, ...(rest > 0 ? [{ type: "ellipsis" as const, count: rest }] : [])];
  }
  const result: DiffItem[] = [];
  let last = -1;
  for (let i = 0; i < lines.length; i++) {
    if (!relevant.has(i)) continue;
    if (last !== -1 && i > last + 1) result.push({ type: "ellipsis" as const, count: i - last - 1 });
    result.push(lines[i]);
    last = i;
  }
  if (last < lines.length - 1) result.push({ type: "ellipsis" as const, count: lines.length - 1 - last });
  return result;
}
