import { useEffect, useRef, useState, useCallback } from "react";

const THRESHOLD = 72;
const MAX_PULL = 110;

export function usePullToRefresh(onRefresh: () => Promise<void> | void, enabled = true) {
  const [distance, setDistance] = useState(0);
  const [refreshing, setRefreshing] = useState(false);
  const startY = useRef<number | null>(null);
  const distanceRef = useRef(0);
  const refreshingRef = useRef(false);
  const pulling = distance > 8;

  const handleRefresh = useCallback(async () => {
    if (refreshingRef.current) return;
    refreshingRef.current = true;
    setRefreshing(true);
    try { await onRefresh(); } finally {
      setTimeout(() => {
        refreshingRef.current = false;
        setRefreshing(false);
      }, 600);
    }
  }, [onRefresh]);

  useEffect(() => {
    if (!enabled) return;

    const onTouchStart = (e: TouchEvent) => {
      if (refreshingRef.current) return;
      const scrollTop = document.documentElement.scrollTop || document.body.scrollTop;
      if (scrollTop <= 0 && e.touches[0].clientY < 200) {
        startY.current = e.touches[0].clientY;
      }
    };

    const onTouchMove = (e: TouchEvent) => {
      if (startY.current === null) return;
      const dy = e.touches[0].clientY - startY.current;
      if (dy > 0) {
        const d = Math.min(dy * 0.55, MAX_PULL);
        distanceRef.current = d;
        setDistance(d);
      }
    };

    const onTouchEnd = async () => {
      if (startY.current === null) return;
      startY.current = null;
      const d = distanceRef.current;
      if (d >= THRESHOLD) {
        setDistance(THRESHOLD * 0.7);
        distanceRef.current = THRESHOLD * 0.7;
        await handleRefresh();
      }
      distanceRef.current = 0;
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
  }, [enabled, handleRefresh]);

  return { pulling, distance, refreshing, threshold: THRESHOLD };
}
