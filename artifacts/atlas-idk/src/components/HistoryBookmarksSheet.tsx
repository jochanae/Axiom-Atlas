/**
 * History | Bookmarks bottom sheet.
 *
 * Surfaced from the composer's More menu → "History" item.
 * Both tabs operate on the same `AtlasHistoryItem` ledger from
 * `src/lib/atlas-history.ts`.
 */
import { useMemo, useState } from "react";
import {
  Bookmark,
  BookmarkCheck,
  Code2,
  CornerUpLeft,
  Gavel,
  History as HistoryIcon,
  MoreHorizontal,
  Sparkles,
  X,
} from "lucide-react";
import {
  type AtlasHistoryItem,
  type AtlasLens,
  formatSnapshotTimestamp,
  groupByDay,
  useAtlasHistory,
} from "@/lib/atlas-history";

const OVERLAY: React.CSSProperties = {
  position: "fixed",
  inset: 0,
  background: "rgba(8, 8, 12, 0.72)",
  backdropFilter: "blur(8px)",
  zIndex: 10000,
  display: "flex",
  alignItems: "flex-end",
  justifyContent: "center",
  animation: "atlasHistoryFade 180ms ease",
};

const SHEET: React.CSSProperties = {
  width: "100%",
  maxWidth: 560,
  maxHeight: "85vh",
  background:
    "linear-gradient(180deg, rgba(20,18,14,0.98) 0%, rgba(14,12,10,0.98) 100%)",
  border: "1px solid rgba(196,160,80,0.28)",
  borderBottom: "none",
  borderRadius: "20px 20px 0 0",
  boxShadow:
    "0 -24px 60px -20px rgba(0,0,0,0.7), 0 0 0 1px rgba(196,160,80,0.08) inset",
  display: "flex",
  flexDirection: "column",
  overflow: "hidden",
  color: "rgba(244,236,220,0.92)",
};

const TAB_BAR: React.CSSProperties = {
  display: "flex",
  gap: 4,
  padding: 6,
  margin: "10px 16px 0",
  background: "rgba(255,255,255,0.03)",
  border: "1px solid rgba(196,160,80,0.14)",
  borderRadius: 12,
};

const lensGlyph = (lens: AtlasLens) => {
  if (lens === "builder") return <Code2 size={13} strokeWidth={1.7} />;
  if (lens === "strategic") return <Gavel size={13} strokeWidth={1.7} />;
  return <Sparkles size={13} strokeWidth={1.7} />;
};

export function HistoryBookmarksSheet({
  projectId,
  open,
  onClose,
  onJumpToMessage,
}: {
  projectId: number | null;
  open: boolean;
  onClose: () => void;
  /** Smooth-scrolls chat to the associated message after rollback. */
  onJumpToMessage?: (messageId: number) => void;
}) {
  const [tab, setTab] = useState<"history" | "bookmarks">("history");
  const [revertedOpen, setRevertedOpen] = useState(false);
  const [menuFor, setMenuFor] = useState<string | null>(null);

  const { active, reverted, bookmarks, rollback, toggleBookmark, remove } =
    useAtlasHistory(projectId ?? 0);

  const grouped = useMemo(() => groupByDay(active), [active]);
  const bookmarkSorted = useMemo(
    () =>
      [...bookmarks].sort(
        (a, b) =>
          new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime(),
      ),
    [bookmarks],
  );

  if (!open) return null;

  const handleRollback = (id: string, messageId: number) => {
    rollback(id);
    onJumpToMessage?.(messageId);
    onClose();
  };

  const renderRow = (item: AtlasHistoryItem, opts?: { dim?: boolean }) => (
    <div
      key={item.id}
      style={{
        display: "flex",
        alignItems: "center",
        gap: 10,
        padding: "10px 12px",
        borderRadius: 10,
        background: "rgba(255,255,255,0.02)",
        border: "1px solid rgba(196,160,80,0.08)",
        opacity: opts?.dim ? 0.55 : 1,
        cursor: "pointer",
        transition: "background 140ms ease, border-color 140ms ease",
      }}
      onClick={() => handleRollback(item.id, item.associated_message_id)}
      onMouseEnter={(e) => {
        e.currentTarget.style.background = "rgba(196,160,80,0.07)";
        e.currentTarget.style.borderColor = "rgba(196,160,80,0.22)";
      }}
      onMouseLeave={(e) => {
        e.currentTarget.style.background = "rgba(255,255,255,0.02)";
        e.currentTarget.style.borderColor = "rgba(196,160,80,0.08)";
      }}
    >
      <span
        style={{
          flex: "0 0 24px",
          height: 24,
          display: "grid",
          placeItems: "center",
          borderRadius: 6,
          background: "rgba(196,160,80,0.10)",
          color: "rgba(228,196,128,0.85)",
        }}
      >
        {lensGlyph(item.lens)}
      </span>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div
          style={{
            fontSize: 13.5,
            fontWeight: 500,
            color: "rgba(244,236,220,0.94)",
            whiteSpace: "nowrap",
            overflow: "hidden",
            textOverflow: "ellipsis",
          }}
        >
          {item.title}
        </div>
        <div
          style={{
            fontSize: 11,
            color: "rgba(244,236,220,0.45)",
            marginTop: 2,
            letterSpacing: "0.02em",
          }}
        >
          {formatSnapshotTimestamp(item.timestamp)}
        </div>
      </div>
      <button
        aria-label="Roll back to this snapshot"
        title="Roll back"
        onClick={(e) => {
          e.stopPropagation();
          handleRollback(item.id, item.associated_message_id);
        }}
        style={iconBtnStyle}
      >
        <CornerUpLeft size={14} strokeWidth={1.7} />
      </button>
      <button
        aria-label={item.isBookmarked ? "Remove bookmark" : "Bookmark"}
        title={item.isBookmarked ? "Bookmarked" : "Bookmark"}
        onClick={(e) => {
          e.stopPropagation();
          toggleBookmark(item.id);
        }}
        style={{
          ...iconBtnStyle,
          color: item.isBookmarked
            ? "rgba(228,196,128,0.95)"
            : "rgba(244,236,220,0.55)",
        }}
      >
        {item.isBookmarked ? (
          <BookmarkCheck size={14} strokeWidth={1.8} />
        ) : (
          <Bookmark size={14} strokeWidth={1.6} />
        )}
      </button>
      <div style={{ position: "relative" }}>
        <button
          aria-label="More actions"
          onClick={(e) => {
            e.stopPropagation();
            setMenuFor(menuFor === item.id ? null : item.id);
          }}
          style={iconBtnStyle}
        >
          <MoreHorizontal size={14} strokeWidth={1.7} />
        </button>
        {menuFor === item.id && (
          <div
            onClick={(e) => e.stopPropagation()}
            style={{
              position: "absolute",
              right: 0,
              top: 28,
              minWidth: 180,
              background: "rgba(20,18,14,0.98)",
              border: "1px solid rgba(196,160,80,0.28)",
              borderRadius: 10,
              padding: 6,
              zIndex: 5,
              boxShadow: "0 14px 36px -10px rgba(0,0,0,0.8)",
            }}
          >
            <MenuRow
              label="View code changes"
              onClick={() => {
                window.dispatchEvent(
                  new CustomEvent("atlas:open-diff", {
                    detail: { snapshotId: item.id },
                  }),
                );
                setMenuFor(null);
              }}
            />
            <MenuRow
              label="Open preview"
              onClick={() => {
                window.dispatchEvent(
                  new CustomEvent("atlas:open-preview", {
                    detail: { snapshotId: item.id },
                  }),
                );
                setMenuFor(null);
              }}
            />
            <MenuRow
              label="Delete from history"
              danger
              onClick={() => {
                remove(item.id);
                setMenuFor(null);
              }}
            />
          </div>
        )}
      </div>
    </div>
  );

  return (
    <div style={OVERLAY} onClick={onClose}>
      <style>{`
        @keyframes atlasHistoryFade {
          from { opacity: 0; }
          to { opacity: 1; }
        }
        @keyframes atlasHistorySlide {
          from { transform: translateY(20px); opacity: 0.6; }
          to { transform: translateY(0); opacity: 1; }
        }
      `}</style>
      <div
        style={{ ...SHEET, animation: "atlasHistorySlide 220ms ease" }}
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            padding: "14px 18px 0",
          }}
        >
          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <HistoryIcon
              size={15}
              strokeWidth={1.7}
              style={{ color: "rgba(228,196,128,0.85)" }}
            />
            <span
              style={{
                fontSize: 13,
                letterSpacing: "0.14em",
                textTransform: "uppercase",
                color: "rgba(244,236,220,0.62)",
                fontWeight: 600,
              }}
            >
              Time travel
            </span>
          </div>
          <button onClick={onClose} aria-label="Close" style={iconBtnStyle}>
            <X size={16} strokeWidth={1.7} />
          </button>
        </div>

        {/* Tabs */}
        <div style={TAB_BAR}>
          <TabButton
            active={tab === "history"}
            onClick={() => setTab("history")}
            label="History"
            count={active.length}
          />
          <TabButton
            active={tab === "bookmarks"}
            onClick={() => setTab("bookmarks")}
            label="Bookmarks"
            count={bookmarks.length}
          />
        </div>

        {/* Body */}
        <div
          style={{
            flex: 1,
            overflowY: "auto",
            padding: "14px 16px 20px",
            display: "flex",
            flexDirection: "column",
            gap: 16,
          }}
        >
          {tab === "history" ? (
            grouped.length === 0 ? (
              <EmptyState
                icon={<HistoryIcon size={26} strokeWidth={1.4} />}
                copy="No history snapshots recorded yet."
                sub="Snapshots appear as you converse with Atlas."
              />
            ) : (
              <>
                {grouped.map((g) => (
                  <section key={g.label}>
                    <DayLabel>{g.label}</DayLabel>
                    <div
                      style={{
                        display: "flex",
                        flexDirection: "column",
                        gap: 6,
                      }}
                    >
                      {g.items.map((i) => renderRow(i))}
                    </div>
                  </section>
                ))}
                {reverted.length > 0 && (
                  <section>
                    <button
                      onClick={() => setRevertedOpen((v) => !v)}
                      style={{
                        all: "unset",
                        cursor: "pointer",
                        display: "flex",
                        alignItems: "center",
                        gap: 6,
                        fontSize: 11.5,
                        letterSpacing: "0.12em",
                        textTransform: "uppercase",
                        color: "rgba(244,236,220,0.42)",
                        padding: "4px 2px 8px",
                      }}
                    >
                      <span>{revertedOpen ? "▾" : "▸"}</span>
                      Reverted edits ({reverted.length})
                    </button>
                    {revertedOpen && (
                      <div
                        style={{
                          display: "flex",
                          flexDirection: "column",
                          gap: 6,
                        }}
                      >
                        {reverted.map((i) => renderRow(i, { dim: true }))}
                      </div>
                    )}
                  </section>
                )}
              </>
            )
          ) : bookmarkSorted.length === 0 ? (
            <EmptyState
              icon={<Bookmark size={26} strokeWidth={1.4} />}
              copy="No bookmarks yet."
              sub="Tap the bookmark icon on any snapshot to pin it here."
            />
          ) : (
            <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
              {bookmarkSorted.map((i) => renderRow(i, { dim: !!i.reverted }))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

/* ── tiny atoms ─────────────────────────────────────────────────────── */

const iconBtnStyle: React.CSSProperties = {
  all: "unset",
  cursor: "pointer",
  display: "grid",
  placeItems: "center",
  width: 28,
  height: 28,
  borderRadius: 6,
  color: "rgba(244,236,220,0.6)",
  transition: "background 120ms ease, color 120ms ease",
};

function TabButton({
  active,
  onClick,
  label,
  count,
}: {
  active: boolean;
  onClick: () => void;
  label: string;
  count: number;
}) {
  return (
    <button
      onClick={onClick}
      style={{
        all: "unset",
        cursor: "pointer",
        flex: 1,
        textAlign: "center",
        padding: "8px 12px",
        borderRadius: 8,
        fontSize: 12.5,
        fontWeight: 600,
        letterSpacing: "0.04em",
        background: active
          ? "linear-gradient(180deg, rgba(196,160,80,0.22), rgba(196,160,80,0.10))"
          : "transparent",
        color: active ? "rgba(244,224,176,0.98)" : "rgba(244,236,220,0.55)",
        border: active
          ? "1px solid rgba(196,160,80,0.45)"
          : "1px solid transparent",
        transition: "all 140ms ease",
      }}
    >
      {label}
      <span
        style={{
          marginLeft: 6,
          fontSize: 10.5,
          opacity: 0.7,
          fontFamily: "var(--app-font-mono, ui-monospace)",
        }}
      >
        {count}
      </span>
    </button>
  );
}

function DayLabel({ children }: { children: React.ReactNode }) {
  return (
    <div
      style={{
        fontSize: 10.5,
        letterSpacing: "0.16em",
        textTransform: "uppercase",
        color: "rgba(244,236,220,0.4)",
        padding: "2px 2px 8px",
        fontWeight: 600,
      }}
    >
      {children}
    </div>
  );
}

function MenuRow({
  label,
  onClick,
  danger,
}: {
  label: string;
  onClick: () => void;
  danger?: boolean;
}) {
  return (
    <button
      onClick={onClick}
      style={{
        all: "unset",
        cursor: "pointer",
        display: "block",
        width: "100%",
        boxSizing: "border-box",
        padding: "8px 10px",
        borderRadius: 6,
        fontSize: 12.5,
        color: danger ? "rgba(232,120,110,0.95)" : "rgba(244,236,220,0.88)",
        transition: "background 120ms ease",
      }}
      onMouseEnter={(e) =>
        (e.currentTarget.style.background = "rgba(255,255,255,0.05)")
      }
      onMouseLeave={(e) => (e.currentTarget.style.background = "transparent")}
    >
      {label}
    </button>
  );
}

function EmptyState({
  icon,
  copy,
  sub,
}: {
  icon: React.ReactNode;
  copy: string;
  sub?: string;
}) {
  return (
    <div
      style={{
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        justifyContent: "center",
        gap: 8,
        padding: "48px 16px",
        color: "rgba(244,236,220,0.55)",
        textAlign: "center",
      }}
    >
      <div
        style={{
          width: 48,
          height: 48,
          borderRadius: 14,
          display: "grid",
          placeItems: "center",
          background: "rgba(196,160,80,0.08)",
          border: "1px solid rgba(196,160,80,0.18)",
          color: "rgba(228,196,128,0.7)",
        }}
      >
        {icon}
      </div>
      <div style={{ fontSize: 13.5, fontWeight: 500 }}>{copy}</div>
      {sub && (
        <div
          style={{
            fontSize: 12,
            color: "rgba(244,236,220,0.4)",
            maxWidth: 280,
          }}
        >
          {sub}
        </div>
      )}
    </div>
  );
}
