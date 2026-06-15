export function GenesisCard({ projectName, timestamp }: { projectName: string; timestamp: string }) {
  return (
    <div style={{
      position: "relative",
      borderRadius: 14,
      border: "1px solid rgba(201,162,76,0.18)",
      background: "color-mix(in oklab, var(--atlas-surface) 92%, transparent)",
      backdropFilter: "blur(16px)",
      padding: "18px 20px",
      overflow: "hidden",
      margin: "12px 0",
    }}>
      <div aria-hidden style={{
        position: "absolute", top: 0, left: 0, right: 0, height: 2,
        background: "linear-gradient(90deg, rgba(212,175,55,0.7), rgba(245,222,138,0.15))",
      }} />
      <div style={{
        fontFamily: "var(--app-font-mono)", fontSize: 10, fontWeight: 700,
        letterSpacing: "0.18em", textTransform: "uppercase", color: "var(--atlas-gold)",
        marginBottom: 6, display: "flex", alignItems: "center", gap: 6,
      }}>
        <span aria-hidden>✦</span> PROJECT INITIALIZED · {timestamp}
      </div>
      <div style={{
        fontFamily: "var(--app-font-sans)", fontSize: 17, fontWeight: 600,
        color: "var(--atlas-fg)", marginBottom: 4,
      }}>
        {projectName}
      </div>
      <div style={{ fontSize: 13, color: "var(--atlas-muted)" }}>
        This conversation became the starting point. Continuing in the project workspace.
      </div>
    </div>
  );
}
