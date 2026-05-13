import { useState, useEffect } from "react";
import { useLocation } from "wouter";
import { useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { useAuth } from "@/hooks/useAuth";

type Mode = "login" | "signup" | "forgot";

const BASE = import.meta.env.BASE_URL.replace(/\/$/, "");

async function apiPost(path: string, body: Record<string, string>) {
  const res = await fetch(`${BASE}${path}`, {
    method: "POST",
    credentials: "include",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const data = await res.json() as { error?: string; message?: string };
  if (!res.ok) throw new Error(data.error ?? "Something went wrong");
  return data;
}

export default function Login() {
  const [mode, setMode] = useState<Mode>("login");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [name, setName] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [forgotSent, setForgotSent] = useState(false);
  const [, navigate] = useLocation();
  const queryClient = useQueryClient();
  const { user, isLoading } = useAuth();

  const sessionExpired = typeof window !== "undefined"
    && new URLSearchParams(window.location.search).get("reason") === "session_expired";

  const googleEmailConflict = false; // Removed: server now auto-links Google to existing email accounts

  useEffect(() => {
    if (!isLoading && user) {
      if (sessionStorage.getItem("atlas-just-authed") !== "1" && sessionStorage.getItem("atlas-welcome-toast-shown") !== "1") {
        sessionStorage.setItem("atlas-welcome-toast-shown", "1");
        const first = user.name ? ` ${user.name.split(" ")[0]}` : "";
        toast.success(`Welcome back${first}`, { description: "Session restored.", duration: 3000 });
      }
      navigate("/home");
    }
  }, [user, isLoading, navigate]);

  // Allow page scrolling (global CSS sets overflow:hidden on html/body/root)
  useEffect(() => {
    document.documentElement.classList.add("atlas-login-active");
    return () => document.documentElement.classList.remove("atlas-login-active");
  }, []);

  const handleForgot = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setLoading(true);
    try {
      await apiPost("/api/auth/forgot-password", { email });
      setForgotSent(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Something went wrong");
    } finally {
      setLoading(false);
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setLoading(true);
    try {
      const path = mode === "login" ? "/api/auth/login" : "/api/auth/signup";
      const body: Record<string, string> = { email, password };
      if (mode === "signup" && name.trim()) body.name = name.trim();
      await apiPost(path, body);
      await queryClient.invalidateQueries({ queryKey: ["auth", "me"] });
      sessionStorage.setItem("atlas-just-authed", "1");
      navigate("/home");
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Something went wrong");
    } finally {
      setLoading(false);
    }
  };

  if (isLoading) return (
    <div style={{
      position: "fixed", inset: 0, display: "flex", flexDirection: "column",
      alignItems: "center", justifyContent: "center", background: "var(--atlas-bg)", gap: 18,
    }}>
      <div style={{ fontSize: 10, fontFamily: "var(--app-font-mono)", letterSpacing: "0.35em", color: "var(--atlas-gold)", opacity: 0.5, textTransform: "uppercase" }}>Axiom</div>
      <div style={{
        width: 28, height: 28, borderRadius: "50%",
        border: "2px solid rgba(201,162,76,0.15)",
        borderTopColor: "rgba(201,162,76,0.75)",
        animation: "spin 0.9s linear infinite",
      }} />
    </div>
  );

  const mono: React.CSSProperties = { fontFamily: "var(--app-font-mono)" };

  return (
    <div style={{
      minHeight: "100dvh",
      width: "100%",
      display: "flex",
      alignItems: "flex-start",
      justifyContent: "center",
      background: "var(--atlas-bg)",
      padding: "40px 16px 40px",
      position: "relative",
      overflowY: "auto",
      WebkitOverflowScrolling: "touch",
    }}>

      {/* Background ambient glow */}
      <div style={{
        position: "absolute",
        inset: 0,
        background: "radial-gradient(ellipse 70% 50% at 50% 60%, rgba(146,64,14,0.07) 0%, transparent 70%)",
        pointerEvents: "none",
      }} />

      {/* Back breadcrumb */}
      <button
        onClick={() => navigate("/")}
        style={{
          position: "absolute",
          top: 16,
          left: 16,
          display: "flex",
          alignItems: "center",
          gap: 6,
          background: "none",
          border: "none",
          cursor: "pointer",
          padding: "6px 8px",
          borderRadius: 6,
          color: "var(--atlas-muted)",
          opacity: 0.55,
          fontFamily: "var(--app-font-mono)",
          fontSize: 10,
          letterSpacing: "0.15em",
          textTransform: "uppercase",
          transition: "opacity 160ms ease, color 160ms ease",
        }}
        onMouseEnter={(e) => { e.currentTarget.style.opacity = "1"; e.currentTarget.style.color = "var(--atlas-gold)"; }}
        onMouseLeave={(e) => { e.currentTarget.style.opacity = "0.55"; e.currentTarget.style.color = "var(--atlas-muted)"; }}
      >
        <svg width="12" height="12" viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
          <path d="M8 2L4 6l4 4" />
        </svg>
        Back
      </button>

      {/* Auth card */}
      <div style={{ width: "100%", maxWidth: 400, position: "relative" }}>

        {/* Breathing gold border container */}
        <div className="atlas-input-shell" style={{
          borderRadius: 18,
          padding: "36px 28px 32px",
          background: "var(--atlas-surface)",
          backdropFilter: "blur(28px) saturate(140%)",
          WebkitBackdropFilter: "blur(28px) saturate(140%)",
          boxShadow: "0 32px 80px rgba(0,0,0,0.7), 0 0 0 0.5px rgba(201,162,76,0.08)",
        }}>

          {/* Header */}
          <div style={{ textAlign: "center", marginBottom: 32 }}>
            <div style={{ display: "flex", alignItems: "center", justifyContent: "center", gap: 8, marginBottom: 10 }}>
              <img src="/axiom-logo.svg" alt="Axiom" width={28} height={28} style={{ borderRadius: "20%", flexShrink: 0 }} />
              <span style={{ fontSize: 11, ...mono, letterSpacing: "0.35em", color: "var(--atlas-gold)", opacity: 0.6, textTransform: "uppercase" }}>
                Axiom
              </span>
            </div>
            <div style={{ fontSize: 22, fontWeight: 300, color: "var(--atlas-fg)", letterSpacing: "0.04em", marginBottom: 6 }}>
              {mode === "login" ? "Enter the system." : mode === "signup" ? "Request access." : "Reset key."}
            </div>
            <div style={{ fontSize: 11, ...mono, color: "var(--atlas-muted)", opacity: 0.5, letterSpacing: "0.06em" }}>
              {mode === "login" ? "Identify yourself to enter Axiom." : mode === "signup" ? "Create your identity." : "Enter your email to receive a reset link."}
            </div>
          </div>

          {/* Session expired banner */}
          {sessionExpired && mode === "login" && (
            <div style={{ padding: "9px 12px", borderRadius: 8, background: "rgba(146,64,14,0.1)", border: "1px solid rgba(146,64,14,0.3)", fontSize: 11, ...mono, color: "rgba(251,191,36,0.9)", lineHeight: 1.5, marginBottom: 20, textAlign: "center" }}>
              Your session expired. Please sign in again.
            </div>
          )}

          {/* Google sign-in conflict: email already has a password account */}
          {googleEmailConflict && mode === "login" && (
            <div style={{ padding: "9px 12px", borderRadius: 8, background: "rgba(146,64,14,0.1)", border: "1px solid rgba(146,64,14,0.3)", fontSize: 11, ...mono, color: "rgba(251,191,36,0.9)", lineHeight: 1.5, marginBottom: 20, textAlign: "center" }}>
              This email is already registered with a password. Sign in with your email and password below.
            </div>
          )}

          {/* Forgot password flow */}
          {mode === "forgot" && (
            <div>
              {forgotSent ? (
                <div style={{ textAlign: "center", padding: "20px 0" }}>
                  <div style={{ fontSize: 13, color: "var(--atlas-fg)", marginBottom: 10 }}>Check your email.</div>
                  <div style={{ fontSize: 11, ...mono, color: "var(--atlas-muted)", opacity: 0.6, lineHeight: 1.6 }}>
                    Password reset link will be sent to your email.
                  </div>
                  <button
                    onClick={() => { setMode("login"); setForgotSent(false); setEmail(""); setError(null); }}
                    style={{ marginTop: 20, background: "none", border: "none", cursor: "pointer", fontSize: 11, color: "var(--atlas-gold)", opacity: 0.7, ...mono, letterSpacing: "0.06em", textDecoration: "underline", textDecorationColor: "rgba(201,162,76,0.3)" }}
                  >
                    Back to sign in
                  </button>
                </div>
              ) : (
                <form onSubmit={handleForgot} style={{ display: "flex", flexDirection: "column", gap: 14 }}>
                  <div>
                    <label style={{ display: "block", fontSize: 9, ...mono, letterSpacing: "0.2em", textTransform: "uppercase", color: "var(--atlas-muted)", opacity: 0.6, marginBottom: 6 }}>
                      Identity (Email)
                    </label>
                    <input
                      type="email"
                      value={email}
                      onChange={(e) => setEmail(e.target.value)}
                      placeholder="your@email.com"
                      autoComplete="email"
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
                    disabled={loading || !email}
                    style={{
                      width: "100%", padding: "13px 16px", borderRadius: 10,
                      background: loading || !email ? "rgba(201,162,76,0.12)" : "linear-gradient(180deg, #D4AF37 0%, #B8942A 100%)",
                      border: loading || !email ? "1px solid rgba(201,162,76,0.15)" : "1px solid rgba(212,175,55,0.4)",
                      color: loading || !email ? "rgba(201,162,76,0.3)" : "#0C0A09",
                      fontSize: 11, fontWeight: 700, ...mono, letterSpacing: "0.18em", textTransform: "uppercase",
                      cursor: loading || !email ? "not-allowed" : "pointer", transition: "all 240ms ease", marginTop: 4,
                    }}
                  >
                    {loading ? "Sending…" : "Send Reset Link"}
                  </button>
                  <button
                    type="button"
                    onClick={() => { setMode("login"); setError(null); }}
                    style={{ background: "none", border: "none", cursor: "pointer", fontSize: 11, color: "var(--atlas-muted)", opacity: 0.5, ...mono, letterSpacing: "0.06em", textAlign: "center", marginTop: -4 }}
                  >
                    ← Back to sign in
                  </button>
                </form>
              )}
            </div>
          )}

          {/* Form — hidden in forgot mode */}
          {mode !== "forgot" && <>

          {/* Form */}
          <form onSubmit={handleSubmit} style={{ display: "flex", flexDirection: "column", gap: 14 }}>

            {mode === "signup" && (
              <div>
                <label style={{ display: "block", fontSize: 9, ...mono, letterSpacing: "0.2em", textTransform: "uppercase", color: "var(--atlas-muted)", opacity: 0.6, marginBottom: 6 }}>
                  Name
                </label>
                <input
                  type="text"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  placeholder="Your name"
                  autoComplete="name"
                  style={inputStyle}
                  onFocus={(e) => { e.currentTarget.style.borderColor = "rgba(201,162,76,0.45)"; e.currentTarget.style.boxShadow = "0 0 0 1px rgba(201,162,76,0.15)"; }}
                  onBlur={(e) => { e.currentTarget.style.borderColor = "rgba(255,255,255,0.07)"; e.currentTarget.style.boxShadow = "none"; }}
                />
              </div>
            )}

            <div>
              <label style={{ display: "block", fontSize: 9, ...mono, letterSpacing: "0.2em", textTransform: "uppercase", color: "var(--atlas-muted)", opacity: 0.6, marginBottom: 6 }}>
                Identity (Email)
              </label>
              <input
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="your@email.com"
                autoComplete="email"
                required
                style={inputStyle}
                onFocus={(e) => { e.currentTarget.style.borderColor = "rgba(201,162,76,0.45)"; e.currentTarget.style.boxShadow = "0 0 0 1px rgba(201,162,76,0.15)"; }}
                onBlur={(e) => { e.currentTarget.style.borderColor = "rgba(255,255,255,0.07)"; e.currentTarget.style.boxShadow = "none"; }}
              />
            </div>

            <div>
              <label style={{ display: "block", fontSize: 9, ...mono, letterSpacing: "0.2em", textTransform: "uppercase", color: "var(--atlas-muted)", opacity: 0.6, marginBottom: 6 }}>
                Key (Password)
              </label>
              <div style={{ position: "relative" }}>
                <input
                  type={showPassword ? "text" : "password"}
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  placeholder={mode === "signup" ? "Min. 8 characters" : "••••••••"}
                  autoComplete={mode === "login" ? "current-password" : "new-password"}
                  required
                  style={{ ...inputStyle, paddingRight: 44 }}
                  onFocus={(e) => { e.currentTarget.style.borderColor = "rgba(201,162,76,0.45)"; e.currentTarget.style.boxShadow = "0 0 0 1px rgba(201,162,76,0.15)"; }}
                  onBlur={(e) => { e.currentTarget.style.borderColor = "rgba(255,255,255,0.07)"; e.currentTarget.style.boxShadow = "none"; }}
                />
                <button
                  type="button"
                  onClick={() => setShowPassword(!showPassword)}
                  style={{
                    position: "absolute",
                    right: 12,
                    top: "50%",
                    transform: "translateY(-50%)",
                    background: "none",
                    border: "none",
                    cursor: "pointer",
                    padding: 4,
                    color: "var(--atlas-muted)",
                    opacity: 0.5,
                    display: "flex",
                    alignItems: "center",
                  }}
                  tabIndex={-1}
                >
                  {showPassword ? <EyeOffIcon /> : <EyeIcon />}
                </button>
              </div>
              {mode === "login" && (
                <div style={{ textAlign: "right", marginTop: 6 }}>
                  <button
                    type="button"
                    onClick={() => { setMode("forgot"); setError(null); }}
                    style={{ background: "none", border: "none", cursor: "pointer", fontSize: 10, ...mono, color: "var(--atlas-muted)", opacity: 0.5, letterSpacing: "0.06em", padding: 0, textDecoration: "underline", textDecorationColor: "rgba(120,113,108,0.3)" }}
                  >
                    Forgot password?
                  </button>
                </div>
              )}
            </div>

            {error && (
              <div style={{
                padding: "9px 12px",
                borderRadius: 8,
                background: "rgba(146,64,14,0.1)",
                border: "1px solid rgba(146,64,14,0.3)",
                fontSize: 11,
                ...mono,
                color: "rgba(251,191,36,0.9)",
                lineHeight: 1.5,
              }}>
                {error}
              </div>
            )}

            <button
              type="submit"
              disabled={loading || !email || !password}
              style={{
                width: "100%",
                padding: "13px 16px",
                borderRadius: 10,
                background: loading || !email || !password
                  ? "rgba(201,162,76,0.12)"
                  : "linear-gradient(180deg, #D4AF37 0%, #B8942A 100%)",
                border: loading || !email || !password
                  ? "1px solid rgba(201,162,76,0.15)"
                  : "1px solid rgba(212,175,55,0.4)",
                color: loading || !email || !password ? "rgba(201,162,76,0.3)" : "#0C0A09",
                fontSize: 11,
                fontWeight: 700,
                ...mono,
                letterSpacing: "0.18em",
                textTransform: "uppercase",
                cursor: loading || !email || !password ? "not-allowed" : "pointer",
                transition: "all 240ms ease",
                boxShadow: loading || !email || !password
                  ? "none"
                  : "0 0 28px rgba(212,175,55,0.3), 0 0 8px rgba(212,175,55,0.15), inset 0 1px 0 rgba(255,255,255,0.15)",
                marginTop: 4,
              }}
            >
              {loading
                ? mode === "login" ? "Verifying…" : "Creating…"
                : mode === "login" ? "Initiate Session" : "Create Access"}
            </button>
          </form>

          {/* Divider */}
          <div style={{ display: "flex", alignItems: "center", gap: 12, marginTop: 22, marginBottom: 16 }}>
            <div style={{ flex: 1, height: 1, background: "var(--atlas-border)" }} />
            <span style={{ fontSize: 9, ...mono, color: "var(--atlas-muted)", opacity: 0.35, letterSpacing: "0.3em", textTransform: "uppercase" }}>or</span>
            <div style={{ flex: 1, height: 1, background: "var(--atlas-border)" }} />
          </div>

          {/* Social gates */}
          <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
            <a
              href={`${BASE}/api/auth/google`}
              style={{
                width: "100%", display: "flex", alignItems: "center", justifyContent: "center",
                gap: 10, padding: "10px 16px", borderRadius: 10,
                background: "rgba(255,255,255,0.04)", border: "1px solid var(--atlas-border)",
                color: "var(--atlas-fg)", fontSize: 11, ...mono, letterSpacing: "0.12em",
                textTransform: "uppercase", cursor: "pointer", textDecoration: "none",
                transition: "all 200ms ease", boxSizing: "border-box",
              }}
              onMouseEnter={(e) => { e.currentTarget.style.background = "rgba(255,255,255,0.08)"; e.currentTarget.style.borderColor = "rgba(255,255,255,0.22)"; }}
              onMouseLeave={(e) => { e.currentTarget.style.background = "rgba(255,255,255,0.04)"; e.currentTarget.style.borderColor = "var(--atlas-border)"; }}
            >
              <GoogleIcon />
              <span>Continue with Google</span>
            </a>
            <button
              disabled
              title="Apple Sign-In coming soon"
              style={{
                width: "100%", display: "flex", alignItems: "center", justifyContent: "center",
                gap: 10, padding: "10px 16px", borderRadius: 10,
                background: "rgba(255,255,255,0.03)", border: "1px solid rgba(255,255,255,0.07)",
                color: "var(--atlas-muted)", fontSize: 11, ...mono, letterSpacing: "0.12em",
                textTransform: "uppercase", cursor: "not-allowed", opacity: 0.35,
                transition: "all 200ms ease",
              }}
            >
              <AppleIcon />
              <span>Continue with Apple</span>
            </button>
          </div>

          {/* Mode toggle */}
          <div style={{ textAlign: "center", marginTop: 22 }}>
            <span style={{ fontSize: 11, color: "var(--atlas-muted)", opacity: 0.4 }}>
              {mode === "login" ? "No access yet? " : "Already inside? "}
            </span>
            <button
              onClick={() => { setMode(mode === "login" ? "signup" : "login"); setError(null); }}
              style={{
                background: "none", border: "none", cursor: "pointer", fontSize: 11,
                color: "var(--atlas-gold)", opacity: 0.7, ...mono, letterSpacing: "0.06em",
                padding: 0, textDecoration: "underline", textDecorationColor: "rgba(201,162,76,0.3)",
              }}
            >
              {mode === "login" ? "Join." : "Enter."}
            </button>
          </div>
          </>}

        </div>

        {/* Footer links */}
        <div style={{ textAlign: "center", marginTop: 20, display: "flex", justifyContent: "center", gap: 20 }}>
          {[["Terms", "/terms"], ["Privacy", "/privacy"]].map(([label, href]) => (
            <a
              key={label}
              href={href}
              style={{ fontSize: 9.5, ...mono, color: "var(--atlas-muted)", opacity: 0.3, letterSpacing: "0.1em", textDecoration: "none" }}
            >
              {label}
            </a>
          ))}
        </div>
      </div>
    </div>
  );
}

const inputStyle: React.CSSProperties = {
  width: "100%",
  padding: "11px 14px",
  borderRadius: 9,
  background: "rgba(12,10,9,0.6)",
  border: "1px solid rgba(255,255,255,0.07)",
  color: "var(--atlas-fg)",
  fontSize: 13,
  fontFamily: "inherit",
  outline: "none",
  boxSizing: "border-box",
  transition: "border-color 180ms ease, box-shadow 180ms ease",
};

function EyeIcon() {
  return (
    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z" />
      <circle cx="12" cy="12" r="3" />
    </svg>
  );
}

function EyeOffIcon() {
  return (
    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      <path d="M17.94 17.94A10.07 10.07 0 0112 20c-7 0-11-8-11-8a18.45 18.45 0 015.06-5.94M9.9 4.24A9.12 9.12 0 0112 4c7 0 11 8 11 8a18.5 18.5 0 01-2.16 3.19m-6.72-1.07a3 3 0 11-4.24-4.24" />
      <line x1="1" y1="1" x2="23" y2="23" />
    </svg>
  );
}

function GoogleIcon() {
  return (
    <svg width="15" height="15" viewBox="0 0 24 24" fill="currentColor">
      <path d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z" fill="#4285F4" opacity="0.7"/>
      <path d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" fill="#34A853" opacity="0.7"/>
      <path d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z" fill="#FBBC05" opacity="0.7"/>
      <path d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z" fill="#EA4335" opacity="0.7"/>
    </svg>
  );
}

function AppleIcon() {
  return (
    <svg width="15" height="15" viewBox="0 0 24 24" fill="currentColor" style={{ color: "var(--atlas-muted)", opacity: 0.6 }}>
      <path d="M18.71 19.5c-.83 1.24-1.71 2.45-3.05 2.47-1.34.03-1.77-.79-3.29-.79-1.53 0-2 .77-3.27.82-1.31.05-2.3-1.32-3.14-2.53C4.25 17 2.94 12.45 4.7 9.39c.87-1.52 2.43-2.48 4.12-2.51 1.28-.02 2.5.87 3.29.87.78 0 2.26-1.07 3.8-.91.65.03 2.47.26 3.64 1.98-.09.06-2.17 1.28-2.15 3.81.03 3.02 2.65 4.03 2.68 4.04-.03.07-.42 1.44-1.38 2.83M13 3.5c.73-.83 1.94-1.46 2.94-1.5.13 1.17-.34 2.35-1.04 3.19-.69.85-1.83 1.51-2.95 1.42-.15-1.15.41-2.35 1.05-3.11z"/>
    </svg>
  );
}
