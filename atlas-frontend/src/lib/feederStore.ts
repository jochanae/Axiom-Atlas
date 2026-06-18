import { useEffect } from "react";
import { useSyncExternalStore } from "react";

/**
 * Feeder channel attachment — backend-backed, localStorage-cached.
 *
 * Backend infers the conversation from the authenticated user (Living Thread
 * is 1-per-user), so PATCH /api/nexus/thread/attach only needs { projectId }.
 * GET /api/nexus/conversations returns attached_project_id for hydration.
 *
 * localStorage stays as an optimistic cache so the header chip / sidebar chip
 * light up the instant CommitPill arms, before the PATCH round-trips.
 */

const CACHE_KEY = "atlas-nexus-feeder";
const EVENT = "atlas-feeder-change";

export interface FeederAttachment {
  projectId: number;
  projectTitle: string;
  attachedAt: string; // ISO
}

function emit() {
  if (typeof window === "undefined") return;
  window.dispatchEvent(new Event(EVENT));
}

export function getFeeder(): FeederAttachment | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = window.localStorage.getItem(CACHE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as FeederAttachment;
    if (typeof parsed?.projectId !== "number" || !parsed?.projectTitle) return null;
    return parsed;
  } catch {
    return null;
  }
}

function writeCache(attachment: FeederAttachment | null) {
  if (typeof window === "undefined") return;
  if (attachment) {
    window.localStorage.setItem(CACHE_KEY, JSON.stringify(attachment));
  } else {
    window.localStorage.removeItem(CACHE_KEY);
  }
  emit();
}

/**
 * Optimistically attach a feeder. Writes cache immediately, then PATCHes the
 * backend. On failure the cache is rolled back so the UI reflects truth.
 */
export async function setFeeder(
  attachment: Omit<FeederAttachment, "attachedAt">,
): Promise<void> {
  const prev = getFeeder();
  const optimistic: FeederAttachment = {
    ...attachment,
    attachedAt: new Date().toISOString(),
  };
  writeCache(optimistic);
  try {
    const res = await fetch("/api/nexus/thread/attach", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      credentials: "include",
      body: JSON.stringify({ projectId: attachment.projectId }),
    });
    if (!res.ok) throw new Error(`attach failed: ${res.status}`);
  } catch (err) {
    writeCache(prev);
    throw err;
  }
}

export async function clearFeeder(): Promise<void> {
  const prev = getFeeder();
  writeCache(null);
  try {
    const res = await fetch("/api/nexus/thread/attach", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      credentials: "include",
      body: JSON.stringify({ projectId: null }),
    });
    if (!res.ok) throw new Error(`detach failed: ${res.status}`);
  } catch (err) {
    writeCache(prev);
    throw err;
  }
}

/**
 * Hydrate cache from backend. Call once on Nexus mount. Reconciles localStorage
 * against the authenticated thread's attached_project_id.
 */
export async function hydrateFeeder(): Promise<void> {
  try {
    const res = await fetch("/api/nexus/conversations", { credentials: "include" });
    if (!res.ok) return;
    const data = await res.json();
    // Accept either { attached_project_id, attached_project_title } at the top
    // level or the first conversation in a `conversations` array.
    const row = Array.isArray(data?.conversations) ? data.conversations[0] : data;
    const projectId: number | null = row?.attached_project_id ?? null;
    if (projectId == null) {
      writeCache(null);
      return;
    }
    const projectTitle: string = row?.attached_project_title ?? row?.project_title ?? "Project";
    writeCache({
      projectId,
      projectTitle,
      attachedAt: row?.attached_at ?? new Date().toISOString(),
    });
  } catch {
    // network blip — keep whatever cache we have
  }
}

function subscribe(cb: () => void) {
  if (typeof window === "undefined") return () => {};
  const handler = () => cb();
  window.addEventListener(EVENT, handler);
  window.addEventListener("storage", handler);
  return () => {
    window.removeEventListener(EVENT, handler);
    window.removeEventListener("storage", handler);
  };
}

/** React hook — re-renders when the feeder attachment changes. */
export function useFeeder(): FeederAttachment | null {
  const snapshot = useSyncExternalStore(
    subscribe,
    () => (typeof window !== "undefined" ? window.localStorage.getItem(CACHE_KEY) : null),
    () => null,
  );
  return snapshot ? getFeeder() : null;
}

/** Hydrate on mount. Drop this in NexusPage. */
export function useFeederHydration() {
  useEffect(() => {
    void hydrateFeeder();
  }, []);
}
