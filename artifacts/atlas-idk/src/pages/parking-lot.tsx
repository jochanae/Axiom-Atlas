import { useRef, useState } from "react";
import { updateEntry, deleteEntry, Project } from "@workspace/api-client-react";
import { useEntryReferrer } from "@/hooks/useEntryReferrer";
import type React from "react";
import { useLocation } from "wouter";
import { LoadingSpinner } from "../components/ui/loading-spinner";
import { ParkingLotDetailPanel } from "../components/ParkingLotDetailPanel";
import {
  useListProjects,
  useListEntries,
  useUpdateEntry,
  useDeleteEntry,
  useCreateEntry,
  getListEntriesQueryKey,
} from "@workspace/api-client-react";
import type { Entry } from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import { usePullToRefresh } from "@/hooks/usePullToRefresh";
import { CaptureBar } from "@/components/CaptureBar";
import { buildParkedEntryPayload } from "@/lib/parking";

// ── Architectural note (locked rule from original Atlas) ──────────────────────
// "Ledger and Parking Lot are the same object, rendered differently based on
//  state. Moving between them is NOT duplication. It is a status change on
//  the same object."
// Resume = navigate back to the source project workspace (not a status change).
// Commit = status flip from 'parked' → 'committed' on the same row.

export default function ParkingLot() {
  const [, setLocation] = useLocation();
  const { goBack } = useEntryReferrer();

  const queryClient = useQueryClient();
  const ptrContainerRef = useRef<HTMLDivElement>(null);
  const {
    pulling: ptr_pulling,
    distance: ptr_distance,
    refreshing: ptr_refreshing,
  } = usePullToRefresh(
    async () => {
      await queryClient.invalidateQueries();
    },
    true,
    ptrContainerRef,
  );

  const { data: projects = [] } = useListProjects();
  const [selectedProjectId, setSelectedProjectId] = useState<number | null>(() => {
    try {
      const p = new URLSearchParams(window.location.search).get("project");
      return p ? parseInt(p, 10) : null;
    } catch { return null; }
  });
  const [busyId, setBusyId] = useState<number | null>(null);
  const [detailEntry, setDetailEntry] = useState<Entry | null>(null);
  const [noteOpenId, setNoteOpenId] = useState<number | null>(null);
  const [noteDrafts, setNoteDrafts] = useState<Record<number, string>>({});

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
  // Load committed entries so we can resolve supersedesId → original title
  const { data: committedEntries = [], isLoading: loadingCommitted } = useListEntries(
    queryProjectId,
    { status: "committed" },
    { query: { queryKey: ["entries", queryProjectId, "committed"], enabled } }
  );
  const isLoading = loadingParked || loadingDraft || loadingCommitted;

  // Merge + sort newest first
  const entries: Entry[] = [...parkedEntries, ...draftEntries].sort(
    (a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()
  );
  const activeDetailEntry = detailEntry ? entries.find(e => e.id === detailEntry.id) ?? detailEntry : null;

  const invalidateAll = () => {
    projects.forEach(p => {
      queryClient.invalidateQueries({ queryKey: getListEntriesQueryKey(p.id) });
      queryClient.invalidateQueries({ queryKey: ["entries", p.id, "parked"] });
      queryClient.invalidateQueries({ queryKey: ["entries", p.id, "draft"] });
      queryClient.invalidateQueries({ queryKey: ["entries", p.id, "committed"] });
    });
    queryClient.invalidateQueries({ queryKey: ["entries", queryProjectId, "parked"] });
    queryClient.invalidateQueries({ queryKey: ["entries", queryProjectId, "draft"] });
    queryClient.invalidateQueries({ queryKey: ["entries", queryProjectId, "committed"] });
  };

  const updateEntry = useUpdateEntry({ mutation: { onSuccess: invalidateAll } });
  const deleteEntry = useDeleteEntry({ mutation: { onSuccess: invalidateAll } });
  const createEntry = useCreateEntry({ mutation: { onSuccess: invalidateAll } });

  const handleCapture = (content: string) => {
    if (!activeProjectId) return;
    createEntry.mutate({
      projectId: activeProjectId,
      data: buildParkedEntryPayload(content),
    });
  };

  // Resume: navigate back to source project workspace
  const handleResume = (entry: Entry) => {
    if (entry.projectId) {
      setLocation(`/project/${entry.projectId}`);
    } else {
      setLocation("/home");
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

  const handleNoteBlur = async (entry: Entry) => {
    const noteText = noteDrafts[entry.id] ?? "";
    setNoteOpenId(null);
    await updateEntry.mutateAsync({ id: entry.id, data: { details: noteText.trim() || null } }).catch(() => {});
  };

  const handlePanelCommit = async (entry: Entry) => {
    setBusyId(entry.id);
    try {
      await updateEntry.mutateAsync({ id: entry.id, data: { status: "committed", severity: "committed" } });
      setDetailEntry(null);
    } finally {
      setBusyId(null);
    }
  };

  const handlePanelDelete = async (entry: Entry) => {
    setBusyId(entry.id);
    try {
      await deleteEntry.mutateAsync({ id: entry.id });
      setDetailEntry(null);
    } finally {
      setBusyId(null);
    }
  };

  const parkedCount = entries.length;

  return (
    <div
      ref={ptrContainerRef}
      style={{
        height: "100dvh",
        overflowY: "auto",
        background: "transparent",
        display: "flex",
        flexDirection: "column",
      }}
    >
      {(ptr_pulling || ptr_refreshing) && (
        <div
          style={{
            position: "fixed",
            top: 0,
            left: 0,
            right: 0,
            zIndex: 100,
            display: "flex",
            justifyContent: "center",
            alignItems: "flex-end",
            height: Math.min(ptr_distance, 72) + 16,
            pointerEvents: "none",
          }}
        >
          <div
            style={{
              width: 26,
              height: 26,
              borderRadius: "50%",
              border: "1.5px solid rgba(201,162,76,0.25)",
              borderTopColor:
                ptr_distance >= 96 || ptr_refreshing
                  ? "var(--atlas-gold)"
                  : "rgba(201,162,76,0.5)",
              opacity: Math.min(ptr_distance / 60, 1),
              animation: ptr_refreshing ? "ptr-spin 700ms linear infinite" : "none",
              transform: ptr_refreshing
                ? "none"
                : `rotate(${Math.min((ptr_distance / 96) * 270, 270)}deg)`,
            }}
          />
        </div>
      )}
      <style>{`@keyframes ptr-spin { to { transform: rotate(360deg); } }`}</style>
      {/* Header */}
      <div style={{
        position: "sticky", top: 0, zIndex: 50,
        background: "var(--atlas-surface)",
        backdropFilter: "blur(14px)",
        borderBottom: "1px solid var(--atlas-border)",
        padding: "0 20px",
        height: 50, display: "flex", alignItems: "center", gap: 10,
      }}>
        {/* Back */}
        <button
          type="button"
          onClick={() => goBack()}

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

          {/* Capture bar — park a thought directly from this page */}
          {activeProjectId && (
            <div style={{ marginBottom: 20 }}>
              <CaptureBar
                context="modal"
                destinations={["park"]}
                defaultDestination="park"
                projectId={String(activeProjectId)}
                onPark={handleCapture}
              />
            </div>
          )}

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
                <ParkingLotRow
                  key={entry.id}
                  entry={entry}
                  busy={busyId === entry.id}
                  noteOpen={noteOpenId === entry.id}
                  noteValue={noteDrafts[entry.id] ?? entry.details ?? ""}
                  onOpen={() => setDetailEntry(entry)}
                  onResume={() => handleResume(entry)}
                  onCommit={() => handleCommit(entry)}
                  onDelete={() => handleDelete(entry)}
                  onNoteOpen={() => {
                    setNoteDrafts(prev => ({ ...prev, [entry.id]: prev[entry.id] ?? entry.details ?? "" }));
                    setNoteOpenId(entry.id);
                  }}
                  onNoteChange={(value) => setNoteDrafts(prev => ({ ...prev, [entry.id]: value }))}
                  onNoteBlur={() => void handleNoteBlur(entry)}
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

      {activeDetailEntry && activeProjectId && (
        <ParkingLotDetailPanel
          entry={activeDetailEntry}
          projectId={activeProjectId}
          onClose={() => setDetailEntry(null)}
          onCommit={() => void handlePanelCommit(activeDetailEntry)}
          onDelete={() => void handlePanelDelete(activeDetailEntry)}
        />
      )}
    </div>
  );
}

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

function ParkingLotRow({
  entry,
  busy,
  noteOpen,
  noteValue,
  onOpen,
  onResume,
  onCommit,
  onDelete,
  onNoteOpen,
  onNoteChange,
  onNoteBlur,
}: {
  entry: Entry;
  busy: boolean;
  noteOpen: boolean;
  noteValue: string;
  onOpen: () => void;
  onResume: () => void;
  onCommit: () => void;
  onDelete: () => void;
  onNoteOpen: () => void;
  onNoteChange: (value: string) => void;
  onNoteBlur: () => void;
}) {
  const summary = entry.summary || entry.title;
  return (
    <article
      onClick={onOpen}
      style={{
        borderRadius: 8,
        padding: "0.5px",
        background: "linear-gradient(135deg, color-mix(in oklab, var(--atlas-gold) 24%, transparent), color-mix(in oklab, var(--atlas-border) 70%, transparent), transparent)",
        boxShadow: "0 8px 24px -18px var(--atlas-gold)",
        cursor: "pointer",
      }}
    >
      <div style={{ borderRadius: 7.5, background: "var(--atlas-surface)", overflow: "hidden" }}>
        <div style={{ padding: "13px 14px 10px", display: "flex", alignItems: "flex-start", gap: 10 }}>
          <span
            style={{
              marginTop: 5,
              width: 8,
              height: 8,
              borderRadius: "50%",
              background: entry.severity === "blocker" ? "var(--atlas-ember)" : "var(--atlas-gold)",
              flexShrink: 0,
              boxShadow: "0 0 0 3px color-mix(in oklab, currentColor 12%, transparent)",
            }}
          />
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 4 }}>
              <h3 style={{ margin: 0, flex: 1, color: "var(--atlas-fg)", fontSize: 13.5, lineHeight: 1.35, fontWeight: 650, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                {entry.title}
              </h3>
              <button
                type="button"
                onClick={(e) => { e.stopPropagation(); onNoteOpen(); }}
                style={{
                  padding: "2px 7px",
                  borderRadius: 4,
                  border: "1px solid var(--atlas-border)",
                  background: entry.details ? "color-mix(in oklab, var(--atlas-gold) 10%, transparent)" : "transparent",
                  color: entry.details ? "var(--atlas-gold)" : "var(--atlas-muted)",
                  cursor: "pointer",
                  fontFamily: "var(--app-font-mono)",
                  fontSize: 8.5,
                  letterSpacing: "0.12em",
                }}
              >
                NOTE
              </button>
            </div>
            <div style={{ fontFamily: "var(--app-font-mono)", fontSize: 10, letterSpacing: "0.08em", color: "var(--atlas-muted)", opacity: 0.55, textTransform: "uppercase", marginBottom: 7 }}>
              chat message · {timeAgo(entry.createdAt)}
            </div>
            <p style={{ margin: 0, color: "var(--atlas-muted)", fontSize: 12, lineHeight: 1.55 }}>
              {summary}
            </p>
          </div>
        </div>

        {noteOpen && (
          <div onClick={(e) => e.stopPropagation()} style={{ padding: "0 14px 12px 32px" }}>
            <input
              autoFocus
              value={noteValue}
              onChange={(e) => onNoteChange(e.target.value)}
              onBlur={onNoteBlur}
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  e.currentTarget.blur();
                }
              }}
              placeholder="Add a short note..."
              style={{
                width: "100%",
                boxSizing: "border-box",
                padding: "8px 10px",
                borderRadius: 7,
                background: "var(--atlas-bg)",
                border: "1px solid var(--atlas-border)",
                color: "var(--atlas-fg)",
                outline: "none",
                fontSize: 12,
                fontFamily: "var(--app-font-sans)",
              }}
            />
          </div>
        )}

        <div style={{ height: 1, background: "linear-gradient(to right, transparent, var(--atlas-border), transparent)" }} />

        <footer style={{ display: "flex", alignItems: "center", justifyContent: "flex-end", gap: 7, padding: "8px 14px" }}>
          <ParkingLotButton disabled={busy} onClick={onResume}>Resume</ParkingLotButton>
          <ParkingLotButton disabled={busy} onClick={onDelete} tone="danger">Delete</ParkingLotButton>
          <ParkingLotButton disabled={busy} onClick={onCommit} tone="gold">{busy ? "Committing..." : "Commit"}</ParkingLotButton>
        </footer>
      </div>
    </article>
  );
}

function ParkingLotButton({
  children,
  onClick,
  disabled,
  tone = "muted",
}: {
  children: React.ReactNode;
  onClick: () => void;
  disabled?: boolean;
  tone?: "muted" | "danger" | "gold";
}) {
  const color = tone === "gold"
    ? "var(--atlas-gold)"
    : tone === "danger" ? "var(--atlas-ember)" : "var(--atlas-muted)";
  return (
    <button
      type="button"
      disabled={disabled}
      onClick={(e) => { e.stopPropagation(); onClick(); }}
      style={{
        padding: "5px 10px",
        borderRadius: 5,
        background: tone === "gold" ? "var(--atlas-gold)" : "transparent",
        border: `1px solid ${tone === "gold" ? "var(--atlas-gold)" : "var(--atlas-border)"}`,
        color: tone === "gold" ? "var(--atlas-bg)" : color,
        cursor: disabled ? "not-allowed" : "pointer",
        opacity: disabled ? 0.45 : 1,
        fontFamily: "var(--app-font-mono)",
        fontSize: 9.5,
        letterSpacing: "0.1em",
        textTransform: "uppercase",
      }}
    >
      {children}
    </button>
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
