// SessionTimeline — chronological execution trace for the Changes tab.
//
// Replaces the flat PushDiffCard list inside LedgerPanel with a unified
// vertical timeline that interleaves the three real signals Atlas already
// captures, newest first:
//
//   • Prompt        — the user's message that opened a turn.
//   • Thought       — assistant reply (collapsed; shows executionTimeMs
//                     and intent type, expands to the response text).
//   • Modify file   — per-path nodes for fileEdits and linePatches,
//                     expanding inline to a DiffViewer.
//   • Push          — GitHub push records (grouped by commitUrl),
//                     with inline file list + rollback.
//
// No mock data. No new transport. Frontend-only.
//
// Aesthetic: Luxury Obsidian. Hairline gold trace line, monospace labels,
// glass cards, amber accents on active states. Mobile-first — every
// horizontal surface (paths, diffs) scrolls inside its node.

import { useEffect, useMemo, useState, type ReactNode, type CSSProperties } from "react";
import {
  Lightbulb,
  FileCode2,
  GitCommit,
  MessageSquare,
  ChevronRight,
  ExternalLink,
  RotateCcw,
} from "lucide-react";
import DiffViewer from "@/components/code/DiffViewer";
import { computeLineDiff, type DiffItem } from "@/components/workspace/chatShared";
import type { PushRecord } from "@/pages/workspace";
import { CommitHistoryCard, CommitHistorySkeleton, type GhCommitSummary } from "@/components/workspace/CommitHistory";
import { getAuthHeaders } from "@/lib/api";

// ── Minimal structural type for the messages we read. We deliberately
// don't import workspace.tsx's ChatMessage to keep this leaf-component
// free of upstream coupling.
export interface TimelineMessage {
  id?: number;
  role: "user" | "assistant";
  content: string;
  sentAt?: string;
  executionTimeMs?: number | null;
  intentType?: string | null;
  reverted?: boolean;
  streaming?: boolean;
  fileEdit?: { path: string; language?: string; content: string };
  fileEdits?: Array<{ path: string; language?: string; content: string }>;
  linePatches?: Array<{ path: string; find: string; replace: string }>;
}

interface Props {
  messages: TimelineMessage[];
  pushHistory: PushRecord[];
  onRollbackPush: (record: PushRecord) => Promise<void>;
  projectId?: number | null;
}

// ── Node model ────────────────────────────────────────────────────────────

type Kind = "prompt" | "thought" | "modify" | "push";

type TimelineNode =
  | { kind: "prompt"; key: string; at: number; message: TimelineMessage }
  | { kind: "thought"; key: string; at: number; message: TimelineMessage }
  | {
      kind: "modify";
      key: string;
      at: number;
      path: string;
      messageId: number | string;
      fileEdit?: { path: string; content: string };
      linePatches?: Array<{ path: string; find: string; replace: string }>;
    }
  | { kind: "push"; key: string; at: number; records: PushRecord[] };

function tsOf(iso: string | undefined, fallback: number): number {
  if (!iso) return fallback;
  const t = Date.parse(iso);
  return Number.isFinite(t) ? t : fallback;
}

function buildNodes(messages: TimelineMessage[], pushHistory: PushRecord[]): TimelineNode[] {
  const nodes: TimelineNode[] = [];

  messages.forEach((m, idx) => {
    if (m.reverted) return;
    const baseAt = tsOf(m.sentAt, idx);
    const msgKey = m.id ?? `idx-${idx}`;

    if (m.role === "user") {
      if (m.content?.trim()) {
        nodes.push({ kind: "prompt", key: `p-${msgKey}`, at: baseAt, message: m });
      }
      return;
    }

    // assistant
    if (m.streaming) return;
    if (m.content?.trim()) {
      nodes.push({ kind: "thought", key: `t-${msgKey}`, at: baseAt, message: m });
    }

    const edits = m.fileEdits ?? (m.fileEdit ? [m.fileEdit] : []);
    edits.forEach((edit, i) => {
      nodes.push({
        kind: "modify",
        key: `m-${msgKey}-e-${i}-${edit.path}`,
        at: baseAt + i + 1,
        path: edit.path,
        messageId: msgKey,
        fileEdit: { path: edit.path, content: edit.content },
      });
    });

    // group linePatches by path so each file is one expandable node
    const byPath = new Map<string, Array<{ path: string; find: string; replace: string }>>();
    (m.linePatches ?? []).forEach((p) => {
      const arr = byPath.get(p.path) ?? [];
      arr.push(p);
      byPath.set(p.path, arr);
    });
    let pIdx = 0;
    byPath.forEach((patches, path) => {
      nodes.push({
        kind: "modify",
        key: `m-${msgKey}-p-${pIdx++}-${path}`,
        at: baseAt + edits.length + pIdx,
        path,
        messageId: msgKey,
        linePatches: patches,
      });
    });
  });

  // group pushes by commitUrl
  const pushGroups = new Map<string, PushRecord[]>();
  pushHistory.forEach((r) => {
    const key = r.commitUrl || r.id;
    const arr = pushGroups.get(key) ?? [];
    arr.push(r);
    pushGroups.set(key, arr);
  });
  pushGroups.forEach((records, key) => {
    const at = Math.max(...records.map((r) => tsOf(r.pushedAt, 0)));
    nodes.push({ kind: "push", key: `pu-${key}`, at, records });
  });

  // newest first
  nodes.sort((a, b) => b.at - a.at);
  return nodes;
}

// ── Visuals ───────────────────────────────────────────────────────────────

const accent: Record<Kind, string> = {
  prompt: "rgba(160,180,210,0.7)",
  thought: "rgba(201,162,76,0.85)",
  modify: "rgba(134,239,172,0.75)",
  push: "rgba(134,239,172,0.95)",
};

const TRACE_COLOR =
  "color-mix(in oklab, var(--atlas-gold) 28%, transparent)";

const cardShell: CSSProperties = {
  borderRadius: 7,
  background:
    "linear-gradient(180deg, color-mix(in oklab, var(--atlas-surface) 92%, transparent), color-mix(in oklab, var(--atlas-bg) 88%, transparent))",
  border: "1px solid var(--atlas-border)",
  boxShadow:
    "0 1px 0 0 color-mix(in oklab, var(--atlas-gold) 4%, transparent) inset, 0 12px 28px -22px rgba(0,0,0,0.55)",
  overflow: "hidden",
};

function NodeFrame({
  kind,
  isLast,
  children,
}: {
  kind: Kind;
  isLast: boolean;
  children: ReactNode;
}) {
  return (
    <div style={{ display: "flex", gap: 10, position: "relative" }}>
      {/* Trace rail + dot */}
      <div
        style={{
          flexShrink: 0,
          width: 16,
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          position: "relative",
        }}
      >
        {/* dot */}
        <div
          style={{
            marginTop: 10,
            width: 9,
            height: 9,
            borderRadius: "50%",
            background: accent[kind],
            boxShadow: `0 0 8px ${accent[kind]}`,
            border: "1px solid color-mix(in oklab, var(--atlas-bg) 70%, black)",
            zIndex: 1,
          }}
        />
        {/* trace line */}
        {!isLast && (
          <div
            style={{
              flex: 1,
              width: 1,
              marginTop: 4,
              background: `linear-gradient(180deg, ${TRACE_COLOR}, transparent 95%)`,
            }}
          />
        )}
      </div>
      <div style={{ flex: 1, minWidth: 0, paddingBottom: 12 }}>{children}</div>
    </div>
  );
}

function formatTime(iso: string | undefined): string {
  if (!iso) return "";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  return d.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
}

function formatMs(ms: number | null | undefined): string {
  if (!ms || ms <= 0) return "—";
  if (ms < 1000) return `${ms}ms`;
  return `${(ms / 1000).toFixed(ms < 10_000 ? 1 : 0)}s`;
}

function Pill({
  children,
  tone = "neutral",
}: {
  children: ReactNode;
  tone?: "neutral" | "gold" | "green";
}) {
  const palette =
    tone === "gold"
      ? { fg: "var(--atlas-gold)", bg: "rgba(201,162,76,0.10)", bd: "rgba(201,162,76,0.28)" }
      : tone === "green"
      ? { fg: "rgba(134,239,172,0.85)", bg: "rgba(134,239,172,0.08)", bd: "rgba(134,239,172,0.25)" }
      : { fg: "var(--atlas-muted)", bg: "rgba(255,255,255,0.03)", bd: "var(--atlas-border)" };
  return (
    <span
      style={{
        fontFamily: "var(--app-font-mono)",
        fontSize: 9.5,
        letterSpacing: "0.06em",
        textTransform: "uppercase",
        padding: "2px 7px",
        borderRadius: 10,
        color: palette.fg,
        background: palette.bg,
        border: `1px solid ${palette.bd}`,
        whiteSpace: "nowrap",
      }}
    >
      {children}
    </span>
  );
}

function Chevron({ open }: { open: boolean }) {
  return (
    <ChevronRight
      size={12}
      style={{
        color: "var(--atlas-muted)",
        opacity: 0.7,
        transition: "transform 180ms ease",
        transform: open ? "rotate(90deg)" : "rotate(0deg)",
      }}
    />
  );
}

// ── Per-node renderers ────────────────────────────────────────────────────

function PromptNode({ msg }: { msg: TimelineMessage }) {
  const [open, setOpen] = useState(false);
  const long = (msg.content?.length ?? 0) > 140;
  const preview = long ? msg.content.slice(0, 140).replace(/\s+$/, "") + "…" : msg.content;
  return (
    <div style={cardShell}>
      <button
        type="button"
        onClick={() => long && setOpen((v) => !v)}
        style={{
          all: "unset",
          width: "100%",
          display: "flex",
          alignItems: "center",
          gap: 8,
          padding: "8px 10px",
          cursor: long ? "pointer" : "default",
          boxSizing: "border-box",
        }}
      >
        <MessageSquare size={13} style={{ color: "rgba(160,180,210,0.85)", flexShrink: 0 }} />
        <span
          style={{
            fontFamily: "var(--app-font-mono)",
            fontSize: 10,
            letterSpacing: "0.08em",
            textTransform: "uppercase",
            color: "var(--atlas-muted)",
          }}
        >
          Prompt
        </span>
        <span
          style={{
            marginLeft: "auto",
            fontFamily: "var(--app-font-mono)",
            fontSize: 9.5,
            color: "var(--atlas-muted)",
            opacity: 0.55,
          }}
        >
          {formatTime(msg.sentAt)}
        </span>
        {long && <Chevron open={open} />}
      </button>
      <div
        style={{
          padding: "0 10px 10px 30px",
          fontSize: 12,
          lineHeight: 1.55,
          color: "color-mix(in oklab, var(--atlas-fg) 88%, transparent)",
          whiteSpace: "pre-wrap",
          wordBreak: "break-word",
        }}
      >
        {open || !long ? msg.content : preview}
      </div>
    </div>
  );
}

function ThoughtNode({ msg }: { msg: TimelineMessage }) {
  const [open, setOpen] = useState(false);
  return (
    <div style={cardShell}>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        style={{
          all: "unset",
          width: "100%",
          display: "flex",
          alignItems: "center",
          gap: 8,
          padding: "8px 10px",
          cursor: "pointer",
          boxSizing: "border-box",
        }}
      >
        <Lightbulb size={13} style={{ color: "var(--atlas-gold)", flexShrink: 0 }} />
        <span
          style={{
            fontFamily: "var(--app-font-mono)",
            fontSize: 10,
            letterSpacing: "0.08em",
            textTransform: "uppercase",
            color: "var(--atlas-muted)",
          }}
        >
          Thought · {formatMs(msg.executionTimeMs)}
        </span>
        {msg.intentType && <Pill tone="gold">{msg.intentType}</Pill>}
        <span
          style={{
            marginLeft: "auto",
            fontFamily: "var(--app-font-mono)",
            fontSize: 9.5,
            color: "var(--atlas-muted)",
            opacity: 0.55,
          }}
        >
          {formatTime(msg.sentAt)}
        </span>
        <Chevron open={open} />
      </button>
      {open && (
        <div
          style={{
            padding: "0 10px 10px 30px",
            fontSize: 12,
            lineHeight: 1.6,
            color: "color-mix(in oklab, var(--atlas-fg) 82%, transparent)",
            whiteSpace: "pre-wrap",
            wordBreak: "break-word",
            maxHeight: 280,
            overflowY: "auto",
          }}
        >
          {msg.content}
        </div>
      )}
    </div>
  );
}

function ModifyNode({
  node,
}: {
  node: Extract<TimelineNode, { kind: "modify" }>;
}) {
  const [open, setOpen] = useState(false);

  const items = useMemo<DiffItem[] | null>(() => {
    if (node.linePatches && node.linePatches.length > 0) {
      const out: DiffItem[] = [];
      node.linePatches.forEach((p, i) => {
        if (i > 0) out.push({ type: "ellipsis", count: 1 });
        p.find.split("\n").forEach((line) => out.push({ type: "removed", line }));
        p.replace.split("\n").forEach((line) => out.push({ type: "added", line }));
      });
      return out;
    }
    return null;
  }, [node.linePatches]);

  const stat = useMemo(() => {
    if (node.fileEdit) {
      const lines = node.fileEdit.content.split("\n").length;
      return { added: lines, removed: 0 };
    }
    let added = 0;
    let removed = 0;
    (node.linePatches ?? []).forEach((p) => {
      added += p.replace.split("\n").length;
      removed += p.find.split("\n").length;
    });
    return { added, removed };
  }, [node.fileEdit, node.linePatches]);

  const filename = node.path.split("/").pop() ?? node.path;

  return (
    <div style={cardShell}>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        style={{
          all: "unset",
          width: "100%",
          display: "flex",
          alignItems: "center",
          gap: 8,
          padding: "8px 10px",
          cursor: "pointer",
          boxSizing: "border-box",
        }}
      >
        <FileCode2 size={13} style={{ color: "rgba(134,239,172,0.85)", flexShrink: 0 }} />
        <span
          style={{
            fontFamily: "var(--app-font-mono)",
            fontSize: 10,
            letterSpacing: "0.08em",
            textTransform: "uppercase",
            color: "var(--atlas-muted)",
          }}
        >
          Modified
        </span>
        <span
          style={{
            fontFamily: "var(--app-font-mono)",
            fontSize: 11,
            color: "color-mix(in oklab, var(--atlas-fg) 90%, transparent)",
            overflow: "hidden",
            textOverflow: "ellipsis",
            whiteSpace: "nowrap",
            flex: 1,
            minWidth: 0,
          }}
          title={node.path}
        >
          {filename}
        </span>
        <span style={{ display: "inline-flex", gap: 6, fontFamily: "var(--app-font-mono)", fontSize: 10 }}>
          {stat.added > 0 && <span style={{ color: "var(--atlas-phosphor)" }}>+{stat.added}</span>}
          {stat.removed > 0 && <span style={{ color: "var(--atlas-ember)" }}>−{stat.removed}</span>}
        </span>
        <Chevron open={open} />
      </button>
      {open && (
        <div style={{ padding: "0 10px 10px 10px", overflowX: "auto" }}>
          {items ? (
            <DiffViewer
              filename={node.path}
              items={items}
              maxHeight={320}
              badge="Patch"
            />
          ) : node.fileEdit ? (
            <DiffViewer
              filename={node.path}
              before=""
              after={node.fileEdit.content}
              maxHeight={320}
              badge="New file"
            />
          ) : null}
        </div>
      )}
    </div>
  );
}

function PushNode({
  records,
  onRollback,
}: {
  records: PushRecord[];
  onRollback: (r: PushRecord) => Promise<void>;
}) {
  const [open, setOpen] = useState(false);
  const first = records[0];
  const stat = useMemo(() => {
    let added = 0;
    let removed = 0;
    records.forEach((r) => {
      const diff = computeLineDiff(r.originalContent ?? "", r.newContent);
      diff.forEach((d) => {
        if (d.type === "added") added++;
        else if (d.type === "removed") removed++;
      });
    });
    return { added, removed };
  }, [records]);

  return (
    <div style={cardShell}>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        style={{
          all: "unset",
          width: "100%",
          display: "flex",
          alignItems: "center",
          gap: 8,
          padding: "8px 10px",
          cursor: "pointer",
          boxSizing: "border-box",
        }}
      >
        <GitCommit size={13} style={{ color: "rgba(134,239,172,0.95)", flexShrink: 0 }} />
        <span
          style={{
            fontFamily: "var(--app-font-mono)",
            fontSize: 10,
            letterSpacing: "0.08em",
            textTransform: "uppercase",
            color: "var(--atlas-muted)",
          }}
        >
          Pushed
        </span>
        <Pill tone="green">
          {records.length} {records.length === 1 ? "file" : "files"}
        </Pill>
        <span style={{ display: "inline-flex", gap: 6, fontFamily: "var(--app-font-mono)", fontSize: 10 }}>
          {stat.added > 0 && <span style={{ color: "var(--atlas-phosphor)" }}>+{stat.added}</span>}
          {stat.removed > 0 && <span style={{ color: "var(--atlas-ember)" }}>−{stat.removed}</span>}
        </span>
        <span
          style={{
            marginLeft: "auto",
            fontFamily: "var(--app-font-mono)",
            fontSize: 9.5,
            color: "var(--atlas-muted)",
            opacity: 0.55,
          }}
        >
          {formatTime(first.pushedAt)}
        </span>
        <Chevron open={open} />
      </button>
      {open && (
        <div style={{ padding: "0 10px 10px 30px", display: "flex", flexDirection: "column", gap: 6 }}>
          {records.map((r) => {
            const isNew = r.originalContent === null;
            return (
              <div
                key={r.id}
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: 8,
                  padding: "6px 8px",
                  border: "1px solid var(--atlas-border)",
                  borderRadius: 5,
                  background: "color-mix(in oklab, var(--atlas-bg) 86%, transparent)",
                }}
              >
                <FileCode2 size={11} style={{ color: "var(--atlas-muted)", flexShrink: 0 }} />
                <span
                  style={{
                    fontFamily: "var(--app-font-mono)",
                    fontSize: 10.5,
                    color: r.rolledBack
                      ? "color-mix(in oklab, var(--atlas-muted) 80%, transparent)"
                      : "color-mix(in oklab, var(--atlas-fg) 88%, transparent)",
                    textDecoration: r.rolledBack ? "line-through" : "none",
                    overflow: "hidden",
                    textOverflow: "ellipsis",
                    whiteSpace: "nowrap",
                    flex: 1,
                    minWidth: 0,
                  }}
                  title={r.path}
                >
                  {r.filename}
                </span>
                {isNew && <Pill tone="gold">New</Pill>}
                {!r.rolledBack && (
                  <button
                    type="button"
                    onClick={(e) => {
                      e.stopPropagation();
                      void onRollback(r);
                    }}
                    style={{
                      all: "unset",
                      display: "inline-flex",
                      alignItems: "center",
                      gap: 3,
                      cursor: "pointer",
                      padding: "2px 6px",
                      borderRadius: 4,
                      border: "1px solid rgba(229,115,115,0.25)",
                      color: "var(--atlas-ember)",
                      fontFamily: "var(--app-font-mono)",
                      fontSize: 9.5,
                      letterSpacing: "0.06em",
                      textTransform: "uppercase",
                    }}
                  >
                    <RotateCcw size={9} /> Rollback
                  </button>
                )}
              </div>
            );
          })}
          {first.commitUrl && (
            <a
              href={first.commitUrl}
              target="_blank"
              rel="noreferrer"
              style={{
                marginTop: 2,
                alignSelf: "flex-end",
                display: "inline-flex",
                alignItems: "center",
                gap: 4,
                fontFamily: "var(--app-font-mono)",
                fontSize: 10,
                color: "var(--atlas-gold)",
                textDecoration: "none",
                opacity: 0.85,
              }}
            >
              View commit <ExternalLink size={10} />
            </a>
          )}
        </div>
      )}
    </div>
  );
}

// ── Root ──────────────────────────────────────────────────────────────────

export function SessionTimeline({ messages, pushHistory, onRollbackPush, projectId }: Props) {
  const nodes = useMemo(() => buildNodes(messages, pushHistory), [messages, pushHistory]);

  const headerCount = nodes.length;
  const hasAny = headerCount > 0;

  // Backend commit fallback — shows commits from GitHub (via Cursor pushes,
  // prior sessions, etc.) when this session hasn't pushed anything yet.
  // Endpoint is optional: if it 404s or isn't deployed, we silently render
  // nothing extra. No mock data.
  const [ghCommits, setGhCommits] = useState<GhCommitSummary[] | null>(null);
  const [ghLoading, setGhLoading] = useState(false);
  const [ghError, setGhError] = useState<string | null>(null);

  useEffect(() => {
    if (projectId == null) { setGhCommits(null); return; }
    let cancelled = false;
    const ctrl = new AbortController();
    setGhLoading(true);
    setGhError(null);
    fetch(`/api/projects/${projectId}/commits`, {
      credentials: "include",
      headers: { ...getAuthHeaders() },
      signal: ctrl.signal,
    })
      .then(async (res) => {
        if (res.status === 404) { if (!cancelled) setGhCommits([]); return; }
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const data = await res.json();
        if (cancelled) return;
        const list: GhCommitSummary[] = Array.isArray(data) ? data : Array.isArray(data?.commits) ? data.commits : [];
        setGhCommits(list);
      })
      .catch((e) => {
        if (cancelled || e?.name === "AbortError") return;
        setGhError(e?.message || "Failed to load commits");
        setGhCommits([]);
      })
      .finally(() => { if (!cancelled) setGhLoading(false); });
    return () => { cancelled = true; ctrl.abort(); };
  }, [projectId]);

  const ghHasAny = !!ghCommits && ghCommits.length > 0;

  return (
    <div style={{ padding: "0 12px 12px" }}>
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: 7,
          marginBottom: 10,
          paddingTop: 12,
          borderTop: "1px solid var(--atlas-border)",
        }}
      >
        <span
          style={{
            width: 6,
            height: 6,
            borderRadius: "50%",
            background: hasAny || ghHasAny ? "rgba(134,239,172,0.6)" : "var(--atlas-muted)",
            opacity: hasAny || ghHasAny ? 1 : 0.3,
            flexShrink: 0,
          }}
        />
        <span
          style={{
            fontSize: 10.5,
            fontFamily: "var(--app-font-mono)",
            letterSpacing: "0.1em",
            textTransform: "uppercase",
            color: "var(--atlas-muted)",
          }}
        >
          Changes
        </span>
        {hasAny && (
          <span
            style={{
              marginLeft: "auto",
              fontSize: 9.5,
              fontFamily: "var(--app-font-mono)",
              background: "rgba(134,239,172,0.08)",
              border: "1px solid rgba(134,239,172,0.2)",
              color: "rgba(134,239,172,0.7)",
              padding: "1px 6px",
              borderRadius: 10,
            }}
          >
            {headerCount}
          </span>
        )}
      </div>

      {!hasAny && !ghLoading && !ghHasAny && (
        <div
          style={{
            fontSize: 11,
            color: "var(--atlas-muted)",
            opacity: 0.35,
            lineHeight: 1.65,
          }}
        >
          Your session timeline will appear here — prompts, Atlas thoughts,
          file edits, and pushes, in the order they happened.
        </div>
      )}

      {hasAny && (
        <div style={{ display: "flex", flexDirection: "column" }}>
          {nodes.map((n, i) => {
            const isLast = i === nodes.length - 1;
            return (
              <NodeFrame key={n.key} kind={n.kind} isLast={isLast}>
                {n.kind === "prompt" && <PromptNode msg={n.message} />}
                {n.kind === "thought" && <ThoughtNode msg={n.message} />}
                {n.kind === "modify" && <ModifyNode node={n} />}
                {n.kind === "push" && (
                  <PushNode records={n.records} onRollback={onRollbackPush} />
                )}
              </NodeFrame>
            );
          })}
        </div>
      )}

      {/* Backend commit history — shown below in-session nodes (or alone
          when this session hasn't pushed yet). Includes commits from Cursor
          and prior sessions. */}
      {(ghLoading || ghHasAny) && projectId != null && (
        <div style={{ marginTop: hasAny ? 16 : 0 }}>
          <div
            style={{
              display: "flex",
              alignItems: "center",
              gap: 7,
              marginBottom: 8,
              opacity: 0.75,
            }}
          >
            <GitCommit size={11} style={{ color: "var(--atlas-muted)" }} />
            <span
              style={{
                fontSize: 9.5,
                fontFamily: "var(--app-font-mono)",
                letterSpacing: "0.12em",
                textTransform: "uppercase",
                color: "var(--atlas-muted)",
              }}
            >
              From GitHub
            </span>
            {ghHasAny && (
              <span style={{ fontSize: 9.5, fontFamily: "var(--app-font-mono)", color: "var(--atlas-muted)", opacity: 0.6, marginLeft: "auto" }}>
                {ghCommits!.length}
              </span>
            )}
          </div>
          {ghLoading && !ghHasAny ? (
            <CommitHistorySkeleton />
          ) : (
            <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
              {ghCommits!.map((c) => (
                <CommitHistoryCard
                  key={c.sha}
                  commit={c}
                  projectId={projectId}
                  canRevert={false}
                />
              ))}
            </div>
          )}
          {ghError && (
            <div style={{ fontSize: 10, color: "var(--atlas-muted)", opacity: 0.45, marginTop: 6 }}>
              Couldn't load commit history.
            </div>
          )}
        </div>
      )}
    </div>
  );
}

export default SessionTimeline;
