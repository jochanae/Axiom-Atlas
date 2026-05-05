import { useEffect, useRef, useState } from "react";

type Theme = "obsidian" | "parchment";

function readTheme(): Theme {
  try {
    const saved = localStorage.getItem("atlas-theme") as Theme | null;
    if (saved === "parchment" || saved === "obsidian") return saved;
  } catch {}
  return "obsidian";
}

function applyTheme(t: Theme) {
  if (t === "parchment") {
    document.documentElement.dataset.theme = "parchment";
  } else {
    delete document.documentElement.dataset.theme;
  }
  try { localStorage.setItem("atlas-theme", t); } catch {}
}

type Props = {
  openSignal?: number;
  onOpenProfile?: () => void;
};

export function UserMenuDropdown({ openSignal, onOpenProfile }: Props) {
  const [open, setOpen] = useState(false);
  const [theme, setTheme] = useState<Theme>(readTheme);
  const wrapRef = useRef<HTMLDivElement>(null);

  const profile = (() => {
    try { const r = localStorage.getItem("atlas-user-profile"); return r ? JSON.parse(r) : {}; } catch { return {}; }
  })();
  const name: string = profile.name || "Account";
  const photoUrl: string = profile.photoUrl || "";

  useEffect(() => {
    if (openSignal && openSignal > 0) setOpen(true);
  }, [openSignal]);

  useEffect(() => {
    if (!open) return;
    const onDocClick = (e: MouseEvent) => {
      if (wrapRef.current && !wrapRef.current.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") setOpen(false); };
    document.addEventListener("mousedown", onDocClick);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDocClick);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  const handleThemeChange = (t: Theme) => {
    setTheme(t);
    applyTheme(t);
  };

  const isObsidian = theme === "obsidian";

  return (
    <div ref={wrapRef} style={{ position: "relative" }}>
      <button
        type="button"
        onClick={() => setOpen(o => !o)}
        title="Account"
        style={{
          width: 30, height: 30, borderRadius: "50%",
          border: `1px solid ${open ? "rgba(201,162,76,0.4)" : "rgba(201,162,76,0.18)"}`,
          background: photoUrl ? "transparent" : open ? "rgba(201,162,76,0.14)" : "rgba(201,162,76,0.07)",
          display: "flex", alignItems: "center", justifyContent: "center",
          cursor: "pointer", overflow: "hidden", flexShrink: 0,
          outline: open ? "2px solid rgba(201,162,76,0.45)" : "none",
          outlineOffset: 2, transition: "all 160ms ease",
        }}
      >
        {photoUrl ? (
          <img src={photoUrl} alt="" style={{ width: "100%", height: "100%", objectFit: "cover" }} />
        ) : (
          <svg width="14" height="14" viewBox="0 0 20 20" fill="none" aria-hidden>
            <circle cx="10" cy="7.5" r="3.2" stroke="#C9A24C" strokeWidth="1.2" />
            <path d="M3 18.5c0-3.866 3.134-7 7-7s7 3.134 7 7" stroke="#C9A24C" strokeWidth="1.2" strokeLinecap="round" />
          </svg>
        )}
      </button>

      {open && (
        <div
          role="menu"
          style={{
            position: "absolute", top: "calc(100% + 10px)", right: 0,
            width: 240,
            background: "var(--atlas-surface)",
            border: "1px solid rgba(201,162,76,0.18)",
            borderRadius: 14,
            boxShadow: "0 1px 0 rgba(255,255,255,0.04) inset, 0 24px 60px -20px rgba(0,0,0,0.7), 0 0 0 1px rgba(201,162,76,0.06)",
            padding: 6, zIndex: 80,
            animation: "atlas-menu-in 200ms cubic-bezier(.2,.8,.2,1)",
            transformOrigin: "top right",
          }}
        >
          {/* Identity header */}
          <div style={{
            padding: "10px 12px 10px",
            borderBottom: "1px solid rgba(201,162,76,0.10)",
            marginBottom: 4,
            display: "flex", alignItems: "center", gap: 10,
          }}>
            <div style={{
              width: 36, height: 36, borderRadius: "50%", overflow: "hidden", flexShrink: 0,
              background: "rgba(201,162,76,0.1)", border: "1px solid rgba(201,162,76,0.2)",
              display: "flex", alignItems: "center", justifyContent: "center",
            }}>
              {photoUrl ? (
                <img src={photoUrl} alt="" style={{ width: "100%", height: "100%", objectFit: "cover" }} />
              ) : (
                <span style={{ fontSize: 14, fontWeight: 600, color: "var(--atlas-gold)", fontFamily: "var(--app-font-mono)" }}>
                  {name[0]?.toUpperCase()}
                </span>
              )}
            </div>
            <div>
              <div style={{ fontSize: 13, fontWeight: 600, color: "var(--atlas-fg)", fontFamily: "var(--app-font-sans)", lineHeight: 1.3 }}>{name}</div>
              <div style={{ fontSize: 9.5, color: "var(--atlas-muted)", fontFamily: "var(--app-font-mono)", letterSpacing: "0.06em", textTransform: "uppercase", opacity: 0.55, marginTop: 2 }}>Local session</div>
            </div>
          </div>

          {/* Theme toggle */}
          <div style={{ padding: "6px 6px 4px" }}>
            <div style={{ padding: "0 6px 6px", fontSize: 9, fontFamily: "var(--app-font-mono)", letterSpacing: "0.1em", textTransform: "uppercase", color: "var(--atlas-muted)", opacity: 0.5 }}>
              Theme
            </div>
            <div style={{ display: "flex", gap: 6, padding: "0 2px" }}>
              <ThemeOption label="Obsidian" active={isObsidian} onClick={() => handleThemeChange("obsidian")} bg="#0C0A09" accent="#92400E" />
              <ThemeOption label="Parchment" active={!isObsidian} onClick={() => handleThemeChange("parchment")} bg="#F5F1E8" accent="#8B4513" />
            </div>
          </div>

          <div style={{ height: 1, background: "rgba(201,162,76,0.08)", margin: "6px 6px" }} />

          <MenuRow
            icon={
              <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
                <path d="M20 21v-2a4 4 0 00-4-4H8a4 4 0 00-4 4v2" />
                <circle cx="12" cy="7" r="4" />
              </svg>
            }
            label="Edit profile"
            onClick={() => { setOpen(false); onOpenProfile?.(); }}
          />
        </div>
      )}

      <style>{`
        @keyframes atlas-menu-in {
          from { transform: scale(0.94) translateY(-4px); opacity: 0; }
          to   { transform: scale(1)    translateY(0);    opacity: 1; }
        }
      `}</style>
    </div>
  );
}

/* Initialize theme on import (runs once) */
if (typeof document !== "undefined") {
  applyTheme(readTheme());
}

function ThemeOption({ label, active, onClick, bg, accent }: { label: string; active: boolean; onClick: () => void; bg: string; accent: string }) {
  return (
    <button type="button" onClick={onClick} style={{
      flex: 1, padding: "8px 6px", borderRadius: 8, border: "none",
      background: active ? "rgba(201,162,76,0.09)" : "transparent",
      outline: active ? "1.5px solid rgba(201,162,76,0.38)" : "1.5px solid transparent",
      cursor: "pointer", display: "flex", flexDirection: "column", alignItems: "center", gap: 6,
      transition: "all 160ms ease",
    }}>
      <div style={{ width: 40, height: 26, borderRadius: 6, background: bg, border: `2px solid ${accent}`, position: "relative", overflow: "hidden" }}>
        <div style={{ position: "absolute", bottom: 0, left: 0, right: 0, height: 8, background: accent, opacity: 0.55 }} />
        <div style={{ position: "absolute", top: 5, left: 6, width: "55%", height: 3, background: `${accent}99`, borderRadius: 2 }} />
      </div>
      <span style={{ fontSize: 10, fontFamily: "var(--app-font-mono)", color: active ? "var(--atlas-gold)" : "var(--atlas-muted)", letterSpacing: "0.05em", opacity: active ? 1 : 0.6 }}>
        {label}
      </span>
    </button>
  );
}

function MenuRow({ icon, label, onClick }: { icon: React.ReactNode; label: string; onClick: () => void }) {
  return (
    <button type="button" onClick={onClick}
      style={{ display: "flex", alignItems: "center", gap: 10, width: "100%", padding: "8px 10px", borderRadius: 8, border: "none", background: "transparent", cursor: "pointer", textAlign: "left" }}
      onMouseEnter={(e) => (e.currentTarget.style.background = "rgba(201,162,76,0.06)")}
      onMouseLeave={(e) => (e.currentTarget.style.background = "transparent")}
    >
      <span style={{ color: "var(--atlas-muted)", display: "flex", flexShrink: 0, opacity: 0.7 }}>{icon}</span>
      <span style={{ fontSize: 12.5, fontFamily: "var(--app-font-sans)", color: "var(--atlas-fg)" }}>{label}</span>
    </button>
  );
}
