/**
 * SessionHistorySheet — unified "sessions / threads" surface.
 *
 * Single bottom-sheet used by:
 *   • Global Insight composer's gold-clock  →  GLOBAL INSIGHT · HISTORY
 *   • Workspace composer's gold-clock       →  [PROJECT] · SESSIONS
 *
 * One mental model: time = "where was I." New + Resume + Delete all live
 * here. Caller owns the data shape; this component is pure presentation.
 */
import { useEffect } from "react";

export interface SessionHistoryItem {
  id: string | number;
  title: string;
  msgCount?: number;
  /** ISO string or epoch ms. */
  timestamp?: string | number | null;
  active?: boolean;
}

export interface SessionHistorySheetProps {
  open: boolean;
  onClose: () => void;
  /** e.g. "GLOBAL INSIGHT · HISTORY" or "PROJECT · SESSIONS" */
  title: string;
  items: SessionHistoryItem[];
  loading?: boolean;
  emptyHint?: string;
  newLabel?: string;
  onNew: () => void | Promise<void>;
  onSelect: (id: string | number) => void | Promise<void>;
  onDelete?: (id: string | number) => void | Promise<void>;
}

function relTime(ts: string | number | null | undefined): string {
  if (ts == null) return "";
  const t = typeof ts === "string" ? new Date(ts).getTime() : Number(ts);
  if (!isFinite(t) || t <= 0) return "";
  const mins = Math.max(1, Math.round((Date.now() - t) / 60000));
  if (mins < 60) return `${mins}m ago`;
  if (mins < 1440) return `${Math.round(mins / 60)}h ago`;
  return `${Math.round(mins / 1440)}d ago`;
}

export function SessionHistorySheet({
  open,
  onClose,
  title,
  items,
  loading = false,
  emptyHint = "No threads yet.",
  newLabel = "NEW",
  onNew,
  onSelect,
  onDelete,
}: SessionHistorySheetProps) {
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  if (!open) return null;

  const sorted = [...items].sort((a, b) => {
    const at = a.timestamp ? (typeof a.timestamp === "string" ? new Date(a.timestamp).getTime() : Number(a.timestamp)) : 0;
    const bt = b.timestamp ? (typeof b.timestamp === "string" ? new Date(b.timestamp).getTime() : Number(b.timestamp)) : 0;
    return bt - at;
  });

  return (
    <div
      role="dialog"
      aria-label={title}
      onClick={onClose}
      style={{
        position: "fixed",
        inset: 0,
        zIndex: 10000,
        display: "flex",
        alignItems: "flex-end",
      }}
    >
      <div style={{ position: "absolute", inset: 0, background: "var(--atlas-bg)", opacity: 0.45, backdropFilter: "blur(6px)" }} />
      <div
        onClick={(e) => e.stopPropagation()}
        style={{
          position: "relative",
          width: "100%",
          maxWidth: 560,
          margin: "0 auto",
          maxHeight: "72vh",
          background: "var(--atlas-surface)",
          border: "1px solid color-mix(in oklab, var(--atlas-gold) 18%, transparent)",
          borderBottom: "none",
          borderRadius: "18px 18px 0 0",
          padding: "18px 16px calc(env(safe-area-inset-bottom, 0px) + 16px)",
          overflowY: "auto",
          color: "var(--atlas-fg)",
          boxShadow: "0 -20px 60px rgba(0,0,0,0.55)",
        }}
      >
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 14 }}>
          <div style={{
            fontSize: "var(--ts-caption)",
            fontFamily: "var(--app-font-mono)",
            letterSpacing: "0.1em",
            color: "var(--atlas-muted)",
          }}>
            {title}
          </div>
          <button
            type="button"
            onClick={() => { void onNew(); }}
            aria-label={`Start new — ${title}`}
            style={{
              display: "inline-flex", alignItems: "center", gap: 6,
              background: "transparent",
              border: "1px solid var(--atlas-border)",
              borderRadius: 999,
              padding: "6px 12px",
              color: "var(--atlas-fg)",
              fontSize: "var(--ts-caption)",
              fontFamily: "var(--app-font-mono)",
              letterSpacing: "0.05em",
              cursor: "pointer",
            }}
          >
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/>
            </svg>
            {newLabel}
          </button>
        </div>

        {loading && items.length === 0 ? (
          <div style={{ textAlign: "center", padding: 32, color: "var(--atlas-muted)", fontSize: "var(--ts-label)" }}>Loading…</div>
        ) : sorted.length === 0 ? (
          <div style={{ textAlign: "center", padding: "32px 16px", color: "var(--atlas-muted)", fontSize: "var(--ts-label)", lineHeight: 1.5 }}>
            {emptyHint}
          </div>
        ) : (
          sorted.map((s) => (
            <div
              key={s.id}
              style={{
                width: "100%",
                padding: "12px 0",
                borderBottom: "1px solid var(--atlas-border)",
                display: "flex",
                justifyContent: "space-between",
                alignItems: "center",
                gap: 12,
              }}
            >
              <button
                type="button"
                onClick={() => { void onSelect(s.id); }}
                style={{
                  flex: 1, minWidth: 0,
                  background: "transparent", border: "none", padding: 0,
                  cursor: "pointer", textAlign: "left", color: "inherit",
                }}
              >
                <div style={{
                  fontSize: "var(--ts-body)",
                  color: s.active ? "var(--atlas-gold)" : "var(--atlas-fg)",
                  marginBottom: 2,
                  overflow: "hidden",
                  textOverflow: "ellipsis",
                  whiteSpace: "nowrap",
                }}>
                  {s.title || "Untitled thread"}
                </div>
                <div style={{ fontSize: "var(--ts-micro)", color: "var(--atlas-muted)", fontFamily: "var(--app-font-mono)" }}>
                  {(s.msgCount ?? 0)} msg{relTime(s.timestamp) ? ` · ${relTime(s.timestamp)}` : ""}
                </div>
              </button>
              {onDelete && (
                <button
                  type="button"
                  onClick={(e) => { e.stopPropagation(); void onDelete(s.id); }}
                  aria-label="Delete"
                  title="Delete"
                  style={{
                    flexShrink: 0,
                    background: "transparent",
                    border: "none",
                    color: "var(--atlas-muted)",
                    cursor: "pointer",
                    padding: 6,
                    borderRadius: 6,
                    display: "inline-flex",
                    alignItems: "center",
                    justifyContent: "center",
                  }}
                >
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
                    <polyline points="3 6 5 6 21 6" />
                    <path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6" />
                    <path d="M10 11v6M14 11v6" />
                  </svg>
                </button>
              )}
            </div>
          ))
        )}
      </div>
    </div>
  );
}

export default SessionHistorySheet;
