import { useState } from "react";
import { useLocation } from "wouter";
import { LoadingSpinner } from "../components/ui/loading-spinner";
import {
  useListProjects,
  useListEntries,
  useUpdateEntry,
  useDeleteEntry,
  getListEntriesQueryKey,
} from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";

// ── Architectural note (ported from original Atlas) ───────────────────────────
// "Ledger and Parking Lot are the same object, rendered differently based on
//  state. Moving between them is NOT duplication. It is a status change on
//  the same object." — locked rule from original atlas repo
// Resume = navigate back to the source project workspace (not a status change).

export default function ParkingLot() {
  const [, setLocation] = useLocation();
  const qc = useQueryClient();

  const { data: projects = [] } = useListProjects();
  const [selectedProjectId, setSelectedProjectId] = useState<number | null>(null);
  const [busyId, setBusyId] = useState<number | null>(null);

  const activeProjectId = selectedProjectId ?? projects[0]?.id ?? null;
  const queryProjectId = activeProjectId ?? 0;
  const enabled = !!activeProjectId;

  // Load both parked AND draft entries (per original Atlas architectural rule)
  // Draft = a reopened-from-committed entry awaiting recommit
  const { data: parkedEntries = [], isLoading: loadingParked } = useListEntries(
    queryProjectId,
    { status: "parked" },
    { query: { queryKey: ["entries", queryProjectId, "parked"], enabled } }
  );
  const { data: draftEntries = [], isLoading: loadingDraft } = useListEntries(
    queryProjectId,
    { status: "draft" },
    { query: { queryKey: ["entries", queryProjectId, "draft"], enabled } }
  );
  const isLoading = loadingParked || loadingDraft;
  // Merge + sort newest first; draft entries get a badge
  const entries = [...parkedEntries, ...draftEntries].sort(
    (a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()
  );

  const invalidateAll = () => {
    projects.forEach(p => {
      qc.invalidateQueries({ queryKey: getListEntriesQueryKey(p.id) });
      qc.invalidateQueries({ queryKey: ["entries", p.id, "parked"] });
      qc.invalidateQueries({ queryKey: ["entries", p.id, "draft"] });
    });
    qc.invalidateQueries({ queryKey: ["entries", queryProjectId, "parked"] });
    qc.invalidateQueries({ queryKey: ["entries", queryProjectId, "draft"] });
  };

  const updateEntry = useUpdateEntry({ mutation: { onSuccess: invalidateAll } });
  const deleteEntry = useDeleteEntry({ mutation: { onSuccess: invalidateAll } });

  // Resume: navigate back to source project workspace (original behavior)
  const handleResume = (entry: Entry) => {
    if (entry.projectId) {
      setLocation(`/project/${entry.projectId}`);
    } else {
      setLocation("/");
    }
  };

  const handleCommit = (id: number) => {
    setBusyId(id);
    updateEntry.mutate(
      { id, data: { status: "committed" } },
      { onSettled: () => setBusyId(null) }
    );
  };

  const handleDelete = (id: number) => {
    setBusyId(id);
    deleteEntry.mutate({ id }, { onSettled: () => setBusyId(null) });
  };

  const parkedCount = entries.length;

  return (
    <div style={{
      minHeight: "100vh",
      background: "var(--atlas-bg)",
      display: "flex",
      flexDirection: "column",
    }}>
      {/* Header */}
      <div style={{
        position: "sticky", top: 0, zIndex: 50,
        background: "rgba(12,10,9,0.94)",
        backdropFilter: "blur(14px)",
        WebkitBackdropFilter: "blur(14px)",
        borderBottom: "1px solid var(--atlas-border)",
        padding: "0 20px",
        height: 50, display: "flex", alignItems: "center", gap: 10,
      }}>
        {/* Back */}
        <button
          type="button"
          onClick={() => window.history.back()}
          style={{ background: "transparent", border: "none", cursor: "pointer", display: "flex", alignItems: "center", gap: 6, padding: "4px 0", color: "var(--atlas-muted)", flexShrink: 0 }}
        >
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
            <path d="M19 12H5M12 5l-7 7 7 7" />
          </svg>
        </button>

        {/* Breadcrumb */}
        <div style={{ display: "flex", alignItems: "center", gap: 6, flex: 1, minWidth: 0 }}>
          <span style={{ fontSize: 10, fontFamily: "var(--app-font-mono)", color: "var(--atlas-muted)", opacity: 0.5, letterSpacing: "0.1em", textTransform: "uppercase" }}>
            atlas
          </span>
          <span style={{ color: "var(--atlas-border)", fontSize: 11 }}>/</span>
          <span style={{ fontSize: 10, fontFamily: "var(--app-font-mono)", color: "var(--atlas-gold)", letterSpacing: "0.1em", textTransform: "uppercase" }}>
            Parking Lot
          </span>
          {parkedCount > 0 && (
            <span style={{
              fontSize: 9, fontFamily: "var(--app-font-mono)", letterSpacing: "0.06em",
              background: "rgba(201,162,76,0.1)", border: "1px solid rgba(201,162,76,0.25)",
              color: "rgba(201,162,76,0.75)", padding: "1px 8px", borderRadius: 20,
            }}>
              {parkedCount} waiting
            </span>
          )}
        </div>

        {/* Project filter — only show if multiple projects */}
        {projects.length > 1 && (
          <select
            value={activeProjectId ?? ""}
            onChange={(e) => setSelectedProjectId(Number(e.target.value))}
            style={{
              background: "var(--atlas-surface)",
              border: "1px solid var(--atlas-gold-border)",
              color: "var(--atlas-fg)",
              borderRadius: 6,
              padding: "4px 10px",
              fontSize: 11,
              fontFamily: "var(--app-font-mono)",
              cursor: "pointer",
              outline: "none",
              flexShrink: 0,
            }}
          >
            {projects.map(p => (
              <option key={p.id} value={p.id}>{p.name}</option>
            ))}
          </select>
        )}
      </div>

      {/* Body */}
      <div style={{ flex: 1, padding: "32px 20px 120px" }}>
        <div style={{ width: "100%", maxWidth: 680, margin: "0 auto" }}>

          {/* Page title */}
          <div style={{ marginBottom: 28 }}>
            <h1 style={{ margin: 0, fontSize: 22, fontWeight: 300, color: "var(--atlas-fg)", letterSpacing: "-0.02em" }}>
              Parking Lot
            </h1>
            <p style={{ margin: "5px 0 0", fontSize: 12, color: "var(--atlas-muted)", opacity: 0.55, fontStyle: "italic", fontFamily: "var(--app-font-sans)" }}>
              {parkedCount > 0
                ? `${parkedCount} item${parkedCount === 1 ? "" : "s"} waiting — tap Resume to go back to any thread.`
                : "When Atlas delivers a thought you're not ready to commit, park it here."}
            </p>
          </div>

          {/* Content */}
          {!activeProjectId ? (
            <Empty message="No projects yet. Start one from home." />
          ) : isLoading ? (
            <Loading />
          ) : entries.length === 0 ? (
            <EmptyParked />
          ) : (
            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(min(100%, 320px), 1fr))", gap: 12 }}>
              {entries.map(entry => (
                <ParkingCard
                  key={entry.id}
                  entry={entry}
                  busy={busyId === entry.id}
                  projectName={projects.find(p => p.id === entry.projectId)?.name}
                  onResume={() => handleResume(entry)}
                  onCommit={() => handleCommit(entry.id)}
                  onDelete={() => handleDelete(entry.id)}
                />
              ))}
            </div>
          )}
        </div>
      </div>

      {/* Footer audit line (from original Atlas) */}
      <div style={{
        position: "fixed", bottom: 0, left: 0, right: 0,
        height: 2, background: entries.length > 0 ? "rgba(201,162,76,0.45)" : "rgba(120,113,108,0.2)",
        zIndex: 50, transition: "background 600ms ease",
      }} />
    </div>
  );
}

// ── Types ─────────────────────────────────────────────────────────────────────
type Entry = {
  id: number;
  title: string;
  summary?: string | null;
  mode?: string | null;
  verb?: string | null;
  status?: string | null;
  createdAt: string;
  projectId?: number;
};

// ── ParkingCard ───────────────────────────────────────────────────────────────
// "active posture" card — gold gradient border, three actions: Resume, Commit, Delete
function ParkingCard({
  entry,
  busy,
  projectName,
  onResume,
  onCommit,
  onDelete,
}: {
  entry: Entry;
  busy: boolean;
  projectName?: string;
  onResume: () => void;
  onCommit: () => void;
  onDelete: () => void;
}) {
  const [confirmDelete, setConfirmDelete] = useState(false);

  return (
    // Outer wrapper = 0.5px padding that shows the gradient border
    <div style={{
      padding: "0.5px",
      borderRadius: 8,
      background: "linear-gradient(135deg, rgba(201,162,76,0.4) 0%, rgba(201,162,76,0.12) 45%, transparent 80%)",
      boxShadow: "0 4px 20px -10px rgba(0,0,0,0.45)",
    }}>
      {/* Inner card */}
      <div style={{
        background: "var(--atlas-surface)",
        borderRadius: 7.5,
        overflow: "hidden",
        display: "flex",
        flexDirection: "column",
      }}>
        {/* Card body */}
        <div style={{ padding: "14px 16px 12px" }}>
          {/* Top meta row */}
          <div style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: 8, flexWrap: "wrap" }}>
            {entry.mode && (
              <span style={{
                fontSize: 9, fontFamily: "var(--app-font-mono)", letterSpacing: "0.1em",
                textTransform: "uppercase",
                background: "rgba(201,162,76,0.08)",
                border: "0.5px solid rgba(201,162,76,0.2)",
                color: "rgba(201,162,76,0.75)",
                padding: "1.5px 7px", borderRadius: 10,
              }}>
                {entry.mode}
              </span>
            )}
            {entry.status === "draft" && (
              <span style={{
                fontSize: 9, fontFamily: "var(--app-font-mono)", letterSpacing: "0.1em",
                textTransform: "uppercase",
                background: "rgba(99,102,241,0.08)",
                border: "0.5px solid rgba(99,102,241,0.3)",
                color: "rgba(129,140,248,0.85)",
                padding: "1.5px 7px", borderRadius: 10,
              }}>
                REOPENED
              </span>
            )}
            {projectName && (
              <span style={{
                fontSize: 9, fontFamily: "var(--app-font-mono)", letterSpacing: "0.06em",
                color: "rgba(120,113,108,0.5)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap",
                marginLeft: "auto",
              }}>
                {projectName}
              </span>
            )}
          </div>

          {/* Title */}
          <div style={{ fontSize: 13.5, fontWeight: 500, color: "var(--atlas-fg)", lineHeight: 1.45, marginBottom: entry.summary ? 8 : 0 }}>
            {entry.title}
          </div>

          {/* Summary */}
          {entry.summary && (
            <p style={{ margin: 0, fontSize: 12, color: "var(--atlas-muted)", opacity: 0.65, lineHeight: 1.6, fontStyle: "italic" }}>
              {entry.summary.length > 200 ? entry.summary.slice(0, 200) + "…" : entry.summary}
            </p>
          )}
        </div>

        {/* Divider */}
        <div style={{ height: 1, background: "linear-gradient(to right, transparent, rgba(201,162,76,0.15), transparent)" }} />

        {/* Action footer */}
        <div style={{ padding: "10px 14px", display: "flex", alignItems: "center", gap: 6 }}>
          {/* Resume — navigate back to source session */}
          <button
            onClick={onResume}
            disabled={busy}
            title="Go back to this project's workspace"
            style={{
              padding: "5px 11px", borderRadius: 5, fontSize: 10,
              fontFamily: "var(--app-font-mono)", letterSpacing: "0.1em",
              textTransform: "uppercase",
              background: "transparent",
              border: "0.5px solid rgba(201,162,76,0.35)",
              color: "rgba(201,162,76,0.85)",
              cursor: busy ? "default" : "pointer",
              opacity: busy ? 0.5 : 1,
              display: "flex", alignItems: "center", gap: 5,
              transition: "all 140ms ease",
            }}
            onMouseEnter={(e) => { if (!busy) { e.currentTarget.style.background = "rgba(201,162,76,0.08)"; e.currentTarget.style.borderColor = "rgba(201,162,76,0.6)"; } }}
            onMouseLeave={(e) => { e.currentTarget.style.background = "transparent"; e.currentTarget.style.borderColor = "rgba(201,162,76,0.35)"; }}
          >
            <svg width="10" height="10" viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
              <path d="M2 6h8M6 2l4 4-4 4" />
            </svg>
            Resume
          </button>

          {/* Commit to ledger */}
          <button
            onClick={onCommit}
            disabled={busy}
            style={{
              padding: "5.5px 12px", borderRadius: 5, fontSize: 10,
              fontFamily: "var(--app-font-mono)", letterSpacing: "0.1em",
              textTransform: "uppercase", fontWeight: 600,
              background: "linear-gradient(180deg, var(--atlas-gold) 0%, color-mix(in oklab, var(--atlas-gold) 78%, #6a4a18) 100%)",
              border: "0.5px solid rgba(201,162,76,0.6)",
              color: "var(--atlas-bg)",
              cursor: busy ? "default" : "pointer",
              opacity: busy ? 0.5 : 1,
              boxShadow: "0 0 10px -3px rgba(201,162,76,0.35)",
              transition: "opacity 140ms ease",
            }}
          >
            {busy ? "…" : "Commit"}
          </button>

          {/* Delete — with confirm step */}
          <div style={{ marginLeft: "auto", display: "flex", alignItems: "center", gap: 5 }}>
            {confirmDelete ? (
              <>
                <span style={{ fontSize: 10, color: "var(--atlas-muted)", fontFamily: "var(--app-font-mono)", opacity: 0.55 }}>Sure?</span>
                <button onClick={onDelete} disabled={busy} style={dangerBtn}>Yes</button>
                <button onClick={() => setConfirmDelete(false)} style={ghostBtn}>No</button>
              </>
            ) : (
              <button onClick={() => setConfirmDelete(true)} style={ghostBtn} title="Delete this entry">
                <svg width="11" height="11" viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M2 3.5h10M5.5 3.5V2.5a.5.5 0 01.5-.5h2a.5.5 0 01.5.5v1M11.5 3.5l-.6 7.2a1 1 0 01-1 .8H4.1a1 1 0 01-1-.8L2.5 3.5" />
                </svg>
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

const ghostBtn: React.CSSProperties = {
  background: "transparent", border: "none",
  color: "var(--atlas-muted)", opacity: 0.4,
  cursor: "pointer", padding: "4px 6px", borderRadius: 4,
  fontSize: 10, fontFamily: "var(--app-font-mono)", letterSpacing: "0.08em",
  textTransform: "uppercase", display: "flex", alignItems: "center",
};

const dangerBtn: React.CSSProperties = {
  background: "transparent",
  border: "1px solid rgba(220,80,60,0.4)",
  color: "rgb(220,80,60)",
  cursor: "pointer", padding: "3px 9px", borderRadius: 4,
  fontSize: 10, fontFamily: "var(--app-font-mono)", letterSpacing: "0.08em",
  textTransform: "uppercase",
};

// ── Empty states ──────────────────────────────────────────────────────────────
function EmptyParked() {
  return (
    <div style={{ padding: "60px 24px", textAlign: "center" }}>
      <div style={{
        width: 44, height: 44, borderRadius: 8,
        border: "1px solid var(--atlas-border)",
        display: "flex", alignItems: "center", justifyContent: "center",
        margin: "0 auto 16px",
        background: "rgba(201,162,76,0.04)",
      }}>
        <div style={{ width: 8, height: 8, borderRadius: 2, background: "rgba(201,162,76,0.5)" }} />
      </div>
      <p style={{ margin: 0, fontSize: 13, fontWeight: 500, color: "var(--atlas-fg)", opacity: 0.5 }}>Nothing parked.</p>
      <p style={{ margin: "6px 0 0", fontSize: 12, color: "var(--atlas-muted)", fontFamily: "var(--app-font-mono)", opacity: 0.4, maxWidth: 280, marginLeft: "auto", marginRight: "auto" }}>
        Tap the tray icon on any Atlas response to save a thought without breaking your flow.
      </p>
    </div>
  );
}

function Empty({ message }: { message: string }) {
  return (
    <div style={{
      padding: "48px 24px", textAlign: "center",
      color: "var(--atlas-muted)", fontSize: 13, fontStyle: "italic",
      opacity: 0.5, fontFamily: "var(--app-font-sans)",
    }}>
      {message}
    </div>
  );
}

function Loading() {
  return (
    <div style={{ display: "flex", justifyContent: "center", padding: "48px 0" }}>
      <LoadingSpinner size="md" color="atlas" />
    </div>
  );
}

import type React from "react";
