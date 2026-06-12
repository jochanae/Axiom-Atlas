import { useState, useRef, useCallback, useEffect } from "react";
import type React from "react";

export interface ImageVersion {
  id: string;
  dataUrl: string;
  prompt?: string;
  createdAt: string;
}

interface CanvasPanelProps {
  versions: ImageVersion[];
  activeVersionId: string | null;
  onVersionSelect: (id: string) => void;
  onRefine: (prompt: string) => void;
  onClose: () => void;
  mode?: "modal" | "inline";
}

const MIN_SCALE = 1;
const MAX_SCALE = 8;
const DOUBLE_TAP_MS = 300;
const ZOOM_STEP = 1.5;

function clamp(v: number, min: number, max: number) {
  return Math.min(Math.max(v, min), max);
}

export function CanvasPanel({
  versions,
  activeVersionId,
  onVersionSelect,
  onRefine,
  onClose,
  mode = "modal",
}: CanvasPanelProps) {
  const [refineInput, setRefineInput] = useState("");
  const [refineLoading, setRefineLoading] = useState(false);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  const [scale, setScale] = useState(1);
  const [origin, setOrigin] = useState({ x: 0, y: 0 });

  const containerRef = useRef<HTMLDivElement>(null);
  const imgRef = useRef<HTMLImageElement>(null);

  const lastTapRef = useRef(0);
  const lastTouchDistRef = useRef<number | null>(null);
  const lastScaleRef = useRef(1);
  const lastOriginRef = useRef({ x: 0, y: 0 });
  const pinchMidpointRef = useRef({ x: 0, y: 0 });

  const isDraggingRef = useRef(false);
  const dragStartRef = useRef({ x: 0, y: 0 });
  const dragOriginRef = useRef({ x: 0, y: 0 });

  const active = versions.find((v) => v.id === activeVersionId) ?? versions[versions.length - 1] ?? null;

  const resetZoom = useCallback(() => {
    setScale(1);
    setOrigin({ x: 0, y: 0 });
    lastScaleRef.current = 1;
    lastOriginRef.current = { x: 0, y: 0 };
  }, []);

  useEffect(() => {
    resetZoom();
  }, [activeVersionId, resetZoom]);

  const clampOrigin = useCallback(
    (ox: number, oy: number, sc: number) => {
      const el = containerRef.current;
      if (!el) return { x: ox, y: oy };
      const cw = el.clientWidth;
      const ch = el.clientHeight;
      const maxX = (cw * (sc - 1)) / 2;
      const maxY = (ch * (sc - 1)) / 2;
      return { x: clamp(ox, -maxX, maxX), y: clamp(oy, -maxY, maxY) };
    },
    []
  );

  const applyZoom = useCallback(
    (nextScale: number, focalX: number, focalY: number, currentScale: number, currentOrigin: { x: number; y: number }) => {
      const el = containerRef.current;
      if (!el) return;
      const rect = el.getBoundingClientRect();
      const cx = rect.left + rect.width / 2;
      const cy = rect.top + rect.height / 2;
      const dx = focalX - cx;
      const dy = focalY - cy;
      const ratio = nextScale / currentScale;
      const nx = currentOrigin.x * ratio + dx * (1 - ratio);
      const ny = currentOrigin.y * ratio + dy * (1 - ratio);
      const clamped = clampOrigin(nx, ny, nextScale);
      setScale(nextScale);
      setOrigin(clamped);
      lastScaleRef.current = nextScale;
      lastOriginRef.current = clamped;
    },
    [clampOrigin]
  );

  const handleWheel = useCallback(
    (e: React.WheelEvent<HTMLDivElement>) => {
      e.preventDefault();
      const delta = e.deltaY < 0 ? 1.1 : 0.9;
      const next = clamp(lastScaleRef.current * delta, MIN_SCALE, MAX_SCALE);
      applyZoom(next, e.clientX, e.clientY, lastScaleRef.current, lastOriginRef.current);
    },
    [applyZoom]
  );

  const handleTouchStart = useCallback((e: React.TouchEvent<HTMLDivElement>) => {
    if (e.touches.length === 1) {
      const now = Date.now();
      const t = e.touches[0];
      if (now - lastTapRef.current < DOUBLE_TAP_MS) {
        e.preventDefault();
        if (lastScaleRef.current > 1) {
          setScale(1);
          setOrigin({ x: 0, y: 0 });
          lastScaleRef.current = 1;
          lastOriginRef.current = { x: 0, y: 0 };
        } else {
          const next = clamp(ZOOM_STEP * 2, MIN_SCALE, MAX_SCALE);
          applyZoom(next, t.clientX, t.clientY, lastScaleRef.current, lastOriginRef.current);
        }
        lastTapRef.current = 0;
        return;
      }
      lastTapRef.current = now;
      lastTouchDistRef.current = null;
    } else if (e.touches.length === 2) {
      e.preventDefault();
      lastTapRef.current = 0;
      const t1 = e.touches[0];
      const t2 = e.touches[1];
      const dist = Math.hypot(t2.clientX - t1.clientX, t2.clientY - t1.clientY);
      lastTouchDistRef.current = dist;
      pinchMidpointRef.current = {
        x: (t1.clientX + t2.clientX) / 2,
        y: (t1.clientY + t2.clientY) / 2,
      };
    }
  }, [applyZoom]);

  const handleTouchMove = useCallback((e: React.TouchEvent<HTMLDivElement>) => {
    if (e.touches.length === 2) {
      e.preventDefault();
      const t1 = e.touches[0];
      const t2 = e.touches[1];
      const dist = Math.hypot(t2.clientX - t1.clientX, t2.clientY - t1.clientY);
      const prev = lastTouchDistRef.current;
      if (prev === null) {
        lastTouchDistRef.current = dist;
        return;
      }
      const ratio = dist / prev;
      const next = clamp(lastScaleRef.current * ratio, MIN_SCALE, MAX_SCALE);
      const mid = {
        x: (t1.clientX + t2.clientX) / 2,
        y: (t1.clientY + t2.clientY) / 2,
      };
      applyZoom(next, mid.x, mid.y, lastScaleRef.current, lastOriginRef.current);
      lastTouchDistRef.current = dist;
    } else if (e.touches.length === 1 && lastScaleRef.current > 1) {
      e.preventDefault();
    }
  }, [applyZoom]);

  const handleTouchEnd = useCallback((e: React.TouchEvent<HTMLDivElement>) => {
    if (e.touches.length < 2) {
      lastTouchDistRef.current = null;
    }
  }, []);

  const handleMouseDown = useCallback((e: React.MouseEvent<HTMLDivElement>) => {
    if (lastScaleRef.current <= 1) return;
    isDraggingRef.current = true;
    dragStartRef.current = { x: e.clientX, y: e.clientY };
    dragOriginRef.current = { ...lastOriginRef.current };
    e.preventDefault();
  }, []);

  const handleMouseMove = useCallback((e: React.MouseEvent<HTMLDivElement>) => {
    if (!isDraggingRef.current) return;
    const dx = e.clientX - dragStartRef.current.x;
    const dy = e.clientY - dragStartRef.current.y;
    const nx = dragOriginRef.current.x + dx;
    const ny = dragOriginRef.current.y + dy;
    const clamped = clampOrigin(nx, ny, lastScaleRef.current);
    setOrigin(clamped);
    lastOriginRef.current = clamped;
  }, [clampOrigin]);

  const handleMouseUp = useCallback(() => {
    isDraggingRef.current = false;
  }, []);

  const handleRefine = useCallback(async () => {
    const text = refineInput.trim();
    if (!text || refineLoading) return;
    setRefineLoading(true);
    setRefineInput("");
    try {
      await onRefine(text);
    } finally {
      setRefineLoading(false);
    }
  }, [refineInput, refineLoading, onRefine]);

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
      if (e.key === "Enter" && !e.shiftKey) {
        e.preventDefault();
        void handleRefine();
      }
    },
    [handleRefine]
  );

  const containerStyle: React.CSSProperties =
    mode === "modal"
      ? {
          position: "fixed",
          inset: 0,
          zIndex: 200,
          display: "flex",
          flexDirection: "column",
          background: "var(--atlas-bg)",
        }
      : {
          display: "flex",
          flexDirection: "column",
          height: "100%",
          background: "var(--atlas-bg)",
          borderLeft: "1px solid var(--atlas-border)",
        };

  const isZoomed = scale > 1;

  return (
    <div style={containerStyle}>
      {/* Header */}
      <div
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          padding: "10px 14px",
          borderBottom: "1px solid var(--atlas-border)",
          flexShrink: 0,
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <svg width="14" height="14" viewBox="0 0 16 16" fill="none" aria-hidden>
            <rect x="1" y="1" width="14" height="14" rx="2" stroke="var(--atlas-gold)" strokeWidth="1.2" />
            <path d="M1 10l4-4 3 3 3-4 4 5" stroke="var(--atlas-gold)" strokeWidth="1.2" strokeLinejoin="round" />
          </svg>
          <span
            style={{
              fontFamily: "var(--app-font-mono)",
              fontSize: 10,
              fontWeight: 700,
              letterSpacing: "0.14em",
              color: "var(--atlas-gold)",
              textTransform: "uppercase",
            }}
          >
            VISUAL CANVAS
          </span>
          {versions.length > 1 && (
            <span
              style={{
                fontFamily: "var(--app-font-mono)",
                fontSize: 9,
                color: "var(--atlas-muted)",
                letterSpacing: "0.06em",
              }}
            >
              v{versions.findIndex((v) => v.id === active?.id) + 1} / {versions.length}
            </span>
          )}
          {isZoomed && (
            <button
              onClick={resetZoom}
              title="Reset zoom"
              style={{
                fontFamily: "var(--app-font-mono)",
                fontSize: 9,
                letterSpacing: "0.06em",
                color: "var(--atlas-muted)",
                background: "transparent",
                border: "1px solid var(--atlas-border)",
                borderRadius: 4,
                padding: "2px 6px",
                cursor: "pointer",
              }}
            >
              {Math.round(scale * 100)}% ×
            </button>
          )}
        </div>
        <button
          onClick={onClose}
          title="Close canvas"
          style={{
            width: 28,
            height: 28,
            borderRadius: 6,
            background: "transparent",
            border: "1px solid var(--atlas-border)",
            cursor: "pointer",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            color: "var(--atlas-muted)",
            flexShrink: 0,
          }}
        >
          <svg width="10" height="10" viewBox="0 0 12 12" fill="none" aria-hidden>
            <path d="M1 1l10 10M11 1L1 11" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
          </svg>
        </button>
      </div>

      {/* Main image area */}
      <div
        ref={containerRef}
        onWheel={handleWheel}
        onTouchStart={handleTouchStart}
        onTouchMove={handleTouchMove}
        onTouchEnd={handleTouchEnd}
        onMouseDown={handleMouseDown}
        onMouseMove={handleMouseMove}
        onMouseUp={handleMouseUp}
        onMouseLeave={handleMouseUp}
        style={{
          flex: 1,
          overflow: "hidden",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          padding: 16,
          position: "relative",
          cursor: isZoomed ? "grab" : "default",
          userSelect: "none",
          touchAction: "none",
        }}
      >
        {active ? (
          <img
            ref={imgRef}
            src={active.dataUrl}
            alt="Generated visual"
            draggable={false}
            style={{
              maxWidth: "100%",
              maxHeight: "100%",
              objectFit: "contain",
              borderRadius: 10,
              border: "1px solid rgba(201,162,76,0.2)",
              boxShadow: "0 4px 32px rgba(0,0,0,0.5)",
              transform: `translate(${origin.x}px, ${origin.y}px) scale(${scale})`,
              transformOrigin: "center center",
              transition: isDraggingRef.current ? "none" : "transform 120ms ease-out",
              willChange: "transform",
            }}
          />
        ) : (
          <div
            style={{
              display: "flex",
              flexDirection: "column",
              alignItems: "center",
              gap: 8,
              color: "var(--atlas-muted)",
            }}
          >
            <svg width="32" height="32" viewBox="0 0 32 32" fill="none" aria-hidden>
              <rect x="2" y="2" width="28" height="28" rx="4" stroke="currentColor" strokeWidth="1.5" strokeDasharray="4 3" />
              <circle cx="11" cy="12" r="3" stroke="currentColor" strokeWidth="1.5" />
              <path d="M2 22l8-8 6 6 4-5 10 9" stroke="currentColor" strokeWidth="1.5" strokeLinejoin="round" />
            </svg>
            <span style={{ fontSize: 12, fontFamily: "var(--app-font-mono)", letterSpacing: "0.06em" }}>
              No visual yet
            </span>
          </div>
        )}
      </div>

      {/* Version history strip */}
      {versions.length > 1 && (
        <div
          style={{
            flexShrink: 0,
            borderTop: "1px solid var(--atlas-border)",
            padding: "8px 12px",
            overflowX: "auto",
            display: "flex",
            gap: 6,
            scrollbarWidth: "none",
          }}
        >
          {versions.map((v, i) => (
            <button
              key={v.id}
              onClick={() => onVersionSelect(v.id)}
              title={v.prompt ?? `Version ${i + 1}`}
              style={{
                flexShrink: 0,
                width: 52,
                height: 52,
                borderRadius: 7,
                overflow: "hidden",
                border: v.id === activeVersionId
                  ? "2px solid var(--atlas-gold)"
                  : "1px solid var(--atlas-border)",
                cursor: "pointer",
                background: "var(--atlas-surface)",
                padding: 0,
                opacity: v.id === activeVersionId ? 1 : 0.6,
                transition: "opacity 160ms, border-color 160ms",
                position: "relative",
              }}
            >
              <img
                src={v.dataUrl}
                alt={`v${i + 1}`}
                style={{ width: "100%", height: "100%", objectFit: "cover" }}
              />
              <div
                style={{
                  position: "absolute",
                  bottom: 1,
                  right: 3,
                  fontFamily: "var(--app-font-mono)",
                  fontSize: 7,
                  fontWeight: 700,
                  color: "rgba(255,255,255,0.7)",
                  letterSpacing: "0.04em",
                }}
              >
                v{i + 1}
              </div>
            </button>
          ))}
        </div>
      )}

      {/* Refinement input */}
      <div
        style={{
          flexShrink: 0,
          borderTop: "1px solid var(--atlas-border)",
          padding: "10px 12px",
          display: "flex",
          gap: 8,
          alignItems: "flex-end",
        }}
      >
        <textarea
          ref={textareaRef}
          value={refineInput}
          onChange={(e) => setRefineInput(e.target.value)}
          onKeyDown={handleKeyDown}
          disabled={refineLoading}
          placeholder={active ? "Refine this visual…" : "Describe what to generate…"}
          rows={2}
          style={{
            flex: 1,
            resize: "none",
            background: "var(--atlas-surface)",
            border: "1px solid var(--atlas-border)",
            borderRadius: 8,
            color: "var(--atlas-fg)",
            fontFamily: "var(--app-font-sans)",
            fontSize: 12.5,
            padding: "8px 10px",
            outline: "none",
            lineHeight: 1.5,
            opacity: refineLoading ? 0.55 : 1,
          }}
        />
        <button
          onClick={() => void handleRefine()}
          disabled={!refineInput.trim() || refineLoading}
          style={{
            width: 36,
            height: 36,
            borderRadius: 8,
            background: refineInput.trim() && !refineLoading ? "var(--atlas-ember)" : "var(--atlas-surface)",
            border: "1px solid var(--atlas-border)",
            cursor: refineInput.trim() && !refineLoading ? "pointer" : "not-allowed",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            flexShrink: 0,
            transition: "background 160ms",
          }}
        >
          {refineLoading ? (
            <svg
              width="12"
              height="12"
              viewBox="0 0 12 12"
              fill="none"
              aria-hidden
              style={{ animation: "atlas-spin 0.8s linear infinite" }}
            >
              <circle cx="6" cy="6" r="5" stroke="var(--atlas-muted)" strokeWidth="1.5" strokeDasharray="16 10" />
            </svg>
          ) : (
            <svg width="12" height="12" viewBox="0 0 12 12" fill="none" aria-hidden>
              <path d="M2 6h8M7 3l3 3-3 3" stroke="var(--atlas-fg)" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
          )}
        </button>
      </div>
    </div>
  );
}
