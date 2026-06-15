import { useState, useEffect, useRef, useCallback } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { useAuth, useLogout } from "@/hooks/useAuth";
import { apiUrl } from "@/lib/api";

// ── Local Atlas profile (mirrors workspace.tsx UserProfile for localStorage) ──
interface AtlasProfile {
  name: string;
  stack: string;
  projects: string;
  notes: string;
  photoUrl?: string;
}

type AccountConnection = {
  id: string | number;
  type?: string | null;
  label?: string | null;
  url?: string | null;
  username?: string | null;
};

type GitHubTokenResponse = {
  connected?: boolean;
  username?: string;
  error?: string;
};

function loadAtlasProfile(): AtlasProfile {
  try {
    const raw = localStorage.getItem("atlas-user-profile");
    if (raw) return JSON.parse(raw) as AtlasProfile;
  } catch {}
  return { name: "", stack: "React, React Router, Tailwind CSS, Supabase", projects: "Compani, IntoIQ, CoinsBloom, PresentQ, SanctumIQ, Atlas", notes: "", photoUrl: "" };
}

function saveAtlasProfile(p: AtlasProfile) {
  try { localStorage.setItem("atlas-user-profile", JSON.stringify(p)); } catch {}
}

// ── Initials avatar ─────────────────────────────────────────────────────────
function InitialsAvatar({ name, email, size = 80 }: { name: string | null; email: string; size?: number }) {
  const text = (name || email || "?")[0].toUpperCase();
  const hash = email.split("").reduce((a, c) => a + c.charCodeAt(0), 0);
  const h1 = hash % 360;
  const h2 = (hash * 53) % 360;
  return (
    <div style={{
      width: size, height: size, borderRadius: "50%", flexShrink: 0,
      background: `linear-gradient(135deg, hsl(${h1},40%,22%), hsl(${h2},55%,16%))`,
      display: "flex", alignItems: "center", justifyContent: "center",
    }}>
      <span style={{ fontSize: size * 0.38, fontWeight: 700, color: "rgba(255,255,255,0.88)", fontFamily: "var(--app-font-mono)", letterSpacing: "-0.02em" }}>
        {text}
      </span>
    </div>
  );
}

// ── Section label ────────────────────────────────────────────────────────────
function SectionLabel({ children }: { children: React.ReactNode }) {
  return (
    <div style={{
      fontSize: 9, fontFamily: "var(--app-font-mono)", letterSpacing: "0.15em",
      textTransform: "uppercase", color: "var(--atlas-muted)", opacity: 0.4,
      paddingBottom: 9, borderBottom: "1px solid rgba(201,162,76,0.08)", marginBottom: 12,
    }}>
      {children}
    </div>
  );
}

// ── Glass input ──────────────────────────────────────────────────────────────
function GlassInput({
  label, value, onChange, placeholder, readOnly, icon, type = "text",
}: {
  label: string; value: string; onChange?: (v: string) => void;
  placeholder?: string; readOnly?: boolean; icon?: React.ReactNode; type?: string;
}) {
  const [focused, setFocused] = useState(false);
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 5 }}>
      <label style={{ fontSize: 9, fontFamily: "var(--app-font-mono)", letterSpacing: "0.1em", color: "var(--atlas-muted)", opacity: 0.5, textTransform: "uppercase" }}>
        {label}
      </label>
      <div style={{
        position: "relative",
        background: readOnly ? "rgba(255,255,255,0.015)" : "var(--atlas-glass-bg)",
        border: `1px solid ${focused ? "rgba(201,162,76,0.38)" : "rgba(255,255,255,0.07)"}`,
        borderRadius: 8, backdropFilter: "blur(8px)", transition: "border-color 160ms ease",
      }}>
        <input
          type={type}
          value={value}
          onChange={onChange ? (e) => onChange(e.target.value) : undefined}
          placeholder={placeholder}
          readOnly={readOnly}
          onFocus={() => setFocused(true)}
          onBlur={() => setFocused(false)}
          style={{
            width: "100%",
            padding: icon ? "9px 36px 9px 12px" : "9px 12px",
            background: "transparent", border: "none", outline: "none",
            color: readOnly ? "var(--atlas-muted)" : "var(--atlas-fg)",
            fontSize: 12.5, fontFamily: "var(--app-font-mono)",
            boxSizing: "border-box", cursor: readOnly ? "default" : "text",
          }}
        />
        {icon && (
          <div style={{ position: "absolute", right: 10, top: "50%", transform: "translateY(-50%)", color: "var(--atlas-muted)", opacity: 0.35, pointerEvents: "none" }}>
            {icon}
          </div>
        )}
      </div>
    </div>
  );
}

// ── Glass textarea ───────────────────────────────────────────────────────────
function GlassTextarea({ label, value, onChange, placeholder }: {
  label: string; value: string; onChange: (v: string) => void; placeholder?: string;
}) {
  const [focused, setFocused] = useState(false);
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 5 }}>
      <label style={{ fontSize: 9, fontFamily: "var(--app-font-mono)", letterSpacing: "0.1em", color: "var(--atlas-muted)", opacity: 0.5, textTransform: "uppercase" }}>
        {label}
      </label>
      <div style={{
        background: "var(--atlas-glass-bg)",
        border: `1px solid ${focused ? "rgba(201,162,76,0.38)" : "rgba(255,255,255,0.07)"}`,
        borderRadius: 8, backdropFilter: "blur(8px)", transition: "border-color 160ms ease",
      }}>
        <textarea
          value={value}
          onChange={(e) => onChange(e.target.value)}
          placeholder={placeholder}
          rows={3}
          onFocus={() => setFocused(true)}
          onBlur={() => setFocused(false)}
          style={{
            width: "100%", padding: "9px 12px", background: "transparent",
            border: "none", outline: "none", color: "var(--atlas-fg)",
            fontSize: 12, fontFamily: "var(--app-font-mono)",
            resize: "none", boxSizing: "border-box", lineHeight: 1.6,
          }}
        />
      </div>
    </div>
  );
}

// ── Icon set ─────────────────────────────────────────────────────────────────
function LockIcon({ size = 12 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round">
      <rect x="3" y="7.5" width="10" height="7.5" rx="1.5" />
      <path d="M5 7.5V5a3 3 0 016 0v2.5" />
    </svg>
  );
}

function GoogleIcon({ size = 12 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 18 18" fill="none">
      <path d="M17.64 9.2c0-.637-.057-1.251-.164-1.84H9v3.481h4.844a4.14 4.14 0 01-1.796 2.716v2.259h2.908c1.702-1.567 2.684-3.875 2.684-6.615z" fill="#4285F4" />
      <path d="M9 18c2.43 0 4.467-.806 5.956-2.18l-2.908-2.259c-.806.54-1.837.86-3.048.86-2.344 0-4.328-1.584-5.036-3.711H.957v2.332A8.997 8.997 0 009 18z" fill="#34A853" />
      <path d="M3.964 10.71A5.41 5.41 0 013.682 9c0-.593.102-1.17.282-1.71V4.958H.957A8.996 8.996 0 000 9c0 1.452.348 2.827.957 4.042l3.007-2.332z" fill="#FBBC05" />
      <path d="M9 3.58c1.321 0 2.508.454 3.44 1.345l2.582-2.58C13.463.891 11.426 0 9 0A8.997 8.997 0 00.957 4.958L3.964 7.29C4.672 5.163 6.656 3.58 9 3.58z" fill="#EA4335" />
    </svg>
  );
}

function UploadIcon({ size = 12 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
      <path d="M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4" />
      <polyline points="17 8 12 3 7 8" />
      <line x1="12" y1="3" x2="12" y2="15" />
    </svg>
  );
}

function SignOutIcon({ size = 13 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
      <path d="M9 21H5a2 2 0 01-2-2V5a2 2 0 012-2h4" />
      <polyline points="16 17 21 12 16 7" />
      <line x1="21" y1="12" x2="9" y2="12" />
    </svg>
  );
}

function TrashIcon({ size = 13 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
      <polyline points="3 6 5 6 21 6" />
      <path d="M19 6v14a2 2 0 01-2 2H7a2 2 0 01-2-2V6m3 0V4a1 1 0 011-1h4a1 1 0 011 1v2" />
    </svg>
  );
}

function EyeIcon({ show, size = 13 }: { show: boolean; size?: number }) {
  return show ? (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
      <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z" />
      <circle cx="12" cy="12" r="3" />
    </svg>
  ) : (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
      <path d="M17.94 17.94A10.07 10.07 0 0112 20c-7 0-11-8-11-8a18.45 18.45 0 015.06-5.94M9.9 4.24A9.12 9.12 0 0112 4c7 0 11 8 11 8a18.5 18.5 0 01-2.16 3.19m-6.72-1.07a3 3 0 11-4.24-4.24" />
      <line x1="1" y1="1" x2="23" y2="23" />
    </svg>
  );
}

// ── Password input with show/hide toggle ─────────────────────────────────────
function PasswordInput({ label, value, onChange }: { label: string; value: string; onChange: (v: string) => void }) {
  const [show, setShow] = useState(false);
  const [focused, setFocused] = useState(false);
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
      <label style={{ fontSize: 9, fontFamily: "var(--app-font-mono)", letterSpacing: "0.1em", color: "var(--atlas-muted)", opacity: 0.45, textTransform: "uppercase" }}>
        {label}
      </label>
      <div style={{
        position: "relative",
        background: "var(--atlas-glass-bg)",
        border: `1px solid ${focused ? "rgba(201,162,76,0.38)" : "rgba(255,255,255,0.07)"}`,
        borderRadius: 7, transition: "border-color 160ms ease",
      }}>
        <input
          type={show ? "text" : "password"}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          onFocus={() => setFocused(true)}
          onBlur={() => setFocused(false)}
          autoComplete="off"
          style={{
            width: "100%", padding: "8px 36px 8px 11px", background: "transparent",
            border: "none", outline: "none", color: "var(--atlas-fg)",
            fontSize: 12, fontFamily: "var(--app-font-mono)", boxSizing: "border-box",
          }}
        />
        <button
          type="button"
          onClick={() => setShow(s => !s)}
          style={{
            position: "absolute", right: 8, top: "50%", transform: "translateY(-50%)",
            background: "transparent", border: "none", cursor: "pointer",
            color: "var(--atlas-muted)", opacity: 0.4, display: "flex", alignItems: "center",
            padding: "2px",
          }}
          onMouseEnter={(e) => (e.currentTarget.style.opacity = "0.8")}
          onMouseLeave={(e) => (e.currentTarget.style.opacity = "0.4")}
        >
          <EyeIcon show={show} size={13} />
        </button>
      </div>
    </div>
  );
}

// ── Main component ───────────────────────────────────────────────────────────
export function AccountHubPanel({ onClose, isMobile = false }: { onClose: () => void; isMobile?: boolean }) {
  const { user: authUser } = useAuth();
  const queryClient = useQueryClient();
  const logout = useLogout();
  const fileInputRef = useRef<HTMLInputElement>(null);

  // ── Name & avatar (DB) ────────────────────────────────────────────────────
  const [name, setName] = useState(authUser?.name ?? "");
  const [pendingAvatar, setPendingAvatar] = useState<string | null>(null);

  // Sync name when authUser loads (async)
  useEffect(() => {
    if (authUser?.name && !name) setName(authUser.name);
  }, [authUser?.name]); // eslint-disable-line react-hooks/exhaustive-deps

  // ── Atlas context (localStorage) ──────────────────────────────────────────
  const [atlasProfile, setAtlasProfile] = useState<AtlasProfile>(loadAtlasProfile);
  const [githubConnections, setGithubConnections] = useState<AccountConnection[]>([]);
  const [githubConnectionsLoading, setGithubConnectionsLoading] = useState(true);
  const [githubConnectionsError, setGithubConnectionsError] = useState<string | null>(null);
  const [removingGithubConnectionId, setRemovingGithubConnectionId] = useState<string | number | null>(null);
  const [githubToken, setGithubToken] = useState("");
  const [savingGithubToken, setSavingGithubToken] = useState(false);
  const [githubTokenError, setGithubTokenError] = useState<string | null>(null);
  const [savedGithubUsername, setSavedGithubUsername] = useState<string | null>(null);

  // ── Save ──────────────────────────────────────────────────────────────────
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);

  // ── Change password ───────────────────────────────────────────────────────
  const [showChangePw, setShowChangePw] = useState(false);
  const [currentPw, setCurrentPw] = useState("");
  const [newPw, setNewPw] = useState("");
  const [confirmPw, setConfirmPw] = useState("");
  const [pwError, setPwError] = useState<string | null>(null);
  const [pwSuccess, setPwSuccess] = useState(false);
  const [changingPw, setChangingPw] = useState(false);

  // ── Delete account ────────────────────────────────────────────────────────
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
  const [deleteInput, setDeleteInput] = useState("");
  const [deleting, setDeleting] = useState(false);

  const avatarSrc = pendingAvatar ?? authUser?.avatarUrl ?? null;
  const displayName = authUser?.name || authUser?.email?.split("@")[0] || "Account";
  const visibleGithubConnections = githubConnections.length > 0
    ? githubConnections
    : savedGithubUsername
      ? [{ id: "github", type: "github", username: savedGithubUsername }]
      : [];

  const handleGoogleReconnect = useCallback(() => {
    // Backend OAuth start — same endpoint used on /login.
    window.location.href = apiUrl("/api/auth/google");
  }, []);

  const loadGithubConnections = useCallback(async () => {
    setGithubConnectionsLoading(true);
    setGithubConnectionsError(null);
    try {
      const res = await fetch("/api/connections", { credentials: "include" });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      const connections = (Array.isArray(data) ? data : data?.connections ?? []) as AccountConnection[];
      setGithubConnections(connections.filter((connection) => connection?.type === "github"));
    } catch {
      setGithubConnections([]);
      setGithubConnectionsError("Could not load linked GitHub repos.");
    } finally {
      setGithubConnectionsLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadGithubConnections();
  }, [loadGithubConnections]);

  const handleSaveGithubToken = async () => {
    const token = githubToken.trim();
    if (!token) return;
    setSavingGithubToken(true);
    setGithubTokenError(null);
    try {
      const res = await fetch("/api/github/token", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ token }),
      });
      const data = await res.json().catch(() => ({})) as GitHubTokenResponse;
      if (!res.ok || !data.connected) {
        setGithubTokenError(res.status === 422 ? data.error ?? "Failed to save token" : "Failed to save token");
        return;
      }
      setGithubToken("");
      setSavedGithubUsername(data.username ?? null);
      await loadGithubConnections();
      toast.success("GitHub token saved.");
    } catch {
      setGithubTokenError("Failed to save token");
    } finally {
      setSavingGithubToken(false);
    }
  };

  const handleStartGithubOAuth = async () => {
    setGithubTokenError(null);
    try {
      const { stashOauthReturn } = await import("@/lib/oauthReturn");
      stashOauthReturn();
      const res = await fetch("/api/github/oauth/start", {
        method: "GET",
        headers: { Accept: "application/json" },
        credentials: "include",
      });
      if (res.status === 401) {
        window.location.href = "/login?reason=session_expired";
        return;
      }
      const data = await res.json().catch(() => ({})) as { url?: string };
      if (data.url) {
        window.location.href = data.url;
        return;
      }
      setGithubTokenError("Failed to start GitHub connection");
    } catch {
      setGithubTokenError("Network error. Try again.");
    }
  };

  const handleRemoveGithubConnection = async (id: AccountConnection["id"]) => {
    setRemovingGithubConnectionId(id);
    try {
      const res = await fetch("/api/github/token", { method: "DELETE", credentials: "include" });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      setSavedGithubUsername(null);
      await loadGithubConnections();
      toast.success("GitHub token removed.");
    } catch {
      toast.error("Failed to remove GitHub token.");
    } finally {
      setRemovingGithubConnectionId(null);
    }
  };

  // ── Handlers ──────────────────────────────────────────────────────────────
  const handleSave = async () => {
    setSaving(true);
    try {
      const body: Record<string, string | null> = { name: name.trim() || null };
      if (pendingAvatar) body.avatarUrl = pendingAvatar;

      await fetch(apiUrl("/api/auth/profile"), {
        method: "PATCH",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });

      // Keep localStorage in sync for AI context (name + photoUrl)
      const merged: AtlasProfile = { ...atlasProfile, name: name.trim() };
      if (pendingAvatar) merged.photoUrl = pendingAvatar;
      saveAtlasProfile(merged);

      // Refresh the auth query → header avatar updates instantly
      await queryClient.invalidateQueries({ queryKey: ["auth", "me"] });

      setSaved(true);
      setTimeout(() => { setSaved(false); onClose(); }, 800);
    } catch {
      onClose();
    } finally {
      setSaving(false);
    }
  };

  const handleChangePassword = async () => {
    setPwError(null);
    if (!currentPw) { setPwError("Enter your current password"); return; }
    if (newPw.length < 8) { setPwError("New password must be at least 8 characters"); return; }
    if (newPw !== confirmPw) { setPwError("Passwords don't match"); return; }
    setChangingPw(true);
    try {
      const res = await fetch(apiUrl("/api/auth/change-password"), {
        method: "PATCH",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ currentPassword: currentPw, newPassword: newPw }),
      });
      if (!res.ok) {
        const data = await res.json() as { error?: string };
        setPwError(data.error ?? "Failed to change password");
        return;
      }
      setPwSuccess(true);
      setTimeout(() => {
        setShowChangePw(false);
        setPwSuccess(false);
        setCurrentPw(""); setNewPw(""); setConfirmPw("");
      }, 2000);
    } finally {
      setChangingPw(false);
    }
  };

  const handleDeleteAccount = async () => {
    if (deleteInput.trim().toUpperCase() !== "DELETE") return;
    setDeleting(true);
    try {
      await fetch(apiUrl("/api/auth/account"), { method: "DELETE", credentials: "include" });
      queryClient.setQueryData(["auth", "me"], null);
      window.location.href = "/login";
    } finally {
      setDeleting(false);
    }
  };

  const handleFileUpload = useCallback((file: File) => {
    const reader = new FileReader();
    reader.onload = (ev) => {
      const dataUrl = ev.target?.result as string;
      if (!dataUrl) return;
      const img = new Image();
      img.onload = () => {
        const MAX = 280;
        const ratio = Math.min(MAX / img.width, MAX / img.height);
        const w = Math.round(img.width * ratio);
        const h = Math.round(img.height * ratio);
        const canvas = document.createElement("canvas");
        canvas.width = w; canvas.height = h;
        const ctx = canvas.getContext("2d");
        if (ctx) { ctx.drawImage(img, 0, 0, w, h); setPendingAvatar(canvas.toDataURL("image/jpeg", 0.82)); }
        else { setPendingAvatar(dataUrl); }
      };
      img.src = dataUrl;
    };
    reader.readAsDataURL(file);
  }, []);

  // ── Render ─────────────────────────────────────────────────────────────────
  return (
    <div style={{ position: "fixed", inset: 0, zIndex: 300, display: "flex", alignItems: "stretch", justifyContent: "flex-end" }}>
      <style>{`
        @keyframes accountHubIn {
          from { transform: translateX(20px); opacity: 0; }
          to   { transform: translateX(0);    opacity: 1; }
        }
        @keyframes avatarAuraGlow {
          0%, 100% { box-shadow: 0 0 0 3px rgba(88,28,135,0.22), 0 0 32px 8px rgba(88,28,135,0.14), 0 0 70px 18px rgba(88,28,135,0.06); }
          35%       { box-shadow: 0 0 0 3px rgba(146,64,14,0.28), 0 0 36px 10px rgba(146,64,14,0.16), 0 0 80px 22px rgba(146,64,14,0.07); }
          68%       { box-shadow: 0 0 0 3px rgba(30,58,138,0.22), 0 0 32px 8px rgba(30,58,138,0.12), 0 0 70px 18px rgba(30,58,138,0.05); }
        }
      `}</style>

      {/* Backdrop */}
      <div
        onClick={onClose}
        style={{ position: "absolute", inset: 0, background: "rgba(0,0,0,0.62)", backdropFilter: "blur(7px)" }}
      />

      {/* Panel */}
      <div style={{
        position: "relative", zIndex: 1,
        width: isMobile ? "100%" : 340,
        height: "100%",
        background: "rgba(18,16,14,0.88)",
        backdropFilter: "blur(28px)",
        borderLeft: "1px solid rgba(201,162,76,0.16)",
        boxShadow: "-12px 0 48px rgba(0,0,0,0.55), inset 1px 0 0 rgba(201,162,76,0.06)",
        display: "flex", flexDirection: "column",
        animation: "accountHubIn 240ms cubic-bezier(0.2,0.8,0.2,1)",
      }}>

        {/* Header */}
        <div style={{
          padding: "16px 18px 14px", flexShrink: 0,
          borderBottom: "1px solid rgba(201,162,76,0.08)",
          display: "flex", alignItems: "center", justifyContent: "space-between",
        }}>
          <span style={{ fontSize: 10, fontFamily: "var(--app-font-mono)", letterSpacing: "0.16em", color: "var(--atlas-gold)", opacity: 0.8, textTransform: "uppercase" }}>
            Account
          </span>
          <button
            onClick={onClose}
            style={{ background: "transparent", border: "none", cursor: "pointer", color: "var(--atlas-muted)", fontSize: 18, lineHeight: 1, padding: "0 2px", opacity: 0.4 }}
            onMouseEnter={(e) => (e.currentTarget.style.opacity = "0.85")}
            onMouseLeave={(e) => (e.currentTarget.style.opacity = "0.4")}
          >×</button>
        </div>

        {/* Scrollable body */}
        <div style={{ flex: 1, overflowY: "auto", padding: "0 0 8px" }} className="scrollbar-none">

          {/* ── Avatar module ─────────────────────────────────────────────── */}
          <div style={{ padding: "28px 18px 20px", display: "flex", flexDirection: "column", alignItems: "center", gap: 14 }}>
            {/* Avatar with animated aura glow */}
            <div style={{ position: "relative" }}>
              <div style={{
                width: 80, height: 80, borderRadius: "50%", overflow: "hidden",
                border: "2px solid rgba(201,162,76,0.3)",
                animation: "avatarAuraGlow 7s ease-in-out infinite",
              }}>
                {avatarSrc ? (
                  <img src={avatarSrc} alt="" style={{ width: "100%", height: "100%", objectFit: "cover" }} />
                ) : (
                  <InitialsAvatar name={authUser?.name ?? null} email={authUser?.email ?? ""} size={80} />
                )}
              </div>
              {pendingAvatar && (
                <div style={{
                  position: "absolute", bottom: -2, right: -2,
                  width: 18, height: 18, borderRadius: "50%",
                  background: "rgba(74,222,128,0.12)", border: "1.5px solid rgba(74,222,128,0.55)",
                  display: "flex", alignItems: "center", justifyContent: "center",
                  fontSize: 9, color: "#4ade80",
                }}>✓</div>
              )}
            </div>

            {/* Name + auth method badge */}
            <div style={{ textAlign: "center" }}>
              <div style={{ fontSize: 15, fontWeight: 600, color: "var(--atlas-fg)", marginBottom: 6, lineHeight: 1.2 }}>
                {displayName}
              </div>
              {authUser?.googleLinked ? (
                <div style={{ display: "inline-flex", alignItems: "center", gap: 5, padding: "3px 10px", borderRadius: 20, background: "rgba(66,133,244,0.09)", border: "1px solid rgba(66,133,244,0.2)" }}>
                  <GoogleIcon size={10} />
                  <span style={{ fontSize: 9, fontFamily: "var(--app-font-mono)", color: "rgba(66,133,244,0.8)", letterSpacing: "0.07em" }}>Google</span>
                </div>
              ) : (
                <div style={{ display: "inline-flex", alignItems: "center", gap: 5, padding: "3px 10px", borderRadius: 20, background: "var(--atlas-glass-bg)", border: "1px solid var(--atlas-glass-bg)" }}>
                  <LockIcon size={9} />
                  <span style={{ fontSize: 9, fontFamily: "var(--app-font-mono)", color: "var(--atlas-muted)", opacity: 0.6, letterSpacing: "0.07em" }}>Email</span>
                </div>
              )}
            </div>

            {/* Photo action buttons */}
            <div style={{ display: "flex", gap: 7, width: "100%" }}>
              <input
                ref={fileInputRef}
                type="file"
                accept="image/jpeg,image/png,image/webp,image/gif"
                style={{ display: "none" }}
                onChange={(e) => { const f = e.target.files?.[0]; if (f) handleFileUpload(f); e.target.value = ""; }}
              />
              <button
                onClick={() => fileInputRef.current?.click()}
                style={{
                  flex: 1, padding: "7px 10px", borderRadius: 7,
                  background: "var(--atlas-glass-bg)", border: "1px solid var(--atlas-glass-bg)",
                  color: "var(--atlas-fg)", fontSize: 10.5, fontFamily: "var(--app-font-mono)",
                  cursor: "pointer", letterSpacing: "0.04em",
                  display: "flex", alignItems: "center", justifyContent: "center", gap: 5,
                  transition: "all 160ms ease",
                }}
                onMouseEnter={(e) => { e.currentTarget.style.background = "rgba(255,255,255,0.07)"; e.currentTarget.style.borderColor = "rgba(201,162,76,0.22)"; }}
                onMouseLeave={(e) => { e.currentTarget.style.background = "var(--atlas-glass-bg)"; e.currentTarget.style.borderColor = "var(--atlas-glass-bg)"; }}
              >
                <UploadIcon size={11} />
                Upload photo
              </button>

              {authUser?.googleLinked && (
                <button
                  type="button"
                  onClick={() => void handleGoogleReconnect()}
                  title="Re-authenticate with Google to sync your latest profile photo"
                  style={{
                    flex: 1, padding: "7px 10px", borderRadius: 7,
                    background: "rgba(66,133,244,0.06)", border: "1px solid rgba(66,133,244,0.18)",
                    color: "rgba(66,133,244,0.85)", fontSize: 10.5, fontFamily: "var(--app-font-mono)",
                     cursor: "pointer", letterSpacing: "0.04em", textDecoration: "none",
                    display: "flex", alignItems: "center", justifyContent: "center", gap: 5,
                    transition: "background 160ms ease",
                     appearance: "none",
                  }}
                  onMouseEnter={(e) => ((e.currentTarget as HTMLElement).style.background = "rgba(66,133,244,0.11)")}
                  onMouseLeave={(e) => ((e.currentTarget as HTMLElement).style.background = "rgba(66,133,244,0.06)")}
                >
                  <GoogleIcon size={11} />
                  Sync Google
                </button>
              )}
            </div>

            {pendingAvatar && (
              <button
                onClick={() => setPendingAvatar(null)}
                style={{ fontSize: 9.5, fontFamily: "var(--app-font-mono)", background: "transparent", border: "none", cursor: "pointer", color: "var(--atlas-muted)", opacity: 0.45, letterSpacing: "0.04em" }}
                onMouseEnter={(e) => (e.currentTarget.style.opacity = "0.8")}
                onMouseLeave={(e) => (e.currentTarget.style.opacity = "0.45")}
              >
                Remove pending photo
              </button>
            )}
          </div>

          {/* ── Identity section ──────────────────────────────────────────── */}
          <div style={{ padding: "0 18px 20px", display: "flex", flexDirection: "column", gap: 11 }}>
            <SectionLabel>Identity</SectionLabel>
            <GlassInput
              label="Display name"
              value={name}
              onChange={setName}
              placeholder="Your name"
            />
            <GlassInput
              label="Email"
              value={authUser?.email ?? ""}
              readOnly
              icon={<LockIcon size={12} />}
            />
          </div>

          {/* ── Security section ──────────────────────────────────────────── */}
          <div style={{ padding: "0 18px 20px", display: "flex", flexDirection: "column", gap: 11 }}>
            <SectionLabel>Security</SectionLabel>

            {authUser?.hasPassword ? (
              <>
                {!showChangePw ? (
                  <button
                    onClick={() => setShowChangePw(true)}
                    style={{
                      width: "100%", padding: "9px 12px", borderRadius: 7, textAlign: "left",
                      background: "rgba(255,255,255,0.03)", border: "1px solid rgba(255,255,255,0.07)",
                      color: "var(--atlas-fg)", fontSize: 11.5, fontFamily: "var(--app-font-mono)",
                      cursor: "pointer", display: "flex", alignItems: "center", gap: 8,
                      transition: "all 160ms ease",
                    }}
                    onMouseEnter={(e) => { e.currentTarget.style.background = "var(--atlas-glass-bg)"; e.currentTarget.style.borderColor = "rgba(201,162,76,0.22)"; }}
                    onMouseLeave={(e) => { e.currentTarget.style.background = "rgba(255,255,255,0.03)"; e.currentTarget.style.borderColor = "rgba(255,255,255,0.07)"; }}
                  >
                    <LockIcon size={11} />
                    Change password
                  </button>
                ) : (
                  <div style={{ display: "flex", flexDirection: "column", gap: 9, padding: "13px", borderRadius: 9, background: "rgba(255,255,255,0.025)", border: "1px solid rgba(255,255,255,0.07)" }}>
                    {pwSuccess ? (
                      <div style={{ fontSize: 11, fontFamily: "var(--app-font-mono)", color: "#4ade80", textAlign: "center", padding: "6px 0" }}>
                        ✓ Password updated
                      </div>
                    ) : (
                      <>
                        <PasswordInput label="Current password" value={currentPw} onChange={setCurrentPw} />
                        <PasswordInput label="New password" value={newPw} onChange={setNewPw} />
                        <PasswordInput label="Confirm new" value={confirmPw} onChange={setConfirmPw} />
                        {pwError && (
                          <div style={{ fontSize: 10, fontFamily: "var(--app-font-mono)", color: "rgba(252,165,165,0.85)", lineHeight: 1.4 }}>
                            {pwError}
                          </div>
                        )}
                        <div style={{ display: "flex", gap: 6, marginTop: 2 }}>
                          <button
                            onClick={handleChangePassword}
                            disabled={changingPw}
                            style={{
                              flex: 1, padding: "8px", borderRadius: 6, border: "none",
                              background: "var(--atlas-ember)", color: "var(--atlas-fg)",
                              fontSize: 10, fontFamily: "var(--app-font-mono)", letterSpacing: "0.06em",
                              cursor: changingPw ? "wait" : "pointer", opacity: changingPw ? 0.6 : 1,
                            }}
                          >
                            {changingPw ? "Saving…" : "Update"}
                          </button>
                          <button
                            onClick={() => { setShowChangePw(false); setPwError(null); setCurrentPw(""); setNewPw(""); setConfirmPw(""); }}
                            style={{
                              padding: "8px 14px", borderRadius: 6,
                              border: "1px solid var(--atlas-glass-bg)",
                              background: "transparent", color: "var(--atlas-muted)",
                              fontSize: 10, fontFamily: "var(--app-font-mono)", cursor: "pointer",
                            }}
                          >
                            Cancel
                          </button>
                        </div>
                      </>
                    )}
                  </div>
                )}
              </>
            ) : (
              <div style={{
                padding: "9px 12px", borderRadius: 7,
                background: "rgba(66,133,244,0.05)", border: "1px solid rgba(66,133,244,0.14)",
                display: "flex", alignItems: "center", gap: 8,
              }}>
                <GoogleIcon size={12} />
                <span style={{ fontSize: 11, fontFamily: "var(--app-font-mono)", color: "rgba(66,133,244,0.7)", flex: 1 }}>
                  Managed by Google OAuth
                </span>
              </div>
            )}
          </div>

          {/* ── Atlas context (AI chat) ───────────────────────────────────── */}
          <div style={{ padding: "0 18px 20px", display: "flex", flexDirection: "column", gap: 11 }}>
            <SectionLabel>Atlas Context</SectionLabel>
            <div style={{ fontSize: 10, fontFamily: "var(--app-font-mono)", color: "var(--atlas-muted)", opacity: 0.4, lineHeight: 1.6 }}>
              Injected into every conversation so Atlas knows who you are.
            </div>
            <GlassInput
              label="Stack"
              value={atlasProfile.stack}
              onChange={(v) => setAtlasProfile(p => ({ ...p, stack: v }))}
              placeholder="React, Tailwind, Supabase…"
            />
            <GlassInput
              label="Projects"
              value={atlasProfile.projects}
              onChange={(v) => setAtlasProfile(p => ({ ...p, projects: v }))}
              placeholder="IntoIQ, CoinsBloom…"
            />
            <GlassTextarea
              label="Notes for Atlas"
              value={atlasProfile.notes}
              onChange={(v) => setAtlasProfile(p => ({ ...p, notes: v }))}
              placeholder="Anything you want it to always know…"
            />
          </div>

          <div style={{
            margin: "16px",
            padding: "16px",
            background: "var(--atlas-surface)",
            border: "1px solid var(--atlas-border)",
            borderRadius: "12px",
          }}>
            <div style={{
              fontSize: "11px",
              letterSpacing: "0.1em",
              color: "var(--atlas-gold)",
              marginBottom: "12px",
              fontFamily: "var(--app-font-mono)",
            }}>
              GITHUB
            </div>
            <div style={{
              fontSize: "13px",
              color: "var(--atlas-muted)",
              marginBottom: "12px",
              lineHeight: 1.5,
            }}>
              Connect your GitHub account so Atlas can read and write code across projects.
            </div>
            <div style={{ display: "flex", flexDirection: "column", gap: 8, marginBottom: 12 }}>
              <button
                type="button"
                onClick={() => void handleStartGithubOAuth()}
                style={{
                  alignSelf: "flex-start",
                  padding: "8px 12px",
                  borderRadius: 6,
                  background: "var(--atlas-gold)",
                  border: "none",
                  color: "#0D0B09",
                  fontSize: 10,
                  fontFamily: "var(--app-font-mono)",
                  letterSpacing: "0.08em",
                  textTransform: "uppercase",
                  cursor: "pointer",
                }}
              >
                Connect with GitHub
              </button>
              <div style={{ fontSize: 10, color: "var(--atlas-muted)", opacity: 0.55, fontFamily: "var(--app-font-mono)" }}>
                or paste a personal access token
              </div>
              <input
                type="password"
                value={githubToken}
                onChange={(e) => setGithubToken(e.target.value)}
                onKeyDown={(e) => { if (e.key === "Enter") void handleSaveGithubToken(); }}
                placeholder="ghp_..."
                autoComplete="off"
                style={{
                  width: "100%",
                  padding: "8px 10px",
                  borderRadius: 6,
                  background: "var(--atlas-glass-bg)",
                  border: "1px solid var(--atlas-border)",
                  color: "var(--atlas-fg)",
                  fontSize: 11,
                  fontFamily: "var(--app-font-mono)",
                  outline: "none",
                  boxSizing: "border-box",
                }}
              />
              <button
                type="button"
                onClick={() => void handleSaveGithubToken()}
                disabled={!githubToken.trim() || savingGithubToken}
                style={{
                  alignSelf: "flex-start",
                  padding: "8px 12px",
                  borderRadius: 6,
                  background: githubToken.trim() ? "var(--atlas-gold)" : "var(--atlas-surface)",
                  border: "none",
                  color: githubToken.trim() ? "#0D0B09" : "var(--atlas-muted)",
                  fontSize: 10,
                  fontFamily: "var(--app-font-mono)",
                  letterSpacing: "0.08em",
                  textTransform: "uppercase",
                  cursor: githubToken.trim() && !savingGithubToken ? "pointer" : "not-allowed",
                }}
              >
                {savingGithubToken ? "Saving..." : "Save GitHub Token"}
              </button>
              {githubTokenError && (
                <div style={{ fontSize: 10, color: "rgba(252,165,165,0.85)", fontFamily: "var(--app-font-mono)" }}>
                  {githubTokenError}
                </div>
              )}
            </div>
            {githubConnectionsLoading ? (
              <div style={{ fontSize: 11, color: "var(--atlas-muted)", fontFamily: "var(--app-font-mono)", opacity: 0.7 }}>
                Checking GitHub connection...
              </div>
            ) : visibleGithubConnections.length > 0 ? (
              <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                {visibleGithubConnections.map((connection) => (
                  <div key={connection.id} style={{
                    display: "flex",
                    alignItems: "center",
                    gap: 10,
                    padding: "10px 12px",
                    background: "rgba(74,222,128,0.08)",
                    border: "1px solid rgba(74,222,128,0.22)",
                    borderRadius: "8px",
                  }}>
                    <span style={{
                      width: 7,
                      height: 7,
                      borderRadius: "50%",
                      background: "#4ade80",
                      flexShrink: 0,
                    }} />
                    <div style={{ minWidth: 0, flex: 1 }}>
                      <div style={{ fontSize: 10, color: "#4ade80", fontFamily: "var(--app-font-mono)", letterSpacing: "0.08em", textTransform: "uppercase", marginBottom: 3 }}>
                        Linked
                      </div>
                      <div style={{ fontSize: 12, color: "var(--atlas-fg)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                        {connection.username || savedGithubUsername || connection.label || connection.url || "GitHub"}
                      </div>
                    </div>
                    <button
                      type="button"
                      onClick={() => void handleRemoveGithubConnection(connection.id)}
                      disabled={String(removingGithubConnectionId) === String(connection.id)}
                      style={{
                        padding: "6px 9px",
                        background: "rgba(239,68,68,0.08)",
                        border: "1px solid rgba(239,68,68,0.24)",
                        borderRadius: "6px",
                        color: "rgba(252,165,165,0.9)",
                        fontSize: 10,
                        fontFamily: "var(--app-font-mono)",
                        cursor: String(removingGithubConnectionId) === String(connection.id) ? "wait" : "pointer",
                      }}
                    >
                      Remove
                    </button>
                  </div>
                ))}
              </div>
            ) : (
              <div style={{ fontSize: 12, color: "var(--atlas-muted)", lineHeight: 1.6 }}>
                No GitHub token saved yet.
              </div>
            )}
            {githubConnectionsError && (
              <div style={{ fontSize: 10, color: "rgba(252,165,165,0.85)", fontFamily: "var(--app-font-mono)", marginTop: 8 }}>
                {githubConnectionsError}
              </div>
            )}
          </div>

          {/* ── Actions section ───────────────────────────────────────────── */}
          <div style={{ padding: "0 18px 28px", display: "flex", flexDirection: "column", gap: 8 }}>
            <SectionLabel>Actions</SectionLabel>

            {/* Sign out */}
            <button
              onClick={() => { onClose(); void logout(); }}
              style={{
                width: "100%", padding: "10px 12px", borderRadius: 7, textAlign: "left",
                background: "rgba(255,255,255,0.03)", border: "1px solid rgba(255,255,255,0.07)",
                color: "var(--atlas-fg)", fontSize: 11.5, fontFamily: "var(--app-font-mono)",
                cursor: "pointer", display: "flex", alignItems: "center", gap: 8,
                transition: "all 160ms ease",
              }}
              onMouseEnter={(e) => { e.currentTarget.style.background = "var(--atlas-glass-bg)"; e.currentTarget.style.borderColor = "var(--atlas-border)"; }}
              onMouseLeave={(e) => { e.currentTarget.style.background = "rgba(255,255,255,0.03)"; e.currentTarget.style.borderColor = "rgba(255,255,255,0.07)"; }}
            >
              <SignOutIcon />
              Sign out
            </button>

            {/* Delete account */}
            {!showDeleteConfirm ? (
              <button
                onClick={() => setShowDeleteConfirm(true)}
                style={{
                  width: "100%", padding: "10px 12px", borderRadius: 7, textAlign: "left",
                  background: "rgba(239,68,68,0.04)", border: "1px solid rgba(239,68,68,0.11)",
                  color: "rgba(252,165,165,0.6)", fontSize: 11.5, fontFamily: "var(--app-font-mono)",
                  cursor: "pointer", display: "flex", alignItems: "center", gap: 8,
                  transition: "all 160ms ease",
                }}
                onMouseEnter={(e) => { e.currentTarget.style.background = "rgba(239,68,68,0.08)"; e.currentTarget.style.borderColor = "rgba(239,68,68,0.24)"; e.currentTarget.style.color = "rgba(252,165,165,0.9)"; }}
                onMouseLeave={(e) => { e.currentTarget.style.background = "rgba(239,68,68,0.04)"; e.currentTarget.style.borderColor = "rgba(239,68,68,0.11)"; e.currentTarget.style.color = "rgba(252,165,165,0.6)"; }}
              >
                <TrashIcon />
                Delete account
              </button>
            ) : (
              <div style={{
                padding: "13px", borderRadius: 9,
                background: "rgba(239,68,68,0.05)", border: "1px solid rgba(239,68,68,0.2)",
                display: "flex", flexDirection: "column", gap: 10,
              }}>
                <div style={{ fontSize: 11, fontFamily: "var(--app-font-mono)", color: "rgba(252,165,165,0.85)", lineHeight: 1.5 }}>
                  This permanently deletes your account and all data. Type DELETE to confirm.
                </div>
                <input
                  type="text"
                  value={deleteInput}
                  onChange={(e) => setDeleteInput(e.target.value)}
                  placeholder="Type DELETE"
                  style={{
                    padding: "7px 10px", borderRadius: 6,
                    background: "rgba(239,68,68,0.06)", border: "1px solid rgba(239,68,68,0.22)",
                    color: "rgba(252,165,165,0.9)", fontSize: 11, fontFamily: "var(--app-font-mono)",
                    outline: "none", boxSizing: "border-box", width: "100%",
                  }}
                />
                <div style={{ display: "flex", gap: 6 }}>
                  <button
                    onClick={handleDeleteAccount}
                    disabled={deleteInput.trim().toUpperCase() !== "DELETE" || deleting}
                    style={{
                      flex: 1, padding: "8px", borderRadius: 6, border: "none",
                      background: deleteInput.trim().toUpperCase() === "DELETE" ? "rgba(239,68,68,0.7)" : "rgba(239,68,68,0.12)",
                      color: deleteInput.trim().toUpperCase() === "DELETE" ? "white" : "rgba(252,165,165,0.35)",
                      fontSize: 10, fontFamily: "var(--app-font-mono)", letterSpacing: "0.08em",
                      cursor: deleteInput.trim().toUpperCase() === "DELETE" && !deleting ? "pointer" : "not-allowed",
                      transition: "all 160ms ease",
                    }}
                  >
                    {deleting ? "Deleting…" : "Delete forever"}
                  </button>
                  <button
                    onClick={() => { setShowDeleteConfirm(false); setDeleteInput(""); }}
                    style={{
                      padding: "8px 14px", borderRadius: 6,
                      border: "1px solid var(--atlas-glass-bg)",
                      background: "transparent", color: "var(--atlas-muted)",
                      fontSize: 10, fontFamily: "var(--app-font-mono)", cursor: "pointer",
                    }}
                  >
                    Cancel
                  </button>
                </div>
              </div>
            )}
          </div>
        </div>

        {/* ── Save footer ───────────────────────────────────────────────── */}
        <div style={{
          padding: "12px 18px",
          paddingBottom: "max(12px, env(safe-area-inset-bottom))",
          borderTop: "1px solid rgba(201,162,76,0.08)", flexShrink: 0,
        }}>
          <button
            onClick={handleSave}
            disabled={saving}
            style={{
              width: "100%", padding: "11px", borderRadius: 8, border: "none",
              background: saved ? "rgba(52,211,153,0.12)" : "var(--atlas-ember)",
              color: saved ? "#34d399" : "var(--atlas-fg)",
              fontSize: 10.5, fontFamily: "var(--app-font-mono)", letterSpacing: "0.12em",
              textTransform: "uppercase", cursor: saving ? "wait" : "pointer",
              transition: "background 220ms ease, color 220ms ease",
              boxShadow: saved ? "0 0 20px rgba(52,211,153,0.12)" : "0 2px 12px rgba(146,64,14,0.2)",
            }}
          >
            {saved ? "Saved ✓" : saving ? "Saving…" : "Save Changes"}
          </button>
        </div>
      </div>
    </div>
  );
}
