# Workshop — Connections Tool

## Context
The backend routes are live:
- `GET  /api/connections`          → array of `{ id, type, label, url, hasToken, metadata, status, lastCheckedAt, createdAt }`
- `POST /api/connections`          → create a connection
- `DELETE /api/connections/:id`    → remove a connection
- `GET  /api/connections/status`   → live status check for each connection (hits external APIs)

Connection types and what each needs:

| type | label | extra field |
|------|-------|-------------|
| `github` | e.g. "My GitHub" | nothing — auto-resolves from most recent linked project |
| `railway` | e.g. "Axiom on Railway" | `token` (Railway API token) |
| `lovable` | e.g. "PresentQ on Lovable" | `url` (your Lovable project URL) |
| `cursor` | e.g. "Cursor Workspace" | `url` (Cursor workspace URL) |

`/connections/status` returns `{ connections: [{ type, status, ... }] }`.
Status values: `"active"`, `"building"`, `"failed"`, `"linked"`, `"missing"`.

This prompt adds a **Connections** tool card to the Workshop page.

---

## File to change
`src/pages/workshop.tsx`

---

## Step 1 — Add `connections` to the Tool type

Find:

```ts
type Tool = "decision-editor" | "context-builder" | "diff-review" | "session-exporter" | "bulk-import" | "atlas-selfmap";
```

Replace with:

```ts
type Tool = "decision-editor" | "context-builder" | "diff-review" | "session-exporter" | "bulk-import" | "atlas-selfmap" | "connections";
```

---

## Step 2 — Add the tool card to the `tools` array

Find the `atlas-selfmap` entry — it ends with:

```ts
      desc: "Rebuild Atlas's structural index of the entire codebase — files, exports, and relationships.",
    },
```

Add this new entry immediately after that closing `},`:

```ts
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
```

---

## Step 3 — Wire the tool panel

Find:

```ts
if (activeTool === "atlas-selfmap") return <AtlasSelfmap onBack={() => setActiveTool(null)} />;
```

Add immediately after it:

```ts
if (activeTool === "connections") return <ConnectionsTool onBack={() => setActiveTool(null)} />;
```

---

## Step 4 — Add the `ConnectionsTool` component

Add this entire component at the very end of the file, after `AtlasSelfmap`:

```tsx
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
  if (status === "active" || status === "linked") return "#4ade80";
  if (status === "building") return "var(--atlas-gold)";
  if (status === "failed" || status === "missing") return "var(--atlas-ember)";
  return "var(--atlas-muted)";
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

  const remove = async (id: number) => {
    setDeleting(id);
    try {
      await fetch(`/api/connections/${id}`, { method: "DELETE", credentials: "include" });
      setConnections((prev) => prev.filter((c) => c.id !== id));
      setStatuses((prev) => prev.filter((s, i) => connections[i]?.id !== id));
    } finally {
      setDeleting(null);
    }
  };

  const checkStatus = async () => {
    setCheckingStatus(true);
    try {
      const res = await fetch("/api/connections/status", { credentials: "include" });
      if (res.ok) {
        const data = await res.json() as { connections: ConnectionStatus[] };
        setStatuses(data.connections);
      }
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
      </div>

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
          {connections.map((conn, i) => {
            const liveStatus = statuses[i];
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
                    {liveStatus ? ` · ${liveStatus.status.toUpperCase()}` : ""}
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
                  onClick={() => { if (confirm(`Remove ${conn.label}?`)) void remove(conn.id); }}
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
```

---

## Step 5 — Run typecheck and push

```
pnpm --filter @workspace/atlas run typecheck
```

Fix any errors, then push to main.

---

## What this does

- Adds a **Connections** card in Workshop (7th tool)
- Lists all your linked external tools with type icon, label, URL, status dot
- **+ Add Connection** form:
  - GitHub — just a label; auto-resolves the linked repo from your most recently opened project
  - Railway — label + API token (stored encrypted on server)
  - Lovable / Cursor — label + project URL
- **Check Status** button — pings each external service live and shows green/amber/red dot + last commit message (GitHub) or last deploy status (Railway)
- Remove button per connection with confirmation
- All design tokens match Workshop exactly
