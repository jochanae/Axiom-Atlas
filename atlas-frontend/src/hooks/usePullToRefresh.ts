import { useEffect, useRef, useState, useCallback } from "react";

const THRESHOLD = 96;
const MAX_PULL = 120;

export function usePullToRefresh(
  onRefresh: () => Promise<void> | void,
  enabled = true,
  containerRef?: React.RefObject<HTMLElement | null>,
) {
  const [distance, setDistance] = useState(0);
  const [refreshing, setRefreshing] = useState(false);
  const refreshingRef = useRef(false);
  const pulling = distance > 28;

  const handleRefresh = useCallback(async () => {
    if (refreshingRef.current) return;
    refreshingRef.current = true;
    setRefreshing(true);
    try { await onRefresh(); } finally {
      setTimeout(() => {
        refreshingRef.current = false;
        setRefreshing(false);
        setDistance(0);
      }, 700);
    }
  }, [onRefresh]);

  useEffect(() => {
    if (!enabled) return;

    // Local closure vars — no stale-closure issues
    let startY: number | null = null;
    let live = 0;

    const isAtTop = () => {
      const el = containerRef?.current;
      return (el ? el.scrollTop : document.documentElement.scrollTop) <= 5;
    };

    const onTouchStart = (e: TouchEvent) => {
      if (refreshingRef.current) return;
      if (document.body.dataset.voiceActive === "true") return;
      // Don't engage if the touch originates inside any scrollable child element
      const container = containerRef?.current ?? document.documentElement;
      let el = e.target as HTMLElement | null;
      while (el && el !== container) {
        if (el.scrollHeight > el.clientHeight + 10) return;
        el = el.parentElement;
      }
      if (isAtTop()) startY = e.touches[0].clientY;
    };

    const onTouchMove = (e: TouchEvent) => {
      if (startY === null) return;
      const dy = e.touches[0].clientY - startY;
      if (dy > 0) {
        live = Math.min(dy * 0.55, MAX_PULL);
        setDistance(live);
      } else {
        startY = null;
        live = 0;
        setDistance(0);
      }
    };

    const onTouchEnd = async () => {
      if (startY === null) return;
      startY = null;
      if (live >= THRESHOLD) {
        setDistance(THRESHOLD * 0.7);
        live = 0;
        await handleRefresh();
      } else {
        live = 0;
        setDistance(0);
      }
    };

    window.addEventListener("touchstart", onTouchStart, { passive: true });
    window.addEventListener("touchmove", onTouchMove, { passive: true });
    window.addEventListener("touchend", onTouchEnd);
    return () => {
      window.removeEventListener("touchstart", onTouchStart);
      window.removeEventListener("touchmove", onTouchMove);
      window.removeEventListener("touchend", onTouchEnd);
    };
  }, [enabled, handleRefresh, containerRef]);

  return { pulling, distance, refreshing, threshold: THRESHOLD };
}
