type AuditState = "healthy" | "warning";

export function FooterAuditLine({ state = "healthy" }: { state?: AuditState }) {
  const color = state === "warning" ? "var(--warning)" : "var(--phosphor)";
  return (
    <div
      style={{
        position: "fixed",
        bottom: 0,
        left: 0,
        right: 0,
        height: 2,
        zIndex: 50,
        background: color,
        transition: "background 300ms",
        pointerEvents: "none",
      }}
      aria-hidden
    />
  );
}
