/**
 * Atlas time-travel ledger.
 *
 * Single localStorage-backed snapshot store shared by:
 *   - the History card bottom sheet (History | Bookmarks tabs)
 *   - the rollback hook arrow in the Atlas message action toolbar
 *
 * Each snapshot links a chat message (`associated_message_id`) to a
 * workspace state payload (`code_delta`, `ledger_entry`, …). Rollback
 * truncates the thread, flags downstream messages as `reverted`, and
 * dispatches a `lens:restore` event so lens-aware viewports can swap
 * their cache without a full re-render.
 *
 * v1 is local-only (per spec). Cross-device sync is v2 (would add a
 * `snapshot_id` column on chat_messages + a snapshots table).
 */
import { useCallback, useEffect, useState } from "react";

export type AtlasLens = "builder" | "strategic" | "minimal";

export interface AtlasHistoryItem {
  id: string;
  associated_message_id: number;
  title: string;
  timestamp: string; // ISO
  isBookmarked: boolean;
  reverted?: boolean;
  lens: AtlasLens;
  payload: {
    code_delta?: string;
    active_file?: string;
    ledger_entry?: string;
  };
}

export interface RollbackDetail {
  snapshotId: string;
  associatedMessageId: number;
  lens: AtlasLens;
  payload: AtlasHistoryItem["payload"];
}

const LENS_RESTORE_EVENT = "atlas:lens-restore";
const ROLLBACK_EVENT = "atlas:rollback";
const STORE_EVENT = "atlas:history-store";

const storageKey = (projectId: number | string) =>
  `atlas.history.v1:${projectId}`;

function safeLocalStorage(): Storage | null {
  try {
    if (typeof window === "undefined") return null;
    return window.localStorage;
  } catch {
    return null;
  }
}

function read(projectId: number | string): AtlasHistoryItem[] {
  const ls = safeLocalStorage();
  if (!ls) return [];
  try {
    const raw = ls.getItem(storageKey(projectId));
    if (!raw) return [];
    const parsed = JSON.parse(raw) as AtlasHistoryItem[];
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function write(projectId: number | string, items: AtlasHistoryItem[]): void {
  const ls = safeLocalStorage();
  if (!ls) return;
  try {
    ls.setItem(storageKey(projectId), JSON.stringify(items));
    window.dispatchEvent(new CustomEvent(STORE_EVENT, { detail: { projectId } }));
  } catch {
    /* quota */
  }
}

function genId(): string {
  try {
    return (
      typeof crypto !== "undefined" && "randomUUID" in crypto
        ? `snap_${crypto.randomUUID().replace(/-/g, "").slice(0, 18)}`
        : `snap_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`
    );
  } catch {
    return `snap_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
  }
}

/** Inferred title from a user prompt or assistant content (max 64 chars). */
function deriveTitle(seed: string): string {
  const trimmed = (seed || "").replace(/\s+/g, " ").trim();
  if (!trimmed) return "Untitled snapshot";
  return trimmed.length > 64 ? `${trimmed.slice(0, 61)}…` : trimmed;
}

/**
 * Append-only snapshot writer. Safe to call multiple times for the same
 * `associated_message_id` — duplicates are deduped.
 *
 * IMPORTANT (safeguard #1): only call AFTER the stream has fully closed.
 * Calling mid-stream stores a truncated `code_delta`.
 */
export function addSnapshot(
  projectId: number | string,
  input: {
    associated_message_id: number;
    title: string;
    lens: AtlasLens;
    payload?: AtlasHistoryItem["payload"];
  },
): AtlasHistoryItem | null {
  if (!projectId || !input.associated_message_id) return null;
  const items = read(projectId);
  if (items.some((i) => i.associated_message_id === input.associated_message_id)) {
    return null;
  }
  const next: AtlasHistoryItem = {
    id: genId(),
    associated_message_id: input.associated_message_id,
    title: deriveTitle(input.title),
    timestamp: new Date().toISOString(),
    isBookmarked: false,
    lens: input.lens,
    payload: input.payload ?? {},
  };
  write(projectId, [next, ...items]);
  return next;
}

export function toggleBookmark(projectId: number | string, id: string): void {
  const items = read(projectId).map((i) =>
    i.id === id ? { ...i, isBookmarked: !i.isBookmarked } : i,
  );
  write(projectId, items);
}

export function removeSnapshot(projectId: number | string, id: string): void {
  write(projectId, read(projectId).filter((i) => i.id !== id));
}

/**
 * Mark a snapshot as reverted (used to move bypassed snapshots into
 * the "Reverted edits" accordion) — does NOT delete.
 */
function markReverted(projectId: number | string, predicate: (i: AtlasHistoryItem) => boolean): void {
  const items = read(projectId).map((i) =>
    predicate(i) ? { ...i, reverted: true } : i,
  );
  write(projectId, items);
}

/**
 * Roll back to a specific snapshot. Returns the snapshot so the caller can
 * scroll the chat container to `associated_message_id`.
 *
 * Side effects:
 *   1. Dispatches `atlas:rollback` so chat hosts can flag downstream
 *      messages as `reverted` (kept in-array — see safeguard #3 in
 *      whichever component bundles prompt history).
 *   2. Dispatches `atlas:lens-restore` so the active lens viewport swaps
 *      its cache (safeguard #2: viewports must listen).
 *   3. Marks all snapshots NEWER than this one as reverted=true.
 */
export function rollbackTo(
  projectId: number | string,
  snapshotId: string,
): AtlasHistoryItem | null {
  const items = read(projectId);
  const target = items.find((i) => i.id === snapshotId);
  if (!target) return null;

  // Mark newer snapshots reverted (they all live above target in the
  // array because we prepend; target timestamp is the cutoff).
  const cutoff = new Date(target.timestamp).getTime();
  markReverted(projectId, (i) =>
    new Date(i.timestamp).getTime() > cutoff && i.id !== snapshotId,
  );

  if (typeof window !== "undefined") {
    const detail: RollbackDetail = {
      snapshotId: target.id,
      associatedMessageId: target.associated_message_id,
      lens: target.lens,
      payload: target.payload,
    };
    window.dispatchEvent(new CustomEvent(ROLLBACK_EVENT, { detail }));
    window.dispatchEvent(new CustomEvent(LENS_RESTORE_EVENT, { detail }));
  }
  return target;
}

/* ── React hooks ─────────────────────────────────────────────────────── */

export function useAtlasHistory(projectId: number | string | null | undefined) {
  const pid = projectId ?? 0;
  const [items, setItems] = useState<AtlasHistoryItem[]>(() => (pid ? read(pid) : []));

  useEffect(() => {
    if (!pid) {
      setItems([]);
      return;
    }
    setItems(read(pid));
    const handler = (e: Event) => {
      const detail = (e as CustomEvent<{ projectId: number | string }>).detail;
      if (!detail || String(detail.projectId) === String(pid)) {
        setItems(read(pid));
      }
    };
    const storage = (e: StorageEvent) => {
      if (e.key === storageKey(pid)) setItems(read(pid));
    };
    window.addEventListener(STORE_EVENT, handler);
    window.addEventListener("storage", storage);
    return () => {
      window.removeEventListener(STORE_EVENT, handler);
      window.removeEventListener("storage", storage);
    };
  }, [pid]);

  const add = useCallback(
    (input: Parameters<typeof addSnapshot>[1]) => (pid ? addSnapshot(pid, input) : null),
    [pid],
  );
  const rollback = useCallback(
    (id: string) => (pid ? rollbackTo(pid, id) : null),
    [pid],
  );
  const bookmark = useCallback(
    (id: string) => {
      if (pid) toggleBookmark(pid, id);
    },
    [pid],
  );
  const remove = useCallback(
    (id: string) => {
      if (pid) removeSnapshot(pid, id);
    },
    [pid],
  );

  return {
    items,
    bookmarks: items.filter((i) => i.isBookmarked),
    reverted: items.filter((i) => i.reverted),
    active: items.filter((i) => !i.reverted),
    add,
    rollback,
    toggleBookmark: bookmark,
    remove,
  };
}

/**
 * Subscribe to rollback events from anywhere in the tree.
 * Lens viewports (code workspace, strategic map, preview) should call
 * this to instantly swap their internal state cache.
 */
export function useRollbackListener(
  handler: (detail: RollbackDetail) => void,
): void {
  useEffect(() => {
    const fn = (e: Event) => handler((e as CustomEvent<RollbackDetail>).detail);
    window.addEventListener(ROLLBACK_EVENT, fn);
    return () => window.removeEventListener(ROLLBACK_EVENT, fn);
  }, [handler]);
}

export function useLensRestoreListener(
  handler: (detail: RollbackDetail) => void,
): void {
  useEffect(() => {
    const fn = (e: Event) => handler((e as CustomEvent<RollbackDetail>).detail);
    window.addEventListener(LENS_RESTORE_EVENT, fn);
    return () => window.removeEventListener(LENS_RESTORE_EVENT, fn);
  }, [handler]);
}

/* ── Formatting helpers ──────────────────────────────────────────────── */

export function formatSnapshotTimestamp(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  return d.toLocaleString(undefined, {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

export function groupByDay(
  items: AtlasHistoryItem[],
): Array<{ label: string; items: AtlasHistoryItem[] }> {
  const now = new Date();
  const startOf = (d: Date) => new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
  const today = startOf(now);
  const yesterday = today - 24 * 60 * 60 * 1000;

  const buckets = new Map<string, AtlasHistoryItem[]>();
  for (const item of items) {
    const d = new Date(item.timestamp);
    const day = startOf(d);
    let label: string;
    if (day === today) label = "Today";
    else if (day === yesterday) label = "Yesterday";
    else label = d.toLocaleDateString(undefined, { month: "short", day: "numeric" });
    if (!buckets.has(label)) buckets.set(label, []);
    buckets.get(label)!.push(item);
  }
  return Array.from(buckets, ([label, items]) => ({ label, items }));
}
