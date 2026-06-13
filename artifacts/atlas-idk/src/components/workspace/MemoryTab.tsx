import { useState } from "react";
import { useGetProject, getGetProjectQueryKey, updateProject, useUpdateProject } from "@workspace/api-client-react";
import type React from "react";
import { useQueryClient } from "@tanstack/react-query";
import { LoadingSpinner } from "@/components/ui/loading-spinner";

export function MemoryTab({ projectId }: { projectId: number }) {
  const queryClient = useQueryClient();
  const { data: project, isLoading } = useGetProject(projectId, {
    query: { queryKey: getGetProjectQueryKey(projectId) },
  });
  const updateProject = useUpdateProject();
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState("");
  const [saving, setSaving] = useState(false);

  const memory = project?.memory ?? "";

  const startEdit = () => {
    setDraft(memory);
    setEditing(true);
  };

  const save = async () => {
    setSaving(true);
    updateProject.mutate(
      { id: projectId, data: { memory: draft.trim() || null } },
      {
        onSuccess: () => {
          queryClient.invalidateQueries({ queryKey: getGetProjectQueryKey(projectId) });
          setEditing(false);
        },
        onSettled: () => setSaving(false),
      }
    );
  };

  const clear = async () => {
    if (!window.confirm("Clear all project memory? This cannot be undone.")) return;
    setSaving(true);
    updateProject.mutate(
      { id: projectId, data: { memory: null } },
      {
        onSuccess: () => {
          queryClient.invalidateQueries({ queryKey: getGetProjectQueryKey(projectId) });
        },
        onSettled: () => setSaving(false),
      }
    );
  };

  const sMono: React.CSSProperties = { fontFamily: "var(--app-font-mono)" };

  if (isLoading) {
    return (
      <div style={{ flex: 1, display: "flex", alignItems: "center", justifyContent: "center" }}>
        <LoadingSpinner size="sm" color="atlas" />
      </div>
    );
  }

  return (
    <div style={{ flex: 1, display: "flex", flexDirection: "column", overflow: "hidden" }}>
      {/* Header */}
      <div style={{ padding: "7px 10px", borderBottom: "1px solid var(--atlas-border)", flexShrink: 0, display: "flex", alignItems: "center", gap: 6 }}>
        <span style={{ fontSize: "var(--ts-micro)", fontFamily: "var(--app-font-mono)", letterSpacing: "0.08em", color: "var(--atlas-muted)", opacity: 0.6 }}>
          {(() => {
            try {
              const p = memory ? JSON.parse(memory) : null;
              const count = p?.entries?.length ?? 0;
              return count > 0 ? `memory · ${count} entries` : "project memory";
            } catch { return "project memory"; }
          })()}
        </span>
        <div style={{ marginLeft: "auto", display: "flex", gap: 4 }}>
          {!editing && memory && (
            <button
              onClick={clear}
              disabled={saving}
              style={{ background: "transparent", border: "none", cursor: "pointer", fontSize: "var(--ts-xs)", ...sMono, letterSpacing: "0.06em", color: "var(--atlas-muted)", opacity: 0.35, padding: "2px 4px" }}
              onMouseEnter={(e) => (e.currentTarget.style.opacity = "0.8")}
              onMouseLeave={(e) => (e.currentTarget.style.opacity = "0.35")}
            >
              clear
            </button>
          )}
          {!editing && (
            <button
              onClick={startEdit}
              style={{ background: "transparent", border: "none", cursor: "pointer", fontSize: "var(--ts-xs)", ...sMono, letterSpacing: "0.06em", color: "var(--atlas-gold)", opacity: 0.55, padding: "2px 4px" }}
              onMouseEnter={(e) => (e.currentTarget.style.opacity = "1")}
              onMouseLeave={(e) => (e.currentTarget.style.opacity = "0.55")}
            >
              edit
            </button>
          )}
          {editing && (
            <>
              <button
                onClick={() => setEditing(false)}
                style={{ background: "transparent", border: "none", cursor: "pointer", fontSize: "var(--ts-xs)", ...sMono, color: "var(--atlas-muted)", opacity: 0.4, padding: "2px 4px" }}
              >
                cancel
              </button>
              <button
                onClick={save}
                disabled={saving}
                style={{ background: "var(--atlas-ember)", border: "none", cursor: saving ? "not-allowed" : "pointer", fontSize: "var(--ts-xs)", ...sMono, letterSpacing: "0.08em", color: "var(--atlas-fg)", padding: "2px 8px", borderRadius: 4, opacity: saving ? 0.5 : 1 }}
              >
                {saving ? "saving…" : "save"}
              </button>
            </>
          )}
        </div>
      </div>

      {/* Content */}
      <div style={{ flex: 1, overflowY: "auto", padding: "10px 12px" }} className="scrollbar-none">
        {editing ? (
          <textarea
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            autoFocus
            style={{
              width: "100%", height: "100%", minHeight: 200, resize: "none",
              background: "var(--atlas-surface)", border: "1px solid rgba(201,162,76,0.25)",
              borderRadius: 6, color: "var(--atlas-fg)", fontSize: "var(--ts-caption)",
              ...sMono, lineHeight: 1.65, padding: "10px 12px",
              outline: "none", boxSizing: "border-box",
            }}
          />
        ) : (
          (() => {
            const tierConfig = [
              { tier: 1, label: "CORE", sublabel: "Never decays", color: "rgba(201,162,76,0.9)", bg: "rgba(201,162,76,0.08)", border: "rgba(201,162,76,0.25)" },
              { tier: 2, label: "PATTERNS", sublabel: "180 days", color: "rgba(99,130,239,0.9)", bg: "rgba(99,130,239,0.06)", border: "rgba(99,130,239,0.2)" },
              { tier: 3, label: "MILESTONES", sublabel: "90 days", color: "rgba(34,197,94,0.85)", bg: "rgba(34,197,94,0.06)", border: "rgba(34,197,94,0.18)" },
              { tier: 4, label: "CURRENT", sublabel: "30 days", color: "rgba(251,146,60,0.85)", bg: "rgba(251,146,60,0.06)", border: "rgba(251,146,60,0.18)" },
              { tier: 5, label: "FLEETING", sublabel: "7 days", color: "rgba(148,163,184,0.7)", bg: "rgba(148,163,184,0.04)", border: "rgba(148,163,184,0.15)" },
            ];

            let parsed: { v: number; entries: { tier: number; text: string; createdAt: string; retrievalCount: number }[] } | null = null;
            try { parsed = memory ? JSON.parse(memory) : null; } catch { parsed = null; }

            if (!parsed?.entries?.length) {
              return (
                <div style={{ padding: "48px 16px", textAlign: "center" }}>
                  <div style={{ fontSize: "var(--ts-micro)", color: "var(--atlas-muted)", opacity: 0.4, lineHeight: 1.7, fontFamily: "var(--app-font-mono)" }}>
                    Nothing here yet.<br />Atlas builds memory as you work.
                  </div>
                </div>
              );
            }

            const totalCount = parsed.entries.length;

            return (
              <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
                <div style={{ fontSize: "var(--ts-xs)", fontFamily: "var(--app-font-mono)", color: "var(--atlas-muted)", opacity: 0.45, letterSpacing: "0.08em", paddingBottom: 4, borderBottom: "1px solid var(--atlas-border)" }}>
                  {totalCount} MEMORY {totalCount === 1 ? "ENTRY" : "ENTRIES"} ACROSS {tierConfig.filter(t => parsed!.entries.some(e => e.tier === t.tier)).length} TIERS
                </div>
                {tierConfig.map(({ tier, label, sublabel, color, bg, border }) => {
                  const entries = parsed!.entries.filter(e => e.tier === tier);
                  if (entries.length === 0) return null;
                  return (
                    <div key={tier} style={{ display: "flex", flexDirection: "column", gap: 4 }}>
                      <div style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: 2 }}>
                        <span style={{ fontSize: "var(--ts-xs)", fontFamily: "var(--app-font-mono)", letterSpacing: "0.1em", color, fontWeight: 600 }}>T{tier} · {label}</span>
                        <span style={{ fontSize: "var(--ts-xs)", fontFamily: "var(--app-font-mono)", color: "var(--atlas-muted)", opacity: 0.4 }}>{sublabel}</span>
                        <span style={{ fontSize: "var(--ts-xs)", fontFamily: "var(--app-font-mono)", color, opacity: 0.5, marginLeft: "auto" }}>{entries.length}</span>
                      </div>
                      {entries.map((entry, i) => (
                        <div key={i} style={{ padding: "7px 10px", borderRadius: 6, background: bg, border: `1px solid ${border}`, fontSize: "var(--ts-caption)", color: "var(--atlas-fg)", lineHeight: 1.55, fontFamily: "var(--app-font-mono)", opacity: 0.85 }}>
                          {entry.text}
                        </div>
                      ))}
                    </div>
                  );
                })}
              </div>
            );
          })()
        )}
      </div>
    </div>
  );
}
