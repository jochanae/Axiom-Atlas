import { useState } from "react";
import { toast } from "sonner";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { getAuthHeaders } from "@/lib/api";
import { formatCommitTimeAgo } from "@/lib/formatters";
import { FileIcon, FolderIcon } from "@/components/workspace/atoms";

export interface GhTreeItem {
  path: string;
  type: "blob" | "tree";
  sha: string;
}

interface GhCommitFile {
  filename: string;
  additions: number;
  deletions: number;
  status: string;
}

export interface GhCommitSummary {
  sha: string;
  message: string;
  author: string;
  timestamp: string;
  url: string;
  files: GhCommitFile[];
}


export function CommitHistoryCard({ commit, projectId, canRevert }: { commit: GhCommitSummary; projectId: number; canRevert: boolean }) {
  const [expanded, setExpanded] = useState(false);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [reverting, setReverting] = useState(false);
  const [revertHover, setRevertHover] = useState(false);
  const firstLine = commit.message.split("\n")[0] || "(no commit message)";
  const displayMessage = expanded || firstLine.length <= 80 ? firstLine : `${firstLine.slice(0, 77)}...`;

  const handleRevert = async () => {
    setReverting(true);
    try {
      const res = await fetch("/api/github/revert", {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json", ...getAuthHeaders() },
        body: JSON.stringify({ projectId, sha: commit.sha, branch: "main" }),
      });
      if (!res.ok) {
        let msg = `Revert failed (${res.status})`;
        try { const j = await res.json(); msg = j.error || j.message || msg; } catch { try { msg = (await res.text()) || msg; } catch {} }
        toast.error(msg);
        return;
      }
      toast.success("Reverted — build is clean");
      try {
        window.dispatchEvent(new CustomEvent("atlas:workspace-send", {
          detail: { text: `[ROLLBACK_COMPLETE] Reverted commit ${commit.sha.slice(0, 7)}. Run typecheck to confirm the build is clean.` },
        }));
      } catch {}
      setConfirmOpen(false);
    } catch (e: any) {
      toast.error(e?.message || "Revert failed");
    } finally {
      setReverting(false);
    }
  };

  return (
    <div
      style={{
        width: "100%",
        borderRadius: 8,
        background: "var(--atlas-surface)",
        border: "1px solid var(--atlas-border)",
        color: "var(--atlas-fg)",
        display: "flex",
        flexDirection: "column",
        overflow: "hidden",
      }}
    >
      <div style={{ display: "flex", alignItems: "stretch" }}>
        <button
          type="button"
          onClick={() => setExpanded((value) => !value)}
          style={{
            flex: 1,
            minWidth: 0,
            textAlign: "left",
            padding: "10px 12px",
            background: "transparent",
            border: "none",
            color: "inherit",
            cursor: "pointer",
          }}
        >
          <div style={{ fontSize: "var(--ts-label)", color: "var(--atlas-fg)", lineHeight: 1.45, overflow: "hidden", textOverflow: "ellipsis" }}>
            {displayMessage}
          </div>
          <div style={{ display: "flex", alignItems: "center", gap: 7, flexWrap: "wrap", marginTop: 4 }}>
            <span style={{ fontSize: "var(--ts-sm)", color: "var(--atlas-muted)" }}>{commit.author}</span>
            <span style={{ fontSize: "var(--ts-micro)", color: "var(--atlas-muted)", opacity: 0.55 }}>·</span>
            <span style={{ fontSize: "var(--ts-sm)", color: "var(--atlas-muted)" }}>{formatCommitTimeAgo(commit.timestamp)}</span>
            <span style={{ fontFamily: "var(--app-font-mono)", fontSize: "var(--ts-xs)", color: "var(--atlas-muted)", opacity: 0.65 }}>{commit.sha.slice(0, 7)}</span>
          </div>
        </button>
        {canRevert && (
          <button
            type="button"
            onClick={(e) => { e.stopPropagation(); setConfirmOpen(true); }}
            onMouseEnter={() => setRevertHover(true)}
            onMouseLeave={() => setRevertHover(false)}
            disabled={reverting}
            style={{
              alignSelf: "center",
              marginRight: 6,
              padding: "4px 9px",
              borderRadius: 5,
              background: "transparent",
              border: `1px solid ${revertHover ? "rgba(201,162,76,0.6)" : "rgba(201,162,76,0.3)"}`,
              color: "var(--atlas-muted)",
              fontSize: "var(--ts-xs)",
              fontFamily: "var(--app-font-mono)",
              letterSpacing: "0.04em",
              cursor: reverting ? "wait" : "pointer",
              flexShrink: 0,
              transition: "border-color 140ms ease",
            }}
            aria-label="Revert this commit"
          >
            ↩ Revert
          </button>
        )}
        <a
          href={commit.url}
          target="_blank"
          rel="noopener noreferrer"
          aria-label="View commit on GitHub"
          onClick={(e) => e.stopPropagation()}
          style={{
            color: "var(--atlas-gold)",
            textDecoration: "none",
            fontSize: "var(--ts-h3)",
            lineHeight: 1,
            padding: "10px 12px",
            flexShrink: 0,
            opacity: 0.78,
          }}
        >
          ↗
        </a>
      </div>
      {expanded && (
        <div style={{ borderTop: "1px solid var(--atlas-border)", padding: "9px 12px 12px", display: "flex", flexDirection: "column", gap: 8 }}>
          <div style={{ fontSize: "var(--ts-caption)", color: "var(--atlas-muted)", lineHeight: 1.55, whiteSpace: "pre-wrap" }}>
            {commit.message || "(no commit message)"}
          </div>
          <div style={{ display: "flex", flexDirection: "column", gap: 5 }}>
            {commit.files.length > 0 ? commit.files.map((file) => (
              <div key={file.filename} style={{ display: "flex", alignItems: "center", gap: 8, minWidth: 0 }}>
                <span style={{ flex: 1, minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", fontSize: "var(--ts-sm)", color: "var(--atlas-fg)", fontFamily: "var(--app-font-mono)" }}>
                  {file.filename}
                </span>
                <span style={{ fontFamily: "var(--app-font-mono)", fontSize: "var(--ts-micro)", color: "var(--atlas-phosphor)", flexShrink: 0 }}>
                  +{file.additions}
                </span>
                <span style={{ fontFamily: "var(--app-font-mono)", fontSize: "var(--ts-micro)", color: "var(--atlas-ember)", flexShrink: 0 }}>
                  -{file.deletions}
                </span>
              </div>
            )) : (
              <div style={{ fontSize: "var(--ts-sm)", color: "var(--atlas-muted)", opacity: 0.65 }}>No file details available.</div>
            )}
          </div>
          <a
            href={commit.url}
            target="_blank"
            rel="noopener noreferrer"
            onClick={(e) => e.stopPropagation()}
            style={{ fontFamily: "var(--app-font-mono)", fontSize: "var(--ts-micro)", letterSpacing: "0.06em", color: "var(--atlas-gold)", textDecoration: "none", alignSelf: "flex-start" }}
          >
            View on GitHub →
          </a>
        </div>
      )}
      <AlertDialog open={confirmOpen} onOpenChange={setConfirmOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Revert to before this commit?</AlertDialogTitle>
            <AlertDialogDescription>
              This creates a new commit that undoes these changes — nothing is deleted from history.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={reverting}>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={(e) => { e.preventDefault(); void handleRevert(); }} disabled={reverting}>
              {reverting ? "Reverting…" : "Revert"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

export function CommitHistorySkeleton() {
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
      <style>{`@keyframes atlas-history-pulse{0%,100%{opacity:.36}50%{opacity:.72}}`}</style>
      {[0, 1, 2].map((idx) => (
        <div key={idx} style={{ padding: "12px", borderRadius: 8, border: "1px solid var(--atlas-border)", background: "var(--atlas-surface)", animation: "atlas-history-pulse 1.4s ease-in-out infinite" }}>
          <div style={{ height: 12, width: "72%", borderRadius: 4, background: "var(--atlas-muted)", opacity: 0.28, marginBottom: 9 }} />
          <div style={{ height: 9, width: "42%", borderRadius: 4, background: "var(--atlas-muted)", opacity: 0.18 }} />
        </div>
      ))}
    </div>
  );
}

export function buildTree(items: GhTreeItem[]): GhTreeNode[] {
  const root: GhTreeNode[] = [];
  const map: Record<string, GhTreeNode> = {};

  const sorted = [...items].sort((a, b) => {
    if (a.type !== b.type) return a.type === "tree" ? -1 : 1;
    return a.path.localeCompare(b.path);
  });

  for (const item of sorted) {
    const parts = item.path.split("/");
    const name = parts[parts.length - 1];
    const ext = name.includes(".") ? name.split(".").pop() : undefined;
    const node: GhTreeNode = { name, path: item.path, type: item.type, ext, children: item.type === "tree" ? [] : undefined };
    map[item.path] = node;

    if (parts.length === 1) {
      root.push(node);
    } else {
      const parentPath = parts.slice(0, -1).join("/");
      const parent = map[parentPath];
      if (parent?.children) parent.children.push(node);
    }
  }

  return root;
}

export interface GhTreeNode {
  name: string;
  path: string;
  type: "blob" | "tree";
  ext?: string;
  children?: GhTreeNode[];
}

export function GhTreeNodeRow({
  node,
  depth,
  selectedPath,
  onSelect,
}: {
  node: GhTreeNode;
  depth: number;
  selectedPath: string | null;
  onSelect: (path: string) => void;
}) {
  const [open, setOpen] = useState(depth < 1);
  const isSelected = selectedPath === node.path;

  if (node.type === "tree") {
    return (
      <div>
        <button
          onClick={() => setOpen((o) => !o)}
          style={{
            width: "100%", display: "flex", alignItems: "center",
            gap: 5, padding: `3px 8px 3px ${8 + depth * 12}px`,
            background: "transparent", border: "none", cursor: "pointer",
            borderRadius: 3, transition: "background 100ms ease",
          }}
          onMouseEnter={(e) => (e.currentTarget.style.background = "rgba(201,162,76,0.04)")}
          onMouseLeave={(e) => (e.currentTarget.style.background = "transparent")}
        >
          <svg width="7" height="7" viewBox="0 0 8 8" fill="none" style={{ flexShrink: 0, opacity: 0.35, transform: open ? "rotate(90deg)" : "rotate(0deg)", transition: "transform 130ms ease" }}>
            <path d="M2 1l4 3-4 3" stroke="var(--atlas-fg)" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
          <FolderIcon open={open} />
          <span style={{ fontSize: "var(--ts-caption)", color: "var(--atlas-muted)", fontFamily: "var(--app-font-sans)", textAlign: "left" }}>
            {node.name}
          </span>
        </button>
        {open && node.children?.map((child) => (
          <GhTreeNodeRow key={child.path} node={child} depth={depth + 1} selectedPath={selectedPath} onSelect={onSelect} />
        ))}
      </div>
    );
  }

  return (
    <button
      onClick={() => onSelect(node.path)}
      style={{
        width: "100%", display: "flex", alignItems: "center",
        gap: 5, padding: `3px 8px 3px ${8 + depth * 12}px`,
        background: isSelected ? "rgba(201,162,76,0.09)" : "transparent",
        border: "none", cursor: "pointer", borderRadius: 3,
        transition: "background 100ms ease",
        borderLeft: isSelected ? "2px solid rgba(201,162,76,0.55)" : "2px solid transparent",
      }}
      onMouseEnter={(e) => { if (!isSelected) e.currentTarget.style.background = "rgba(255,255,255,0.03)"; }}
      onMouseLeave={(e) => { if (!isSelected) e.currentTarget.style.background = "transparent"; }}
    >
      <FileIcon ext={node.ext} />
      <span style={{ fontSize: "var(--ts-caption)", color: isSelected ? "var(--atlas-fg)" : "var(--atlas-muted)", fontFamily: "var(--app-font-sans)", textAlign: "left", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
        {node.name}
      </span>
    </button>
  );
}
