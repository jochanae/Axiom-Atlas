import { useEffect, useRef, useState, useCallback } from "react";

const THRESHOLD = 72;
const MAX_PULL = 110;

export function usePullToRefresh(onRefresh: () => Promise<void> | void, enabled = true) {
  const [distance, setDistance] = useState(0);
  const [refreshing, setRefreshing] = useState(false);
  const startY = useRef<number | null>(null);
  const pulling = distance > 8;

  const handleRefresh = useCallback(async () => {
    setRefreshing(true);
    try { await onRefresh(); } finally {
      setTimeout(() => setRefreshing(false), 600);
    }
  }, [onRefresh]);

  useEffect(() => {
    if (!enabled) return;

    const onTouchStart = (e: TouchEvent) => {
      if (e.touches[0].clientY < 140) {
        startY.current = e.touches[0].clientY;
      }
    };

    const onTouchMove = (e: TouchEvent) => {
      if (startY.current === null) return;
      const dy = e.touches[0].clientY - startY.current;
      if (dy > 0) setDistance(Math.min(dy * 0.55, MAX_PULL));
    };

    const onTouchEnd = async () => {
      if (startY.current === null) return;
      startY.current = null;
      if (distance >= THRESHOLD) {
        setDistance(THRESHOLD * 0.7);
        await handleRefresh();
      }
      setDistance(0);
    };

    window.addEventListener("touchstart", onTouchStart, { passive: true });
    window.addEventListener("touchmove", onTouchMove, { passive: true });
    window.addEventListener("touchend", onTouchEnd);
    return () => {
      window.removeEventListener("touchstart", onTouchStart);
      window.removeEventListener("touchmove", onTouchMove);
      window.removeEventListener("touchend", onTouchEnd);
    };
  }, [enabled, distance, handleRefresh]);

  return { pulling, distance, refreshing, threshold: THRESHOLD };
}
