import { useEffect, useRef, useState, useCallback } from "react";
import { createPortal } from "react-dom";
import { useAuth, useLogout } from "@/hooks/useAuth";

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

// ── Keyboard shortcuts data ──────────────────────────────────────────────────
const SHORTCUTS: Array<{ keys: string[]; label: string; section?: string }> = [
  { section: "Navigation", keys: [], label: "" },
  { keys: ["⌘", "K"], label: "Command palette / jump to project" },
  { keys: ["⌘", "⇧", "P"], label: "Open projects list" },
  { keys: ["⌘", "⇧", "L"], label: "Open decision ledger" },
  { keys: ["Esc"], label: "Close panel / cancel" },
  { section: "Chat", keys: [], label: "" },
  { keys: ["⌘", "↵"], label: "Send message" },
  { keys: ["/"], label: "Focus message input" },
  { keys: ["⌘", "⇧", "C"], label: "Clear chat" },
  { section: "Workspace", keys: [], label: "" },
  { keys: ["⌘", "D"], label: "New decision entry" },
  { keys: ["⌘", "⇧", "F"], label: "Open files panel" },
  { keys: ["⌘", "⇧", "M"], label: "Open memory panel" },
  { keys: ["⌘", "⇧", "\\"], label: "50 / 50 split view" },
  { keys: ["?"], label: "Open this shortcuts list" },
];

function ShortcutsModal({ onClose }: { onClose: () => void }) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [onClose]);

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label="Keyboard shortcuts"
      style={{
        position: "fixed", inset: 0, zIndex: 300,
        overflowY: "auto",
        WebkitOverflowScrolling: "touch" as any,
        display: "flex", alignItems: "flex-start", justifyContent: "center",
        padding: "max(env(safe-area-inset-top, 0px) + 56px, 56px) 16px 32px",
      }}
    >
      <div onClick={onClose} style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.65)", backdropFilter: "blur(5px)" }} />
      <div style={{
        position: "relative", width: "100%", maxWidth: 440,
        background: "var(--atlas-surface)", border: "1px solid rgba(201,162,76,0.18)",
        borderRadius: 16, padding: "22px 20px 24px",
        boxShadow: "0 2px 2px rgba(255,255,255,0.03) inset, 0 32px 80px -24px rgba(0,0,0,0.7), 0 0 0 1px rgba(201,162,76,0.06)",
        animation: "atlas-menu-in 200ms cubic-bezier(.2,.8,.2,1)",
      }}>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 18 }}>
          <span style={{ fontSize: 11, fontFamily: "var(--app-font-mono)", letterSpacing: "0.12em", color: "var(--atlas-gold)", opacity: 0.85, textTransform: "uppercase" }}>Keyboard Shortcuts</span>
          <button onClick={onClose} style={{ background: "transparent", border: "none", cursor: "pointer", color: "var(--atlas-muted)", padding: "2px 6px", borderRadius: 4, fontSize: 16, lineHeight: 1, opacity: 0.5 }}
            onMouseEnter={(e) => (e.currentTarget.style.opacity = "1")}
            onMouseLeave={(e) => (e.currentTarget.style.opacity = "0.5")}>✕</button>
        </div>

        {SHORTCUTS.map((s, i) => {
          if (s.section) {
            return (
              <div key={s.section + i} style={{ fontSize: 9, fontFamily: "var(--app-font-mono)", letterSpacing: "0.12em", color: "var(--atlas-muted)", opacity: 0.45, textTransform: "uppercase", marginTop: i === 0 ? 0 : 16, marginBottom: 8, paddingBottom: 5, borderBottom: "1px solid var(--atlas-border)" }}>
                {s.section}
              </div>
            );
          }
          return (
            <div key={s.label} style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "5px 0", gap: 12 }}>
              <span style={{ fontSize: 12, color: "var(--atlas-fg)", opacity: 0.72, flex: 1 }}>{s.label}</span>
              <div style={{ display: "flex", gap: 3, flexShrink: 0 }}>
                {s.keys.map((k, ki) => (
                  <kbd key={ki} style={{
                    fontFamily: "var(--app-font-mono)", fontSize: 10,
                    padding: "2px 6px", borderRadius: 5,
                    background: "rgba(201,162,76,0.07)",
                    border: "1px solid rgba(201,162,76,0.2)",
                    color: "var(--atlas-gold)", lineHeight: 1.5,
                  }}>{k}</kbd>
                ))}
              </div>
            </div>
          );
        })}

        <div style={{ marginTop: 20, paddingTop: 14, borderTop: "1px solid var(--atlas-border)", fontSize: 9.5, fontFamily: "var(--app-font-mono)", color: "var(--atlas-muted)", opacity: 0.4, letterSpacing: "0.04em" }}>
          ⌘ = Cmd on Mac · Ctrl on Windows/Linux
        </div>
      </div>
    </div>
  );
}

export function UserMenuDropdown({ openSignal, onOpenProfile }: Props) {
  const [open, setOpen] = useState(false);
  const [showShortcuts, setShowShortcuts] = useState(false);
  const [theme, setTheme] = useState<Theme>(readTheme);
  const wrapRef = useRef<HTMLDivElement>(null);
  const btnRef = useRef<HTMLButtonElement>(null);
  const [btnRect, setBtnRect] = useState<DOMRect | null>(null);
  const { user } = useAuth();
  const logout = useLogout();

  const name: string = user?.name || user?.email?.split("@")[0] || "Account";
  const email: string = user?.email || "";
  const photoUrl: string = user?.avatarUrl || "";

  const openShortcuts = useCallback(() => {
    setOpen(false);
    setShowShortcuts(true);
  }, []);

  // Global "?" key opens shortcuts when not typing in an input
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "?" && !(e.target instanceof HTMLInputElement) && !(e.target instanceof HTMLTextAreaElement)) {
        e.preventDefault();
        setShowShortcuts(true);
      }
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, []);

  useEffect(() => {
    if (openSignal && openSignal > 0) setOpen(true);
  }, [openSignal]);

  useEffect(() => {
    if (!open) return;
    // Capture button position for portal placement
    if (btnRef.current) setBtnRect(btnRef.current.getBoundingClientRect());
    const onDocClick = (e: MouseEvent) => {
      const target = e.target as Node;
      const insideBtn = btnRef.current?.contains(target);
      const insideMenu = (document.getElementById("atlas-user-menu-portal"))?.contains(target);
      if (!insideBtn && !insideMenu) setOpen(false);
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

  const isParchment = theme === "parchment";

  return (
    <>
    {showShortcuts && <ShortcutsModal onClose={() => setShowShortcuts(false)} />}
    <div ref={wrapRef} style={{ position: "relative" }}>
      <button
        ref={btnRef}
        type="button"
        onClick={() => setOpen(o => !o)}
        title="Account"
        style={{
          width: 36, height: 36, borderRadius: "22%",
          border: `1.5px solid ${open ? "#D4AF37" : "rgba(212,175,55,0.75)"}`,
          background: photoUrl ? "transparent" : "#0D0B09",
          display: "flex", alignItems: "center", justifyContent: "center",
          cursor: "pointer", overflow: "hidden", flexShrink: 0,
          transition: "all 160ms ease", padding: 0,
          position: "relative", zIndex: 2,
        }}
        onMouseEnter={(e) => { e.currentTarget.style.borderColor = "#D4AF37"; }}
        onMouseLeave={(e) => { e.currentTarget.style.borderColor = open ? "#D4AF37" : "rgba(212,175,55,0.75)"; }}
      >
        {photoUrl ? (
          <img src={photoUrl} alt="" style={{ width: "100%", height: "100%", objectFit: "cover", borderRadius: "20%" }} />
        ) : (
          <svg width="15" height="15" viewBox="0 0 20 20" fill="none" aria-hidden>
            <circle cx="10" cy="7.5" r="3.2" stroke="#C9A24C" strokeWidth="1.2" />
            <path d="M3 18.5c0-3.866 3.134-7 7-7s7 3.134 7 7" stroke="#C9A24C" strokeWidth="1.2" strokeLinecap="round" />
          </svg>
        )}
      </button>

      <style>{`
        @keyframes atlas-menu-in {
          from { transform: scale(0.94) translateY(-4px); opacity: 0; }
          to   { transform: scale(1)    translateY(0);    opacity: 1; }
        }
      `}</style>
    </div>

    {open && btnRect && createPortal(
      <div
        id="atlas-user-menu-portal"
        role="menu"
        style={{
          position: "fixed",
          top: btnRect.bottom + 10,
          right: Math.max(8, window.innerWidth - btnRect.right),
          width: 248,
          background: "var(--atlas-surface)",
          border: "1px solid rgba(201,162,76,0.18)",
          borderRadius: 14,
          boxShadow: "0 1px 0 rgba(255,255,255,0.04) inset, 0 24px 60px -20px rgba(0,0,0,0.5), 0 0 0 1px rgba(201,162,76,0.06)",
          padding: 6,
          zIndex: 9999,
          animation: "atlas-menu-in 200ms cubic-bezier(.2,.8,.2,1)",
          transformOrigin: "top right",
        }}
      >
        {/* Identity header */}
        <div style={{
          padding: "12px 12px 12px",
          borderBottom: "1px solid rgba(201,162,76,0.10)",
          marginBottom: 4,
          display: "flex", alignItems: "center", gap: 10,
        }}>
          <div style={{
            width: 38, height: 38, borderRadius: "50%", overflow: "hidden", flexShrink: 0,
            background: "rgba(201,162,76,0.1)", border: "1px solid rgba(201,162,76,0.2)",
            display: "flex", alignItems: "center", justifyContent: "center",
          }}>
            {photoUrl ? (
              <img src={photoUrl} alt="" style={{ width: "100%", height: "100%", objectFit: "cover" }} />
            ) : (
              <span style={{ fontSize: 15, fontWeight: 600, color: "var(--atlas-gold)", fontFamily: "var(--app-font-mono)" }}>
                {name[0]?.toUpperCase()}
              </span>
            )}
          </div>
          <div style={{ minWidth: 0, flex: 1 }}>
            <div style={{ fontSize: 13, fontWeight: 600, color: "var(--atlas-fg)", lineHeight: 1.25, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{name}</div>
            <div style={{ fontSize: 10.5, color: "var(--atlas-muted)", marginTop: 2, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", opacity: 0.7 }}>{email}</div>
          </div>
        </div>

        {/* Appearance toggle */}
        <div style={{ display: "flex", alignItems: "center", padding: "6px 10px", gap: 9 }}>
          <span style={{ color: "var(--atlas-muted)", display: "flex", flexShrink: 0, opacity: 0.8 }}>
            {isParchment ? <SunIcon /> : <MoonIcon />}
          </span>
          <span style={{ flex: 1, fontSize: 12.5, color: "var(--atlas-fg)" }}>Appearance</span>
          <button
            type="button"
            onClick={() => handleThemeChange(isParchment ? "obsidian" : "parchment")}
            aria-label={isParchment ? "Switch to Obsidian" : "Switch to Parchment"}
            style={{
              width: 44, height: 24, borderRadius: 12, flexShrink: 0,
              background: isParchment ? "rgba(201,162,76,0.22)" : "rgba(60,50,40,0.55)",
              border: "1px solid rgba(201,162,76,0.28)",
              cursor: "pointer", position: "relative",
              transition: "background 220ms ease", padding: 0,
            }}
          >
            <div style={{
              position: "absolute", top: 3,
              left: isParchment ? 23 : 3,
              width: 16, height: 16, borderRadius: "50%",
              background: isParchment ? "var(--atlas-gold)" : "rgba(201,162,76,0.45)",
              transition: "left 220ms ease, background 220ms ease",
              boxShadow: isParchment ? "0 0 6px rgba(201,162,76,0.4)" : "none",
            }} />
          </button>
        </div>

        {/* Shortcuts */}
        <MenuRow icon={<KeyboardIcon />} label="Shortcuts" onClick={openShortcuts} />

        <div style={{ height: 1, background: "rgba(201,162,76,0.08)", margin: "4px 6px" }} />

        {/* Edit profile */}
        <MenuRow icon={<UserIcon />} label="Edit profile" onClick={() => { setOpen(false); onOpenProfile?.(); }} />

        {/* Sign out */}
        <MenuRow icon={<SignOutIcon />} label="Sign out" danger onClick={() => { setOpen(false); void logout(); }} />
      </div>,
      document.body
    )}
    </>
  );
}

/* Initialize theme on import (runs once) */
if (typeof document !== "undefined") {
  applyTheme(readTheme());
}

function MenuRow({ icon, label, badge, danger, disabled, onClick }: {
  icon: React.ReactNode; label: string; badge?: string; danger?: boolean; disabled?: boolean; onClick: () => void;
}) {
  return (
    <button type="button" onClick={disabled ? undefined : onClick} disabled={disabled} title={disabled ? "Coming soon" : undefined}
      style={{ display: "flex", alignItems: "center", gap: 9, width: "100%", padding: "8px 10px", borderRadius: 8, border: "none", background: "transparent", cursor: disabled ? "not-allowed" : "pointer", opacity: disabled ? 0.5 : 1, textAlign: "left" }}
      onMouseEnter={(e) => { if (!disabled) e.currentTarget.style.background = danger ? "rgba(239,68,68,0.06)" : "rgba(201,162,76,0.06)"; }}
      onMouseLeave={(e) => (e.currentTarget.style.background = "transparent")}
    >
      <span style={{ color: danger ? "rgba(239,68,68,0.6)" : "var(--atlas-muted)", display: "flex", flexShrink: 0, opacity: 0.8 }}>{icon}</span>
      <span style={{ flex: 1, fontSize: 12.5, color: danger ? "rgba(239,68,68,0.9)" : "var(--atlas-fg)" }}>{label}</span>
      {badge && (
        <span style={{ fontSize: 10, fontFamily: "var(--app-font-mono)", color: "var(--atlas-muted)", opacity: 0.55, letterSpacing: "0.03em", flexShrink: 0 }}>{badge}</span>
      )}
    </button>
  );
}

function MoonIcon() {
  return (
    <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
      <path d="M21 12.79A9 9 0 1111.21 3 7 7 0 0021 12.79z" />
    </svg>
  );
}

function SunIcon() {
  return (
    <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="12" cy="12" r="5" />
      <line x1="12" y1="1" x2="12" y2="3" />
      <line x1="12" y1="21" x2="12" y2="23" />
      <line x1="4.22" y1="4.22" x2="5.64" y2="5.64" />
      <line x1="18.36" y1="18.36" x2="19.78" y2="19.78" />
      <line x1="1" y1="12" x2="3" y2="12" />
      <line x1="21" y1="12" x2="23" y2="12" />
      <line x1="4.22" y1="19.78" x2="5.64" y2="18.36" />
      <line x1="18.36" y1="5.64" x2="19.78" y2="4.22" />
    </svg>
  );
}

function KeyboardIcon() {
  return (
    <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
      <rect x="2" y="6" width="20" height="12" rx="2" />
      <path d="M6 10h.01M10 10h.01M14 10h.01M18 10h.01M8 14h8" />
    </svg>
  );
}

function UserIcon() {
  return (
    <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
      <path d="M20 21v-2a4 4 0 00-4-4H8a4 4 0 00-4 4v2" />
      <circle cx="12" cy="7" r="4" />
    </svg>
  );
}

function SignOutIcon() {
  return (
    <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
      <path d="M9 21H5a2 2 0 01-2-2V5a2 2 0 012-2h4" />
      <polyline points="16 17 21 12 16 7" />
      <line x1="21" y1="12" x2="9" y2="12" />
    </svg>
  );
}
