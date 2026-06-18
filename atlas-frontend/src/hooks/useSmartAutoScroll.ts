import { useEffect, useRef, type RefObject } from "react";

/**
 * Smart Anchor scroll for chat surfaces.
 *
 * Rules:
 *  - Auto-scroll to bottom on dep change ONLY if the user is already near the bottom.
 *  - If the user scrolls UP (away from bottom), freeze — do not yank them back.
 *  - Once the user returns to near-bottom manually, the lock releases and auto-scroll resumes.
 *  - `force` deps (e.g. a fresh user send) override the freeze and jump to bottom.
 *
 * Threshold defaults to 80px from bottom — anything closer counts as "at bottom".
 */
export function useSmartAutoScroll(
  ref: RefObject<HTMLElement | null>,
  deps: ReadonlyArray<unknown>,
  options?: {
    threshold?: number;
    /** Deps that should bypass the freeze and always jump to bottom (e.g. user-send count). */
    forceDeps?: ReadonlyArray<unknown>;
    /** Set false to disable entirely (e.g. surface not open). */
    enabled?: boolean;
    behavior?: ScrollBehavior;
  },
) {
  const threshold = options?.threshold ?? 80;
  const enabled = options?.enabled ?? true;
  const behavior = options?.behavior ?? "smooth";
  const stickRef = useRef(true);

  // Track user scroll position to maintain the stick flag.
  useEffect(() => {
    const el = ref.current;
    if (!el || !enabled) return;
    const onScroll = () => {
      const distance = el.scrollHeight - el.scrollTop - el.clientHeight;
      stickRef.current = distance <= threshold;
    };
    el.addEventListener("scroll", onScroll, { passive: true });
    onScroll();
    return () => el.removeEventListener("scroll", onScroll);
  }, [ref, enabled, threshold]);

  // Auto-scroll on dep change if stuck to bottom.
  useEffect(() => {
    if (!enabled) return;
    const el = ref.current;
    if (!el) return;
    if (!stickRef.current) return;
    el.scrollTo({ top: el.scrollHeight, behavior });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps);

  // Force-scroll on user send / explicit triggers — bypasses the freeze.
  useEffect(() => {
    if (!enabled) return;
    if (!options?.forceDeps) return;
    const el = ref.current;
    if (!el) return;
    stickRef.current = true;
    el.scrollTo({ top: el.scrollHeight, behavior });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, options?.forceDeps ?? []);

  return {
    /** Imperatively jump to bottom (e.g. scroll-to-latest button). Also re-locks stick. */
    scrollToBottom: (b: ScrollBehavior = "smooth") => {
      const el = ref.current;
      if (!el) return;
      stickRef.current = true;
      el.scrollTo({ top: el.scrollHeight, behavior: b });
    },
    isStuckRef: stickRef,
  };
}
