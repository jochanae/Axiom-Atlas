import { useState, useEffect, useRef, useCallback } from "react";
import { createPortal } from "react-dom";

const BASE = import.meta.env.BASE_URL.replace(/\/$/, "");
const api = (path: string) => `${BASE}${path}`;

const mono: React.CSSProperties = { fontFamily: "var(--app-font-mono)" };

interface Invite {
  id: number;
  email: string;
  token: string;
  createdAt: string;
  acceptedAt: string | null;
  invitedByName: string | null;
}

function timeAgo(iso: string) {
  const diff = Date.now() - new Date(iso).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  return `${Math.floor(hrs / 24)}d ago`;
}

function getInviteLink(token: string): string {
  const base = window.location.origin + (import.meta.env.BASE_URL || "/");
  return `${base}login?invite=${token}`;
}

async function copyText(text: string) {
  try { await navigator.clipboard.writeText(text); } catch {}
}

interface Props {
  onClose: () => void;
}

export function InviteModal({ onClose }: Props) {
  const [email, setEmail] = useState("");
  const [sending, setSending] = useState(false);
  const [error, setError] = useState("");
  const [invites, setInvites] = useState<Invite[] | null>(null);
  const [copiedId, setCopiedId] = useState<number | "new" | null>(null);
  const [newToken, setNewToken] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  const loadInvites = useCallback(async () => {
    const r = await fetch(api("/api/admin/invites"), { credentials: "include" });
    if (r.ok) setInvites(await r.json());
  }, []);

  useEffect(() => {
    loadInvites();
    setTimeout(() => inputRef.current?.focus(), 80);
  }, [loadInvites]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [onClose]);

  const send = async () => {
    if (!email.trim()) return;
    setSending(true);
    setError("");
    try {
      const r = await fetch(api("/api/admin/invites"), {
        method: "POST", credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: email.trim() }),
      });
      if (!r.ok) {
        const d = await r.json().catch(() => ({ error: "Failed" }));
        setError((d as { error: string }).error ?? "Failed");
        return;
      }
      const inv = (await r.json()) as { token: string };
      setNewToken(inv.token);
      setEmail("");
      await loadInvites();
    } finally { setSending(false); }
  };

  const cancel = async (id: number) => {
    await fetch(api(`/api/admin/invites/${id}`), { method: "DELETE", credentials: "include" });
    if (newToken) setNewToken(null);
    await loadInvites();
  };

  const copy = async (token: string, id: number | "new") => {
    await copyText(getInviteLink(token));
    setCopiedId(id);
    setTimeout(() => setCopiedId(null), 2000);
  };

  const pending = invites?.filter(i => !i.acceptedAt) ?? [];
  const accepted = invites?.filter(i => i.acceptedAt) ?? [];

  return createPortal(
    <div
      role="dialog"
      aria-modal="true"
      style={{
        position: "fixed", inset: 0, zIndex: 10000,
        display: "flex", alignItems: "flex-end", justifyContent: "center",
        padding: "0 0 env(safe-area-inset-bottom, 0px)",
      }}
    >
      {/* Backdrop */}
      <div
        onClick={onClose}
        style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.65)", backdropFilter: "blur(6px)" }}
      />

      {/* Sheet */}
      <div style={{
        position: "relative", width: "100%", maxWidth: 480,
        background: "var(--atlas-surface)",
        border: "1px solid rgba(201,162,76,0.18)",
        borderBottom: "none",
        borderRadius: "20px 20px 0 0",
        padding: "0 0 max(env(safe-area-inset-bottom, 0px), 24px)",
        boxShadow: "0 -8px 40px rgba(0,0,0,0.4)",
        animation: "invite-sheet-in 260ms cubic-bezier(.2,.8,.2,1)",
        maxHeight: "85dvh", display: "flex", flexDirection: "column",
      }}>
        <style>{`
          @keyframes invite-sheet-in {
            from { transform: translateY(100%); opacity: 0; }
            to   { transform: translateY(0);    opacity: 1; }
          }
        `}</style>

        {/* Handle bar */}
        <div style={{ display: "flex", justifyContent: "center", padding: "12px 0 0" }}>
          <div style={{ width: 36, height: 3.5, borderRadius: 2, background: "rgba(201,162,76,0.2)" }} />
        </div>

        {/* Header */}
        <div style={{ display: "flex", alignItems: "center", padding: "14px 20px 12px", borderBottom: "1px solid var(--atlas-border)" }}>
          <div style={{
            width: 28, height: 28, borderRadius: 8, marginRight: 10, flexShrink: 0,
            background: "rgba(201,162,76,0.1)", border: "1px solid rgba(201,162,76,0.2)",
            display: "flex", alignItems: "center", justifyContent: "center",
          }}>
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="var(--atlas-gold)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M16 21v-2a4 4 0 00-4-4H6a4 4 0 00-4 4v2" />
              <circle cx="9" cy="7" r="4" />
              <line x1="19" y1="8" x2="19" y2="14" />
              <line x1="22" y1="11" x2="16" y2="11" />
            </svg>
          </div>
          <div>
            <div style={{ fontSize: 14, fontWeight: 700, color: "var(--atlas-fg)", lineHeight: 1.2 }}>Invite someone</div>
            <div style={{ fontSize: 10.5, color: "var(--atlas-muted)", ...mono, marginTop: 2 }}>Generate an invite link by email</div>
          </div>
          <div style={{ flex: 1 }} />
          <button
            onClick={onClose}
            style={{ background: "none", border: "none", cursor: "pointer", color: "var(--atlas-muted)", fontSize: 20, lineHeight: 1, padding: "4px 6px", opacity: 0.5 }}
            onMouseEnter={e => { e.currentTarget.style.opacity = "1"; }}
            onMouseLeave={e => { e.currentTarget.style.opacity = "0.5"; }}
          >×</button>
        </div>

        {/* Scrollable body */}
        <div style={{ overflowY: "auto", flex: 1, padding: "16px 20px 0" }}>

          {/* New invite just generated */}
          {newToken && (
            <div style={{
              marginBottom: 16, padding: "12px 14px", borderRadius: 12,
              background: "rgba(34,197,94,0.07)", border: "1px solid rgba(34,197,94,0.2)",
            }}>
              <div style={{ fontSize: 11, fontWeight: 700, color: "rgba(74,222,128,0.85)", marginBottom: 8, ...mono }}>
                ✓ Invite link ready
              </div>
              <div style={{
                fontSize: 10, ...mono, color: "var(--atlas-muted)",
                background: "rgba(0,0,0,0.25)", borderRadius: 6, padding: "8px 10px",
                wordBreak: "break-all", marginBottom: 10, lineHeight: 1.5,
              }}>
                {getInviteLink(newToken)}
              </div>
              <button
                onClick={() => copy(newToken, "new")}
                style={{
                  width: "100%", padding: "9px 0", borderRadius: 8, fontSize: 11, fontWeight: 700,
                  ...mono, letterSpacing: "0.08em",
                  background: copiedId === "new" ? "rgba(34,197,94,0.15)" : "rgba(201,162,76,0.12)",
                  border: copiedId === "new" ? "1px solid rgba(34,197,94,0.3)" : "1px solid rgba(201,162,76,0.25)",
                  color: copiedId === "new" ? "rgba(74,222,128,0.9)" : "var(--atlas-gold)",
                  cursor: "pointer", transition: "all 150ms ease",
                }}
              >
                {copiedId === "new" ? "✓ Copied!" : "Copy invite link"}
              </button>
            </div>
          )}

          {/* Email compose */}
          <div style={{ display: "flex", gap: 8, marginBottom: 20 }}>
            <input
              ref={inputRef}
              type="email"
              value={email}
              onChange={e => { setEmail(e.target.value); setError(""); }}
              onKeyDown={e => { if (e.key === "Enter") send(); }}
              placeholder="colleague@company.com"
              style={{
                flex: 1, padding: "10px 13px", borderRadius: 10, fontSize: 13,
                background: "var(--atlas-bg)", border: "1px solid var(--atlas-border)",
                color: "var(--atlas-fg)", outline: "none", fontFamily: "inherit",
                transition: "border-color 150ms ease",
              }}
              onFocus={e => { e.currentTarget.style.borderColor = "rgba(201,162,76,0.4)"; }}
              onBlur={e => { e.currentTarget.style.borderColor = "var(--atlas-border)"; }}
            />
            <button
              onClick={send}
              disabled={sending || !email.trim()}
              style={{
                padding: "10px 16px", borderRadius: 10, fontSize: 11, fontWeight: 700,
                ...mono, letterSpacing: "0.06em", flexShrink: 0,
                background: sending || !email.trim() ? "rgba(201,162,76,0.08)" : "linear-gradient(180deg,#D4AF37,#B8942A)",
                border: sending || !email.trim() ? "1px solid rgba(201,162,76,0.12)" : "1px solid rgba(212,175,55,0.4)",
                color: sending || !email.trim() ? "rgba(201,162,76,0.3)" : "#0C0A09",
                cursor: sending || !email.trim() ? "not-allowed" : "pointer",
                transition: "all 150ms ease",
              }}
            >
              {sending ? "…" : "Send"}
            </button>
          </div>

          {error && (
            <div style={{ fontSize: 11, color: "rgba(252,165,165,0.8)", marginTop: -12, marginBottom: 14, ...mono }}>{error}</div>
          )}

          {/* Pending invites */}
          {pending.length > 0 && (
            <div style={{ marginBottom: 20 }}>
              <div style={{ fontSize: 9.5, ...mono, letterSpacing: "0.18em", textTransform: "uppercase", color: "var(--atlas-muted)", marginBottom: 10, opacity: 0.6 }}>
                Pending ({pending.length})
              </div>
              {pending.map(inv => (
                <div key={inv.id} style={{
                  display: "flex", alignItems: "center", gap: 10, padding: "10px 12px",
                  borderRadius: 10, background: "rgba(0,0,0,0.2)", border: "1px solid var(--atlas-border)",
                  marginBottom: 6,
                }}>
                  <div style={{
                    width: 28, height: 28, borderRadius: "50%", flexShrink: 0,
                    background: "rgba(201,162,76,0.08)", border: "1px solid rgba(201,162,76,0.15)",
                    display: "flex", alignItems: "center", justifyContent: "center",
                    fontSize: 11, fontWeight: 700, color: "rgba(201,162,76,0.5)", ...mono,
                  }}>
                    {inv.email[0]?.toUpperCase()}
                  </div>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontSize: 12, color: "var(--atlas-fg)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{inv.email}</div>
                    <div style={{ fontSize: 9.5, color: "var(--atlas-muted)", ...mono, marginTop: 1 }}>Sent {timeAgo(inv.createdAt)}</div>
                  </div>
                  <button
                    onClick={() => copy(inv.token, inv.id)}
                    title="Copy invite link"
                    style={{
                      padding: "4px 8px", borderRadius: 6, fontSize: 10, ...mono,
                      background: copiedId === inv.id ? "rgba(34,197,94,0.12)" : "rgba(201,162,76,0.08)",
                      border: copiedId === inv.id ? "1px solid rgba(34,197,94,0.25)" : "1px solid rgba(201,162,76,0.15)",
                      color: copiedId === inv.id ? "rgba(74,222,128,0.85)" : "rgba(201,162,76,0.6)",
                      cursor: "pointer", flexShrink: 0,
                    }}
                  >
                    {copiedId === inv.id ? "✓" : "Copy"}
                  </button>
                  <button
                    onClick={() => cancel(inv.id)}
                    title="Cancel invite"
                    style={{ padding: "4px 8px", borderRadius: 6, fontSize: 10, background: "transparent", border: "1px solid rgba(239,68,68,0.18)", color: "rgba(239,68,68,0.45)", cursor: "pointer", flexShrink: 0 }}
                  >
                    Revoke
                  </button>
                </div>
              ))}
            </div>
          )}

          {/* Accepted invites */}
          {accepted.length > 0 && (
            <div style={{ marginBottom: 20 }}>
              <div style={{ fontSize: 9.5, ...mono, letterSpacing: "0.18em", textTransform: "uppercase", color: "var(--atlas-muted)", marginBottom: 10, opacity: 0.6 }}>
                Accepted ({accepted.length})
              </div>
              {accepted.map(inv => (
                <div key={inv.id} style={{
                  display: "flex", alignItems: "center", gap: 10, padding: "8px 12px",
                  borderRadius: 10, background: "rgba(34,197,94,0.04)", border: "1px solid rgba(34,197,94,0.1)",
                  marginBottom: 6, opacity: 0.7,
                }}>
                  <div style={{ width: 6, height: 6, borderRadius: "50%", background: "rgba(74,222,128,0.6)", flexShrink: 0 }} />
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontSize: 12, color: "var(--atlas-fg)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{inv.email}</div>
                    <div style={{ fontSize: 9.5, color: "var(--atlas-muted)", ...mono, marginTop: 1 }}>Joined {timeAgo(inv.acceptedAt!)}</div>
                  </div>
                </div>
              ))}
            </div>
          )}

          {invites !== null && pending.length === 0 && accepted.length === 0 && !newToken && (
            <div style={{ textAlign: "center", padding: "20px 0 8px", fontSize: 12, color: "var(--atlas-muted)", ...mono }}>
              No invites yet. Enter an email above to get started.
            </div>
          )}
        </div>
      </div>
    </div>,
    document.body
  );
}
