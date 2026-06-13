import { useCallback, useEffect, useState } from "react";

/**
 * Persisted collapse state for page sub-headers (home + workspace).
 * Lets the user reclaim vertical screen space for reading/working.
 */
export function useCollapsibleSubheader(key: string, defaultCollapsed = false) {
  const storageKey = `axiom:subheader-collapsed:${key}`;
  const [collapsed, setCollapsed] = useState<boolean>(() => {
    if (typeof window === "undefined") return defaultCollapsed;
    try {
      const raw = window.localStorage.getItem(storageKey);
      if (raw === null) return defaultCollapsed;
      return raw === "1";
    } catch {
      return defaultCollapsed;
    }
  });

  useEffect(() => {
    try {
      window.localStorage.setItem(storageKey, collapsed ? "1" : "0");
    } catch {
      // ignore quota / privacy-mode errors
    }
  }, [storageKey, collapsed]);

  const toggle = useCallback(() => setCollapsed((v) => !v), []);

  return { collapsed, toggle, setCollapsed };
}
