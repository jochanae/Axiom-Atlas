import { useCallback, useEffect, useState } from "react";
import type React from "react";

type Secret = {
  id: number | string;
  projectId: number;
  label: string;
  maskedValue: string;
};

type SecretsPanelProps = {
  projectId: number;
  projectName: string;
};

export function SecretsPanel({ projectId, projectName }: SecretsPanelProps) {
  const [secrets, setSecrets] = useState<Secret[]>([]);
  const [label, setLabel] = useState("");
  const [value, setValue] = useState("");
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const loadSecrets = useCallback(async () => {
    setLoading(true);
    setError(null);

    try {
      const res = await fetch("/api/secrets", {
        credentials: "include",
      });

      if (!res.ok) throw new Error(`HTTP ${res.status}`);

      const data = await res.json();
      const allSecrets = (Array.isArray(data) ? data : data?.secrets ?? []) as Secret[];
      setSecrets(allSecrets.filter((secret) => Number(secret.projectId) === projectId));
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not load secrets");
      setSecrets([]);
    } finally {
      setLoading(false);
    }
  }, [projectId]);

  useEffect(() => {
    void loadSecrets();
  }, [loadSecrets]);

  const handleSubmit = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!label.trim() || !value.trim()) return;

    setSaving(true);
    setError(null);

    try {
      const res = await fetch("/api/secrets", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({
          projectId,
          projectName,
          label: label.trim(),
          value,
        }),
      });

      if (!res.ok) throw new Error(`HTTP ${res.status}`);

      setLabel("");
      setValue("");
      await loadSecrets();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not save secret");
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async (secretId: Secret["id"]) => {
    setError(null);

    try {
      const res = await fetch(`/api/secrets/${secretId}`, {
        method: "DELETE",
        credentials: "include",
      });

      if (!res.ok) throw new Error(`HTTP ${res.status}`);

      await loadSecrets();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not delete secret");
    }
  };

  return (
    <div
      style={{
        display: "flex",
        flexDirection: "column",
        gap: 14,
        flex: 1,
        minHeight: 0,
        padding: 16,
        background: "var(--atlas-surface)",
        color: "var(--atlas-fg)",
        fontFamily: "var(--app-font-mono)",
        overflowY: "auto",
      }}
    >
      <div
        style={{
          border: "1px solid var(--atlas-border)",
          borderRadius: 12,
          padding: 14,
          background: "var(--atlas-surface)",
        }}
      >
        <div
          style={{
            color: "var(--atlas-gold)",
            fontSize: 12,
            fontWeight: 700,
            letterSpacing: "0.08em",
            marginBottom: 6,
            textTransform: "uppercase",
          }}
        >
          Secrets
        </div>
        <div style={{ color: "var(--atlas-muted)", fontSize: 11 }}>
          Store project-scoped secret values for {projectName}.
        </div>
      </div>

      <form
        onSubmit={handleSubmit}
        style={{
          display: "flex",
          flexDirection: "column",
          gap: 10,
          border: "1px solid var(--atlas-border)",
          borderRadius: 12,
          padding: 14,
          background: "var(--atlas-surface)",
        }}
      >
        <div
          style={{
            color: "var(--atlas-gold)",
            fontSize: 11,
            fontWeight: 700,
            letterSpacing: "0.08em",
            textTransform: "uppercase",
          }}
        >
          Add Secret
        </div>
        <input
          value={label}
          onChange={(event) => setLabel(event.target.value)}
          placeholder="Label"
          style={{
            width: "100%",
            border: "1px solid var(--atlas-border)",
            borderRadius: 8,
            padding: "9px 10px",
            background: "var(--atlas-surface)",
            color: "var(--atlas-fg)",
            fontFamily: "var(--app-font-mono)",
            fontSize: 12,
            outline: "none",
          }}
        />
        <input
          value={value}
          onChange={(event) => setValue(event.target.value)}
          placeholder="Value"
          type="password"
          style={{
            width: "100%",
            border: "1px solid var(--atlas-border)",
            borderRadius: 8,
            padding: "9px 10px",
            background: "var(--atlas-surface)",
            color: "var(--atlas-fg)",
            fontFamily: "var(--app-font-mono)",
            fontSize: 12,
            outline: "none",
          }}
        />
        <button
          type="submit"
          disabled={saving || !label.trim() || !value.trim()}
          style={{
            alignSelf: "flex-start",
            border: "1px solid var(--atlas-gold)",
            borderRadius: 999,
            padding: "8px 12px",
            background: "transparent",
            color: "var(--atlas-gold)",
            cursor: saving || !label.trim() || !value.trim() ? "not-allowed" : "pointer",
            fontFamily: "var(--app-font-mono)",
            fontSize: 11,
            fontWeight: 700,
            letterSpacing: "0.08em",
            opacity: saving || !label.trim() || !value.trim() ? 0.55 : 1,
            textTransform: "uppercase",
          }}
        >
          {saving ? "Saving..." : "Add Secret"}
        </button>
      </form>

      {error && (
        <div
          style={{
            border: "1px solid var(--atlas-border)",
            borderRadius: 10,
            padding: 10,
            color: "var(--atlas-gold)",
            fontSize: 11,
          }}
        >
          {error}
        </div>
      )}

      <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
        {loading ? (
          <div style={{ color: "var(--atlas-muted)", fontSize: 11 }}>Loading secrets...</div>
        ) : secrets.length === 0 ? (
          <div style={{ color: "var(--atlas-muted)", fontSize: 11 }}>No secrets yet.</div>
        ) : (
          secrets.map((secret) => (
            <div
              key={secret.id}
              style={{
                display: "flex",
                alignItems: "center",
                justifyContent: "space-between",
                gap: 12,
                border: "1px solid var(--atlas-border)",
                borderRadius: 10,
                padding: "10px 12px",
                background: "var(--atlas-surface)",
              }}
            >
              <div style={{ minWidth: 0 }}>
                <div style={{ color: "var(--atlas-fg)", fontSize: 12, marginBottom: 4 }}>
                  {secret.label}
                </div>
                <div style={{ color: "var(--atlas-muted)", fontSize: 11 }}>
                  {secret.maskedValue}
                </div>
              </div>
              <button
                type="button"
                onClick={() => void handleDelete(secret.id)}
                style={{
                  border: "1px solid var(--atlas-border)",
                  borderRadius: 999,
                  padding: "6px 10px",
                  background: "transparent",
                  color: "var(--atlas-muted)",
                  cursor: "pointer",
                  fontFamily: "var(--app-font-mono)",
                  fontSize: 10,
                  letterSpacing: "0.08em",
                  textTransform: "uppercase",
                }}
              >
                Delete
              </button>
            </div>
          ))
        )}
      </div>
    </div>
  );
}
