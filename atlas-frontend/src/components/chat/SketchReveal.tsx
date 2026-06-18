import { useState, useCallback, useEffect } from "react";
import { motion, AnimatePresence } from "framer-motion";

/**
 * Sketch reveal card — shimmer placeholder while loading,
 * then smooth opacity fade-in of the generated image.
 *
 * Used inline in chat bubbles after the backend returns `imageGen.images[0].imageUrl`.
 * If `src` is missing (still streaming), shows shimmer with a "Sketching…" caption.
 */
interface SketchRevealProps {
  src?: string | null;
  alt?: string;
  caption?: string | null;
  /** When true, force the shimmer state regardless of src */
  loading?: boolean;
  /** Optional aspect ratio for the shimmer placeholder (default 16/10) */
  aspectRatio?: number;
  className?: string;
  style?: React.CSSProperties;
}

const SHIMMER_KEYFRAMES_ID = "atlas-sketch-shimmer-keyframes";

function ensureKeyframes() {
  if (typeof document === "undefined") return;
  if (document.getElementById(SHIMMER_KEYFRAMES_ID)) return;
  const style = document.createElement("style");
  style.id = SHIMMER_KEYFRAMES_ID;
  style.textContent = `
@keyframes atlas-sketch-shimmer {
  0% { background-position: -200% 0; }
  100% { background-position: 200% 0; }
}
@keyframes atlas-sketch-pulse {
  0%, 100% { opacity: 0.55; }
  50% { opacity: 0.9; }
}
`;
  document.head.appendChild(style);
}

export default function SketchReveal({
  src,
  alt = "Concept sketch",
  caption,
  loading,
  aspectRatio = 16 / 10,
  className,
  style,
}: SketchRevealProps) {
  const [loaded, setLoaded] = useState(false);
  const [errored, setErrored] = useState(false);

  useEffect(() => {
    ensureKeyframes();
  }, []);

  useEffect(() => {
    setLoaded(false);
    setErrored(false);
  }, [src]);

  const handleLoad = useCallback(() => setLoaded(true), []);
  const handleError = useCallback(() => setErrored(true), []);

  const showShimmer = loading || !src || (!loaded && !errored);

  return (
    <div
      className={className}
      style={{
        marginTop: 12,
        borderRadius: 12,
        overflow: "hidden",
        border: "1px solid color-mix(in oklab, var(--atlas-gold, #c9a24c) 22%, transparent)",
        background: "color-mix(in oklab, var(--atlas-gold, #c9a24c) 4%, transparent)",
        ...style,
      }}
    >
      <div style={{ position: "relative", width: "100%", aspectRatio: String(aspectRatio) }}>
        {/* Shimmer placeholder */}
        <AnimatePresence>
          {showShimmer && (
            <motion.div
              key="shimmer"
              initial={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              transition={{ duration: 0.4, ease: "easeOut" }}
              aria-hidden
              style={{
                position: "absolute",
                inset: 0,
                background:
                  "linear-gradient(110deg, color-mix(in oklab, var(--atlas-gold, #c9a24c) 10%, transparent) 30%, color-mix(in oklab, var(--atlas-gold, #c9a24c) 28%, transparent) 50%, color-mix(in oklab, var(--atlas-gold, #c9a24c) 10%, transparent) 70%)",
                backgroundSize: "200% 100%",
                animation: "atlas-sketch-shimmer 1.6s ease-in-out infinite",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
              }}
            >
              <span
                style={{
                  fontFamily: "var(--app-font-mono)",
                  fontSize: 10,
                  letterSpacing: "0.18em",
                  textTransform: "uppercase",
                  color: "var(--atlas-gold, #c9a24c)",
                  animation: "atlas-sketch-pulse 1.8s ease-in-out infinite",
                }}
              >
                Sketching…
              </span>
            </motion.div>
          )}
        </AnimatePresence>

        {/* Hidden loader to fire onLoad while shimmer is up */}
        {src && !loaded && !errored && (
          <img
            src={src}
            alt=""
            aria-hidden
            onLoad={handleLoad}
            onError={handleError}
            style={{ position: "absolute", width: 1, height: 1, opacity: 0, pointerEvents: "none" }}
          />
        )}

        {/* Revealed image */}
        {src && loaded && !errored && (
          <>
            <motion.img
              src={src}
              alt={alt}
              initial={{ opacity: 0, scale: 1.02 }}
              animate={{ opacity: 1, scale: 1 }}
              transition={{ duration: 0.55, ease: [0.22, 1, 0.36, 1] }}
              style={{
                position: "absolute",
                inset: 0,
                width: "100%",
                height: "100%",
                objectFit: "cover",
                display: "block",
              }}
            />
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                const a = document.createElement("a");
                a.href = src;
                a.download = `${(alt || "sketch").replace(/\s+/g, "-").toLowerCase()}.png`;
                a.click();
              }}
              aria-label="Download sketch"
              title="Download sketch"
              style={{
                position: "absolute",
                bottom: 8,
                right: 8,
                width: 28,
                height: 28,
                borderRadius: 999,
                background: "rgba(0,0,0,0.55)",
                border: "1px solid color-mix(in oklab, var(--atlas-gold, #c9a24c) 40%, transparent)",
                color: "var(--atlas-gold, #c9a24c)",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                cursor: "pointer",
                backdropFilter: "blur(4px)",
                padding: 0,
              }}
            >
              <svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
                <path d="M8 2v9M4.5 7.5L8 11l3.5-3.5M3 13.5h10" />
              </svg>
            </button>
          </>
        )}


        {errored && (
          <div
            style={{
              position: "absolute",
              inset: 0,
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              fontSize: 11,
              color: "var(--atlas-muted, #888)",
              fontFamily: "var(--app-font-mono)",
            }}
          >
            Couldn't load sketch
          </div>
        )}
      </div>

      {caption && (
        <div
          style={{
            padding: "8px 12px",
            background: "color-mix(in oklab, var(--atlas-gold, #c9a24c) 4%, transparent)",
            fontSize: 11,
            color: "var(--atlas-muted, #888)",
            fontFamily: "var(--app-font-mono)",
            letterSpacing: "0.08em",
          }}
        >
          {caption}
        </div>
      )}
    </div>
  );
}
