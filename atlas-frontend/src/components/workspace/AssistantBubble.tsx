import { useState, useRef, useEffect, useMemo, type FormEvent } from "react";
import { createEntry, useCreateEntry, getListEntriesQueryKey, useGetProject, getGetProjectQueryKey } from "@workspace/api-client-react";
import { createPortal } from "react-dom";
import { Bookmark, BookmarkCheck, ChevronLeft, ChevronRight, CornerUpLeft, Download, Pencil, X, MoreHorizontal, GitBranch, Share2, Archive, FileOutput } from "lucide-react";
import { toast } from "sonner";
import { useQueryClient } from "@tanstack/react-query";
import { addSnapshot, toggleBookmark as toggleSnapshotBookmark, rollbackTo, useAtlasHistory, type AtlasLens } from "@/lib/atlas-history";

import { CommitCard } from "../CommitCard";
import { PlanCard } from "../PlanCard";
import { MarkdownProse } from "../MessageRenderer";
import { ResearchCard } from "../ResearchCard";
import { ThoughtForBadge } from "../ThoughtForBadge";

import { InsightChip } from "@/components/workspace/InsightChip";
import { GitHubPushModal } from "@/components/workspace/GitHubPushModal";
import { DiffViewer } from "@/components/code/DiffViewer";
import SketchReveal from "@/components/chat/SketchReveal";
import InlineSketchOffer from "@/components/chat/InlineSketchOffer";
import { useGithubPushToken } from "@/hooks/useGithubPushToken";
import {
  ICON_TOUCH_TARGET_STYLE,
  computeLineDiff,
  type PlanState,
} from "@/components/workspace/chatShared";

import { detectDecisionMoment } from "@/lib/DecisionCatchEngine";
import type { CommitCardPayload } from "@/lib/DecisionCatchEngine";
import type { Plan, PlanExecution } from "../../lib/plan";
import { haptic } from "@/lib/long-press-tip";


import type {
  ChatMessage,
  FileEdit,
  LinePatch,
  LinkedRepo,
  PushRecord,
  ClarifyPayload,
  AlertPayload,
} from "@/pages/workspace";

function formatModelUsedLabel(modelUsed?: string | null): string | null {
  if (!modelUsed) return null;
  const normalized = modelUsed.toLowerCase().replace(/[\s_.]+/g, "-");
  if (normalized.includes("haiku")) return "Claude Haiku";
  if (normalized.includes("sonnet") || normalized === "claude") return "Claude Sonnet 4.6";
  if (normalized.includes("gpt-4o") || normalized.includes("gpt4o")) return "GPT-4o";
  if (normalized.includes("gemini") && normalized.includes("flash")) return "Gemini Flash";
  if (normalized.includes("gemini") && (normalized.includes("pro") || normalized === "gemini")) return "Gemini Pro";
  return null;
}

function ProactiveAlertCard({
  payload, projectId, sessionId, onDismiss,
}: {
  payload: AlertPayload; projectId: number; sessionId: number; onDismiss: () => void;
}) {
  const createEntry = useCreateEntry();
  const queryClient = useQueryClient();
  const handleNote = () => {
    createEntry.mutate(
      { projectId, data: { title: payload.headline, summary: payload.detail, status: "committed", severity: "neutral", mode: "THINK", sessionId } },
      { onSuccess: () => { queryClient.invalidateQueries({ queryKey: getListEntriesQueryKey(projectId, {}) }); onDismiss(); } }
    );
  };
  return (
    <div role="status" aria-label="Atlas notice" className="atlas-bubble-in"
      style={{ marginTop: 8, padding: "10px 12px", borderRadius: 8,
        background: "color-mix(in oklab, var(--atlas-gold) 5%, var(--atlas-surface))",
        border: "0.5px solid color-mix(in oklab, var(--atlas-gold) 28%, transparent)" }}>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 6 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
          <span style={{ width: 5, height: 5, borderRadius: "50%", flexShrink: 0, background: "var(--atlas-gold)", boxShadow: "0 0 6px color-mix(in oklab, var(--atlas-gold) 48%, transparent)" }} />
          <span style={{ fontFamily: "var(--app-font-mono)", fontSize: 9, letterSpacing: "0.14em", textTransform: "uppercase" as const, color: "var(--atlas-gold)", opacity: 0.85 }}>
            {payload.headline}
          </span>
        </div>
        <button onClick={() => { haptic.short(); onDismiss(); }} title="Dismiss" aria-label="Dismiss notice"
          style={{ background: "transparent", border: "none", cursor: "pointer", color: "var(--atlas-muted)", fontSize: 14, lineHeight: 1, padding: "2px 4px", opacity: 0.45 }}>x</button>
      </div>
      <p style={{ margin: "0 0 9px", fontSize: 12, lineHeight: 1.6, color: "var(--atlas-fg)", opacity: 0.75 }}>
        {payload.detail}
      </p>
      <div style={{ display: "flex", gap: 6 }}>
        <button disabled={createEntry.isPending} onClick={handleNote}
          style={{ padding: "4px 11px", fontSize: 9.5, fontWeight: 600, fontFamily: "var(--app-font-mono)", letterSpacing: "0.1em", textTransform: "uppercase" as const, background: "transparent",
            color: "color-mix(in oklab, var(--atlas-gold) 85%, var(--atlas-fg))", border: "0.5px solid color-mix(in oklab, var(--atlas-gold) 42%, transparent)", borderRadius: 4,
            cursor: createEntry.isPending ? "not-allowed" : "pointer", opacity: createEntry.isPending ? 0.5 : 1 }}>
          {createEntry.isPending ? "Noting..." : (payload.action || "Note it")}
        </button>
        <button onClick={onDismiss}
          style={{ padding: "4px 11px", fontSize: 9.5, fontWeight: 600, fontFamily: "var(--app-font-mono)", letterSpacing: "0.1em", textTransform: "uppercase" as const, background: "transparent",
            color: "var(--atlas-muted)", border: "0.5px solid color-mix(in oklab, var(--atlas-border) 70%, transparent)", borderRadius: 4, cursor: "pointer", opacity: 0.6 }}>
          Got it
        </button>
      </div>
    </div>
  );
}

type InlinePreviewLine = { type: "added" | "removed"; line: string };

function InlineDiffCard({
  fileEdits,
  linePatches,
  linkedRepo,
  projectId,
  trustMode,
  onReviewDiff,
  onPushSuccess,
  onEditDeclined,
  onPrCreated,
}: {
  fileEdits: FileEdit[];
  linePatches: LinePatch[];
  linkedRepo: LinkedRepo | null;
  projectId: number;
  trustMode: "review" | "auto";
  onReviewDiff: () => void;
  onPushSuccess: (records: PushRecord[]) => void;
  onEditDeclined?: () => void;
  onPrCreated?: (prUrl: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const [viewMode, setViewMode] = useState<"unified" | "split">("unified");
  const [applying, setApplying] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [patchedEdits, setPatchedEdits] = useState<FileEdit[] | null>(null);
  const [showPushModal, setShowPushModal] = useState(false);
  const [originals, setOriginals] = useState<Record<string, string | null>>({});
  const pushSucceededRef = useRef(false);

  const { data: project } = useGetProject(projectId, { query: { queryKey: getGetProjectQueryKey(projectId) } });
  const token = useGithubPushToken(project?.githubToken);
  const fileEditKey = fileEdits.map((edit) => `${edit.path}:${edit.content.length}`).join("|");

  useEffect(() => {
    if (fileEdits.length === 0) return;
    // Without a linked repo + token we can't fetch originals — render every edit as
    // a "New file" diff so the FILE_EDIT flow stays visible. Pushing still requires
    // the repo + token, but reviewing the change should not.
    if (!linkedRepo || !token) {
      setOriginals(Object.fromEntries(fileEdits.map((edit) => [edit.path, null])));
      return;
    }
    let cancelled = false;
    void Promise.all(
      fileEdits.map(async (edit) => {
        try {
          const r = await fetch(
            `/api/github/file?repo=${encodeURIComponent(linkedRepo.fullName)}&path=${encodeURIComponent(edit.path)}&branch=${encodeURIComponent(linkedRepo.defaultBranch)}`,
            { headers: { "x-github-token": token } }
          );
          if (!r.ok) return [edit.path, null] as const;
          const d = await r.json() as { content?: string };
          return [edit.path, d.content ?? null] as const;
        } catch {
          return [edit.path, null] as const;
        }
      })
    ).then((entries) => {
      if (cancelled) return;
      setOriginals(Object.fromEntries(entries));
    });
    return () => { cancelled = true; };
  }, [fileEditKey, linkedRepo?.fullName, linkedRepo?.defaultBranch, token]);

  const patchGroups = useMemo(() => {
    const groups: Record<string, LinePatch[]> = {};
    for (const patch of linePatches) {
      if (!groups[patch.path]) groups[patch.path] = [];
      groups[patch.path].push(patch);
    }
    return groups;
  }, [linePatches]);

  const previewLines = useMemo<InlinePreviewLine[]>(() => {
    if (fileEdits.length > 0) {
      return fileEdits.flatMap((edit) => {
        const original = originals[edit.path];
        const lines = original !== undefined && original !== null
          ? computeLineDiff(original, edit.content).filter((line) => line.type !== "context")
          : edit.content.split("\n").map((line) => ({ type: "added" as const, line }));
        return lines.map((line) => ({ type: line.type as "added" | "removed", line: line.line }));
      });
    }
    return linePatches.flatMap((patch) => [
      ...patch.find.split("\n").map((line) => ({ type: "removed" as const, line })),
      ...patch.replace.split("\n").map((line) => ({ type: "added" as const, line })),
    ]);
  }, [fileEdits, linePatches, originals]);

  const targetPaths = fileEdits.length > 0
    ? fileEdits.map((edit) => edit.path)
    : Object.keys(patchGroups);
  const firstPath = targetPaths[0] ?? "changes";
  const filename = targetPaths.length > 1
    ? `${firstPath.split("/").pop() ?? firstPath} +${targetPaths.length - 1}`
    : firstPath;
  const changedCount = previewLines.length;
  const visibleLines = open ? previewLines : previewLines.slice(0, 3);

  const applyLinePatches = async () => {
    if (!linkedRepo) { setError("No repo linked — connect a GitHub repo in the Files tab."); return; }
    if (!token) { setError("No GitHub token — connect GitHub from your home page."); return; }
    setApplying(true);
    setError(null);
    try {
      const edits: FileEdit[] = [];
      for (const [filePath, patches] of Object.entries(patchGroups)) {
        const r = await fetch(
          `/api/github/file?repo=${encodeURIComponent(linkedRepo.fullName)}&path=${encodeURIComponent(filePath)}&branch=${encodeURIComponent(linkedRepo.defaultBranch)}`,
          { headers: { "x-github-token": token } }
        );
        if (!r.ok) throw new Error(`Could not fetch ${filePath.split("/").pop()} (${r.status})`);
        const data = await r.json() as { content: string };
        let content = data.content;
        for (const patch of patches) {
          const idx = content.indexOf(patch.find);
          if (idx === -1) throw new Error(`Anchor not found in ${filePath.split("/").pop()}. Ask Atlas to re-read the file first.`);
          content = content.slice(0, idx) + patch.replace + content.slice(idx + patch.find.length);
        }
        const ext = filePath.split(".").pop() ?? "";
        const language = ["ts", "tsx"].includes(ext) ? "typescript" : ["js", "jsx"].includes(ext) ? "javascript" : ext;
        edits.push({ path: filePath, language, content });
      }
      setPatchedEdits(edits);
      pushSucceededRef.current = false;
      setShowPushModal(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not apply patches.");
    } finally {
      setApplying(false);
    }
  };

  const handleApply = () => {
    if (fileEdits.length > 0) {
      pushSucceededRef.current = false;
      setShowPushModal(true);
      return;
    }
    void applyLinePatches();
  };

  const modalEdits = fileEdits.length > 0 ? fileEdits : patchedEdits;

  if (trustMode === "auto") {
    return (
      <div style={{ marginTop: 12, fontFamily: "var(--app-font-mono)", fontSize: 10, color: "var(--atlas-muted)", opacity: 0.65 }}>
        Applied automatically
      </div>
    );
  }

  return (
    <>
      <div
        style={{
          marginTop: 12,
          borderRadius: 8,
          background: "var(--atlas-surface)",
          border: "1px solid var(--atlas-border)",
          overflow: "hidden",
        }}
      >
        <button
          type="button"
          onClick={() => setOpen((value) => !value)}
          aria-label={open ? "Collapse" : "Expand"}
          style={{ width: "100%", display: "flex", alignItems: "center", gap: 8, padding: "9px 12px", borderBottom: open ? "1px solid var(--atlas-border)" : "none", background: "transparent", borderLeft: "none", borderRight: "none", borderTop: "none", cursor: "pointer", textAlign: "left" }}
        >
          <svg width="10" height="10" viewBox="0 0 10 10" fill="none" style={{ flexShrink: 0, transition: "transform 160ms ease", transform: open ? "rotate(90deg)" : "rotate(0deg)", opacity: 0.55 }}>
            <path d="M3 2l4 3-4 3" stroke="var(--atlas-fg)" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
          <span style={{ flex: 1, minWidth: 0, fontFamily: "var(--app-font-mono)", fontSize: 10.5, color: "var(--atlas-fg)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
            {filename}
          </span>
          <span style={{ fontFamily: "var(--app-font-mono)", fontSize: 9.5, color: "var(--atlas-muted)", opacity: 0.7 }}>
            {changedCount} line{changedCount === 1 ? "" : "s"} changed
          </span>
          <span
            role="group"
            aria-label="Diff view mode"
            onClick={(e) => e.stopPropagation()}
            style={{ display: "inline-flex", marginLeft: 8, border: "0.5px solid var(--atlas-border)", borderRadius: 4, overflow: "hidden" }}
          >
            {(["unified", "split"] as const).map((mode) => {
              const active = viewMode === mode;
              return (
                <button
                  key={mode}
                  type="button"
                  onClick={(e) => { e.stopPropagation(); setViewMode(mode); }}
                  style={{
                    padding: "2px 7px", fontSize: 9, fontWeight: 600, fontFamily: "var(--app-font-mono)",
                    letterSpacing: "0.08em", textTransform: "uppercase" as const, cursor: "pointer",
                    background: active ? "color-mix(in oklab, var(--atlas-fg) 10%, transparent)" : "transparent",
                    color: active ? "var(--atlas-fg)" : "var(--atlas-muted)", border: "none",
                  }}
                >
                  {mode}
                </button>
              );
            })}
          </span>
        </button>

        <div style={{ background: "var(--atlas-bg)", fontFamily: "var(--app-font-mono)", fontSize: 10.5, lineHeight: 1.55 }}>
          {fileEdits.length === 1 && originals[fileEdits[0].path] !== undefined ? (
            <DiffViewer
              before={originals[fileEdits[0].path] ?? ""}
              after={fileEdits[0].content}
              viewMode={viewMode === "split" ? "split" : "inline"}
              maxHeight={open ? 420 : 180}
              badge={originals[fileEdits[0].path] == null ? "New file" : undefined}
            />
          ) : viewMode === "unified" ? visibleLines.map((line, idx) => {
            const added = line.type === "added";
            return (
              <div
                key={`${idx}-${line.type}-${line.line}`}
                style={{
                  display: "flex",
                  alignItems: "flex-start",
                  background: added
                    ? "color-mix(in oklab, var(--atlas-phosphor) 8%, transparent)"
                    : "color-mix(in oklab, var(--atlas-ember) 8%, transparent)",
                  borderLeft: `2px solid ${added ? "var(--atlas-phosphor)" : "var(--atlas-ember)"}`,
                }}
              >
                <span style={{ width: 18, flexShrink: 0, textAlign: "center", color: added ? "var(--atlas-phosphor)" : "var(--atlas-ember)", userSelect: "none" as const }}>
                  {added ? "+" : "-"}
                </span>
                <span style={{ flex: 1, padding: "1px 8px 1px 0", color: "var(--atlas-muted)", whiteSpace: "pre-wrap", wordBreak: "break-word" }}>
                  {line.line || " "}
                </span>
              </div>
            );
          }) : (() => {
            // Split view: pair adjacent removed/added runs side-by-side
            type Row = { left: string | null; right: string | null };
            const rows: Row[] = [];
            let i = 0;
            while (i < visibleLines.length) {
              const removed: string[] = [];
              const added: string[] = [];
              while (i < visibleLines.length && visibleLines[i].type === "removed") { removed.push(visibleLines[i].line); i++; }
              while (i < visibleLines.length && visibleLines[i].type === "added") { added.push(visibleLines[i].line); i++; }
              const len = Math.max(removed.length, added.length);
              if (len === 0) { i++; continue; }
              for (let k = 0; k < len; k++) {
                rows.push({ left: k < removed.length ? removed[k] : null, right: k < added.length ? added[k] : null });
              }
            }
            const cell = (text: string | null, kind: "removed" | "added") => (
              <div style={{
                flex: 1, minWidth: 0, display: "flex", alignItems: "flex-start",
                background: text === null ? "transparent"
                  : kind === "added" ? "color-mix(in oklab, var(--atlas-phosphor) 8%, transparent)"
                  : "color-mix(in oklab, var(--atlas-ember) 8%, transparent)",
                borderLeft: text === null ? "2px solid transparent" : `2px solid ${kind === "added" ? "var(--atlas-phosphor)" : "var(--atlas-ember)"}`,
              }}>
                <span style={{ width: 18, flexShrink: 0, textAlign: "center", color: kind === "added" ? "var(--atlas-phosphor)" : "var(--atlas-ember)", userSelect: "none" as const }}>
                  {text === null ? " " : kind === "added" ? "+" : "-"}
                </span>
                <span style={{ flex: 1, minWidth: 0, padding: "1px 8px 1px 0", color: "var(--atlas-muted)", whiteSpace: "pre-wrap", wordBreak: "break-word" }}>
                  {text === null ? " " : (text || " ")}
                </span>
              </div>
            );
            return rows.map((row, idx) => (
              <div key={`split-${idx}`} style={{ display: "flex", gap: 1, borderBottom: "1px solid color-mix(in oklab, var(--atlas-border) 40%, transparent)" }}>
                {cell(row.left, "removed")}
                {cell(row.right, "added")}
              </div>
            ));
          })()}
          {!open && fileEdits.length !== 1 && previewLines.length > 3 && (
            <div style={{ padding: "4px 12px", color: "var(--atlas-muted)", opacity: 0.45 }}>
              + {previewLines.length - 3} more changed line{previewLines.length - 3 === 1 ? "" : "s"}
            </div>
          )}
        </div>


        <div style={{ display: "flex", justifyContent: "flex-end", gap: 7, padding: "8px 10px", borderTop: "1px solid var(--atlas-border)" }}>
          {fileEdits.length > 0 && (
            <>
              <button
                type="button"
                onClick={(e) => {
                  e.stopPropagation();
                  const text = fileEdits.length === 1
                    ? fileEdits[0].content
                    : fileEdits.map((ed) => `// ===== ${ed.path} =====\n${ed.content}`).join("\n\n");
                  void navigator.clipboard.writeText(text);
                }}
                title="Copy full file content"
                style={{ padding: "5px 10px", borderRadius: 5, background: "transparent", border: "1px solid var(--atlas-border)", color: "var(--atlas-muted)", cursor: "pointer", fontFamily: "var(--app-font-mono)", fontSize: 10, letterSpacing: "0.06em" }}
              >
                Copy
              </button>
              <button
                type="button"
                onClick={(e) => {
                  e.stopPropagation();
                  for (const ed of fileEdits) {
                    const blob = new Blob([ed.content], { type: "text/plain;charset=utf-8" });
                    const url = URL.createObjectURL(blob);
                    const a = document.createElement("a");
                    a.href = url;
                    a.download = ed.path.split("/").pop() ?? "file.txt";
                    document.body.appendChild(a);
                    a.click();
                    document.body.removeChild(a);
                    URL.revokeObjectURL(url);
                  }
                }}
                title="Download full file"
                style={{ padding: "5px 10px", borderRadius: 5, background: "transparent", border: "1px solid var(--atlas-border)", color: "var(--atlas-muted)", cursor: "pointer", fontFamily: "var(--app-font-mono)", fontSize: 10, letterSpacing: "0.06em" }}
              >
                Download
              </button>
            </>
          )}
          <button
            type="button"
            onClick={(e) => { e.stopPropagation(); onReviewDiff(); }}
            style={{ padding: "5px 10px", borderRadius: 5, background: "transparent", border: "1px solid var(--atlas-border)", color: "var(--atlas-muted)", cursor: "pointer", fontFamily: "var(--app-font-mono)", fontSize: 10, letterSpacing: "0.06em" }}
          >
            Review in Diff →
          </button>
          <button
            type="button"
            disabled={applying}
            onClick={(e) => { e.stopPropagation(); handleApply(); }}
            style={{ padding: "5px 12px", borderRadius: 5, background: "var(--atlas-gold)", border: "1px solid var(--atlas-gold)", color: "var(--atlas-bg)", cursor: applying ? "not-allowed" : "pointer", fontFamily: "var(--app-font-mono)", fontSize: 10, fontWeight: 700, letterSpacing: "0.06em", opacity: applying ? 0.55 : 1 }}
          >
            {applying ? "Applying..." : "Apply"}
          </button>
        </div>

      </div>

      {error && (
        <div style={{ marginTop: 8, padding: "8px 12px", borderRadius: 6, background: "color-mix(in oklab, var(--atlas-ember) 9%, transparent)", border: "1px solid color-mix(in oklab, var(--atlas-ember) 24%, transparent)", color: "var(--atlas-ember)", fontFamily: "var(--app-font-mono)", fontSize: 11, lineHeight: 1.55 }}>
          {error}
        </div>
      )}

      {showPushModal && modalEdits && modalEdits.length > 0 && (
        <GitHubPushModal
          fileEdits={modalEdits}
          linkedRepo={linkedRepo}
          projectId={projectId}
          onClose={() => { setShowPushModal(false); if (!pushSucceededRef.current) onEditDeclined?.(); }}
          onPushSuccess={(records) => { pushSucceededRef.current = true; onPushSuccess(records); setShowPushModal(false); }}
          onPrCreated={onPrCreated}
        />
      )}
    </>
  );
}

function MigrationCard({ sql }: { sql: string }) {
  const [copied, setCopied] = useState(false);

  const handleCopy = () => {
    navigator.clipboard.writeText(sql).catch(() => {});
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <div
      style={{
        marginTop: 10,
        borderRadius: 8,
        border: "1px solid rgba(201,162,76,0.28)",
        background: "rgba(201,162,76,0.04)",
        overflow: "hidden",
      }}
    >
      {/* Header */}
      <div
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          padding: "7px 12px",
          borderBottom: "1px solid rgba(201,162,76,0.15)",
          background: "rgba(201,162,76,0.06)",
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: 7 }}>
          {/* DB icon */}
          <svg width="11" height="11" viewBox="0 0 16 16" fill="none" style={{ flexShrink: 0 }}>
            <ellipse cx="8" cy="4" rx="6" ry="2.2" stroke="rgba(201,162,76,0.8)" strokeWidth="1.3" />
            <path d="M2 4v4c0 1.21 2.69 2.2 6 2.2s6-.99 6-2.2V4" stroke="rgba(201,162,76,0.8)" strokeWidth="1.3" />
            <path d="M2 8v4c0 1.21 2.69 2.2 6 2.2s6-.99 6-2.2V8" stroke="rgba(201,162,76,0.8)" strokeWidth="1.3" />
          </svg>
          <span
            style={{
              fontFamily: "var(--app-font-mono)",
              fontSize: 9,
              letterSpacing: "0.13em",
              textTransform: "uppercase" as const,
              color: "rgba(201,162,76,0.85)",
            }}
          >
            Schema Change
          </span>
        </div>
        <button
          type="button"
          onClick={handleCopy}
          style={{
            padding: "4px 10px",
            borderRadius: 5,
            border: "1px solid rgba(201,162,76,0.35)",
            background: copied ? "rgba(201,162,76,0.18)" : "transparent",
            color: copied ? "rgba(201,162,76,1)" : "rgba(201,162,76,0.7)",
            fontSize: 10,
            fontFamily: "var(--app-font-mono)",
            letterSpacing: "0.08em",
            cursor: "pointer",
            transition: "all 140ms ease",
          }}
        >
          {copied ? "Copied ✓" : "Copy SQL"}
        </button>
      </div>

      {/* SQL body */}
      <pre
        style={{
          margin: 0,
          padding: "10px 12px",
          fontFamily: "var(--app-font-mono)",
          fontSize: 11.5,
          lineHeight: 1.7,
          color: "rgba(231,229,228,0.85)",
          overflowX: "auto",
          whiteSpace: "pre",
        }}
      >
        {sql}
      </pre>
    </div>
  );
}

type ClarifyAnswer = {
  value: string;
  skipped: boolean;
};

function ClarifyCard({
  clarify,
  onSend,
}: {
  clarify: ClarifyPayload;
  onSend?: (message: string) => void;
}) {
  const steps = useMemo(
    () => clarify.steps.filter((step) => step.question.trim().length > 0),
    [clarify.steps],
  );
  const [stepIndex, setStepIndex] = useState(0);
  const [answers, setAnswers] = useState<Record<number, ClarifyAnswer>>({});
  const [freeTextOpen, setFreeTextOpen] = useState<Record<number, boolean>>({});
  const [freeTextValues, setFreeTextValues] = useState<Record<number, string>>({});
  const [done, setDone] = useState(false);

  if (done || steps.length === 0) return null;

  const activeStepIndex = Math.min(stepIndex, steps.length - 1);
  const step = steps[activeStepIndex];
  const isMultiStep = steps.length > 1;
  const currentAnswer = answers[activeStepIndex];
  const options = step.options ?? [];
  const freeTextValue = freeTextValues[activeStepIndex] ?? "";
  const isFreeTextOpen = freeTextOpen[activeStepIndex] === true;

  const finish = (nextAnswers: Record<number, ClarifyAnswer>) => {
    const hasAnyAnswer = Object.values(nextAnswers).some((answer) => !answer.skipped && answer.value.trim().length > 0);
    if (hasAnyAnswer) {
      const response = steps
        .map((answeredStep, index) => {
          const answer = nextAnswers[index];
          if (!answer) return null;
          return `Q: ${answeredStep.question} → A: ${answer.skipped ? "Skipped" : answer.value}`;
        })
        .filter((line): line is string => Boolean(line))
        .join("\n");
      if (response) onSend?.(response);
    }
    setDone(true);
  };

  const recordAnswer = (value: string, skipped = false) => {
    const normalizedValue = value.trim();
    if (!skipped && !normalizedValue) return;

    if (!isMultiStep) {
      if (!skipped) onSend?.(normalizedValue);
      setDone(true);
      return;
    }

    const nextAnswers = {
      ...answers,
      [activeStepIndex]: { value: normalizedValue, skipped },
    };
    setAnswers(nextAnswers);

    if (activeStepIndex >= steps.length - 1) {
      finish(nextAnswers);
    } else {
      setStepIndex(activeStepIndex + 1);
    }
  };

  const handleFreeTextSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    recordAnswer(freeTextValue);
  };

  const optionRowStyle = (selected: boolean) => ({
    width: "100%",
    minHeight: 46,
    display: "flex",
    alignItems: "center",
    gap: 10,
    padding: "10px 12px",
    borderRadius: 9,
    border: selected
      ? "1px solid color-mix(in oklab, var(--atlas-gold) 62%, transparent)"
      : "1px solid color-mix(in oklab, var(--atlas-border) 82%, transparent)",
    background: selected
      ? "color-mix(in oklab, var(--atlas-gold) 10%, transparent)"
      : "color-mix(in oklab, var(--atlas-surface-alt) 70%, transparent)",
    color: "var(--atlas-fg)",
    cursor: "pointer",
    textAlign: "left" as const,
    fontFamily: "var(--app-font-sans)",
    fontSize: 14,
    lineHeight: 1.35,
    WebkitTapHighlightColor: "transparent",
  });

  const iconButtonStyle = (disabled = false) => ({
    width: 30,
    height: 30,
    borderRadius: 8,
    border: "1px solid color-mix(in oklab, var(--atlas-border) 70%, transparent)",
    background: "transparent",
    color: disabled ? "color-mix(in oklab, var(--atlas-muted) 45%, transparent)" : "var(--atlas-muted)",
    cursor: disabled ? "default" : "pointer",
    display: "inline-flex",
    alignItems: "center",
    justifyContent: "center",
    opacity: disabled ? 0.45 : 0.85,
  });

  return (
    <div
      role="group"
      aria-label="Clarification"
      className="atlas-bubble-in"
      style={{
        marginTop: 12,
        maxWidth: 430,
        borderRadius: 14,
        border: "1px solid color-mix(in oklab, var(--atlas-gold) 24%, var(--atlas-border))",
        background: "linear-gradient(180deg, color-mix(in oklab, var(--atlas-surface) 94%, transparent), color-mix(in oklab, var(--atlas-bg) 88%, transparent))",
        boxShadow: "0 16px 42px rgba(0,0,0,0.28), inset 0 1px 0 rgba(255,255,255,0.035)",
        padding: 14,
      }}
    >
      <div style={{ display: "flex", alignItems: "flex-start", gap: 12, marginBottom: 12 }}>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div
            style={{
              fontFamily: "var(--app-font-mono)",
              fontSize: 9,
              letterSpacing: "0.13em",
              textTransform: "uppercase",
              color: "var(--atlas-gold)",
              opacity: 0.78,
              marginBottom: 6,
            }}
          >
            Clarify
          </div>
          <div style={{ fontSize: 15, lineHeight: 1.45, color: "var(--atlas-fg)", fontWeight: 600 }}>
            {step.question}
          </div>
        </div>

        {isMultiStep && (
          <div style={{ display: "flex", alignItems: "center", gap: 4, flexShrink: 0 }}>
            <button
              type="button"
              aria-label="Previous clarification step"
              disabled={activeStepIndex === 0}
              onClick={() => setStepIndex((index) => Math.max(0, index - 1))}
              style={iconButtonStyle(activeStepIndex === 0)}
            >
              <ChevronLeft size={15} strokeWidth={1.8} />
            </button>
            <div
              aria-label={`Step ${activeStepIndex + 1} of ${steps.length}`}
              style={{
                minWidth: 44,
                textAlign: "center",
                fontFamily: "var(--app-font-mono)",
                fontSize: 10,
                color: "var(--atlas-muted)",
                opacity: 0.8,
              }}
            >
              {activeStepIndex + 1} of {steps.length}
            </div>
            <button
              type="button"
              aria-label="Next clarification step"
              disabled={activeStepIndex >= steps.length - 1}
              onClick={() => setStepIndex((index) => Math.min(steps.length - 1, index + 1))}
              style={iconButtonStyle(activeStepIndex >= steps.length - 1)}
            >
              <ChevronRight size={15} strokeWidth={1.8} />
            </button>
            <button
              type="button"
              aria-label="Dismiss clarification"
              onClick={() => setDone(true)}
              style={iconButtonStyle()}
            >
              <X size={14} strokeWidth={1.8} />
            </button>
          </div>
        )}
      </div>

      <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
        {options.map((option, index) => {
          const selected = !currentAnswer?.skipped && currentAnswer?.value === option;
          return (
            <button
              key={`${option}-${index}`}
              type="button"
              onClick={() => recordAnswer(option)}
              style={optionRowStyle(selected)}
            >
              <span
                aria-hidden
                style={{
                  width: 25,
                  height: 25,
                  borderRadius: 999,
                  display: "inline-flex",
                  alignItems: "center",
                  justifyContent: "center",
                  flexShrink: 0,
                  background: selected
                    ? "color-mix(in oklab, var(--atlas-gold) 22%, transparent)"
                    : "color-mix(in oklab, var(--atlas-fg) 7%, transparent)",
                  color: selected ? "var(--atlas-gold)" : "var(--atlas-muted)",
                  fontFamily: "var(--app-font-mono)",
                  fontSize: 11,
                  fontWeight: 700,
                }}
              >
                {index + 1}
              </span>
              <span style={{ flex: 1 }}>{option}</span>
            </button>
          );
        })}

        {step.allowFreeText && (
          <>
            <button
              type="button"
              onClick={() => setFreeTextOpen((open) => ({ ...open, [activeStepIndex]: true }))}
              style={optionRowStyle(isFreeTextOpen && !currentAnswer?.skipped && currentAnswer?.value === freeTextValue.trim() && freeTextValue.trim().length > 0)}
            >
              <span
                aria-hidden
                style={{
                  width: 25,
                  height: 25,
                  borderRadius: 999,
                  display: "inline-flex",
                  alignItems: "center",
                  justifyContent: "center",
                  flexShrink: 0,
                  background: "color-mix(in oklab, var(--atlas-gold) 10%, transparent)",
                  color: "var(--atlas-gold)",
                }}
              >
                <Pencil size={13} strokeWidth={1.8} />
              </span>
              <span style={{ flex: 1 }}>Something else</span>
            </button>
            {isFreeTextOpen && (
              <form onSubmit={handleFreeTextSubmit} style={{ display: "flex", gap: 8 }}>
                <input
                  value={freeTextValue}
                  onChange={(event) => setFreeTextValues((values) => ({ ...values, [activeStepIndex]: event.target.value }))}
                  autoFocus
                  placeholder="Type your answer..."
                  aria-label="Clarification free text answer"
                  style={{
                    flex: 1,
                    minWidth: 0,
                    minHeight: 42,
                    borderRadius: 9,
                    border: "1px solid color-mix(in oklab, var(--atlas-border) 88%, transparent)",
                    background: "color-mix(in oklab, var(--atlas-bg) 76%, transparent)",
                    color: "var(--atlas-fg)",
                    padding: "8px 11px",
                    fontSize: 14,
                    outline: "none",
                  }}
                />
                <button
                  type="submit"
                  style={{
                    minHeight: 42,
                    padding: "0 13px",
                    borderRadius: 9,
                    border: "1px solid var(--atlas-gold)",
                    background: "var(--atlas-gold)",
                    color: "var(--atlas-bg)",
                    cursor: "pointer",
                    fontFamily: "var(--app-font-mono)",
                    fontSize: 10,
                    fontWeight: 700,
                    letterSpacing: "0.08em",
                    textTransform: "uppercase",
                  }}
                >
                  Send
                </button>
              </form>
            )}
          </>
        )}

        <button
          type="button"
          onClick={() => recordAnswer("", true)}
          style={{
            width: "100%",
            minHeight: 42,
            borderRadius: 9,
            border: "1px solid color-mix(in oklab, var(--atlas-border) 66%, transparent)",
            background: "transparent",
            color: "var(--atlas-muted)",
            cursor: "pointer",
            fontFamily: "var(--app-font-mono)",
            fontSize: 10.5,
            letterSpacing: "0.08em",
            textTransform: "uppercase",
          }}
        >
          Skip
        </button>
      </div>

      <div
        style={{
          marginTop: 12,
          paddingTop: 10,
          borderTop: "1px solid color-mix(in oklab, var(--atlas-border) 56%, transparent)",
          fontSize: 12,
          lineHeight: 1.45,
          color: "var(--atlas-muted)",
          opacity: 0.72,
        }}
      >
        Or reply directly in the composer below.
      </div>
    </div>
  );
}

// ── AssistantBubble ───────────────────────────────────────────────────────────
export function AssistantBubble({
  message,
  isNew = false,
  projectId,
  sessionId,
  linkedRepo,
  onPark,
  onCommit,
  onRegenerate,
  onSend,
  onPushSuccess,
  onPreviewCode,
  onPrCreated,
  onRunCommand,
  onExtractToForge,
  onForgeIntake,
  onReviewDiff,
  onOpenArtifact,
  onEditDeclined,
  onAlertDismiss,
  onStreamActivityUpdate,
  onStreamActivityComplete,
  onCommitCardDone,
  planState,
  planExecution,
  onPlanStateChange,
  onPlanExecutionChange,
  onExecuteHomePlan,
  trustMode,
}: {
  message: ChatMessage;
  isNew?: boolean;
  projectId: number;
  sessionId: number;
  linkedRepo: LinkedRepo | null;
  onPark: (content: string) => void;
  onCommit: (content: string) => void;
  onRegenerate: () => void;
  onSend?: (message: string) => void;
  onPushSuccess: (records: PushRecord[]) => void;
  onPreviewCode?: (code: string) => void;
  onPrCreated?: (prUrl: string) => void;
  onRunCommand?: (command: string) => void;
  onExtractToForge?: (content: string) => void;
  onForgeIntake?: (content: string) => Promise<void> | void;
  onReviewDiff: () => void;
  onOpenArtifact?: (title: string) => void;
  onEditDeclined?: () => void;
  onAlertDismiss?: () => void;
  onStreamActivityUpdate?: (content: string) => void;
  onStreamActivityComplete?: () => void;
  onCommitCardDone?: () => void;
  planState?: PlanState;
  planExecution?: PlanExecution;
  onPlanStateChange?: (messageId: number, state: PlanState) => void;
  onPlanExecutionChange?: (messageId: number, execution: PlanExecution | null) => void;
  onExecuteHomePlan?: (plan: Plan) => void;
  trustMode: "review" | "auto";
}) {
  const [hov, setHov] = useState(false);
  const [parkDone, setParkDone] = useState(false);
  const [intakeDone, setIntakeDone] = useState(false);
  const [commitDone, setCommitDone] = useState(false);
  const [showPushModal, setShowPushModal] = useState(false);
  const [showPlanPushModal, setShowPlanPushModal] = useState(false);
  const [planPushEdits, setPlanPushEdits] = useState<FileEdit[] | null>(null);
  const [copied, setCopied] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const [selfApplyStatus, setSelfApplyStatus] = useState<"idle" | "applying" | "done" | "error">("idle");
  const [selfApplyMsg, setSelfApplyMsg] = useState("");
  const [commitCardDone, setCommitCardDone] = useState(false);
  const [imageExpanded, setImageExpanded] = useState(false);
  const activeEdits = message.fileEdits ?? (message.fileEdit ? [message.fileEdit] : []);
  const planMessageId = message.id ?? 0;
  const { data: planProject } = useGetProject(projectId, { query: { queryKey: getGetProjectQueryKey(projectId) } });
  const planGithubToken = useGithubPushToken(planProject?.githubToken);

  // ── Time-travel snapshot (safeguard #1: capture AFTER stream closes) ──
  const { items: historyItems } = useAtlasHistory(projectId);
  const snapshotForMsg = useMemo(
    () => historyItems.find((s) => s.associated_message_id === message.id),
    [historyItems, message.id],
  );
  const isReverted = message.reverted === true;
  useEffect(() => {
    if (message.streaming) return;
    if (message.role !== "assistant") return;
    if (!message.id || !projectId) return;
    if (snapshotForMsg) return;
    const lens: AtlasLens =
      (message.intentType === "BUILD" && "builder") ||
      (message.intentType === "DECIDE" && "strategic") ||
      "minimal";
    const codeDelta = activeEdits.length
      ? activeEdits.map((e) => `${e.path}\n${e.content ?? ""}`).join("\n---\n")
      : undefined;
    addSnapshot(projectId, {
      associated_message_id: message.id,
      title: (message.content || "").split("\n")[0].slice(0, 80) || "Atlas response",
      lens,
      payload: {
        code_delta: codeDelta,
        active_file: activeEdits[0]?.path,
      },
    });
  }, [message.streaming, message.id, message.role, message.intentType, projectId, snapshotForMsg, message.content, activeEdits]);

  const imageGenDataUrl = !message.imageB64
    ? (() => {
        const raw = message.imageGen?.images?.[0]?.imageUrl;
        return typeof raw === "string" && raw.startsWith("data:image/") ? raw : "";
      })()
    : "";

  // Extract image URL from markdown image syntax in content if no base64
  const inlineImageUrl = !message.imageB64 && !imageGenDataUrl
    ? (() => {
        const match = message.content?.match(/!\[.*?\]\((https?:\/\/[^\s)]+)\)/);
        return match?.[1] ?? "";
      })()
    : "";
  const imageSrc = message.imageB64
    ? `data:${message.imageMimeType ?? "image/png"};base64,${message.imageB64}`
    : imageGenDataUrl || inlineImageUrl;
  const modelUsedLabel = formatModelUsedLabel(message.modelUsed);

  // Parse CMD_EXEC block from Atlas response
  const { cmdExec, cleanContent } = useMemo(() => {
    const m = message.content.match(/CMD_EXEC:(\{[^}]*\})/);
    if (m) {
      try {
        const parsed = JSON.parse(m[1]) as { command: string; description?: string };
        if (typeof parsed.command === "string") {
          return {
            cmdExec: parsed,
            cleanContent: message.content.replace(/\n?CMD_EXEC:\{[^}]*\}/g, "").trim(),
          };
        }
      } catch {}
    }
    return { cmdExec: null, cleanContent: message.content };
  }, [message.content]);

  // Parse DB_MIGRATION_START...DB_MIGRATION_END blocks from Atlas response
  const { migrationBlocks, displayContent: migrationDisplayContent } = useMemo(() => {
    const blocks: string[] = [];
    const pattern = /DB_MIGRATION_START\s*([\s\S]*?)\s*DB_MIGRATION_END/g;
    let match: RegExpExecArray | null;
    let stripped = cleanContent;
    while ((match = pattern.exec(cleanContent)) !== null) {
      const sql = match[1]?.trim();
      if (sql) blocks.push(sql);
    }
    if (blocks.length > 0) {
      stripped = cleanContent.replace(/\n?DB_MIGRATION_START[\s\S]*?DB_MIGRATION_END\n?/g, "").trim();
    }
    return { migrationBlocks: blocks, displayContent: stripped };
  }, [cleanContent]);

  const displayContent = (migrationDisplayContent ?? message.content ?? "")
    .replace(/!\[.*?\]\(https?:\/\/[^\s)]+\)/g, "")
    .trim();
  const hasImageClarify = (displayContent ?? "").includes("IMAGE_CLARIFY:");
  const cleanedContent = (displayContent ?? "")
    .replace(/^INTENT_TYPE:\s*\S+$/gm, "")
    .replace(/\n\nIMAGE_CLARIFY:[^\n]*/g, "")
    .replace(/- \*\*Cinematic\*\*[^\n]*/g, "")
    .replace(/- \*\*Blueprint\*\*[^\n]*/g, "")
    .trim();

  // Detect previewable code block (html, jsx, tsx, css, or untagged with HTML tags)
  const previewableCode = useMemo(() => {
    const regex = /```(\w*)\n([\s\S]+?)```/g;
    let match;
    const previewLangs = new Set(["html", "jsx", "tsx", "css", "vue", "svelte", ""]);
    while ((match = regex.exec(message.content)) !== null) {
      const lang = (match[1] ?? "").toLowerCase();
      const code = match[2] ?? "";
      if (previewLangs.has(lang) || /<[a-zA-Z][\s\S]*?>/.test(code)) return code;
    }
    return null;
  }, [message.content]);

  const SELF_PATH_RE = /^artifacts\/(atlas|api-server)\//;
  const selfEdits = activeEdits.filter((e) => SELF_PATH_RE.test(e.path));
  const userEdits = activeEdits.filter((e) => !SELF_PATH_RE.test(e.path));
  const commitPayload = useMemo<CommitCardPayload | null>(
    () => detectDecisionMoment(message.content),
    [message.content]
  );

  const setPlanStatus = (state: PlanState) => {
    if (!message.plan) return;
    onPlanStateChange?.(planMessageId, state);
  };

  const setPlanExecution = (execution: PlanExecution | null) => {
    if (!message.plan) return;
    onPlanExecutionChange?.(planMessageId, execution);
  };

  const resolvePlanLinePatches = async (): Promise<FileEdit[]> => {
    if (!message.linePatches?.length) return [];
    if (!linkedRepo) throw new Error("No repo linked - connect a GitHub repo in the Files tab.");
    if (!planGithubToken) throw new Error("No GitHub token — connect GitHub from your home page.");
    const groups: Record<string, LinePatch[]> = {};
    for (const patch of message.linePatches) {
      if (!groups[patch.path]) groups[patch.path] = [];
      groups[patch.path].push(patch);
    }
    const edits: FileEdit[] = [];
    for (const [filePath, patches] of Object.entries(groups)) {
      const r = await fetch(
        `/api/github/file?repo=${encodeURIComponent(linkedRepo.fullName)}&path=${encodeURIComponent(filePath)}&branch=${encodeURIComponent(linkedRepo.defaultBranch)}`,
        { headers: { "x-github-token": planGithubToken } }
      );
      if (!r.ok) throw new Error(`Could not fetch ${filePath.split("/").pop()} (${r.status})`);
      const data = await r.json() as { content: string };
      let content = data.content;
      for (const patch of patches) {
        const idx = content.indexOf(patch.find);
        if (idx === -1) throw new Error(`Anchor not found in ${filePath.split("/").pop()}. Ask Atlas to re-read the file first.`);
        content = content.slice(0, idx) + patch.replace + content.slice(idx + patch.find.length);
      }
      const ext = filePath.split(".").pop() ?? "";
      const language = ["ts", "tsx"].includes(ext) ? "typescript" : ["js", "jsx"].includes(ext) ? "javascript" : ext;
      edits.push({ path: filePath, language, content });
    }
    return edits;
  };

  const handlePlanApprove = async () => {
    if (!message.plan || planState === "executing") return;
    const firstStepOrder = message.plan.steps[0]?.order ?? 1;
    setPlanStatus("executing");
    setPlanExecution({ currentStepOrder: firstStepOrder, completedStepOrders: [] });
    onStreamActivityUpdate?.(`PLAN_STEP:${message.plan.steps[0]?.description ?? message.plan.title}`);

    const codeEdits = userEdits.length > 0 ? userEdits : activeEdits;
    const hasCodeChanges = codeEdits.length > 0 || (message.linePatches?.length ?? 0) > 0;

    if (message.planFromHome && !hasCodeChanges) {
      onExecuteHomePlan?.(message.plan);
      return;
    }

    if (!hasCodeChanges) {
      setPlanExecution({
        completedStepOrders: message.plan.steps.map((step) => step.order),
        changedFiles: 0,
        statusMessage: "Done. 0 files changed.",
      });
      setPlanStatus("completed");
      onStreamActivityComplete?.();
      return;
    }

    try {
      const patchEdits = await resolvePlanLinePatches();
      const modalEdits = [...codeEdits, ...patchEdits];
      if (modalEdits.length === 0) {
        setPlanExecution({
          completedStepOrders: message.plan.steps.map((step) => step.order),
          changedFiles: 0,
          statusMessage: "Done. 0 files changed.",
        });
        setPlanStatus("completed");
        onStreamActivityComplete?.();
        return;
      }
      const pushStep = message.plan.steps.find((step) => step.type === "push") ?? message.plan.steps[message.plan.steps.length - 1];
      setPlanExecution({
        currentStepOrder: pushStep?.order,
        completedStepOrders: message.plan.steps.filter((step) => step.order !== pushStep?.order).map((step) => step.order),
      });
      onStreamActivityUpdate?.(`PLAN_STEP:${pushStep?.description ?? "Review and push changes"}`);
      setPlanPushEdits(modalEdits);
      setShowPlanPushModal(true);
    } catch (error) {
      setPlanExecution({
        currentStepOrder: undefined,
        completedStepOrders: [],
        failedStep: {
          order: firstStepOrder,
          error: error instanceof Error ? error.message : "Plan execution failed.",
        },
      });
      setPlanStatus("pending");
      onStreamActivityComplete?.();
    }
  };

  const handleSelfApply = async () => {
    if (selfApplyStatus === "applying") return;
    setSelfApplyStatus("applying");
    setSelfApplyMsg("");
    let lastMsg = "";
    try {
      for (const edit of selfEdits) {
        const res = await fetch("/api/self/apply", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ path: edit.path, content: edit.content }),
        });
        const json = await res.json() as { ok?: boolean; message?: string; error?: string };
        if (!res.ok || !json.ok) throw new Error(json.error ?? "Apply failed");
        lastMsg = json.message ?? "Applied.";
      }
      setSelfApplyStatus("done");
      setSelfApplyMsg(lastMsg);
    } catch (err: unknown) {
      setSelfApplyStatus("error");
      setSelfApplyMsg(err instanceof Error ? err.message : "Unknown error");
    }
  };

  const handleDownloadImage = () => {
    if (!imageSrc) return;
    const link = document.createElement("a");
    link.href = imageSrc;
    link.download = "atlas-sketch.png";
    link.click();
  };

  return (
    <div
      className="atlas-bubble-in"
      data-msg-id={message.id ?? undefined}
      style={{
        display: "flex",
        justifyContent: "flex-start",
        marginBottom: 32,
        opacity: isReverted ? 0.42 : 1,
        filter: isReverted ? "grayscale(0.6)" : undefined,
        transition: "opacity 220ms ease, filter 220ms ease",
      }}
      onMouseEnter={() => setHov(true)}
      onMouseLeave={() => setHov(false)}
    >
      {isReverted && (
        <span
          style={{
            position: "absolute",
            marginLeft: -6, marginTop: -2,
            padding: "2px 7px",
            fontSize: 9, fontWeight: 600, letterSpacing: "0.14em",
            textTransform: "uppercase",
            color: "rgba(228,196,128,0.95)",
            background: "rgba(196,160,80,0.12)",
            border: "1px solid rgba(196,160,80,0.35)",
            borderRadius: 999,
          }}
        >
          Reverted
        </span>
      )}
      <div style={{ maxWidth: "min(100%, 74ch)", width: "100%" }}>
        <div
          style={{
            display: "flex", alignItems: "center", gap: 6,
            fontFamily: "var(--app-font-mono)", fontSize: 9,
            letterSpacing: "0.12em", textTransform: "uppercase",
            color: "var(--atlas-gold)", opacity: 0.85, marginBottom: 7,
          }}
        >
          <span>Atlas</span>
          {message.model && message.model !== "claude" && (
            <span style={{
              display: "inline-flex", alignItems: "center", gap: 3,
              padding: "1px 6px", borderRadius: 4,
              background: message.model === "gpt4o"
                ? "rgba(16,163,127,0.12)"
                : message.model === "gemini"
                ? "rgba(66,133,244,0.12)"
                : "rgba(201,162,76,0.08)",
              border: `1px solid ${message.model === "gpt4o" ? "rgba(16,163,127,0.28)" : message.model === "gemini" ? "rgba(66,133,244,0.28)" : "rgba(201,162,76,0.2)"}`,
              fontSize: 8, fontWeight: 700, letterSpacing: "0.08em",
              color: message.model === "gpt4o" ? "#10a37f" : message.model === "gemini" ? "#4285f4" : "var(--atlas-gold)",
            }}>
              {message.model === "gpt4o" ? "GPT-4o" : message.model === "gemini" ? "Gemini" : message.model}
            </span>
          )}
          {message.isDeepDive && (
            <span style={{
              display: "inline-flex", alignItems: "center", gap: 3,
              padding: "1px 6px", borderRadius: 4,
              background: "rgba(139,92,246,0.12)",
              border: "1px solid rgba(139,92,246,0.28)",
              fontSize: 8, fontWeight: 700, letterSpacing: "0.08em",
              color: "#a78bfa",
            }}>
              DEEP DIVE
            </span>
          )}
          {message.sentAt && (
            <span style={{ opacity: 0.75 }}>
              · {(() => {
                const diff = Date.now() - new Date(message.sentAt).getTime();
                const m = Math.floor(diff / 60000);
                if (m < 1) return "just now";
                if (m < 60) return `${m}m ago`;
                const h = Math.floor(m / 60);
                if (h < 24) return `${h}h ago`;
                return `${Math.floor(h / 24)}d ago`;
              })()}
            </span>
          )}
        </div>
        {modelUsedLabel && (
          <div style={{ fontFamily: "var(--app-font-mono)", fontSize: 9, color: "rgba(120,113,108,0.4)", marginTop: -4, marginBottom: 7 }}>
            {modelUsedLabel}
          </div>
        )}
        {/* Memory chips — click to expand insight and park */}
        {message.memoryChips && message.memoryChips.length > 0 && (
          <div style={{ display: "flex", flexWrap: "wrap" as const, gap: 5, marginBottom: 8 }}>
            {message.memoryChips.map((chip) => (
              <InsightChip
                key={chip.label}
                chip={chip}
                onPark={(c) => onPark(`${c.label}${c.insight ? `: ${c.insight}` : ""}`)}
              />
            ))}
          </div>
        )}

        {(message.imageB64 || imageGenDataUrl || inlineImageUrl) && (
          <div style={{ marginBottom: 12 }}>
            <button
              type="button"
              onClick={() => setImageExpanded(true)}
              aria-label="Expand generated visual"
              style={{ padding: 0, border: "none", background: "transparent", cursor: "zoom-in", display: "block", maxWidth: "100%" }}
            >
              <img
                src={imageSrc}
                alt="Generated visual"
                style={{ maxWidth: "100%", borderRadius: 10, border: "1px solid rgba(201,162,76,0.2)", display: "block" }}
              />
            </button>
            <button
              type="button"
              onClick={handleDownloadImage}
              aria-label="Download generated visual"
              title="Download"
              style={{
                marginTop: 6,
                width: 26,
                height: 26,
                borderRadius: 6,
                border: "1px solid var(--atlas-border)",
                background: "var(--atlas-glass-bg)",
                color: "var(--atlas-muted)",
                display: "inline-flex",
                alignItems: "center",
                justifyContent: "center",
                cursor: "pointer",
              }}
            >
              <Download size={13} strokeWidth={1.7} />
            </button>
            {imageExpanded && createPortal(
              <div
                role="dialog"
                aria-modal="true"
                aria-label="Expanded generated visual"
                onClick={() => setImageExpanded(false)}
                style={{
                  position: "fixed",
                  inset: 0,
                  zIndex: 10000,
                  background: "var(--atlas-bg)",
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  padding: 24,
                }}
              >
                <button
                  type="button"
                  onClick={() => setImageExpanded(false)}
                  aria-label="Close expanded visual"
                  style={{
                    position: "absolute",
                    top: 16,
                    right: 16,
                    width: 34,
                    height: 34,
                    borderRadius: 8,
                    border: "1px solid var(--atlas-border)",
                    background: "var(--atlas-glass-bg)",
                    color: "var(--atlas-fg)",
                    display: "inline-flex",
                    alignItems: "center",
                    justifyContent: "center",
                    cursor: "pointer",
                  }}
                >
                  <X size={18} strokeWidth={1.8} />
                </button>
                <img
                  src={imageSrc}
                  alt="Generated visual"
                  onClick={(e) => e.stopPropagation()}
                  style={{
                    maxWidth: "100%",
                    maxHeight: "100%",
                    borderRadius: 12,
                    border: "1px solid var(--atlas-border)",
                    objectFit: "contain",
                  }}
                />
              </div>,
              document.body
            )}
          </div>
        )}

        {message.browserResult && (
          <div style={{ marginBottom: 14 }}>
            {/* URL label */}
            <div style={{ display: "flex", alignItems: "center", gap: 5, marginBottom: 8 }}>
              <svg width="10" height="10" viewBox="0 0 16 16" fill="none" style={{ flexShrink: 0, opacity: 0.5 }}>
                <circle cx="8" cy="8" r="6" stroke="var(--atlas-gold)" strokeWidth="1.3" />
                <path d="M8 2C8 2 5.5 5 5.5 8s2.5 6 2.5 6M8 2c0 0 2.5 3 2.5 6S8 14 8 14M2 8h12" stroke="var(--atlas-gold)" strokeWidth="1.1" strokeLinecap="round" />
              </svg>
              <span style={{ fontFamily: "var(--app-font-mono)", fontSize: 9.5, color: "var(--atlas-muted)", opacity: 0.6, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" as const, maxWidth: 260 }}>
                {message.browserResult.url}
              </span>
            </div>

            {/* Screenshot */}
            {message.browserResult.screenshotBase64 && (
              <img
                src={message.browserResult.screenshotBase64}
                alt="Browser screenshot"
                style={{ maxWidth: "100%", borderRadius: 10, border: "1px solid rgba(201,162,76,0.2)", display: "block", width: "100%", marginBottom: message.browserResult.analysis ? 8 : 0 }}
              />
            )}

            {/* Health / monitor badge */}
            {(message.browserResult.type === "health" || message.browserResult.type === "monitor") && (
              <div style={{ display: "flex", flexDirection: "column" as const, gap: 6 }}>
                <div style={{ display: "inline-flex", alignItems: "center", gap: 6 }}>
                  {message.browserResult.type === "health" ? (
                    message.browserResult.isHealthy ? (
                      <span style={{ display: "inline-flex", alignItems: "center", gap: 4, padding: "3px 10px", borderRadius: 5, background: "rgba(74,222,128,0.1)", border: "1px solid rgba(74,222,128,0.3)", fontSize: 10, fontFamily: "var(--app-font-mono)", letterSpacing: "0.08em", color: "rgba(134,239,172,0.9)", fontWeight: 700 }}>
                        ✓ HEALTHY
                      </span>
                    ) : (
                      <span style={{ display: "inline-flex", alignItems: "center", gap: 4, padding: "3px 10px", borderRadius: 5, background: "rgba(239,68,68,0.1)", border: "1px solid rgba(239,68,68,0.3)", fontSize: 10, fontFamily: "var(--app-font-mono)", letterSpacing: "0.08em", color: "rgba(252,165,165,0.9)", fontWeight: 700 }}>
                        �� ISSUES
                      </span>
                    )
                  ) : (
                    message.browserResult.hasErrors ? (
                      <span style={{ display: "inline-flex", alignItems: "center", gap: 4, padding: "3px 10px", borderRadius: 5, background: "rgba(239,68,68,0.1)", border: "1px solid rgba(239,68,68,0.3)", fontSize: 10, fontFamily: "var(--app-font-mono)", letterSpacing: "0.08em", color: "rgba(252,165,165,0.9)", fontWeight: 700 }}>
                        ✗ RUNTIME ERRORS
                      </span>
                    ) : (
                      <span style={{ display: "inline-flex", alignItems: "center", gap: 4, padding: "3px 10px", borderRadius: 5, background: "rgba(74,222,128,0.1)", border: "1px solid rgba(74,222,128,0.3)", fontSize: 10, fontFamily: "var(--app-font-mono)", letterSpacing: "0.08em", color: "rgba(134,239,172,0.9)", fontWeight: 700 }}>
                        ✓ NO ERRORS
                      </span>
                    )
                  )}
                </div>
                {message.browserResult.issues && message.browserResult.issues.length > 0 && (
                  <ul style={{ margin: "4px 0 0", paddingLeft: 16, fontSize: 11, color: "rgba(252,165,165,0.75)", lineHeight: 1.7 }}>
                    {message.browserResult.issues.slice(0, 5).map((issue, i) => (
                      <li key={i}>{issue}</li>
                    ))}
                  </ul>
                )}
                {message.browserResult.consoleErrors && message.browserResult.consoleErrors.length > 0 && (
                  <ul style={{ margin: "4px 0 0", paddingLeft: 16, fontSize: 11, color: "rgba(252,165,165,0.75)", lineHeight: 1.7 }}>
                    {message.browserResult.consoleErrors.slice(0, 5).map((err, i) => (
                      <li key={i} style={{ fontFamily: "var(--app-font-mono)", fontSize: 10 }}>{err}</li>
                    ))}
                  </ul>
                )}
              </div>
            )}

            {/* Analysis text */}
            {message.browserResult.analysis && (
              <div style={{ fontSize: 12.5, color: "var(--atlas-fg)", opacity: 0.78, lineHeight: 1.65, marginTop: 6 }}>
                {message.browserResult.analysis}
              </div>
            )}

            {/* Scrape summary */}
            {message.browserResult.type === "scrape" && !message.browserResult.analysis && message.browserResult.summary && (
              <div style={{ fontSize: 12.5, color: "var(--atlas-fg)", opacity: 0.78, lineHeight: 1.65, marginTop: 6 }}>
                {message.browserResult.summary}
              </div>
            )}
          </div>
        )}

        {message.deployQa && (
          <div style={{ marginTop: 10, marginBottom: 10, padding: "10px 14px", borderRadius: 8, background: message.deployQa.isHealthy ? "rgba(74,222,128,0.04)" : "rgba(239,68,68,0.04)", border: `1px solid ${message.deployQa.isHealthy ? "rgba(74,222,128,0.2)" : "rgba(239,68,68,0.2)"}` }}>
            <div style={{ display: "flex", alignItems: "center", gap: 7, marginBottom: message.deployQa.issues.length > 0 || message.deployQa.analysis ? 8 : 0 }}>
              <span style={{ fontSize: 9.5, fontFamily: "var(--app-font-mono)", letterSpacing: "0.08em", fontWeight: 700, color: message.deployQa.isHealthy ? "rgba(134,239,172,0.9)" : "rgba(252,165,165,0.9)" }}>
                VISUAL QA — {message.deployQa.isHealthy ? "✓ HEALTHY" : "✗ ISSUES FOUND"}
              </span>
            </div>
            {message.deployQa.screenshotBase64 && (
              <img
                src={message.deployQa.screenshotBase64}
                alt="Deploy preview"
                style={{ maxWidth: "100%", borderRadius: 8, border: "1px solid rgba(201,162,76,0.15)", display: "block", width: "100%", marginBottom: 8 }}
              />
            )}
            {message.deployQa.issues.length > 0 && (
              <ul style={{ margin: "0 0 6px", paddingLeft: 16, fontSize: 11, color: "rgba(252,165,165,0.75)", lineHeight: 1.7 }}>
                {message.deployQa.issues.slice(0, 5).map((issue, i) => (
                  <li key={i}>{issue}</li>
                ))}
              </ul>
            )}
            {message.deployQa.analysis && (
              <div style={{ fontSize: 12, color: "var(--atlas-fg)", opacity: 0.72, lineHeight: 1.6 }}>
                {message.deployQa.analysis}
              </div>
            )}
          </div>
        )}

        {message.autoFetchedFiles && message.autoFetchedFiles.length > 0 && (
          <div style={{ display: "flex", flexWrap: "wrap", gap: 5, marginBottom: 10 }}>
            {message.autoFetchedFiles.map((fp) => (
              <div
                key={fp}
                title={fp}
                style={{
                  display: "inline-flex", alignItems: "center", gap: 4,
                  padding: "2px 8px", borderRadius: 4,
                  background: "rgba(201,162,76,0.06)",
                  border: "1px solid rgba(201,162,76,0.18)",
                  fontSize: 10, fontFamily: "var(--app-font-mono)",
                  color: "var(--atlas-muted)", letterSpacing: "0.03em",
                  maxWidth: 200, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap",
                }}
              >
                <svg width="9" height="9" viewBox="0 0 12 12" fill="none" style={{ flexShrink: 0, opacity: 0.6 }}>
                  <path d="M2 1h5l3 3v7H2V1z" stroke="var(--atlas-gold)" strokeWidth="1.1" />
                  <path d="M7 1v3h3" stroke="var(--atlas-gold)" strokeWidth="1.1" />
                </svg>
                {fp.split("/").pop() ?? fp}
              </div>
            ))}
          </div>
        )}

        <div style={{ fontSize: 16, lineHeight: 1.85, color: "var(--atlas-fg)", opacity: 0.9, fontFamily: "var(--app-font-sans)" }}>
          {message.streaming ? (
            <span style={{ opacity: 0.85, whiteSpace: "pre-wrap" }}>
              {cleanedContent}
              <span
                aria-hidden
                style={{
                  display: "inline-block",
                  width: 8,
                  height: "1em",
                  background: "currentColor",
                  marginLeft: 2,
                  verticalAlign: "text-bottom",
                  animation: "atlas-cursor-blink 1s step-end infinite",
                }}
              />
            </span>
          ) : (
            <MarkdownProse content={cleanedContent} />
          )}
        </div>

        {message.researchResult && (
          <ResearchCard
            url={message.researchResult.url}
            title={message.researchResult.title}
            summary={message.researchResult.summary}
            headings={message.researchResult.headings ?? []}
          />
        )}

        {message.imageGen?.images?.map((img, i) => (
          <SketchReveal
            key={i}
            src={img.imageUrl}
            alt={img.prompt}
            caption={`${img.mode === "render" ? "Render" : "Schematic"} · ${img.model}`}
          />
        ))}

        {message.streaming && message.planMode && !message.artifact && (
          <div
            style={{
              marginTop: 8,
              fontFamily: "var(--app-font-mono)",
              fontSize: 10,
              letterSpacing: "0.08em",
              textTransform: "uppercase",
              color: "var(--atlas-muted)",
              opacity: 0.7,
            }}
          >
            Generating plan…
          </div>
        )}

        {!message.streaming && message.artifact && message.artifact.type === "plan" && (
          <div
            style={{
              marginTop: 10,
              padding: "10px 12px",
              borderRadius: 10,
              background: "var(--atlas-surface)",
              border: "1px solid color-mix(in oklab, var(--atlas-gold) 26%, var(--atlas-border))",
              borderLeft: "3px solid var(--atlas-gold)",
              display: "flex",
              alignItems: "center",
              gap: 10,
            }}
          >
            <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="var(--atlas-gold)" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round" style={{ flexShrink: 0 }}>
              <rect x="2" y="1" width="12" height="14" rx="1.5" />
              <line x1="5" y1="5" x2="11" y2="5" />
              <line x1="5" y1="8" x2="11" y2="8" />
              <line x1="5" y1="11" x2="8" y2="11" />
            </svg>
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ fontFamily: "var(--app-font-mono)", fontSize: 9, letterSpacing: "0.12em", color: "var(--atlas-gold)", textTransform: "uppercase" }}>
                Plan
              </div>
              <div style={{ fontSize: 13, fontWeight: 600, color: "var(--atlas-fg)", lineHeight: 1.35, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                {message.artifact.title}
              </div>
            </div>
            <button
              type="button"
              onClick={() => onOpenArtifact?.(message.artifact!.title)}
              style={{
                padding: "5px 10px",
                borderRadius: 6,
                background: "var(--atlas-gold)",
                border: "1px solid var(--atlas-gold)",
                color: "var(--atlas-bg)",
                cursor: "pointer",
                fontFamily: "var(--app-font-mono)",
                fontSize: 10,
                fontWeight: 700,
                letterSpacing: "0.08em",
                textTransform: "uppercase",
              }}
            >
              Open
            </button>
            <button
              type="button"
              onClick={() => {
                void navigator.clipboard.writeText(message.artifact!.content);
              }}
              style={{
                padding: "5px 10px",
                borderRadius: 6,
                background: "transparent",
                border: "1px solid var(--atlas-border)",
                color: "var(--atlas-muted)",
                cursor: "pointer",
                fontFamily: "var(--app-font-mono)",
                fontSize: 10,
                letterSpacing: "0.08em",
                textTransform: "uppercase",
              }}
            >
              Copy
            </button>
          </div>
        )}


        {migrationBlocks.map((sql, i) => (
          <MigrationCard key={i} sql={sql} />
        ))}

        {!message.streaming && message.clarify && (
          <ClarifyCard clarify={message.clarify} onSend={onSend} />
        )}

        {hasImageClarify && (
          <div style={{ display: "flex", gap: 8, marginTop: 12, flexWrap: "wrap" }}>
            <button
              type="button"
              onClick={() => onSend?.("Cinematic — single hero shot")}
              style={{
                padding: "8px 16px",
                background: "transparent",
                border: "1px solid var(--atlas-gold)",
                borderRadius: 8,
                color: "var(--atlas-gold)",
                fontFamily: "var(--app-font-mono)",
                fontSize: 11,
                letterSpacing: "0.06em",
                cursor: "pointer",
                textTransform: "uppercase",
              }}
            >
              ◈ Cinematic
            </button>
            <button
              type="button"
              onClick={() => onSend?.("Blueprint — multi-panel breakdown sheet")}
              style={{
                padding: "8px 16px",
                background: "transparent",
                border: "1px solid var(--atlas-border)",
                borderRadius: 8,
                color: "var(--atlas-fg)",
                fontFamily: "var(--app-font-mono)",
                fontSize: 11,
                letterSpacing: "0.06em",
                cursor: "pointer",
                textTransform: "uppercase",
              }}
            >
              ◫ Blueprint
            </button>
          </div>
        )}

        {cleanedContent.trim() && !message.streaming && !commitPayload && (
          <div style={{ marginTop: 6 }}>
            <ThoughtForBadge
              metrics={{
                executionTimeMs: message.executionTimeMs,
                inputTokens: message.inputTokens,
                outputTokens: message.outputTokens,
                costUsd: message.costUsd,
              }}
            />
          </div>
        )}

        {!message.streaming && message.plan && /FILE_EDIT_START/i.test(message.content) && planState !== "skipped" && (
          <PlanCard
            plan={message.plan}
            messageId={planMessageId}
            projectId={projectId}
            isExecuting={planState === "executing"}
            isExpanded={planState === "reviewing"}
            isCompleted={planState === "completed"}
            execution={planExecution}
            onReview={() => setPlanStatus(planState === "reviewing" ? "pending" : "reviewing")}
            onSkip={() => setPlanStatus("skipped")}
            onApprove={() => void handlePlanApprove()}
          />
        )}

        {showPlanPushModal && planPushEdits && planPushEdits.length > 0 && message.plan && (
          <GitHubPushModal
            fileEdits={planPushEdits}
            linkedRepo={linkedRepo}
            projectId={projectId}
            onClose={() => {
              setShowPlanPushModal(false);
              setPlanStatus("pending");
              setPlanExecution(null);
              onStreamActivityComplete?.();
            }}
            onPushSuccess={(records) => {
              onPushSuccess(records);
              const changedFiles = new Set(records.map((record) => record.path)).size;
              setPlanExecution({
                completedStepOrders: message.plan?.steps.map((step) => step.order) ?? [],
                changedFiles,
                statusMessage: `Done. ${changedFiles} file${changedFiles === 1 ? "" : "s"} changed.`,
              });
              setPlanStatus("completed");
              setShowPlanPushModal(false);
              onStreamActivityComplete?.();
            }}
            onPrCreated={onPrCreated}
          />
        )}

        {/* Code ready card — self-repair paths */}
        {!message.streaming && selfEdits.length > 0 && (
          <div
            style={{
              marginTop: 12, padding: "11px 14px", borderRadius: 8,
              background: "rgba(56,189,248,0.04)", border: "1px solid rgba(56,189,248,0.18)",
              display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12,
            }}
          >
            <div style={{ display: "flex", alignItems: "center", gap: 9, minWidth: 0 }}>
              <div style={{ width: 26, height: 26, borderRadius: 6, flexShrink: 0, background: "rgba(56,189,248,0.1)", border: "1px solid rgba(56,189,248,0.22)", display: "flex", alignItems: "center", justifyContent: "center" }}>
                {/* wrench icon */}
                <svg width="12" height="12" viewBox="0 0 16 16" fill="none">
                  <path d="M10.5 1.5A3.5 3.5 0 007 5c0 .36.05.71.14 1.04L2.5 10.5A1.5 1.5 0 004.5 12.5l4.46-4.64c.33.09.68.14 1.04.14a3.5 3.5 0 000-7z" stroke="rgba(56,189,248,0.9)" strokeWidth="1.2" strokeLinecap="round" />
                  <circle cx="10.5" cy="5" r="1" fill="rgba(56,189,248,0.9)" />
                </svg>
              </div>
              <div style={{ minWidth: 0 }}>
                <div style={{ fontSize: 11, fontWeight: 600, color: "rgba(56,189,248,0.9)", marginBottom: 2 }}>
                  {selfEdits.length === 1 ? "Self-repair ready" : `${selfEdits.length} Atlas files ready`}
                </div>
                <div style={{ fontFamily: "var(--app-font-mono)", fontSize: 10, color: "var(--atlas-muted)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" as const }}>
                  {selfEdits.length === 1
                    ? <>{selfEdits[0].path.split("/").pop()}<span style={{ opacity: 0.5, marginLeft: 6 }}>· {selfEdits[0].content.split("\n").length} lines</span></>
                    : selfEdits.map((e) => e.path.split("/").pop()).join(", ")
                  }
                </div>
                {selfApplyStatus === "done" && (
                  <div style={{ fontSize: 10, color: "rgba(56,189,248,0.7)", marginTop: 3 }}>✓ {selfApplyMsg}</div>
                )}
                {selfApplyStatus === "error" && (
                  <div style={{ fontSize: 10, color: "var(--atlas-ember)", marginTop: 3 }}>✗ {selfApplyMsg}</div>
                )}
              </div>
            </div>
            <button
              onClick={handleSelfApply}
              disabled={selfApplyStatus === "applying" || selfApplyStatus === "done"}
              style={{
                flexShrink: 0, padding: "6px 13px", borderRadius: 5, fontSize: 11, fontWeight: 600,
                fontFamily: "var(--app-font-mono)", letterSpacing: "0.08em",
                background: selfApplyStatus === "done"
                  ? "rgba(56,189,248,0.08)"
                  : "linear-gradient(180deg, rgba(56,189,248,0.9) 0%, rgba(14,165,233,0.85) 100%)",
                color: selfApplyStatus === "done" ? "rgba(56,189,248,0.5)" : "#0a1628",
                border: selfApplyStatus === "done" ? "1px solid rgba(56,189,248,0.2)" : "none",
                cursor: selfApplyStatus === "applying" || selfApplyStatus === "done" ? "default" : "pointer",
                opacity: selfApplyStatus === "applying" ? 0.6 : 1,
                transition: "opacity 160ms ease",
              }}
            >
              {selfApplyStatus === "applying" ? "Applying…" : selfApplyStatus === "done" ? "Applied ✓" : "Apply to Atlas →"}
            </button>
          </div>
        )}

        {!message.streaming && (userEdits.length > 0 || (message.linePatches && message.linePatches.length > 0)) && (
          <InlineDiffCard
            fileEdits={userEdits}
            linePatches={message.linePatches ?? []}
            linkedRepo={linkedRepo}
            projectId={projectId}
            trustMode={trustMode}
            onReviewDiff={onReviewDiff}
            onPushSuccess={onPushSuccess}
            onEditDeclined={onEditDeclined}
            onPrCreated={onPrCreated}
          />
        )}

        {(() => {
          const primaryCardShown =
            (!message.streaming &&
              !!message.plan &&
              /FILE_EDIT_START/i.test(message.content) &&
              planState !== "skipped") ||
            (!message.streaming &&
              (userEdits.length > 0 || (message.linePatches?.length ?? 0) > 0));

          return (
            <>
              {!primaryCardShown && !message.streaming && commitPayload && !commitCardDone && (
                <CommitCard
                  payload={commitPayload}
                  projectId={projectId}
                  sessionId={sessionId}
                  sourceMessageId={message.id}
                  onDone={() => {
                    setCommitCardDone(true);
                    onCommitCardDone?.();
                  }}
                />
              )}

              {!primaryCardShown && !message.streaming && message.alertPayload && !message.alertResolved && (
                <ProactiveAlertCard
                  payload={message.alertPayload}
                  projectId={projectId}
                  sessionId={sessionId}
                  onDismiss={() => onAlertDismiss?.()}
                />
              )}
            </>
          );
        })()}



        {/* CMD_EXEC — runnable command card suggested by Atlas */}
        {!message.streaming && cmdExec && (
          <div
            style={{
              marginTop: 12, padding: "10px 14px",
              borderRadius: 8,
              background: "var(--atlas-surface)",
              border: "1px solid rgba(201,162,76,0.22)",
              display: "flex", alignItems: "center", gap: 10,
            }}
          >
            <svg width="13" height="13" viewBox="0 0 16 16" fill="none" style={{ flexShrink: 0, opacity: 0.65 }}>
              <path d="M2 4l5 4-5 4" stroke="rgba(201,162,76,0.9)" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
              <path d="M9 12h5" stroke="rgba(201,162,76,0.9)" strokeWidth="1.5" strokeLinecap="round" />
            </svg>
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ fontFamily: "var(--app-font-mono)", fontSize: 12.5, color: "rgba(201,162,76,0.92)", letterSpacing: "0.01em", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                {cmdExec.command}
              </div>
              {cmdExec.description && (
                <div style={{ fontSize: 11, color: "var(--atlas-muted)", marginTop: 2, opacity: 0.8 }}>{cmdExec.description}</div>
              )}
            </div>
            <button
              onClick={() => onRunCommand?.(cmdExec.command)}
              style={{
                flexShrink: 0, padding: "5px 12px", borderRadius: 5,
                background: "rgba(146,64,14,0.25)",
                border: "1px solid rgba(146,64,14,0.55)",
                color: "rgba(230,150,90,0.95)",
                fontSize: 11, fontWeight: 600, fontFamily: "var(--app-font-mono)",
                letterSpacing: "0.08em", cursor: "pointer",
                transition: "all 140ms ease",
              }}
              onMouseEnter={(e) => (e.currentTarget.style.background = "rgba(146,64,14,0.4)")}
              onMouseLeave={(e) => (e.currentTarget.style.background = "rgba(146,64,14,0.25)")}
            >
              Run →
            </button>
          </div>
        )}

        {/* Action row — primary cockpit + overflow menu */}
        {!message.streaming && (
        <div style={{ position: "relative", display: "flex", gap: 0, marginTop: 6, marginLeft: -6, alignItems: "center", opacity: hov ? 1 : 0.6, transition: "opacity 180ms ease" }}>

          {/* ───── PRIMARY ───── Roll back · Copy · Regenerate · Commit */}
          {snapshotForMsg && !isReverted && (
            <button
              className="atlas-icon-action"
              title="Roll back to here"
              aria-label="Roll back to here"
              style={{ ...ICON_TOUCH_TARGET_STYLE, color: "var(--atlas-gold)" }}
              onClick={() => {
                if (typeof window !== "undefined" &&
                    !window.confirm("Roll back to this message? Newer responses will move to Reverted edits.")) return;
                rollbackTo(projectId, snapshotForMsg.id);
              }}
            >
              <CornerUpLeft size={13} strokeWidth={1.8} />
            </button>
          )}

          <button
            className={`atlas-icon-action${copied ? " copy-done" : ""}`}
            title={copied ? "Copied!" : "Copy response"}
            aria-label="Copy message"
            style={ICON_TOUCH_TARGET_STYLE}
            onClick={() => { navigator.clipboard.writeText(message.content).catch(() => {}); setCopied(true); setTimeout(() => setCopied(false), 1800); }}
          >
            {copied
              ? <svg width="12" height="12" viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round"><path d="M2 7l3 3 7-7" /></svg>
              : <svg width="12" height="12" viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"><rect x="5" y="5" width="8" height="8" rx="1.5" /><path d="M9 5V3a1 1 0 00-1-1H3a1 1 0 00-1 1v5a1 1 0 001 1h2" /></svg>
            }
          </button>

          <button className="atlas-icon-action" title="Regenerate / pivot" aria-label="Retry" onClick={onRegenerate} style={ICON_TOUCH_TARGET_STYLE}>
            <svg width="12" height="12" viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
              <path d="M1.5 7a5.5 5.5 0 005.5 5.5 5.5 5.5 0 005.5-5.5 5.5 5.5 0 00-5.5-5.5 5.5 5.5 0 00-3.9 1.6" />
              <polyline points="1.5 1.5 1.5 4 4 4" />
            </svg>
          </button>

          <button
            className={`atlas-icon-action${commitDone ? " done" : ""}`}
            title={commitDone ? "Committed to ledger" : "Commit to ledger"}
            aria-label="Save to ledger"
            style={ICON_TOUCH_TARGET_STYLE}
            onClick={() => { if (!commitDone) { onCommit(message.content); setCommitDone(true); } }}
          >
            {commitDone
              ? <svg width="12" height="12" viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round"><path d="M2 7l3 3 7-7" /></svg>
              : <svg width="12" height="12" viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"><rect x="2" y="1.5" width="10" height="11" rx="1.5" /><path d="M4.5 5h5M4.5 7.5h5M4.5 10h3" /></svg>
            }
          </button>

          {/* Sketch this — icon-only, popover with style presets */}
          {!message.imageB64 && !message.imageGen && message.content && (
            <InlineSketchOffer text={message.content} onSend={onSend} />
          )}

          {/* ───── OVERFLOW ───── three-dot menu */}
          <button
            className="atlas-icon-action"
            title="More actions"
            aria-label="More actions"
            aria-expanded={menuOpen}
            style={ICON_TOUCH_TARGET_STYLE}
            onClick={(e) => { e.stopPropagation(); setMenuOpen((v) => !v); }}
          >
            <MoreHorizontal size={13} strokeWidth={1.7} />
          </button>

          {menuOpen && createPortal(
            <>
              <div
                onPointerDown={() => setMenuOpen(false)}
                onTouchStart={() => setMenuOpen(false)}
                onClick={() => setMenuOpen(false)}
                style={{ position: "fixed", inset: 0, zIndex: 99998, background: "rgba(0,0,0,0.35)", backdropFilter: "blur(2px)" }}
              />
              <div
                role="menu"
                onClick={(e) => e.stopPropagation()}
                style={{
                  position: "fixed", top: "auto", left: "auto", zIndex: 99999,
                  marginTop: 6,
                  minWidth: 220, maxWidth: "calc(100vw - 16px)",
                  overflowY: "auto", WebkitOverflowScrolling: "touch",
                  padding: 6, borderRadius: 12,
                  background: "var(--atlas-surface)",
                  border: "1px solid color-mix(in oklab, var(--atlas-gold) 22%, transparent)",
                  boxShadow: "0 18px 50px rgba(0,0,0,0.6), 0 0 0 1px rgba(0,0,0,0.4), inset 0 1px 0 rgba(255,255,255,0.04)",
                  fontFamily: "var(--app-font-sans)",
                }}
                ref={(el) => {
                  if (!el) return;
                  const trigger = document.querySelector(`[aria-label="More actions"][aria-expanded="true"]`) as HTMLElement | null;
                  if (!trigger) return;
                  const r = trigger.getBoundingClientRect();
                  const vh = window.innerHeight;
                  const vw = window.innerWidth;
                  const menuW = Math.min(228, vw - 16);
                  const desired = el.scrollHeight || 320;
                  const maxH = vh - 24;
                  const menuH = Math.min(desired, maxH);
                  el.style.maxHeight = `${maxH}px`;
                  const spaceBelow = vh - r.bottom;
                  const spaceAbove = r.top;
                  const top = spaceBelow >= menuH + 12
                    ? r.bottom + 6
                    : spaceAbove >= menuH + 12
                      ? r.top - menuH - 6
                      : Math.max(8, vh - menuH - 8);
                  const left = Math.max(8, Math.min(vw - menuW - 8, r.left));
                  el.style.top = `${top}px`;
                  el.style.left = `${left}px`;
                }}
              >
                <div style={{ display: "flex", justifyContent: "flex-end", padding: "0 2px 4px" }}>
                  <button
                    type="button"
                    aria-label="Close menu"
                    onClick={() => setMenuOpen(false)}
                    style={{
                      width: 26, height: 26, borderRadius: 999,
                      background: "transparent", border: "none",
                      color: "var(--atlas-muted)", cursor: "pointer",
                      display: "inline-flex", alignItems: "center", justifyContent: "center",
                      WebkitTapHighlightColor: "transparent",
                    }}
                  >
                    <svg width="12" height="12" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
                      <path d="M4 4l8 8M12 4l-8 8" />
                    </svg>
                  </button>
                </div>
                {snapshotForMsg && (
                  <MenuItem
                    icon={snapshotForMsg.isBookmarked ? <BookmarkCheck size={13} strokeWidth={1.7} /> : <Bookmark size={13} strokeWidth={1.6} />}
                    label={snapshotForMsg.isBookmarked ? "Bookmarked" : "Bookmark snapshot"}
                    onClick={() => { setMenuOpen(false); toggleSnapshotBookmark(projectId, snapshotForMsg.id); }}
                  />
                )}
                <MenuItem
                  icon={<GitBranch size={13} strokeWidth={1.6} />}
                  label="Fork / branch thread"
                  onClick={() => { setMenuOpen(false); toast("Branching coming soon"); }}
                />
                <MenuItem
                  icon={<FileOutput size={13} strokeWidth={1.6} />}
                  label="Export as artifact"
                  onClick={() => { setMenuOpen(false); toast("Sent to Artifacts workbench"); }}
                />
                <MenuItem
                  icon={<Archive size={13} strokeWidth={1.6} />}
                  label={parkDone ? "Parked" : "Park to inbox"}
                  disabled={parkDone}
                  onClick={() => { setMenuOpen(false); if (!parkDone) { onPark(message.content); setParkDone(true); } }}
                />
                {onForgeIntake && (
                  <MenuItem
                    icon={<svg width="13" height="13" viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"><path d="M2 11h10M4 8l3-5 3 5" /></svg>}
                    label={intakeDone ? "Sent to Forge" : "Intake to Forge"}
                    accent
                    disabled={intakeDone}
                    onClick={async () => {
                      setMenuOpen(false);
                      if (intakeDone) return;
                      try { await onForgeIntake(message.content); setIntakeDone(true); } catch { /* surfaced by parent */ }
                    }}
                  />
                )}
                <MenuItem
                  icon={<Share2 size={13} strokeWidth={1.6} />}
                  label="Share / archive"
                  onClick={() => { setMenuOpen(false); toast("Share link coming soon"); }}
                />
                {previewableCode && onPreviewCode && (
                  <MenuItem
                    icon={<svg width="13" height="13" viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"><rect x="1" y="2" width="12" height="9" rx="1.5" /><path d="M5 5.5l2 2-2 2M8.5 9.5h1.5" /></svg>}
                    label="Preview in sandbox"
                    onClick={() => { setMenuOpen(false); onPreviewCode(previewableCode); }}
                  />
                )}
                {onExtractToForge && (
                  <MenuItem
                    icon={<svg width="13" height="13" viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"><path d="M7 1v8M4 6l3 3 3-3" /><path d="M2 10v1.5A1.5 1.5 0 003.5 13h7a1.5 1.5 0 001.5-1.5V10" /></svg>}
                    label="Extract to Forge"
                    accent
                    onClick={() => { setMenuOpen(false); onExtractToForge(message.content); }}
                  />
                )}
              </div>
            </>,
            document.body
          )}
        </div>
        )}
      </div>

      {showPushModal && activeEdits.length > 0 && (
        <GitHubPushModal
          fileEdits={activeEdits}
          linkedRepo={linkedRepo}
          projectId={projectId}
          onClose={() => setShowPushModal(false)}
          onPushSuccess={(records) => { onPushSuccess(records); setShowPushModal(false); }}
          onPrCreated={onPrCreated}
        />
      )}
    </div>
  );
}

function MenuItem({
  icon, label, onClick, disabled, accent,
}: {
  icon: React.ReactNode;
  label: string;
  onClick: () => void;
  disabled?: boolean;
  accent?: boolean;
}) {
  return (
    <button
      type="button"
      role="menuitem"
      disabled={disabled}
      onClick={onClick}
      style={{
        width: "100%", display: "flex", alignItems: "center", gap: 10,
        padding: "8px 10px", borderRadius: 8,
        background: "transparent", border: "none",
        color: accent ? "var(--atlas-gold)" : "var(--atlas-fg)",
        opacity: disabled ? 0.5 : 0.92,
        cursor: disabled ? "default" : "pointer",
        fontSize: 12.5, fontFamily: "var(--app-font-sans)",
        letterSpacing: "-0.005em", textAlign: "left",
      }}
      onPointerEnter={(e) => { if (!disabled) e.currentTarget.style.background = "color-mix(in oklab, var(--atlas-gold) 8%, transparent)"; }}
      onPointerLeave={(e) => { e.currentTarget.style.background = "transparent"; }}
    >
      <span style={{ display: "inline-flex", width: 18, justifyContent: "center", color: accent ? "var(--atlas-gold)" : "var(--atlas-muted)" }}>{icon}</span>
      <span style={{ flex: 1 }}>{label}</span>
    </button>
  );
}
