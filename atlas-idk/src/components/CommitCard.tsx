import { useMemo, useState } from "react";
import type { CommitCardPayload } from "../lib/DecisionCatchEngine";

type CommitCardProps = {
  payload: CommitCardPayload;
  projectId: number;
  sessionId: number;
  sourceMessageId?: number;
  onDone: () => void;
};

function makeBuildId(): string {
  const raw = globalThis.crypto?.randomUUID?.() ?? Math.random().toString(16).slice(2);
  return `#BUILD-${raw.replace(/-/g, "").slice(0, 4).toUpperCase()}`;
}

export function CommitCard({
  payload,
  projectId,
  sessionId,
  sourceMessageId,
  onDone,
}: CommitCardProps) {
  const [saving, setSaving] = useState<"parked" | "committed" | null>(null);
  const [error, setError] = useState<string | null>(null);
  const buildId = useMemo(makeBuildId, []);

  const save = async (status: "parked" | "committed") => {
    if (saving) return;
    setSaving(status);
    setError(null);
    try {
      const res = await fetch(`/api/projects/${projectId}/entries`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          title: payload.title,
          summary: payload.summary,
          status,
          severity: payload.severity === "blocker"
            ? "blocker"
            : status === "parked" ? "parked" : "committed",
          verb: payload.verb,
          buildId: buildId.replace(/^#/, ""),
          sessionId: sessionId || undefined,
          sourceMessageId,
          cardSchemaVersion: payload.v,
          mode: "think",
        }),
      });
      if (!res.ok) throw new Error(`Save failed (${res.status})`);
      onDone();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not save this decision.");
      setSaving(null);
    }
  };

  return (
    <div
      style={{
        marginTop: 12,
        padding: "12px 14px",
        borderRadius: 10,
        background: "var(--atlas-surface)",
        border: "1px solid color-mix(in oklab, var(--atlas-gold) 20%, var(--atlas-border))",
        boxShadow: "0 14px 36px -28px var(--atlas-gold)",
      }}
    >
      <div style={{ display: "flex", alignItems: "center", gap: 7, marginBottom: 8 }}>
        <span
          style={{
            width: 6,
            height: 6,
            borderRadius: "50%",
            background: "var(--atlas-gold)",
            display: "inline-block",
            flexShrink: 0,
          }}
        />
        <span
          style={{
            fontFamily: "var(--app-font-mono)",
            fontSize: 9,
            letterSpacing: "0.12em",
            textTransform: "uppercase",
            color: "var(--atlas-gold)",
          }}
        >
          Decision moment
        </span>
        <span
          style={{
            marginLeft: "auto",
            fontFamily: "var(--app-font-mono)",
            fontSize: 9,
            letterSpacing: "0.08em",
            color: "var(--atlas-muted)",
            opacity: 0.65,
          }}
        >
          {buildId}
        </span>
      </div>

      <div style={{ fontSize: 13, fontWeight: 600, color: "var(--atlas-fg)", lineHeight: 1.35, marginBottom: 5 }}>
        {payload.title}
      </div>
      <div style={{ fontSize: 11.5, color: "var(--atlas-muted)", lineHeight: 1.6, marginBottom: 12 }}>
        {payload.summary}
      </div>

      {error && (
        <div style={{ fontSize: 10.5, color: "var(--atlas-ember)", marginBottom: 9 }}>
          {error}
        </div>
      )}

      <div style={{ display: "flex", gap: 8 }}>
        <button
          type="button"
          disabled={!!saving}
          onClick={() => void save("parked")}
          style={{
            flex: 1,
            padding: "7px 10px",
            borderRadius: 7,
            background: "transparent",
            border: "1px solid var(--atlas-border)",
            color: "var(--atlas-muted)",
            cursor: saving ? "not-allowed" : "pointer",
            fontFamily: "var(--app-font-mono)",
            fontSize: 10,
            letterSpacing: "0.08em",
            textTransform: "uppercase",
            opacity: saving ? 0.55 : 1,
          }}
        >
          {saving === "parked" ? "Parking..." : "Park"}
        </button>
        <button
          type="button"
          disabled={!!saving}
          onClick={() => void save("committed")}
          style={{
            flex: 1,
            padding: "7px 10px",
            borderRadius: 7,
            background: "var(--atlas-gold)",
            border: "1px solid var(--atlas-gold)",
            color: "var(--atlas-bg)",
            cursor: saving ? "not-allowed" : "pointer",
            fontFamily: "var(--app-font-mono)",
            fontSize: 10,
            fontWeight: 700,
            letterSpacing: "0.08em",
            textTransform: "uppercase",
            opacity: saving ? 0.55 : 1,
          }}
        >
          {saving === "committed" ? "Committing..." : "Commit"}
        </button>
      </div>
    </div>
  );
}
