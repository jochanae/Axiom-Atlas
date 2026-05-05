import { useState } from "react";
import { useLocation } from "wouter";
import { LoadingSpinner } from "../components/ui/loading-spinner";
import { EntryCard } from "../components/EntryCard";
import { EditEntryDialog } from "../components/EditEntryDialog";
import {
  useListProjects,
  useListEntries,
  useUpdateEntry,
  useDeleteEntry,
  getListEntriesQueryKey,
} from "@workspace/api-client-react";
import type { Entry } from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";

// ── Architectural note (locked rule from original Atlas) ──────────────────────
// "Ledger and Parking Lot are the same object, rendered differently based on
//  state. Moving between them is NOT duplication. It is a status change on
//  the same object."
// Resume = navigate back to the source project workspace (not a status change).
// Commit = status flip from 'parked' → 'committed' on the same row.

export default function ParkingLot() {
  const [, setLocation] = useLocation();
  const qc = useQueryClient();

  const { data: projects = [] } = useListProjects();
  const [selectedProjectId, setSelectedProjectId] = useState<number | null>(null);
  const [busyId, setBusyId] = useState<number | null>(null);
  const [editEntry, setEditEntry] = useState<Entry | null>(null);
  const [editSaving, setEditSaving] = useState(false);

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

  // Merge + sort newest first
  const entries: Entry[] = [...parkedEntries, ...draftEntries].sort(
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

  // Resume: navigate back to source project workspace
  const handleResume = (entry: Entry) => {
    if (entry.projectId) {
      setLocation(`/project/${entry.projectId}`);
    } else {
      setLocation("/");
    }
  };

  // Commit: status flip parked → committed (locked_at stamped by DB)
  const handleCommit = (entry: Entry) => {
    setBusyId(entry.id);
    updateEntry.mutate(
      { id: entry.id, data: { status: "committed", severity: "committed" } },
      { onSettled: () => setBusyId(null) }
    );
  };

  // Delete: remove parked/draft entry
  const handleDelete = (entry: Entry) => {
    setBusyId(entry.id);
    deleteEntry.mutate({ id: entry.id }, { onSettled: () => setBusyId(null) });
  };

  // Edit: patch details, buildId, touched, costOfLesson
  const handleEditSave = async (id: number, data: { details: string | null; buildId: string | null; touched: string[] | null; costOfLesson: number | null }) => {
    setEditSaving(true);
    try {
      await updateEntry.mutateAsync({ id, data });
    } finally {
      setEditSaving(false);
    }
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
          style={{
            background: "transparent", border: "none", cursor: "pointer",
            display: "flex", alignItems: "center", gap: 6,
            padding: "4px 0", color: "var(--atlas-muted)", flexShrink: 0,
          }}
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
            <EmptyState message="No projects yet. Start one from home." />
          ) : isLoading ? (
            <div style={{ display: "flex", justifyContent: "center", padding: "48px 0" }}>
              <LoadingSpinner size="md" color="atlas" />
            </div>
          ) : entries.length === 0 ? (
            <EmptyParked />
          ) : (
            <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
              {entries.map(entry => (
                <EntryCard
                  key={entry.id}
                  entry={entry}
                  busy={busyId === entry.id}
                  onResume={() => handleResume(entry)}
                  onCommit={() => handleCommit(entry)}
                  onDelete={() => handleDelete(entry)}
                  onEdit={() => setEditEntry(entry)}
                />
              ))}
            </div>
          )}
        </div>
      </div>

      {/* Footer audit line */}
      <div style={{
        position: "fixed", bottom: 0, left: 0, right: 0,
        height: 2,
        background: entries.length > 0 ? "rgba(201,162,76,0.45)" : "rgba(120,113,108,0.2)",
        zIndex: 50,
        transition: "background 600ms ease",
      }} />

      {/* Edit dialog */}
      <EditEntryDialog
        open={editEntry !== null}
        onClose={() => setEditEntry(null)}
        entry={editEntry}
        onSave={handleEditSave}
        saving={editSaving}
      />
    </div>
  );
}

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
      <p style={{ margin: 0, fontSize: 13, fontWeight: 500, color: "var(--atlas-fg)", opacity: 0.5 }}>
        Nothing parked.
      </p>
      <p style={{ margin: "6px 0 0", fontSize: 12, color: "var(--atlas-muted)", fontFamily: "var(--app-font-mono)", opacity: 0.4, maxWidth: 280, marginInline: "auto" }}>
        Tap the tray icon on any Atlas response to save a thought without breaking your flow.
      </p>
    </div>
  );
}

function EmptyState({ message }: { message: string }) {
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
