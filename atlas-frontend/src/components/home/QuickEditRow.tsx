// QuickEditRow V2 — tactical execution lane.
// States: idle → prompt → active → resolved | failed.
// V2 changes: project pill (switchable), default branch pill (read-only),
// target-file pill that drives true before/after diff lookup, attachment clip,
// unified bottom toolbar, launcher mode (no header row, always-open).
//
// Telemetry remains client-synthesized (useCodegen). Successful push still
// routes through the workspace fallback to keep blast radius safe.

import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { useLocation } from "wouter";
import {
  Zap,
  X,
  ArrowRight,
  GitBranch,
  ChevronDown,
  ChevronRight,
  Paperclip,
  FileCode2,
  Plus,
} from "lucide-react";
import { useCodegen } from "@/hooks/useCodegen";
import { RunSummaryBlock, type RunStatus, type RunArtifact } from "@/components/RunSummary";
import { DiffViewer } from "@/components/code/DiffViewer";
import { apiUrl } from "@/lib/api";
import { Drawer, DrawerContent, DrawerPortal, DrawerOverlay } from "@/components/ui/drawer";
import { useIsMobile } from "@/hooks/use-mobile";

type Phase = "idle" | "prompt" | "active" | "resolved" | "failed";

export interface QuickEditProjectOption {
  id: number;
  name: string;
  defaultBranch?: string;
}

interface Props {
  projectId: number;
  projectName: string;
  /** Row markup rendered as the visible header (row mode). Omit for launcher mode. */
  row?: ReactNode;
  /** "row" = collapsed header (default). "launcher" = no header, always expanded. */
  mode?: "row" | "launcher";
  /** Project list for the switcher pill. If omitted, pill is read-only. */
  projects?: QuickEditProjectOption[];
  /** Default branch label (read-only). */
  defaultBranch?: string;
  /** Pre-fill target file path (e.g. from a commit row). */
  initialFilename?: string;
  /** Called when launcher dismisses. */
  onClose?: () => void;
  /** Project switch callback. */
  onProjectChange?: (id: number) => void;
}

export function QuickEditRow({
  projectId: initialProjectId,
  projectName,
  row,
  mode = "row",
  projects,
  defaultBranch = "main",
  initialFilename,
  onClose,
  onProjectChange,
}: Props) {
  const [, setLocation] = useLocation();
  const isMobile = useIsMobile();
  const isLauncher = mode === "launcher";
  const [phase, setPhase] = useState<Phase>(isLauncher ? "prompt" : "idle");
  const [activeProjectId, setActiveProjectId] = useState(initialProjectId);
  const [prompt, setPrompt] = useState("");
  const [targetFile, setTargetFile] = useState(initialFilename ?? "");
  const [attachments, setAttachments] = useState<File[]>([]);
  const [showDiff, setShowDiff] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [beforeContent, setBeforeContent] = useState<string>("");
  const [projectMenuOpen, setProjectMenuOpen] = useState(false);
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  const activeProjectName = useMemo(() => {
    if (!projects) return projectName;
    return projects.find((p) => p.id === activeProjectId)?.name ?? projectName;
  }, [projects, activeProjectId, projectName]);

  const activeBranch =
    projects?.find((p) => p.id === activeProjectId)?.defaultBranch ?? defaultBranch;

  const { running, steps, lastFile, run, reset } = useCodegen({
    projectId: activeProjectId,
    onResult: () => setPhase("resolved"),
    onError: (msg) => {
      setErrorMessage(msg);
      setPhase("failed");
    },
  });

  const open = phase !== "idle";

  const collapse = useCallback(() => {
    setPhase("idle");
    reset();
    setPrompt("");
    setTargetFile(initialFilename ?? "");
    setAttachments([]);
    setShowDiff(false);
    setErrorMessage(null);
    setBeforeContent("");
    onClose?.();
  }, [reset, onClose, initialFilename]);

  const toggle = useCallback(() => {
    if (isLauncher) return; // launcher has its own close button
    if (open) {
      if (phase === "active") setPhase("idle"); // collapse but keep job running
      else collapse();
    } else {
      setPhase("prompt");
    }
  }, [isLauncher, open, phase, collapse]);

  // Fetch true "before" content when target file is set. Best-effort: 404
  // / network errors fall back to empty before (preserves v1 behavior).
  useEffect(() => {
    if (!targetFile.trim()) {
      setBeforeContent("");
      return;
    }
    let cancelled = false;
    const controller = new AbortController();
    const url = apiUrl(
      `/api/projects/${activeProjectId}/file?path=${encodeURIComponent(targetFile.trim())}`
    );
    fetch(url, { credentials: "include", signal: controller.signal })
      .then(async (r) => {
        if (!r.ok) return "";
        const ct = r.headers.get("content-type") || "";
        if (ct.includes("application/json")) {
          const data = (await r.json().catch(() => null)) as { content?: string } | null;
          return data?.content ?? "";
        }
        return await r.text();
      })
      .then((content) => {
        if (!cancelled) setBeforeContent(content);
      })
      .catch(() => {
        if (!cancelled) setBeforeContent("");
      });
    return () => {
      cancelled = true;
      controller.abort();
    };
  }, [targetFile, activeProjectId]);

  const submit = useCallback(async () => {
    if (!prompt.trim() || running) return;
    setPhase("active");
    setErrorMessage(null);
    const ctx = [
      targetFile.trim() ? `Target file: ${targetFile.trim()}` : null,
      attachments.length > 0 ? `Attached files: ${attachments.map((f) => f.name).join(", ")}` : null,
      beforeContent ? `Current file content:\n\`\`\`\n${beforeContent}\n\`\`\`` : null,
    ]
      .filter(Boolean)
      .join("\n\n");
    await run(prompt, ctx || undefined);
  }, [prompt, running, run, targetFile, attachments, beforeContent]);

  const ejectToWorkspace = useCallback(() => {
    const payload = {
      prompt,
      error: errorMessage,
      filename: lastFile?.filename ?? targetFile,
      attachments: attachments.map((f) => f.name),
    };
    try {
      sessionStorage.setItem(
        `atlas:quickedit:resume:${activeProjectId}`,
        JSON.stringify(payload)
      );
    } catch {}
    setLocation(`/project/${activeProjectId}?resume=quickedit`);
  }, [prompt, errorMessage, lastFile, targetFile, attachments, activeProjectId, setLocation]);

  const artifacts: RunArtifact[] = useMemo(() => {
    if (!lastFile) return [];
    return [{ type: "file", label: lastFile.filename, meta: lastFile.language }];
  }, [lastFile]);

  const status: RunStatus | null =
    phase === "resolved" ? "completed" : phase === "failed" ? "failed" : null;

  const switchProject = (id: number) => {
    setActiveProjectId(id);
    setProjectMenuOpen(false);
    onProjectChange?.(id);
  };

  return (
    <div
      style={{
        borderRadius: 8,
        background: open ? "rgba(201,162,76,0.03)" : "transparent",
        border: open
          ? "1px solid rgba(201,162,76,0.14)"
          : "1px solid transparent",
        transition: "background 180ms ease, border-color 180ms ease",
        overflow: "hidden",
      }}
    >
      {/* Header: in row mode, clickable original row. In launcher mode, a thin bar. */}
      {!isLauncher && row && (
        <div
          onClick={toggle}
          style={{ cursor: "pointer" }}
          aria-expanded={open}
        >
          {row}
        </div>
      )}

      {isLauncher && (
        <div
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            padding: "8px 10px 4px",
          }}
        >
          <span
            style={{
              display: "inline-flex",
              alignItems: "center",
              gap: 6,
              fontSize: 9.5,
              fontFamily: "var(--app-font-mono)",
              letterSpacing: "0.12em",
              textTransform: "uppercase",
              color: "var(--atlas-gold)",
              opacity: 0.85,
            }}
          >
            <Zap size={11} strokeWidth={2.25} />
            New quick action
          </span>
          <button
            type="button"
            onClick={collapse}
            aria-label="Close launcher"
            style={{
              background: "transparent",
              border: "none",
              padding: 2,
              color: "var(--atlas-muted)",
              cursor: "pointer",
              opacity: 0.6,
            }}
          >
            <X size={12} />
          </button>
        </div>
      )}

      {/* Expanded body — rendered inline on desktop/active phases,
          or inside a vaul bottom sheet on mobile during composition. */}
      {open && (() => {
        // isMobile pulled from component scope above (rules of hooks).
        // Sheet handles the composition phase only. The moment we hit Run
        // (phase === "active"), the sheet dismisses and steps stream
        // inline in the activity feed row. resolved/failed also stay inline.
        const useSheet = isMobile && phase === "prompt";

        const bodyInner = (
          <div
            style={{
              padding: useSheet ? "4px 0 8px" : (isLauncher ? "4px 10px 12px" : "10px 12px 12px"),
              borderTop: (useSheet || isLauncher) ? "none" : "1px dashed rgba(201,162,76,0.12)",
              display: "flex",
              flexDirection: "column",
              gap: 10,
            }}
            onClick={(e) => e.stopPropagation()}
          >
          {/* Context strip: project pill + branch pill + target file pill */}
          {(phase === "prompt" || phase === "active") && (
            <div style={{ display: "flex", flexWrap: "wrap", gap: 6, alignItems: "center" }}>
              {/* Project pill */}
              <div style={{ position: "relative" }}>
                <button
                  type="button"
                  onClick={() => projects && projects.length > 1 && setProjectMenuOpen((v) => !v)}
                  style={contextPillStyle(!!projects && projects.length > 1)}
                  aria-label="Switch project"
                  disabled={running}
                >
                  <span style={{ opacity: 0.55 }}>project</span>
                  <span style={{ color: "var(--atlas-gold)" }}>{activeProjectName}</span>
                  {projects && projects.length > 1 && <ChevronDown size={10} strokeWidth={2} />}
                </button>
                {projectMenuOpen && projects && (
                  <div
                    style={{
                      position: "absolute",
                      top: "calc(100% + 4px)",
                      left: 0,
                      zIndex: 30,
                      minWidth: 180,
                      maxHeight: 200,
                      overflowY: "auto",
                      background: "var(--atlas-surface)",
                      border: "1px solid var(--atlas-border)",
                      borderRadius: 6,
                      padding: 4,
                      boxShadow: "0 12px 30px rgba(0,0,0,0.4)",
                    }}
                  >
                    {projects.map((p) => (
                      <button
                        key={p.id}
                        type="button"
                        onClick={() => switchProject(p.id)}
                        style={{
                          display: "block",
                          width: "100%",
                          textAlign: "left",
                          padding: "6px 8px",
                          background:
                            p.id === activeProjectId
                              ? "rgba(201,162,76,0.08)"
                              : "transparent",
                          border: "none",
                          borderRadius: 4,
                          color: "var(--atlas-fg)",
                          fontFamily: "var(--app-font-mono)",
                          fontSize: 11,
                          cursor: "pointer",
                        }}
                      >
                        {p.name}
                      </button>
                    ))}
                  </div>
                )}
              </div>

              {/* Branch pill (read-only) */}
              <span style={contextPillStyle(false)}>
                <GitBranch size={10} strokeWidth={2} />
                <span style={{ opacity: 0.55 }}>branch</span>
                <span style={{ color: "var(--atlas-fg)" }}>{activeBranch}</span>
              </span>

              {/* Target file input — drives true diff lookup */}
              <label
                style={{
                  ...contextPillStyle(true),
                  paddingRight: targetFile ? 4 : 8,
                  cursor: "text",
                }}
              >
                <FileCode2 size={10} strokeWidth={2} />
                <input
                  type="text"
                  value={targetFile}
                  onChange={(e) => setTargetFile(e.target.value)}
                  placeholder="path/to/file"
                  disabled={running}
                  style={{
                    background: "transparent",
                    border: "none",
                    outline: "none",
                    color: "var(--atlas-fg)",
                    fontFamily: "var(--app-font-mono)",
                    fontSize: 10.5,
                    width: targetFile ? Math.min(220, Math.max(80, targetFile.length * 7)) : 100,
                    padding: 0,
                  }}
                />
                {targetFile && (
                  <button
                    type="button"
                    onClick={(e) => {
                      e.preventDefault();
                      setTargetFile("");
                    }}
                    style={{
                      background: "transparent",
                      border: "none",
                      padding: 1,
                      color: "var(--atlas-muted)",
                      cursor: "pointer",
                      opacity: 0.6,
                      display: "inline-flex",
                    }}
                    aria-label="Clear target file"
                  >
                    <X size={9} />
                  </button>
                )}
              </label>

              {beforeContent && (
                <span
                  style={{
                    fontSize: 9,
                    fontFamily: "var(--app-font-mono)",
                    color: "rgba(74,222,128,0.85)",
                    letterSpacing: "0.06em",
                    opacity: 0.85,
                  }}
                >
                  ● diff ready
                </span>
              )}
            </div>
          )}

          {/* Prompt textarea */}
          {(phase === "prompt" || phase === "active") && (
            <textarea
              autoFocus={phase === "prompt"}
              value={prompt}
              onChange={(e) => setPrompt(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
                  e.preventDefault();
                  submit();
                }
                if (e.key === "Escape") {
                  e.preventDefault();
                  collapse();
                }
              }}
              disabled={running}
              placeholder={`Quick edit on ${activeProjectName} — describe the change`}
              rows={useSheet ? 6 : 2}
              style={{
                width: "100%",
                resize: "none",
                fontFamily: "var(--app-font-mono)",
                fontSize: useSheet ? 14 : 12,
                lineHeight: 1.5,
                padding: useSheet ? "12px 12px" : "8px 10px",
                borderRadius: 6,
                background: "var(--atlas-surface)",
                border: "1px solid var(--atlas-border)",
                color: "var(--atlas-fg)",
                outline: "none",
                minHeight: useSheet ? 140 : undefined,
              }}
            />
          )}

          {/* Attachment chips */}
          {attachments.length > 0 && (phase === "prompt" || phase === "active") && (
            <div style={{ display: "flex", flexWrap: "wrap", gap: 5 }}>
              {attachments.map((f, i) => (
                <span
                  key={`${f.name}-${i}`}
                  style={{
                    display: "inline-flex",
                    alignItems: "center",
                    gap: 4,
                    padding: "3px 7px",
                    borderRadius: 4,
                    background: "rgba(99,102,241,0.08)",
                    border: "1px solid rgba(99,102,241,0.25)",
                    color: "rgba(165,180,252,0.95)",
                    fontFamily: "var(--app-font-mono)",
                    fontSize: 10,
                  }}
                >
                  <Paperclip size={9} />
                  {f.name}
                  <button
                    type="button"
                    onClick={() => setAttachments((prev) => prev.filter((_, j) => j !== i))}
                    style={{
                      background: "transparent",
                      border: "none",
                      padding: 0,
                      color: "inherit",
                      cursor: "pointer",
                      opacity: 0.7,
                      display: "inline-flex",
                    }}
                    aria-label={`Remove ${f.name}`}
                  >
                    <X size={9} />
                  </button>
                </span>
              ))}
            </div>
          )}

          {/* Unified bottom toolbar */}
          {(phase === "prompt" || phase === "active") && (
            <div
              style={{
                display: "flex",
                alignItems: "center",
                justifyContent: "space-between",
                gap: 8,
              }}
            >
              <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                <input
                  ref={fileInputRef}
                  type="file"
                  multiple
                  style={{ display: "none" }}
                  onChange={(e) => {
                    const list = Array.from(e.target.files ?? []);
                    if (list.length) setAttachments((prev) => [...prev, ...list]);
                    if (fileInputRef.current) fileInputRef.current.value = "";
                  }}
                />
                <button
                  type="button"
                  onClick={() => fileInputRef.current?.click()}
                  disabled={running}
                  style={toolbarIconBtnStyle}
                  aria-label="Attach files"
                  title="Attach files"
                >
                  <Paperclip size={12} />
                </button>
                <span
                  style={{
                    fontSize: 10,
                    fontFamily: "var(--app-font-mono)",
                    color: "var(--atlas-muted)",
                    opacity: 0.5,
                    letterSpacing: "0.04em",
                  }}
                >
                  {useSheet ? "Tap Run to execute" : "⌘↵ to run"}
                </span>
              </div>
              <div style={{ display: "flex", gap: 6 }}>
                <button
                  type="button"
                  onClick={collapse}
                  style={pillBtnStyle("ghost")}
                  aria-label="Cancel quick edit"
                  disabled={running}
                >
                  <X size={11} strokeWidth={2} /> Cancel
                </button>
                <button
                  type="button"
                  onClick={submit}
                  disabled={!prompt.trim() || running}
                  style={pillBtnStyle("primary", !prompt.trim() || running)}
                >
                  <Zap size={11} strokeWidth={2.25} />
                  {running ? "Running..." : "Run"}
                </button>
              </div>
            </div>
          )}

          {/* Live steps */}
          {(phase === "active" || phase === "resolved" || phase === "failed") &&
            steps.length > 0 && <StepStream steps={steps} running={running} />}

          {/* Resolved */}
          {phase === "resolved" && lastFile && (
            <>
              <RunSummaryBlock
                status={status}
                summary={`Generated ${lastFile.filename}`}
                artifacts={artifacts}
              />
              <button
                type="button"
                onClick={() => setShowDiff((v) => !v)}
                style={{
                  alignSelf: "flex-start",
                  background: "transparent",
                  border: "none",
                  padding: 0,
                  color: "var(--atlas-gold)",
                  fontFamily: "var(--app-font-mono)",
                  fontSize: 10.5,
                  letterSpacing: "0.05em",
                  cursor: "pointer",
                  display: "inline-flex",
                  alignItems: "center",
                  gap: 4,
                }}
              >
                {showDiff ? <ChevronDown size={11} /> : <ChevronRight size={11} />}
                {showDiff ? "Hide changes" : "Review changes"}
              </button>
              {showDiff && (
                <DiffViewer
                  filename={lastFile.filename}
                  before={beforeContent}
                  after={lastFile.content}
                  badge={beforeContent ? "Edited" : "Generated"}
                  maxHeight={260}
                />
              )}
              <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
                <button
                  type="button"
                  onClick={ejectToWorkspace}
                  style={pillBtnStyle("primary")}
                >
                  <GitBranch size={11} strokeWidth={2} /> Accept & Push
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setPhase("prompt");
                    reset();
                    setShowDiff(false);
                  }}
                  style={pillBtnStyle("ghost")}
                >
                  Tweak
                </button>
                <button
                  type="button"
                  onClick={ejectToWorkspace}
                  style={pillBtnStyle("ghost")}
                >
                  Open in Workspace <ArrowRight size={11} strokeWidth={2} />
                </button>
              </div>
            </>
          )}

          {/* Failed */}
          {phase === "failed" && (
            <>
              <RunSummaryBlock
                status="failed"
                summary={errorMessage ?? "Quick edit failed"}
              />
              <button
                type="button"
                onClick={ejectToWorkspace}
                style={pillBtnStyle("primary")}
              >
                Eject to Workspace <ArrowRight size={11} strokeWidth={2} />
              </button>
            </>
          )}
          </div>
        );

        if (useSheet) {
          return (
            <Drawer
              open
              onOpenChange={(o) => { if (!o && !running) collapse(); }}
              shouldScaleBackground={false}
              dismissible={!running}
            >
              <DrawerPortal>
                <DrawerOverlay className="bg-black/70 backdrop-blur-sm" />
                <DrawerContent
                  className="h-[85vh] border-[rgba(201,162,76,0.28)] bg-[var(--atlas-surface)]"
                  style={{ paddingBottom: "env(safe-area-inset-bottom, 0px)" }}
                >
                  <div
                    style={{
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "space-between",
                      padding: "10px 16px 6px",
                    }}
                  >
                    <span
                      style={{
                        display: "inline-flex",
                        alignItems: "center",
                        gap: 6,
                        fontSize: 10,
                        fontFamily: "var(--app-font-mono)",
                        letterSpacing: "0.12em",
                        textTransform: "uppercase",
                        color: "var(--atlas-gold)",
                        opacity: 0.9,
                      }}
                    >
                      <Zap size={11} strokeWidth={2.25} />
                      Quick action · {activeProjectName}
                    </span>
                  </div>
                  <div
                    style={{
                      flex: 1,
                      minHeight: 0,
                      overflowY: "auto",
                      padding: "4px 16px 16px",
                    }}
                  >
                    {bodyInner}
                  </div>
                </DrawerContent>
              </DrawerPortal>
            </Drawer>
          );
        }

        return bodyInner;
      })()}
    </div>
  );
}

/** Header chip for triggering a new blank launcher row. */
export function QuickActionLauncherButton({ onClick }: { onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      style={{
        display: "inline-flex",
        alignItems: "center",
        gap: 4,
        padding: "3px 8px",
        borderRadius: 4,
        background: "rgba(201,162,76,0.08)",
        border: "1px solid rgba(201,162,76,0.28)",
        color: "var(--atlas-gold)",
        fontFamily: "var(--app-font-mono)",
        fontSize: 9.5,
        letterSpacing: "0.08em",
        textTransform: "uppercase",
        cursor: "pointer",
        transition: "background 140ms ease",
      }}
      onMouseEnter={(e) => {
        (e.currentTarget as HTMLButtonElement).style.background = "rgba(201,162,76,0.14)";
      }}
      onMouseLeave={(e) => {
        (e.currentTarget as HTMLButtonElement).style.background = "rgba(201,162,76,0.08)";
      }}
      aria-label="Start a new quick action"
    >
      <Plus size={10} strokeWidth={2.5} />
      Quick action
    </button>
  );
}

function StepStream({ steps, running }: { steps: string[]; running: boolean }) {
  return (
    <div
      style={{
        display: "flex",
        flexDirection: "column",
        gap: 4,
        padding: "8px 10px",
        borderRadius: 6,
        background: "rgba(255,255,255,0.015)",
        border: "1px solid var(--atlas-border)",
      }}
    >
      {steps.map((s, i) => {
        const isLast = i === steps.length - 1;
        const isError = s.toLowerCase().startsWith("error");
        return (
          <div
            key={`${i}-${s}`}
            style={{
              fontFamily: "var(--app-font-mono)",
              fontSize: 11,
              lineHeight: 1.55,
              color: isError ? "#f87171" : "var(--atlas-fg)",
              opacity: isLast && running ? 1 : 0.7,
              display: "flex",
              alignItems: "center",
              gap: 6,
            }}
          >
            <span
              style={{
                width: 5,
                height: 5,
                borderRadius: "50%",
                background: isError
                  ? "#f87171"
                  : isLast && running
                  ? "var(--atlas-gold)"
                  : "rgba(74,222,128,0.7)",
                flexShrink: 0,
                animation:
                  isLast && running ? "atlasCoreBloom 1.4s ease-in-out infinite" : "none",
              }}
            />
            {s}
          </div>
        );
      })}
    </div>
  );
}

function contextPillStyle(interactive: boolean): React.CSSProperties {
  return {
    display: "inline-flex",
    alignItems: "center",
    gap: 5,
    padding: "3px 8px",
    borderRadius: 4,
    background: "var(--atlas-surface)",
    border: "1px solid var(--atlas-border)",
    color: "var(--atlas-muted)",
    fontFamily: "var(--app-font-mono)",
    fontSize: 10.5,
    letterSpacing: "0.02em",
    cursor: interactive ? "pointer" : "default",
    transition: "border-color 140ms ease",
  };
}

const toolbarIconBtnStyle: React.CSSProperties = {
  display: "inline-flex",
  alignItems: "center",
  justifyContent: "center",
  width: 26,
  height: 26,
  borderRadius: 5,
  background: "transparent",
  border: "1px solid var(--atlas-border)",
  color: "var(--atlas-muted)",
  cursor: "pointer",
  transition: "color 140ms ease, border-color 140ms ease",
};

function pillBtnStyle(variant: "primary" | "ghost", disabled = false): React.CSSProperties {
  if (variant === "primary") {
    return {
      display: "inline-flex",
      alignItems: "center",
      gap: 5,
      padding: "5px 10px",
      borderRadius: 5,
      background: disabled ? "rgba(201,162,76,0.08)" : "rgba(201,162,76,0.16)",
      border: "1px solid rgba(201,162,76,0.35)",
      color: disabled ? "rgba(201,162,76,0.5)" : "var(--atlas-gold)",
      fontFamily: "var(--app-font-mono)",
      fontSize: 10.5,
      letterSpacing: "0.04em",
      cursor: disabled ? "not-allowed" : "pointer",
      transition: "background 140ms ease",
    };
  }
  return {
    display: "inline-flex",
    alignItems: "center",
    gap: 5,
    padding: "5px 10px",
    borderRadius: 5,
    background: "transparent",
    border: "1px solid var(--atlas-border)",
    color: "var(--atlas-muted)",
    fontFamily: "var(--app-font-mono)",
    fontSize: 10.5,
    letterSpacing: "0.04em",
    cursor: disabled ? "not-allowed" : "pointer",
    transition: "color 140ms ease, border-color 140ms ease",
  };
}
