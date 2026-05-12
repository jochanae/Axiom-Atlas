import { useEffect, useRef, useState, useCallback } from "react";

const THRESHOLD = 72;
const MAX_PULL = 110;

export function usePullToRefresh(
  onRefresh: () => Promise<void> | void,
  enabled = true,
  containerRef?: React.RefObject<HTMLElement | null>,
) {
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
        distanceRef.current = 0;
        setDistance(0);
      }, 700);
    }
  }, [onRefresh]);

  useEffect(() => {
    if (!enabled) return;

    const getScrollTop = () => {
      if (containerRef?.current) return containerRef.current.scrollTop;
      return document.documentElement.scrollTop || document.body.scrollTop;
    };

    const onTouchStart = (e: TouchEvent) => {
      if (refreshingRef.current) return;
      if (getScrollTop() <= 2) {
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
      } else {
        startY.current = null;
        distanceRef.current = 0;
        setDistance(0);
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
      } else {
        distanceRef.current = 0;
        setDistance(0);
      }
    };

    const target = containerRef?.current ?? window;
    target.addEventListener("touchstart", onTouchStart as EventListener, { passive: true });
    target.addEventListener("touchmove", onTouchMove as EventListener, { passive: true });
    target.addEventListener("touchend", onTouchEnd as EventListener);
    return () => {
      target.removeEventListener("touchstart", onTouchStart as EventListener);
      target.removeEventListener("touchmove", onTouchMove as EventListener);
      target.removeEventListener("touchend", onTouchEnd as EventListener);
    };
  }, [enabled, handleRefresh, containerRef]);

  return { pulling, distance, refreshing, threshold: THRESHOLD };
}
