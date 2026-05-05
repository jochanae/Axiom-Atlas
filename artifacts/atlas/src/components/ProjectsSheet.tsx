import { useState } from "react";
import { useLocation } from "wouter";
import { useListProjects, useCreateProject, getListProjectsQueryKey } from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import { extractApiErrorMessage } from "../lib/atlas-utils";

function relTime(iso?: string | null) {
  if (!iso) return "";
  const diff = Date.now() - new Date(iso).getTime();
  const d = Math.floor(diff / 86400000);
  if (d === 0) return "today";
  if (d === 1) return "yesterday";
  if (d < 7) return `${d}d ago`;
  if (d < 30) return `${Math.floor(d / 7)}w ago`;
  return `${Math.floor(d / 30)}mo ago`;
}

const AVATAR_COLORS = [
  "#7C3AED", "#1D4ED8", "#065F46", "#92400E", "#9D174D",
  "#1E40AF", "#047857", "#B45309", "#6D28D9", "#0369A1",
];
function avatarBg(name: string) {
  let h = 0;
  for (let i = 0; i < name.length; i++) h = (h * 31 + name.charCodeAt(i)) % AVATAR_COLORS.length;
  return AVATAR_COLORS[h];
}

type Props = { onClose: () => void };

export function ProjectsSheet({ onClose }: Props) {
  const [, setLocation] = useLocation();
  const [newName, setNewName] = useState("");
  const [creating, setCreating] = useState(false);
  const [createError, setCreateError] = useState<string | null>(null);
  const { data: projects = [] } = useListProjects();
  const createProject = useCreateProject();
  const queryClient = useQueryClient();

  const handleCreate = () => {
    const name = newName.trim() || "New Operation " + Math.floor(Math.random() * 1000);
    setCreating(true);
    setCreateError(null);
    createProject.mutate({ data: { name } }, {
      onSuccess: (created) => {
        queryClient.invalidateQueries({ queryKey: getListProjectsQueryKey() });
        setNewName("");
        setCreating(false);
        if (created?.id) {
          onClose();
          setLocation(`/project/${created.id}`);
        }
      },
      onError: (err) => {
        setCreating(false);
        setCreateError(extractApiErrorMessage(err));
      },
    });
  };

  return (
    <div style={{ position: "fixed", inset: 0, zIndex: 200, display: "flex", flexDirection: "column", justifyContent: "flex-end" }}>
      {/* Scrim */}
      <div
        onClick={onClose}
        style={{ position: "absolute", inset: 0, background: "rgba(0,0,0,0.6)", backdropFilter: "blur(4px)" }}
      />

      {/* Sheet */}
      <div
        style={{
          position: "relative", zIndex: 1,
          width: "100%", maxWidth: 560, margin: "0 auto",
          background: "var(--atlas-surface)",
          borderRadius: "18px 18px 0 0",
          borderTop: "1px solid var(--atlas-border)",
          boxShadow: "0 -12px 60px rgba(0,0,0,0.5)",
          display: "flex", flexDirection: "column",
          maxHeight: "88vh",
          animation: "atlas-sheet-up 260ms cubic-bezier(.2,.8,.2,1) both",
        }}
      >
        {/* Drag handle */}
        <div style={{ width: 40, height: 4, borderRadius: 2, background: "var(--atlas-border)", margin: "12px auto 4px", flexShrink: 0 }} />

        {/* Header */}
        <div style={{
          display: "flex", alignItems: "center", gap: 10,
          padding: "8px 18px 12px", flexShrink: 0,
          borderBottom: "1px solid var(--atlas-border)",
        }}>
          <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="var(--atlas-gold)" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
            <path d="M22 19a2 2 0 01-2 2H4a2 2 0 01-2-2V5a2 2 0 012-2h5l2 3h9a2 2 0 012 2z" />
          </svg>
          <span style={{ fontSize: 14, fontWeight: 600, color: "var(--atlas-fg)", fontFamily: "var(--app-font-sans)", flex: 1 }}>
            My Projects
          </span>
          {projects.length > 0 && (
            <span style={{
              fontSize: 10, fontWeight: 700, fontFamily: "var(--app-font-mono)",
              background: "var(--atlas-surface-alt)", border: "1px solid var(--atlas-border)",
              color: "var(--atlas-muted)", borderRadius: 20, padding: "2px 8px",
            }}>
              {projects.length}
            </span>
          )}
          <button
            onClick={onClose}
            style={{ width: 28, height: 28, borderRadius: 8, border: "none", background: "transparent", cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center", color: "var(--atlas-muted)" }}
          >
            <svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round"><path d="M3 3l10 10M13 3L3 13" /></svg>
          </button>
        </div>

        {/* Grid */}
        <div style={{
          overflowY: "auto",
          WebkitOverflowScrolling: "touch",
          padding: "14px 14px 32px",
          display: "grid",
          gridTemplateColumns: "1fr 1fr",
          gap: 10,
        }}>
          {/* New Project card */}
          <div style={{
            border: "1.5px dashed var(--atlas-gold-border)",
            borderRadius: 12,
            overflow: "hidden",
            display: "flex", flexDirection: "column",
          }}>
            {/* Thumbnail area */}
            <div style={{
              flex: 1, minHeight: 100, display: "flex", flexDirection: "column",
              alignItems: "center", justifyContent: "center",
              background: "var(--atlas-surface-alt)",
              backgroundImage: "linear-gradient(var(--atlas-gold-border) 1px, transparent 1px), linear-gradient(90deg, var(--atlas-gold-border) 1px, transparent 1px)",
              backgroundSize: "22px 22px",
              padding: "14px 10px 10px",
            }}>
              <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="var(--atlas-gold)" strokeWidth="1.5" strokeLinecap="round"><path d="M12 5v14M5 12h14" /></svg>
              <span style={{ fontSize: 11, fontWeight: 600, color: "var(--atlas-gold)", fontFamily: "var(--app-font-mono)", letterSpacing: "0.06em", marginTop: 6, textTransform: "uppercase" }}>New Project</span>
            </div>
            {/* Input area */}
            <div style={{ padding: "10px", borderTop: "1px solid var(--atlas-border)", background: "var(--atlas-surface)" }}>
              <input
                value={newName}
                onChange={(e) => { setNewName(e.target.value); if (createError) setCreateError(null); }}
                onKeyDown={(e) => { if (e.key === "Enter") handleCreate(); }}
                placeholder="Project name"
                style={{
                  width: "100%", padding: "6px 8px", borderRadius: 6, marginBottom: createError ? 5 : 7,
                  background: "var(--atlas-surface-alt)", border: `1px solid ${createError ? "rgba(146,64,14,0.5)" : "var(--atlas-border)"}`,
                  color: "var(--atlas-fg)", fontSize: 11, outline: "none",
                  fontFamily: "var(--app-font-sans)",
                }}
                onFocus={(e) => (e.currentTarget.style.borderColor = createError ? "rgba(146,64,14,0.5)" : "var(--atlas-gold)")}
                onBlur={(e) => (e.currentTarget.style.borderColor = createError ? "rgba(146,64,14,0.5)" : "var(--atlas-border)")}
              />
              {createError && (
                <div style={{
                  marginBottom: 7, padding: "4px 8px", borderRadius: 4, fontSize: 10,
                  background: "rgba(146,64,14,0.1)",
                  border: "0.5px solid rgba(146,64,14,0.35)",
                  color: "var(--atlas-ember)",
                  fontFamily: "var(--app-font-mono)",
                  lineHeight: 1.4,
                }}>
                  {createError}
                </div>
              )}
              <button
                onClick={handleCreate}
                disabled={creating}
                style={{
                  width: "100%", padding: "6px", borderRadius: 6, border: "none",
                  background: "var(--atlas-ember)", color: "#fff",
                  fontSize: 10, fontWeight: 700, fontFamily: "var(--app-font-mono)",
                  letterSpacing: "0.1em", textTransform: "uppercase", cursor: "pointer",
                  opacity: creating ? 0.6 : 1,
                }}
              >
                {creating ? "Creating…" : "Create"}
              </button>
            </div>
          </div>

          {/* Project cards */}
          {projects.map((p) => {
            const letter = p.name?.[0]?.toUpperCase() ?? "?";
            const bg = avatarBg(p.name ?? "");
            return (
              <button
                key={p.id}
                onClick={() => { onClose(); setLocation(`/project/${p.id}`); }}
                style={{
                  border: "1px solid var(--atlas-border)", borderRadius: 12,
                  overflow: "hidden", display: "flex", flexDirection: "column",
                  background: "var(--atlas-surface)",
                  cursor: "pointer", textAlign: "left",
                  padding: 0, transition: "border-color 150ms ease",
                }}
                onMouseEnter={(e) => (e.currentTarget.style.borderColor = "var(--atlas-gold)")}
                onMouseLeave={(e) => (e.currentTarget.style.borderColor = "var(--atlas-border)")}
              >
                {/* Thumbnail */}
                <div style={{
                  height: 110, display: "flex", alignItems: "center", justifyContent: "center",
                  background: "var(--atlas-surface-alt)",
                  backgroundImage: "linear-gradient(var(--atlas-gold-border) 1px, transparent 1px), linear-gradient(90deg, var(--atlas-gold-border) 1px, transparent 1px)",
                  backgroundSize: "22px 22px",
                  position: "relative",
                }}>
                  <span style={{
                    fontSize: 48, fontWeight: 800, fontFamily: "var(--app-font-mono)",
                    color: "var(--atlas-muted)", opacity: 0.18, lineHeight: 1,
                    userSelect: "none",
                  }}>
                    {letter}
                  </span>
                </div>

                {/* Info strip */}
                <div style={{
                  display: "flex", alignItems: "center", gap: 8,
                  padding: "9px 10px", borderTop: "1px solid var(--atlas-border)",
                  flexShrink: 0,
                }}>
                  <div style={{
                    width: 26, height: 26, borderRadius: "50%", flexShrink: 0,
                    background: bg, display: "flex", alignItems: "center", justifyContent: "center",
                    fontSize: 11, fontWeight: 700, color: "#fff", fontFamily: "var(--app-font-mono)",
                  }}>
                    {letter}
                  </div>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontSize: 11.5, fontWeight: 600, color: "var(--atlas-fg)", fontFamily: "var(--app-font-sans)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                      {p.name}
                    </div>
                    <div style={{ fontSize: 9.5, color: "var(--atlas-muted)", fontFamily: "var(--app-font-mono)", opacity: 0.6, marginTop: 1 }}>
                      Edited {relTime(p.createdAt)}
                    </div>
                  </div>
                </div>
              </button>
            );
          })}
        </div>
      </div>

      <style>{`
        @keyframes atlas-sheet-up {
          from { transform: translateY(40px); opacity: 0; }
          to   { transform: translateY(0); opacity: 1; }
        }
      `}</style>
    </div>
  );
}
