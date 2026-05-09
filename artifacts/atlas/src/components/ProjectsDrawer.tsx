import { useEffect, useState } from "react";
import { useLocation } from "wouter";
import { Plus, X, ChevronDown, ChevronRight, MessageSquare, BookOpen, Inbox, Feather, Hammer, Compass, ShieldCheck, Archive } from "lucide-react";

export type DrawerProject = {
  id: number;
  name: string;
  description?: string | null;
};

type Props = {
  open: boolean;
  onClose: () => void;
  projects: DrawerProject[];
  activeProjectId?: number | null;
  onOpenProject: (id: number) => void;
  onNewProject: () => void;
  onOpenLedger?: (id: number) => void;
  onOpenParking?: () => void;
  userLabel?: string | null;
};

export function ProjectsDrawer({ open, onClose, projects, activeProjectId, onOpenProject, onNewProject, onOpenLedger, onOpenParking, userLabel }: Props) {
  const [, setLocation] = useLocation();
  const [projectsExpanded, setProjectsExpanded] = useState(true);
  const [sessionsExpanded, setSessionsExpanded] = useState(false);
  const userPhoto: string = (() => {
    try { const r = localStorage.getItem("atlas-user-profile"); return r ? (JSON.parse(r).photoUrl ?? "") : ""; } catch { return ""; }
  })();

  const navigate = (path: string) => { setLocation(path); onClose(); };

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  if (!open) return null;

  const visible = projects.slice(0, 6);
  const hasMore = projects.length > visible.length;

  return (
    <>
      {/* Scrim */}
      <div onClick={onClose} style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.48)", backdropFilter: "blur(3px)", zIndex: 90 }} />

      {/* Panel */}
      <aside
        role="dialog"
        aria-label="Menu"
        className="atlas-side-drawer"
        style={{
          position: "fixed", top: 0, left: 0,
          width: "min(88vw, 300px)",
          height: "100dvh",
          background: "var(--atlas-surface)",
          borderRight: "1px solid var(--atlas-gold-border)",
          boxShadow: "8px 0 40px -8px rgba(0,0,0,0.6)",
          zIndex: 91,
          display: "flex", flexDirection: "column",
          animation: "atlas-drawer-in 220ms cubic-bezier(.2,.8,.2,1)",
          maxHeight: "100dvh",
          overflowY: "hidden",
          overscrollBehavior: "contain",
        }}
      >
        {/* Header */}
        <header style={{
          display: "flex", alignItems: "center", justifyContent: "space-between",
          padding: "14px 14px 14px 16px",
          borderBottom: "1px solid var(--atlas-gold-border)",
          flexShrink: 0,
        }}>
          <div style={{ display: "flex", alignItems: "center", gap: 9 }}>
            <svg width="16" height="16" viewBox="0 0 20 20" fill="none" aria-hidden>
              <circle cx="10" cy="10" r="8" stroke="var(--atlas-gold)" strokeWidth="1.2" opacity="0.8" />
              <circle cx="10" cy="10" r="3" stroke="var(--atlas-gold)" strokeWidth="0.9" opacity="0.8" />
              <line x1="10" y1="2" x2="10" y2="18" stroke="var(--atlas-gold)" strokeWidth="0.7" strokeDasharray="1.8 2.4" opacity="0.6" />
              <line x1="2" y1="10" x2="18" y2="10" stroke="var(--atlas-gold)" strokeWidth="0.7" strokeDasharray="1.8 2.4" opacity="0.6" />
            </svg>
            <span style={{ fontSize: 12, fontWeight: 600, color: "var(--atlas-fg)", fontFamily: "var(--app-font-sans)", letterSpacing: "0.12em", textTransform: "uppercase", opacity: 0.85 }}>
              Axiom
            </span>
          </div>
          <button type="button" onClick={onClose} style={iconBtn}>
            <X size={15} strokeWidth={1.6} />
          </button>
        </header>

        {/* Body */}
        <div style={{ flex: 1, minHeight: 0, overflowY: "auto", WebkitOverflowScrolling: "touch", padding: "10px 8px 16px" }}>

          {/* PROJECTS section */}
          <div style={{ display: "flex", alignItems: "center", padding: "2px 4px", marginBottom: 2 }}>
            <button type="button" onClick={() => setProjectsExpanded(v => !v)} style={{
              flex: 1, display: "flex", alignItems: "center", gap: 6,
              padding: "5px 8px", borderRadius: 6, border: "none",
              background: "transparent", cursor: "pointer",
              color: "var(--atlas-gold)",
              fontSize: 10, fontWeight: 700, letterSpacing: "0.12em", textTransform: "uppercase",
              fontFamily: "var(--app-font-mono)",
            }}>
              {projectsExpanded ? <ChevronDown size={11} strokeWidth={2.2} /> : <ChevronRight size={11} strokeWidth={2.2} />}
              Projects
            </button>
            <button type="button" onClick={(e) => { e.stopPropagation(); onNewProject(); onClose(); }} aria-label="New project" style={{ ...iconBtn, width: 26, height: 26 }}>
              <Plus size={13} strokeWidth={1.8} />
            </button>
          </div>

          {projectsExpanded && (
            <div style={{ display: "flex", flexDirection: "column", gap: 1, marginBottom: 6 }}>
              {visible.length === 0 ? (
                <div style={{ padding: "8px 14px", fontSize: 12, color: "var(--atlas-muted)", fontFamily: "var(--app-font-sans)", opacity: 0.6, fontStyle: "italic" }}>No projects yet.</div>
              ) : (
                visible.map((p) => (
                  <button key={p.id} type="button" onClick={() => { onOpenProject(p.id); onClose(); }}
                    style={{
                      display: "flex", alignItems: "center", gap: 10,
                      width: "100%", padding: "7px 10px",
                      borderRadius: 8, border: "none",
                      background: p.id === activeProjectId ? "rgba(201,162,76,0.07)" : "transparent",
                      cursor: "pointer", textAlign: "left",
                      borderLeft: p.id === activeProjectId ? "2px solid rgba(201,162,76,0.5)" : "2px solid transparent",
                      transition: "all 140ms ease",
                    }}
                    onMouseEnter={(e) => { if (p.id !== activeProjectId) e.currentTarget.style.background = "rgba(201,162,76,0.04)"; }}
                    onMouseLeave={(e) => { if (p.id !== activeProjectId) e.currentTarget.style.background = "transparent"; }}
                  >
                    <div style={{
                      width: 30, height: 30, borderRadius: 7, flexShrink: 0,
                      background: `hsl(${(p.name.charCodeAt(0) * 37) % 360}, 22%, 22%)`,
                      display: "flex", alignItems: "center", justifyContent: "center",
                      fontSize: 12, fontWeight: 600, color: "var(--atlas-fg)",
                      fontFamily: "var(--app-font-mono)",
                    }}>
                      {p.name[0]?.toUpperCase()}
                    </div>
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <span style={{ fontSize: 12.5, fontWeight: p.id === activeProjectId ? 600 : 400, color: "var(--atlas-fg)", fontFamily: "var(--app-font-sans)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", display: "block" }}>
                        {p.name}
                      </span>
                      {p.description && (
                        <span style={{ fontSize: 11, color: "var(--atlas-muted)", opacity: 0.6, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", display: "block", marginTop: 1 }}>
                          {p.description}
                        </span>
                      )}
                    </div>
                  </button>
                ))
              )}
              {hasMore && (
                <button type="button" style={{ ...linkBtn, padding: "4px 14px" }}>
                  +{projects.length - visible.length} more projects
                </button>
              )}
              <button type="button" onClick={() => navigate("/projects")} style={{ ...linkBtn, padding: "5px 14px", marginTop: 2 }}>
                Open project gallery →
              </button>
            </div>
          )}

          <div style={{ height: 1, background: "var(--atlas-gold-border)", margin: "8px 6px 10px" }} />

          {/* NAVIGATE section */}
          <SectionLabel>Navigate</SectionLabel>

          {/* Sessions */}
          <NavRow icon={<MessageSquare size={14} strokeWidth={1.6} />} label="Sessions" onClick={() => navigate("/sessions")} />

          {activeProjectId && onOpenLedger && (
            <NavRow icon={<BookOpen size={14} strokeWidth={1.6} />} label="Decision Ledger" onClick={() => { onOpenLedger(activeProjectId); onClose(); }} />
          )}
          <NavRow icon={<Inbox size={14} strokeWidth={1.6} />} label="Parking Lot" onClick={() => { onOpenParking?.(); onClose(); }} />
          <NavRow icon={<Feather size={14} strokeWidth={1.6} />} label="Think Freely" onClick={() => navigate("/think-freely")} />

          <div style={{ height: 1, background: "var(--atlas-gold-border)", margin: "8px 6px" }} />

          <SectionLabel>Tools</SectionLabel>
          <NavRow icon={<Hammer size={14} strokeWidth={1.6} />} label="Workshop" onClick={() => navigate("/workshop")} />
          <NavRow icon={<Compass size={14} strokeWidth={1.6} />} label="Project Compass" onClick={() => navigate("/compass")} />
          <NavRow icon={<ShieldCheck size={14} strokeWidth={1.6} />} label="Guard Report" onClick={() => navigate("/guard-report")} />
          <NavRow icon={<Archive size={14} strokeWidth={1.6} />} label="The Vault" onClick={() => navigate("/vault")} />
        </div>

        {/* User footer */}
        {userLabel && (
          <footer style={{
            flexShrink: 0,
            padding: "10px 14px calc(env(safe-area-inset-bottom, 0px) + 10px)",
            borderTop: "1px solid var(--atlas-gold-border)",
            display: "flex", alignItems: "center", gap: 10,
          }}>
            <div style={{
              width: 28, height: 28, borderRadius: 8, flexShrink: 0,
              background: userPhoto ? "transparent" : "rgba(201,162,76,0.12)",
              border: "1px solid rgba(201,162,76,0.2)",
              display: "flex", alignItems: "center", justifyContent: "center",
              fontSize: 11, fontWeight: 600, color: "var(--atlas-gold)",
              fontFamily: "var(--app-font-mono)", overflow: "hidden",
            }}>
              {userPhoto
                ? <img src={userPhoto} alt="" style={{ width: "100%", height: "100%", objectFit: "cover" }} />
                : userLabel?.[0]?.toUpperCase()
              }
            </div>
            <span style={{ flex: 1, minWidth: 0, fontSize: 12, color: "var(--atlas-fg)", fontFamily: "var(--app-font-sans)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
              {userLabel}
            </span>
          </footer>
        )}
      </aside>

      <style>{`
        @keyframes atlas-drawer-in {
          from { transform: translateX(-14px); opacity: 0; }
          to   { transform: translateX(0); opacity: 1; }
        }
      `}</style>
    </>
  );
}

function SectionLabel({ children }: { children: React.ReactNode }) {
  return (
    <div style={{ padding: "2px 12px 6px", fontSize: 9.5, fontWeight: 700, letterSpacing: "0.12em", textTransform: "uppercase", color: "var(--atlas-muted)", fontFamily: "var(--app-font-mono)", opacity: 0.55 }}>
      {children}
    </div>
  );
}

function NavRow({ icon, label, onClick }: { icon: React.ReactNode; label: string; onClick: () => void }) {
  return (
    <button type="button" onClick={onClick} style={{
      display: "flex", alignItems: "center", gap: 10,
      width: "100%", padding: "7px 10px",
      borderRadius: 8, border: "none",
      background: "transparent", cursor: "pointer", textAlign: "left",
      color: "var(--atlas-fg)",
      transition: "background 140ms ease",
    }}
      onMouseEnter={(e) => (e.currentTarget.style.background = "rgba(201,162,76,0.06)")}
      onMouseLeave={(e) => (e.currentTarget.style.background = "transparent")}
    >
      <span style={{ color: "var(--atlas-muted)", opacity: 0.7, display: "flex", flexShrink: 0 }}>{icon}</span>
      <span style={{ fontSize: 12.5, fontWeight: 400, fontFamily: "var(--app-font-sans)", color: "var(--atlas-fg)" }}>{label}</span>
    </button>
  );
}

const iconBtn: React.CSSProperties = {
  width: 30, height: 30, display: "flex", alignItems: "center", justifyContent: "center",
  borderRadius: 8, border: "none", background: "transparent",
  color: "var(--atlas-muted)", cursor: "pointer",
};

const linkBtn: React.CSSProperties = {
  background: "transparent", border: "none", cursor: "pointer", textAlign: "left",
  fontSize: 11.5, color: "rgba(201,162,76,0.65)", fontFamily: "var(--app-font-sans)",
  letterSpacing: "0.01em",
};
