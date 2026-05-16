import { Check, Eye, Pencil, Upload, X } from "lucide-react";
import type { Plan, PlanExecution, PlanStepType } from "../lib/plan";

type PlanCardProps = {
  plan: Plan;
  messageId: number;
  projectId: number;
  onApprove: () => void;
  onSkip: () => void;
  onReview: () => void;
  isExecuting: boolean;
  execution?: PlanExecution;
  isExpanded?: boolean;
  isCompleted?: boolean;
  displayMode?: "workspace" | "home";
  onTakeToWorkspace?: () => void;
};

function iconForType(type: PlanStepType) {
  if (type === "edit") return <Pencil size={12} />;
  if (type === "read") return <Eye size={12} />;
  if (type === "push") return <Upload size={12} />;
  return <span style={{ fontSize: 12, lineHeight: 1 }}>•</span>;
}

function confidenceStyles(confidence: Plan["confidence"]) {
  if (confidence === "high") {
    return {
      color: "var(--atlas-phosphor)",
      background: "color-mix(in oklab, var(--atlas-phosphor) 10%, transparent)",
      border: "1px solid color-mix(in oklab, var(--atlas-phosphor) 24%, transparent)",
    };
  }
  if (confidence === "low") {
    return {
      color: "var(--atlas-ember)",
      background: "color-mix(in oklab, var(--atlas-ember) 10%, transparent)",
      border: "1px solid color-mix(in oklab, var(--atlas-ember) 24%, transparent)",
    };
  }
  return {
    color: "var(--atlas-gold)",
    background: "color-mix(in oklab, var(--atlas-gold) 10%, transparent)",
    border: "1px solid color-mix(in oklab, var(--atlas-gold) 24%, transparent)",
  };
}

function stepVerb(type: PlanStepType): string {
  if (type === "edit") return "Editing";
  if (type === "read") return "Reading";
  if (type === "push") return "Pushing";
  if (type === "analysis") return "Analyzing";
  return "Working on";
}

export function PlanCard({
  plan,
  messageId,
  projectId,
  onApprove,
  onSkip,
  onReview,
  isExecuting,
  execution,
  isExpanded = false,
  isCompleted = false,
  displayMode = "workspace",
  onTakeToWorkspace,
}: PlanCardProps) {
  const completed = new Set(execution?.completedStepOrders ?? []);
  const failedOrder = execution?.failedStep?.order;
  const currentOrder = execution?.currentStepOrder;
  const currentStep = plan.steps.find((step) => step.order === currentOrder) ?? plan.steps[0];
  const showBody = isExpanded || isExecuting || isCompleted || !!failedOrder;
  const badgeStyle = confidenceStyles(plan.confidence);
  const _ids = { messageId, projectId }; void _ids;

  return (
    <div
      style={{
        marginTop: 12,
        padding: "12px 14px",
        borderRadius: 10,
        background: "var(--atlas-surface)",
        border: "1px solid color-mix(in oklab, var(--atlas-gold) 20%, var(--atlas-border))",
        borderLeft: "3px solid var(--atlas-gold)",
        boxShadow: "0 14px 36px -28px var(--atlas-gold)",
      }}
    >
      <style>{`
        @keyframes atlas-plan-current-pulse {
          0%, 100% { opacity: 0.68; transform: scale(1); }
          50% { opacity: 1; transform: scale(1.08); }
        }
      `}</style>

      <div style={{ display: "flex", alignItems: "flex-start", gap: 9, marginBottom: showBody ? 10 : 0 }}>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontSize: 13, fontWeight: 700, color: "var(--atlas-fg)", lineHeight: 1.35 }}>
            {plan.title}
          </div>
          <div style={{ marginTop: 5, display: "flex", flexWrap: "wrap", gap: 6, alignItems: "center" }}>
            <span
              style={{
                ...badgeStyle,
                display: "inline-flex",
                alignItems: "center",
                borderRadius: 999,
                padding: "2px 7px",
                fontFamily: "var(--app-font-mono)",
                fontSize: 9,
                fontWeight: 700,
                letterSpacing: "0.08em",
                textTransform: "uppercase",
              }}
            >
              {plan.confidence}
            </span>
            <span style={{ fontFamily: "var(--app-font-mono)", fontSize: 9.5, color: "var(--atlas-muted)", opacity: 0.72 }}>
              {plan.estimatedChanges} estimated change{plan.estimatedChanges === 1 ? "" : "s"}
            </span>
            {plan.reversible && (
              <span style={{ fontFamily: "var(--app-font-mono)", fontSize: 9.5, color: "var(--atlas-muted)", opacity: 0.58 }}>
                reversible by git
              </span>
            )}
          </div>
        </div>
      </div>

      {showBody && (
        <ol style={{ listStyle: "none", padding: 0, margin: "0 0 12px", display: "flex", flexDirection: "column", gap: 8 }}>
          {plan.steps.map((step) => {
            const isFailed = failedOrder === step.order;
            const isCurrent = !isFailed && currentOrder === step.order && isExecuting;
            const isDone = completed.has(step.order) || (isCompleted && !isFailed);
            return (
              <li key={step.order} style={{ display: "flex", gap: 8, alignItems: "flex-start" }}>
                <span
                  style={{
                    width: 18,
                    height: 18,
                    borderRadius: "50%",
                    flexShrink: 0,
                    display: "inline-flex",
                    alignItems: "center",
                    justifyContent: "center",
                    marginTop: 1,
                    color: isFailed
                      ? "var(--atlas-ember)"
                      : isDone
                      ? "var(--atlas-phosphor)"
                      : isCurrent
                      ? "var(--atlas-gold)"
                      : "var(--atlas-muted)",
                    background: isFailed
                      ? "color-mix(in oklab, var(--atlas-ember) 10%, transparent)"
                      : isDone
                      ? "color-mix(in oklab, var(--atlas-phosphor) 10%, transparent)"
                      : isCurrent
                      ? "color-mix(in oklab, var(--atlas-gold) 12%, transparent)"
                      : "var(--atlas-bg)",
                    border: `1px solid ${
                      isFailed
                        ? "color-mix(in oklab, var(--atlas-ember) 30%, transparent)"
                        : isDone
                        ? "color-mix(in oklab, var(--atlas-phosphor) 30%, transparent)"
                        : isCurrent
                        ? "color-mix(in oklab, var(--atlas-gold) 34%, transparent)"
                        : "var(--atlas-border)"
                    }`,
                    animation: isCurrent ? "atlas-plan-current-pulse 1.2s ease-in-out infinite" : "none",
                  }}
                >
                  {isFailed ? <X size={11} /> : isDone ? <Check size={11} /> : iconForType(step.type)}
                </span>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ display: "flex", gap: 6, alignItems: "baseline", minWidth: 0 }}>
                    <span style={{ fontFamily: "var(--app-font-mono)", fontSize: 10, color: "var(--atlas-muted)", opacity: 0.7 }}>
                      {step.order}.
                    </span>
                    {step.file && (
                      <span
                        title={step.file}
                        style={{
                          fontFamily: "var(--app-font-mono)",
                          fontSize: 10,
                          color: "var(--atlas-gold)",
                          maxWidth: 180,
                          overflow: "hidden",
                          textOverflow: "ellipsis",
                          whiteSpace: "nowrap",
                        }}
                      >
                        {step.file.split("/").pop()}
                      </span>
                    )}
                    <span style={{ color: "var(--atlas-fg)", fontSize: 12, lineHeight: 1.45 }}>
                      {step.description}
                    </span>
                  </div>
                  {isFailed && execution?.failedStep?.error && (
                    <div style={{ marginTop: 3, fontFamily: "var(--app-font-mono)", fontSize: 10, color: "var(--atlas-ember)", lineHeight: 1.45 }}>
                      {execution.failedStep.error}
                    </div>
                  )}
                </div>
              </li>
            );
          })}
        </ol>
      )}

      {isCompleted && execution?.statusMessage && (
        <div
          style={{
            marginBottom: 10,
            padding: "7px 9px",
            borderRadius: 7,
            background: "color-mix(in oklab, var(--atlas-phosphor) 8%, transparent)",
            border: "1px solid color-mix(in oklab, var(--atlas-phosphor) 24%, transparent)",
            color: "var(--atlas-phosphor)",
            fontSize: 11,
            fontFamily: "var(--app-font-mono)",
          }}
        >
          {execution.statusMessage}
        </div>
      )}

      {isExecuting ? (
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: 8,
            padding: "7px 9px",
            borderRadius: 7,
            background: "color-mix(in oklab, var(--atlas-gold) 7%, transparent)",
            border: "1px solid color-mix(in oklab, var(--atlas-gold) 16%, transparent)",
          }}
        >
          <span
            style={{
              width: 7,
              height: 7,
              borderRadius: "50%",
              background: "var(--atlas-gold)",
              display: "inline-block",
              animation: "atlas-plan-current-pulse 1.2s ease-in-out infinite",
              flexShrink: 0,
            }}
          />
          <span style={{ fontFamily: "var(--app-font-mono)", fontSize: 10, color: "var(--atlas-muted)", letterSpacing: "0.04em" }}>
            Step {currentStep?.order ?? 1} of {plan.steps.length} - {currentStep ? `${stepVerb(currentStep.type)} ${currentStep.file?.split("/").pop() ?? currentStep.description}...` : "Executing plan..."}
          </span>
        </div>
      ) : displayMode === "home" ? (
        <div style={{ display: "flex", gap: 8 }}>
          <button
            type="button"
            onClick={onReview}
            style={{
              flex: 1,
              padding: "7px 10px",
              borderRadius: 7,
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
            {isExpanded ? "Close" : "Review"}
          </button>
          <button
            type="button"
            onClick={onTakeToWorkspace}
            style={{
              flex: 1.4,
              padding: "7px 10px",
              borderRadius: 7,
              background: "var(--atlas-gold)",
              border: "1px solid var(--atlas-gold)",
              color: "var(--atlas-bg)",
              cursor: "pointer",
              fontFamily: "var(--app-font-mono)",
              fontSize: 10,
              fontWeight: 800,
              letterSpacing: "0.08em",
              textTransform: "uppercase",
            }}
          >
            Take to workspace -&gt;
          </button>
        </div>
      ) : (
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <button
            type="button"
            onClick={onReview}
            style={{
              flex: 1,
              padding: "7px 10px",
              borderRadius: 7,
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
            {isExpanded ? "Close" : "Review"}
          </button>
          <button
            type="button"
            onClick={onSkip}
            style={{
              flex: 1,
              padding: "7px 10px",
              borderRadius: 7,
              background: "transparent",
              border: "none",
              color: "var(--atlas-muted)",
              cursor: "pointer",
              fontFamily: "var(--app-font-mono)",
              fontSize: 10,
              letterSpacing: "0.08em",
              textTransform: "uppercase",
              opacity: 0.7,
            }}
          >
            Skip
          </button>
          <button
            type="button"
            onClick={onApprove}
            style={{
              flex: 1.2,
              padding: "7px 10px",
              borderRadius: 7,
              background: "linear-gradient(180deg, var(--atlas-gold) 0%, color-mix(in oklab, var(--atlas-gold) 78%, var(--atlas-bg)) 100%)",
              border: "1px solid var(--atlas-gold)",
              color: "var(--atlas-bg)",
              cursor: "pointer",
              fontFamily: "var(--app-font-mono)",
              fontSize: 10,
              fontWeight: 800,
              letterSpacing: "0.08em",
              textTransform: "uppercase",
            }}
          >
            Approve
          </button>
        </div>
      )}
    </div>
  );
}
