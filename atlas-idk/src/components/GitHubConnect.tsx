import { useState } from "react";
import { useGitHub } from "@/hooks/useGitHub";

export function GitHubConnect({
  onSuccess,
  onCancel,
}: {
  onSuccess?: () => void;
  onCancel?: () => void;
}) {
  const { connect, disconnect, isConnected, isLoading, status, statusLabel, error } = useGitHub();
  const [token, setToken] = useState("");
  const [saving, setSaving] = useState(false);

  const handleConnect = async () => {
    if (!token.trim()) return;
    setSaving(true);
    const ok = await connect(token.trim());
    setSaving(false);
    if (ok) onSuccess?.();
  };

  if (isConnected) {
    return (
      <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <span style={{
            width: 8, height: 8, borderRadius: "50%",
            background: "#4ade80", flexShrink: 0,
          }} />
          <span style={{
            fontFamily: "var(--app-font-mono)", fontSize: 11,
            color: "var(--atlas-fg)", opacity: 0.8,
          }}>
            GitHub connected
          </span>
        </div>
        <button
          onClick={async () => { await disconnect(); }}
          style={{
            padding: "6px 14px", borderRadius: 6,
            background: "transparent",
            border: "1px solid rgba(239,68,68,0.3)",
            color: "rgba(252,165,165,0.8)",
            fontSize: 10, fontFamily: "var(--app-font-mono)",
            cursor: "pointer", letterSpacing: "0.06em",
            alignSelf: "flex-start",
          }}
        >
          Disconnect
        </button>
      </div>
    );
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
      {!isLoading && (
        <div style={{
          display: "flex", alignItems: "center", gap: 8,
          fontFamily: "var(--app-font-mono)", fontSize: 11,
          color: status === "read-only" ? "var(--atlas-gold)" : "rgba(248,113,113,0.85)",
          opacity: 0.8,
        }}>
          <span style={{
            width: 8, height: 8, borderRadius: "50%",
            background: status === "read-only" ? "var(--atlas-gold)" : "rgba(248,113,113,0.85)",
            flexShrink: 0,
          }} />
          {statusLabel}
        </div>
      )}
      <div style={{
        fontSize: 12, color: "var(--atlas-muted)",
        lineHeight: 1.6, opacity: 0.7,
      }}>
        Connect GitHub so Atlas can read and write
        your code across all projects.
      </div>
      <input
        type="password"
        value={token}
        onChange={(e) => setToken(e.target.value)}
        onKeyDown={(e) => { if (e.key === "Enter") void handleConnect(); }}
        placeholder="ghp_…"
        autoComplete="off"
        style={{
          width: "100%", padding: "8px 10px", borderRadius: 6,
          background: "var(--atlas-surface)",
          border: "1px solid var(--atlas-border)",
          color: "var(--atlas-fg)", fontSize: 11,
          fontFamily: "var(--app-font-mono)", outline: "none",
          boxSizing: "border-box",
        }}
      />
      {error && (
        <div style={{
          fontSize: 10, color: "rgba(252,165,165,0.85)",
          fontFamily: "var(--app-font-mono)",
        }}>
          {error}
        </div>
      )}
      <div style={{ display: "flex", gap: 8 }}>
        <button
          onClick={() => void handleConnect()}
          disabled={!token.trim() || saving}
          style={{
            flex: 1, padding: "8px", borderRadius: 6,
            background: token.trim() ? "var(--atlas-gold)" : "var(--atlas-surface)",
            border: "none",
            color: token.trim() ? "#0D0B09" : "var(--atlas-muted)",
            fontSize: 10, fontFamily: "var(--app-font-mono)",
            letterSpacing: "0.1em", textTransform: "uppercase",
            cursor: token.trim() && !saving ? "pointer" : "not-allowed",
          }}
        >
          {saving ? "Connecting…" : "Connect"}
        </button>
        {onCancel && (
          <button
            onClick={onCancel}
            style={{
              padding: "8px 14px", borderRadius: 6,
              background: "transparent",
              border: "1px solid var(--atlas-border)",
              color: "var(--atlas-muted)",
              fontSize: 10, fontFamily: "var(--app-font-mono)",
              cursor: "pointer",
            }}
          >
            Cancel
          </button>
        )}
      </div>

      <a
        href="https://github.com/settings/tokens/new?description=Atlas&scopes=repo"
        target="_blank"
        rel="noopener noreferrer"
        style={{
          fontSize: 9.5, color: "var(--atlas-gold)",
          opacity: 0.55, fontFamily: "var(--app-font-mono)",
        }}
      >
        Create token on GitHub →
      </a>
    </div>
  );
}
