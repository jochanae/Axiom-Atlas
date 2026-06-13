export function StatusToggle({ deepWork, onToggle }: { deepWork: boolean; onToggle: () => void }) {
  return (
    <button
      onClick={onToggle}
      style={{
        display: "flex",
        alignItems: "center",
        gap: 6,
        padding: "6px 14px",
        borderRadius: 20,
        background: deepWork ? "rgba(80,30,5,0.55)" : "var(--atlas-surface)",
        border: `1px solid ${deepWork ? "rgba(201,162,76,0.5)" : "rgba(255,255,255,0.07)"}`,
        backdropFilter: "blur(10px)",
        cursor: "pointer",
        transition: "all 600ms ease",
        flexShrink: 0,
      }}
    >
      <div
        style={{
          width: 6,
          height: 6,
          borderRadius: "50%",
          background: deepWork ? "#C9A24C" : "#4ade80",
          boxShadow: deepWork ? "0 0 7px rgba(201,162,76,0.65)" : "0 0 7px rgba(74,222,128,0.55)",
          transition: "background 600ms ease, box-shadow 600ms ease",
          flexShrink: 0,
        }}
      />
      <span
        style={{
          fontFamily: "var(--app-font-mono)",
          fontSize: 9,
          letterSpacing: "0.12em",
          textTransform: "uppercase",
          color: deepWork ? "#C9A24C" : "rgba(74,222,128,0.85)",
          transition: "color 600ms ease",
          whiteSpace: "nowrap",
        }}
      >
        {deepWork ? "Deep Work · On" : "Focus · Active"}
      </span>
    </button>
  );
}
