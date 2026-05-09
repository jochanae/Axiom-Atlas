import { useState, useEffect, useCallback } from "react";
import { useLocation } from "wouter";
import { useAuth } from "@/hooks/useAuth";

const BASE = import.meta.env.BASE_URL.replace(/\/$/, "");
const api = (path: string) => `${BASE}${path}`;

type Tab = "overview" | "users" | "notes" | "errors";

interface StatsData {
  users: number;
  unresolvedErrors: number;
  notes: number;
  tierBreakdown: Array<{ tier: string; count: number }>;
}

interface AdminUser {
  id: number;
  email: string;
  name: string | null;
  avatarUrl: string | null;
  role: string;
  subscriptionTier: string;
  googleId: string | null;
  createdAt: string;
  projectCount: number;
}

interface AdminNote {
  id: number;
  content: string;
  createdAt: string;
}

interface ErrorLog {
  id: number;
  message: string;
  stack: string | null;
  url: string | null;
  context: string | null;
  resolved: boolean;
  adminResponse: string | null;
  createdAt: string;
  userId: number | null;
  userName: string | null;
  userEmail: string | null;
}

const mono: React.CSSProperties = { fontFamily: "var(--app-font-mono)" };
const TIERS = ["free", "pro", "premium", "founder"];
const TIER_COLORS: Record<string, string> = {
  free: "rgba(120,113,108,0.8)",
  pro: "rgba(96,165,250,0.8)",
  premium: "rgba(201,162,76,0.9)",
  founder: "rgba(251,191,36,1)",
};

function tierBadge(tier: string) {
  return (
    <span style={{
      display: "inline-block", padding: "2px 7px", borderRadius: 4,
      fontSize: 9, fontWeight: 700, letterSpacing: "0.1em", textTransform: "uppercase",
      background: `${TIER_COLORS[tier] ?? "rgba(120,113,108,0.5)"}22`,
      border: `1px solid ${TIER_COLORS[tier] ?? "rgba(120,113,108,0.5)"}55`,
      color: TIER_COLORS[tier] ?? "var(--atlas-muted)",
      ...mono,
    }}>
      {tier}
    </span>
  );
}

function timeAgo(iso: string) {
  const diff = Date.now() - new Date(iso).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  const days = Math.floor(hrs / 24);
  return `${days}d ago`;
}

// ── Overview Tab ──────────────────────────────────────────────────────────────
function OverviewTab({ stats }: { stats: StatsData | null }) {
  if (!stats) return <Loading />;
  const tiles = [
    { label: "Total Users", value: stats.users, color: "var(--atlas-gold)" },
    { label: "Unresolved Errors", value: stats.unresolvedErrors, color: "rgba(239,68,68,0.8)" },
    { label: "Admin Notes", value: stats.notes, color: "rgba(120,113,108,0.8)" },
  ];
  return (
    <div style={{ padding: "0 0 32px" }}>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(2, 1fr)", gap: 12, marginBottom: 28 }}>
        {tiles.map(t => (
          <div key={t.label} style={{
            padding: "18px 16px", borderRadius: 12,
            background: "var(--atlas-surface)",
            border: "1px solid var(--atlas-border)",
          }}>
            <div style={{ fontSize: 24, fontWeight: 700, color: t.color, ...mono }}>{t.value}</div>
            <div style={{ fontSize: 10.5, color: "var(--atlas-muted)", marginTop: 4, letterSpacing: "0.05em" }}>{t.label}</div>
          </div>
        ))}
      </div>
      <div style={{ borderRadius: 12, background: "var(--atlas-surface)", border: "1px solid var(--atlas-border)", padding: "16px 18px" }}>
        <div style={{ fontSize: 10, ...mono, letterSpacing: "0.2em", textTransform: "uppercase", color: "var(--atlas-muted)", marginBottom: 14 }}>Tier Breakdown</div>
        {stats.tierBreakdown.map(b => (
          <div key={b.tier} style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 10 }}>
            {tierBadge(b.tier)}
            <div style={{ flex: 1, height: 4, borderRadius: 2, background: "var(--atlas-border)", overflow: "hidden" }}>
              <div style={{
                height: "100%", borderRadius: 2,
                background: TIER_COLORS[b.tier] ?? "var(--atlas-muted)",
                width: `${Math.min(100, (b.count / (stats.users || 1)) * 100)}%`,
                transition: "width 600ms ease",
              }} />
            </div>
            <span style={{ fontSize: 11, color: "var(--atlas-fg)", ...mono, minWidth: 20, textAlign: "right" }}>{b.count}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

// ── Users Tab ─────────────────────────────────────────────────────────────────
function UsersTab({ users, onRefresh }: { users: AdminUser[] | null; onRefresh: () => void }) {
  const [updatingId, setUpdatingId] = useState<number | null>(null);
  const [deletingId, setDeletingId] = useState<number | null>(null);
  const [confirmDelete, setConfirmDelete] = useState<number | null>(null);

  const patchUser = async (id: number, body: Record<string, unknown>) => {
    setUpdatingId(id);
    try {
      await fetch(api(`/api/admin/users/${id}`), {
        method: "PATCH", credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      onRefresh();
    } finally { setUpdatingId(null); }
  };

  const deleteUser = async (id: number) => {
    setDeletingId(id);
    try {
      await fetch(api(`/api/admin/users/${id}`), { method: "DELETE", credentials: "include" });
      setConfirmDelete(null);
      onRefresh();
    } finally { setDeletingId(null); }
  };

  if (!users) return <Loading />;

  return (
    <div>
      <div style={{ fontSize: 11, color: "var(--atlas-muted)", marginBottom: 16, ...mono }}>
        {users.length} user{users.length !== 1 ? "s" : ""} registered
      </div>
      <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
        {users.map(u => (
          <div key={u.id} style={{
            borderRadius: 12, background: "var(--atlas-surface)",
            border: "1px solid var(--atlas-border)",
            padding: "14px 16px",
          }}>
            <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 10 }}>
              <div style={{
                width: 32, height: 32, borderRadius: "50%", flexShrink: 0,
                background: u.avatarUrl ? "transparent" : "rgba(201,162,76,0.1)",
                border: "1px solid rgba(201,162,76,0.2)",
                overflow: "hidden", display: "flex", alignItems: "center", justifyContent: "center",
              }}>
                {u.avatarUrl
                  ? <img src={u.avatarUrl} alt="" style={{ width: "100%", height: "100%", objectFit: "cover" }} />
                  : <span style={{ fontSize: 12, fontWeight: 700, color: "var(--atlas-gold)", ...mono }}>{(u.name || u.email)[0].toUpperCase()}</span>
                }
              </div>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontSize: 13, fontWeight: 600, color: "var(--atlas-fg)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                  {u.name || u.email}
                </div>
                <div style={{ fontSize: 10.5, color: "var(--atlas-muted)", ...mono, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{u.email}</div>
              </div>
              <div style={{ display: "flex", alignItems: "center", gap: 6, flexShrink: 0 }}>
                {u.googleId && (
                  <span title="Google account" style={{ fontSize: 9, ...mono, color: "rgba(96,165,250,0.6)", border: "1px solid rgba(96,165,250,0.2)", borderRadius: 4, padding: "1px 5px" }}>G</span>
                )}
                {tierBadge(u.subscriptionTier)}
              </div>
            </div>

            <div style={{ display: "flex", gap: 6, flexWrap: "wrap", alignItems: "center" }}>
              <span style={{ fontSize: 9.5, color: "var(--atlas-muted)", ...mono }}>{u.projectCount} project{u.projectCount !== 1 ? "s" : ""} · {timeAgo(u.createdAt)}</span>
              <div style={{ flex: 1 }} />

              {/* Tier selector */}
              <select
                value={u.subscriptionTier}
                disabled={updatingId === u.id}
                onChange={(e) => patchUser(u.id, { subscriptionTier: e.target.value })}
                style={{
                  fontSize: 10, ...mono, padding: "4px 6px", borderRadius: 6,
                  background: "var(--atlas-bg)", border: "1px solid rgba(201,162,76,0.2)",
                  color: "var(--atlas-gold)", cursor: "pointer", outline: "none",
                }}
              >
                {TIERS.map(t => <option key={t} value={t}>{t}</option>)}
              </select>

              {/* Role selector */}
              <select
                value={u.role}
                disabled={updatingId === u.id || u.role === "super_admin"}
                onChange={(e) => patchUser(u.id, { role: e.target.value })}
                style={{
                  fontSize: 10, ...mono, padding: "4px 6px", borderRadius: 6,
                  background: "var(--atlas-bg)", border: "1px solid rgba(201,162,76,0.2)",
                  color: "var(--atlas-muted)", cursor: u.role === "super_admin" ? "not-allowed" : "pointer", outline: "none",
                }}
              >
                {["user", "admin", "super_admin"].map(r => <option key={r} value={r}>{r}</option>)}
              </select>

              {/* Delete */}
              {u.role !== "super_admin" && (
                confirmDelete === u.id ? (
                  <div style={{ display: "flex", gap: 4 }}>
                    <button
                      onClick={() => deleteUser(u.id)}
                      disabled={deletingId === u.id}
                      style={{ fontSize: 9, ...mono, padding: "3px 8px", borderRadius: 5, background: "rgba(239,68,68,0.15)", border: "1px solid rgba(239,68,68,0.4)", color: "rgba(252,165,165,0.9)", cursor: "pointer" }}
                    >{deletingId === u.id ? "…" : "Confirm"}</button>
                    <button
                      onClick={() => setConfirmDelete(null)}
                      style={{ fontSize: 9, ...mono, padding: "3px 8px", borderRadius: 5, background: "transparent", border: "1px solid var(--atlas-border)", color: "var(--atlas-muted)", cursor: "pointer" }}
                    >Cancel</button>
                  </div>
                ) : (
                  <button
                    onClick={() => setConfirmDelete(u.id)}
                    title="Delete user"
                    style={{ fontSize: 10, padding: "3px 8px", borderRadius: 5, background: "transparent", border: "1px solid rgba(239,68,68,0.2)", color: "rgba(239,68,68,0.5)", cursor: "pointer" }}
                  >✕</button>
                )
              )}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

// ── Notes Tab ─────────────────────────────────────────────────────────────────
function NotesTab({ notes, onRefresh }: { notes: AdminNote[] | null; onRefresh: () => void }) {
  const [draft, setDraft] = useState("");
  const [saving, setSaving] = useState(false);
  const [deletingId, setDeletingId] = useState<number | null>(null);

  const save = async () => {
    if (!draft.trim()) return;
    setSaving(true);
    try {
      await fetch(api("/api/admin/notes"), {
        method: "POST", credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ content: draft.trim() }),
      });
      setDraft("");
      onRefresh();
    } finally { setSaving(false); }
  };

  const del = async (id: number) => {
    setDeletingId(id);
    try {
      await fetch(api(`/api/admin/notes/${id}`), { method: "DELETE", credentials: "include" });
      onRefresh();
    } finally { setDeletingId(null); }
  };

  if (!notes) return <Loading />;

  return (
    <div>
      {/* Compose */}
      <div style={{ marginBottom: 20 }}>
        <textarea
          value={draft}
          onChange={e => setDraft(e.target.value)}
          placeholder="Write a note…"
          rows={3}
          onKeyDown={e => { if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) save(); }}
          style={{
            width: "100%", boxSizing: "border-box",
            padding: "12px 14px", borderRadius: 10, resize: "vertical",
            background: "var(--atlas-surface)", border: "1px solid var(--atlas-border)",
            color: "var(--atlas-fg)", fontSize: 13, fontFamily: "inherit",
            outline: "none", lineHeight: 1.55,
          }}
          onFocus={e => { e.currentTarget.style.borderColor = "rgba(201,162,76,0.4)"; }}
          onBlur={e => { e.currentTarget.style.borderColor = "var(--atlas-border)"; }}
        />
        <div style={{ display: "flex", justifyContent: "flex-end", marginTop: 8 }}>
          <button
            onClick={save}
            disabled={saving || !draft.trim()}
            style={{
              padding: "8px 18px", borderRadius: 8, fontSize: 11, fontWeight: 700,
              ...mono, letterSpacing: "0.08em",
              background: saving || !draft.trim() ? "rgba(201,162,76,0.1)" : "linear-gradient(180deg,#D4AF37,#B8942A)",
              border: saving || !draft.trim() ? "1px solid rgba(201,162,76,0.15)" : "1px solid rgba(212,175,55,0.4)",
              color: saving || !draft.trim() ? "rgba(201,162,76,0.3)" : "#0C0A09",
              cursor: saving || !draft.trim() ? "not-allowed" : "pointer",
            }}
          >{saving ? "Saving…" : "Save Note"}</button>
        </div>
      </div>

      {/* Notes list */}
      {notes.length === 0 ? (
        <div style={{ textAlign: "center", padding: "32px 0", color: "var(--atlas-muted)", fontSize: 12, ...mono }}>No notes yet.</div>
      ) : (
        <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
          {notes.map(n => (
            <div key={n.id} style={{
              borderRadius: 10, background: "var(--atlas-surface)",
              border: "1px solid var(--atlas-border)",
              padding: "14px 14px 12px",
            }}>
              <div style={{ fontSize: 13, color: "var(--atlas-fg)", lineHeight: 1.55, whiteSpace: "pre-wrap", marginBottom: 10 }}>{n.content}</div>
              <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                <span style={{ fontSize: 9.5, color: "var(--atlas-muted)", ...mono }}>{timeAgo(n.createdAt)}</span>
                <div style={{ flex: 1 }} />
                <button
                  onClick={() => del(n.id)}
                  disabled={deletingId === n.id}
                  style={{ fontSize: 10, padding: "2px 8px", borderRadius: 5, background: "transparent", border: "1px solid rgba(239,68,68,0.2)", color: "rgba(239,68,68,0.5)", cursor: "pointer" }}
                >{deletingId === n.id ? "…" : "Delete"}</button>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// ── Errors Tab ────────────────────────────────────────────────────────────────
function ErrorsTab({ errors, onRefresh }: { errors: ErrorLog[] | null; onRefresh: () => void }) {
  const [expandedId, setExpandedId] = useState<number | null>(null);
  const [respondingId, setRespondingId] = useState<number | null>(null);
  const [responseText, setResponseText] = useState("");
  const [workingId, setWorkingId] = useState<number | null>(null);

  const patch = async (id: number, body: Record<string, unknown>) => {
    setWorkingId(id);
    try {
      await fetch(api(`/api/admin/errors/${id}`), {
        method: "PATCH", credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      onRefresh();
    } finally { setWorkingId(null); }
  };

  const del = async (id: number) => {
    setWorkingId(id);
    try {
      await fetch(api(`/api/admin/errors/${id}`), { method: "DELETE", credentials: "include" });
      onRefresh();
    } finally { setWorkingId(null); }
  };

  const submitResponse = async (id: number) => {
    await patch(id, { adminResponse: responseText, resolved: true });
    setRespondingId(null);
    setResponseText("");
  };

  if (!errors) return <Loading />;
  const unresolved = errors.filter(e => !e.resolved);
  const resolved = errors.filter(e => e.resolved);

  const renderError = (e: ErrorLog) => (
    <div key={e.id} style={{
      borderRadius: 10, border: `1px solid ${e.resolved ? "var(--atlas-border)" : "rgba(239,68,68,0.25)"}`,
      background: e.resolved ? "var(--atlas-surface)" : "rgba(239,68,68,0.04)",
      marginBottom: 8, overflow: "hidden",
    }}>
      <div
        style={{ padding: "12px 14px", cursor: "pointer", display: "flex", gap: 10, alignItems: "flex-start" }}
        onClick={() => setExpandedId(expandedId === e.id ? null : e.id)}
      >
        <div style={{
          width: 8, height: 8, borderRadius: "50%", flexShrink: 0, marginTop: 4,
          background: e.resolved ? "rgba(34,197,94,0.6)" : "rgba(239,68,68,0.7)",
        }} />
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontSize: 12.5, color: "var(--atlas-fg)", lineHeight: 1.4, marginBottom: 4, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
            {e.message}
          </div>
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
            {e.userEmail && <span style={{ fontSize: 9.5, ...mono, color: "rgba(96,165,250,0.6)" }}>{e.userEmail}</span>}
            {e.url && <span style={{ fontSize: 9.5, ...mono, color: "var(--atlas-muted)", overflow: "hidden", textOverflow: "ellipsis", maxWidth: 140 }}>{e.url}</span>}
            <span style={{ fontSize: 9.5, ...mono, color: "var(--atlas-muted)" }}>{timeAgo(e.createdAt)}</span>
          </div>
        </div>
        <span style={{ fontSize: 9.5, ...mono, color: "var(--atlas-muted)", flexShrink: 0 }}>{expandedId === e.id ? "▲" : "▼"}</span>
      </div>

      {expandedId === e.id && (
        <div style={{ padding: "0 14px 14px", borderTop: "1px solid var(--atlas-border)" }}>
          {e.stack && (
            <pre style={{ fontSize: 10, ...mono, color: "var(--atlas-muted)", background: "rgba(0,0,0,0.3)", padding: 10, borderRadius: 6, overflow: "auto", maxHeight: 140, marginTop: 10, marginBottom: 10 }}>
              {e.stack}
            </pre>
          )}
          {e.adminResponse && (
            <div style={{ padding: "8px 10px", borderRadius: 6, background: "rgba(201,162,76,0.07)", border: "1px solid rgba(201,162,76,0.15)", fontSize: 11, color: "var(--atlas-muted)", marginBottom: 10 }}>
              <span style={{ ...mono, fontSize: 9, letterSpacing: "0.1em", textTransform: "uppercase", color: "var(--atlas-gold)", marginRight: 6 }}>Note:</span>
              {e.adminResponse}
            </div>
          )}
          {respondingId === e.id ? (
            <div>
              <textarea
                value={responseText}
                onChange={ev => setResponseText(ev.target.value)}
                placeholder="Add a note or response…"
                rows={2}
                style={{ width: "100%", boxSizing: "border-box", padding: "8px 10px", borderRadius: 6, resize: "vertical", background: "var(--atlas-bg)", border: "1px solid rgba(201,162,76,0.3)", color: "var(--atlas-fg)", fontSize: 12, fontFamily: "inherit", outline: "none" }}
                autoFocus
              />
              <div style={{ display: "flex", gap: 6, marginTop: 6 }}>
                <button onClick={() => submitResponse(e.id)} style={{ fontSize: 10, ...mono, padding: "4px 12px", borderRadius: 5, background: "rgba(201,162,76,0.15)", border: "1px solid rgba(201,162,76,0.3)", color: "var(--atlas-gold)", cursor: "pointer" }}>Save &amp; Resolve</button>
                <button onClick={() => { setRespondingId(null); setResponseText(""); }} style={{ fontSize: 10, ...mono, padding: "4px 10px", borderRadius: 5, background: "transparent", border: "1px solid var(--atlas-border)", color: "var(--atlas-muted)", cursor: "pointer" }}>Cancel</button>
              </div>
            </div>
          ) : (
            <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
              {!e.resolved && (
                <>
                  <button
                    onClick={() => patch(e.id, { resolved: true })}
                    disabled={workingId === e.id}
                    style={{ fontSize: 10, ...mono, padding: "4px 10px", borderRadius: 5, background: "rgba(34,197,94,0.1)", border: "1px solid rgba(34,197,94,0.3)", color: "rgba(74,222,128,0.8)", cursor: "pointer" }}
                  >✓ Resolve</button>
                  <button
                    onClick={() => { setRespondingId(e.id); setResponseText(e.adminResponse ?? ""); }}
                    style={{ fontSize: 10, ...mono, padding: "4px 10px", borderRadius: 5, background: "rgba(201,162,76,0.08)", border: "1px solid rgba(201,162,76,0.2)", color: "rgba(201,162,76,0.7)", cursor: "pointer" }}
                  >Add Note</button>
                </>
              )}
              {e.resolved && (
                <button
                  onClick={() => patch(e.id, { resolved: false })}
                  disabled={workingId === e.id}
                  style={{ fontSize: 10, ...mono, padding: "4px 10px", borderRadius: 5, background: "transparent", border: "1px solid var(--atlas-border)", color: "var(--atlas-muted)", cursor: "pointer" }}
                >Reopen</button>
              )}
              <button
                onClick={() => del(e.id)}
                disabled={workingId === e.id}
                style={{ fontSize: 10, padding: "4px 8px", borderRadius: 5, background: "transparent", border: "1px solid rgba(239,68,68,0.2)", color: "rgba(239,68,68,0.5)", cursor: "pointer" }}
              >✕</button>
            </div>
          )}
        </div>
      )}
    </div>
  );

  return (
    <div>
      {unresolved.length === 0 && resolved.length === 0 && (
        <div style={{ textAlign: "center", padding: "32px 0", color: "var(--atlas-muted)", fontSize: 12, ...mono }}>No errors logged.</div>
      )}
      {unresolved.length > 0 && (
        <div style={{ marginBottom: 20 }}>
          <div style={{ fontSize: 10, ...mono, letterSpacing: "0.2em", textTransform: "uppercase", color: "rgba(239,68,68,0.6)", marginBottom: 10 }}>
            Unresolved ({unresolved.length})
          </div>
          {unresolved.map(renderError)}
        </div>
      )}
      {resolved.length > 0 && (
        <div>
          <div style={{ fontSize: 10, ...mono, letterSpacing: "0.2em", textTransform: "uppercase", color: "rgba(34,197,94,0.5)", marginBottom: 10 }}>
            Resolved ({resolved.length})
          </div>
          {resolved.map(renderError)}
        </div>
      )}
    </div>
  );
}

function Loading() {
  return (
    <div style={{ display: "flex", alignItems: "center", justifyContent: "center", padding: "48px 0" }}>
      <div style={{ width: 24, height: 24, border: "2px solid rgba(201,162,76,0.15)", borderTopColor: "var(--atlas-gold)", borderRadius: "50%", animation: "admin-spin 700ms linear infinite" }} />
    </div>
  );
}

// ── Main page ─────────────────────────────────────────────────────────────────
export default function Admin() {
  const { user, isLoading } = useAuth();
  const [, navigate] = useLocation();
  const [tab, setTab] = useState<Tab>("overview");
  const [stats, setStats] = useState<StatsData | null>(null);
  const [users, setUsers] = useState<AdminUser[] | null>(null);
  const [notes, setNotes] = useState<AdminNote[] | null>(null);
  const [errors, setErrors] = useState<ErrorLog[] | null>(null);

  useEffect(() => {
    if (!isLoading && (!user || user.role !== "super_admin")) navigate("/home");
  }, [user, isLoading, navigate]);

  const fetchTab = useCallback(async (t: Tab) => {
    if (t === "overview") {
      const r = await fetch(api("/api/admin/stats"), { credentials: "include" });
      if (r.ok) setStats(await r.json());
    } else if (t === "users") {
      const r = await fetch(api("/api/admin/users"), { credentials: "include" });
      if (r.ok) setUsers(await r.json());
    } else if (t === "notes") {
      const r = await fetch(api("/api/admin/notes"), { credentials: "include" });
      if (r.ok) setNotes(await r.json());
    } else if (t === "errors") {
      const r = await fetch(api("/api/admin/errors"), { credentials: "include" });
      if (r.ok) setErrors(await r.json());
    }
  }, []);

  useEffect(() => { fetchTab(tab); }, [tab, fetchTab]);

  const refresh = useCallback(() => fetchTab(tab), [tab, fetchTab]);

  const tabs: { id: Tab; label: string; badge?: number }[] = [
    { id: "overview", label: "Overview" },
    { id: "users", label: "Users", badge: stats?.users },
    { id: "notes", label: "Notes", badge: stats?.notes },
    { id: "errors", label: "Errors", badge: stats?.unresolvedErrors },
  ];

  if (isLoading || !user) return null;

  return (
    <div style={{
      minHeight: "100dvh",
      background: "var(--atlas-bg)",
      paddingBottom: "env(safe-area-inset-bottom, 0px)",
    }}>
      <style>{`
        @keyframes admin-spin { to { transform: rotate(360deg); } }
      `}</style>

      {/* Header */}
      <div style={{
        position: "sticky", top: 0, zIndex: 100,
        background: "rgba(12,10,9,0.92)", backdropFilter: "blur(20px)",
        borderBottom: "1px solid var(--atlas-border)",
        padding: "0 16px",
        display: "flex", alignItems: "center", gap: 12, height: 56,
      }}>
        <button
          onClick={() => navigate("/home")}
          style={{ background: "none", border: "none", cursor: "pointer", color: "var(--atlas-muted)", padding: 4, display: "flex", alignItems: "center" }}
        >
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M19 12H5M12 5l-7 7 7 7" />
          </svg>
        </button>
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <div style={{
            width: 22, height: 22, borderRadius: 6, display: "flex", alignItems: "center", justifyContent: "center",
            background: "rgba(201,162,76,0.12)", border: "1px solid rgba(201,162,76,0.3)",
          }}>
            <CrownIcon />
          </div>
          <span style={{ fontSize: 13, fontWeight: 700, color: "var(--atlas-fg)", ...mono, letterSpacing: "0.06em" }}>Admin Hub</span>
        </div>
        <div style={{ flex: 1 }} />
        <div style={{ fontSize: 9.5, ...mono, color: "var(--atlas-muted)", opacity: 0.5 }}>{user.email}</div>
      </div>

      {/* Tabs */}
      <div style={{
        display: "flex", borderBottom: "1px solid var(--atlas-border)",
        padding: "0 16px", gap: 2,
        overflowX: "auto", scrollbarWidth: "none",
      }}>
        {tabs.map(t => (
          <button
            key={t.id}
            onClick={() => setTab(t.id)}
            style={{
              padding: "12px 14px", border: "none", background: "transparent",
              color: tab === t.id ? "var(--atlas-gold)" : "var(--atlas-muted)",
              fontSize: 11, fontWeight: tab === t.id ? 700 : 400, cursor: "pointer",
              borderBottom: `2px solid ${tab === t.id ? "var(--atlas-gold)" : "transparent"}`,
              whiteSpace: "nowrap", display: "flex", alignItems: "center", gap: 6,
              transition: "color 150ms ease",
              ...mono, letterSpacing: "0.06em",
            }}
          >
            {t.label}
            {t.badge !== undefined && t.badge > 0 && (
              <span style={{
                fontSize: 9, padding: "1px 5px", borderRadius: 10,
                background: t.id === "errors" ? "rgba(239,68,68,0.2)" : "rgba(201,162,76,0.15)",
                color: t.id === "errors" ? "rgba(252,165,165,0.8)" : "var(--atlas-gold)",
                border: t.id === "errors" ? "1px solid rgba(239,68,68,0.3)" : "1px solid rgba(201,162,76,0.2)",
                ...mono,
              }}>{t.badge}</span>
            )}
          </button>
        ))}
      </div>

      {/* Content */}
      <div style={{ padding: "20px 16px", maxWidth: 680, margin: "0 auto" }}>
        {tab === "overview" && <OverviewTab stats={stats} />}
        {tab === "users" && <UsersTab users={users} onRefresh={refresh} />}
        {tab === "notes" && <NotesTab notes={notes} onRefresh={refresh} />}
        {tab === "errors" && <ErrorsTab errors={errors} onRefresh={refresh} />}
      </div>
    </div>
  );
}

function CrownIcon() {
  return (
    <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="var(--atlas-gold)" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
      <path d="M2 20h20M4 20V10l4 4 4-8 4 8 4-4v10" />
    </svg>
  );
}
