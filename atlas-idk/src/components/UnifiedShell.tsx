// cache-bust: footer-unified
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { updateProject, useUpdateProject, getGetProjectQueryKey, Session, ProjectNodeState, Project } from "@workspace/api-client-react";
import { useLocation } from "wouter";
import { useAuth, isSuperAdmin } from "@/hooks/useAuth";
import { useProjectState } from "@/hooks/useProjectState";
import { useIsMobile } from "@/hooks/use-mobile";
import { useIsTinyScreen } from "@/hooks/useBreakpoints";
import { toast } from "sonner";
import { UserMenuDropdown } from "@/components/UserMenuDropdown";
import { LifecycleGlyph } from "@/components/LifecycleGlyph";
import { deriveLifecycle, LIFECYCLE_META } from "@/lib/lifecycle";
import { parseLinkedRepo } from "@/lib/githubRepo";
import { useQueryClient } from "@tanstack/react-query";
import {
  computeScoreFromNodeState,
  MODE_META,
  READINESS_MODE_KEY,
  computeBlendedScore,
  type ReadinessMode,
} from "@/components/ReadinessRing";

type ShellDepth = "ambient" | "active" | "operational";

type ShellState = {
  currentDepth: ShellDepth;
  setDepth: (depth: ShellDepth) => void;
  activeProjectId: number | null;
  setActiveProjectId: (id: number | null) => void;
  activeConversationTitle: string | null;
  setActiveConversationTitle: (title: string | null) => void;
};

type ShellNavIcon =
  | "home"
  | "projects"
  | "decisions"
  | "you"
  | "map"
  | "files"
  | "forge"
  | "chat"
  | "ledger"
  | "preview"
  | "flow";

type ShellNavItem = {
  label: string;
  icon: ShellNavIcon;
  action: () => void;
};

const ShellStateContext = createContext<ShellState | null>(null);

export function useShellState(): ShellState {
  const context = useContext(ShellStateContext);
  if (!context) {
    throw new Error("useShellState must be used within UnifiedShell");
  }
  return context;
}

function depthFromPath(pathname: string): ShellDepth {
  if (pathname.startsWith("/project/")) return "operational";
  return "ambient";
}

function projectIdFromPath(pathname: string): number | null {
  const match = pathname.match(/^\/project\/(\d+)/);
  if (!match) return null;
  const id = Number(match[1]);
  return Number.isFinite(id) ? id : null;
}

function ShellWordmark() {
  const [location, setLocation] = useLocation();
  const handleClick = () => {
    if (location === "/home") {
      // Already on home — reset the tray to ambient instead of being a no-op.
      window.dispatchEvent(new CustomEvent("axiom:home-reset"));
    } else {
      setLocation("/home");
    }
  };
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
      <button
        type="button"
        onClick={handleClick}
        aria-label={location === "/home" ? "Return to ambient Nexus" : "Go home"}
        style={{ background: "transparent", border: "none", cursor: "pointer", padding: 0, display: "flex", alignItems: "center", gap: 6 }}
      >
        <img
          src="/axiom-logo.svg"
          alt="Axiom"
          width={26}
          height={26}
          style={{ borderRadius: "20%", flexShrink: 0 }}
        />
        <span
          style={{
            fontFamily: "'IBM Plex Mono', var(--app-font-mono)",
            fontSize: "var(--ts-label)",
            fontWeight: 700,
            letterSpacing: "0.18em",
            lineHeight: "var(--lh-tight)",
            color: "var(--atlas-gold)",
            textTransform: "uppercase",
          }}
        >
          AXIOM
        </span>
      </button>
    </div>
  );
}



function ShellClock() {
  const [now, setNow] = useState(() => new Date());

  useEffect(() => {
    const id = window.setInterval(() => setNow(new Date()), 30_000);
    return () => window.clearInterval(id);
  }, []);

  const days = ["SUN", "MON", "TUE", "WED", "THU", "FRI", "SAT"];
  const months = ["JAN", "FEB", "MAR", "APR", "MAY", "JUN", "JUL", "AUG", "SEP", "OCT", "NOV", "DEC"];
  const day = days[now.getDay()];
  const mon = months[now.getMonth()];
  const date = now.getDate();
  let h = now.getHours();
  const m = now.getMinutes().toString().padStart(2, "0");
  const ampm = h >= 12 ? "PM" : "AM";
  h = h % 12 || 12;

  return (
    <div
      aria-hidden
      style={{
        fontFamily: "var(--app-font-mono)",
        fontSize: 10,
        letterSpacing: "0.18em",
        color: "rgba(120,113,108,0.5)",
        userSelect: "none",
        textTransform: "uppercase",
      }}
    >
      {day} {mon} {date} · {h}:{m} {ampm}
    </div>
  );
}

function ShellAvatar() {
  const { user } = useAuth();
  const photoUrl = user?.avatarUrl || (() => {
    try {
      const raw = localStorage.getItem("atlas-user-profile");
      return raw ? (JSON.parse(raw).photoUrl ?? "") : "";
    } catch {
      return "";
    }
  })();
  const name = user?.name || user?.email?.split("@")[0] || "Account";
  const isAdmin = isSuperAdmin(user);

  const openAccount = useCallback(() => {
    window.dispatchEvent(new CustomEvent("axiom:open-account-hub"));
  }, []);

  const openInvite = useCallback((e: React.MouseEvent | React.KeyboardEvent) => {
    e.stopPropagation();
    window.dispatchEvent(new CustomEvent("axiom:open-invite"));
  }, []);

  return (
    <div style={{ display: "inline-flex", alignItems: "center", flexShrink: 0 }}>
    <div
      style={{ position: "relative", display: "inline-flex", flexShrink: 0 }}
      role="button"
      tabIndex={0}
      aria-label="Open settings"
      onClick={openAccount}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          openAccount();
        }
      }}
    >

      <div
        title={name}
        aria-label={name}
        style={{
          width: 36,
          height: 36,
          borderRadius: "22%",
          borderTop: "none",
          borderBottom: "none",
          borderLeft: "2px solid rgba(212,175,55,0.65)",
          borderRight: "2px solid rgba(212,175,55,0.65)",
          background: photoUrl ? "transparent" : "var(--atlas-bg)",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          overflow: "hidden",
          flexShrink: 0,
        }}
      >
        {photoUrl ? (
          <img src={photoUrl} alt="" style={{ width: "100%", height: "100%", objectFit: "cover", borderRadius: "20%" }} />
        ) : (
          <svg width="15" height="15" viewBox="0 0 20 20" fill="none" aria-hidden>
            <circle cx="10" cy="7.5" r="3.2" stroke="#C9A24C" strokeWidth="1.2" />
            <path d="M3 18.5c0-3.866 3.134-7 7-7s7 3.134 7 7" stroke="#C9A24C" strokeWidth="1.2" strokeLinecap="round" />
          </svg>
        )}
      </div>
      {isAdmin && (
        <div
          style={{
            position: "absolute",
            bottom: -4,
            right: -4,
            width: 14,
            height: 14,
            borderRadius: "50%",
            background: "linear-gradient(135deg,#D4AF37,#A07820)",
            border: "1.5px solid var(--atlas-bg)",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            boxShadow: "0 0 6px rgba(212,175,55,0.5)",
            pointerEvents: "none",
            zIndex: 3,
          }}
        >
          <svg width="7" height="7" viewBox="0 0 24 24" fill="none" stroke="#0C0A09" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round">
            <path d="M2 20h20M4 20V10l4 4 4-8 4 8 4-4v10" />
          </svg>
        </div>
      )}
    </div>
      <button
        type="button"
        onClick={openInvite}
        onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); openInvite(e); } }}
        title="Invite collaborators"
        aria-label="Invite collaborators"
        style={{
          marginLeft: 6,
          width: 36,
          height: 36,
          borderRadius: "22%",
          border: "1.5px dashed rgba(212,175,55,0.55)",
          background: "transparent",
          color: "rgba(212,175,55,0.75)",
          display: "inline-flex",
          alignItems: "center",
          justifyContent: "center",
          cursor: "pointer",
          padding: 0,
          transition: "border-color 140ms ease, color 140ms ease, background 140ms ease",
          flexShrink: 0,
        }}
        onMouseEnter={(e) => { e.currentTarget.style.borderColor = "rgba(212,175,55,0.9)"; e.currentTarget.style.color = "rgba(212,175,55,1)"; e.currentTarget.style.background = "rgba(212,175,55,0.06)"; }}
        onMouseLeave={(e) => { e.currentTarget.style.borderColor = "rgba(212,175,55,0.55)"; e.currentTarget.style.color = "rgba(212,175,55,0.75)"; e.currentTarget.style.background = "transparent"; }}
      >
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
          <line x1="12" y1="5" x2="12" y2="19" />
          <line x1="5" y1="12" x2="19" y2="12" />
        </svg>
      </button>
    </div>
  );
}

function repoNameFromFullName(fullName: string): string {
  const trimmed = fullName.trim().replace(/\.git$/i, "");
  return trimmed.split("/").filter(Boolean).pop() || trimmed;
}

function ShellBranchChip() {
  const [open, setOpen] = useState(false);
  const branches = ["main"]; // TODO: wire to repo branches list
  const current = "main";
  return (
    <span style={{ position: "relative", display: "inline-flex", flexShrink: 0 }}>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        title="Branch"
        aria-haspopup="listbox"
        aria-expanded={open}
        style={{
          display: "inline-flex",
          alignItems: "center",
          gap: 5,
          background: "color-mix(in oklab, var(--atlas-fg) 6%, transparent)",
          border: "1px solid var(--atlas-border)",
          borderRadius: 999,
          padding: "3px 8px",
          cursor: "pointer",
          color: "var(--atlas-fg)",
          fontFamily: "var(--app-font-mono, monospace)",
          fontSize: 11,
          letterSpacing: "0.04em",
          opacity: 0.92,
          pointerEvents: "auto",
        }}
      >
        <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden style={{ opacity: 0.7 }}>
          <line x1="6" y1="3" x2="6" y2="15" />
          <circle cx="18" cy="6" r="3" />
          <circle cx="6" cy="18" r="3" />
          <path d="M18 9a9 9 0 0 1-9 9" />
        </svg>
        <span>{current}</span>
        <svg width="9" height="9" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden style={{ opacity: 0.55 }}>
          <polyline points="6 9 12 15 18 9" />
        </svg>
      </button>
      {open && (
        <>
          <div onPointerDown={() => setOpen(false)} onTouchStart={() => setOpen(false)} onClick={() => setOpen(false)} style={{ position: "fixed", inset: 0, zIndex: 40 }} />
          <div
            role="listbox"
            style={{
              position: "absolute",
              top: "calc(100% + 6px)",
              left: 0,
              zIndex: 50,
              minWidth: 180,
              background: "color-mix(in oklab, var(--atlas-surface) 96%, transparent)",
              backdropFilter: "blur(18px)",
              border: "1px solid rgba(201,162,76,0.22)",
              borderRadius: 12,
              boxShadow: "0 18px 40px rgba(0,0,0,0.55)",
              padding: 6,
            }}
          >
            <div style={{ fontFamily: "var(--app-font-mono, monospace)", fontSize: 10, letterSpacing: "0.14em", textTransform: "uppercase", color: "var(--atlas-muted)", padding: "6px 10px 4px" }}>
              Branch
            </div>
            {branches.map((b) => (
              <button
                key={b}
                type="button"
                onClick={() => setOpen(false)}
                style={{
                  width: "100%",
                  textAlign: "left",
                  display: "flex",
                  alignItems: "center",
                  gap: 8,
                  padding: "8px 10px",
                  background: b === current ? "rgba(201,162,76,0.10)" : "transparent",
                  border: "none",
                  borderRadius: 8,
                  color: "var(--atlas-fg)",
                  fontFamily: "var(--app-font-mono, monospace)",
                  fontSize: 12,
                  cursor: "pointer",
                }}
              >
                <span style={{ opacity: b === current ? 1 : 0, color: "var(--atlas-gold)" }}>✓</span>
                <span>{b}</span>
              </button>
            ))}
            <div style={{ fontFamily: "var(--app-font-sans)", fontSize: 11, color: "var(--atlas-muted)", padding: "6px 10px 4px", opacity: 0.7 }}>
              More branches coming soon.
            </div>
          </div>
        </>
      )}
    </span>
  );
}


function ShellProjectSwitcher({ projectId }: { projectId: number | null }) {
  const isMobile = useIsMobile();
  const isTinyMobile = useIsTinyScreen();
  const ps = useProjectState(projectId);
  const project = ps.project as (Project & { status?: string | null; latestSnapshotScore?: number | null; linkedRepo?: string | null; githubToken?: string | null }) | null;
  // Avoid the "Untitled" flash while the project state is still loading for the first time.
  const hydrating = ps.loading && !ps.project;
  const resolvedName = project?.name?.trim();
  const name = resolvedName || (hydrating ? "" : "Untitled project");
  const hasActive = Boolean(ps.activeSession);
  const linkedRepo = useMemo(() => parseLinkedRepo(project?.linkedRepo ?? null), [project?.linkedRepo]);
  const linkedRepoName = linkedRepo ? repoNameFromFullName(linkedRepo.fullName) : null;
  const hasGithubToken = Boolean(project?.githubToken);
  const qc = useQueryClient();
  const updateProject = useUpdateProject();


  const [renaming, setRenaming] = useState(false);
  const [draft, setDraft] = useState(name);
  const [error, setError] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const escapeRef = useRef(false);

  const openSwitcher = useCallback(() => {
    window.dispatchEvent(new CustomEvent("axiom:open-projects-drawer"));
  }, []);

  const beginRename = useCallback(() => {
    setDraft(project?.name ?? "");
    setError(null);
    setRenaming(true);
    setTimeout(() => inputRef.current?.focus(), 50);
  }, [project?.name]);

  useEffect(() => {
    const handler = () => beginRename();
    window.addEventListener("axiom:rename-project", handler);
    return () => window.removeEventListener("axiom:rename-project", handler);
  }, [beginRename]);

  const commit = useCallback(() => {
    if (projectId == null || updateProject.isPending) return;
    const newName = draft.trim() || (project?.name ?? "");
    if (newName === project?.name) { setRenaming(false); return; }
    updateProject.mutate(
      { id: projectId, data: { name: newName } },
      {
        onSuccess: () => {
          qc.invalidateQueries({ queryKey: getGetProjectQueryKey(projectId) });
          void ps.refresh();
          setRenaming(false);
          setError(null);
        },
        onError: (err) => {
          setError((err as Error)?.message ?? "Failed to rename.");
          setTimeout(() => inputRef.current?.focus(), 0);
        },
      }
    );
  }, [draft, project?.name, projectId, ps, qc, updateProject]);

  if (projectId == null) return null;

  return (
    <div style={{ display: "inline-flex", alignItems: "center", gap: 4, maxWidth: "min(320px, 100%)", minWidth: 0 }}>
      {(() => {
        const state = deriveLifecycle({
          status: project?.status ?? null,
          readinessScore: project?.latestSnapshotScore ?? null,
          decisionCount: ps.decisions?.length ?? 0,
          hasRepo: Boolean(project?.linkedRepo),
        });
        const meta = LIFECYCLE_META[state];
        return (
          <span
            title={`${meta.label} — ${meta.description}${hasActive ? " · session active" : ""}`}
            style={{
              display: "inline-flex",
              alignItems: "center",
              justifyContent: "center",
              flexShrink: 0,
              borderRadius: "50%",
              boxShadow: `0 0 10px color-mix(in srgb, ${meta.color} 55%, transparent)`,
              animation: state === "built" ? undefined : "atlas-lifecycle-pulse 2.6s ease-in-out infinite",
            }}
          >
            <style>{`@keyframes atlas-lifecycle-pulse { 0%,100% { filter: drop-shadow(0 0 2px ${meta.color}); opacity: 0.85; } 50% { filter: drop-shadow(0 0 7px ${meta.color}); opacity: 1; } }`}</style>
            <LifecycleGlyph
              projectId={projectId}
              projectName={name || "Project"}
              status={(project?.status as "shaping" | "committed" | "archived" | undefined) ?? undefined}
              readinessScore={project?.latestSnapshotScore ?? null}
              decisionCount={ps.decisions?.length ?? 0}
              hasRepo={Boolean(project?.linkedRepo)}
              size={13}
            />
          </span>
        );
      })()}
      {renaming ? (
        <div style={{ display: "inline-flex", flexDirection: "column", minWidth: 0 }} onClick={(e) => e.stopPropagation()}>
          <input
            ref={inputRef}
            autoFocus
            value={draft}
            disabled={updateProject.isPending}
            onChange={(e) => { setDraft(e.target.value); setError(null); }}
            onKeyDown={(e) => {
              if (updateProject.isPending) return;
              if (e.key === "Enter") { e.preventDefault(); commit(); }
              if (e.key === "Escape") { escapeRef.current = true; setRenaming(false); setError(null); }
            }}
            onBlur={() => {
              if (updateProject.isPending) return;
              if (escapeRef.current) { escapeRef.current = false; return; }
              commit();
            }}
            style={{
              background: "transparent",
              border: "1px solid rgba(var(--atlas-gold-rgb),0.4)",
              borderRadius: 4,
              outline: "none",
              color: "var(--atlas-fg)",
              fontFamily: "var(--app-font-sans)",
              fontSize: "var(--ts-body)",
              fontWeight: 500,
              padding: "2px 6px",
              width: 180,
              opacity: updateProject.isPending ? 0.5 : 1,
              transition: "opacity 150ms ease",
            }}
          />
          {error && (
            <span style={{ fontSize: "var(--ts-sm)", color: "rgba(252,165,165,0.85)", fontFamily: "var(--app-font-mono)", marginTop: 2, lineHeight: 1.3 }}>
              {error}
            </span>
          )}
        </div>
      ) : (
        <>
        <button
          type="button"
          onClick={openSwitcher}
          onDoubleClick={beginRename}
          title="Tap to switch project · double-tap to rename"
          style={{
            display: "inline-flex",
            alignItems: "center",
            gap: 6,
            minWidth: 0,
            background: "color-mix(in oklab, var(--atlas-fg) 6%, transparent)",
            border: "1px solid var(--atlas-border)",
            borderRadius: 999,
            padding: "3px 8px 3px 8px",
            cursor: "pointer",
            color: "var(--atlas-fg)",
            fontFamily: "var(--app-font-sans)",
            fontSize: "var(--ts-body)",
            fontWeight: 500,
            lineHeight: "var(--lh-snug)",
            letterSpacing: "var(--ls-tight)",
            opacity: 0.95,
            pointerEvents: "auto",
            maxWidth: 180,
          }}
        >
          {/* GitHub mark — only shown when a repo is actually linked */}
          {linkedRepo && (
            <svg width="12" height="12" viewBox="0 0 24 24" fill="currentColor" aria-hidden style={{ opacity: 0.7, flexShrink: 0 }}>
              <path d="M12 .5C5.65.5.5 5.65.5 12c0 5.08 3.29 9.39 7.86 10.91.58.11.79-.25.79-.56v-2c-3.2.7-3.87-1.36-3.87-1.36-.53-1.35-1.3-1.71-1.31-1.71-1.07-.73.08-.71.08-.71 1.18.08 1.81 1.21 1.81 1.21 1.05 1.81 2.76 1.29 3.43.99.11-.76.41-1.29.75-1.59-2.55-.29-5.24-1.28-5.24-5.69 0-1.26.45-2.29 1.19-3.1-.12-.29-.52-1.47.11-3.07 0 0 .98-.31 3.2 1.19a11 11 0 0 1 5.83 0c2.22-1.5 3.2-1.19 3.2-1.19.63 1.6.23 2.78.11 3.07.74.81 1.19 1.84 1.19 3.1 0 4.42-2.69 5.39-5.25 5.68.42.36.79 1.08.79 2.18v3.23c0 .31.21.68.8.56A11.51 11.51 0 0 0 23.5 12C23.5 5.65 18.35.5 12 .5z"/>
            </svg>
          )}
          {hydrating ? (
            <span
              aria-label="Loading project"
              style={{
                display: "inline-block",
                width: 96,
                height: 12,
                borderRadius: 4,
                background: "linear-gradient(90deg, rgba(255,255,255,0.04) 0%, rgba(212,175,55,0.18) 50%, rgba(255,255,255,0.04) 100%)",
                backgroundSize: "200% 100%",
                animation: "axiomShimmer 1.2s ease-in-out infinite",
                opacity: 0.7,
              }}
            />
          ) : (
            <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", minWidth: 0 }}>{linkedRepoName || name}</span>
          )}
          {linkedRepo && !isMobile && (hasGithubToken ? (
            <span
              title="GitHub connected"
              style={{
                width: 6,
                height: 6,
                borderRadius: "50%",
                background: "#4ade80",
                display: "inline-block",
                boxShadow: "0 0 6px rgba(74,222,128,0.5)",
                flexShrink: 0,
              }}
            />
          ) : (
            <span
              title="No GitHub token - writes disabled"
              style={{
                width: 6,
                height: 6,
                borderRadius: "50%",
                background: "#78716C",
                display: "inline-block",
                flexShrink: 0,
              }}
            />
          ))}

          <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden style={{ opacity: 0.55, flexShrink: 0 }}>
            <polyline points="6 9 12 15 18 9" />
          </svg>
        </button>
        {!isTinyMobile && <ShellBranchChip />}
        </>

      )}

    </div>
  );
}


function ShellConversationTitle({ title }: { title: string | null }) {
  const resolvedTitle = title?.trim();
  if (!resolvedTitle) return null;

  return (
    <div style={{ display: "inline-flex", alignItems: "center", gap: 6, maxWidth: "min(260px, 100%)", minWidth: 0 }}>
      <span
        aria-hidden
        style={{
          width: 8,
          height: 8,
          borderRadius: "50%",
          flexShrink: 0,
          background: "var(--atlas-gold)",
          boxShadow: "0 0 6px rgba(201,162,76,0.45)",
        }}
      />
      <span
        title={resolvedTitle}
        style={{
          overflow: "hidden",
          textOverflow: "ellipsis",
          whiteSpace: "nowrap",
          minWidth: 0,
          color: "var(--atlas-fg)",
          fontFamily: "var(--app-font-sans)",
          fontSize: "var(--ts-body)",
          fontWeight: 500,
          lineHeight: "var(--lh-snug)",
          letterSpacing: "var(--ls-tight)",
          opacity: 0.92,
        }}
      >
        {resolvedTitle}
      </span>
    </div>
  );
}



function ShellReadinessChip({ projectId }: { projectId: number | null }) {
  const ps = useProjectState(projectId);
  const [open, setOpen] = useState(false);
  const [mode, setMode] = useState<ReadinessMode>(() => {
    try {
      const v = localStorage.getItem(READINESS_MODE_KEY) as ReadinessMode | null;
      return v === "arch" || v === "decisions" || v === "blended" ? v : "blended";
    } catch { return "blended"; }
  });
  const longPressRef = useRef<number | null>(null);
  const longPressFiredRef = useRef(false);

  if (projectId == null) return null;
  const proj = ps.project as { latestSnapshotScore?: number | null; nodeState?: ProjectNodeState | null; name?: string } | null;
  const ns = (proj?.nodeState ?? {}) as Record<string, unknown>;
  const decisionsCount = ps.decisions?.length ?? 0;

  // Split scores by category for mode switching.
  const ARCH_IDS = new Set(["auth", "db", "api", "state", "ui", "logic"]);
  let archTotal = 0, archResolved = 0, decTotal = 0, decResolved = 0;
  Object.entries(ns).forEach(([nid, raw]) => {
    const resolved = raw === true || (typeof raw === "object" && raw !== null && (raw as { resolved?: unknown }).resolved === true);
    if (ARCH_IDS.has(nid)) { archTotal++; if (resolved) archResolved++; }
    else { decTotal++; if (resolved) decResolved++; }
  });
  const archScore = archTotal === 0 ? 0 : Math.round((archResolved / archTotal) * 100);
  const decisionsScore = decTotal === 0 ? 0 : Math.round((decResolved / decTotal) * 100);
  const blendedScore = proj?.latestSnapshotScore ?? (computeBlendedScore(archScore, decisionsScore) || computeScoreFromNodeState(proj?.nodeState ?? null));
  const score = mode === "arch" ? archScore : mode === "decisions" ? decisionsScore : blendedScore;
  const meta = MODE_META[mode];

  const cycleMode = () => {
    const order: ReadinessMode[] = ["blended", "arch", "decisions"];
    const next = order[(order.indexOf(mode) + 1) % order.length];
    setMode(next);
    try { localStorage.setItem(READINESS_MODE_KEY, next); } catch {}
  };

  const startLongPress = () => {
    longPressFiredRef.current = false;
    longPressRef.current = window.setTimeout(() => {
      longPressFiredRef.current = true;
      setOpen(true);
    }, 450);
  };
  const cancelLongPress = () => {
    if (longPressRef.current) { window.clearTimeout(longPressRef.current); longPressRef.current = null; }
  };

  return (
    <>
      <button
        type="button"
        onClick={() => { if (!longPressFiredRef.current) cycleMode(); }}
        onPointerDown={startLongPress}
        onPointerUp={cancelLongPress}
        onPointerLeave={cancelLongPress}
        onPointerCancel={cancelLongPress}
        title={`${meta.label} — ${meta.description}. Tap to switch · long-press for breakdown.`}
        aria-label={`Readiness mode ${meta.label}, ${score} percent. Tap to switch mode, long-press for breakdown.`}
        style={{
          display: "inline-flex", alignItems: "center", gap: 6,
          padding: "4px 8px", borderRadius: 999, cursor: "pointer",
          background: "transparent",
          border: "none",
          color: "var(--atlas-gold)", flexShrink: 0,
          transition: "opacity 160ms ease",
          userSelect: "none",
          WebkitUserSelect: "none",
          touchAction: "manipulation",
          opacity: 0.9,
        }}
        onMouseEnter={(e) => { e.currentTarget.style.opacity = "1"; }}
        onMouseLeave={(e) => { e.currentTarget.style.opacity = "0.9"; }}
      >
        <span style={{
          fontFamily: "var(--app-font-mono)", fontSize: 8.5, fontWeight: 700,
          letterSpacing: "0.12em", color: "var(--atlas-muted)", lineHeight: 1,
        }}>{meta.abbr}</span>
        <span style={{
          width: 4, height: 4, borderRadius: 999,
          background: score >= 80 ? "#4ade80" : score >= 50 ? "var(--atlas-gold)" : "rgba(252,165,165,0.9)",
        }} />
        <span style={{
          fontFamily: "var(--app-font-mono)", fontSize: 10, fontWeight: 700,
          letterSpacing: "0.02em", lineHeight: 1,
        }}>{score}%</span>
      </button>
      {open && (
        <SovereignReadinessSheet
          score={blendedScore}
          projectName={proj?.name ?? null}
          decisionsCount={decisionsCount}
          nodeState={proj?.nodeState ?? null}
          onClose={() => setOpen(false)}
        />
      )}
    </>
  );
}


function SovereignReadinessSheet({
  score, projectName, decisionsCount, nodeState, onClose,
}: { score: number; projectName: string | null; decisionsCount: number; nodeState: ProjectNodeState | null; onClose: () => void }) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    document.addEventListener("keydown", onKey);
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => { document.removeEventListener("keydown", onKey); document.body.style.overflow = prev; };
  }, [onClose]);

  // ── Derive real Frontend / Backend / Context mix from project.nodeState. ──
  // Arch-layer ids (SystemMap): auth/db/api/state/ui/logic — value is boolean.
  // Flow-layer ids (AxiomFlow / Forge): { resolved, type, ... } objects.
  const ARCH_IDS = new Set(["auth", "db", "api", "state", "ui", "logic"]);
  const FRONTEND_ARCH = new Set(["ui", "state"]);
  const BACKEND_ARCH = new Set(["auth", "db", "api"]);
  // Flow node types → category buckets.
  const FRONTEND_FLOW = new Set(["goal", "requirement"]);
  const BACKEND_FLOW = new Set(["decision"]);
  // remaining flow types (blocker / priority / sprint / wont / logic) → context

  type Bucket = { total: number; resolved: number };
  const buckets: Record<"frontend" | "backend" | "context", Bucket> = {
    frontend: { total: 0, resolved: 0 },
    backend: { total: 0, resolved: 0 },
    context: { total: 0, resolved: 0 },
  };

  const ns = (nodeState ?? {}) as Record<string, unknown>;
  Object.entries(ns).forEach(([nid, raw]) => {
    let category: "frontend" | "backend" | "context" = "context";
    let resolved = false;
    if (ARCH_IDS.has(nid)) {
      resolved = raw === true || (typeof raw === "object" && raw !== null && (raw as { resolved?: unknown }).resolved === true);
      if (FRONTEND_ARCH.has(nid)) category = "frontend";
      else if (BACKEND_ARCH.has(nid)) category = "backend";
      else category = "context";
    } else if (typeof raw === "object" && raw !== null) {
      const obj = raw as { resolved?: unknown; type?: unknown };
      resolved = obj.resolved === true;
      const t = typeof obj.type === "string" ? obj.type : "";
      if (FRONTEND_FLOW.has(t)) category = "frontend";
      else if (BACKEND_FLOW.has(t)) category = "backend";
      else category = "context";
    } else {
      return;
    }
    buckets[category].total += 1;
    if (resolved) buckets[category].resolved += 1;
  });

  const totalNodes = buckets.frontend.total + buckets.backend.total + buckets.context.total;
  const sharePct = (n: number) => totalNodes === 0 ? 0 : Math.round((n / totalNodes) * 100);
  const frontend = sharePct(buckets.frontend.total);
  const backend = sharePct(buckets.backend.total);
  // Force the three shares to sum to 100 even after rounding.
  const context = totalNodes === 0 ? 0 : Math.max(0, 100 - frontend - backend);

  const readinessPct = (b: Bucket) => b.total === 0 ? 0 : Math.round((b.resolved / b.total) * 100);

  // Phases derived from the same nodeState — no mock math.
  // Foundational = arch core (auth/db/api/state) resolved share.
  // Core Lead Funnel = flow nodes (Forge-produced) resolved share.
  // Multi-Repo Sync = currently no signal in nodeState → 0% with honest empty note.
  const archCoreIds = ["auth", "db", "api", "state"];
  const archCoreTotal = archCoreIds.filter(k => k in ns).length;
  const archCoreResolved = archCoreIds.filter(k => {
    const v = ns[k];
    return v === true || (typeof v === "object" && v !== null && (v as { resolved?: unknown }).resolved === true);
  }).length;
  const foundationalPct = archCoreTotal === 0 ? 0 : Math.round((archCoreResolved / archCoreTotal) * 100);

  let flowTotal = 0, flowResolved = 0;
  Object.entries(ns).forEach(([nid, raw]) => {
    if (ARCH_IDS.has(nid)) return;
    if (typeof raw !== "object" || raw === null) return;
    flowTotal += 1;
    if ((raw as { resolved?: unknown }).resolved === true) flowResolved += 1;
  });
  const funnelPct = flowTotal === 0 ? 0 : Math.round((flowResolved / flowTotal) * 100);

  const phases = [
    {
      label: "Foundational Data Layer",
      pct: foundationalPct,
      tone: (foundationalPct >= 80 ? "ok" : foundationalPct >= 40 ? "warn" : "block") as "ok" | "warn" | "block",
      note: archCoreTotal === 0
        ? "No core architecture nodes mapped yet."
        : `${archCoreResolved}/${archCoreTotal} core nodes resolved.`,
    },
    {
      label: "Core Lead Funnel System",
      pct: funnelPct,
      tone: (funnelPct >= 80 ? "ok" : funnelPct >= 40 ? "warn" : "block") as "ok" | "warn" | "block",
      note: flowTotal === 0
        ? "No flow nodes mapped — run The Forge to seed."
        : `${flowResolved}/${flowTotal} flow nodes resolved.`,
    },
    {
      label: "Multi-Repo Synchronization",
      pct: 0,
      tone: "block" as const,
      note: "Repository connection not linked yet.",
    },
  ];

  const guidance = totalNodes === 0
    ? `Unscored — no architecture nodes mapped yet. Run The Forge or open the System Map to seed the spine, then commit decisions in the Ledger (${decisionsCount} so far).`
    : score >= 90
    ? "You're in the green. The remaining gap is polish — wire any uncommitted decisions into the ledger and ship."
    : score >= 60
    ? `Core mechanics are production-ready. ${flowTotal - flowResolved} flow node${(flowTotal - flowResolved) === 1 ? "" : "s"} still unresolved — close them to push past ${score}%.`
    : `Foundations are still forming. ${totalNodes} node${totalNodes === 1 ? "" : "s"} mapped, ${decisionsCount} decision${decisionsCount === 1 ? "" : "s"} committed. Resolve the open architectural nodes before adding more surface area.`;

  const toneColor = (t: "ok" | "warn" | "block") =>
    t === "ok" ? "#4ade80" : t === "warn" ? "var(--atlas-gold)" : "rgba(252,165,165,0.9)";

  return (
    <div
      onClick={onClose}
      style={{
        position: "fixed", inset: 0, zIndex: 100,
        background: "rgba(0,0,0,0.55)", backdropFilter: "blur(4px)",
        display: "flex", alignItems: "center", justifyContent: "center",
        padding: "max(env(safe-area-inset-top, 0px), 12px) 12px max(env(safe-area-inset-bottom, 0px), 12px)",
      }}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-label="Sovereign Readiness Ledger"
        style={{
          width: "100%", maxWidth: 560, maxHeight: "calc(100dvh - 24px)", overflowY: "auto",
          background: "var(--atlas-surface)",
          border: "1px solid rgba(201,162,76,0.18)",
          borderTop: "1px solid rgba(201,162,76,0.25)",
          borderTopLeftRadius: 18, borderTopRightRadius: 18, borderBottomLeftRadius: 18, borderBottomRightRadius: 18,
          padding: "18px 20px 28px",
          boxShadow: "0 -10px 40px rgba(0,0,0,0.55)",
        }}
      >
        {/* grab handle */}
        <div style={{
          width: 36, height: 4, borderRadius: 999, margin: "0 auto 14px",
          background: "rgba(201,162,76,0.35)",
        }} />

        {/* header */}
        <div style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between", marginBottom: 4 }}>
          <div style={{
            fontFamily: "var(--app-font-mono)", fontSize: 9, fontWeight: 700,
            letterSpacing: "0.18em", textTransform: "uppercase", color: "var(--atlas-gold)",
          }}>Sovereign Readiness</div>
          <div style={{
            fontFamily: "var(--app-font-mono)", fontSize: 9, color: "var(--atlas-muted)",
            letterSpacing: "0.1em", textTransform: "uppercase",
          }}>{projectName ?? "Project"}</div>
        </div>
        <div style={{
          fontFamily: "var(--app-font-mono)", fontSize: 32, fontWeight: 700,
          color: "var(--atlas-gold)", lineHeight: 1.1, marginBottom: 18,
        }}>{score}%</div>

        {/* Mix bar */}
        <SectionLabel>Core Mix</SectionLabel>
        <div style={{ display: "flex", height: 8, borderRadius: 999, overflow: "hidden", marginBottom: 8 }}>
          <div style={{ width: `${frontend}%`, background: "var(--atlas-gold)" }} />
          <div style={{ width: `${backend}%`, background: "rgba(201,162,76,0.55)" }} />
          <div style={{ width: `${context}%`, background: "rgba(201,162,76,0.28)" }} />
        </div>
        <div style={{ display: "flex", gap: 14, marginBottom: 22, flexWrap: "wrap" }}>
          <MixLegend dot="var(--atlas-gold)" label="Frontend" pct={frontend} />
          <MixLegend dot="rgba(201,162,76,0.55)" label="Backend" pct={backend} />
          <MixLegend dot="rgba(201,162,76,0.28)" label="Context" pct={context} />
        </div>

        {/* Phases */}
        <SectionLabel>Architectural Phases</SectionLabel>
        <div style={{ display: "flex", flexDirection: "column", gap: 10, marginBottom: 22 }}>
          {phases.map((p) => (
            <div key={p.label}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", marginBottom: 4 }}>
                <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                  <span style={{ width: 6, height: 6, borderRadius: 999, background: toneColor(p.tone) }} />
                  <span style={{ fontSize: 13, color: "var(--atlas-fg)" }}>{p.label}</span>
                </div>
                <span style={{ fontFamily: "var(--app-font-mono)", fontSize: 11, fontWeight: 700, color: toneColor(p.tone) }}>
                  {p.pct}%
                </span>
              </div>
              <div style={{ height: 3, borderRadius: 999, background: "rgba(201,162,76,0.08)", overflow: "hidden" }}>
                <div style={{ width: `${p.pct}%`, height: "100%", background: toneColor(p.tone) }} />
              </div>
              <div style={{ fontSize: 11, color: "var(--atlas-muted)", marginTop: 3 }}>{p.note}</div>
            </div>
          ))}
        </div>

        {/* Atlas guidance */}
        <SectionLabel>Atlas Strategic Assessment</SectionLabel>
        <div style={{
          padding: "12px 14px", borderRadius: 10,
          background: "rgba(201,162,76,0.06)",
          border: "1px solid rgba(201,162,76,0.18)",
          fontSize: 13.5, lineHeight: 1.55, color: "var(--atlas-fg)",
        }}>
          {guidance}
        </div>
      </div>
    </div>
  );
}

function SectionLabel({ children }: { children: ReactNode }) {
  return (
    <div style={{
      fontFamily: "var(--app-font-mono)", fontSize: 8.5, fontWeight: 700,
      letterSpacing: "0.16em", textTransform: "uppercase", color: "var(--atlas-muted)",
      marginBottom: 8,
    }}>{children}</div>
  );
}

function MixLegend({ dot, label, pct }: { dot: string; label: string; pct: number }) {
  return (
    <div style={{ display: "inline-flex", alignItems: "center", gap: 6 }}>
      <span style={{ width: 6, height: 6, borderRadius: 999, background: dot }} />
      <span style={{ fontSize: 11, color: "var(--atlas-muted)" }}>{label}</span>
      <span style={{ fontFamily: "var(--app-font-mono)", fontSize: 11, fontWeight: 700, color: "var(--atlas-fg)" }}>{pct}%</span>
    </div>
  );
}

function ShellStatusChip({ projectId }: { projectId: number | null }) {

  const ps = useProjectState(projectId);
  const [, navigate] = useLocation();
  const [open, setOpen] = useState(false);
  const wrapRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!open) return;
    const onDoc = (e: MouseEvent) => {
      if (!wrapRef.current?.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") setOpen(false); };
    document.addEventListener("mousedown", onDoc);
    document.addEventListener("keydown", onKey);
    return () => { document.removeEventListener("mousedown", onDoc); document.removeEventListener("keydown", onKey); };
  }, [open]);

  if (projectId == null) return null;
  const count = ps.decisions?.length ?? 0;
  const active = !!ps.activeSession;
  const recent = (ps.decisions ?? []).slice(0, 4);
  const statusLabel = active ? "Session active" : "Idle";

  const go = (path: string) => { setOpen(false); navigate(path); };

  return (
    <div ref={wrapRef} style={{ position: "relative", flexShrink: 0 }}>
      <button
        type="button"
        onClick={() => setOpen(o => !o)}
        aria-haspopup="dialog"
        aria-expanded={open}
        aria-label={`${count} ledger ${count === 1 ? "entry" : "entries"}, ${statusLabel}. Open activity.`}
        style={{
          display: "inline-flex",
          alignItems: "center",
          gap: 6,
          padding: "3px 9px",
          borderRadius: 999,
          background: open ? "rgba(var(--atlas-muted-rgb),0.12)" : "rgba(var(--atlas-muted-rgb),0.06)",
          border: "1px solid rgba(var(--atlas-muted-rgb),0.14)",
          fontFamily: "var(--app-font-mono)",
          fontSize: "var(--ts-caption)",
          letterSpacing: "var(--ls-mono-cap)",
          lineHeight: 1,
          textTransform: "uppercase",
          color: "var(--atlas-muted)",
          whiteSpace: "nowrap",
          cursor: "pointer",
          userSelect: "none",
        }}
      >
        <span
          className={active ? "atlas-pulse-dot" : undefined}
          style={{
            width: 6,
            height: 6,
            borderRadius: "50%",
            background: active ? "#4ade80" : "transparent",
            border: active ? undefined : "1.5px solid rgba(var(--atlas-muted-rgb),0.5)",
            display: "inline-block",
          }}
        />
        <span style={{ fontWeight: 700, color: count > 0 ? "var(--atlas-gold)" : "var(--atlas-muted)" }}>{count}</span>
      </button>

      {open && (
        <div
          role="dialog"
          aria-label="Project activity"
          style={{
            position: "absolute",
            top: "calc(100% + 8px)",
            right: 0,
            width: 280,
            background: "var(--atlas-bg)",
            backdropFilter: "blur(20px)",
            border: "1px solid var(--atlas-border)",
            borderRadius: 12,
            boxShadow: "0 20px 60px rgba(0,0,0,0.55)",
            color: "var(--atlas-fg)",
            zIndex: 1000,
            overflow: "hidden",
            fontFamily: "var(--app-font-sans)",
          }}
        >
          <div style={{ padding: "12px 14px", borderBottom: "1px solid rgba(var(--atlas-muted-rgb),0.12)", display: "flex", alignItems: "center", gap: 8 }}>
            <span
              className={active ? "atlas-pulse-dot" : undefined}
              style={{ width: 8, height: 8, borderRadius: "50%", background: active ? "#4ade80" : "rgba(var(--atlas-muted-rgb),0.5)" }}
            />
            <span style={{ fontSize: 13, color: "var(--atlas-fg)", fontWeight: 600 }}>{statusLabel}</span>
            <span style={{ marginLeft: "auto", fontFamily: "var(--app-font-mono)", fontSize: 11, color: "var(--atlas-muted)", textTransform: "uppercase", letterSpacing: "var(--ls-mono-cap)" }}>
              {count} {count === 1 ? "entry" : "entries"}
            </span>
          </div>

          <div style={{ maxHeight: 240, overflowY: "auto" }}>
            {recent.length === 0 ? (
              <div style={{ padding: "18px 14px", fontSize: 12, color: "var(--atlas-muted)", textAlign: "center" }}>
                No committed entries yet. Decisions you commit will land here.
              </div>
            ) : (
              recent.map((e: any) => (
                <button
                  key={e.id}
                  type="button"
                  onClick={() => go(`/ledger?focus=${e.id}`)}
                  style={{
                    display: "block", width: "100%", textAlign: "left",
                    padding: "10px 14px", background: "transparent", border: "none",
                    borderBottom: "1px solid rgba(var(--atlas-muted-rgb),0.08)",
                    cursor: "pointer", color: "var(--atlas-fg)", fontSize: 13, lineHeight: 1.35,
                  }}
                  onMouseEnter={(ev) => (ev.currentTarget.style.background = "rgba(var(--atlas-muted-rgb),0.06)")}
                  onMouseLeave={(ev) => (ev.currentTarget.style.background = "transparent")}
                >
                  <div style={{ fontWeight: 600, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{e.title || "Untitled"}</div>
                  {e.summary && (
                    <div style={{ marginTop: 3, fontSize: 11, color: "var(--atlas-muted)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{e.summary}</div>
                  )}
                </button>
              ))
            )}
          </div>

          <button
            type="button"
            onClick={() => go("/ledger")}
            style={{
              display: "block", width: "100%", padding: "10px 14px",
              background: "transparent", border: "none", borderTop: "1px solid rgba(var(--atlas-muted-rgb),0.12)",
              cursor: "pointer", color: "var(--atlas-gold)", fontSize: 12, fontWeight: 600,
              fontFamily: "var(--app-font-mono)", textTransform: "uppercase", letterSpacing: "var(--ls-mono-cap)",
              textAlign: "center",
            }}
          >
            Open Ledger →
          </button>
        </div>
      )}
    </div>
  );
}


// ── Unified completion chip: one pie icon that rolls up Architecture,
// Decisions, Repo, and Live URL into a single ring. Tap to open a panel
// with the breakdown + mode toggle + recent ledger entries.
function ShellCompletionChip({ projectId }: { projectId: number | null }) {
  const ps = useProjectState(projectId);
  const [, navigate] = useLocation();


  const [open, setOpen] = useState(false);
  const [mode, setMode] = useState<ReadinessMode>(() => {
    try {
      const v = localStorage.getItem(READINESS_MODE_KEY) as ReadinessMode | null;
      return v === "arch" || v === "decisions" || v === "blended" ? v : "blended";
    } catch { return "blended"; }
  });
  const wrapRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!open) return;
    const onDoc = (e: Event) => {
      if (!wrapRef.current?.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") setOpen(false); };
    document.addEventListener("pointerdown", onDoc, true);
    document.addEventListener("touchstart", onDoc, true);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("pointerdown", onDoc, true);
      document.removeEventListener("touchstart", onDoc, true);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  if (projectId == null) return null;


  const proj = ps.project as {
    latestSnapshotScore?: number | null;
    nodeState?: ProjectNodeState | null;
    name?: string;
    linkedRepo?: string | null;
    previewUrl?: string | null;
  } | null;
  const ns = (proj?.nodeState ?? {}) as Record<string, unknown>;
  const decisionsCount = ps.decisions?.length ?? 0;
  const active = !!ps.activeSession;

  const ARCH_IDS = new Set(["auth", "db", "api", "state", "ui", "logic"]);
  let archTotal = 0, archResolved = 0, decTotal = 0, decResolved = 0;
  Object.entries(ns).forEach(([nid, raw]) => {
    const resolved = raw === true || (typeof raw === "object" && raw !== null && (raw as { resolved?: unknown }).resolved === true);
    if (ARCH_IDS.has(nid)) { archTotal++; if (resolved) archResolved++; }
    else { decTotal++; if (resolved) decResolved++; }
  });
  const archScore = archTotal === 0 ? 0 : Math.round((archResolved / archTotal) * 100);
  const decisionsScore = decTotal === 0 ? 0 : Math.round((decResolved / decTotal) * 100);
  const blendedScore = proj?.latestSnapshotScore ?? (computeBlendedScore(archScore, decisionsScore) || computeScoreFromNodeState(proj?.nodeState ?? null));

  const repoLinked = Boolean(proj?.linkedRepo);
  const previewLinked = Boolean(proj?.previewUrl);
  const repoPct = repoLinked ? 100 : 0;
  const urlPct = previewLinked ? 100 : 0;
  const completion = Math.round((archScore + decisionsScore + repoPct + urlPct) / 4);

  const displayScore = mode === "arch" ? archScore : mode === "decisions" ? decisionsScore : blendedScore;
  const meta = MODE_META[mode];

  const setNextMode = (m: ReadinessMode) => {
    setMode(m);
    try { localStorage.setItem(READINESS_MODE_KEY, m); } catch {}
  };

  const SIZE = 26;
  const R = 10;
  const CX = SIZE / 2;
  const CY = SIZE / 2;
  const C = 2 * Math.PI * R;
  const dash = (completion / 100) * C;
  const ringColor = completion >= 80 ? "#4ade80" : completion >= 50 ? "var(--atlas-gold)" : "rgba(252,165,165,0.9)";

  const go = (path: string) => { setOpen(false); navigate(path); };

  return (
    <div ref={wrapRef} style={{ position: "relative", flexShrink: 0 }}>
      <button
        type="button"
        onClick={() => setOpen(o => !o)}
        aria-haspopup="dialog"
        aria-expanded={open}
        aria-label={`Completion ${completion}%. ${decisionsCount} ledger entries. Open breakdown.`}
        title={`Completion ${completion}% — tap for breakdown`}
        style={{
          display: "inline-flex", alignItems: "center", gap: 6,
          padding: "3px 8px", borderRadius: 999,
          background: open ? "rgba(var(--atlas-muted-rgb),0.12)" : "transparent",
          border: "1px solid rgba(var(--atlas-muted-rgb),0.14)",
          cursor: "pointer", userSelect: "none", WebkitUserSelect: "none",
          color: "var(--atlas-fg)",
        }}
      >
        <svg width={SIZE} height={SIZE} viewBox={`0 0 ${SIZE} ${SIZE}`} aria-hidden="true" style={{ display: "block" }}>
          <circle cx={CX} cy={CY} r={R} fill="none" stroke="rgba(var(--atlas-muted-rgb),0.22)" strokeWidth={2.5} />
          <circle
            cx={CX} cy={CY} r={R} fill="none"
            stroke={ringColor} strokeWidth={2.5} strokeLinecap="round"
            strokeDasharray={`${dash} ${C - dash}`}
            transform={`rotate(-90 ${CX} ${CY})`}
            style={{ transition: "stroke-dasharray 240ms ease" }}
          />
          {active && (
            <circle cx={CX} cy={CY} r={2.2} fill="#4ade80" className="atlas-pulse-dot" />
          )}
        </svg>
        <span style={{
          fontFamily: "var(--app-font-mono)", fontSize: 10, fontWeight: 700,
          letterSpacing: "0.02em", lineHeight: 1,
        }}>{completion}%</span>
      </button>

      {open && (
        <div
          role="dialog"
          aria-label="Project completion"
          style={{
            position: "absolute",
            top: "calc(100% + 8px)",
            right: 0,
            width: 300,
            maxWidth: "calc(100vw - 24px)",
            background: "var(--atlas-bg)",
            backdropFilter: "blur(20px)",
            border: "1px solid var(--atlas-border)",
            borderRadius: 14,
            boxShadow: "0 20px 60px rgba(0,0,0,0.55)",
            color: "var(--atlas-fg)",
            zIndex: 1000,
            overflow: "hidden",
            fontFamily: "var(--app-font-sans)",
          }}
        >
          <div style={{ padding: "14px 14px 10px", borderBottom: "1px solid rgba(var(--atlas-muted-rgb),0.12)", display: "flex", alignItems: "center", gap: 10 }}>
            <div style={{
              fontFamily: "var(--app-font-mono)", fontSize: 18, fontWeight: 700, color: "var(--atlas-fg)", lineHeight: 1,
            }}>{completion}%</div>
            <div style={{ display: "flex", flexDirection: "column", gap: 2, minWidth: 0, flex: 1 }}>
              <div style={{ fontSize: 12, fontWeight: 600, color: "var(--atlas-fg)", lineHeight: 1.2 }}>Project completion</div>
              <div style={{ fontSize: 11, color: "var(--atlas-muted)", lineHeight: 1.2 }}>
                {active ? "Session active" : "Idle"} · {decisionsCount} {decisionsCount === 1 ? "entry" : "entries"}
              </div>
            </div>
            <button
              type="button"
              onClick={() => setOpen(false)}
              aria-label="Close"
              style={{
                width: 26, height: 26, borderRadius: 999, border: "1px solid rgba(var(--atlas-muted-rgb),0.18)",
                background: "transparent", color: "var(--atlas-muted)", cursor: "pointer",
                display: "inline-flex", alignItems: "center", justifyContent: "center", fontSize: 14, lineHeight: 1,
              }}
            >×</button>
          </div>

          <div style={{ padding: "10px 14px 8px", display: "flex", alignItems: "center", gap: 6, flexWrap: "wrap" }}>
            <span style={{ fontFamily: "var(--app-font-mono)", fontSize: 9, letterSpacing: "0.14em", textTransform: "uppercase", color: "var(--atlas-muted)", marginRight: 4 }}>View</span>
            {(["blended", "arch", "decisions"] as ReadinessMode[]).map((m) => {
              const isActive = mode === m;
              return (
                <button
                  key={m}
                  type="button"
                  onClick={() => setNextMode(m)}
                  style={{
                    padding: "3px 8px", borderRadius: 999, cursor: "pointer",
                    border: "1px solid " + (isActive ? "var(--atlas-gold)" : "rgba(var(--atlas-muted-rgb),0.18)"),
                    background: isActive ? "rgba(var(--atlas-muted-rgb),0.10)" : "transparent",
                    color: isActive ? "var(--atlas-gold)" : "var(--atlas-muted)",
                    fontFamily: "var(--app-font-mono)", fontSize: 9, fontWeight: 700,
                    letterSpacing: "0.12em", textTransform: "uppercase", lineHeight: 1,
                  }}
                >{MODE_META[m].abbr}</button>
              );
            })}
            <span style={{ marginLeft: "auto", fontFamily: "var(--app-font-mono)", fontSize: 11, fontWeight: 700, color: "var(--atlas-gold)" }}>{displayScore}%</span>
          </div>
          <div style={{ padding: "0 14px 10px", fontSize: 11, color: "var(--atlas-muted)", lineHeight: 1.35 }}>
            {meta.label} — {meta.description}
          </div>

          <div style={{ borderTop: "1px solid rgba(var(--atlas-muted-rgb),0.12)" }}>
            <CompletionRow
              label="Architecture"
              sub={`${archResolved}/${archTotal || 6} resolved`}
              pct={archScore}
              onClick={() => go("/master-map")}
            />
            <CompletionRow
              label="Decisions"
              sub={`${decResolved}/${decTotal} resolved · ${decisionsCount} committed`}
              pct={decisionsScore}
              onClick={() => go("/ledger")}
            />
            <CompletionRow
              label="Repo"
              sub={repoLinked ? "Linked" : "Not linked"}
              pct={repoPct}
              onClick={() => go("/workspace")}
            />
            <CompletionRow
              label="Live URL"
              sub={previewLinked ? "Set" : "Not set"}
              pct={urlPct}
              onClick={() => go("/workspace")}
            />
          </div>

          <button
            type="button"
            onClick={() => go("/ledger")}
            style={{
              display: "block", width: "100%", padding: "10px 14px",
              background: "transparent", border: "none", borderTop: "1px solid rgba(var(--atlas-muted-rgb),0.12)",
              cursor: "pointer", color: "var(--atlas-gold)", fontSize: 12, fontWeight: 600,
              fontFamily: "var(--app-font-mono)", textTransform: "uppercase", letterSpacing: "var(--ls-mono-cap)",
              textAlign: "center",
            }}
          >
            Open Ledger →
          </button>
        </div>
      )}
    </div>
  );
}

function CompletionRow({ label, sub, pct, onClick }: { label: string; sub: string; pct: number; onClick: () => void }) {
  const color = pct >= 80 ? "#4ade80" : pct >= 50 ? "var(--atlas-gold)" : pct > 0 ? "rgba(252,165,165,0.9)" : "rgba(var(--atlas-muted-rgb),0.5)";
  return (
    <button
      type="button"
      onClick={onClick}
      style={{
        display: "flex", alignItems: "center", gap: 10, width: "100%",
        padding: "10px 14px", background: "transparent", border: "none",
        borderBottom: "1px solid rgba(var(--atlas-muted-rgb),0.08)",
        cursor: "pointer", textAlign: "left", color: "var(--atlas-fg)",
      }}
      onMouseEnter={(e) => (e.currentTarget.style.background = "rgba(var(--atlas-muted-rgb),0.06)")}
      onMouseLeave={(e) => (e.currentTarget.style.background = "transparent")}
    >
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontSize: 13, fontWeight: 600, lineHeight: 1.2 }}>{label}</div>
        <div style={{ fontSize: 11, color: "var(--atlas-muted)", marginTop: 2, lineHeight: 1.2 }}>{sub}</div>
      </div>
      <div style={{ position: "relative", width: 56, height: 4, borderRadius: 999, background: "rgba(var(--atlas-muted-rgb),0.18)", overflow: "hidden" }}>
        <div style={{ position: "absolute", inset: 0, width: `${pct}%`, background: color, transition: "width 240ms ease" }} />
      </div>
      <div style={{ fontFamily: "var(--app-font-mono)", fontSize: 11, fontWeight: 700, color: color, minWidth: 32, textAlign: "right" }}>{pct}%</div>
    </button>
  );
}


function ShellFooterIcon({ icon }: { icon: ShellNavIcon }) {
  const common = {
    width: 20,
    height: 20,
    viewBox: "0 0 24 24",
    fill: "none",
    stroke: "currentColor",
    strokeWidth: 1.5,
    strokeLinecap: "round" as const,
    strokeLinejoin: "round" as const,
    "aria-hidden": true,
  };

  switch (icon) {
    case "home":
      return <svg {...common}><path d="M3 9l9-7 9 7v11a2 2 0 01-2 2H5a2 2 0 01-2-2z" /><polyline points="9,22 9,12 15,12 15,22" /></svg>;
    case "projects":
    case "files":
      return <svg {...common}><path d="M3 7.2c0-.9.7-1.6 1.6-1.6h4.3c.4 0 .8.2 1.1.5l1.3 1.4c.3.3.7.5 1.1.5h6c.9 0 1.6.7 1.6 1.6v8.8c0 .9-.7 1.6-1.6 1.6H4.6C3.7 20 3 19.3 3 18.4V7.2z" /></svg>;
    case "decisions":
    case "ledger":
      return <svg {...common}><circle cx="12" cy="12" r="10" /><path d="M2 12h20M12 2a15.3 15.3 0 014 10 15.3 15.3 0 01-4 10 15.3 15.3 0 01-4-10 15.3 15.3 0 014-10z" /></svg>;
    case "you":
      return <svg {...common}><path d="M20 21v-2a4 4 0 00-4-4H8a4 4 0 00-4 4v2" /><circle cx="12" cy="7" r="4" /></svg>;
    case "map":
    case "flow":
      return <svg {...common}><path d="M9 18l-6 3V6l6-3 6 3 6-3v15l-6 3-6-3z" /><path d="M9 3v15M15 6v15" /></svg>;
    case "forge":
      return <svg {...common}><path d="M14.7 6.3a4 4 0 01-5.4 5.4L4 17l3 3 5.3-5.3a4 4 0 015.4-5.4l-3 3-3-3 3-3z" /></svg>;
    case "chat":
      return <svg {...common}><path d="M21 15a4 4 0 01-4 4H8l-5 3V7a4 4 0 014-4h10a4 4 0 014 4z" /></svg>;
    case "preview":
      return <svg {...common}><path d="M2 12s3.5-6 10-6 10 6 10 6-3.5 6-10 6-10-6-10-6z" /><circle cx="12" cy="12" r="3" /></svg>;
  }
}

function ShellFooterNavItem({ item, visible }: { item: ShellNavItem; visible: boolean }) {
  return (
    <button
      type="button"
      onClick={item.action}
      style={{
        flex: 1,
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        justifyContent: "center",
        gap: 3,
        background: "none",
        border: "none",
        color: "rgba(var(--atlas-muted-rgb),0.55)",
        cursor: "pointer",
        opacity: visible ? 1 : 0,
        padding: "6px 0",
        transition: "opacity var(--motion-base) var(--ease-standard), color var(--motion-fast) var(--ease-standard)",
      }}
      onMouseEnter={(e) => (e.currentTarget.style.color = "var(--atlas-gold)")}
      onMouseLeave={(e) => (e.currentTarget.style.color = "rgba(var(--atlas-muted-rgb),0.55)")}
    >
      <ShellFooterIcon icon={item.icon} />
      <span
        style={{
          fontSize: "var(--ts-micro)",
          fontFamily: "var(--app-font-mono)",
          letterSpacing: "var(--ls-mono-cap)",
          textTransform: "uppercase",
        }}
      >
        {item.label}
      </span>
    </button>
  );
}

function ShellCenterButton({
  onTap,
  onLongPress,
}: {
  onTap: () => void;
  onLongPress: () => void;
}) {
  // Gesture thresholds (ms)
  // tap        : < 600
  // long-press : >= 600 → /projects
  const LONG_MS = 600;
  const MOVE_CANCEL_PX = 10;

  const downAtRef = useRef<number | null>(null);
  const startXYRef = useRef<{ x: number; y: number } | null>(null);
  const longTimerRef = useRef<number | null>(null);
  const cancelledRef = useRef(false);
  const [stage, setStage] = useState<"idle" | "tap" | "long">("idle");

  const haptic = useCallback((ms: number) => {
    try { if ("vibrate" in navigator) navigator.vibrate(ms); } catch {}
  }, []);

  const clearTimers = useCallback(() => {
    if (longTimerRef.current) { window.clearTimeout(longTimerRef.current); longTimerRef.current = null; }
  }, []);

  const reset = useCallback(() => {
    clearTimers();
    downAtRef.current = null;
    startXYRef.current = null;
    cancelledRef.current = false;
    setStage("idle");
  }, [clearTimers]);

  const handlePointerDown = useCallback((e: React.PointerEvent<HTMLButtonElement>) => {
    if (e.button !== undefined && e.button !== 0) return;
    try { (e.currentTarget as HTMLButtonElement).setPointerCapture(e.pointerId); } catch {}
    downAtRef.current = performance.now();
    startXYRef.current = { x: e.clientX, y: e.clientY };
    cancelledRef.current = false;
    setStage("tap");
    longTimerRef.current = window.setTimeout(() => {
      setStage("long");
      haptic(35);
    }, LONG_MS);
  }, [haptic]);

  const handlePointerMove = useCallback((e: React.PointerEvent<HTMLButtonElement>) => {
    if (!startXYRef.current) return;
    const dx = e.clientX - startXYRef.current.x;
    const dy = e.clientY - startXYRef.current.y;
    if (Math.hypot(dx, dy) > MOVE_CANCEL_PX) {
      cancelledRef.current = true;
      reset();
    }
  }, [reset]);

  const handlePointerUp = useCallback(() => {
    if (cancelledRef.current || downAtRef.current === null) { reset(); return; }
    const dur = performance.now() - downAtRef.current;
    clearTimers();
    setStage("idle");
    downAtRef.current = null;
    if (dur >= LONG_MS) onLongPress();
    else onTap();
  }, [clearTimers, reset, onTap, onLongPress]);

  const ringColor =
    stage === "long" ? "rgba(var(--atlas-gold-rgb),0.95)" :
    "rgba(var(--atlas-gold-rgb),0.55)";
  const ringSpread =
    stage === "long" ? "0 0 0 4px rgba(var(--atlas-gold-rgb),0.95), 0 0 28px rgba(var(--atlas-gold-rgb),0.5)" :
    "0 0 0 2px rgba(var(--atlas-gold-rgb),0.55), 0 0 18px rgba(var(--atlas-gold-rgb),0.18)";

  return (
    <div style={{ flex: 1, display: "flex", alignItems: "center", justifyContent: "center" }}>
      <button
        type="button"
        title="Tap: home · Medium press: last project · Long press: all projects"
        aria-label="Axiom. Tap for home, medium press for last active project, long press to open all projects."
        className="atlas-home-center-btn"
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={handlePointerUp}
        onPointerCancel={reset}
        onPointerLeave={(e) => { if (e.buttons === 0) return; reset(); }}
        onContextMenu={(e) => e.preventDefault()}
        style={{
          width: 56,
          height: 56,
          borderRadius: "50%",
          border: `2px solid ${ringColor}`,
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          cursor: "pointer",
          marginTop: -26,
          flexShrink: 0,
          touchAction: "manipulation",
          WebkitTapHighlightColor: "transparent",
          userSelect: "none",
          transform: stage === "long" ? "scale(1.06)" : "scale(1)",
          transition: "transform 120ms var(--ease-standard), box-shadow 120ms var(--ease-standard), border-color 120ms var(--ease-standard)",
          boxShadow: ringSpread,
        }}
      >
        <div style={{ width: 52, height: 52, borderRadius: "50%", overflow: "hidden", flexShrink: 0, pointerEvents: "none" }}>
          <svg viewBox="0 0 512 512" width="52" height="52" display="block">
            <defs>
              <radialGradient id="shell-center-purple" cx="50%" cy="50%" r="50%">
                <stop offset="0%" stopColor="var(--atlas-phosphor)" stopOpacity="0.18" />
                <stop offset="100%" stopColor="var(--atlas-bg)" stopOpacity="0" />
              </radialGradient>
              <radialGradient id="shell-center-gold" cx="50%" cy="40%" r="50%">
                <stop offset="0%" stopColor="var(--atlas-fg)" />
                <stop offset="50%" stopColor="var(--atlas-gold)" />
                <stop offset="100%" stopColor="var(--atlas-gold)" />
              </radialGradient>
            </defs>
            <circle cx="256" cy="256" r="256" fill="var(--atlas-bg)" />
            <circle cx="256" cy="256" r="256" fill="url(#shell-center-purple)" />
            <polygon points="256,130 178,390 216,390 268,188" fill="url(#shell-center-gold)" />
            <polygon points="256,130 334,390 296,390 244,188" fill="url(#shell-center-gold)" />
            <rect x="192" y="292" width="128" height="30" rx="5" fill="url(#shell-center-gold)" />
          </svg>
        </div>
      </button>
    </div>
  );
}

function ShellFooter() {
  const { currentDepth, activeProjectId } = useShellState();
  const [location, setLocation] = useLocation();
  const isMobile = useIsMobile();
  const [renderDepth, setRenderDepth] = useState<ShellDepth>(currentDepth);
  const [itemsVisible, setItemsVisible] = useState(true);

  useEffect(() => {
    if (currentDepth === renderDepth) return;
    setItemsVisible(false);
    const fadeOut = window.setTimeout(() => {
      setRenderDepth(currentDepth);
      window.requestAnimationFrame(() => setItemsVisible(true));
    }, 200);
    return () => window.clearTimeout(fadeOut);
  }, [currentDepth, renderDepth]);

  const openProjectTab = useCallback((tab: "chat" | "ledger" | "files" | "preview" | "flow" | "forge") => {
    if (!activeProjectId) {
      // Footer fallback: MAP/FLOW with no committed project → global master map
      if (tab === "flow") {
        setLocation("/map");
        return;
      }
      setLocation("/projects");
      return;
    }
    const rightPanelTab = tab === "flow" ? "map" : tab;
    try {
      sessionStorage.setItem("atlas-open-tab", rightPanelTab);
      sessionStorage.setItem("atlas-shell-open-tab", tab);
    } catch {}
    const query = tab === "flow" ? "?view=flow" : tab === "chat" ? "" : `?view=${tab}`;
    setLocation(`/project/${activeProjectId}${query}`);
    window.dispatchEvent(new CustomEvent("axiom:shell-open-tab", { detail: { tab } }));
  }, [activeProjectId, setLocation]);

  const scrollHomeConversationToTop = useCallback(() => {
    const homeSurface = document.querySelector<HTMLElement>(".atlas-home-bg");
    if (homeSurface) {
      homeSurface.scrollTo({ top: 0, behavior: "smooth" });
      return;
    }
    window.scrollTo({ top: 0, behavior: "smooth" });
  }, []);

  const centerAction = useCallback(() => {
    if (currentDepth === "active") {
      scrollHomeConversationToTop();
      return;
    }
    setLocation("/home");
  }, [currentDepth, scrollHomeConversationToTop, setLocation]);

  const openLastProject = useCallback(() => {
    let lastId: string | null = null;
    try {
      lastId = localStorage.getItem("atlas-last-project") || localStorage.getItem("atlas-last-project-id");
    } catch {}
    if (lastId && lastId !== "null" && lastId !== "undefined") {
      setLocation(`/project/${lastId}`);
    } else {
      setLocation("/projects");
    }
  }, [setLocation]);

  const openAllProjects = useCallback(() => {
    setLocation("/projects");
  }, [setLocation]);


  const navItems = useMemo<[ShellNavItem, ShellNavItem, ShellNavItem, ShellNavItem]>(() => {
    if (renderDepth === "operational") {
      return [
        { label: "Chat", icon: "chat", action: () => openProjectTab("chat") },
        { label: "Ledger", icon: "ledger", action: () => openProjectTab("ledger") },
        { label: "Preview", icon: "preview", action: () => openProjectTab("preview") },
        { label: "Flow", icon: "flow", action: () => openProjectTab("flow") },
      ];
    }
    return [
      { label: "Home", icon: "home", action: () => setLocation("/home") },
      {
        label: "Projects",
        icon: "projects",
        action: () => {
          if (location === "/projects") {
            openLastProject();
          } else {
            setLocation("/projects");
          }
        },
      },
      { label: "Decisions", icon: "decisions", action: () => setLocation("/ledger") },
      { label: "You", icon: "you", action: () => setLocation("/you") },
    ];
  }, [openProjectTab, renderDepth, setLocation, location, openLastProject]);

  if (!isMobile) return null;

  return (
    <footer className="atlas-mobile-footer" style={{ position: "fixed", bottom: 0, left: 0, right: 0, zIndex: 250, overflow: "visible" }}>
      <svg
        style={{ position: "absolute", bottom: 0, left: 0, width: "100%", height: 76, overflow: "visible", pointerEvents: "none" }}
        preserveAspectRatio="none"
        viewBox="0 0 390 64"
      >
        <path
          d="M0,0 L148,0 C163,0 172,22 195,22 C218,22 227,0 242,0 L390,0 L390,64 L0,64 Z"
          fill="var(--atlas-nav-arch-fill)"
        />
        <path
          d="M0,0.5 L148,0.5 C163,0.5 172,22 195,22 C218,22 227,0.5 242,0.5 L390,0.5"
          fill="none"
          stroke="rgba(var(--atlas-gold-rgb),0.2)"
          strokeWidth="1"
          vectorEffect="non-scaling-stroke"
        />
      </svg>

      <div
        style={{
          position: "relative",
          display: "flex",
          alignItems: "center",
          height: 64,
          paddingBottom: "max(env(safe-area-inset-bottom), 6px)",
          zIndex: 1,
        }}
      >
        <ShellFooterNavItem item={navItems[0]} visible={itemsVisible} />
        <ShellFooterNavItem item={navItems[1]} visible={itemsVisible} />
        <ShellCenterButton onTap={centerAction} onLongPress={openAllProjects} />
        <ShellFooterNavItem item={navItems[2]} visible={itemsVisible} />
        <ShellFooterNavItem item={navItems[3]} visible={itemsVisible} />
      </div>
    </footer>
  );
}

export function UnifiedShell({ children }: { children: ReactNode }) {
  const [location] = useLocation();
  const [currentDepth, setCurrentDepth] = useState<ShellDepth>(() => depthFromPath(location));
  const [activeProjectId, setActiveProjectIdState] = useState<number | null>(() => projectIdFromPath(location));
  const [activeConversationTitle, setActiveConversationTitleState] = useState<string | null>(null);

  useEffect(() => {
    const projectId = projectIdFromPath(location);
    if (projectId != null) {
      setCurrentDepth("operational");
      setActiveProjectIdState(projectId);
      setActiveConversationTitleState(null);
    } else {
      setActiveProjectIdState(null);
    }
  }, [location]);

  const setDepth = useCallback((depth: ShellDepth) => {
    setCurrentDepth(depth);
  }, []);

  const setActiveProjectId = useCallback((id: number | null) => {
    setActiveProjectIdState(id);
  }, []);

  const setActiveConversationTitle = useCallback((title: string | null) => {
    setActiveConversationTitleState(title);
  }, []);

  const value = useMemo<ShellState>(() => ({
    currentDepth,
    setDepth,
    activeProjectId,
    setActiveProjectId,
    activeConversationTitle,
    setActiveConversationTitle,
  }), [activeConversationTitle, activeProjectId, currentDepth, setActiveConversationTitle, setActiveProjectId, setDepth]);

  const shellBackgroundImage = currentDepth === "operational"
    ? "none"
    : currentDepth === "active"
      ? "linear-gradient(rgba(var(--atlas-bg-rgb),0.4), rgba(var(--atlas-bg-rgb),0.4)), var(--atlas-home-bg-gradient)"
      : "var(--atlas-home-bg-gradient)";
  const contentMaxWidth = currentDepth === "operational"
    ? "100%"
    : currentDepth === "active"
      ? 780
      : 680;
  const contentPadding = currentDepth === "operational"
    ? 0
    : "0 clamp(14px, 4vw, 24px)";

  return (
    <ShellStateContext.Provider value={value}>
      <div
        data-shell-depth={currentDepth}
        style={{
          position: "relative",
          width: "100%",
          height: "100%",
          minHeight: "100dvh",
          overflow: "hidden",
          backgroundColor: "var(--atlas-bg)",
          backgroundImage: shellBackgroundImage,
          backgroundRepeat: "no-repeat",
          backgroundSize: "cover",
          color: "var(--atlas-fg)",
          isolation: "isolate",
          transition: "background-color var(--motion-deliberate) var(--ease-out-soft), background-image var(--motion-deliberate) var(--ease-out-soft)",
        }}
      >
        <div
          aria-hidden
          style={{
            position: "fixed",
            inset: 0,
            zIndex: 0,
            pointerEvents: "none",
            background: currentDepth === "operational"
              ? "transparent"
              : "var(--atlas-home-atmosphere)",
            opacity: currentDepth === "ambient" ? 0.9 : currentDepth === "active" ? 0.54 : 0,
            transition: "opacity var(--motion-deliberate) var(--ease-out-soft), background var(--motion-deliberate) var(--ease-out-soft)",
          }}
        />
        <div
          aria-hidden
          style={{
            position: "fixed",
            top: 0,
            left: 0,
            right: 0,
            zIndex: 1,
            height: 1,
            pointerEvents: "none",
            background: "rgba(var(--atlas-gold-rgb), 0.15)",
            opacity: currentDepth === "operational" ? 1 : 0,
            transition: "opacity var(--motion-slow) var(--ease-out-soft)",
          }}
        />
        <header
          className="atlas-app-header"
          style={{
            position: "fixed",
            top: 1,
            left: 0,
            right: 0,
            zIndex: 20,
            height: 50,
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            gap: 12,
            padding: "0 clamp(14px, 4vw, 24px)",
            borderBottom: currentDepth === "ambient" ? "none" : undefined,
            boxShadow: "none",
            opacity: 1,
            background: currentDepth === "ambient" ? "transparent" : undefined,
            backdropFilter: currentDepth === "ambient" ? "none" : undefined,
            transition: "opacity var(--motion-deliberate) var(--ease-out-soft), background var(--motion-deliberate) var(--ease-out-soft), backdrop-filter var(--motion-deliberate) var(--ease-out-soft), border-color var(--motion-deliberate) var(--ease-out-soft)",
          }}
        >
          <div style={{ flexShrink: 0, minWidth: 0, position: "relative", zIndex: 2 }}>
            <ShellWordmark />
          </div>
          {/* True viewport-centered switcher — absolutely positioned so left/right cluster widths don't shift it off-center. */}
          <div
            style={{
              position: "absolute",
              left: "50%",
              top: "50%",
              transform: "translate(-50%, -50%)",
              display: "flex",
              justifyContent: "center",
              pointerEvents: "auto",
              maxWidth: "min(60vw, 320px)",
              zIndex: 1,
            }}
          >
            {activeProjectId != null ? (
              <ShellProjectSwitcher projectId={activeProjectId} />
            ) : (
              <ShellConversationTitle title={location === "/home" ? activeConversationTitle : null} />
            )}
          </div>
          <div style={{ display: "flex", alignItems: "center", gap: 8, flexShrink: 0, position: "relative", zIndex: 2 }}>
            <ShellCompletionChip projectId={activeProjectId} />
            <UserMenuDropdown onOpenProfile={() => window.dispatchEvent(new CustomEvent("axiom:open-account-hub"))} />
          </div>

        </header>
        <div
          style={{
            position: "relative",
            zIndex: 2,
            width: "100%",
            height: "100%",
            minHeight: "100dvh",
            maxWidth: contentMaxWidth,
            margin: "0 auto",
            padding: contentPadding,
            transition: "all var(--motion-deliberate) var(--ease-out-soft)",
          }}
        >
          {children}
        </div>
        {/* ShellFooter intentionally not rendered — UnifiedContextDock owns the bottom nav.
            Two fixed footers at bottom:0 caused tap collisions. */}
      </div>
    </ShellStateContext.Provider>
  );
}
