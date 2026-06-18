import { useState } from "react";
import { Entry, createEntry, useCreateEntry, useGetProject, getGetProjectQueryKey, Project, getListEntriesQueryKey } from "@workspace/api-client-react";
import { Link } from "wouter";
import { useQueryClient } from "@tanstack/react-query";
import { StatusGlyph } from "../StatusGlyph";
import { CapsuleTag } from "../CapsuleTag";

import { ParkingLotEntry } from "@/components/workspace/ParkingLotEntry";
import { SessionTimeline, type TimelineMessage } from "@/components/workspace/SessionTimeline";
import { type PushRecord } from "../../pages/workspace";

function LedgerEntry({ entry }: { entry: Entry }) {
  const committed = entry.status === "committed";
  const severity = entry.severity as "blocker" | "parked" | "committed" | "neutral";

  const wrapperGradient = committed
    ? `linear-gradient(135deg,
        color-mix(in oklab, var(--atlas-gold) 55%, transparent) 0%,
        color-mix(in oklab, var(--atlas-gold) 18%, transparent) 28%,
        transparent 55%,
        color-mix(in oklab, var(--atlas-bg) 80%, transparent) 100%)`
    : `linear-gradient(135deg,
        color-mix(in oklab, var(--atlas-gold) 22%, transparent) 0%,
        color-mix(in oklab, var(--atlas-border) 70%, transparent) 60%,
        transparent 100%)`;

  const wrapperShadow = committed
    ? `0 1px 0 0 color-mix(in oklab, var(--atlas-gold) 8%, transparent) inset, 0 12px 32px -18px rgba(0,0,0,0.55)`
    : `0 6px 20px -14px rgba(0,0,0,0.4)`;

  const innerBg = committed
    ? "color-mix(in oklab, var(--atlas-bg) 92%, var(--atlas-surface))"
    : "var(--atlas-surface)";

  return (
    <article
      style={{
        padding: "0.5px", borderRadius: 6, marginBottom: 6,
        background: wrapperGradient,
        boxShadow: wrapperShadow,
      }}
    >
      <div
        style={{
          background: innerBg,
          borderRadius: 5.5,
          overflow: "hidden",
          backdropFilter: committed ? "blur(18px)" : "none",
        }}
      >
        {/* Header */}
        <div style={{ display: "flex", alignItems: "flex-start", gap: 10, padding: "10px 13px 8px" }}>
          <div style={{ paddingTop: 2, flexShrink: 0 }}>
            <StatusGlyph severity={severity} verb={entry.verb} size={14} />
          </div>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ display: "flex", alignItems: "center", gap: 6, flexWrap: "wrap" as const }}>
              <Link
                href={`/entry/${entry.id}`}
                onClick={(e) => e.stopPropagation()}
                style={{
                  fontSize: 12.5, fontWeight: 600, lineHeight: 1.35, letterSpacing: "-0.01em",
                  color: committed ? "var(--atlas-fg)" : "var(--atlas-muted)",
                  textDecoration: "none",
                }}
              >
                {entry.title}
              </Link>
              {committed && <CapsuleTag severity="committed" size="xs">LOCKED</CapsuleTag>}
              {entry.deviation && <CapsuleTag severity="blocker" size="xs">SHIFTED</CapsuleTag>}
            </div>
          </div>
        </div>

        {/* Body */}
        {entry.summary && (
          <div style={{ padding: "0 13px 9px 37px" }}>
            <p style={{ margin: 0, fontSize: 11.5, lineHeight: 1.55, color: "var(--atlas-muted)" }}>
              {entry.summary}
            </p>
          </div>
        )}

        {/* Divider */}
        <div style={{
          margin: "0 13px", height: 1,
          background: "linear-gradient(to right, transparent, var(--atlas-border), transparent)",
        }} />

        {/* Footer */}
        <div style={{ display: "flex", alignItems: "center", gap: 6, padding: "5px 13px 7px" }}>
          <span style={{
            fontFamily: "var(--app-font-mono)", fontSize: 9, letterSpacing: "0.1em",
            textTransform: "uppercase", color: "var(--atlas-muted)", opacity: 0.45,
          }}>
            {new Date(entry.createdAt).toLocaleDateString("en-US", { month: "short", day: "numeric" })}
          </span>
          {entry.mode && (
            <span style={{
              marginLeft: "auto",
              fontFamily: "var(--app-font-mono)", fontSize: 8.5, letterSpacing: "0.1em",
              textTransform: "uppercase", padding: "2px 6px", borderRadius: 2,
              background: "color-mix(in oklab, var(--atlas-gold) 10%, transparent)",
              border: "0.5px solid color-mix(in oklab, var(--atlas-gold) 20%, var(--atlas-border))",
              color: "var(--atlas-gold)",
            }}>
              {entry.mode}
            </span>
          )}
        </div>
      </div>
    </article>
  );
}

// ── PushHistoryEntry ──────────────────────────────────────────────────────────

export function LedgerPanel({
  projectId,
  entries,
  pushHistory,
  onRollbackPush,
  messages = [],
}: {
  projectId: number;
  entries: Entry[];
  pushHistory: PushRecord[];
  onRollbackPush: (record: PushRecord) => Promise<void>;
  messages?: TimelineMessage[];
}) {
  const parked = entries.filter((e) => e.status === "parked");

  const allCommitted = entries.filter((e) => e.status === "committed");
  const committedClean = allCommitted.filter((e) => !e.deviation);
  const overridden = allCommitted.filter((e) => e.deviation);

  const [showAdd, setShowAdd] = useState(false);
  const [newTitle, setNewTitle] = useState("");
  const createEntry = useCreateEntry();
  const queryClient = useQueryClient();
  const { data: ledgerProject } = useGetProject(projectId, { query: { queryKey: getGetProjectQueryKey(projectId) } });

  const [vaultSaving, setVaultSaving] = useState(false);
  const [vaultSaved, setVaultSaved] = useState(false);

  const handleSaveToVault = async () => {
    if (vaultSaving || allCommitted.length === 0) return;
    setVaultSaving(true);
    const projectName = ledgerProject?.name ?? "Unknown Project";
    const now = new Date();
    const dateStr = now.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
    const title = `${projectName} — ${dateStr}`;
    const tagSet = new Set<string>();
    const lines = allCommitted.map((e) => {
      if (e.mode) tagSet.add(e.mode.toUpperCase());
      return `• ${e.title}${e.summary ? `\n  ${e.summary}` : ""}`;
    });
    const content = `Decision Ledger Snapshot — ${projectName}\n${dateStr}\n\n${lines.join("\n\n")}`;
    try {
      await fetch("/api/vault", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          projectId,
          projectName,
          title,
          content,
          entryCount: allCommitted.length,
          tags: tagSet.size > 0 ? Array.from(tagSet) : null,
        }),
      });
      setVaultSaved(true);
      setTimeout(() => setVaultSaved(false), 2500);
    } finally {
      setVaultSaving(false);
    }
  };

  const handleAdd = () => {
    if (!newTitle.trim()) return;
    createEntry.mutate(
      { projectId, data: { title: newTitle.trim(), status: "committed", severity: "committed", mode: "decide" } },
      {
        onSuccess: () => {
          queryClient.invalidateQueries({ queryKey: getListEntriesQueryKey(projectId, {}) });
          setNewTitle(""); setShowAdd(false);
        },
      }
    );
  };

  return (
    <div style={{ flex: 1, display: "flex", flexDirection: "column", overflow: "hidden" }}>
      {/* Add entry inline */}
      {showAdd && (
        <div style={{ padding: "10px 12px", borderBottom: "1px solid var(--atlas-border)", flexShrink: 0 }}>
          <input
            autoFocus value={newTitle}
            onChange={(e) => setNewTitle(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") handleAdd();
              if (e.key === "Escape") { setShowAdd(false); setNewTitle(""); }
            }}
            placeholder="Decision title…"
            style={{
              width: "100%", padding: "8px 10px", borderRadius: 6, marginBottom: 6,
              background: "var(--atlas-surface)", border: "1px solid var(--atlas-border)",
              color: "var(--atlas-fg)", fontSize: 12, outline: "none",
              fontFamily: "var(--app-font-sans)", transition: "border-color 160ms ease",
            }}
            onFocus={(e) => (e.currentTarget.style.borderColor = "rgba(201,162,76,0.35)")}
            onBlur={(e) => (e.currentTarget.style.borderColor = "var(--atlas-border)")}
          />
          <button
            onClick={handleAdd} disabled={createEntry.isPending}
            style={{
              width: "100%", padding: "7px", borderRadius: 6,
              background: "var(--atlas-ember)", border: "none",
              color: "var(--atlas-fg)", fontSize: 11,
              fontFamily: "var(--app-font-mono)", letterSpacing: "0.08em",
              cursor: createEntry.isPending ? "not-allowed" : "pointer",
              opacity: createEntry.isPending ? 0.6 : 1,
            }}
          >
            Commit
          </button>
        </div>
      )}

      {/* Entries list */}
      <div style={{ flex: 1, overflowY: "auto", padding: "12px" }} className="scrollbar-none">
        {entries.length === 0 ? (
          <div style={{ textAlign: "center", padding: "36px 12px", color: "var(--atlas-muted)", fontSize: 12, opacity: 0.5, lineHeight: 1.65 }}>
            Decisions made during your session will appear here.
          </div>
        ) : (
          <>
            {/* ── Group 1: Committed ── */}
            <div style={{ marginBottom: 22 }}>
              <div style={{ display: "flex", alignItems: "center", gap: 7, marginBottom: 10, padding: "0 2px" }}>
                <span style={{ width: 6, height: 6, borderRadius: "50%", flexShrink: 0, background: "var(--atlas-phosphor)", boxShadow: "0 0 6px color-mix(in oklab, var(--atlas-phosphor) 55%, transparent)" }} />
                <span style={{ fontFamily: "var(--app-font-mono)", fontSize: 9.5, letterSpacing: "0.14em", textTransform: "uppercase" as const, color: "var(--atlas-phosphor)" }}>
                  Committed
                </span>
                <span style={{ fontFamily: "var(--app-font-mono)", fontSize: 9.5, letterSpacing: "0.06em", color: "var(--atlas-muted)", marginLeft: "auto" }}>
                  {committedClean.length}
                </span>
              </div>
              {committedClean.length > 0 ? (
                committedClean.map((e) => <LedgerEntry key={e.id} entry={e} />)
              ) : (
                <div style={{ fontSize: 11, color: "var(--atlas-muted)", opacity: 0.45, padding: "6px 2px", lineHeight: 1.55 }}>
                  No committed decisions yet.
                </div>
              )}
            </div>

            {/* ── Group 2: Overridden ── */}
            <div style={{ marginBottom: 22 }}>
              <div style={{ display: "flex", alignItems: "center", gap: 7, marginBottom: 10, padding: "0 2px" }}>
                <span style={{ width: 6, height: 6, borderRadius: "50%", flexShrink: 0, background: "var(--atlas-muted)", opacity: 0.5 }} />
                <span style={{ fontFamily: "var(--app-font-mono)", fontSize: 9.5, letterSpacing: "0.14em", textTransform: "uppercase" as const, color: "var(--atlas-muted)", opacity: 0.65 }}>
                  Overridden
                </span>
                {overridden.length > 0 && (
                  <span style={{ fontFamily: "var(--app-font-mono)", fontSize: 9.5, letterSpacing: "0.06em", color: "var(--atlas-muted)", opacity: 0.5, marginLeft: "auto" }}>
                    {overridden.length}
                  </span>
                )}
              </div>
              {overridden.length > 0 ? (
                <div style={{ opacity: 0.65 }}>
                  {overridden.map((e) => <LedgerEntry key={e.id} entry={e} />)}
                </div>
              ) : (
                <div style={{ fontSize: 11, color: "var(--atlas-muted)", opacity: 0.4, padding: "6px 2px", lineHeight: 1.55 }}>
                  Nothing overridden.
                </div>
              )}
            </div>

            {/* ── Parking Lot ── */}
            <div style={{ marginBottom: 10 }}>
              {/* Header row */}
              <div style={{ display: "flex", alignItems: "baseline", gap: 8, marginBottom: 6, padding: "0 2px" }}>
                <span style={{ fontFamily: "var(--app-font-mono)", fontSize: 10.5, letterSpacing: "0.14em", textTransform: "uppercase" as const, color: parked.length > 0 ? "var(--atlas-fg)" : "var(--atlas-muted)", fontWeight: 600 }}>
                  Parking Lot
                </span>
                {parked.length > 0 && (
                  <span style={{ fontSize: 10, color: "rgba(var(--atlas-muted-rgb),0.45)", fontFamily: "var(--app-font-mono)" }}>
                    {parked.length} waiting · 0 resolved
                  </span>
                )}
              </div>
              {parked.length > 0 ? (
                <div style={{ paddingTop: 4 }}>
                  {parked.map((e) => <ParkingLotEntry key={e.id} entry={e} />)}
                  {/* Bottom item count */}
                  <div style={{ display: "flex", alignItems: "center", gap: 6, marginTop: 8, padding: "6px 2px", borderTop: "1px solid rgba(201,162,76,0.1)" }}>
                    <span style={{ width: 7, height: 7, borderRadius: "50%", background: "var(--atlas-gold)", display: "inline-block", boxShadow: "0 0 6px rgba(201,162,76,0.4)" }} />
                    <span style={{ fontFamily: "var(--app-font-mono)", fontSize: 10, color: "rgba(201,162,76,0.6)", letterSpacing: "0.06em" }}>
                      {parked.length} {parked.length === 1 ? "ITEM" : "ITEMS"}
                    </span>
                  </div>
                </div>
              ) : (
                <div style={{ fontSize: 11, color: "var(--atlas-muted)", opacity: 0.35, padding: "6px 2px", lineHeight: 1.65 }}>
                  Tap <strong style={{ opacity: 0.6 }}>Park</strong> on any Atlas response to save a thought here without breaking your flow.
                </div>
              )}
            </div>
          </>
        )}
      </div>

      {/* ── Changes (unified session timeline: prompts, thoughts, edits, pushes) ── */}
      <SessionTimeline
        messages={messages}
        pushHistory={pushHistory}
        onRollbackPush={onRollbackPush}
        projectId={projectId}
      />


      {/* Footer buttons */}
      <div style={{ padding: "8px 12px", borderTop: "1px solid var(--atlas-border)", flexShrink: 0, display: "flex", flexDirection: "column", gap: 6 }}>
        <button
          onClick={() => setShowAdd(!showAdd)}
          style={{
            width: "100%", padding: "7px", borderRadius: 6,
            background: "transparent",
            border: "1px dashed rgba(201,162,76,0.2)",
            color: "var(--atlas-muted)", fontSize: 11,
            fontFamily: "var(--app-font-mono)", letterSpacing: "0.1em",
            textTransform: "uppercase",
            cursor: "pointer", opacity: 0.65,
            transition: "all 160ms ease",
          }}
          onMouseEnter={(e) => { e.currentTarget.style.opacity = "1"; e.currentTarget.style.borderColor = "rgba(201,162,76,0.45)"; }}
          onMouseLeave={(e) => { e.currentTarget.style.opacity = "0.65"; e.currentTarget.style.borderColor = "rgba(201,162,76,0.2)"; }}
        >
          + Add decision
        </button>
        <button
          onClick={handleSaveToVault}
          disabled={vaultSaving || allCommitted.length === 0}
          title={allCommitted.length === 0 ? "No committed decisions to save" : "Save a snapshot of this ledger to the Vault"}
          style={{
            width: "100%", padding: "7px", borderRadius: 6,
            background: vaultSaved ? "rgba(201,162,76,0.1)" : "transparent",
            border: `1px solid ${vaultSaved ? "rgba(201,162,76,0.4)" : "rgba(201,162,76,0.15)"}`,
            color: vaultSaved ? "var(--atlas-gold)" : "var(--atlas-muted)", fontSize: 11,
            fontFamily: "var(--app-font-mono)", letterSpacing: "0.1em",
            textTransform: "uppercase" as const,
            cursor: vaultSaving || allCommitted.length === 0 ? "default" : "pointer",
            opacity: allCommitted.length === 0 ? 0.35 : vaultSaved ? 1 : 0.55,
            transition: "all 160ms ease",
          }}
          onMouseEnter={(e) => { if (!vaultSaving && allCommitted.length > 0 && !vaultSaved) { e.currentTarget.style.opacity = "0.9"; e.currentTarget.style.borderColor = "rgba(201,162,76,0.35)"; e.currentTarget.style.color = "var(--atlas-gold)"; } }}
          onMouseLeave={(e) => { if (!vaultSaved) { e.currentTarget.style.opacity = allCommitted.length === 0 ? "0.35" : "0.55"; e.currentTarget.style.borderColor = "rgba(201,162,76,0.15)"; e.currentTarget.style.color = "var(--atlas-muted)"; } }}
        >
          {vaultSaved ? "◆ Saved to Vault" : vaultSaving ? "Saving…" : "◆ Save to Vault"}
        </button>
      </div>
    </div>
  );
}
