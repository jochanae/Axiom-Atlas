import { useCallback } from "react";
import { Entry, Project } from "@workspace/api-client-react";
import { useLocation } from "wouter";
import { popPrev, peekPrev } from "@/lib/nav-history";

/**
 * useEntryReferrer — returns a `goBack(fallback?)` callback that navigates
 * to the actual route the user came from. Falls back to the provided path
 * (default "/home") when no referrer exists or the previous entry equals
 * the current path.
 *
 * Routes that previously hard-coded `setLocation("/home")` or
 * `window.history.back()` should use this hook instead, so navigation
 * respects entry context across Master Map, Entry Detail, Parking Lot,
 * Vault, Sessions, Workshop, and Project Compass.
 */
export function useEntryReferrer(defaultFallback: string = "/home") {
  const [currentPath, setLocation] = useLocation();

  const goBack = useCallback(
    (fallback?: string) => {
      const target = (() => {
        const prev = popPrev();
        if (prev && prev !== currentPath) return prev;
        return fallback ?? defaultFallback;
      })();
      setLocation(target);
    },
    [currentPath, setLocation, defaultFallback],
  );

  // Expose what back would resolve to (for labels/tooltips).
  const previewPrev = useCallback(() => peekPrev(), []);

  return { goBack, previewPrev };
}
