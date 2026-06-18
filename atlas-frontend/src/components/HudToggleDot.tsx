import { setHudDocked, useHudDocked } from "@/lib/hudBus";

/**
 * Pass 4 — Universal Live Extraction recall.
 * Purple-dot trigger pinned beside the project dropdown / conversation title
 * so the user can toggle the Listening HUD on/off from any surface (home or
 * workspace). When docked === true the floating HUD pill hides; tapping the
 * dot un-docks it (or vice-versa).
 */
export function HudToggleDot() {
  const docked = useHudDocked();
  const active = !docked; // HUD visible == active

  return (
    <button
      type="button"
      onClick={() => setHudDocked(!docked)}
      title={active ? "Hide Live Extraction" : "Show Live Extraction"}
      aria-label={active ? "Hide Live Extraction panel" : "Show Live Extraction panel"}
      aria-pressed={active}
      style={{
        position: "relative",
        display: "inline-flex",
        alignItems: "center",
        justifyContent: "center",
        flexShrink: 0,
        width: 18,
        height: 18,
        marginLeft: 4,
        padding: 0,
        background: "transparent",
        border: "none",
        cursor: "pointer",
        WebkitTapHighlightColor: "transparent",
        opacity: active ? 1 : 0.55,
        transition: "opacity 160ms ease, transform 160ms ease",
      }}
      onMouseEnter={(e) => { e.currentTarget.style.transform = "scale(1.15)"; }}
      onMouseLeave={(e) => { e.currentTarget.style.transform = "scale(1)"; }}
    >
      <span style={{ position: "relative", display: "inline-flex", width: 8, height: 8 }}>
        {active && (
          <span
            aria-hidden
            style={{
              position: "absolute",
              inset: 0,
              borderRadius: 999,
              background: "rgb(167,139,250)",
              opacity: 0.55,
              animation: "atlas-hud-dot-ping 1.6s cubic-bezier(0,0,0.2,1) infinite",
            }}
          />
        )}
        <span
          aria-hidden
          style={{
            position: "relative",
            display: "inline-block",
            width: 8,
            height: 8,
            borderRadius: 999,
            background: active ? "rgb(139,92,246)" : "rgba(139,92,246,0.45)",
            boxShadow: active ? "0 0 8px rgba(139,92,246,0.6)" : "none",
          }}
        />
      </span>
      <style>{`
        @keyframes atlas-hud-dot-ping {
          0% { transform: scale(1); opacity: 0.6; }
          75%, 100% { transform: scale(2.2); opacity: 0; }
        }
      `}</style>
    </button>
  );
}

export default HudToggleDot;
