import { useLayoutEffect, useRef, useState, type CSSProperties, type ReactNode } from "react";

/**
 * CollapsibleMessageText
 *
 * Wraps long user-message content with a true alpha-mask fade + "Show more"/"Show less" link.
 * Uses CSS `mask-image` so the text itself fades to transparent at the bottom — works
 * over any background (translucent bubbles included), no hard cutoff.
 */
export function CollapsibleMessageText({
  children,
  maxCollapsedPx = 168, // ~7 lines at 24px line-height
  fadeFromColor: _fadeFromColor,
  textStyle,
}: {
  children: ReactNode;
  maxCollapsedPx?: number;
  /** @deprecated kept for back-compat; mask-based fade no longer needs a color */
  fadeFromColor?: string;
  textStyle?: CSSProperties;
}) {
  void _fadeFromColor;
  const ref = useRef<HTMLDivElement>(null);
  const [overflows, setOverflows] = useState(false);
  const [expanded, setExpanded] = useState(false);

  useLayoutEffect(() => {
    if (!ref.current) return;
    const sh = ref.current.scrollHeight;
    setOverflows(sh > maxCollapsedPx + 4);
  }, [children, maxCollapsedPx]);

  const collapsed = overflows && !expanded;
  const fadeMask = collapsed
    ? "linear-gradient(to bottom, #000 0%, #000 55%, rgba(0,0,0,0.6) 80%, rgba(0,0,0,0) 100%)"
    : undefined;

  return (
    <div style={{ width: "100%" }}>
      <div
        style={{
          maxHeight: expanded || !overflows ? "none" : maxCollapsedPx,
          overflow: "hidden",
          WebkitMaskImage: fadeMask,
          maskImage: fadeMask,
          WebkitMaskRepeat: "no-repeat",
          maskRepeat: "no-repeat",
          WebkitMaskSize: "100% 100%",
          maskSize: "100% 100%",
          transition: "max-height 200ms ease",
        }}
      >
        <div ref={ref} style={textStyle}>
          {children}
        </div>
      </div>
      {overflows && (
        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation();
            setExpanded((v) => !v);
          }}
          style={{
            marginTop: 6,
            background: "transparent",
            border: "none",
            padding: 0,
            cursor: "pointer",
            fontFamily: "var(--app-font-sans)",
            fontSize: 13,
            color: "var(--atlas-muted)",
            opacity: 0.75,
            textAlign: "left",
          }}
        >
          {expanded ? "Show less" : "Show more"}
        </button>
      )}
    </div>
  );
}
