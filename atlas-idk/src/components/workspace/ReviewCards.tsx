import { useMemo, useState } from "react";
import { useGetProject, getGetProjectQueryKey } from "@workspace/api-client-react";
import { PlanCard } from "@/components/PlanCard";
import { GitHubPushModal } from "@/components/workspace/GitHubPushModal";
import { useGithubPushToken } from "@/hooks/useGithubPushToken";
import { getAuthHeaders } from "@/lib/api";
import { diffStat } from "@/lib/formatters";
import type { Plan, PlanExecution } from "@/lib/plan";
import type {
  ChatMessage,
  FileEdit,
  LinePatch,
  LinkedRepo,
  PushRecord,
} from "@/pages/workspace";
import type { PlanState } from "@/components/workspace/chatShared";

export function LinePatchReviewCard({
  linePatches,
  linkedRepo,
  projectId,
  onPushSuccess,
  onPrCreated,
}: {
  linePatches: LinePatch[];
  linkedRepo: LinkedRepo | null;
  projectId: number;
  onPushSuccess: (records: PushRecord[]) => void;
  onPrCreated?: (prUrl: string) => void;
}) {
  const [applying, setApplying] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [patchedEdits, setPatchedEdits] = useState<FileEdit[] | null>(null);
  const [showPushModal, setShowPushModal] = useState(false);

  const { data: project } = useGetProject(projectId, { query: { queryKey: getGetProjectQueryKey(projectId) } });
  const token = useGithubPushToken(project?.githubToken);

  const pathGroups = useMemo(() => {
    const groups: Record<string, LinePatch[]> = {};
    for (const p of linePatches) {
      if (!groups[p.path]) groups[p.path] = [];
      groups[p.path].push(p);
    }
    return groups;
  }, [linePatches]);

  const uniquePaths = Object.keys(pathGroups);
  const patchCount = linePatches.length;
  const fileCount = uniquePaths.length;

  const handleApply = async () => {
    if (!linkedRepo) { setError("No repo linked — connect a GitHub repo in the Files tab."); return; }
    if (!token) { setError("No GitHub token — connect GitHub from your home page."); return; }
    setApplying(true);
    setError(null);
    try {
      const edits: FileEdit[] = [];
      for (const [filePath, patches] of Object.entries(pathGroups)) {
        const r = await fetch(
          `/api/github/file?repo=${encodeURIComponent(linkedRepo.fullName)}&path=${encodeURIComponent(filePath)}&branch=${encodeURIComponent(linkedRepo.defaultBranch)}`,
          { headers: { ...getAuthHeaders(), "x-github-token": token } }
        );
        if (!r.ok) throw new Error(`Could not fetch ${filePath.split("/").pop()} (${r.status})`);
        const data = await r.json() as { content: string };
        let content = data.content;
        for (const patch of patches) {
          const idx = content.indexOf(patch.find);
          if (idx === -1) throw new Error(
            `Anchor not found in ${filePath.split("/").pop()}. The file may have changed since Atlas last read it — ask Atlas to re-read the file first.`
          );
          content = content.slice(0, idx) + patch.replace + content.slice(idx + patch.find.length);
        }
        const ext = filePath.split(".").pop() ?? "";
        const lang = ["ts", "tsx"].includes(ext) ? "typescript" : ["js", "jsx"].includes(ext) ? "javascript" : ext;
        edits.push({ path: filePath, language: lang, content });
      }
      setPatchedEdits(edits);
      setShowPushModal(true);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setApplying(false);
    }
  };

  return (
    <>
      <div style={{
        marginTop: 12, padding: "11px 14px", borderRadius: 8,
        background: "rgba(201,162,76,0.05)", border: "1px solid rgba(201,162,76,0.2)",
        display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12,
      }}>
        <div style={{ display: "flex", alignItems: "center", gap: 9, minWidth: 0 }}>
          <div style={{ width: 26, height: 26, borderRadius: 6, flexShrink: 0, background: "rgba(201,162,76,0.12)", border: "1px solid rgba(201,162,76,0.25)", display: "flex", alignItems: "center", justifyContent: "center" }}>
            <svg width="13" height="13" viewBox="0 0 16 16" fill="none">
              <circle cx="4.5" cy="4.5" r="2" stroke="var(--atlas-gold)" strokeWidth="1.2" />
              <circle cx="4.5" cy="11.5" r="2" stroke="var(--atlas-gold)" strokeWidth="1.2" />
              <path d="M6.2 5.8L14 3M6.2 10.2L14 13M9 8H14" stroke="var(--atlas-gold)" strokeWidth="1.1" strokeLinecap="round" />
            </svg>
          </div>
          <div style={{ minWidth: 0 }}>
            <div style={{ fontSize: "var(--ts-caption)", fontWeight: 600, color: "var(--atlas-gold)", marginBottom: 2 }}>
              {patchCount} patch{patchCount !== 1 ? "es" : ""} ready
            </div>
            <div style={{ fontFamily: "var(--app-font-mono)", fontSize: "var(--ts-micro)", color: "var(--atlas-muted)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" as const }}>
              {fileCount === 1
                ? uniquePaths[0]
                : `${fileCount} files — ${uniquePaths.map(p => p.split("/").pop()).join(", ")}`}
            </div>
          </div>
        </div>
        <button
          onClick={handleApply}
          disabled={applying}
          style={{
            flexShrink: 0, padding: "6px 13px", borderRadius: 5, fontSize: "var(--ts-caption)", fontWeight: 600,
            fontFamily: "var(--app-font-mono)", letterSpacing: "0.08em",
            background: applying
              ? "rgba(201,162,76,0.25)"
              : "linear-gradient(180deg, var(--atlas-gold) 0%, color-mix(in oklab, var(--atlas-gold) 78%, #6a4a18) 100%)",
            color: applying ? "var(--atlas-gold)" : "var(--atlas-bg)",
            border: "none", cursor: applying ? "default" : "pointer",
            boxShadow: applying ? "none" : "0 0 12px -4px color-mix(in oklab, var(--atlas-gold) 50%, transparent)",
            transition: "opacity 160ms ease",
          }}
        >
          {applying ? "Applying…" : "Apply & Review →"}
        </button>
      </div>

      {error && (
        <div style={{
          marginTop: 8, padding: "8px 12px", borderRadius: 6,
          background: "rgba(239,68,68,0.08)", border: "1px solid rgba(239,68,68,0.25)",
          fontSize: "var(--ts-caption)", color: "rgba(239,68,68,0.85)", fontFamily: "var(--app-font-mono)", lineHeight: 1.55,
        }}>
          {error}
        </div>
      )}

      {showPushModal && patchedEdits && patchedEdits.length > 0 && (
        <GitHubPushModal
          fileEdits={patchedEdits}
          linkedRepo={linkedRepo}
          projectId={projectId}
          onClose={() => setShowPushModal(false)}
          onPushSuccess={(records) => { onPushSuccess(records); setShowPushModal(false); }}
          onPrCreated={onPrCreated}
        />
      )}
    </>
  );
}

export function ReviewPlanCard({
  message,
  projectId,
  linkedRepo,
  githubPushToken,
  planState,
  planExecution,
  onPlanStateChange,
  onPlanExecutionChange,
  onExecuteHomePlan,
  onStreamActivityUpdate,
  onStreamActivityComplete,
  onPushSuccess,
  onPrCreated,
}: {
  message: ChatMessage;
  projectId: number;
  linkedRepo: LinkedRepo | null;
  githubPushToken?: string | null;
  planState: PlanState;
  planExecution?: PlanExecution;
  onPlanStateChange: (messageId: number, state: PlanState) => void;
  onPlanExecutionChange: (messageId: number, execution: PlanExecution | null) => void;
  onExecuteHomePlan: (plan: Plan) => void;
  onStreamActivityUpdate: (message: ChatMessage, content: string) => void;
  onStreamActivityComplete: () => void;
  onPushSuccess: (records: PushRecord[]) => void;
  onPrCreated?: (prUrl: string) => void;
}) {
  const [showPlanPushModal, setShowPlanPushModal] = useState(false);
  const [planPushEdits, setPlanPushEdits] = useState<FileEdit[] | null>(null);
  const activeEdits = message.fileEdits ?? (message.fileEdit ? [message.fileEdit] : []);
  const userEdits = activeEdits.filter((edit) => !/^artifacts\/(atlas|api-server)\//.test(edit.path));
  const planMessageId = message.id ?? 0;

  if (!message.plan) return null;

  const setPlanStatus = (state: PlanState) => {
    onPlanStateChange(planMessageId, state);
  };

  const setPlanExecution = (execution: PlanExecution | null) => {
    onPlanExecutionChange(planMessageId, execution);
  };

  const resolvePlanLinePatches = async (): Promise<FileEdit[]> => {
    if (!message.linePatches?.length) return [];
    if (!linkedRepo) throw new Error("No repo linked - connect a GitHub repo in the Files tab.");
    if (!githubPushToken) throw new Error("No GitHub token — connect GitHub from your home page.");
    const groups: Record<string, LinePatch[]> = {};
    for (const patch of message.linePatches) {
      if (!groups[patch.path]) groups[patch.path] = [];
      groups[patch.path].push(patch);
    }
    const edits: FileEdit[] = [];
    for (const [filePath, patches] of Object.entries(groups)) {
      const response = await fetch(
        `/api/github/file?repo=${encodeURIComponent(linkedRepo.fullName)}&path=${encodeURIComponent(filePath)}&branch=${encodeURIComponent(linkedRepo.defaultBranch)}`,
        { headers: { ...getAuthHeaders(), "x-github-token": githubPushToken } }
      );
      if (!response.ok) throw new Error(`Could not fetch ${filePath.split("/").pop()} (${response.status})`);
      const data = await response.json() as { content: string };
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
    onStreamActivityUpdate(message, `PLAN_STEP:${message.plan.steps[0]?.description ?? message.plan.title}`);

    const codeEdits = userEdits.length > 0 ? userEdits : activeEdits;
    const hasCodeChanges = codeEdits.length > 0 || (message.linePatches?.length ?? 0) > 0;

    if (message.planFromHome && !hasCodeChanges) {
      onExecuteHomePlan(message.plan);
      return;
    }

    if (!hasCodeChanges) {
      setPlanExecution({
        completedStepOrders: message.plan.steps.map((step) => step.order),
        changedFiles: 0,
        statusMessage: "Done. 0 files changed.",
      });
      setPlanStatus("completed");
      onStreamActivityComplete();
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
        onStreamActivityComplete();
        return;
      }
      const pushStep = message.plan.steps.find((step) => step.type === "push") ?? message.plan.steps[message.plan.steps.length - 1];
      setPlanExecution({
        currentStepOrder: pushStep?.order,
        completedStepOrders: message.plan.steps.filter((step) => step.order !== pushStep?.order).map((step) => step.order),
      });
      onStreamActivityUpdate(message, `PLAN_STEP:${pushStep?.description ?? "Review and push changes"}`);
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
      onStreamActivityComplete();
    }
  };

  return (
    <>
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

      {showPlanPushModal && planPushEdits && planPushEdits.length > 0 && (
        <GitHubPushModal
          fileEdits={planPushEdits}
          linkedRepo={linkedRepo}
          projectId={projectId}
          onClose={() => {
            setShowPlanPushModal(false);
            setPlanStatus("pending");
            setPlanExecution(null);
            onStreamActivityComplete();
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
            onStreamActivityComplete();
          }}
          onPrCreated={onPrCreated}
        />
      )}
    </>
  );
}

export function ReviewTabPanel({
  messages,
  projectId,
  linkedRepo,
  githubPushToken,
  planStates,
  planExecutions,
  onPlanStateChange,
  onPlanExecutionChange,
  onExecuteHomePlan,
  onStreamActivityUpdate,
  onStreamActivityComplete,
  onPushSuccess,
  onPrCreated,
}: {
  messages: ChatMessage[];
  projectId: number;
  linkedRepo: LinkedRepo | null;
  githubPushToken?: string | null;
  planStates: Map<number, PlanState>;
  planExecutions: Map<number, PlanExecution>;
  onPlanStateChange: (messageId: number, state: PlanState) => void;
  onPlanExecutionChange: (messageId: number, execution: PlanExecution | null) => void;
  onExecuteHomePlan: (plan: Plan) => void;
  onStreamActivityUpdate: (message: ChatMessage, content: string) => void;
  onStreamActivityComplete: () => void;
  onPushSuccess: (records: PushRecord[]) => void;
  onPrCreated?: (prUrl: string) => void;
}) {
  return (
    <div style={{ flex: 1, height: "100%", overflowY: "auto", padding: "16px 22px 28px" }} className="scrollbar-none">
      {messages.length === 0 ? (
        <div style={{ display: "flex", alignItems: "center", justifyContent: "center", height: "100%", color: "var(--atlas-muted)", fontFamily: "var(--app-font-mono)", fontSize: 10, letterSpacing: "0.08em", textTransform: "uppercase", opacity: 0.55 }}>
          No review items yet.
        </div>
      ) : (
        <div style={{ maxWidth: 720, display: "flex", flexDirection: "column", gap: 10 }}>
          {messages.map((message, index) => {
            const messageId = message.id ?? 0;
            return (
              <ReviewPlanCard
                key={message.id ?? `review-${index}`}
                message={message}
                projectId={projectId}
                linkedRepo={linkedRepo}
                githubPushToken={githubPushToken}
                planState={planStates.get(messageId) ?? "pending"}
                planExecution={planExecutions.get(messageId)}
                onPlanStateChange={onPlanStateChange}
                onPlanExecutionChange={onPlanExecutionChange}
                onExecuteHomePlan={onExecuteHomePlan}
                onStreamActivityUpdate={onStreamActivityUpdate}
                onStreamActivityComplete={onStreamActivityComplete}
                onPushSuccess={onPushSuccess}
                onPrCreated={onPrCreated}
              />
            );
          })}
        </div>
      )}
    </div>
  );
}

// ── PushDiffCard ──────────────────────────────────────────────────────────────
// Groups one commit's worth of file pushes into a collapsible diff card.
export function PushDiffCard({ records, onRollbackAll }: { records: PushRecord[]; onRollbackAll: () => Promise<void> }) {
  const [open, setOpen] = useState(true);
  const [rolling, setRolling] = useState(false);
  const [done, setDone] = useState(records.every(r => r.rolledBack));

  const first = records[0];
  const canRollback = records.some(r => r.originalContent && !r.rolledBack);

  const stats = records.map(r => ({ ...r, ...diffStat(r.originalContent, r.newContent) }));
  const totalAdded = stats.reduce((s, r) => s + r.additions, 0);
  const totalDeleted = stats.reduce((s, r) => s + r.deletions, 0);

  return (
    <div style={{ borderRadius: 8, background: "rgba(0,0,0,0.22)", border: "1px solid var(--atlas-border)", marginBottom: 7, overflow: "hidden" }}>
      {/* Collapsible header */}
      <button
        onClick={() => setOpen(o => !o)}
        style={{ width: "100%", display: "flex", alignItems: "center", gap: 8, padding: "9px 12px", background: "transparent", border: "none", cursor: "pointer", textAlign: "left" }}
      >
        <svg
          width="10" height="10" viewBox="0 0 10 10" fill="none"
          style={{ flexShrink: 0, transition: "transform 160ms ease", transform: open ? "rotate(90deg)" : "rotate(0deg)", opacity: 0.45 }}
        >
          <path d="M3 2l4 3-4 3" stroke="var(--atlas-fg)" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
        <span style={{ fontFamily: "var(--app-font-mono)", fontSize: "var(--ts-sm)", color: "var(--atlas-fg)", flex: 1 }}>
          {records.length} File{records.length !== 1 ? "s" : ""} Changed
        </span>
        <span style={{ fontFamily: "var(--app-font-mono)", fontSize: "var(--ts-xs)", color: "#4ade80", opacity: 0.8 }}>+{totalAdded}</span>
        <span style={{ fontFamily: "var(--app-font-mono)", fontSize: "var(--ts-xs)", color: "#f87171", opacity: 0.8, marginRight: 4 }}>-{totalDeleted}</span>
        <span style={{ fontFamily: "var(--app-font-mono)", fontSize: "var(--ts-tiny)", color: "var(--atlas-muted)", opacity: 0.45 }}>
          {new Date(first.pushedAt).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}
        </span>
      </button>

      {/* File list */}
      {open && (
        <div style={{ borderTop: "1px solid var(--atlas-border)" }}>
          {stats.map(r => {
            const ext = r.filename.split(".").pop()?.toLowerCase() ?? "";
            const iconColor =
              ext === "ts" || ext === "tsx" ? "#60a5fa"
              : ext === "js" || ext === "jsx" ? "#fbbf24"
              : ext === "css" || ext === "scss" ? "#a78bfa"
              : ext === "json" ? "#34d399"
              : ext === "md" ? "#C9A24C"
              : ext === "py" ? "#4ade80"
              : ext === "html" ? "#f97316"
              : ext === "sh" || ext === "bash" ? "#86efac"
              : "rgba(var(--atlas-muted-rgb),0.65)";
            const isNew = r.originalContent === null;
            return (
              <div key={r.id} style={{ display: "flex", alignItems: "center", gap: 8, padding: "6px 12px", borderBottom: "1px solid var(--atlas-surface)" }}>
                <svg width="11" height="11" viewBox="0 0 16 16" fill="none" style={{ flexShrink: 0, opacity: 0.8 }}>
                  <path d="M9 1H3a1 1 0 00-1 1v12a1 1 0 001 1h10a1 1 0 001-1V6L9 1z" stroke={iconColor} strokeWidth="1.2" strokeLinejoin="round" />
                  <path d="M9 1v5h5" stroke={iconColor} strokeWidth="1.2" strokeLinejoin="round" />
                </svg>
                <span style={{ flex: 1, fontFamily: "var(--app-font-mono)", fontSize: "var(--ts-sm)", color: "var(--atlas-fg)", opacity: 0.85, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                  {r.filename}
                </span>
                <span style={{ fontFamily: "var(--app-font-mono)", fontSize: "var(--ts-micro)", color: "#4ade80", flexShrink: 0 }}>+{r.additions}</span>
                {isNew ? (
                  <span style={{ fontFamily: "var(--app-font-mono)", fontSize: "var(--ts-tiny)", background: "rgba(74,222,128,0.12)", border: "1px solid rgba(74,222,128,0.3)", color: "#4ade80", padding: "0px 5px", borderRadius: 4, flexShrink: 0, letterSpacing: "0.04em" }}>New</span>
                ) : (
                  <span style={{ fontFamily: "var(--app-font-mono)", fontSize: "var(--ts-micro)", color: "#f87171", flexShrink: 0 }}>-{r.deletions}</span>
                )}
              </div>
            );
          })}
        </div>
      )}

      {/* Footer actions */}
      <div style={{ display: "flex", alignItems: "center", gap: 6, padding: "7px 12px", justifyContent: "space-between" }}>
        <div style={{ fontFamily: "var(--app-font-mono)", fontSize: "var(--ts-xs)", color: "var(--atlas-muted)", opacity: 0.4, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
          {first.branch}
        </div>
        <div style={{ display: "flex", gap: 5, flexShrink: 0 }}>
          {first.commitUrl && (
            <a href={first.commitUrl} target="_blank" rel="noopener noreferrer"
              style={{ padding: "3px 9px", borderRadius: 4, fontSize: "var(--ts-xs)", fontFamily: "var(--app-font-mono)", background: "transparent", border: "1px solid var(--atlas-border)", color: "var(--atlas-muted)", textDecoration: "none", opacity: 0.75 }}
            >
              View →
            </a>
          )}
          {canRollback && !done && (
            <button
              disabled={rolling}
              onClick={async () => { setRolling(true); await onRollbackAll(); setRolling(false); setDone(true); }}
              style={{ padding: "3px 9px", borderRadius: 4, fontSize: "var(--ts-xs)", fontFamily: "var(--app-font-mono)", background: rolling ? "rgba(255,255,255,0.03)" : "rgba(239,68,68,0.07)", border: `1px solid ${rolling ? "var(--atlas-border)" : "rgba(239,68,68,0.22)"}`, color: rolling ? "var(--atlas-muted)" : "rgba(252,165,165,0.8)", cursor: rolling ? "not-allowed" : "pointer", transition: "all 150ms ease" }}
            >
              {rolling ? "…" : "↺ Rollback"}
            </button>
          )}
          {done && <span style={{ padding: "3px 9px", fontSize: "var(--ts-xs)", fontFamily: "var(--app-font-mono)", color: "var(--atlas-muted)", opacity: 0.45 }}>rolled back</span>}
        </div>
      </div>
    </div>
  );
}

