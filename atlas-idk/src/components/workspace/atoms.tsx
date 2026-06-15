import type React from "react";

const MODE_LABEL_COLORS: Record<string, string> = {
  THINK: "rgba(147,197,253,0.55)",
  PLAN:  "rgba(var(--atlas-gold-rgb),0.38)",
  BUILD: "rgba(74,222,128,0.45)",
};

// ── MenuBtn — reusable dropdown menu item ─────────────────────────────────────
function MenuBtn({ icon, label, onClick, badge, disabled, style }: { icon: React.ReactNode; label: string; onClick?: () => void; badge?: string; disabled?: boolean; style?: React.CSSProperties }) {
  return (
    <button
      onClick={disabled ? undefined : onClick}
      disabled={disabled}
      title={disabled ? "Coming soon" : undefined}
      style={{ display: "flex", alignItems: "center", gap: 10, width: "100%", background: "transparent", border: "none", padding: "9px 12px", borderRadius: 7, cursor: disabled ? "not-allowed" : "pointer", color: "var(--atlas-fg)", opacity: disabled ? 0.45 : 1, fontSize: "var(--ts-body)", textAlign: "left", ...style }}
      onMouseEnter={(e) => { if (!disabled) e.currentTarget.style.background = "color-mix(in oklab, var(--atlas-fg) 8%, transparent)"; }}
      onMouseLeave={(e) => { e.currentTarget.style.background = "transparent"; }}
    >
      <span style={{ color: "var(--atlas-muted)", display: "flex", flexShrink: 0, opacity: 0.7 }}>{icon}</span>
      <span style={{ flex: 1 }}>{label}</span>
      {badge && (
        <span style={{ fontSize: "var(--ts-xs)", fontFamily: "var(--app-font-mono)", color: "var(--atlas-muted)", opacity: 0.6, letterSpacing: "0.1em", flexShrink: 0 }}>{badge}</span>
      )}
    </button>
  );
}

// ── AtlasLogo ────────────────────────────────────────────────────────────────
function AtlasLogo({ small, mode }: { small?: boolean; mode?: "THINK" | "PLAN" | "BUILD" }) {
  const imgSize = small ? 22 : 26;
  const modeLabel = mode ? `${mode} MODE` : null;
  const modeColor = mode ? (MODE_LABEL_COLORS[mode] ?? "var(--atlas-muted)") : "var(--atlas-muted)";
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
      <img
        src="/axiom-logo.svg"
        alt="Axiom"
        width={imgSize}
        height={imgSize}
        style={{ borderRadius: "20%", flexShrink: 0 }}
      />
      <div style={{ display: "flex", flexDirection: "column", gap: 1.5, lineHeight: 1 }}>
        <span style={{
          fontFamily: "'IBM Plex Mono', var(--app-font-mono)",
          fontSize: small ? 10 : 11,
          fontWeight: 700,
          letterSpacing: "0.18em",
          color: "var(--atlas-gold)",
          textTransform: "uppercase",
        }}>
          AXIOM
        </span>
        {modeLabel && (
          <span style={{
            fontFamily: "'IBM Plex Mono', var(--app-font-mono)",
            fontSize: "var(--ts-tiny)",
            fontWeight: 500,
            letterSpacing: "0.14em",
            color: modeColor,
            textTransform: "uppercase",
            transition: "color 300ms ease",
          }}>
            {modeLabel}
          </span>
        )}
      </div>
    </div>
  );
}

function FileIcon({ ext }: { ext?: string }) {
  const color =
    ext === "md" ? "#C9A24C"
    : ext === "ts" || ext === "tsx" ? "#60a5fa"
    : ext === "js" || ext === "jsx" ? "#fbbf24"
    : ext === "css" ? "#a78bfa"
    : ext === "json" ? "#34d399"
    : "rgba(var(--atlas-muted-rgb),0.7)";
  return (
    <svg width="12" height="12" viewBox="0 0 16 16" fill="none" style={{ flexShrink: 0 }}>
      <path d="M3 2h7l3 3v9a1 1 0 01-1 1H3a1 1 0 01-1-1V3a1 1 0 011-1z" stroke={color} strokeWidth="1.1" />
      <path d="M10 2v3h3" stroke={color} strokeWidth="1.1" strokeLinejoin="round" />
    </svg>
  );
}

function FolderIcon({ open }: { open?: boolean }) {
  return (
    <svg width="12" height="12" viewBox="0 0 16 16" fill="none" style={{ flexShrink: 0 }}>
      <path
        d="M1 4h5l1.5 1.5H15v8H1V4z"
        stroke={open ? "rgba(201,162,76,0.7)" : "rgba(201,162,76,0.45)"}
        strokeWidth="1.1"
        fill={open ? "rgba(201,162,76,0.07)" : "none"}
      />
    </svg>
  );
}

export { MenuBtn, AtlasLogo, FileIcon, FolderIcon };
