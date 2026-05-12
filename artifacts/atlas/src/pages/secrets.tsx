import { useState, useEffect, useCallback } from "react";
import { useLocation } from "wouter";
import type { CSSProperties } from "react";
import { LoadingSpinner } from "../components/ui/loading-spinner";

const mono: CSSProperties = { fontFamily: "var(--app-font-mono)" };
const sans: CSSProperties = { fontFamily: "var(--app-font-sans)" };

interface SecretItem {
  id: number;
  projectId: number | null;
  projectName: string;
  label: string;
  maskedValue: string;
  createdAt: string;
}

interface Project { id: number; name: string; }

function formatDate(iso: string): string {
  try {
    const d = new Date(iso);
    return d.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
  } catch { return iso; }
}

export default function SecretsPage() {
  const [, setLocation] = useLocation();
  const [secrets, setSecrets] = useState<SecretItem[]>([]);
  const [projects, setProjects] = useState<Project[]>([]);
  const [loading, setLoading] = useState(true);
  const [revealedId, setRevealedId] = useState<number | null>(null);
  const [revealedValue, setRevealedValue] = useState<string | null>(null);
  const [revealLoading, setRevealLoading] = useState<number | null>(null);
  const [copiedId, setCopiedId] = useState<number | null>(null);
  const [confirmDeleteId, setConfirmDeleteId] = useState<number | null>(null);
  const [deletingId, setDeletingId] = useState<number | null>(null);
  const [showAdd, setShowAdd] = useState(false);
  const [toast, setToast] = useState<string | null>(null);
  const [search, setSearch] = useState("");

  // Add form state
  const [addLabel, setAddLabel] = useState("");
  const [addValue, setAddValue] = useState("");
  const [addProjectId, setAddProjectId] = useState<number | null>(null);
  const [addProjectName, setAddProjectName] = useState("General");
  const [addLoading, setAddLoading] = useState(false);
  const [addError, setAddError] = useState<string | null>(null);
  const [showValue, setShowValue] = useState(false);

  const showToast = (msg: string) => {
    setToast(msg);
    setTimeout(() => setToast(null), 2400);
  };

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [sRes, pRes] = await Promise.all([
        fetch("/api/secrets"),
        fetch("/api/projects"),
      ]);
      if (sRes.ok) setSecrets(await sRes.json());
      if (pRes.ok) {
        const pData = await pRes.json();
        setProjects(Array.isArray(pData) ? pData : (pData.projects ?? []));
      }
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  const handleReveal = async (id: number) => {
    if (revealedId === id) {
      setRevealedId(null);
      setRevealedValue(null);
      return;
    }
    setRevealLoading(id);
    try {
      const res = await fetch(`/api/secrets/${id}/reveal`);
      if (res.ok) {
        const data = await res.json();
        setRevealedId(id);
        setRevealedValue(data.value);
      }
    } finally {
      setRevealLoading(null);
    }
  };

  const handleCopy = async (id: number, value: string) => {
    try { await navigator.clipboard.writeText(value); } catch { /* ignore */ }
    setCopiedId(id);
    showToast("Copied to clipboard");
    setTimeout(() => setCopiedId(null), 2000);
  };

  const handleDelete = async (id: number) => {
    setDeletingId(id);
    try {
      await fetch(`/api/secrets/${id}`, { method: "DELETE" });
      setSecrets(prev => prev.filter(s => s.id !== id));
      if (revealedId === id) { setRevealedId(null); setRevealedValue(null); }
      showToast("Secret removed");
    } finally {
      setDeletingId(null);
      setConfirmDeleteId(null);
    }
  };

  const handleAdd = async () => {
    if (!addLabel.trim() || !addValue.trim()) return;
    setAddLoading(true);
    setAddError(null);
    try {
      const res = await fetch("/api/secrets", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          label: addLabel.trim(),
          value: addValue.trim(),
          projectId: addProjectId,
          projectName: addProjectName || "General",
        }),
      });
      if (!res.ok) throw new Error("Failed to save");
      const newSecret = await res.json();
      setSecrets(prev => [newSecret, ...prev]);
      setAddLabel("");
      setAddValue("");
      setAddProjectId(null);
      setAddProjectName("General");
      setShowAdd(false);
      showToast("Secret saved");
    } catch {
      setAddError("Could not save — try again.");
    } finally {
      setAddLoading(false);
    }
  };

  const filtered = secrets.filter(s => {
    if (!search.trim()) return true;
    const q = search.toLowerCase();
    return s.label.toLowerCase().includes(q) || s.projectName.toLowerCase().includes(q);
  });

  // Group by project
  const grouped: Record<string, SecretItem[]> = {};
  for (const s of filtered) {
    const key = s.projectName || "General";
    if (!grouped[key]) grouped[key] = [];
    grouped[key].push(s);
  }

  return (
    <div style={{ height: "100dvh", overflowY: "auto", background: "transparent", display: "flex", flexDirection: "column" }}>

      {toast && (
        <div style={{ position: "fixed", top: 20, left: "50%", transform: "translateX(-50%)", zIndex: 99999, background: "rgba(12,10,9,0.97)", border: "1px solid rgba(201,162,76,0.45)", borderRadius: 10, padding: "9px 18px", ...mono, fontSize: 11, fontWeight: 700, letterSpacing: "0.08em", color: "var(--atlas-gold)", boxShadow: "0 8px 32px rgba(0,0,0,0.6)", pointerEvents: "none" }}>
          {toast}
        </div>
      )}

      <header style={{ display: "flex", alignItems: "center", gap: 12, padding: "16px 20px", borderBottom: "1px solid var(--atlas-border)", flexShrink: 0 }}>
        <button onClick={() => setLocation("/")} style={{ background: "transparent", border: "none", cursor: "pointer", color: "var(--atlas-muted)", display: "flex", alignItems: "center", gap: 6, padding: 0 }}>
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
            <path d="M19 12H5M12 5l-7 7 7 7" />
          </svg>
          <span style={{ ...mono, fontSize: 10, letterSpacing: "0.12em", textTransform: "uppercase" }}>Back</span>
        </button>
        <div style={{ width: 1, height: 16, background: "var(--atlas-border)" }} />
        <span style={{ ...mono, fontSize: 10, letterSpacing: "0.18em", textTransform: "uppercase", color: "var(--atlas-gold)", opacity: 0.8 }}>
          Secrets
        </span>
        <div style={{ flex: 1 }} />
        <div style={{ display: "flex", alignItems: "center", gap: 8, background: "rgba(255,255,255,0.03)", border: "1px solid var(--atlas-border)", borderRadius: 8, padding: "6px 12px" }}>
          <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" style={{ color: "var(--atlas-muted)", flexShrink: 0, opacity: 0.6 }}>
            <circle cx="11" cy="11" r="8" /><path d="m21 21-4.35-4.35" />
          </svg>
          <input type="text" value={search} onChange={e => setSearch(e.target.value)} placeholder="Search secrets…" style={{ background: "transparent", border: "none", outline: "none", ...sans, fontSize: 12, color: "var(--atlas-fg)", width: 120 }} />
        </div>
        <button
          onClick={() => setShowAdd(v => !v)}
          style={{ display: "flex", alignItems: "center", gap: 6, padding: "7px 14px", borderRadius: 8, background: "rgba(201,162,76,0.1)", border: "1px solid rgba(201,162,76,0.25)", color: "var(--atlas-gold)", ...mono, fontSize: 11, fontWeight: 700, letterSpacing: "0.08em", cursor: "pointer" }}
        >
          + Add
        </button>
      </header>

      <div style={{ padding: "28px 20px 0" }}>
        <h1 style={{ ...sans, fontSize: 24, fontWeight: 600, color: "var(--atlas-fg)", marginBottom: 4, lineHeight: 1.2 }}>Secrets</h1>
        <p style={{ ...mono, fontSize: 10, letterSpacing: "0.12em", color: "var(--atlas-muted)", marginBottom: showAdd ? 20 : 28, opacity: 0.5, textTransform: "uppercase" }}>
          Encrypted per-project · Tap to reveal · Copy &amp; go
        </p>
      </div>

      {showAdd && (
        <div style={{ margin: "0 20px 24px", borderRadius: 14, background: "var(--atlas-surface)", border: "1px solid rgba(201,162,76,0.2)", padding: "18px 18px 14px" }}>
          <div style={{ ...mono, fontSize: 9.5, fontWeight: 700, letterSpacing: "0.14em", textTransform: "uppercase", color: "var(--atlas-gold)", opacity: 0.7, marginBottom: 14 }}>New Secret</div>

          <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
            <div>
              <label style={{ ...mono, fontSize: 9.5, letterSpacing: "0.1em", textTransform: "uppercase", color: "var(--atlas-muted)", opacity: 0.7, display: "block", marginBottom: 6 }}>Label</label>
              <input
                type="text"
                value={addLabel}
                onChange={e => setAddLabel(e.target.value)}
                placeholder="e.g. Stripe Secret Key"
                style={{ width: "100%", borderRadius: 8, border: "1px solid rgba(201,162,76,0.2)", background: "rgba(255,255,255,0.02)", padding: "9px 12px", color: "var(--atlas-fg)", ...sans, fontSize: 13, outline: "none", boxSizing: "border-box" }}
              />
            </div>

            <div>
              <label style={{ ...mono, fontSize: 9.5, letterSpacing: "0.1em", textTransform: "uppercase", color: "var(--atlas-muted)", opacity: 0.7, display: "block", marginBottom: 6 }}>Value</label>
              <div style={{ position: "relative" }}>
                <input
                  type={showValue ? "text" : "password"}
                  value={addValue}
                  onChange={e => setAddValue(e.target.value)}
                  placeholder="sk-••••••••"
                  style={{ width: "100%", borderRadius: 8, border: "1px solid rgba(201,162,76,0.2)", background: "rgba(255,255,255,0.02)", padding: "9px 40px 9px 12px", color: "var(--atlas-fg)", ...sans, fontSize: 13, outline: "none", boxSizing: "border-box" }}
                />
                <button onClick={() => setShowValue(v => !v)} style={{ position: "absolute", right: 10, top: "50%", transform: "translateY(-50%)", background: "none", border: "none", cursor: "pointer", color: "var(--atlas-muted)", opacity: 0.5, padding: 2 }}>
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
                    {showValue ? <><path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94" /><path d="M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19" /><line x1="1" y1="1" x2="23" y2="23" /></> : <><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z" /><circle cx="12" cy="12" r="3" /></>}
                  </svg>
                </button>
              </div>
            </div>

            <div>
              <label style={{ ...mono, fontSize: 9.5, letterSpacing: "0.1em", textTransform: "uppercase", color: "var(--atlas-muted)", opacity: 0.7, display: "block", marginBottom: 6 }}>Project (optional)</label>
              <select
                value={addProjectId ?? ""}
                onChange={e => {
                  const val = e.target.value;
                  if (!val) { setAddProjectId(null); setAddProjectName("General"); }
                  else {
                    const p = projects.find(p => p.id === Number(val));
                    setAddProjectId(Number(val));
                    setAddProjectName(p?.name ?? "General");
                  }
                }}
                style={{ width: "100%", borderRadius: 8, border: "1px solid rgba(201,162,76,0.2)", background: "var(--atlas-surface)", padding: "9px 12px", color: "var(--atlas-fg)", ...sans, fontSize: 13, outline: "none", boxSizing: "border-box" }}
              >
                <option value="">General (no project)</option>
                {projects.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
              </select>
            </div>

            {addError && <div style={{ fontSize: 12, color: "rgba(239,100,100,0.9)", ...mono }}>{addError}</div>}

            <div style={{ display: "flex", gap: 8, marginTop: 2 }}>
              <button
                onClick={handleAdd}
                disabled={addLoading || !addLabel.trim() || !addValue.trim()}
                style={{ flex: 1, padding: "10px", borderRadius: 8, background: (!addLabel.trim() || !addValue.trim()) ? "rgba(201,162,76,0.08)" : "var(--atlas-gold)", color: (!addLabel.trim() || !addValue.trim()) ? "rgba(201,162,76,0.3)" : "#0D0B09", border: "none", ...mono, fontSize: 12, fontWeight: 700, letterSpacing: "0.08em", cursor: addLoading || !addLabel.trim() || !addValue.trim() ? "not-allowed" : "pointer" }}
              >
                {addLoading ? "Saving…" : "Save Secret"}
              </button>
              <button onClick={() => { setShowAdd(false); setAddLabel(""); setAddValue(""); setAddError(null); }} style={{ padding: "10px 16px", borderRadius: 8, background: "transparent", border: "1px solid rgba(120,113,108,0.2)", color: "var(--atlas-muted)", ...mono, fontSize: 12, cursor: "pointer" }}>
                Cancel
              </button>
            </div>
          </div>
        </div>
      )}

      <main style={{ flex: 1, padding: "0 20px 100px" }}>
        {loading && (
          <div style={{ display: "flex", alignItems: "center", justifyContent: "center", paddingTop: 80 }}>
            <LoadingSpinner size="lg" color="atlas" />
          </div>
        )}

        {!loading && filtered.length === 0 && (
          <div style={{ textAlign: "center", paddingTop: 80 }}>
            <div style={{ fontSize: 28, marginBottom: 16, opacity: 0.2, color: "var(--atlas-gold)" }}>⬡</div>
            <p style={{ ...sans, fontSize: 14, color: "var(--atlas-muted)", marginBottom: 6, opacity: 0.6 }}>
              {secrets.length === 0 ? "No secrets stored yet." : "No results for that search."}
            </p>
            {secrets.length === 0 && (
              <p style={{ ...mono, fontSize: 10, letterSpacing: "0.1em", color: "var(--atlas-muted)", opacity: 0.4, maxWidth: 280, margin: "0 auto" }}>
                TAP "+ ADD" TO STORE YOUR FIRST SECRET
              </p>
            )}
          </div>
        )}

        {!loading && Object.keys(grouped).length > 0 && (
          <div style={{ display: "flex", flexDirection: "column", gap: 28 }}>
            {Object.entries(grouped).map(([projectName, items]) => (
              <div key={projectName}>
                <div style={{ ...mono, fontSize: 9.5, fontWeight: 700, letterSpacing: "0.14em", textTransform: "uppercase", color: "var(--atlas-gold)", opacity: 0.55, marginBottom: 10 }}>
                  {projectName}
                </div>
                <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                  {items.map(s => {
                    const isRevealed = revealedId === s.id;
                    const displayValue = isRevealed ? revealedValue ?? "" : s.maskedValue;
                    return (
                      <div key={s.id} style={{ borderRadius: 12, background: "var(--atlas-surface)", border: `1px solid ${isRevealed ? "rgba(201,162,76,0.3)" : "var(--atlas-border)"}`, padding: "14px 16px", transition: "border-color 200ms ease" }}>
                        <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: 12 }}>
                          <div style={{ flex: 1, minWidth: 0 }}>
                            <div style={{ ...sans, fontSize: 13, fontWeight: 500, color: "var(--atlas-fg)", marginBottom: 6 }}>{s.label}</div>
                            <div style={{
                              ...mono, fontSize: 12, letterSpacing: isRevealed ? "0.02em" : "0.06em",
                              color: isRevealed ? "rgba(201,162,76,0.9)" : "var(--atlas-muted)",
                              wordBreak: "break-all", lineHeight: 1.5,
                              background: isRevealed ? "rgba(201,162,76,0.06)" : "transparent",
                              borderRadius: isRevealed ? 6 : 0, padding: isRevealed ? "6px 8px" : 0,
                              transition: "all 200ms ease",
                            }}>
                              {displayValue}
                            </div>
                          </div>
                          <div style={{ display: "flex", gap: 6, flexShrink: 0 }}>
                            <button
                              onClick={() => handleReveal(s.id)}
                              style={{ width: 30, height: 30, borderRadius: 7, border: `1px solid ${isRevealed ? "rgba(201,162,76,0.3)" : "rgba(120,113,108,0.2)"}`, background: isRevealed ? "rgba(201,162,76,0.08)" : "transparent", color: isRevealed ? "var(--atlas-gold)" : "var(--atlas-muted)", cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center", opacity: revealLoading === s.id ? 0.5 : 1 }}
                              title={isRevealed ? "Hide" : "Reveal"}
                            >
                              {revealLoading === s.id ? (
                                <div style={{ width: 10, height: 10, border: "1.5px solid rgba(201,162,76,0.4)", borderTopColor: "var(--atlas-gold)", borderRadius: "50%", animation: "spin 0.7s linear infinite" }} />
                              ) : (
                                <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round">
                                  {isRevealed ? <><path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94" /><path d="M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19" /><line x1="1" y1="1" x2="23" y2="23" /></> : <><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z" /><circle cx="12" cy="12" r="3" /></>}
                                </svg>
                              )}
                            </button>
                            {isRevealed && revealedValue && (
                              <button
                                onClick={() => handleCopy(s.id, revealedValue)}
                                style={{ width: 30, height: 30, borderRadius: 7, border: `1px solid ${copiedId === s.id ? "rgba(34,197,94,0.4)" : "rgba(201,162,76,0.2)"}`, background: copiedId === s.id ? "rgba(34,197,94,0.08)" : "rgba(201,162,76,0.06)", color: copiedId === s.id ? "rgba(134,239,172,0.9)" : "var(--atlas-gold)", cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center" }}
                                title="Copy"
                              >
                                <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
                                  {copiedId === s.id ? <><polyline points="20 6 9 17 4 12" /></> : <><rect x="9" y="9" width="13" height="13" rx="2" ry="2" /><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" /></>}
                                </svg>
                              </button>
                            )}
                            {confirmDeleteId === s.id ? (
                              <>
                                <button onClick={() => handleDelete(s.id)} disabled={deletingId === s.id} style={{ height: 30, padding: "0 10px", borderRadius: 7, border: "1px solid rgba(239,68,68,0.35)", background: "rgba(239,68,68,0.08)", color: "rgba(239,100,100,0.9)", ...mono, fontSize: 10, fontWeight: 700, cursor: "pointer" }}>
                                  {deletingId === s.id ? "…" : "Delete"}
                                </button>
                                <button onClick={() => setConfirmDeleteId(null)} style={{ height: 30, padding: "0 10px", borderRadius: 7, border: "1px solid rgba(120,113,108,0.2)", background: "transparent", color: "var(--atlas-muted)", ...mono, fontSize: 10, cursor: "pointer" }}>
                                  Cancel
                                </button>
                              </>
                            ) : (
                              <button onClick={() => setConfirmDeleteId(s.id)} style={{ width: 30, height: 30, borderRadius: 7, border: "1px solid rgba(120,113,108,0.15)", background: "transparent", color: "rgba(120,113,108,0.4)", cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center" }} title="Delete">
                                <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round">
                                  <polyline points="3 6 5 6 21 6" /><path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6" /><path d="M10 11v6M14 11v6" />
                                </svg>
                              </button>
                            )}
                          </div>
                        </div>
                        <div style={{ marginTop: 8, ...mono, fontSize: 9.5, color: "var(--atlas-muted)", opacity: 0.35, letterSpacing: "0.06em" }}>
                          Added {formatDate(s.createdAt)}
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            ))}
          </div>
        )}
      </main>

      <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>
    </div>
  );
}
