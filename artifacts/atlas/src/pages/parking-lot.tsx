import { useState } from "react";
import { useLocation } from "wouter";
import {
  useListProjects,
  useListEntries,
  useUpdateEntry,
  useDeleteEntry,
  getListEntriesQueryKey,
} from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";

export default function ParkingLot() {
  const [, setLocation] = useLocation();
  const qc = useQueryClient();

  const { data: projects = [] } = useListProjects();
  const [selectedProjectId, setSelectedProjectId] = useState<number | null>(null);

  const activeProjectId = selectedProjectId ?? projects[0]?.id ?? null;

  const { data: entries = [], isLoading } = useListEntries(
    activeProjectId ?? 0,
    { status: "parked" },
    {
      query: {
        queryKey: ["entries", activeProjectId, "parked"],
        enabled: !!activeProjectId,
      },
    }
  );

  const updateEntry = useUpdateEntry({
    mutation: {
      onSuccess: () => {
        if (activeProjectId) {
          qc.invalidateQueries({ queryKey: getListEntriesQueryKey(activeProjectId) });
        }
      },
    },
  });

  const deleteEntry = useDeleteEntry({
    mutation: {
      onSuccess: () => {
        if (activeProjectId) {
          qc.invalidateQueries({ queryKey: getListEntriesQueryKey(activeProjectId) });
        }
      },
    },
  });

  const handleCommit = (id: number) => {
    updateEntry.mutate({ id, data: { status: "committed" } });
  };

  const handleResume = (id: number) => {
    updateEntry.mutate({ id, data: { status: "draft" } });
  };

  const handleDelete = (id: number) => {
    deleteEntry.mutate({ id });
  };

  return (
    <div style={{
      height: "100vh",
      background: "var(--atlas-bg)",
      display: "flex",
      flexDirection: "column",
      overflowY: "auto",
    }}>
      {/* Header */}
      <div style={{
        position: "sticky", top: 0, zIndex: 50,
        background: "var(--atlas-bg)",
        borderBottom: "1px solid var(--atlas-border)",
        padding: "0 24px",
        height: 50, display: "flex", alignItems: "center", gap: 10,
      }}>
        {/* Back */}
        <button
          type="button"
          onClick={() => setLocation("/")}
          style={{ background: "transparent", border: "none", cursor: "pointer", display: "flex", alignItems: "center", padding: "4px 0" }}
        >
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="var(--atlas-muted)" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
            <path d="M19 12H5M12 5l-7 7 7 7" />
          </svg>
        </button>

        {/* Breadcrumb */}
        <div style={{ display: "flex", alignItems: "center", gap: 6, flex: 1 }}>
          <span
            style={{ fontSize: 11, fontFamily: "var(--app-font-mono)", color: "var(--atlas-muted)", cursor: "pointer", opacity: 0.55, letterSpacing: "0.04em" }}
            onClick={() => setLocation("/")}
          >
            atlas
          </span>
          <span style={{ color: "var(--atlas-border)", fontSize: 11 }}>/</span>
          <span style={{ fontSize: 11, fontFamily: "var(--app-font-mono)", color: "var(--atlas-gold)", letterSpacing: "0.04em" }}>
            parking lot
          </span>
        </div>

        {/* Project selector */}
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
            }}
          >
            {projects.map(p => (
              <option key={p.id} value={p.id}>{p.name}</option>
            ))}
          </select>
        )}
      </div>

      {/* Body */}
      <div style={{ flex: 1, padding: "32px 24px 120px", display: "flex", justifyContent: "center" }}>
        <div style={{ width: "100%", maxWidth: 560 }}>

          {/* Page title */}
          <div style={{ marginBottom: 28 }}>
            <h1 style={{ margin: 0, fontSize: 22, fontWeight: 300, color: "var(--atlas-fg)", letterSpacing: "-0.02em" }}>
              Parking Lot
            </h1>
            <p style={{ margin: "6px 0 0", fontSize: 12.5, color: "var(--atlas-muted)", opacity: 0.65, fontStyle: "italic" }}>
              Ideas waiting for their moment.
            </p>
          </div>

          {/* Content */}
          {!activeProjectId ? (
            <Empty message="No projects yet. Start one from home." />
          ) : isLoading ? (
            <Loading />
          ) : entries.length === 0 ? (
            <Empty message="Nothing parked in this project. Good momentum." />
          ) : (
            <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
              {entries.map(entry => (
                <ParkingCard
                  key={entry.id}
                  entry={entry}
                  onResume={() => handleResume(entry.id)}
                  onCommit={() => handleCommit(entry.id)}
                  onDelete={() => handleDelete(entry.id)}
                />
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

type Entry = {
  id: number;
  title: string;
  summary?: string | null;
  mode?: string | null;
  createdAt: string;
};

function ParkingCard({
  entry,
  onResume,
  onCommit,
  onDelete,
}: {
  entry: Entry;
  onResume: () => void;
  onCommit: () => void;
  onDelete: () => void;
}) {
  const [confirmDelete, setConfirmDelete] = useState(false);

  return (
    <div style={{
      background: "var(--atlas-surface)",
      border: "1px solid var(--atlas-border)",
      borderRadius: 10,
      padding: "16px 18px",
    }}>
      {/* Mode tag */}
      {entry.mode && (
        <div style={{ marginBottom: 8 }}>
          <span style={{
            fontSize: 9, fontFamily: "var(--app-font-mono)", letterSpacing: "0.12em",
            textTransform: "uppercase", color: "var(--atlas-gold)", opacity: 0.7,
          }}>
            {entry.mode}
          </span>
        </div>
      )}

      <div style={{ fontSize: 14, fontWeight: 500, color: "var(--atlas-fg)", lineHeight: 1.4, marginBottom: entry.summary ? 8 : 14 }}>
        {entry.title}
      </div>

      {entry.summary && (
        <p style={{ margin: "0 0 14px", fontSize: 12.5, color: "var(--atlas-muted)", opacity: 0.7, lineHeight: 1.55 }}>
          {entry.summary}
        </p>
      )}

      {/* Action row */}
      <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
        <ActionBtn label="RESUME" variant="outline" onClick={onResume} />
        <ActionBtn label="COMMIT" variant="gold" onClick={onCommit} />
        {confirmDelete ? (
          <>
            <span style={{ fontSize: 11, color: "var(--atlas-muted)", fontFamily: "var(--app-font-mono)", marginLeft: 4, opacity: 0.65 }}>
              Sure?
            </span>
            <ActionBtn label="YES" variant="danger" onClick={onDelete} />
            <ActionBtn label="NO" variant="outline" onClick={() => setConfirmDelete(false)} />
          </>
        ) : (
          <ActionBtn label="DELETE" variant="ghost" onClick={() => setConfirmDelete(true)} />
        )}
      </div>
    </div>
  );
}

function ActionBtn({
  label,
  variant,
  onClick,
}: {
  label: string;
  variant: "outline" | "gold" | "ghost" | "danger";
  onClick: () => void;
}) {
  const styles: Record<string, React.CSSProperties> = {
    outline: {
      background: "transparent",
      border: "1px solid var(--atlas-gold-border)",
      color: "var(--atlas-fg)",
    },
    gold: {
      background: "var(--atlas-gold)",
      border: "1px solid var(--atlas-gold)",
      color: "var(--atlas-bg)",
      fontWeight: 600,
    },
    ghost: {
      background: "transparent",
      border: "none",
      color: "var(--atlas-muted)",
      opacity: 0.5,
    },
    danger: {
      background: "transparent",
      border: "1px solid rgba(220,80,60,0.4)",
      color: "rgb(220,80,60)",
    },
  };

  return (
    <button
      type="button"
      onClick={onClick}
      style={{
        padding: "5px 12px",
        borderRadius: 6,
        fontSize: 10,
        fontFamily: "var(--app-font-mono)",
        letterSpacing: "0.08em",
        cursor: "pointer",
        transition: "opacity 140ms ease",
        ...styles[variant],
      }}
      onMouseEnter={(e) => { e.currentTarget.style.opacity = "0.8"; }}
      onMouseLeave={(e) => { e.currentTarget.style.opacity = "1"; }}
    >
      {label}
    </button>
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
    <div style={{ display: "flex", gap: 5, justifyContent: "center", padding: "48px 0" }}>
      {[0, 1, 2].map(i => (
        <div key={i} style={{
          width: 5, height: 5, borderRadius: "50%",
          background: "var(--atlas-gold)", opacity: 0.4,
          animation: `thinking-pulse 1.2s ease-in-out ${i * 200}ms infinite`,
        }} />
      ))}
    </div>
  );
}
