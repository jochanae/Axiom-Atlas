import { useEffect, useState } from "react";
import { Session, createEntry, updateEntry, deleteEntry, updateProject, Project } from "@workspace/api-client-react";
import { useEntryReferrer } from "@/hooks/useEntryReferrer";
import { useLocation } from "wouter";
import { useListProjects, useListEntries, useCreateEntry, useUpdateEntry, useDeleteEntry, useUpdateProject, useListSessions, useGetSession, getListEntriesQueryKey, getListSessionsQueryKey, getGetSessionQueryKey,  } from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import { fetchGitHubStatus } from "@/hooks/useGitHub";

type Tool = "decision-editor" | "context-builder" | "diff-review" | "session-exporter" | "bulk-import" | "atlas-selfmap" | "connections";

export default function Workshop() {
  const [, setLocation] = useLocation();
  const { goBack } = useEntryReferrer();

  const [activeTool, setActiveTool] = useState<Tool | null>(null);
  const { data: projects = [] } = useListProjects();

  const tools: { id: Tool; icon: React.ReactNode; label: string; desc: string }[] = [
    {
      id: "decision-editor",
      icon: <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round"><path d="M12 20h9" /><path d="M16.5 3.5a2.121 2.121 0 013 3L7 19l-4 1 1-4L16.5 3.5z" /></svg>,
      label: "Decision Editor",
      desc: "Manually create and refine ledger entries outside of chat.",
    },
    {
      id: "context-builder",
      icon: <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="10" /><line x1="2" y1="12" x2="22" y2="12" /><path d="M12 2a15.3 15.3 0 014 10 15.3 15.3 0 01-4 10 15.3 15.3 0 01-4-10 15.3 15.3 0 014-10z" /></svg>,
      label: "Context Builder",
      desc: "Structure what Atlas knows before a session — goals, constraints, prior decisions.",
    },
    {
      id: "diff-review",
      icon: <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round"><polyline points="16 18 22 12 16 6" /><polyline points="8 6 2 12 8 18" /></svg>,
      label: "Diff Review",
      desc: "Compare proposed decisions against committed ones. Notice shifts before they go untracked.",
    },
    {
      id: "session-exporter",
      icon: <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round"><path d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8z" /><polyline points="14 2 14 8 20 8" /><line x1="16" y1="13" x2="8" y2="13" /><line x1="16" y1="17" x2="8" y2="17" /></svg>,
      label: "Session Exporter",
      desc: "Export a full session transcript with ledger entries attached.",
    },
    {
      id: "bulk-import",
      icon: <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round"><polygon points="12 2 2 7 12 12 22 7 12 2" /><polyline points="2 17 12 22 22 17" /><polyline points="2 12 12 17 22 12" /></svg>,
      label: "Bulk Import",
      desc: "Seed a project's ledger from a doc, spec, or prior decisions list.",
    },
    {
      id: "atlas-selfmap",
      icon: (
        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round">
          <circle cx="12" cy="12" r="3" />
          <path d="M12 1v4M12 19v4M4.22 4.22l2.83 2.83M16.95 16.95l2.83 2.83M1 12h4M19 12h4M4.22 19.78l2.83-2.83M16.95 7.05l2.83-2.83" />
        </svg>
      ),
      label: "Atlas Selfmap",
      desc: "Rebuild Atlas's structural index of the entire codebase — files, exports, and relationships.",
    },
    {
      id: "connections" as Tool,
      icon: (
        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round">
          <path d="M10 13a5 5 0 007.54.54l3-3a5 5 0 00-7.07-7.07l-1.72 1.71" />
          <path d="M14 11a5 5 0 00-7.54-.54l-3 3a5 5 0 007.07 7.07l1.71-1.71" />
        </svg>
      ),
      label: "Connections",
      desc: "Link your external tools — GitHub, Railway, Lovable, Cursor — so Atlas knows your stack.",
    },
  ];

  if (activeTool === "decision-editor") return <DecisionEditor projects={projects} onBack={() => setActiveTool(null)} />;
  if (activeTool === "context-builder") return <ContextBuilder projects={projects} onBack={() => setActiveTool(null)} />;
  if (activeTool === "diff-review") return <DiffReview projects={projects} onBack={() => setActiveTool(null)} />;
  if (activeTool === "session-exporter") return <SessionExporter projects={projects} onBack={() => setActiveTool(null)} />;
  if (activeTool === "bulk-import") return <BulkImport projects={projects} onBack={() => setActiveTool(null)} />;
  if (activeTool === "atlas-selfmap") return <AtlasSelfmap onBack={() => setActiveTool(null)} />;
  if (activeTool === "connections") return <ConnectionsTool onBack={() => setActiveTool(null)} />;

  return (
    <div style={{ height: "100dvh", overflowY: "auto", background: "transparent", color: "var(--atlas-fg)", display: "flex", flexDirection: "column", paddingBottom: 80 }}>
      <header style={{ position: "sticky", top: 0, zIndex: 20, background: "var(--atlas-bg)", borderBottom: "1px solid var(--atlas-border)", backdropFilter: "blur(12px)", flexShrink: 0 }}>
        <div style={{ padding: "10px 16px 10px", display: "flex", alignItems: "center", gap: 8 }}>
          <button type="button" onClick={() => goBack()} style={{ fontFamily: "var(--app-font-mono)", fontSize: 9, letterSpacing: "0.14em", textTransform: "uppercase", color: "var(--atlas-muted)", background: "transparent", border: "none", padding: 0, cursor: "pointer", opacity: 0.7 }}>
            ← Back
          </button>
        </div>

        <div style={{ padding: "0 16px 14px" }}>
          <h1 style={{ fontSize: 20, fontWeight: 600, letterSpacing: "-0.02em", margin: 0, color: "var(--atlas-fg)" }}>Workshop</h1>
          <p style={{ fontFamily: "var(--app-font-mono)", fontSize: 10, color: "var(--atlas-muted)", margin: "4px 0 0", letterSpacing: "0.06em", opacity: 0.6 }}>Power tools for working outside the chat</p>
        </div>
      </header>

      <main style={{ padding: "16px" }}>
        {projects.length > 0 && (
          <div style={{ marginBottom: 18, padding: "7px 12px", background: "color-mix(in oklab, var(--atlas-gold) 8%, transparent)", border: "1px solid rgba(201,162,76,0.2)", borderRadius: 8, display: "flex", alignItems: "center", gap: 8 }}>
            <span style={{ width: 5, height: 5, borderRadius: "50%", background: "var(--atlas-gold)", flexShrink: 0, display: "inline-block" }} />
            <span style={{ fontFamily: "var(--app-font-mono)", fontSize: 10, color: "var(--atlas-gold)", opacity: 0.8, letterSpacing: "0.06em" }}>
              {projects.length} project{projects.length !== 1 ? "s" : ""} in workspace
            </span>
          </div>
        )}
        <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
          {tools.map((tool) => (
            <button
              key={tool.id}
              type="button"
              onClick={() => setActiveTool(tool.id)}
              style={{ padding: "14px 16px", borderRadius: 10, background: "var(--atlas-surface)", border: "1px solid var(--atlas-border)", display: "flex", alignItems: "flex-start", gap: 14, textAlign: "left", cursor: "pointer", width: "100%", transition: "border-color 140ms ease" }}
              onMouseEnter={(e) => (e.currentTarget.style.borderColor = "rgba(201,162,76,0.35)")}
              onMouseLeave={(e) => (e.currentTarget.style.borderColor = "var(--atlas-border)")}
            >
              <span style={{ color: "var(--atlas-gold)", opacity: 0.8, flexShrink: 0, marginTop: 2 }}>{tool.icon}</span>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontSize: 13.5, fontWeight: 600, color: "var(--atlas-fg)", letterSpacing: "-0.01em", marginBottom: 4 }}>{tool.label}</div>
                <p style={{ fontSize: 12, color: "var(--atlas-muted)", margin: 0, lineHeight: 1.6, opacity: 0.75 }}>{tool.desc}</p>
              </div>
              <svg width="12" height="12" viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" style={{ color: "var(--atlas-muted)", opacity: 0.4, flexShrink: 0, marginTop: 4 }}><path d="M2 6h8M6 2l4 4-4 4" /></svg>
            </button>
          ))}
        </div>
      </main>
    </div>
  );
}

/* ─── Shared components ─── */

function ToolShell({ title, desc, onBack, children }: { title: string; desc: string; onBack: () => void; children: React.ReactNode }) {
  return (
    <div style={{ height: "100dvh", overflowY: "auto", background: "transparent", color: "var(--atlas-fg)", display: "flex", flexDirection: "column", paddingBottom: 80 }}>
      <header style={{ position: "sticky", top: 0, zIndex: 20, background: "var(--atlas-bg)", borderBottom: "1px solid var(--atlas-border)", backdropFilter: "blur(12px)" }}>
        <div style={{ padding: "10px 16px" }}>
          <button type="button" onClick={onBack} style={{ fontFamily: "var(--app-font-mono)", fontSize: 9, letterSpacing: "0.14em", textTransform: "uppercase", color: "var(--atlas-muted)", background: "transparent", border: "none", padding: 0, cursor: "pointer", opacity: 0.7 }}>
            ← Workshop
          </button>
        </div>
        <div style={{ padding: "0 16px 14px" }}>
          <h1 style={{ fontSize: 20, fontWeight: 600, letterSpacing: "-0.02em", margin: 0, color: "var(--atlas-fg)" }}>{title}</h1>
          <p style={{ fontFamily: "var(--app-font-mono)", fontSize: 10, color: "var(--atlas-muted)", margin: "4px 0 0", letterSpacing: "0.06em", opacity: 0.6 }}>{desc}</p>
        </div>
      </header>
      <main style={{ padding: "16px", flex: 1 }}>{children}</main>
    </div>
  );
}

function ProjectPicker({ projects, value, onChange }: { projects: { id: number; name: string }[]; value: number | null; onChange: (id: number) => void }) {
  return (
    <select
      value={value ?? ""}
      onChange={(e) => onChange(Number(e.target.value))}
      style={{ width: "100%", padding: "10px 12px", borderRadius: 8, background: "var(--atlas-surface)", border: "1px solid var(--atlas-border)", color: "var(--atlas-fg)", fontSize: 13, fontFamily: "inherit", outline: "none", marginBottom: 16 }}
    >
      <option value="">— Select a project —</option>
      {projects.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
    </select>
  );
}

function StatusBadge({ status }: { status: string }) {
  const colors: Record<string, string> = { committed: "var(--atlas-gold)", parked: "var(--atlas-muted)", draft: "#6b9fd4", archived: "#555" };
  return (
    <span style={{ fontFamily: "var(--app-font-mono)", fontSize: 8.5, letterSpacing: "0.12em", color: colors[status] ?? "var(--atlas-muted)", border: `1px solid ${colors[status] ?? "var(--atlas-border)"}`, padding: "1px 6px", borderRadius: 4, opacity: 0.9 }}>
      {status.toUpperCase()}
    </span>
  );
}

/* ─── Tool 1: Decision Editor ─── */
type Entry = { id: number; title: string; summary?: string | null; details?: string | null; status: string; severity: string; verb?: string | null };

function DecisionEditor({ projects, onBack }: { projects: { id: number; name: string }[]; onBack: () => void }) {
  const [projectId, setProjectId] = useState<number | null>(projects[0]?.id ?? null);
  const [editing, setEditing] = useState<Entry | null>(null);
  const [creating, setCreating] = useState(false);
  const qc = useQueryClient();
  const invalidate = () => { if (projectId) qc.invalidateQueries({ queryKey: getListEntriesQueryKey(projectId) }); };
  const { data: entries = [] } = useListEntries(projectId ?? 0, {}, { query: { enabled: !!projectId, queryKey: getListEntriesQueryKey(projectId ?? 0) } });
  const createEntry = useCreateEntry({ mutation: { onSuccess: invalidate } });
  const updateEntry = useUpdateEntry({ mutation: { onSuccess: invalidate } });
  const deleteEntry = useDeleteEntry({ mutation: { onSuccess: invalidate } });

  const grouped = {
    committed: entries.filter((e) => e.status === "committed"),
    draft: entries.filter((e) => e.status === "draft"),
    parked: entries.filter((e) => e.status === "parked"),
    archived: entries.filter((e) => e.status === "archived"),
  };

  return (
    <ToolShell title="Decision Editor" desc="Create and refine ledger entries outside of chat" onBack={onBack}>
      <ProjectPicker projects={projects} value={projectId} onChange={(id) => { setProjectId(id); setEditing(null); setCreating(false); }} />

      {projectId && (
        <>
          <button
            type="button"
            onClick={() => { setCreating(true); setEditing(null); }}
            style={{ width: "100%", padding: "10px", borderRadius: 8, border: "1px dashed rgba(201,162,76,0.35)", background: "transparent", color: "var(--atlas-gold)", fontSize: 12.5, fontFamily: "var(--app-font-mono)", letterSpacing: "0.06em", cursor: "pointer", marginBottom: 16, transition: "background 140ms" }}
            onMouseEnter={(e) => (e.currentTarget.style.background = "rgba(201,162,76,0.06)")}
            onMouseLeave={(e) => (e.currentTarget.style.background = "transparent")}
          >
            + New Entry
          </button>

          {creating && (
            <EntryForm
              initialStatus="draft"
              onSave={async (data) => {
                await createEntry.mutateAsync({ projectId: projectId!, data: data as any });
                setCreating(false);
              }}
              onCancel={() => setCreating(false)}
              saving={createEntry.isPending}
            />
          )}

          {(["committed", "draft", "parked", "archived"] as const).map((status) => {
            const group = grouped[status];
            if (!group.length) return null;
            return (
              <div key={status} style={{ marginBottom: 20 }}>
                <div style={{ fontFamily: "var(--app-font-mono)", fontSize: 9, letterSpacing: "0.14em", color: "var(--atlas-muted)", opacity: 0.6, marginBottom: 8, textTransform: "uppercase" }}>
                  {status} · {group.length}
                </div>
                <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                  {group.map((entry) => (
                    <div key={entry.id}>
                      {editing?.id === entry.id ? (
                        <EntryForm
                          initial={entry as Entry}
                          initialStatus={entry.status}
                          onSave={async (data) => {
                            await updateEntry.mutateAsync({ id: entry.id, data: data as any });
                            setEditing(null);
                          }}
                          onCancel={() => setEditing(null)}
                          saving={updateEntry.isPending}
                        />
                      ) : (
                        <div style={{ padding: "12px 14px", borderRadius: 8, background: "var(--atlas-surface)", border: "1px solid var(--atlas-border)" }}>
                          <div style={{ display: "flex", alignItems: "flex-start", gap: 10 }}>
                            <div style={{ flex: 1, minWidth: 0 }}>
                              <div style={{ fontSize: 13, fontWeight: 600, color: "var(--atlas-fg)", marginBottom: 4 }}>{entry.title}</div>
                              {entry.summary && <div style={{ fontSize: 11.5, color: "var(--atlas-muted)", opacity: 0.75, lineHeight: 1.5 }}>{entry.summary}</div>}
                            </div>
                            <div style={{ display: "flex", gap: 6, flexShrink: 0 }}>
                              <button type="button" onClick={() => { setEditing(entry as Entry); setCreating(false); }} style={{ fontSize: 11, color: "var(--atlas-gold)", background: "transparent", border: "1px solid rgba(201,162,76,0.3)", borderRadius: 5, padding: "3px 8px", cursor: "pointer" }}>Edit</button>
                              <button type="button" onClick={async () => { if (confirm("Delete this entry?")) { await deleteEntry.mutateAsync({ id: entry.id }); } }} style={{ fontSize: 11, color: "var(--atlas-ember)", background: "transparent", border: "1px solid rgba(146,64,14,0.3)", borderRadius: 5, padding: "3px 8px", cursor: "pointer" }}>Del</button>
                            </div>
                          </div>
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              </div>
            );
          })}

          {entries.length === 0 && !creating && (
            <div style={{ textAlign: "center", padding: "40px 20px", color: "var(--atlas-muted)", fontSize: 13, opacity: 0.5 }}>No entries yet. Create the first one above.</div>
          )}
        </>
      )}
    </ToolShell>
  );
}

function EntryForm({ initial, initialStatus, onSave, onCancel, saving }: { initial?: Entry; initialStatus: string; onSave: (data: Record<string, unknown>) => Promise<void>; onCancel: () => void; saving: boolean }) {
  const [title, setTitle] = useState(initial?.title ?? "");
  const [summary, setSummary] = useState(initial?.summary ?? "");
  const [details, setDetails] = useState(initial?.details ?? "");
  const [status, setStatus] = useState(initial?.status ?? initialStatus);
  const [severity, setSeverity] = useState(initial?.severity ?? "neutral");

  const fieldStyle = { width: "100%", padding: "9px 11px", borderRadius: 6, background: "var(--atlas-bg)", border: "1px solid var(--atlas-border)", color: "var(--atlas-fg)", fontSize: 13, fontFamily: "inherit", outline: "none", boxSizing: "border-box" as const };
  const labelStyle = { fontFamily: "var(--app-font-mono)", fontSize: 9, letterSpacing: "0.12em", color: "var(--atlas-muted)", opacity: 0.7, textTransform: "uppercase" as const, display: "block", marginBottom: 4 };

  return (
    <div style={{ padding: "14px", borderRadius: 10, border: "1px solid rgba(201,162,76,0.25)", background: "var(--atlas-surface)", marginBottom: 12 }}>
      <div style={{ marginBottom: 10 }}>
        <label style={labelStyle}>Title *</label>
        <input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Decision title" style={fieldStyle} />
      </div>
      <div style={{ marginBottom: 10 }}>
        <label style={labelStyle}>Summary</label>
        <input value={summary} onChange={(e) => setSummary(e.target.value)} placeholder="One-line summary" style={fieldStyle} />
      </div>
      <div style={{ marginBottom: 10 }}>
        <label style={labelStyle}>Details</label>
        <textarea value={details} onChange={(e) => setDetails(e.target.value)} placeholder="Additional context, rationale..." rows={3} style={{ ...fieldStyle, resize: "vertical" as const, lineHeight: 1.5 }} />
      </div>
      <div style={{ display: "flex", gap: 10, marginBottom: 12 }}>
        <div style={{ flex: 1 }}>
          <label style={labelStyle}>Status</label>
          <select value={status} onChange={(e) => setStatus(e.target.value)} style={{ ...fieldStyle }}>
            <option value="draft">Draft</option>
            <option value="committed">Committed</option>
            <option value="parked">Parked</option>
            <option value="archived">Archived</option>
          </select>
        </div>
        <div style={{ flex: 1 }}>
          <label style={labelStyle}>Severity</label>
          <select value={severity} onChange={(e) => setSeverity(e.target.value)} style={{ ...fieldStyle }}>
            <option value="neutral">Neutral</option>
            <option value="committed">Committed</option>
            <option value="parked">Parked</option>
            <option value="blocker">Flagged</option>
          </select>
        </div>
      </div>
      <div style={{ display: "flex", gap: 8 }}>
        <button type="button" onClick={onCancel} style={{ flex: 1, padding: "9px", borderRadius: 6, background: "transparent", border: "1px solid var(--atlas-border)", color: "var(--atlas-muted)", fontSize: 12.5, cursor: "pointer" }}>Cancel</button>
        <button
          type="button"
          disabled={!title.trim() || saving}
          onClick={async () => { if (title.trim()) await onSave({ title: title.trim(), summary: summary || null, details: details || null, status, severity }); }}
          style={{ flex: 2, padding: "9px", borderRadius: 6, background: title.trim() ? "var(--atlas-gold)" : "var(--atlas-border)", color: title.trim() ? "#0D0B09" : "var(--atlas-muted)", fontSize: 12.5, fontWeight: 700, cursor: title.trim() ? "pointer" : "default", border: "none", transition: "background 140ms" }}
        >
          {saving ? "Saving…" : initial ? "Save Changes" : "Create Entry"}
        </button>
      </div>
    </div>
  );
}

/* ─── Tool 2: Context Builder ─── */
function ContextBuilder({ projects, onBack }: { projects: { id: number; name: string; memory?: string | null }[]; onBack: () => void }) {
  const [projectId, setProjectId] = useState<number | null>(projects[0]?.id ?? null);
  const [memory, setMemory] = useState(() => projects[0]?.memory ?? "");
  const [saved, setSaved] = useState(false);
  const updateProject = useUpdateProject();

  const handleProjectChange = (id: number) => {
    const p = projects.find((x) => x.id === id);
    setProjectId(id);
    setMemory(p?.memory ?? "");
    setSaved(false);
  };

  const handleSave = async () => {
    if (!projectId) return;
    await updateProject.mutateAsync({ id: projectId, data: { memory: memory || null } });
    setSaved(true);
    setTimeout(() => setSaved(false), 2000);
  };

  return (
    <ToolShell title="Context Builder" desc="Pre-load what Atlas knows about a project before each session" onBack={onBack}>
      <ProjectPicker projects={projects} value={projectId} onChange={handleProjectChange} />

      {projectId && (
        <>
          <div style={{ marginBottom: 8 }}>
            <label style={{ fontFamily: "var(--app-font-mono)", fontSize: 9, letterSpacing: "0.12em", color: "var(--atlas-muted)", opacity: 0.7, textTransform: "uppercase", display: "block", marginBottom: 6 }}>
              Project Memory
            </label>
            <div style={{ fontFamily: "var(--app-font-mono)", fontSize: 10, color: "var(--atlas-muted)", opacity: 0.55, marginBottom: 10, lineHeight: 1.6 }}>
              This is injected at the start of every chat for this project. Write goals, constraints, key decisions, tech stack — anything Atlas should always know.
            </div>
            <textarea
              value={memory}
              onChange={(e) => { setMemory(e.target.value); setSaved(false); }}
              placeholder={"Goals: Build a strategic thinking partner for founders.\nStack: React + Vite, Express 5, PostgreSQL.\nConstraints: Mobile-first, Z Fold 6.\nKey decisions: No external auth providers except Google OAuth."}
              rows={14}
              style={{ width: "100%", padding: "12px", borderRadius: 8, background: "var(--atlas-surface)", border: "1px solid var(--atlas-border)", color: "var(--atlas-fg)", fontSize: 12.5, fontFamily: "var(--app-font-mono)", lineHeight: 1.7, resize: "vertical", outline: "none", boxSizing: "border-box" }}
            />
          </div>
          <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
            <button
              type="button"
              onClick={() => { setMemory(""); setSaved(false); }}
              style={{ padding: "9px 14px", borderRadius: 6, background: "transparent", border: "1px solid var(--atlas-border)", color: "var(--atlas-muted)", fontSize: 12, cursor: "pointer" }}
            >
              Clear
            </button>
            <button
              type="button"
              onClick={handleSave}
              disabled={updateProject.isPending}
              style={{ flex: 1, padding: "10px", borderRadius: 6, background: "var(--atlas-gold)", color: "#0D0B09", fontSize: 12.5, fontWeight: 700, border: "none", cursor: "pointer" }}
            >
              {saved ? "✓ Saved" : updateProject.isPending ? "Saving…" : "Save Context"}
            </button>
          </div>
          <div style={{ marginTop: 16, padding: "10px 12px", borderRadius: 6, background: "color-mix(in oklab, var(--atlas-gold) 5%, transparent)", border: "1px solid rgba(201,162,76,0.15)" }}>
            <div style={{ fontFamily: "var(--app-font-mono)", fontSize: 9.5, color: "var(--atlas-gold)", opacity: 0.7, lineHeight: 1.7 }}>
              Tip: You can also emit <code style={{ background: "rgba(201,162,76,0.1)", padding: "1px 4px", borderRadius: 3 }}>PROJECT_MEMORY: [fact]</code> in any chat — Atlas will auto-append it here.
            </div>
          </div>
        </>
      )}
    </ToolShell>
  );
}

/* ─── Tool 3: Diff Review ─── */
function DiffReview({ projects, onBack }: { projects: { id: number; name: string }[]; onBack: () => void }) {
  const [projectId, setProjectId] = useState<number | null>(projects[0]?.id ?? null);
  const qc = useQueryClient();
  const invalidate = () => { if (projectId) qc.invalidateQueries({ queryKey: getListEntriesQueryKey(projectId) }); };
  const { data: entries = [] } = useListEntries(projectId ?? 0, {}, { query: { enabled: !!projectId, queryKey: getListEntriesQueryKey(projectId ?? 0) } });
  const updateEntry = useUpdateEntry({ mutation: { onSuccess: invalidate } });
  const deleteEntry = useDeleteEntry({ mutation: { onSuccess: invalidate } });

  const drafts = entries.filter((e) => e.status === "draft");
  const committed = entries.filter((e) => e.status === "committed");

  const approve = async (id: number) => {
    await updateEntry.mutateAsync({ id, data: { status: "committed", severity: "committed" } });
  };
  const reject = async (id: number) => {
    if (confirm("Delete this draft entry?")) {
      await deleteEntry.mutateAsync({ id });
    }
  };
  const park = async (id: number) => {
    await updateEntry.mutateAsync({ id, data: { status: "parked", severity: "parked" } });
  };

  return (
    <ToolShell title="Diff Review" desc="Compare draft decisions against committed ones before they land" onBack={onBack}>
      <ProjectPicker projects={projects} value={projectId} onChange={(id) => setProjectId(id)} />

      {projectId && (
        <>
          {drafts.length === 0 ? (
            <div style={{ textAlign: "center", padding: "40px 20px", color: "var(--atlas-muted)", fontSize: 13, opacity: 0.5 }}>
              No draft entries to review. Drafts appear here when Atlas proposes a decision or you create one in Decision Editor.
            </div>
          ) : (
            <>
              <div style={{ fontFamily: "var(--app-font-mono)", fontSize: 9, letterSpacing: "0.14em", color: "var(--atlas-muted)", opacity: 0.55, marginBottom: 12, textTransform: "uppercase" }}>
                {drafts.length} draft{drafts.length !== 1 ? "s" : ""} pending review
              </div>
              <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
                {drafts.map((draft) => {
                  const possible = committed.filter((c) =>
                    c.title.toLowerCase().split(" ").some((word) => word.length > 4 && draft.title.toLowerCase().includes(word))
                  );
                  return (
                    <div key={draft.id} style={{ borderRadius: 10, border: "1px solid rgba(107,159,212,0.25)", overflow: "hidden" }}>
                      <div style={{ padding: "12px 14px", background: "rgba(107,159,212,0.06)" }}>
                        <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 6 }}>
                          <StatusBadge status="draft" />
                          <span style={{ fontFamily: "var(--app-font-mono)", fontSize: 9, color: "var(--atlas-muted)", opacity: 0.5 }}>PROPOSED</span>
                        </div>
                        <div style={{ fontSize: 13.5, fontWeight: 600, color: "var(--atlas-fg)", marginBottom: 4 }}>{draft.title}</div>
                        {draft.summary && <div style={{ fontSize: 12, color: "var(--atlas-muted)", opacity: 0.75, lineHeight: 1.5 }}>{draft.summary}</div>}
                      </div>

                      {possible.length > 0 && (
                        <div style={{ padding: "10px 14px", background: "rgba(146,64,14,0.06)", borderTop: "1px solid rgba(146,64,14,0.12)" }}>
                          <div style={{ fontFamily: "var(--app-font-mono)", fontSize: 9, color: "var(--atlas-ember)", opacity: 0.7, marginBottom: 6, letterSpacing: "0.08em" }}>POSSIBLE CONFLICTS</div>
                          {possible.slice(0, 2).map((c) => (
                            <div key={c.id} style={{ fontSize: 11.5, color: "var(--atlas-muted)", opacity: 0.75, padding: "4px 0", borderTop: "1px solid var(--atlas-border)" }}>
                              <StatusBadge status="committed" /> {c.title}
                            </div>
                          ))}
                        </div>
                      )}

                      <div style={{ display: "flex", gap: 8, padding: "10px 14px", borderTop: "1px solid var(--atlas-border)" }}>
                        <button type="button" onClick={() => reject(draft.id)} style={{ flex: 1, padding: "7px", borderRadius: 5, background: "transparent", border: "1px solid rgba(146,64,14,0.3)", color: "var(--atlas-ember)", fontSize: 11.5, cursor: "pointer" }}>Reject</button>
                        <button type="button" onClick={() => park(draft.id)} style={{ flex: 1, padding: "7px", borderRadius: 5, background: "transparent", border: "1px solid var(--atlas-border)", color: "var(--atlas-muted)", fontSize: 11.5, cursor: "pointer" }}>Park</button>
                        <button type="button" onClick={() => approve(draft.id)} style={{ flex: 2, padding: "7px", borderRadius: 5, background: "color-mix(in oklab, var(--atlas-gold) 15%, transparent)", border: "1px solid rgba(201,162,76,0.4)", color: "var(--atlas-gold)", fontSize: 11.5, fontWeight: 600, cursor: "pointer" }}>Commit →</button>
                      </div>
                    </div>
                  );
                })}
              </div>
            </>
          )}
        </>
      )}
    </ToolShell>
  );
}

/* ─── Tool 4: Session Exporter ─── */
function SessionExporter({ projects, onBack }: { projects: { id: number; name: string }[]; onBack: () => void }) {
  const [projectId, setProjectId] = useState<number | null>(projects[0]?.id ?? null);
  const [sessionId, setSessionId] = useState<number | null>(null);
  const { data: sessions = [] } = useListSessions(projectId ?? 0, { query: { enabled: !!projectId, queryKey: getListSessionsQueryKey(projectId ?? 0) } });
  const { data: sessionData } = useGetSession(sessionId ?? 0, { query: { enabled: !!sessionId, queryKey: getGetSessionQueryKey(sessionId ?? 0) } });
  const { data: entries = [] } = useListEntries(projectId ?? 0, {}, { query: { enabled: !!projectId, queryKey: getListEntriesQueryKey(projectId ?? 0) } });

  const handleExport = () => {
    if (!sessionData) return;
    const { session, messages } = sessionData;
    const sessionEntries = entries.filter((e) => (e as any).sessionId === session.id);

    const lines: string[] = [
      `# Session Export: ${session.title}`,
      `Project: ${projects.find((p) => p.id === projectId)?.name ?? "Unknown"}`,
      `Date: ${new Date(session.createdAt).toLocaleDateString()}`,
      `Messages: ${messages.length}`,
      ``,
      `---`,
      ``,
      `## Transcript`,
      ``,
    ];

    for (const msg of messages) {
      const role = msg.role === "user" ? "**You**" : "**Atlas**";
      lines.push(`${role}: ${msg.content}`);
      lines.push("");
    }

    if (sessionEntries.length > 0) {
      lines.push(`---`);
      lines.push(``);
      lines.push(`## Decisions from this session`);
      lines.push(``);
      for (const e of sessionEntries) {
        const status = e.status.toUpperCase();
        lines.push(`- [${status}] ${e.title}`);
        if (e.summary) lines.push(`  > ${e.summary}`);
      }
    }

    const blob = new Blob([lines.join("\n")], { type: "text/markdown" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `axiom-session-${session.id}-${session.title.toLowerCase().replace(/[^a-z0-9]+/g, "-")}.md`;
    a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <ToolShell title="Session Exporter" desc="Download a session transcript with its decisions attached" onBack={onBack}>
      <ProjectPicker projects={projects} value={projectId} onChange={(id) => { setProjectId(id); setSessionId(null); }} />

      {projectId && (
        <>
          {sessions.length === 0 ? (
            <div style={{ textAlign: "center", padding: "40px 20px", color: "var(--atlas-muted)", fontSize: 13, opacity: 0.5 }}>No sessions for this project yet.</div>
          ) : (
            <>
              <div style={{ fontFamily: "var(--app-font-mono)", fontSize: 9, letterSpacing: "0.14em", color: "var(--atlas-muted)", opacity: 0.55, marginBottom: 8, textTransform: "uppercase" }}>Select a session</div>
              <div style={{ display: "flex", flexDirection: "column", gap: 8, marginBottom: 16 }}>
                {[...sessions].reverse().map((s) => {
                  const sessionEntries = entries.filter((e) => (e as any).sessionId === s.id);
                  const isSelected = sessionId === s.id;
                  return (
                    <button
                      key={s.id}
                      type="button"
                      onClick={() => setSessionId(isSelected ? null : s.id)}
                      style={{ padding: "12px 14px", borderRadius: 8, background: isSelected ? "color-mix(in oklab, var(--atlas-gold) 8%, transparent)" : "var(--atlas-surface)", border: `1px solid ${isSelected ? "rgba(201,162,76,0.4)" : "var(--atlas-border)"}`, display: "flex", alignItems: "center", gap: 10, cursor: "pointer", textAlign: "left" }}
                    >
                      <div style={{ flex: 1 }}>
                        <div style={{ fontSize: 13, fontWeight: 600, color: "var(--atlas-fg)" }}>{s.title}</div>
                        <div style={{ fontFamily: "var(--app-font-mono)", fontSize: 9.5, color: "var(--atlas-muted)", opacity: 0.6, marginTop: 2 }}>
                          {s.messageCount} messages · {sessionEntries.length} decisions · {new Date(s.createdAt).toLocaleDateString()}
                        </div>
                      </div>
                      {isSelected && <span style={{ color: "var(--atlas-gold)", fontSize: 14 }}>✓</span>}
                    </button>
                  );
                })}
              </div>

              {sessionId && sessionData && (
                <div>
                  <div style={{ padding: "12px 14px", borderRadius: 8, background: "var(--atlas-surface)", border: "1px solid var(--atlas-border)", marginBottom: 12 }}>
                    <div style={{ fontFamily: "var(--app-font-mono)", fontSize: 9, opacity: 0.5, marginBottom: 6, letterSpacing: "0.1em" }}>EXPORT PREVIEW</div>
                    <div style={{ fontSize: 12, color: "var(--atlas-muted)", lineHeight: 1.7, opacity: 0.8 }}>
                      <div>· {sessionData.messages.length} messages</div>
                      <div>· {entries.filter((e) => (e as any).sessionId === sessionId).length} decisions</div>
                      <div>· Markdown format (.md)</div>
                    </div>
                  </div>
                  <button
                    type="button"
                    onClick={handleExport}
                    style={{ width: "100%", padding: "11px", borderRadius: 8, background: "var(--atlas-gold)", color: "#0D0B09", fontSize: 13, fontWeight: 700, border: "none", cursor: "pointer" }}
                  >
                    Download Export
                  </button>
                </div>
              )}
            </>
          )}
        </>
      )}
    </ToolShell>
  );
}

/* ─── Tool 5: Bulk Import ─── */
function BulkImport({ projects, onBack }: { projects: { id: number; name: string }[]; onBack: () => void }) {
  const [projectId, setProjectId] = useState<number | null>(projects[0]?.id ?? null);
  const [text, setText] = useState("");
  const [status, setStatus] = useState<"draft" | "committed" | "parked">("committed");
  const [result, setResult] = useState<{ created: number; skipped: number } | null>(null);
  const [loading, setLoading] = useState(false);
  const createEntry = useCreateEntry();

  const parseLines = (raw: string) =>
    raw
      .split("\n")
      .map((l) => l.replace(/^[\-\*\•\d\.\)]+\s*/, "").trim())
      .filter((l) => l.length > 2);

  const handleImport = async () => {
    if (!projectId) return;
    const lines = parseLines(text);
    if (!lines.length) return;
    setLoading(true);
    let created = 0;
    let skipped = 0;
    for (const line of lines) {
      try {
        await createEntry.mutateAsync({ projectId: projectId!, data: { title: line, status, severity: status === "committed" ? "committed" : status === "parked" ? "parked" : "neutral" } });
        created++;
      } catch {
        skipped++;
      }
    }
    setResult({ created, skipped });
    setText("");
    setLoading(false);
  };

  const preview = parseLines(text);

  return (
    <ToolShell title="Bulk Import" desc="Seed a project's ledger from a list of decisions" onBack={onBack}>
      <ProjectPicker projects={projects} value={projectId} onChange={(id) => { setProjectId(id); setResult(null); }} />

      {projectId && (
        <>
          {result && (
            <div style={{ marginBottom: 14, padding: "12px 14px", borderRadius: 8, background: "color-mix(in oklab, var(--atlas-gold) 8%, transparent)", border: "1px solid rgba(201,162,76,0.3)" }}>
              <div style={{ fontFamily: "var(--app-font-mono)", fontSize: 11, color: "var(--atlas-gold)" }}>
                ✓ {result.created} entries created{result.skipped > 0 ? `, ${result.skipped} skipped` : ""}
              </div>
            </div>
          )}

          <div style={{ marginBottom: 12 }}>
            <label style={{ fontFamily: "var(--app-font-mono)", fontSize: 9, letterSpacing: "0.12em", color: "var(--atlas-muted)", opacity: 0.7, textTransform: "uppercase", display: "block", marginBottom: 6 }}>Import as</label>
            <div style={{ display: "flex", gap: 8 }}>
              {(["committed", "draft", "parked"] as const).map((s) => (
                <button
                  key={s}
                  type="button"
                  onClick={() => setStatus(s)}
                  style={{ flex: 1, padding: "7px", borderRadius: 6, background: status === s ? "color-mix(in oklab, var(--atlas-gold) 12%, transparent)" : "transparent", border: `1px solid ${status === s ? "rgba(201,162,76,0.5)" : "var(--atlas-border)"}`, color: status === s ? "var(--atlas-gold)" : "var(--atlas-muted)", fontSize: 11, fontFamily: "var(--app-font-mono)", letterSpacing: "0.06em", cursor: "pointer" }}
                >
                  {s.toUpperCase()}
                </button>
              ))}
            </div>
          </div>

          <div style={{ marginBottom: 10 }}>
            <label style={{ fontFamily: "var(--app-font-mono)", fontSize: 9, letterSpacing: "0.12em", color: "var(--atlas-muted)", opacity: 0.7, textTransform: "uppercase", display: "block", marginBottom: 6 }}>
              Paste decisions (one per line)
            </label>
            <textarea
              value={text}
              onChange={(e) => { setText(e.target.value); setResult(null); }}
              placeholder={"- We use PostgreSQL for all data storage\n- Authentication is handled by Google OAuth only\n- No external UI component libraries\n- All API routes require auth middleware"}
              rows={10}
              style={{ width: "100%", padding: "12px", borderRadius: 8, background: "var(--atlas-surface)", border: "1px solid var(--atlas-border)", color: "var(--atlas-fg)", fontSize: 12.5, fontFamily: "var(--app-font-mono)", lineHeight: 1.7, resize: "vertical", outline: "none", boxSizing: "border-box" }}
            />
          </div>

          {preview.length > 0 && (
            <div style={{ marginBottom: 12, padding: "10px 12px", borderRadius: 6, background: "var(--atlas-surface)", border: "1px solid var(--atlas-border)" }}>
              <div style={{ fontFamily: "var(--app-font-mono)", fontSize: 9, opacity: 0.5, marginBottom: 6, letterSpacing: "0.1em" }}>
                PARSED: {preview.length} DECISION{preview.length !== 1 ? "S" : ""}
              </div>
              {preview.slice(0, 5).map((line, i) => (
                <div key={i} style={{ fontSize: 11.5, color: "var(--atlas-muted)", opacity: 0.8, padding: "2px 0", borderTop: i > 0 ? "1px solid var(--atlas-border)" : "none" }}>
                  {line}
                </div>
              ))}
              {preview.length > 5 && <div style={{ fontSize: 11, color: "var(--atlas-muted)", opacity: 0.5, marginTop: 4 }}>+{preview.length - 5} more</div>}
            </div>
          )}

          <button
            type="button"
            disabled={!text.trim() || loading || preview.length === 0}
            onClick={handleImport}
            style={{ width: "100%", padding: "11px", borderRadius: 8, background: preview.length > 0 && !loading ? "var(--atlas-gold)" : "var(--atlas-border)", color: preview.length > 0 && !loading ? "#0D0B09" : "var(--atlas-muted)", fontSize: 13, fontWeight: 700, border: "none", cursor: preview.length > 0 && !loading ? "pointer" : "default", transition: "background 140ms" }}
          >
            {loading ? `Importing ${preview.length} decisions…` : `Import ${preview.length > 0 ? preview.length + " " : ""}Decision${preview.length !== 1 ? "s" : ""}`}
          </button>
        </>
      )}
    </ToolShell>
  );
}

/* ─── Tool 7: Connections ─── */
type Connection = {
  id: number;
  type: "github" | "railway" | "lovable" | "cursor";
  label: string;
  url: string | null;
  hasToken: boolean;
  metadata: Record<string, unknown> | null;
  status: string;
  createdAt: string;
};

type ConnectionStatus = { type: string; status: string; repo?: string; url?: string; lastCommit?: { message: string; timestamp: string | null; author: string | null } | null; lastDeploy?: { status: string | null; timestamp: string | null } | null };

const CONNECTION_TYPES = [
  { value: "github", label: "GitHub", placeholder: null, tokenLabel: null, urlLabel: null },
  { value: "railway", label: "Railway", placeholder: "Token from railway.app/account/tokens", tokenLabel: "API Token", urlLabel: null },
  { value: "lovable", label: "Lovable", placeholder: "https://lovable.dev/projects/...", tokenLabel: null, urlLabel: "Project URL" },
  { value: "cursor", label: "Cursor", placeholder: "Workspace or project URL", tokenLabel: null, urlLabel: "Workspace URL" },
] as const;

const TYPE_ICONS: Record<string, React.ReactNode> = {
  github: (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor"><path d="M12 0C5.37 0 0 5.37 0 12c0 5.31 3.44 9.8 8.21 11.39.6.11.82-.26.82-.58v-2.04c-3.34.73-4.04-1.61-4.04-1.61-.55-1.39-1.34-1.76-1.34-1.76-1.09-.74.08-.73.08-.73 1.21.09 1.85 1.24 1.85 1.24 1.08 1.84 2.83 1.31 3.52 1 .11-.78.42-1.31.76-1.61-2.67-.3-5.47-1.33-5.47-5.93 0-1.31.47-2.38 1.24-3.22-.12-.3-.54-1.52.12-3.18 0 0 1.01-.32 3.3 1.23.96-.27 1.98-.4 3-.41 1.02.01 2.05.14 3 .41 2.29-1.55 3.3-1.23 3.3-1.23.66 1.66.24 2.88.12 3.18.77.84 1.24 1.91 1.24 3.22 0 4.61-2.81 5.63-5.48 5.92.43.37.82 1.1.82 2.22v3.29c0 .32.22.7.83.58C20.57 21.8 24 17.31 24 12c0-6.63-5.37-12-12-12z" /></svg>
  ),
  railway: (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><rect x="2" y="3" width="20" height="14" rx="2" /><path d="M8 21h8M12 17v4" /><path d="M7 8h10M7 12h6" /></svg>
  ),
  lovable: (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><path d="M20.84 4.61a5.5 5.5 0 00-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 00-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 000-7.78z" /></svg>
  ),
  cursor: (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><polyline points="4 17 10 11 4 5" /><line x1="12" y1="19" x2="20" y2="19" /></svg>
  ),
};

function statusColor(status: string): string {
  if (status === "active" || status === "linked" || status === "connected") return "#4ade80";
  if (status === "read-only") return "var(--atlas-gold)";
  if (status === "building") return "var(--atlas-gold)";
  if (status === "failed" || status === "missing" || status === "not-connected") return "var(--atlas-ember)";
  return "var(--atlas-muted)";
}

function statusLabel(status: string): string {
  if (status === "connected") return "GitHub connected";
  if (status === "read-only") return "Read-only (no personal token)";
  if (status === "not-connected") return "Not connected";
  return status.toUpperCase();
}

function ConnectionsTool({ onBack }: { onBack: () => void }) {
  const [connections, setConnections] = useState<Connection[]>([]);
  const [loading, setLoading] = useState(true);
  const [adding, setAdding] = useState(false);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [deleting, setDeleting] = useState<number | null>(null);
  const [statuses, setStatuses] = useState<ConnectionStatus[]>([]);
  const [checkingStatus, setCheckingStatus] = useState(false);
  const [syncing, setSyncing] = useState(false);
  const [syncResult, setSyncResult] = useState<{ linked: string[]; tokenBackfilled: number } | null>(null);
  const [syncError, setSyncError] = useState<string | null>(null);

  const [formType, setFormType] = useState<"github" | "railway" | "lovable" | "cursor">("github");
  const [formLabel, setFormLabel] = useState("");
  const [formToken, setFormToken] = useState("");
  const [formUrl, setFormUrl] = useState("");

  const fetchConnections = async () => {
    try {
      const res = await fetch("/api/connections", { credentials: "include" });
      if (res.ok) setConnections(await res.json() as Connection[]);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { void fetchConnections(); }, []);

  const syncAllProjects = async () => {
    setSyncing(true);
    setSyncResult(null);
    setSyncError(null);
    try {
      const res = await fetch("/api/github/auto-link", { method: "POST", credentials: "include" });
      if (!res.ok) {
        setSyncError("Sync failed. Try again.");
        return;
      }
      const data = await res.json() as { linked: string[]; tokenBackfilled: number };
      setSyncResult(data);
    } catch {
      setSyncError("Sync failed. Try again.");
    } finally {
      setSyncing(false);
    }
  };

  const resetForm = () => { setFormType("github"); setFormLabel(""); setFormToken(""); setFormUrl(""); setSaveError(null); };

  const save = async () => {
    if (!formLabel.trim()) return;
    setSaving(true);
    setSaveError(null);
    try {
      const body: Record<string, string> = { type: formType, label: formLabel.trim() };
      if (formType === "railway" && formToken.trim()) body.token = formToken.trim();
      if ((formType === "lovable" || formType === "cursor") && formUrl.trim()) body.url = formUrl.trim();

      const res = await fetch("/api/connections", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify(body),
      });
      if (!res.ok) {
        const data = await res.json() as { error?: string };
        setSaveError(data.error ?? `Error ${res.status}`);
        return;
      }
      const conn = await res.json() as Connection;
      setConnections((prev) => [conn, ...prev]);
      setAdding(false);
      resetForm();
    } catch (e) {
      setSaveError(e instanceof Error ? e.message : "Unknown error");
    } finally {
      setSaving(false);
    }
  };

  const remove = async (connection: Connection) => {
    setDeleting(connection.id);
    try {
      await fetch(
        connection.type === "github" ? "/api/github/token" : `/api/connections/${connection.id}`,
        { method: "DELETE", credentials: "include" },
      );
      await fetchConnections();
      setStatuses((prev) => prev.filter((s) => s.type !== connection.type));
    } finally {
      setDeleting(null);
    }
  };

  const checkStatus = async () => {
    setCheckingStatus(true);
    try {
      const [connectionsResult, githubStatus] = await Promise.all([
        fetch("/api/connections/status", { credentials: "include" }),
        fetchGitHubStatus().catch(() => null),
      ]);
      if (!connectionsResult.ok) return;
      const data = await connectionsResult.json() as { connections: ConnectionStatus[] };
      const nextStatuses = (data.connections ?? []).filter((status) => status.type !== "github");
      if (githubStatus) {
        nextStatuses.push({ type: "github", status: githubStatus.status });
      }
      setStatuses(nextStatuses);
    } finally {
      setCheckingStatus(false);
    }
  };

  const selectedType = CONNECTION_TYPES.find((t) => t.value === formType);

  const fieldStyle: React.CSSProperties = {
    width: "100%",
    padding: "9px 11px",
    borderRadius: 6,
    background: "var(--atlas-bg)",
    border: "1px solid var(--atlas-border)",
    color: "var(--atlas-fg)",
    fontSize: 13,
    fontFamily: "inherit",
    outline: "none",
    boxSizing: "border-box",
  };

  const monoLabel: React.CSSProperties = {
    fontFamily: "var(--app-font-mono)",
    fontSize: 9,
    letterSpacing: "0.12em",
    color: "var(--atlas-muted)",
    opacity: 0.7,
    textTransform: "uppercase",
    display: "block",
    marginBottom: 4,
  };

  return (
    <ToolShell title="Connections" desc="Link your external tools to Axiom" onBack={onBack}>
      {/* Header actions */}
      <div style={{ display: "flex", gap: 8, marginBottom: 18 }}>
        <button
          type="button"
          onClick={() => { setAdding(!adding); resetForm(); }}
          style={{ flex: 1, padding: "9px", borderRadius: 7, background: adding ? "var(--atlas-border)" : "var(--atlas-gold)", color: adding ? "var(--atlas-muted)" : "#0D0B09", fontSize: 12, fontWeight: 700, border: "none", cursor: "pointer", transition: "background 140ms" }}
        >
          {adding ? "Cancel" : "+ Add Connection"}
        </button>
        {connections.length > 0 && (
          <button
            type="button"
            onClick={() => void checkStatus()}
            disabled={checkingStatus}
            style={{ padding: "9px 14px", borderRadius: 7, background: "transparent", border: "1px solid var(--atlas-border)", color: checkingStatus ? "var(--atlas-muted)" : "var(--atlas-fg)", fontSize: 12, cursor: checkingStatus ? "default" : "pointer", flexShrink: 0 }}
          >
            {checkingStatus ? "Checking…" : "Check Status"}
          </button>
        )}
        {connections.some((c) => c.type === "github") && (
          <button
            type="button"
            onClick={() => void syncAllProjects()}
            disabled={syncing}
            style={{ padding: "9px 14px", borderRadius: 7, background: "transparent", border: "1px solid var(--atlas-border)", color: syncing ? "var(--atlas-muted)" : "var(--atlas-fg)", fontSize: 12, cursor: syncing ? "default" : "pointer", flexShrink: 0 }}
          >
            {syncing ? "Syncing…" : "Sync All Projects"}
          </button>
        )}
      </div>

      {syncResult && (
        <div style={{ marginBottom: 14, padding: "10px 12px", borderRadius: 7, background: "color-mix(in oklab, #4ade80 8%, transparent)", border: "1px solid rgba(74,222,128,0.25)" }}>
          <span style={{ fontFamily: "var(--app-font-mono)", fontSize: 10.5, color: "#4ade80", opacity: 1 }}>
            {syncResult.linked.length} projects linked · {syncResult.tokenBackfilled} tokens synced
          </span>
        </div>
      )}

      {syncError && (
        <div style={{ marginBottom: 14, padding: "10px 12px", borderRadius: 7, background: "color-mix(in oklab, var(--atlas-ember) 8%, transparent)", border: "1px solid rgba(146,64,14,0.25)" }}>
          <span style={{ fontFamily: "var(--app-font-mono)", fontSize: 10.5, color: "var(--atlas-ember)", opacity: 0.9 }}>{syncError}</span>
        </div>
      )}

      {/* Add form */}
      {adding && (
        <div style={{ padding: "14px", borderRadius: 10, border: "1px solid rgba(201,162,76,0.25)", background: "var(--atlas-surface)", marginBottom: 18 }}>
          <div style={{ marginBottom: 10 }}>
            <label style={monoLabel}>Service</label>
            <select
              value={formType}
              onChange={(e) => { setFormType(e.target.value as typeof formType); setFormToken(""); setFormUrl(""); }}
              style={fieldStyle}
            >
              {CONNECTION_TYPES.map((t) => <option key={t.value} value={t.value}>{t.label}</option>)}
            </select>
          </div>

          <div style={{ marginBottom: 10 }}>
            <label style={monoLabel}>Label</label>
            <input
              value={formLabel}
              onChange={(e) => setFormLabel(e.target.value)}
              placeholder={`e.g. ${formType === "github" ? "My GitHub" : formType === "railway" ? "Axiom on Railway" : formType === "lovable" ? "PresentQ on Lovable" : "Cursor Workspace"}`}
              style={fieldStyle}
            />
          </div>

          {formType === "github" && (
            <div style={{ padding: "8px 10px", borderRadius: 6, background: "color-mix(in oklab, var(--atlas-gold) 5%, transparent)", border: "1px solid rgba(201,162,76,0.15)", marginBottom: 10 }}>
              <span style={{ fontFamily: "var(--app-font-mono)", fontSize: 9.5, color: "var(--atlas-gold)", opacity: 0.8, lineHeight: 1.6 }}>
                Atlas will link to the most recently opened project with a GitHub repo attached. Make sure you've linked a repo in a workspace first.
              </span>
            </div>
          )}

          {formType === "railway" && (
            <div style={{ marginBottom: 10 }}>
              <label style={monoLabel}>API Token</label>
              <input
                value={formToken}
                onChange={(e) => setFormToken(e.target.value)}
                placeholder="From railway.app → Account → Tokens"
                type="password"
                style={fieldStyle}
              />
            </div>
          )}

          {(formType === "lovable" || formType === "cursor") && (
            <div style={{ marginBottom: 10 }}>
              <label style={monoLabel}>{selectedType?.urlLabel ?? "URL"}</label>
              <input
                value={formUrl}
                onChange={(e) => setFormUrl(e.target.value)}
                placeholder={selectedType?.placeholder ?? "https://..."}
                style={fieldStyle}
              />
            </div>
          )}

          {saveError && (
            <div style={{ marginBottom: 10, padding: "7px 10px", borderRadius: 6, background: "color-mix(in oklab, var(--atlas-ember) 8%, transparent)", border: "1px solid rgba(146,64,14,0.25)" }}>
              <span style={{ fontFamily: "var(--app-font-mono)", fontSize: 10, color: "var(--atlas-ember)", opacity: 0.9 }}>{saveError}</span>
            </div>
          )}

          <button
            type="button"
            disabled={!formLabel.trim() || saving}
            onClick={() => void save()}
            style={{ width: "100%", padding: "10px", borderRadius: 7, background: formLabel.trim() ? "var(--atlas-gold)" : "var(--atlas-border)", color: formLabel.trim() ? "#0D0B09" : "var(--atlas-muted)", fontSize: 12.5, fontWeight: 700, border: "none", cursor: formLabel.trim() ? "pointer" : "default" }}
          >
            {saving ? "Connecting…" : "Save Connection"}
          </button>
        </div>
      )}

      {/* List */}
      {loading ? (
        <div style={{ textAlign: "center", padding: "40px 0", color: "var(--atlas-muted)", fontSize: 12, opacity: 0.5 }}>Loading…</div>
      ) : connections.length === 0 ? (
        <div style={{ textAlign: "center", padding: "40px 16px", color: "var(--atlas-muted)", opacity: 0.45 }}>
          <div style={{ fontSize: 13, marginBottom: 6 }}>No connections yet</div>
          <div style={{ fontFamily: "var(--app-font-mono)", fontSize: 10, lineHeight: 1.6 }}>Add your first external tool above.</div>
        </div>
      ) : (
        <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
          {connections.map((conn) => {
            const liveStatus = statuses.find((status) => status.type === conn.type);
            const dot = liveStatus ? statusColor(liveStatus.status) : null;
            return (
              <div key={conn.id} style={{ padding: "13px 14px", borderRadius: 10, background: "var(--atlas-surface)", border: "1px solid var(--atlas-border)", display: "flex", alignItems: "flex-start", gap: 12 }}>
                <span style={{ color: "var(--atlas-gold)", opacity: 0.8, marginTop: 1, flexShrink: 0 }}>{TYPE_ICONS[conn.type]}</span>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: 2 }}>
                    {dot && <span style={{ width: 6, height: 6, borderRadius: "50%", background: dot, flexShrink: 0, display: "inline-block" }} />}
                    <span style={{ fontSize: 13, fontWeight: 600, color: "var(--atlas-fg)", letterSpacing: "-0.01em" }}>{conn.label}</span>
                  </div>
                  <div style={{ fontFamily: "var(--app-font-mono)", fontSize: 9.5, color: "var(--atlas-muted)", opacity: 0.55, marginBottom: conn.url ? 2 : 0 }}>
                    {conn.type.toUpperCase()}
                    {liveStatus ? ` · ${statusLabel(liveStatus.status)}` : ""}
                  </div>
                  {conn.url && (
                    <div style={{ fontSize: 11, color: "var(--atlas-muted)", opacity: 0.5, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{conn.url}</div>
                  )}
                  {liveStatus?.lastCommit && (
                    <div style={{ fontFamily: "var(--app-font-mono)", fontSize: 9.5, color: "var(--atlas-muted)", opacity: 0.5, marginTop: 4, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                      {liveStatus.lastCommit.message.split("\n")[0]}
                    </div>
                  )}
                </div>
                <button
                  type="button"
                  disabled={deleting === conn.id}
                  onClick={() => { if (confirm(`Remove ${conn.label}?`)) void remove(conn); }}
                  style={{ fontSize: 11, color: "var(--atlas-ember)", background: "transparent", border: "1px solid rgba(146,64,14,0.3)", borderRadius: 5, padding: "3px 8px", cursor: "pointer", flexShrink: 0, opacity: deleting === conn.id ? 0.5 : 1 }}
                >
                  {deleting === conn.id ? "…" : "Remove"}
                </button>
              </div>
            );
          })}
        </div>
      )}
    </ToolShell>
  );
}

/* ─── Tool 6: Atlas Selfmap ─── */
function AtlasSelfmap({ onBack }: { onBack: () => void }) {
  const [status, setStatus] = useState<"idle" | "running" | "done" | "error">("idle");
  const [result, setResult] = useState<{ file_count: number; created_at: string } | null>(null);
  const [error, setError] = useState<string | null>(null);

  const run = async () => {
    setStatus("running");
    setError(null);
    try {
      const res = await fetch("/api/selfmap/refresh", { method: "POST", credentials: "include" });
      if (!res.ok) throw new Error(`Server error ${res.status}`);
      const data = await res.json() as { file_count: number; created_at: string };
      setResult(data);
      setStatus("done");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Unknown error");
      setStatus("error");
    }
  };

  const monoLabel: React.CSSProperties = {
    fontFamily: "var(--app-font-mono)",
    fontSize: 9,
    letterSpacing: "0.12em",
    color: "var(--atlas-muted)",
    opacity: 0.7,
    textTransform: "uppercase",
    display: "block",
    marginBottom: 4,
  };

  return (
    <ToolShell
      title="Atlas Selfmap"
      desc="Structural index of the entire codebase"
      onBack={onBack}
    >
      <div style={{ marginBottom: 20, padding: "14px", borderRadius: 10, background: "var(--atlas-surface)", border: "1px solid var(--atlas-border)" }}>
        <div style={{ fontSize: 12.5, color: "var(--atlas-muted)", lineHeight: 1.7, marginBottom: 16, opacity: 0.8 }}>
          Atlas will walk every <code style={{ fontFamily: "var(--app-font-mono)", fontSize: 11, background: "rgba(201,162,76,0.08)", padding: "1px 5px", borderRadius: 3 }}>.ts</code> and <code style={{ fontFamily: "var(--app-font-mono)", fontSize: 11, background: "rgba(201,162,76,0.08)", padding: "1px 5px", borderRadius: 3 }}>.tsx</code> file in the frontend and backend, extract all exports and import relationships, and store the result in the database. This is used to give Atlas deeper structural awareness of the codebase when answering architecture questions.
        </div>

        <button
          type="button"
          onClick={run}
          disabled={status === "running"}
          style={{
            width: "100%",
            padding: "11px",
            borderRadius: 8,
            background: status === "running" ? "var(--atlas-border)" : "var(--atlas-gold)",
            color: status === "running" ? "var(--atlas-muted)" : "#0D0B09",
            fontSize: 13,
            fontWeight: 700,
            border: "none",
            cursor: status === "running" ? "default" : "pointer",
            transition: "background 140ms",
            letterSpacing: "-0.01em",
          }}
        >
          {status === "running" ? "Indexing codebase…" : "Run Selfmap"}
        </button>
      </div>

      {status === "done" && result && (
        <div style={{ padding: "14px", borderRadius: 10, background: "color-mix(in oklab, var(--atlas-gold) 6%, transparent)", border: "1px solid rgba(201,162,76,0.25)" }}>
          <span style={monoLabel}>Last run</span>
          <div style={{ fontSize: 13.5, fontWeight: 600, color: "var(--atlas-fg)", marginBottom: 6 }}>
            {result.file_count} files indexed
          </div>
          <div style={{ fontFamily: "var(--app-font-mono)", fontSize: 10, color: "var(--atlas-muted)", opacity: 0.65 }}>
            {new Date(result.created_at).toLocaleString()}
          </div>
        </div>
      )}

      {status === "error" && error && (
        <div style={{ padding: "12px 14px", borderRadius: 8, background: "color-mix(in oklab, var(--atlas-ember) 8%, transparent)", border: "1px solid rgba(146,64,14,0.3)" }}>
          <div style={{ fontFamily: "var(--app-font-mono)", fontSize: 10, color: "var(--atlas-ember)", opacity: 0.9 }}>{error}</div>
        </div>
      )}
    </ToolShell>
  );
}
