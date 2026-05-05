/**
 * EntryCard — the single, unified card component for both Ledger and Parking Lot.
 * Status (entry.status) decides the posture:
 *
 *   committed → "locked" posture: stronger contrast, locked indicator,
 *               actions = View, Reopen (controlled), Archive
 *   parked    → "active" posture: slightly muted, shows next action,
 *               actions = Resume, Commit, Delete
 *   draft     → "active" posture (a reopened successor entry)
 *
 * Per locked architectural rule: same skeleton, different posture.
 * "Do NOT create separate LedgerEntry and ParkedItem components."
 */

import { useState } from "react";
import { StatusGlyph, SEVERITY_LABEL } from "./StatusGlyph";
import { CapsuleTag } from "./CapsuleTag";
import type { Entry } from "@workspace/api-client-react";

function relativeTime(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  const days = Math.floor(hrs / 24);
  if (days < 7) return `${days}d ago`;
  return new Date(iso).toLocaleDateString(undefined, { month: "short", day: "numeric" });
}

function formatCost(cost: number): string {
  if (cost === 0) return "no cost";
  if (cost < 1) return `$${cost.toFixed(2)}`;
  return `$${cost.toFixed(0)}`;
}

export interface EntryCardProps {
  entry: Entry;
  onCommit?: (entry: Entry) => void | Promise<void>;
  onResume?: (entry: Entry) => void | Promise<void>;
  onDelete?: (entry: Entry) => void | Promise<void>;
  onReopen?: (entry: Entry) => void | Promise<void>;
  onArchive?: (entry: Entry) => void | Promise<void>;
  onEdit?: (entry: Entry) => void;
  busy?: boolean;
}

export function EntryCard({
  entry,
  onCommit,
  onResume,
  onDelete,
  onReopen,
  onArchive,
  onEdit,
  busy = false,
}: EntryCardProps) {
  const [detailsOpen, setDetailsOpen] = useState(false);
  const locked = entry.status === "committed";
  const posture = locked ? "locked" : "active";

  return (
    <article
      role="group"
      aria-label={`${SEVERITY_LABEL[entry.severity as keyof typeof SEVERITY_LABEL] ?? entry.severity}: ${entry.title}`}
      data-posture={posture}
      data-status={entry.status}
      className="entry-card relative"
    >
      <div className="entry-card-inner">
        {/* Header */}
        <header className="flex items-start gap-3 px-4 pt-3.5 pb-2.5">
          <div className="pt-[3px]">
            <StatusGlyph severity={entry.severity as "blocker" | "parked" | "committed" | "neutral"} verb={entry.verb} size={16} />
          </div>
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2 flex-wrap">
              <h3 className="text-[13px] font-semibold tracking-tight leading-snug truncate" style={{ color: "var(--atlas-fg)" }}>
                {entry.title}
              </h3>
              {locked && (
                <CapsuleTag severity="committed" size="xs">LOCKED</CapsuleTag>
              )}
              {entry.supersedesId && (
                <CapsuleTag size="xs">REOPENED</CapsuleTag>
              )}
              {entry.isViolation && (
                <CapsuleTag severity="blocker" size="xs">VIOLATION</CapsuleTag>
              )}
              {entry.status === "draft" && !entry.supersedesId && (
                <CapsuleTag size="xs">DRAFT</CapsuleTag>
              )}
            </div>
            <div className="mt-1 flex items-center gap-1.5 flex-wrap" style={{ fontFamily: "var(--app-font-mono)", fontSize: 10, textTransform: "uppercase", letterSpacing: "0.12em", color: "var(--atlas-muted)" }}>
              <span>{relativeTime(entry.createdAt)}</span>
              {entry.costOfLesson != null && (
                <span>· {formatCost(entry.costOfLesson)}</span>
              )}
              {entry.mode && (
                <span
                  style={{
                    display: "inline-flex",
                    alignItems: "center",
                    padding: "1px 6px",
                    borderRadius: 4,
                    fontSize: 8.5,
                    letterSpacing: "0.1em",
                    background: "color-mix(in srgb, var(--atlas-gold) 10%, transparent)",
                    border: "0.5px solid color-mix(in srgb, var(--atlas-gold) 20%, var(--atlas-border))",
                    color: "var(--atlas-gold)",
                  }}
                >
                  {entry.mode}
                </span>
              )}
            </div>
          </div>
          {entry.buildId && (
            <div className="flex-shrink-0 pt-[2px]">
              <CapsuleTag size="xs">#{entry.buildId}</CapsuleTag>
            </div>
          )}
        </header>

        {/* Summary */}
        {entry.summary && (
          <div className="px-4 pb-3">
            <p className="text-[12px] leading-relaxed" style={{ color: "var(--atlas-muted)" }}>
              {entry.summary}
            </p>
          </div>
        )}

        {/* Details drawer */}
        {detailsOpen && (entry.details || (entry.touched && entry.touched.length > 0)) && (
          <div className="mx-4 mb-3 px-3 py-2.5 rounded-sm space-y-2" style={{ background: "rgba(255,255,255,0.03)", border: "0.5px solid var(--atlas-border)" }}>
            {entry.details && (
              <pre className="text-[11px] leading-relaxed whitespace-pre-wrap break-words" style={{ fontFamily: "var(--app-font-mono)", color: "var(--atlas-fg)", opacity: 0.85 }}>
                {entry.details}
              </pre>
            )}
            {entry.touched && entry.touched.length > 0 && (
              <div className="pt-2 space-y-1" style={{ borderTop: "0.5px solid var(--atlas-border)" }}>
                <div style={{ fontFamily: "var(--app-font-mono)", fontSize: 9, textTransform: "uppercase", letterSpacing: "0.12em", color: "var(--atlas-muted)" }}>
                  Touched
                </div>
                <ul style={{ margin: 0, padding: 0, listStyle: "none" }}>
                  {entry.touched.map((t) => (
                    <li key={t} className="truncate" style={{ fontFamily: "var(--app-font-mono)", fontSize: 10.5, color: "var(--atlas-fg)", opacity: 0.75, lineHeight: 1.7 }}>· {t}</li>
                  ))}
                </ul>
              </div>
            )}
          </div>
        )}

        {/* Divider */}
        <div className="mx-4 h-px" style={{ background: "linear-gradient(to right, transparent, var(--atlas-border), transparent)" }} />

        {/* Footer actions */}
        <footer className="flex items-center justify-between gap-2 px-4 py-2.5">
          <div className="flex items-center gap-1.5">
            {(entry.details || (entry.touched && entry.touched.length > 0)) && (
              <EntryGhostBtn onClick={() => setDetailsOpen((v) => !v)} active={detailsOpen} disabled={busy}>
                Details
              </EntryGhostBtn>
            )}
            {onEdit && (
              <EntryGhostBtn onClick={() => onEdit(entry)} disabled={busy}>
                Edit
              </EntryGhostBtn>
            )}
          </div>
          <div className="flex items-center gap-1.5">
            {/* Active posture */}
            {!locked && onResume && (
              <EntryGhostBtn onClick={() => onResume(entry)} disabled={busy}>Resume</EntryGhostBtn>
            )}
            {!locked && onDelete && (
              <EntryGhostBtn onClick={() => onDelete(entry)} disabled={busy}>Delete</EntryGhostBtn>
            )}
            {!locked && onCommit && (
              <EntryPrimaryBtn onClick={() => onCommit(entry)} disabled={busy}>
                {busy ? "Committing…" : "Commit"}
              </EntryPrimaryBtn>
            )}
            {/* Locked posture */}
            {locked && onReopen && (
              <EntryGhostBtn onClick={() => onReopen(entry)} disabled={busy}>Reopen</EntryGhostBtn>
            )}
            {locked && onArchive && (
              <EntryGhostBtn onClick={() => onArchive(entry)} disabled={busy}>Archive</EntryGhostBtn>
            )}
          </div>
        </footer>
      </div>

      <style>{`
        .entry-card {
          padding: 0.5px;
          border-radius: 6px;
        }
        .entry-card[data-posture="locked"] {
          background: linear-gradient(
            135deg,
            color-mix(in srgb, var(--atlas-gold) 55%, transparent) 0%,
            color-mix(in srgb, var(--atlas-gold) 18%, transparent) 28%,
            transparent 55%,
            color-mix(in srgb, var(--atlas-bg) 80%, transparent) 100%
          );
          box-shadow:
            0 1px 0 0 color-mix(in srgb, var(--atlas-gold) 8%, transparent) inset,
            0 12px 32px -18px rgba(0, 0, 0, 0.55);
        }
        .entry-card[data-posture="active"] {
          background: linear-gradient(
            135deg,
            color-mix(in srgb, var(--atlas-gold) 22%, transparent) 0%,
            color-mix(in srgb, var(--atlas-border) 70%, transparent) 60%,
            transparent 100%
          );
          box-shadow: 0 6px 20px -14px rgba(0, 0, 0, 0.4);
        }
        .entry-card-inner {
          background: var(--atlas-surface);
          border-radius: 5.5px;
          overflow: hidden;
        }
        .entry-card[data-posture="locked"] .entry-card-inner {
          background: color-mix(in srgb, var(--atlas-bg) 92%, var(--atlas-surface));
        }
      `}</style>
    </article>
  );
}

function EntryGhostBtn({
  children,
  onClick,
  disabled,
  active,
}: {
  children: React.ReactNode;
  onClick?: () => void;
  disabled?: boolean;
  active?: boolean;
}) {
  const color = "var(--atlas-gold)";
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      style={{
        fontFamily: "var(--app-font-mono)",
        textTransform: "uppercase",
        letterSpacing: "0.12em",
        borderRadius: 3,
        transition: "all 140ms ease",
        fontSize: 10,
        padding: "4px 9px",
        background: active ? `color-mix(in srgb, ${color} 14%, transparent)` : "transparent",
        border: `0.5px solid color-mix(in srgb, ${color} ${active ? 80 : 55}%, transparent)`,
        color: active ? color : `color-mix(in srgb, ${color} 90%, var(--atlas-fg))`,
        cursor: disabled ? "default" : "pointer",
        opacity: disabled ? 0.4 : 1,
      }}
    >
      {children}
    </button>
  );
}

function EntryPrimaryBtn({
  children,
  onClick,
  disabled,
}: {
  children: React.ReactNode;
  onClick?: () => void;
  disabled?: boolean;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      style={{
        fontFamily: "var(--app-font-mono)",
        textTransform: "uppercase",
        letterSpacing: "0.12em",
        borderRadius: 3,
        fontWeight: 600,
        fontSize: 10,
        padding: "5px 12px",
        color: "var(--atlas-bg)",
        background: "linear-gradient(180deg, var(--atlas-gold) 0%, color-mix(in srgb, var(--atlas-gold) 78%, #6a4a18) 100%)",
        border: "0.5px solid color-mix(in srgb, var(--atlas-gold) 75%, transparent)",
        boxShadow: "0 0 14px -4px color-mix(in srgb, var(--atlas-gold) 55%, transparent), inset 0 1px 0 0 rgba(255,255,255,0.18)",
        cursor: disabled ? "default" : "pointer",
        opacity: disabled ? 0.4 : 1,
        transition: "opacity 140ms ease",
      }}
    >
      {children}
    </button>
  );
}

import type React from "react";
