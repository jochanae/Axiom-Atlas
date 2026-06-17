import { useEffect, useRef, useState } from "react";
import { useGetProject, getGetProjectQueryKey } from "@workspace/api-client-react";
import { toast } from "sonner";
import { useGithubPushToken } from "@/hooks/useGithubPushToken";
import { DiffViewer } from "@/components/code/DiffViewer";
import type { FileEdit, LinkedRepo, PushRecord } from "@/pages/workspace";

export function GitHubPushModal({
  fileEdits,
  linkedRepo,
  projectId,
  onClose,
  onPushSuccess,
  onPrCreated,
  autoRunCmd = "pnpm typecheck",
}: {
  fileEdits: FileEdit[];
  linkedRepo: LinkedRepo | null;
  projectId: number;
  onClose: () => void;
  onPushSuccess: (records: PushRecord[]) => void;
  onPrCreated?: (prUrl: string) => void;
  autoRunCmd?: string;
}) {
  const today = new Date().toISOString().slice(0, 10);
  const _projectId = projectId; void _projectId;

  const [selectedIdx, setSelectedIdx] = useState(0);
  const [useNewBranch, setUseNewBranch] = useState(true);
  const [branchName, setBranchName] = useState(`atlas/fix-${today}-${Date.now().toString(36).slice(-4)}`);
  const [commitMsg, setCommitMsg] = useState(
    fileEdits.length === 1
      ? `Atlas: update ${fileEdits[0]?.path.split("/").pop() ?? "file"}`
      : `Atlas: update ${fileEdits.length} files`
  );
  const [pushing, setPushing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<{ commitUrl: string; branch: string } | null>(null);
  const [viewMode, setViewMode] = useState<"diff" | "full">("diff");
  const [originalContents, setOriginalContents] = useState<(string | null)[]>(() => fileEdits.map(() => null));
  const [loadingOriginals, setLoadingOriginals] = useState(true);
  const [rollingBack, setRollingBack] = useState(false);
  const [rolledBack, setRolledBack] = useState(false);
  const [creatingPr, setCreatingPr] = useState(false);
  const [prResult, setPrResult] = useState<{ prUrl: string; prNumber: number } | null>(null);
  const [prError, setPrError] = useState<string | null>(null);
  const [confirmPush, setConfirmPush] = useState(false);
  const confirmTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [typechecking, setTypechecking] = useState(false);
  const [typecheckResult, setTypecheckResult] = useState<{ errors: Array<{ line: number; col: number; message: string }>; clean: boolean } | null>(null);
  const [localApplying, setLocalApplying] = useState(false);
  const [localApplied, setLocalApplied] = useState<string[] | null>(null);
  const [localApplyError, setLocalApplyError] = useState<string | null>(null);

  const { data: modalProject } = useGetProject(projectId, { query: { queryKey: getGetProjectQueryKey(projectId) } });
  const token = useGithubPushToken(modalProject?.githubToken);

  useEffect(() => {
    setConfirmPush(false);
    if (confirmTimerRef.current) { clearTimeout(confirmTimerRef.current); confirmTimerRef.current = null; }
  }, [useNewBranch]);

  useEffect(() => {
    if (!linkedRepo || !token) { setLoadingOriginals(false); return; }
    let cancelled = false;
    Promise.all(
      fileEdits.map((fe) =>
        fetch(
          `/api/github/file?repo=${encodeURIComponent(linkedRepo.fullName)}&path=${encodeURIComponent(fe.path)}&branch=${encodeURIComponent(linkedRepo.defaultBranch)}`,
          { headers: { "x-github-token": token } }
        )
          .then((r) => r.ok ? r.json() as Promise<{ content: string }> : null)
          .then((d) => (d as { content: string } | null)?.content ?? null)
          .catch(() => null)
      )
    ).then((originals) => {
      if (!cancelled) { setOriginalContents(originals); setLoadingOriginals(false); }
    });
    return () => { cancelled = true; };
  }, [fileEdits, linkedRepo, token]);

  const currentFile = fileEdits[selectedIdx] ?? fileEdits[0];
  const currentOriginal = originalContents[selectedIdx] ?? null;

  const handlePush = async () => {
    if (!linkedRepo || !token) {
      setError("No linked repo or GitHub token found. Open the Files tab and link a repo first.");
      return;
    }
    setPushing(true);
    setError(null);
    try {
      const targetBranch = useNewBranch ? branchName : linkedRepo.defaultBranch;
      if (useNewBranch) {
        const branchRes = await fetch("/api/github/branch", {
          method: "POST",
          headers: { "Content-Type": "application/json", "x-github-token": token },
          body: JSON.stringify({ repo: linkedRepo.fullName, branch: branchName, baseBranch: linkedRepo.defaultBranch }),
        });
        if (!branchRes.ok) {
          const d = await branchRes.json().catch(() => ({})) as any;
          throw new Error(d.error || `Branch creation failed: HTTP ${branchRes.status}`);
        }
      }
      let lastCommitUrl = "";
      for (let i = 0; i < fileEdits.length; i++) {
        const fe = fileEdits[i];
        const commitRes = await fetch("/api/github/commit", {
          method: "PUT",
          headers: { "Content-Type": "application/json", "x-github-token": token },
          body: JSON.stringify({
            repo: linkedRepo.fullName, branch: targetBranch, path: fe.path, content: fe.content,
            message: `${commitMsg}${fileEdits.length > 1 ? ` (${i + 1}/${fileEdits.length})` : ""}`,
          }),
        });
        if (!commitRes.ok) {
          const d = await commitRes.json().catch(() => ({})) as any;
          throw new Error(d.error || `Commit failed for ${fe.path}: HTTP ${commitRes.status}`);
        }
        const cd = await commitRes.json() as { commitUrl: string };
        lastCommitUrl = cd.commitUrl;
      }
      const records: PushRecord[] = fileEdits.map((fe, i) => ({
        id: `${Date.now()}-${i}`,
        path: fe.path,
        filename: fe.path.split("/").pop() ?? fe.path,
        branch: targetBranch,
        commitUrl: lastCommitUrl,
        originalContent: originalContents[i] ?? null,
        newContent: fe.content,
        pushedAt: new Date().toISOString(),
        rolledBack: false,
      }));
      onPushSuccess(records);
      setSuccess({ commitUrl: lastCommitUrl, branch: targetBranch });
      if (autoRunCmd.trim()) {
        try {
          const termRes = await fetch("/api/terminal/exec", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            credentials: "include",
            body: JSON.stringify({ command: autoRunCmd }),
          });
          const reader = termRes.body?.getReader();
          const decoder = new TextDecoder();
          let termOutput = "";
          if (reader) {
            while (true) {
              const { done, value } = await reader.read();
              if (done) break;
              termOutput += decoder.decode(value);
            }
          }
          if (termOutput.toLowerCase().includes("error")) {
            toast.error("Post-push typecheck found issues — check Terminal tab");
          } else {
            toast.success("✓ typecheck passed");
          }
        } catch {
          // terminal exec failed silently
        }
      }
    } catch (e: any) {
      setError(e.message ?? "Push failed");
    } finally {
      setPushing(false);
    }
  };

  const handleRollback = async () => {
    if (!linkedRepo || !token || !success) return;
    setRollingBack(true);
    try {
      for (let i = 0; i < fileEdits.length; i++) {
        const orig = originalContents[i];
        if (!orig) continue;
        const r = await fetch("/api/github/commit", {
          method: "PUT",
          headers: { "Content-Type": "application/json", "x-github-token": token },
          body: JSON.stringify({
            repo: linkedRepo.fullName, branch: success.branch, path: fileEdits[i].path,
            content: orig, message: `Atlas: rollback ${fileEdits[i].path.split("/").pop()}`,
          }),
        });
        if (!r.ok) { const d = await r.json().catch(() => ({})) as any; throw new Error(d.error || "Rollback failed"); }
      }
      setRolledBack(true);
    } catch (e: any) {
      setError(e.message ?? "Rollback failed");
    } finally {
      setRollingBack(false);
    }
  };

  const handleCreatePR = async () => {
    if (!linkedRepo || !token || !success) return;
    setCreatingPr(true);
    setPrError(null);
    try {
      const prRes = await fetch("/api/github/pr", {
        method: "POST",
        headers: { "Content-Type": "application/json", "x-github-token": token },
        body: JSON.stringify({
          repo: linkedRepo.fullName,
          head: success.branch,
          base: linkedRepo.defaultBranch,
          title: commitMsg,
          body: `Generated by Atlas\n\n**Files changed:**\n${fileEdits.map((fe) => `- \`${fe.path}\``).join("\n")}`,
        }),
      });
      const d = await prRes.json() as any;
      if (!prRes.ok) throw new Error(d.error || d.detail || `PR creation failed: HTTP ${prRes.status}`);
      setPrResult({ prUrl: d.prUrl, prNumber: d.prNumber });
      onPrCreated?.(d.prUrl);
    } catch (e: any) {
      setPrError(e.message ?? "PR creation failed");
    } finally {
      setCreatingPr(false);
    }
  };

  const canRollback = originalContents.some((o) => o !== null);

  return (
    <div
      style={{ position: "fixed", inset: 0, zIndex: 1000, background: "rgba(0,0,0,0.72)", backdropFilter: "blur(4px)", display: "flex", alignItems: "center", justifyContent: "center", padding: "20px 16px" }}
      onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}
    >
      <div style={{ width: "100%", maxWidth: 680, background: "var(--atlas-surface)", border: "1px solid var(--atlas-border)", borderRadius: 12, boxShadow: "0 24px 64px rgba(0,0,0,0.6), 0 0 0 0.5px rgba(201,162,76,0.08)", display: "flex", flexDirection: "column", maxHeight: "92vh", overflow: "hidden" }}>

        {/* Header */}
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "16px 20px 0" }}>
          <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
            <div style={{ width: 28, height: 28, borderRadius: 7, background: "rgba(201,162,76,0.1)", border: "1px solid rgba(201,162,76,0.2)", display: "flex", alignItems: "center", justifyContent: "center" }}>
              <svg width="14" height="14" viewBox="0 0 16 16" fill="none">
                <path d="M8 1C4.13 1 1 4.13 1 8c0 3.09 2 5.71 4.78 6.64.35.06.48-.15.48-.34v-1.2c-1.94.42-2.35-.94-2.35-.94-.32-.81-.78-1.03-.78-1.03-.64-.43.05-.42.05-.42.7.05 1.07.72 1.07.72.62 1.07 1.63.76 2.03.58.06-.45.24-.76.44-.93-1.55-.18-3.18-.77-3.18-3.44 0-.76.27-1.38.72-1.87-.07-.18-.31-.88.07-1.84 0 0 .59-.19 1.92.72A6.6 6.6 0 018 4.82c.59 0 1.19.08 1.74.23 1.33-.9 1.92-.72 1.92-.72.38.96.14 1.66.07 1.84.45.49.72 1.11.72 1.87 0 2.68-1.63 3.26-3.19 3.44.25.22.48.64.48 1.3v1.92c0 .19.13.4.48.33C13 13.71 15 11.09 15 8c0-3.87-3.13-7-7-7z" fill="currentColor" style={{ color: "var(--atlas-gold)" }} />
              </svg>
            </div>
            <div>
              <div style={{ fontSize: 13, fontWeight: 600, color: "var(--atlas-fg)" }}>
                Push to GitHub
                {fileEdits.length > 1 && <span style={{ marginLeft: 8, fontSize: 11, fontWeight: 400, color: "var(--atlas-gold)", opacity: 0.7, fontFamily: "var(--app-font-mono)" }}>{fileEdits.length} files</span>}
              </div>
              {linkedRepo && <div style={{ fontSize: 10, color: "var(--atlas-muted)", fontFamily: "var(--app-font-mono)", marginTop: 1 }}>{linkedRepo.fullName}</div>}
            </div>
          </div>
          <button onClick={onClose} aria-label="Dismiss" style={{ background: "none", border: "none", cursor: "pointer", color: "var(--atlas-muted)", fontSize: 18, lineHeight: 1, padding: "4px 6px", opacity: 0.5 }} onMouseEnter={(e) => (e.currentTarget.style.opacity = "1")} onMouseLeave={(e) => (e.currentTarget.style.opacity = "0.5")}>×</button>
        </div>

        <div style={{ padding: "14px 20px", overflowY: "auto", flex: 1 }}>
          {success ? (
            <div style={{ textAlign: "center", padding: "24px 0" }}>
              {rolledBack ? (
                <>
                  <div style={{ fontSize: 22, marginBottom: 10, color: "rgba(134,239,172,0.8)" }}>↺</div>
                  <div style={{ fontSize: 14, color: "var(--atlas-fg)", marginBottom: 6 }}>Rolled back — {fileEdits.length > 1 ? `${fileEdits.length} files` : (fileEdits[0]?.path.split("/").pop() ?? "file")} restored</div>
                  <div style={{ fontSize: 11, color: "var(--atlas-muted)", opacity: 0.5, marginBottom: 16 }}>Original versions pushed to <strong>{success.branch}</strong>.</div>
                </>
              ) : (
                <>
                  <div style={{ fontSize: 28, marginBottom: 12, color: "rgba(134,239,172,0.8)" }}>✓</div>
                  <div style={{ fontSize: 14, color: "var(--atlas-fg)", marginBottom: 4 }}>{fileEdits.length > 1 ? `${fileEdits.length} files pushed` : "Pushed"} to <strong>{success.branch}</strong></div>
                  {fileEdits.length > 1 && (
                    <div style={{ marginBottom: 8 }}>
                      {fileEdits.map((fe) => <div key={fe.path} style={{ fontSize: 10, fontFamily: "var(--app-font-mono)", color: "var(--atlas-muted)", opacity: 0.6, lineHeight: 1.8 }}>{fe.path}</div>)}
                    </div>
                  )}
                  <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 8, marginTop: 8 }}>
                    <a href={success.commitUrl} target="_blank" rel="noopener noreferrer" style={{ display: "inline-flex", alignItems: "center", gap: 5, padding: "6px 14px", borderRadius: 6, background: "rgba(201,162,76,0.1)", border: "1px solid rgba(201,162,76,0.25)", color: "var(--atlas-gold)", fontSize: 12, fontFamily: "var(--app-font-mono)", textDecoration: "none" }}>View commit on GitHub →</a>
                    {useNewBranch && (
                      prResult ? (
                        <a href={prResult.prUrl} target="_blank" rel="noopener noreferrer" style={{ display: "inline-flex", alignItems: "center", gap: 5, padding: "6px 14px", borderRadius: 6, background: "rgba(134,239,172,0.08)", border: "1px solid rgba(134,239,172,0.25)", color: "rgba(134,239,172,0.85)", fontSize: 12, fontFamily: "var(--app-font-mono)", textDecoration: "none" }}>
                          ✓ PR #{prResult.prNumber} opened →
                        </a>
                      ) : (
                        <button onClick={handleCreatePR} disabled={creatingPr} style={{ display: "inline-flex", alignItems: "center", gap: 6, padding: "6px 14px", borderRadius: 6, background: "rgba(201,162,76,0.06)", border: "1px solid rgba(201,162,76,0.2)", color: "var(--atlas-gold)", fontSize: 12, fontFamily: "var(--app-font-mono)", cursor: creatingPr ? "not-allowed" : "pointer", opacity: creatingPr ? 0.5 : 1, transition: "all 160ms ease" }}>
                          {creatingPr ? "Opening PR…" : "Open Pull Request →"}
                        </button>
                      )
                    )}
                    {prError && <div style={{ fontSize: 11, color: "rgba(252,165,165,0.75)", marginTop: 2 }}>{prError}</div>}
                  </div>
                  {canRollback && (
                    <div style={{ marginTop: 18 }}>
                      <div style={{ fontSize: 10.5, color: "var(--atlas-muted)", opacity: 0.5, marginBottom: 10, lineHeight: 1.6 }}>Something break? Roll back to the original version instantly.</div>
                      <button onClick={handleRollback} disabled={rollingBack} style={{ padding: "7px 16px", borderRadius: 6, fontSize: 11, fontFamily: "var(--app-font-mono)", letterSpacing: "0.08em", background: rollingBack ? "var(--atlas-glass-bg)" : "rgba(239,68,68,0.08)", border: `1px solid ${rollingBack ? "var(--atlas-border)" : "rgba(239,68,68,0.25)"}`, color: rollingBack ? "var(--atlas-muted)" : "rgba(252,165,165,0.85)", cursor: rollingBack ? "not-allowed" : "pointer", transition: "all 160ms ease" }}>
                        {rollingBack ? "Rolling back…" : `↺ Rollback ${fileEdits.length > 1 ? "all changes" : "this change"}`}
                      </button>
                      {error && <div style={{ marginTop: 8, fontSize: 11, color: "rgba(252,165,165,0.75)" }}>{error}</div>}
                    </div>
                  )}
                </>
              )}
              <div style={{ marginTop: 16 }}>
                <button onClick={onClose} style={{ padding: "6px 16px", borderRadius: 6, fontSize: 12, background: "transparent", border: "1px solid var(--atlas-border)", color: "var(--atlas-muted)", cursor: "pointer" }}>Close</button>
              </div>
            </div>
          ) : (
            <>
              {/* File tabs (multiple files) */}
              {fileEdits.length > 1 && (
                <div style={{ display: "flex", gap: 4, marginBottom: 12, overflowX: "auto", paddingBottom: 2 }}>
                  {fileEdits.map((fe, idx) => (
                    <button key={fe.path} onClick={() => setSelectedIdx(idx)} style={{ padding: "5px 11px", borderRadius: 5, fontSize: 10, fontFamily: "var(--app-font-mono)", whiteSpace: "nowrap" as const, background: idx === selectedIdx ? "rgba(201,162,76,0.1)" : "transparent", border: `1px solid ${idx === selectedIdx ? "rgba(201,162,76,0.35)" : "var(--atlas-border)"}`, color: idx === selectedIdx ? "var(--atlas-gold)" : "var(--atlas-muted)", cursor: "pointer", transition: "all 140ms ease", flexShrink: 0 }}>
                      {fe.path.split("/").pop()}
                    </button>
                  ))}
                </div>
              )}

              {/* Diff / Full view */}
              <div style={{ padding: "10px 13px", borderRadius: 7, background: "rgba(0,0,0,0.25)", border: "1px solid var(--atlas-border)", marginBottom: 14 }}>
                <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 8 }}>
                  <span style={{ fontFamily: "var(--app-font-mono)", fontSize: 11, color: "var(--atlas-fg)" }}>{currentFile.path}</span>
                  <div style={{ display: "flex", gap: 4 }}>
                    {(["diff", "full"] as const).map((m) => (
                      <button key={m} onClick={() => setViewMode(m)} style={{ padding: "3px 9px", borderRadius: 4, fontSize: 9.5, fontFamily: "var(--app-font-mono)", letterSpacing: "0.08em", background: viewMode === m ? "rgba(201,162,76,0.1)" : "transparent", border: `1px solid ${viewMode === m ? "rgba(201,162,76,0.3)" : "var(--atlas-border)"}`, color: viewMode === m ? "var(--atlas-gold)" : "var(--atlas-muted)", cursor: "pointer" }}>
                        {m === "diff" ? "Diff" : "Full"}
                      </button>
                    ))}
                  </div>
                </div>
                {viewMode === "diff" ? (
                  loadingOriginals ? (
                    <div style={{ padding: "12px 0", fontSize: 11, color: "var(--atlas-muted)", opacity: 0.5, fontFamily: "var(--app-font-mono)" }}>Loading original…</div>
                  ) : (
                    <DiffViewer
                      before={currentOriginal ?? ""}
                      after={currentFile.content}
                      viewMode="inline"
                      maxHeight={280}
                      badge={currentOriginal === null ? "New file" : undefined}
                    />
                  )
                ) : (
                  <pre style={{ margin: 0, padding: "10px", background: "rgba(0,0,0,0.35)", border: "1px solid var(--atlas-glass-bg)", borderRadius: 5, fontSize: 10.5, fontFamily: "var(--app-font-mono)", lineHeight: 1.6, color: "var(--atlas-fg)", overflowX: "auto", maxHeight: 280, overflowY: "auto", whiteSpace: "pre" }}>{currentFile.content}</pre>
                )}
              </div>

              {/* Branch */}
              <div style={{ marginBottom: 14 }}>
                <div style={{ fontSize: 11, color: "var(--atlas-muted)", fontFamily: "var(--app-font-mono)", letterSpacing: "0.08em", marginBottom: 8 }}>TARGET BRANCH</div>
                <div style={{ display: "flex", gap: 8, marginBottom: 8 }}>
                  {[true, false].map((isNew) => (
                    <button key={String(isNew)} onClick={() => setUseNewBranch(isNew)} style={{ flex: 1, padding: "7px 10px", borderRadius: 6, fontSize: 12, cursor: "pointer", background: useNewBranch === isNew ? "rgba(201,162,76,0.1)" : "transparent", border: `1px solid ${useNewBranch === isNew ? "rgba(201,162,76,0.35)" : "var(--atlas-border)"}`, color: useNewBranch === isNew ? "var(--atlas-gold)" : "var(--atlas-muted)", transition: "all 160ms ease" }}>
                      {isNew ? "New branch (safe)" : `${linkedRepo?.defaultBranch ?? "main"} (direct)`}
                    </button>
                  ))}
                </div>
                {useNewBranch && (
                  <input value={branchName} onChange={(e) => setBranchName(e.target.value)} placeholder="branch name" style={{ width: "100%", padding: "8px 11px", borderRadius: 6, background: "var(--atlas-glass-bg)", border: "1px solid var(--atlas-border)", color: "var(--atlas-fg)", fontSize: 12, fontFamily: "var(--app-font-mono)", outline: "none", boxSizing: "border-box" }} onFocus={(e) => (e.currentTarget.style.borderColor = "rgba(201,162,76,0.4)")} onBlur={(e) => (e.currentTarget.style.borderColor = "var(--atlas-border)")} />
                )}
              </div>

              {/* Commit message */}
              <div style={{ marginBottom: 16 }}>
                <div style={{ fontSize: 11, color: "var(--atlas-muted)", fontFamily: "var(--app-font-mono)", letterSpacing: "0.08em", marginBottom: 8 }}>COMMIT MESSAGE</div>
                <input value={commitMsg} onChange={(e) => setCommitMsg(e.target.value)} placeholder="describe the change" style={{ width: "100%", padding: "8px 11px", borderRadius: 6, background: "var(--atlas-glass-bg)", border: "1px solid var(--atlas-border)", color: "var(--atlas-fg)", fontSize: 12, outline: "none", boxSizing: "border-box" }} onFocus={(e) => (e.currentTarget.style.borderColor = "rgba(201,162,76,0.4)")} onBlur={(e) => (e.currentTarget.style.borderColor = "var(--atlas-border)")} />
              </div>

              {!linkedRepo && <div style={{ padding: "9px 12px", borderRadius: 6, marginBottom: 14, background: "rgba(239,68,68,0.08)", border: "1px solid rgba(239,68,68,0.2)", fontSize: 12, color: "rgba(252,165,165,0.8)" }}>No repo linked. Open the Files tab and link a GitHub repo to this project first.</div>}
              {error && <div style={{ padding: "9px 12px", borderRadius: 6, marginBottom: 14, background: "rgba(239,68,68,0.08)", border: "1px solid rgba(239,68,68,0.2)", fontSize: 12, color: "rgba(252,165,165,0.8)" }}>{error}</div>}
            </>
          )}
        </div>

        {!success && (
          <div style={{ padding: "14px 20px", borderTop: "1px solid var(--atlas-border)" }}>
            {!useNewBranch && confirmPush && (
              <div style={{ marginBottom: 10, padding: "8px 12px", borderRadius: 6, background: "rgba(146,64,14,0.12)", border: "1px solid rgba(146,64,14,0.4)", fontSize: 12, color: "rgba(251,191,36,0.92)", lineHeight: 1.5 }}>
                ⚠ You're pushing directly to {linkedRepo?.defaultBranch ?? "main"}. This cannot be undone. Tap again to confirm.
              </div>
            )}
            {typecheckResult && (
              <div style={{
                marginBottom: 10, padding: "8px 12px", borderRadius: 6,
                background: typecheckResult.clean ? "rgba(52,211,153,0.07)" : "rgba(239,68,68,0.07)",
                border: `1px solid ${typecheckResult.clean ? "rgba(52,211,153,0.3)" : "rgba(239,68,68,0.3)"}`,
              }}>
                <div style={{ fontSize: 11, fontWeight: 600, color: typecheckResult.clean ? "rgba(52,211,153,0.9)" : "rgba(239,68,68,0.85)", marginBottom: typecheckResult.errors.length > 0 ? 6 : 0 }}>
                  {typecheckResult.clean ? "✓ No syntax errors detected" : `⚠ ${typecheckResult.errors.length} error${typecheckResult.errors.length !== 1 ? "s" : ""} found`}
                </div>
                {typecheckResult.errors.slice(0, 6).map((e, i) => (
                  <div key={i} style={{ fontFamily: "var(--app-font-mono)", fontSize: 10, color: "rgba(239,68,68,0.75)", lineHeight: 1.6 }}>
                    <span style={{ opacity: 0.55 }}>L{e.line}:{e.col} </span>{e.message}
                  </div>
                ))}
                {typecheckResult.errors.length > 6 && (
                  <div style={{ fontFamily: "var(--app-font-mono)", fontSize: 10, color: "var(--atlas-muted)", marginTop: 3 }}>
                    +{typecheckResult.errors.length - 6} more — share with Atlas to fix
                  </div>
                )}
              </div>
            )}
            {localApplied && (
              <div style={{ marginBottom: 10, padding: "8px 12px", borderRadius: 6, background: "rgba(52,211,153,0.07)", border: "1px solid rgba(52,211,153,0.3)" }}>
                <div style={{ fontSize: 11, fontWeight: 600, color: "rgba(52,211,153,0.9)", marginBottom: localApplied.length > 1 ? 4 : 0 }}>
                  ✓ Applied to workspace — Vite is hot-reloading
                </div>
                {localApplied.map((p, i) => (
                  <div key={i} style={{ fontFamily: "var(--app-font-mono)", fontSize: 10, color: "rgba(52,211,153,0.6)", lineHeight: 1.6 }}>{p}</div>
                ))}
              </div>
            )}
            {localApplyError && (
              <div style={{ marginBottom: 10, padding: "8px 12px", borderRadius: 6, background: "rgba(239,68,68,0.07)", border: "1px solid rgba(239,68,68,0.25)", fontSize: 11, color: "rgba(239,68,68,0.8)", fontFamily: "var(--app-font-mono)", lineHeight: 1.55 }}>
                {localApplyError}
              </div>
            )}
            <div style={{ display: "flex", gap: 10, justifyContent: "flex-end" }}>
              <button onClick={onClose} style={{ padding: "8px 16px", borderRadius: 6, fontSize: 12, background: "transparent", border: "1px solid var(--atlas-border)", color: "var(--atlas-muted)", cursor: "pointer" }}>Cancel</button>
              <button
                onClick={async () => {
                  if (localApplying) return;
                  setLocalApplying(true);
                  setLocalApplied(null);
                  setLocalApplyError(null);
                  try {
                    const r = await fetch("/api/github/apply-local", {
                      method: "POST",
                      headers: { "Content-Type": "application/json" },
                      credentials: "include",
                      body: JSON.stringify({ files: fileEdits.map(fe => ({ path: fe.path, content: fe.content })) }),
                    });
                    if (!r.ok) { const d = await r.json() as { error?: string }; throw new Error(d.error ?? "Apply failed"); }
                    const result = await r.json() as { applied: string[]; requiresServerBuild: boolean };
                    setLocalApplied(result.applied);
                    if (result.requiresServerBuild) {
                      toast("Building server…", { icon: "⚙️" });
                      fetch("/api/terminal/exec", {
                        method: "POST", headers: { "Content-Type": "application/json" }, credentials: "include",
                        body: JSON.stringify({ command: "pnpm --filter @workspace/api-server run build" }),
                      }).catch(() => {});
                    }
                  } catch (e) {
                    setLocalApplyError(e instanceof Error ? e.message : "Local apply failed");
                  } finally {
                    setLocalApplying(false);
                  }
                }}
                disabled={localApplying}
                style={{ padding: "8px 14px", borderRadius: 6, fontSize: 11, fontWeight: 600, fontFamily: "var(--app-font-mono)", letterSpacing: "0.06em", background: localApplied ? "rgba(52,211,153,0.1)" : "var(--atlas-glass-bg)", border: `1px solid ${localApplied ? "rgba(52,211,153,0.3)" : "var(--atlas-border)"}`, color: localApplied ? "rgba(52,211,153,0.8)" : "var(--atlas-muted)", cursor: localApplying ? "default" : "pointer", opacity: localApplying ? 0.55 : 1, transition: "all 150ms ease" }}
              >
                {localApplying ? "Applying…" : localApplied ? "✓ Applied" : "Apply to workspace"}
              </button>
              <button
                onClick={async () => {
                  const currentFile = fileEdits[selectedIdx] ?? fileEdits[0];
                  if (!currentFile || typechecking) return;
                  setTypechecking(true);
                  setTypecheckResult(null);
                  try {
                    const r = await fetch("/api/github/typecheck", {
                      method: "POST",
                      headers: { "Content-Type": "application/json" },
                      body: JSON.stringify({ content: currentFile.content, path: currentFile.path }),
                      credentials: "include",
                    });
                    if (r.ok) setTypecheckResult(await r.json() as { errors: Array<{ line: number; col: number; message: string }>; clean: boolean });
                  } catch { /* non-fatal */ } finally { setTypechecking(false); }
                }}
                disabled={typechecking}
                style={{ padding: "8px 14px", borderRadius: 6, fontSize: 11, fontWeight: 600, fontFamily: "var(--app-font-mono)", letterSpacing: "0.06em", background: "rgba(201,162,76,0.08)", border: "1px solid rgba(201,162,76,0.28)", color: "var(--atlas-gold)", cursor: typechecking ? "default" : "pointer", opacity: typechecking ? 0.55 : 1, transition: "opacity 150ms ease" }}
              >
                {typechecking ? "Checking…" : "Pre-check →"}
              </button>
              <button
                onClick={() => {
                  if (!useNewBranch) {
                    if (!confirmPush) {
                      setConfirmPush(true);
                      if (confirmTimerRef.current) clearTimeout(confirmTimerRef.current);
                      confirmTimerRef.current = setTimeout(() => setConfirmPush(false), 5000);
                      return;
                    }
                    if (confirmTimerRef.current) { clearTimeout(confirmTimerRef.current); confirmTimerRef.current = null; }
                    setConfirmPush(false);
                  }
                  void handlePush();
                }}
                disabled={pushing || !linkedRepo}
                style={{ padding: "8px 18px", borderRadius: 6, fontSize: 12, fontWeight: 600, background: "linear-gradient(180deg, var(--atlas-gold) 0%, color-mix(in oklab, var(--atlas-gold) 78%, #6a4a18) 100%)", color: "var(--atlas-bg)", border: "none", cursor: pushing || !linkedRepo ? "not-allowed" : "pointer", opacity: pushing || !linkedRepo ? 0.5 : 1, transition: "opacity 160ms ease" }}
              >
                {pushing ? "Pushing…" : !useNewBranch && confirmPush ? "Confirm push →" : fileEdits.length > 1 ? `Push ${fileEdits.length} files →` : "Push to GitHub"}
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
