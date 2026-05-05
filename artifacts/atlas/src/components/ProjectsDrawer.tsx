import { useEffect, useState } from "react";
import { Plus, X, Folder, ChevronDown, ChevronRight, MessageSquare, BookOpen, Inbox, Hammer } from "lucide-react";

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
  userLabel?: string | null;
};

export function ProjectsDrawer({ open, onClose, projects, activeProjectId, onOpenProject, onNewProject, onOpenLedger, userLabel }: Props) {
  const [expanded, setExpanded] = useState(true);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  if (!open) return null;

  const visible = projects.slice(0, 8);
  const hasMore = projects.length > visible.length;

  return (
    <>
      <div onClick={onClose} style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.48)", backdropFilter: "blur(3px)", zIndex: 90 }} />
      <aside
        role="dialog"
        aria-label="Menu"
        style={{
          position: "fixed", top: 0, left: 0, bottom: 0,
          width: "min(88vw, 300px)",
          background: "var(--atlas-surface)",
          borderRight: "1px solid rgba(201,162,76,0.14)",
          boxShadow: "8px 0 40px -8px rgba(0,0,0,0.6)",
          zIndex: 91,
          display: "flex", flexDirection: "column",
          animation: "atlas-drawer-in 220ms cubic-bezier(.2,.8,.2,1)",
        }}
      >
        {/* Header */}
        <header style={{
          display: "flex", alignItems: "center", justifyContent: "space-between",
          padding: "14px 14px 14px 16px",
          borderBottom: "1px solid rgba(201,162,76,0.10)",
          flexShrink: 0,
        }}>
          <div style={{ display: "flex", alignItems: "center", gap: 9, fontSize: 13, fontWeight: 600, color: "var(--atlas-fg)", fontFamily: "var(--app-font-sans)", letterSpacing: "0.01em" }}>
            <Folder size={14} strokeWidth={1.6} style={{ color: "var(--atlas-gold)", opacity: 0.8 }} />
            Menu
          </div>
          <button type="button" onClick={onClose} style={iconBtn}>
            <X size={15} strokeWidth={1.6} />
          </button>
        </header>

        {/* Body */}
        <div style={{ flex: 1, overflowY: "auto", padding: "8px 8px 16px" }}>

          {/* Projects section */}
          <div style={{ display: "flex", alignItems: "center", padding: "2px 4px" }}>
            <button type="button" onClick={() => setExpanded(v => !v)} style={{
              flex: 1, display: "flex", alignItems: "center", gap: 6,
              padding: "5px 6px", borderRadius: 6, border: "none",
              background: "transparent", cursor: "pointer",
              color: "rgba(201,162,76,0.75)",
              fontSize: 10.5, fontWeight: 600, letterSpacing: "0.08em", textTransform: "uppercase",
              fontFamily: "var(--app-font-mono)",
            }}>
              {expanded ? <ChevronDown size={12} strokeWidth={2} /> : <ChevronRight size={12} strokeWidth={2} />}
              Projects
            </button>
            <button type="button" onClick={(e) => { e.stopPropagation(); onNewProject(); onClose(); }} aria-label="New project" style={{ ...iconBtn, width: 26, height: 26 }}>
              <Plus size={13} strokeWidth={1.8} />
            </button>
          </div>

          {expanded && (
            <div style={{ display: "flex", flexDirection: "column", gap: 2, marginBottom: 8 }}>
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
                      borderLeft: p.id === activeProjectId ? "2px solid rgba(201,162,76,0.45)" : "2px solid transparent",
                    }}
                  >
                    <div style={{
                      width: 28, height: 28, borderRadius: 7, flexShrink: 0,
                      background: `hsl(${(p.name.charCodeAt(0) * 37) % 360}, 22%, 22%)`,
                      display: "flex", alignItems: "center", justifyContent: "center",
                      fontSize: 11, fontWeight: 600, color: "var(--atlas-fg)",
                      fontFamily: "var(--app-font-mono)",
                    }}>
                      {p.name[0]?.toUpperCase()}
                    </div>
                    <span style={{ flex: 1, minWidth: 0, fontSize: 12.5, fontWeight: p.id === activeProjectId ? 600 : 400, color: "var(--atlas-fg)", fontFamily: "var(--app-font-sans)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                      {p.name}
                    </span>
                  </button>
                ))
              )}
              {hasMore && (
                <div style={{ padding: "4px 14px", fontSize: 11.5, color: "rgba(201,162,76,0.7)", fontFamily: "var(--app-font-sans)", cursor: "pointer" }}>
                  +{projects.length - visible.length} more projects
                </div>
              )}
            </div>
          )}

          <div style={{ height: 1, background: "rgba(201,162,76,0.08)", margin: "6px 6px 10px" }} />

          {/* Navigate section */}
          <div style={{ padding: "2px 12px 6px", fontSize: 9.5, fontWeight: 600, letterSpacing: "0.1em", textTransform: "uppercase", color: "var(--atlas-muted)", fontFamily: "var(--app-font-mono)", opacity: 0.6 }}>
            Navigate
          </div>

          {activeProjectId && onOpenLedger && (
            <NavRow icon={<BookOpen size={14} strokeWidth={1.6} />} label="Decision Ledger" onClick={() => { onOpenLedger(activeProjectId); onClose(); }} />
          )}
          <NavRow icon={<MessageSquare size={14} strokeWidth={1.6} />} label="Sessions" onClick={onClose} />
          <NavRow icon={<Inbox size={14} strokeWidth={1.6} />} label="Parking Lot" onClick={onClose} />

          <div style={{ height: 1, background: "rgba(201,162,76,0.08)", margin: "8px 6px" }} />

          <div style={{ padding: "2px 12px 6px", fontSize: 9.5, fontWeight: 600, letterSpacing: "0.1em", textTransform: "uppercase", color: "var(--atlas-muted)", fontFamily: "var(--app-font-mono)", opacity: 0.6 }}>
            Tools
          </div>
          <NavRow icon={<Hammer size={14} strokeWidth={1.6} />} label="Workshop" onClick={onClose} />
        </div>

        {/* User footer */}
        {userLabel && (
          <footer style={{
            flexShrink: 0,
            padding: "10px 14px calc(env(safe-area-inset-bottom, 0px) + 10px)",
            borderTop: "1px solid rgba(201,162,76,0.10)",
            display: "flex", alignItems: "center", gap: 10,
          }}>
            <div style={{
              width: 28, height: 28, borderRadius: 8, flexShrink: 0,
              background: "rgba(201,162,76,0.12)", border: "1px solid rgba(201,162,76,0.2)",
              display: "flex", alignItems: "center", justifyContent: "center",
              fontSize: 11, fontWeight: 600, color: "var(--atlas-gold)",
              fontFamily: "var(--app-font-mono)",
            }}>
              {userLabel[0]?.toUpperCase()}
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
          to   { transform: translateX(0);      opacity: 1; }
        }
      `}</style>
    </>
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
