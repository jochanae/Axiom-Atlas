import { useEffect, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { X, Folder, Code2, Monitor, Activity } from "lucide-react";
import type { LinkedRepo } from "../../pages/workspace";
import { ObsidianFileBrowser } from "./ObsidianFileBrowser";

export type LaunchMode = "files" | "code" | "preview" | "activity";

export interface LaunchModalProps {
  open: boolean;
  mode: LaunchMode;
  onClose: () => void;
  linkedRepo: LinkedRepo | null;
  previewUrl: string | null;
  /** Optional currently-active code file ({ path, content }) for "code" mode. */
  activeFile?: { path: string; content: string } | null;
  /** Activity log node for "activity" mode. */
  activityNode?: ReactNode;
}

const MODE_META: Record<LaunchMode, { label: string; icon: typeof Folder }> = {
  files:    { label: "FILE BROWSER",    icon: Folder },
  code:     { label: "CODE EDITOR",     icon: Code2 },
  preview:  { label: "IMMERSIVE SANDBOX", icon: Monitor },
  activity: { label: "ACTIVITY LEDGER", icon: Activity },
};

export function LaunchModal({ open, mode, onClose, linkedRepo, previewUrl, activeFile, activityNode }: LaunchModalProps) {
  const [openedFile, setOpenedFile] = useState<{ path: string; content: string } | null>(activeFile ?? null);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    window.addEventListener("keydown", onKey);
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      window.removeEventListener("keydown", onKey);
      document.body.style.overflow = prevOverflow;
    };
  }, [open, onClose]);

  useEffect(() => {
    if (open) setOpenedFile(activeFile ?? null);
  }, [open, activeFile]);

  if (!open || typeof document === "undefined") return null;

  // Preview mode = totally immersive — no chrome, just the iframe + tiny close button
  if (mode === "preview") {
    return createPortal(
      <PreviewLaunchOverlay previewUrl={previewUrl} onClose={onClose} />,
      document.body,
    );
  }

  const Meta = MODE_META[mode];
  const Icon = Meta.icon;

  const showCodeView = mode === "code" || openedFile != null;

  return createPortal(
    <div
      style={{
        position: "fixed",
        inset: 0,
        zIndex: 9999,
        background: "radial-gradient(circle at 20% 0%, rgba(201,162,76,0.06), transparent 60%), rgba(8,8,10,0.96)",
        backdropFilter: "blur(28px)",
        display: "flex",
        flexDirection: "column",
      }}
    >
      {/* Header */}
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: 12,
          padding: "14px 18px",
          borderBottom: "1px solid color-mix(in oklab, var(--atlas-gold) 14%, transparent)",
          background: "color-mix(in oklab, #000 50%, transparent)",
          flexShrink: 0,
        }}
      >
        <span
          style={{
            width: 30,
            height: 30,
            borderRadius: 8,
            display: "inline-flex",
            alignItems: "center",
            justifyContent: "center",
            background: "color-mix(in oklab, var(--atlas-gold) 12%, transparent)",
            border: "1px solid color-mix(in oklab, var(--atlas-gold) 28%, transparent)",
            color: "var(--atlas-gold)",
          }}
        >
          <Icon size={15} strokeWidth={1.7} />
        </span>
        <div style={{ display: "flex", flexDirection: "column", minWidth: 0 }}>
          <div style={{ fontFamily: "var(--app-font-mono)", fontSize: 11, letterSpacing: "0.22em", color: "var(--atlas-gold)" }}>
            {showCodeView && mode !== "code" ? "CODE EDITOR" : Meta.label}
          </div>
          {openedFile && (
            <div style={{ fontFamily: "var(--app-font-mono)", fontSize: 10, color: "var(--atlas-muted)", opacity: 0.6, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
              {openedFile.path}
            </div>
          )}
        </div>
        <div style={{ flex: 1 }} />
        {openedFile && mode !== "code" && (
          <button
            type="button"
            onClick={() => setOpenedFile(null)}
            style={{
              padding: "6px 10px",
              background: "transparent",
              border: "1px solid color-mix(in oklab, var(--atlas-gold) 20%, transparent)",
              borderRadius: 6,
              color: "var(--atlas-muted)",
              fontFamily: "var(--app-font-mono)",
              fontSize: 10,
              letterSpacing: "0.12em",
              textTransform: "uppercase",
              cursor: "pointer",
            }}
          >
            ← Back to files
          </button>
        )}
        <button
          type="button"
          onClick={onClose}
          aria-label="Close"
          style={{
            width: 34,
            height: 34,
            borderRadius: 8,
            background: "transparent",
            border: "1px solid color-mix(in oklab, var(--atlas-gold) 18%, transparent)",
            color: "var(--atlas-gold)",
            display: "inline-flex",
            alignItems: "center",
            justifyContent: "center",
            cursor: "pointer",
          }}
        >
          <X size={16} />
        </button>
      </div>

      {/* Body */}
      <div style={{ flex: 1, minHeight: 0, display: "flex", flexDirection: "column" }}>
        {showCodeView ? (
          <CodeView file={openedFile} />
        ) : mode === "files" ? (
          <ObsidianFileBrowser
            linkedRepo={linkedRepo}
            onOpenFile={(path, content) => setOpenedFile({ path, content })}
          />
        ) : mode === "activity" ? (
          <div style={{ flex: 1, padding: 18, overflow: "auto" }}>
            {activityNode ?? (
              <div style={{ color: "var(--atlas-muted)", fontFamily: "var(--app-font-mono)", fontSize: 12, opacity: 0.6 }}>
                No live activity. Atlas is idle.
              </div>
            )}
          </div>
        ) : null}
      </div>
    </div>,
    document.body,
  );
}

function PreviewLaunchOverlay({ previewUrl, onClose }: { previewUrl: string | null; onClose: () => void }) {
  const [visible, setVisible] = useState(true);

  // Auto-dismiss the "no preview" alert after 3.5s; iframe stays open until X.
  useEffect(() => {
    if (previewUrl) return;
    const t = window.setTimeout(() => {
      setVisible(false);
      window.setTimeout(onClose, 260);
    }, 3500);
    return () => window.clearTimeout(t);
  }, [previewUrl, onClose]);

  const handleBackdropClick = () => {
    if (previewUrl) return; // don't dismiss when iframe is loaded
    setVisible(false);
    window.setTimeout(onClose, 200);
  };

  return (
    <div
      onClick={handleBackdropClick}
      style={{
        position: "fixed",
        inset: 0,
        zIndex: 9999,
        background: previewUrl
          ? "#000"
          : "color-mix(in oklab, var(--atlas-bg) 70%, transparent)",
        backdropFilter: previewUrl ? undefined : "blur(18px)",
        WebkitBackdropFilter: previewUrl ? undefined : "blur(18px)",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        transition: "opacity 240ms ease",
        opacity: visible ? 1 : 0,
      }}
    >
      {previewUrl ? (
        <iframe
          src={previewUrl}
          title="Sandbox"
          style={{ width: "100%", height: "100%", border: "none", background: "#fff" }}
          sandbox="allow-scripts allow-same-origin allow-forms allow-popups allow-modals"
        />
      ) : (
        <div
          onClick={(e) => e.stopPropagation()}
          style={{
            padding: "22px 28px",
            borderRadius: 14,
            background: "color-mix(in oklab, var(--atlas-surface) 80%, transparent)",
            border: "1px solid color-mix(in oklab, var(--atlas-gold) 32%, transparent)",
            backdropFilter: "blur(18px) saturate(140%)",
            WebkitBackdropFilter: "blur(18px) saturate(140%)",
            boxShadow: "0 12px 40px rgba(0,0,0,0.18)",
            color: "var(--atlas-fg)",
            fontFamily: "var(--app-font-mono)",
            fontSize: 12,
            letterSpacing: "0.16em",
            textTransform: "uppercase",
          }}
        >
          No preview URL configured
        </div>
      )}
      <button
        type="button"
        onClick={(e) => { e.stopPropagation(); onClose(); }}
        aria-label="Exit sandbox"
        style={{
          position: "fixed",
          top: 14,
          right: 14,
          zIndex: 10000,
          width: 36,
          height: 36,
          borderRadius: 999,
          background: "color-mix(in oklab, var(--atlas-surface) 80%, transparent)",
          border: "1px solid color-mix(in oklab, var(--atlas-gold) 35%, transparent)",
          color: "var(--atlas-gold)",
          display: "inline-flex",
          alignItems: "center",
          justifyContent: "center",
          cursor: "pointer",
          backdropFilter: "blur(10px)",
          WebkitBackdropFilter: "blur(10px)",
        }}
      >
        <X size={16} />
      </button>
    </div>
  );
}

function CodeView({ file }: { file: { path: string; content: string } | null }) {
  if (!file) {
    return (
      <div style={{ flex: 1, display: "flex", alignItems: "center", justifyContent: "center", color: "var(--atlas-muted)", fontFamily: "var(--app-font-mono)", fontSize: 12, letterSpacing: "0.16em", textTransform: "uppercase", opacity: 0.6 }}>
        No file selected
      </div>
    );
  }
  const lines = file.content.split("\n");
  return (
    <div style={{ flex: 1, minHeight: 0, overflow: "auto", background: "rgba(0,0,0,0.4)" }}>
      <pre
        style={{
          margin: 0,
          padding: "16px 18px",
          fontFamily: "var(--app-font-mono)",
          fontSize: 12,
          lineHeight: 1.65,
          color: "var(--atlas-fg)",
          whiteSpace: "pre",
          overflow: "visible",
        }}
      >
        {lines.map((ln, i) => (
          <div key={i} style={{ display: "flex" }}>
            <span style={{ width: 44, flexShrink: 0, color: "var(--atlas-muted)", opacity: 0.35, textAlign: "right", paddingRight: 12, userSelect: "none" }}>
              {i + 1}
            </span>
            <span>{ln || " "}</span>
          </div>
        ))}
      </pre>
    </div>
  );
}
