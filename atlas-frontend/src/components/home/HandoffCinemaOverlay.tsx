import { useEffect } from "react";
import { createPortal } from "react-dom";
import { useShellStore } from "@/store/shellStore";

/**
 * HandoffCinemaOverlay — the "camera lens focusing" effect during the
 * shaping → workspace transition.
 *
 * Renders fullscreen when shellStore.shapingStatus === "transitioning":
 *   • Dims and blurs the page contents behind it (background freeze).
 *   • Traces a thin gold border around the viewport edges (vignette focus).
 *   • Locks body scroll so the freeze actually feels frozen.
 *
 * The CommitPill itself sits at zIndex 90 with its own border-trace; this
 * overlay sits at zIndex 80, behind the pill but above page content. Together
 * they form the cinematic moment: the world dims, the door glows, you walk
 * through.
 */
export function HandoffCinemaOverlay() {
  const status = useShellStore((s) => s.shapingStatus);
  const title = useShellStore((s) => s.pendingWorkspaceTitle);
  const active = status === "transitioning";

  useEffect(() => {
    if (!active) return;
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = prev;
    };
  }, [active]);

  if (!active) return null;

  return createPortal(
    <div
      aria-hidden="true"
      style={{
        position: "fixed",
        inset: 0,
        zIndex: 80,
        pointerEvents: "none",
        animation: "atlas-cinema-in 220ms ease-out both",
      }}
    >
      {/* Dim + radial focus toward the pill (bottom-center). */}
      <div
        style={{
          position: "absolute",
          inset: 0,
          background:
            "radial-gradient(ellipse at 50% calc(100% - 140px), rgba(0,0,0,0.25) 0%, rgba(0,0,0,0.55) 55%, rgba(0,0,0,0.72) 100%)",
          backdropFilter: "blur(2.5px)",
          WebkitBackdropFilter: "blur(2.5px)",
        }}
      />

      {/* Gold vignette trace around viewport edges. */}
      <svg
        style={{ position: "absolute", inset: 0, width: "100%", height: "100%" }}
        preserveAspectRatio="none"
        viewBox="0 0 100 100"
      >
        <rect
          x="0.4"
          y="0.4"
          width="99.2"
          height="99.2"
          rx="1.2"
          ry="1.2"
          fill="none"
          stroke="rgba(201,162,76,0.55)"
          strokeWidth="0.25"
          pathLength={1}
          strokeDasharray={1}
          strokeDashoffset={0}
          style={{
            filter: "drop-shadow(0 0 4px rgba(201,162,76,0.45))",
            animation: "atlas-cinema-trace 1.4s ease-in-out both",
          }}
        />
      </svg>

      {/* Quiet caption above the pill area. */}
      <div
        style={{
          position: "absolute",
          left: 0,
          right: 0,
          bottom: "calc(env(safe-area-inset-bottom, 0px) + 168px)",
          display: "flex",
          justifyContent: "center",
          fontFamily: "var(--app-font-mono)",
          fontSize: 10,
          letterSpacing: "0.18em",
          textTransform: "uppercase",
          color: "rgba(201,162,76,0.7)",
          animation: "atlas-cinema-caption 600ms ease-out 120ms both",
        }}
      >
        Focusing on {title?.trim() || "your workspace"}
      </div>

      <style>{`
        @keyframes atlas-cinema-in {
          from { opacity: 0; }
          to   { opacity: 1; }
        }
        @keyframes atlas-cinema-trace {
          from { stroke-dashoffset: 1; opacity: 0.2; }
          60%  { opacity: 1; }
          to   { stroke-dashoffset: 0; opacity: 0.85; }
        }
        @keyframes atlas-cinema-caption {
          from { opacity: 0; transform: translateY(6px); }
          to   { opacity: 1; transform: translateY(0); }
        }
      `}</style>
    </div>,
    document.body
  );
}
