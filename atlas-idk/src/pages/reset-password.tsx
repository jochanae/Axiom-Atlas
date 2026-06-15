import { useState, useEffect } from "react";
import { useLocation, useSearch } from "wouter";

const BASE = import.meta.env.BASE_URL.replace(/\/$/, "");

export default function ResetPassword() {
  const [, navigate] = useLocation();
  const search = useSearch();
  const token = new URLSearchParams(search).get("token") ?? "";

  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);

  const mono: React.CSSProperties = { fontFamily: "var(--app-font-mono)" };

  const inputStyle: React.CSSProperties = {
    width: "100%",
    padding: "11px 14px",
    borderRadius: 9,
    background: "var(--atlas-surface)",
    border: "1px solid rgba(255,255,255,0.07)",
    color: "var(--atlas-fg)",
    fontSize: 13,
    fontFamily: "inherit",
    outline: "none",
    boxSizing: "border-box",
    transition: "border-color 180ms ease, box-shadow 180ms ease",
  };

  useEffect(() => {
    if (!token) navigate("/login");
  }, [token, navigate]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    if (password.length < 8) { setError("Password must be at least 8 characters"); return; }
    if (password !== confirm) { setError("Passwords do not match"); return; }
    setLoading(true);
    try {
      const res = await fetch(`${BASE}/api/auth/reset-password`, {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ token, password }),
      });
      const data = await res.json() as { error?: string };
      if (!res.ok) throw new Error(data.error ?? "Something went wrong");
      setDone(true);
      setTimeout(() => navigate("/login"), 2500);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Something went wrong");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div style={{
      minHeight: "100dvh",
      width: "100%",
      display: "flex",
      alignItems: "flex-start",
      justifyContent: "center",
      background: "var(--atlas-bg)",
      padding: "40px 16px",
      overflowY: "auto",
      WebkitOverflowScrolling: "touch",
    }}>
      <div style={{ width: "100%", maxWidth: 400, position: "relative" }}>
        <div className="atlas-input-shell" style={{
          borderRadius: 18,
          padding: "36px 28px 32px",
          background: "var(--atlas-surface)",
          backdropFilter: "blur(28px) saturate(140%)",
          boxShadow: "0 32px 80px rgba(0,0,0,0.7), 0 0 0 0.5px rgba(201,162,76,0.08)",
        }}>
          <div style={{ textAlign: "center", marginBottom: 32 }}>
            <div style={{ fontSize: 11, ...mono, letterSpacing: "0.35em", color: "var(--atlas-gold)", opacity: 0.6, textTransform: "uppercase", marginBottom: 10 }}>
              Axiom
            </div>
            <div style={{ fontSize: 22, fontWeight: 300, color: "var(--atlas-fg)", letterSpacing: "0.04em", marginBottom: 6 }}>
              {done ? "Key updated." : "Set new key."}
            </div>
            <div style={{ fontSize: 11, ...mono, color: "var(--atlas-muted)", opacity: 0.5, letterSpacing: "0.06em" }}>
              {done ? "Redirecting to login…" : "Choose a new password for your account."}
            </div>
          </div>

          {!done && (
            <form onSubmit={handleSubmit} style={{ display: "flex", flexDirection: "column", gap: 14 }}>
              <div>
                <label style={{ display: "block", fontSize: 9, ...mono, letterSpacing: "0.2em", textTransform: "uppercase", color: "var(--atlas-muted)", opacity: 0.6, marginBottom: 6 }}>
                  New Key (Password)
                </label>
                <input
                  type="password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  placeholder="Min. 8 characters"
                  autoComplete="new-password"
                  required
                  style={inputStyle}
                  onFocus={(e) => { e.currentTarget.style.borderColor = "rgba(201,162,76,0.45)"; e.currentTarget.style.boxShadow = "0 0 0 1px rgba(201,162,76,0.15)"; }}
                  onBlur={(e) => { e.currentTarget.style.borderColor = "rgba(255,255,255,0.07)"; e.currentTarget.style.boxShadow = "none"; }}
                />
              </div>
              <div>
                <label style={{ display: "block", fontSize: 9, ...mono, letterSpacing: "0.2em", textTransform: "uppercase", color: "var(--atlas-muted)", opacity: 0.6, marginBottom: 6 }}>
                  Confirm Key
                </label>
                <input
                  type="password"
                  value={confirm}
                  onChange={(e) => setConfirm(e.target.value)}
                  placeholder="Repeat password"
                  autoComplete="new-password"
                  required
                  style={inputStyle}
                  onFocus={(e) => { e.currentTarget.style.borderColor = "rgba(201,162,76,0.45)"; e.currentTarget.style.boxShadow = "0 0 0 1px rgba(201,162,76,0.15)"; }}
                  onBlur={(e) => { e.currentTarget.style.borderColor = "rgba(255,255,255,0.07)"; e.currentTarget.style.boxShadow = "none"; }}
                />
              </div>

              {error && (
                <div style={{ padding: "9px 12px", borderRadius: 8, background: "rgba(146,64,14,0.1)", border: "1px solid rgba(146,64,14,0.3)", fontSize: 11, ...mono, color: "rgba(251,191,36,0.9)", lineHeight: 1.5 }}>
                  {error}
                </div>
              )}

              <button
                type="submit"
                disabled={loading || !password || !confirm}
                style={{
                  width: "100%",
                  padding: "13px 16px",
                  borderRadius: 10,
                  background: loading || !password || !confirm ? "rgba(201,162,76,0.12)" : "linear-gradient(180deg, #D4AF37 0%, #B8942A 100%)",
                  border: loading || !password || !confirm ? "1px solid rgba(201,162,76,0.15)" : "1px solid rgba(212,175,55,0.4)",
                  color: loading || !password || !confirm ? "rgba(201,162,76,0.3)" : "#0C0A09",
                  fontSize: 11, fontWeight: 700, ...mono, letterSpacing: "0.18em", textTransform: "uppercase",
                  cursor: loading || !password || !confirm ? "not-allowed" : "pointer",
                  transition: "all 240ms ease",
                  marginTop: 4,
                }}
              >
                {loading ? "Updating…" : "Update Key"}
              </button>
            </form>
          )}
        </div>
      </div>
    </div>
  );
}
