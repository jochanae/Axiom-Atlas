import { useEffect, useMemo, useState } from "react";
import { Entry } from "@workspace/api-client-react";
import type React from "react";

type ParkingLotDetailPanelProps = {
  entry: Entry;
  projectId: number;
  onClose: () => void;
  onCommit: () => void;
  onDelete: () => void;
};

type EntryContext = {
  whatItMeans: string;
  whyItComesUp: string;
};

function timeAgo(date: string | Date): string {
  const diff = Date.now() - new Date(date).getTime();
  const mins = Math.floor(diff / 60000);
  const hours = Math.floor(diff / 3600000);
  const days = Math.floor(diff / 86400000);
  if (days > 0) return `${days}d ago`;
  if (hours > 0) return `${hours}h ago`;
  if (mins > 0) return `${mins}m ago`;
  return "just now";
}

function categoryLabel(entry: Entry): string {
  const verb = (entry.verb ?? "").toLowerCase();
  const severity = (entry.severity ?? "").toLowerCase();
  if (verb.includes("decision") || severity === "decision" || severity === "committed") return "STRATEGY · DECISION";
  if (verb.includes("blocker") || severity === "blocker") return "ARCHITECTURE · BLOCKER";
  return "UX · INSIGHT";
}

export function ParkingLotDetailPanel({
  entry,
  projectId,
  onClose,
  onCommit,
  onDelete,
}: ParkingLotDetailPanelProps) {
  const [context, setContext] = useState<EntryContext | null>(null);
  const [loadingContext, setLoadingContext] = useState(true);
  const [contextError, setContextError] = useState(false);
  const category = useMemo(() => categoryLabel(entry), [entry]);
  const irreversible = entry.severity === "blocker";

  useEffect(() => {
    let cancelled = false;
    setContext(null);
    setContextError(false);
    setLoadingContext(true);

    fetch(`/api/entries/${entry.id}/context`, { method: "POST" })
      .then(async (res) => {
        if (!res.ok) throw new Error(`Context failed (${res.status})`);
        return res.json() as Promise<EntryContext>;
      })
      .then((data) => {
        if (cancelled) return;
        setContext(data);
      })
      .catch(() => {
        if (cancelled) return;
        setContextError(true);
      })
      .finally(() => {
        if (!cancelled) setLoadingContext(false);
      });

    return () => { cancelled = true; };
  }, [entry.id, projectId]);

  const fallback = entry.summary || entry.title;

  return (
    <>
      <div
        onClick={onClose}
        style={{
          position: "fixed",
          inset: 0,
          zIndex: 220,
          background: "color-mix(in oklab, var(--atlas-bg) 72%, transparent)",
          backdropFilter: "blur(3px)",
        }}
      />
      <aside
        className="atlas-slide-in-right"
        style={{
          position: "fixed",
          top: 0,
          right: 0,
          bottom: 0,
          zIndex: 221,
          width: "min(560px, 85vw)",
          background: "var(--atlas-bg)",
          borderLeft: "1px solid var(--atlas-border)",
          boxShadow: "-28px 0 80px -42px var(--atlas-gold)",
          display: "flex",
          flexDirection: "column",
        }}
      >
        <header
          style={{
            padding: "18px 20px 16px",
            borderBottom: "1px solid var(--atlas-border)",
            background: "var(--atlas-surface)",
            flexShrink: 0,
          }}
        >
          <div style={{ display: "flex", gap: 12, alignItems: "flex-start" }}>
            <div style={{ flex: 1, minWidth: 0 }}>
              <h2 style={{ margin: 0, color: "var(--atlas-fg)", fontSize: 18, lineHeight: 1.25, fontWeight: 700 }}>
                {entry.title}
              </h2>
              <div
                style={{
                  marginTop: 7,
                  fontFamily: "var(--app-font-mono)",
                  fontSize: 10,
                  letterSpacing: "0.08em",
                  color: "var(--atlas-muted)",
                  opacity: 0.68,
                  textTransform: "uppercase",
                }}
              >
                chat message · {timeAgo(entry.createdAt)}
              </div>
            </div>
            <button
              type="button"
              onClick={onClose}
              aria-label="Close detail panel"
              style={{
                background: "transparent",
                border: "none",
                color: "var(--atlas-muted)",
                cursor: "pointer",
                fontSize: 24,
                lineHeight: 1,
                padding: "0 2px",
                opacity: 0.72,
              }}
            >
              ×
            </button>
          </div>
        </header>

        <div style={{ flex: 1, overflowY: "auto", padding: "22px 20px 28px" }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 12, marginBottom: 14 }}>
            <div
              style={{
                fontFamily: "var(--app-font-mono)",
                fontSize: 10,
                letterSpacing: "0.14em",
                color: "var(--atlas-muted)",
                opacity: 0.58,
                textTransform: "uppercase",
              }}
            >
              {category}
            </div>
            <div
              style={{
                display: "inline-flex",
                alignItems: "center",
                gap: 6,
                flexShrink: 0,
                fontFamily: "var(--app-font-mono)",
                fontSize: 9.5,
                letterSpacing: "0.1em",
                color: irreversible ? "var(--atlas-ember)" : "var(--atlas-phosphor)",
                textTransform: "uppercase",
              }}
            >
              <span style={{ width: 6, height: 6, borderRadius: "50%", background: "currentColor", display: "inline-block" }} />
              {irreversible ? "Irreversible" : "Reversible"}
            </div>
          </div>

          <h3 style={{ margin: "0 0 10px", color: "var(--atlas-fg)", fontSize: 16, lineHeight: 1.35, fontWeight: 650 }}>
            {entry.title}
          </h3>

          {entry.summary && (
            <p
              style={{
                margin: "0 0 22px",
                color: "var(--atlas-gold)",
                opacity: 0.78,
                fontStyle: "italic",
                fontSize: 13,
                lineHeight: 1.65,
              }}
            >
              {entry.summary}
            </p>
          )}

          <DetailSection title="What it means">
            {loadingContext ? (
              <ThinkingLine />
            ) : contextError ? (
              fallback
            ) : (
              context?.whatItMeans || fallback
            )}
          </DetailSection>

          <DetailSection title="Why it comes up">
            {loadingContext ? (
              <ThinkingLine />
            ) : contextError ? (
              fallback
            ) : (
              context?.whyItComesUp || fallback
            )}
          </DetailSection>
        </div>

        <footer
          style={{
            flexShrink: 0,
            padding: "14px 20px calc(14px + env(safe-area-inset-bottom, 0px))",
            borderTop: "1px solid var(--atlas-border)",
            background: "var(--atlas-surface)",
            display: "flex",
            gap: 10,
          }}
        >
          <button
            type="button"
            onClick={onCommit}
            style={{
              flex: 1,
              padding: "10px 14px",
              borderRadius: 8,
              border: "1px solid var(--atlas-gold)",
              background: "var(--atlas-gold)",
              color: "var(--atlas-bg)",
              cursor: "pointer",
              fontFamily: "var(--app-font-mono)",
              fontSize: 11,
              fontWeight: 700,
              letterSpacing: "0.1em",
              textTransform: "uppercase",
            }}
          >
            Commit
          </button>
          <button
            type="button"
            onClick={onDelete}
            style={{
              flex: 1,
              padding: "10px 14px",
              borderRadius: 8,
              border: "1px solid color-mix(in oklab, var(--atlas-ember) 35%, var(--atlas-border))",
              background: "transparent",
              color: "color-mix(in oklab, var(--atlas-ember) 78%, var(--atlas-muted))",
              cursor: "pointer",
              fontFamily: "var(--app-font-mono)",
              fontSize: 11,
              letterSpacing: "0.1em",
              textTransform: "uppercase",
            }}
          >
            Delete
          </button>
        </footer>
      </aside>
    </>
  );
}

function DetailSection({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section style={{ marginBottom: 22 }}>
      <div
        style={{
          fontFamily: "var(--app-font-mono)",
          fontSize: 10,
          letterSpacing: "0.14em",
          textTransform: "uppercase",
          color: "var(--atlas-muted)",
          opacity: 0.58,
          marginBottom: 7,
        }}
      >
        {title}
      </div>
      <div style={{ color: "var(--atlas-fg)", fontSize: 13, lineHeight: 1.7, opacity: 0.86 }}>
        {children}
      </div>
    </section>
  );
}

function ThinkingLine() {
  return (
    <span style={{ display: "inline-flex", alignItems: "center", gap: 8, color: "var(--atlas-muted)", fontFamily: "var(--app-font-mono)", fontSize: 11 }}>
      <span
        className="atlas-pulse-dot"
        style={{
          width: 6,
          height: 6,
          borderRadius: "50%",
          background: "var(--atlas-gold)",
          display: "inline-block",
          flexShrink: 0,
        }}
      />
      Atlas is thinking...
    </span>
  );
}
