import { useEffect, useRef, useState, type ReactNode, type CSSProperties } from "react";

interface LongPressTipProps {
  children: ReactNode;
  tip: string;
  style?: CSSProperties;
  delay?: number;
  duration?: number;
}

/**
 * Wraps an element and shows a small dark tooltip below after a long-press
 * (default 500ms). Auto-dismisses after `duration` ms (default 2000).
 */
export function LongPressTip({
  children,
  tip,
  style,
  delay = 500,
  duration = 2000,
}: LongPressTipProps) {
  const [show, setShow] = useState(false);
  const pressTimer = useRef<number | null>(null);
  const hideTimer = useRef<number | null>(null);

  const clearTimers = () => {
    if (pressTimer.current) { clearTimeout(pressTimer.current); pressTimer.current = null; }
    if (hideTimer.current) { clearTimeout(hideTimer.current); hideTimer.current = null; }
  };

  const start = () => {
    clearTimers();
    pressTimer.current = window.setTimeout(() => {
      setShow(true);
      hideTimer.current = window.setTimeout(() => setShow(false), duration);
    }, delay);
  };

  const cancel = () => {
    if (pressTimer.current) { clearTimeout(pressTimer.current); pressTimer.current = null; }
  };

  useEffect(() => () => clearTimers(), []);

  return (
    <span
      style={{ position: "relative", display: "inline-flex", alignItems: "center", ...style }}
      onPointerDown={start}
      onPointerUp={cancel}
      onPointerLeave={cancel}
      onPointerCancel={cancel}
    >
      {children}
      {show && (
        <span
          role="tooltip"
          style={{
            position: "absolute",
            top: "calc(100% + 6px)",
            left: "50%",
            transform: "translateX(-50%)",
            background: "rgba(12,10,9,0.96)",
            border: "1px solid rgba(201,162,76,0.35)",
            color: "var(--atlas-gold)",
            fontSize: 10,
            fontFamily: "var(--app-font-mono)",
            letterSpacing: "0.04em",
            padding: "5px 8px",
            borderRadius: 6,
            maxWidth: 220,
            whiteSpace: "normal",
            textAlign: "center",
            zIndex: 9999,
            pointerEvents: "none",
            boxShadow: "0 4px 16px rgba(0,0,0,0.6)",
          }}
        >
          {tip}
        </span>
      )}
    </span>
  );
}

/** Haptic feedback helpers — safe no-op on browsers without navigator.vibrate. */
export const haptic = {
  /** 50ms — confirmation actions (commit, park, dismiss, copy). */
  short: () => { try { navigator.vibrate?.(50); } catch { /* ignore */ } },
  /** [50,50,50] — significant actions (push to GitHub, resolve blocker, override). */
  double: () => { try { navigator.vibrate?.([50, 50, 50]); } catch { /* ignore */ } },
  /** [100,50,100] — caution actions (cross-project tension, iter limit, score regression). */
  warn: () => { try { navigator.vibrate?.([100, 50, 100]); } catch { /* ignore */ } },
};
