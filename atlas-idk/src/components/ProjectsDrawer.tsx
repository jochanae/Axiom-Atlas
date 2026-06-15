import { useEffect, useState } from "react";
import { Project } from "@workspace/api-client-react";
import { createPortal } from "react-dom";
import { useLocation } from "wouter";
import { Plus, X, ChevronDown, ChevronRight, BookOpen, Inbox, Hammer, Compass, Archive, LayoutDashboard, Globe, Wand2, KeyRound, LayoutGrid } from "lucide-react";
import { CompactReadinessRing } from "./ReadinessRing";
import { LifecycleGlyph } from "./LifecycleGlyph";

export type DrawerProject = {
  id: number;
  name: string;
  description?: string | null;
  latestSnapshotScore?: number | null;
  status?: "shaping" | "committed" | "archived";
};

type ProjectFilter = "all" | "committed" | "shaping";


type Props = {
  open: boolean;
  onClose: () => void;
  projects: DrawerProject[];
  activeProjectId?: number | null;
  onOpenProject: (id: number) => void;
  onNewProject: () => void;
  onOpenLedger?: (id: number) => void;
  onOpenParking?: () => void;
  onOpenQuickPrompt?: () => void;
  userLabel?: string | null;
};

export function ProjectsDrawer({ open, onClose, projects, activeProjectId, onOpenProject, onNewProject, onOpenLedger, onOpenParking, onOpenQuickPrompt, userLabel }: Props) {
  const [, setLocation] = useLocation();
  const [projectsExpanded, setProjectsExpanded] = useState(true);
  const [sessionsExpanded, setSessionsExpanded] = useState(false);
  const [filter, setFilter] = useState<ProjectFilter>("all");
  void sessionsExpanded;
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

  const filtered = projects.filter((p) => {
    if (filter === "all") return p.status !== "archived";
    if (filter === "committed") return (p.status ?? "committed") === "committed";
    if (filter === "shaping") return p.status === "shaping";
    return true;
  });
  const visible = filtered.slice(0, 6);
  const hasMore = filtered.length > visible.length;
  const shapingCount = projects.filter((p) => p.status === "shaping").length;


  return createPortal(
    <>
      {/* Scrim */}
      <div onClick={onClose} style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.72)", backdropFilter: "blur(8px)", zIndex: 12000 }} />

      {/* Panel */}
      <aside
        role="dialog"
        aria-label="Menu"
        className="atlas-side-drawer"
        style={{
          position: "fixed", top: 0, left: 0,
          width: "min(88vw, 300px)",
          height: "100dvh",
          backgroundColor: "var(--atlas-bg)",
          borderRight: "1px solid var(--atlas-gold-border)",
          boxShadow: "8px 0 40px -8px rgba(0,0,0,0.7), 1px 0 0 rgba(201,162,76,0.08)",
          zIndex: 12001,
          display: "flex", flexDirection: "column",
          animation: "atlas-drawer-in 220ms cubic-bezier(.2,.8,.2,1)",
          maxHeight: "100dvh",
          overflowY: "hidden",
          overscrollBehavior: "contain",
          isolation: "isolate",
        }}
      >
        {/* Safe-area top band — always opaque, prevents status-bar bleed */}
        <div aria-hidden style={{
          height: "env(safe-area-inset-top, 0px)",
          backgroundColor: "var(--atlas-bg)",
          flexShrink: 0,
          position: "relative",
          zIndex: 2,
        }} />
        {/* Header — opaque, sits above body */}
        <header style={{
          display: "flex", alignItems: "center", justifyContent: "space-between",
          padding: "14px 14px 14px 16px",
          borderBottom: "1px solid var(--atlas-gold-border)",
          backgroundColor: "var(--atlas-bg)",
          flexShrink: 0,
          position: "relative",
          zIndex: 2,
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
        <div style={{ flex: 1, minHeight: 0, overflowY: "scroll", WebkitOverflowScrolling: "touch", overscrollBehavior: "contain", touchAction: "pan-y", padding: "10px 8px 16px" }}>

          {/* Nexus — gateway button */}
          <style>{`
            @keyframes nx-letter-in {
              from { opacity: 0; transform: translateY(5px); }
              to   { opacity: 1; transform: translateY(0); }
            }
          `}</style>
          <button
            type="button"
            onClick={() => navigate("/nexus")}
            style={{
              display: "flex", alignItems: "center", gap: 10,
              width: "100%", padding: "10px 12px", marginBottom: 10,
              borderRadius: 11,
              border: "1px solid rgba(201,162,76,0.15)",
              background: "rgba(201,162,76,0.025)",
              cursor: "pointer", textAlign: "left",
              transition: "background 200ms ease, border-color 200ms ease, box-shadow 200ms ease",
            }}
            onMouseEnter={(e) => {
              e.currentTarget.style.background = "rgba(201,162,76,0.07)";
              e.currentTarget.style.borderColor = "rgba(201,162,76,0.3)";
              e.currentTarget.style.boxShadow = "0 0 28px rgba(201,162,76,0.08), inset 0 1px 0 rgba(201,162,76,0.1)";
            }}
            onMouseLeave={(e) => {
              e.currentTarget.style.background = "rgba(201,162,76,0.025)";
              e.currentTarget.style.borderColor = "rgba(201,162,76,0.15)";
              e.currentTarget.style.boxShadow = "none";
            }}
          >
            {/* Icon */}
            <div style={{
              width: 30, height: 30, borderRadius: 8, flexShrink: 0,
              background: "rgba(201,162,76,0.07)", border: "1px solid rgba(201,162,76,0.18)",
              display: "flex", alignItems: "center", justifyContent: "center",
            }}>
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="var(--atlas-gold)" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
                <circle cx="12" cy="12" r="3" /><path d="M12 2v4M12 18v4M2 12h4M18 12h4" />
              </svg>
            </div>

            {/* Labels */}
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{
                fontSize: 11, fontFamily: "var(--app-font-mono)", fontWeight: 700,
                letterSpacing: "0.18em", color: "var(--atlas-gold)", textTransform: "uppercase",
                display: "inline-flex",
              }}>
                {"ATLAS".split("").map((ch, i) => (
                  <span key={i} style={{
                    display: "inline-block",
                    animation: "nx-letter-in 0.4s cubic-bezier(0.22,1,0.36,1) both",
                    animationDelay: `${i * 0.06}s`,
                  }}>{ch}</span>
                ))}
              </div>
              <div style={{
                fontSize: 9, color: "var(--atlas-muted)", opacity: 0.5,
                fontFamily: "var(--app-font-mono)", letterSpacing: "0.08em",
                textTransform: "uppercase", marginTop: 1,
              }}>
                Global View · All Projects
              </div>
            </div>

            {/* Chevron */}
            <svg width="9" height="9" viewBox="0 0 12 12" fill="none" stroke="var(--atlas-gold)" strokeWidth="1.8" strokeLinecap="round" style={{ opacity: 0.35, flexShrink: 0 }}>
              <path d="M4.5 2l3 4-3 4" />
            </svg>
          </button>

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
              {/* Filter chips: All | Committed | Shaping */}
              <div role="tablist" aria-label="Project filter" style={{ display: "flex", gap: 4, padding: "2px 6px 8px" }}>
                {([
                  { key: "all", label: "All", count: projects.filter(p => p.status !== "archived").length },
                  { key: "committed", label: "Committed", count: projects.filter(p => (p.status ?? "committed") === "committed").length },
                  { key: "shaping", label: "Shaping", count: shapingCount },
                ] as Array<{ key: ProjectFilter; label: string; count: number }>).map((chip) => {
                  const active = filter === chip.key;
                  return (
                    <button
                      key={chip.key}
                      type="button"
                      role="tab"
                      aria-selected={active}
                      onClick={() => setFilter(chip.key)}
                      style={{
                        flex: 1,
                        padding: "4px 6px",
                        borderRadius: 6,
                        border: `1px solid ${active ? "rgba(201,162,76,0.4)" : "rgba(201,162,76,0.12)"}`,
                        background: active ? "rgba(201,162,76,0.10)" : "transparent",
                        color: active ? "var(--atlas-gold)" : "var(--atlas-muted)",
                        cursor: "pointer",
                        fontSize: 9.5,
                        fontWeight: active ? 700 : 500,
                        letterSpacing: "0.08em",
                        textTransform: "uppercase",
                        fontFamily: "var(--app-font-mono)",
                        transition: "background 140ms ease, border-color 140ms ease, color 140ms ease",
                      }}
                    >
                      {chip.label}
                      <span style={{ opacity: 0.55, marginLeft: 4, fontWeight: 500 }}>{chip.count}</span>
                    </button>
                  );
                })}
              </div>

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
                      {(() => {
                        const isUnnamed = p.name === "New Project" || p.name === "New Idea" || p.name === "My Project";
                        return (
                          <span style={{ fontSize: 12.5, fontWeight: p.id === activeProjectId ? 600 : 400, color: isUnnamed ? "var(--atlas-muted)" : "var(--atlas-fg)", fontFamily: "var(--app-font-sans)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", display: "flex", alignItems: "center", gap: 5, fontStyle: isUnnamed ? "italic" : "normal" }}>
                            <LifecycleGlyph
                              projectId={p.id}
                              projectName={p.name}
                              status={p.status}
                              readinessScore={p.latestSnapshotScore ?? null}
                              size={12}
                            />
                            <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", flex: 1 }}>{p.name}</span>
                            {isUnnamed && <span style={{ opacity: 0.55, fontSize: 9.5, flexShrink: 0 }}>✎</span>}
                          </span>
                        );
                      })()}
                      {p.description && (
                        <span style={{ fontSize: 11, color: "var(--atlas-muted)", opacity: 0.6, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", display: "block", marginTop: 1 }}>
                          {p.description}
                        </span>
                      )}
                    </div>
                    <CompactReadinessRing score={p.latestSnapshotScore ?? 0} />
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

          <NavRow icon={<LayoutDashboard size={14} strokeWidth={1.6} />} label="Dashboard" onClick={() => navigate("/dashboard")} />
          <NavRow icon={<Globe size={14} strokeWidth={1.6} />} label="Master Map" onClick={() => { navigate("/map"); onClose(); }} />

          {activeProjectId && onOpenLedger && (
            <NavRow icon={<BookOpen size={14} strokeWidth={1.6} />} label="Decision Ledger" onClick={() => { onOpenLedger(activeProjectId); onClose(); }} />
          )}
          {activeProjectId && onOpenParking && (
            <NavRow
              icon={<Inbox size={14} strokeWidth={1.6} />}
              label="Parking Lot"
              sublabel={projects?.find(p => p.id === activeProjectId)?.name ?? "This project"}
              onClick={() => { onOpenParking(); onClose(); }}
            />
          )}
          <NavRow
            icon={<Inbox size={14} strokeWidth={1.6} />}
            label="Parking Lot"
            sublabel="All projects"
            onClick={() => { navigate("/parking"); onClose(); }}
          />
          

          <div style={{ height: 1, background: "var(--atlas-gold-border)", margin: "8px 6px" }} />

          <SectionLabel>Tools</SectionLabel>
          {onOpenQuickPrompt && (
            <NavRow icon={<Wand2 size={14} strokeWidth={1.6} />} label="Quick Prompt" onClick={() => { onOpenQuickPrompt(); onClose(); }} />
          )}
          <NavRow icon={<Hammer size={14} strokeWidth={1.6} />} label="Workshop" onClick={() => navigate("/workshop")} />
          {activeProjectId && (
            <NavRow icon={<LayoutGrid size={14} strokeWidth={1.6} />} label="Workbench" onClick={() => { navigate(`/project/${activeProjectId}?tab=workbench`); onClose(); }} />
          )}
          <NavRow icon={<Compass size={14} strokeWidth={1.6} />} label="Project Compass" onClick={() => navigate("/compass")} />
          <NavRow icon={<Archive size={14} strokeWidth={1.6} />} label="The Vault" onClick={() => navigate("/vault")} />
          <NavRow icon={<KeyRound size={14} strokeWidth={1.6} />} label="Secrets" onClick={() => navigate("/secrets")} />
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
          from { transform: translateX(-14px); }
          to   { transform: translateX(0); }
        }
      `}</style>
    </>,
    document.body
  );
}

function SectionLabel({ children }: { children: React.ReactNode }) {
  return (
    <div style={{ padding: "2px 12px 6px", fontSize: 9.5, fontWeight: 700, letterSpacing: "0.12em", textTransform: "uppercase", color: "var(--atlas-muted)", fontFamily: "var(--app-font-mono)", opacity: 0.55 }}>
      {children}
    </div>
  );
}

function NavRow({ icon, label, sublabel, onClick }: { icon: React.ReactNode; label: string; sublabel?: string; onClick: () => void }) {
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
      {sublabel && (
        <span style={{ fontSize: 9, color: "var(--atlas-muted)", opacity: 0.55, marginLeft: 4, fontFamily: "var(--app-font-mono)", letterSpacing: "0.04em" }}>
          · {sublabel}
        </span>
      )}
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
