import { useState, useEffect, useCallback } from "react";
import { useLocation } from "wouter";
import type { CSSProperties } from "react";
import { LoadingSpinner } from "../components/ui/loading-spinner";

const mono: CSSProperties = { fontFamily: "var(--app-font-mono)" };
const sans: CSSProperties = { fontFamily: "var(--app-font-sans)" };

interface VaultSave {
  id: number;
  projectId: number | null;
  projectName: string;
  title: string;
  content: string;
  entryCount: number;
  tags: string[] | null;
  createdAt: string;
}

function formatDate(iso: string): string {
  try {
    const d = new Date(iso);
    return (
      d.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" }) +
      " · " +
      d.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" })
    );
  } catch {
    return iso;
  }
}

function getTagColor(tag: string): CSSProperties {
  const map: Record<string, string> = {
    STRUCTURE: "rgba(99,165,255,0.75)",
    AESTHETIC: "rgba(192,132,252,0.75)",
    LOGIC: "rgba(52,211,153,0.75)",
    GENERAL: "rgba(201,162,76,0.75)",
  };
  return { color: map[tag.toUpperCase()] ?? "rgba(201,162,76,0.75)" };
}

export default function Vault() {
  const [, setLocation] = useLocation();
  const [items, setItems] = useState<VaultSave[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [copiedId, setCopiedId] = useState<number | null>(null);
  const [confirmDeleteId, setConfirmDeleteId] = useState<number | null>(null);
  const [deletingId, setDeletingId] = useState<number | null>(null);
  const [toast, setToast] = useState<string | null>(null);
  const [expandedId, setExpandedId] = useState<number | null>(null);

  const showToast = (msg: string) => {
    setToast(msg);
    setTimeout(() => setToast(null), 2200);
  };

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch("/api/vault");
      if (res.ok) {
        const data = await res.json();
        setItems(data);
      }
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  const handleCopy = async (item: VaultSave) => {
    try {
      await navigator.clipboard.writeText(item.content);
    } catch {
      const ta = document.createElement("textarea");
      ta.value = item.content;
      document.body.appendChild(ta);
      ta.select();
      document.execCommand("copy");
      document.body.removeChild(ta);
    }
    setCopiedId(item.id);
    showToast("Copied to clipboard");
    setTimeout(() => setCopiedId(null), 2000);
  };

  const handleGoToProject = (item: VaultSave) => {
    if (item.projectId) {
      setLocation(`/project/${item.projectId}`);
    }
  };

  const handleDelete = async (id: number) => {
    setDeletingId(id);
    try {
      const res = await fetch(`/api/vault/${id}`, { method: "DELETE" });
      if (res.ok) {
        setItems((prev) => prev.filter((i) => i.id !== id));
        showToast("Removed from Vault");
      }
    } finally {
      setDeletingId(null);
      setConfirmDeleteId(null);
    }
  };

  const filtered = items.filter((item) => {
    if (!search.trim()) return true;
    const q = search.toLowerCase();
    return (
      item.content.toLowerCase().includes(q) ||
      item.projectName.toLowerCase().includes(q) ||
      item.title.toLowerCase().includes(q) ||
      (item.tags ?? []).some((t) => t.toLowerCase().includes(q))
    );
  });

  return (
    <div style={{ height: "100dvh", overflowY: "auto", background: "transparent", display: "flex", flexDirection: "column" }}>

      {/* Toast */}
      {toast && (
        <div style={{
          position: "fixed", top: 20, left: "50%", transform: "translateX(-50%)",
          zIndex: 99999, background: "var(--atlas-surface)",
          border: "1px solid rgba(201,162,76,0.45)", borderRadius: 10,
          padding: "9px 18px", ...mono, fontSize: 11, fontWeight: 700,
          letterSpacing: "0.08em", color: "var(--atlas-gold)",
          boxShadow: "0 8px 32px rgba(0,0,0,0.6)",
          pointerEvents: "none",
        }}>
          {toast}
        </div>
      )}

      {/* Header */}
      <header style={{
        display: "flex", alignItems: "center", gap: 12,
        padding: "16px 20px",
        borderBottom: "1px solid var(--atlas-border)",
        flexShrink: 0,
      }}>
        <button
          onClick={() => setLocation("/")}
          style={{ background: "transparent", border: "none", cursor: "pointer", color: "var(--atlas-muted)", display: "flex", alignItems: "center", gap: 6, padding: 0 }}
        >
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
            <path d="M19 12H5M12 5l-7 7 7 7" />
          </svg>
          <span style={{ ...mono, fontSize: 10, letterSpacing: "0.12em", textTransform: "uppercase" }}>Back</span>
        </button>
        <div style={{ width: 1, height: 16, background: "var(--atlas-border)" }} />
        <span style={{ ...mono, fontSize: 10, letterSpacing: "0.18em", textTransform: "uppercase", color: "var(--atlas-gold)", opacity: 0.8 }}>
          The Vault
        </span>
        <div style={{ flex: 1 }} />
        {/* Search */}
        <div style={{
          display: "flex", alignItems: "center", gap: 8,
          background: "rgba(255,255,255,0.03)", border: "1px solid var(--atlas-border)",
          borderRadius: 8, padding: "6px 12px",
        }}>
          <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" style={{ color: "var(--atlas-muted)", flexShrink: 0, opacity: 0.6 }}>
            <circle cx="11" cy="11" r="8" /><path d="m21 21-4.35-4.35" />
          </svg>
          <input
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search saves…"
            style={{
              background: "transparent", border: "none", outline: "none",
              ...sans, fontSize: 12, color: "var(--atlas-fg)",
              width: 130,
            }}
          />
        </div>
      </header>

      {/* Title row */}
      <div style={{ padding: "32px 20px 0" }}>
        <h1 style={{ ...sans, fontSize: 26, fontWeight: 600, color: "var(--atlas-fg)", marginBottom: 6, lineHeight: 1.2 }}>
          The Vault
        </h1>
        <p style={{ ...mono, fontSize: 10, letterSpacing: "0.12em", color: "var(--atlas-muted)", marginBottom: 32 }}>
          SAVED DECISION SNAPSHOTS — LEGACY LOG
        </p>
      </div>

      {/* Body */}
      <main style={{ flex: 1, padding: "0 20px 80px" }}>

        {/* Loading */}
        {loading && (
          <div style={{ display: "flex", alignItems: "center", justifyContent: "center", paddingTop: 80 }}>
            <LoadingSpinner size="lg" color="atlas" />
          </div>
        )}

        {/* Empty */}
        {!loading && filtered.length === 0 && (
          <div style={{ textAlign: "center", paddingTop: 80 }}>
            <div style={{ fontSize: 28, marginBottom: 16, opacity: 0.25, color: "var(--atlas-gold)" }}>◆</div>
            <p style={{ ...sans, fontSize: 14, color: "var(--atlas-muted)", marginBottom: 6, opacity: 0.6 }}>
              {items.length === 0 ? "The Vault is empty." : "No saves match your search."}
            </p>
            {items.length === 0 && (
              <p style={{ ...mono, fontSize: 10, letterSpacing: "0.1em", color: "var(--atlas-muted)", opacity: 0.4, maxWidth: 280, margin: "0 auto" }}>
                SAVE A LEDGER SNAPSHOT FROM ANY PROJECT WORKSPACE TO BUILD YOUR ARCHIVE
              </p>
            )}
          </div>
        )}

        {/* Grid */}
        {!loading && filtered.length > 0 && (
          <div style={{
            display: "grid",
            gridTemplateColumns: "repeat(auto-fill, minmax(300px, 1fr))",
            gap: 16,
          }}>
            {filtered.map((item) => (
              <VaultCard
                key={item.id}
                item={item}
                expanded={expandedId === item.id}
                onToggleExpand={() => setExpandedId(expandedId === item.id ? null : item.id)}
                copied={copiedId === item.id}
                onCopy={() => handleCopy(item)}
                onGoToProject={() => handleGoToProject(item)}
                confirmDelete={confirmDeleteId === item.id}
                deleting={deletingId === item.id}
                onRequestDelete={() => setConfirmDeleteId(item.id)}
                onConfirmDelete={() => handleDelete(item.id)}
                onCancelDelete={() => setConfirmDeleteId(null)}
              />
            ))}
          </div>
        )}
      </main>

      {/* Footer */}
      <footer style={{ borderTop: "1px solid var(--atlas-border)", padding: "20px 24px", display: "flex", gap: 24, justifyContent: "center", flexShrink: 0 }}>
        {[
          { label: "Home", href: "/" },
          { label: "Projects", href: "/projects" },
          { label: "Help", href: "/help" },
        ].map(({ label, href }) => (
          <a key={href} href={href} style={{ ...mono, fontSize: 10, letterSpacing: "0.1em", color: "var(--atlas-muted)", textDecoration: "none", opacity: 0.6 }}>
            {label}
          </a>
        ))}
      </footer>

      <style>{`
        @keyframes vault-bounce {
          0%, 80%, 100% { transform: scale(0.7); opacity: 0.5; }
          40% { transform: scale(1.1); opacity: 1; }
        }
      `}</style>
    </div>
  );
}

// ── VaultCard ─────────────────────────────────────────────────────────────────
function VaultCard({
  item, expanded, onToggleExpand,
  copied, onCopy, onGoToProject,
  confirmDelete, deleting, onRequestDelete, onConfirmDelete, onCancelDelete,
}: {
  item: VaultSave;
  expanded: boolean;
  onToggleExpand: () => void;
  copied: boolean;
  onCopy: () => void;
  onGoToProject: () => void;
  confirmDelete: boolean;
  deleting: boolean;
  onRequestDelete: () => void;
  onConfirmDelete: () => void;
  onCancelDelete: () => void;
}) {
  const [hovered, setHovered] = useState(false);

  return (
    <div
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      style={{
        background: "var(--atlas-surface)",
        border: `1px solid ${hovered ? "rgba(201,162,76,0.4)" : "var(--atlas-border)"}`,
        borderRadius: 12,
        padding: 16,
        display: "flex",
        flexDirection: "column",
        gap: 10,
        transition: "border-color 180ms ease, box-shadow 180ms ease",
        boxShadow: hovered ? "0 0 24px rgba(201,162,76,0.08)" : "none",
      }}
    >
      {/* Top row: project badge + date */}
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8 }}>
        <span style={{
          ...mono, fontSize: 9.5, fontWeight: 700, letterSpacing: "0.08em",
          textTransform: "uppercase" as const,
          color: "var(--atlas-gold)",
          border: "1px solid rgba(201,162,76,0.35)",
          borderRadius: 20, padding: "2px 9px",
          background: "rgba(201,162,76,0.07)",
          whiteSpace: "nowrap" as const,
          maxWidth: 140, overflow: "hidden", textOverflow: "ellipsis",
        }}>
          {item.projectName}
        </span>
        <span style={{ ...mono, fontSize: 9, color: "var(--atlas-muted)", opacity: 0.55, textAlign: "right" as const, flexShrink: 0 }}>
          {formatDate(item.createdAt)}
        </span>
      </div>

      {/* Title */}
      <p style={{ ...sans, fontSize: 13, fontWeight: 500, color: "var(--atlas-fg)", lineHeight: 1.4, margin: 0 }}>
        {item.title}
      </p>

      {/* Content preview / expanded */}
      <div>
        <p style={{
          ...sans, fontSize: 12, color: "var(--atlas-muted)", lineHeight: 1.6, margin: 0,
          overflow: "hidden",
          display: "-webkit-box",
          WebkitLineClamp: expanded ? undefined : 3,
          WebkitBoxOrient: "vertical" as const,
          whiteSpace: expanded ? "pre-wrap" : undefined,
        }}>
          {item.content}
        </p>
        {item.content.length > 200 && (
          <button
            onClick={onToggleExpand}
            style={{
              background: "transparent", border: "none", cursor: "pointer", padding: "4px 0 0",
              ...mono, fontSize: 9.5, letterSpacing: "0.08em", color: "rgba(201,162,76,0.6)",
              textTransform: "uppercase" as const,
            }}
          >
            {expanded ? "Collapse ▲" : "Expand ▼"}
          </button>
        )}
      </div>

      {/* Stats row: entry count + tags */}
      <div style={{ display: "flex", alignItems: "center", flexWrap: "wrap" as const, gap: 5 }}>
        <span style={{ ...mono, fontSize: 9.5, fontWeight: 700, color: "var(--atlas-gold)", opacity: 0.8 }}>
          ◆ {item.entryCount} decision{item.entryCount !== 1 ? "s" : ""}
        </span>
        {(item.tags ?? []).map((tag) => (
          <span
            key={tag}
            style={{
              ...mono, fontSize: 9,
              border: "1px solid rgba(201,162,76,0.18)",
              borderRadius: 20, padding: "1px 7px",
              ...getTagColor(tag),
            }}
          >
            {tag}
          </span>
        ))}
      </div>

      {/* Action buttons */}
      <div style={{ display: "flex", gap: 6, marginTop: 2 }}>
        <button
          onClick={onCopy}
          style={{
            flex: 1, borderRadius: 7, padding: "7px 0", ...mono, fontSize: 10, fontWeight: 700,
            letterSpacing: "0.06em", textTransform: "uppercase" as const,
            border: "1px solid rgba(201,162,76,0.35)",
            background: copied ? "rgba(201,162,76,0.15)" : "rgba(201,162,76,0.07)",
            color: "var(--atlas-gold)", cursor: "pointer", transition: "all 150ms ease",
          }}
        >
          {copied ? "Copied ✓" : "Copy"}
        </button>

        {item.projectId && (
          <button
            onClick={onGoToProject}
            style={{
              flex: 1, borderRadius: 7, padding: "7px 0", ...mono, fontSize: 10, fontWeight: 700,
              letterSpacing: "0.06em", textTransform: "uppercase" as const,
              border: "1px solid rgba(201,162,76,0.35)",
              background: "rgba(201,162,76,0.07)",
              color: "var(--atlas-gold)", cursor: "pointer", transition: "all 150ms ease",
            }}
          >
            ⟶ Project
          </button>
        )}

        {confirmDelete ? (
          <div style={{ display: "flex", gap: 4 }}>
            <button
              onClick={onConfirmDelete}
              disabled={deleting}
              style={{
                borderRadius: 7, padding: "7px 10px", ...mono, fontSize: 10, fontWeight: 700,
                border: "1px solid rgba(239,68,68,0.45)", background: "rgba(239,68,68,0.1)",
                color: "rgba(239,68,68,0.85)", cursor: "pointer",
              }}
            >
              {deleting ? "…" : "Delete"}
            </button>
            <button
              onClick={onCancelDelete}
              style={{
                borderRadius: 7, padding: "7px 10px", ...mono, fontSize: 10,
                border: "1px solid var(--atlas-border)", background: "transparent",
                color: "var(--atlas-muted)", cursor: "pointer",
              }}
            >
              Cancel
            </button>
          </div>
        ) : (
          <button
            onClick={onRequestDelete}
            style={{
              borderRadius: 7, padding: "7px 10px",
              border: "1px solid var(--atlas-border)", background: "transparent",
              color: "var(--atlas-muted)", cursor: "pointer", transition: "all 150ms ease",
              ...mono, fontSize: 11,
            }}
            onMouseEnter={(e) => { e.currentTarget.style.color = "rgba(239,68,68,0.75)"; e.currentTarget.style.borderColor = "rgba(239,68,68,0.35)"; }}
            onMouseLeave={(e) => { e.currentTarget.style.color = "var(--atlas-muted)"; e.currentTarget.style.borderColor = "var(--atlas-border)"; }}
          >
            ✕
          </button>
        )}
      </div>
    </div>
  );
}
