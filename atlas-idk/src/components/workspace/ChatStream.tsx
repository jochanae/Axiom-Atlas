import type { CSSProperties, ReactNode, RefObject } from "react";
import { useIsMobile } from "@/hooks/use-mobile";
import { UserBubble } from "@/components/workspace/UserBubble";
import { AtlasActivityBar } from "@/components/workspace/AtlasActivityBar";
import { AssistantBubble } from "@/components/workspace/AssistantBubble";
import InlineSketchOffer from "@/components/chat/InlineSketchOffer";
import { InlineTerminalBlock } from "@/components/InlineTerminalBlock";
import { LiveGenerationCard } from "@/components/workspace/LiveGenerationCard";
import { TimelineRail } from "../TimelineRail";

import type { ChatMessage, LinkedRepo, PushRecord } from "@/pages/workspace";
import type { PlanExecution } from "@/lib/plan";
import type { Plan } from "@/lib/plan";
import type { PlanState } from "@/components/workspace/chatShared";

// Minimal structural types — avoid importing private types from workspace.tsx
type ProjectLike = { name?: string } | null | undefined;
type HomeHandoffMetaLike = { flowNodeCount: number; goalLabel: string } | null | undefined;
type LinkedRepoLike = LinkedRepo | null;
type PushRecordLike = PushRecord;
type LiveGenerationLike = {
  shouldShow: boolean;
  mode: string;
  steps: unknown[];
};
type LiveStepLike = { verb: string; target?: string; status?: string } | null;
type PlanExecutionLike = PlanExecution;

function isAutoVerifyMessage(msg: ChatMessage): boolean {
  return msg.displayAs === "autoVerify" || msg.content.startsWith("[FILE_COMMITTED]");
}

function AutoVerifyMessage({ content }: { content: string }) {
  return (
    <div
      style={{
        maxWidth: "82%",
        margin: "4px 0 18px",
        padding: "7px 0 7px 11px",
        borderLeft: "2px solid rgba(201,162,76,0.4)",
        color: "rgba(var(--atlas-muted-rgb),0.9)",
        fontSize: "var(--ts-caption)",
        lineHeight: 1.55,
        whiteSpace: "pre-wrap",
      }}
    >
      <div
        style={{
          color: "rgba(201,162,76,0.55)",
          fontFamily: "var(--app-font-mono)",
          fontSize: "var(--ts-micro)",
          marginBottom: 4,
        }}
      >
        Auto-verify
      </div>
      {content}
    </div>
  );
}

export interface ChatStreamProps {
  // scroll container
  scrollRef: RefObject<HTMLDivElement | null>;
  bottomRef: RefObject<HTMLDivElement | null>;
  onScroll: (e: React.UIEvent<HTMLDivElement>) => void;
  showScrollBtn: boolean;
  onScrollToLatest: () => void;

  // state
  messages: ChatMessage[];
  chatPending: boolean;
  activityStream: { active: boolean; content: string };
  liveGeneration: LiveGenerationLike;
  liveStep: LiveStepLike;
  thinkingBlock?: ReactNode;
  historyMsgCountRef: RefObject<number> | { current: number };
  priorLoaded?: boolean;

  // empty state
  isHomeHandoff: boolean;
  homeHandoffMeta: HomeHandoffMetaLike;
  isBrandNewProject: boolean;
  atlasGreeting?: string | null;
  greetingLoading?: boolean;
  project: ProjectLike;
  onStarterPrompt: (label: string) => void;

  // long-thread banner
  wsModel: string;
  wsLens?: string;
  onSwitchToGemini: () => void;

  // user bubble
  onEditUserMessage: (content: string) => void;

  // assistant bubble — context
  projectId: number;
  sessionId: number | null;
  linkedRepo: LinkedRepoLike;
  trustMode: "review" | "auto";

  // assistant bubble — per-message handlers
  onPark: AssistantBubbleProp<"onPark">;
  onCommit: AssistantBubbleProp<"onCommit">;
  onRegenerate: (index: number) => void;
  onSend?: (message: string) => void;
  onPreviewCode: AssistantBubbleProp<"onPreviewCode">;
  onRunCommand: AssistantBubbleProp<"onRunCommand">;
  onPrCreated: (url: string) => void;
  onExtractToForge: (content: string) => void;
  onForgeIntake?: (content: string) => Promise<void> | void;
  onReviewDiff: () => void;
  onOpenArtifact?: (title: string) => void;
  onEditDeclined: () => void;
  onAlertDismiss: (msg: ChatMessage) => void;
  onStreamActivityUpdate: (msg: ChatMessage, content: string) => void;
  onStreamActivityComplete: () => void;
  onCommitCardDone: () => void;

  // plan
  planStates: Map<number, PlanState>;
  planExecutions: Map<number, PlanExecutionLike>;
  onPlanStateChange: (messageId: number, state: PlanState) => void;
  onPlanExecutionChange: (messageId: number, execution: PlanExecutionLike) => void;
  onExecuteHomePlan: (plan: Plan) => void;

  // push
  onPushSuccess: (records: PushRecordLike[]) => void;
}

// Helper alias so we don't re-derive AssistantBubble prop types here.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AssistantBubbleProp<K extends string> = any;

export function ChatStream(props: ChatStreamProps) {
  const {
    scrollRef, bottomRef, onScroll, showScrollBtn, onScrollToLatest,
    messages, chatPending, activityStream, liveGeneration, thinkingBlock, historyMsgCountRef,
    priorLoaded,
    isHomeHandoff, homeHandoffMeta, atlasGreeting, greetingLoading,
    wsModel, wsLens, onSwitchToGemini,
    onEditUserMessage,
    projectId, sessionId, linkedRepo, trustMode,
    onPark, onCommit, onRegenerate, onSend,
    onPreviewCode, onRunCommand, onPrCreated, onExtractToForge, onForgeIntake, onReviewDiff,
    onOpenArtifact,
    onEditDeclined, onAlertDismiss, onStreamActivityUpdate, onStreamActivityComplete,
    onCommitCardDone,
    planStates, planExecutions, onPlanStateChange, onPlanExecutionChange, onExecuteHomePlan,
    onPushSuccess,
  } = props;

  // Match home: parent padding "0 24px" + inner scroller paddingRight 80, paddingTop 56.
  // Bottom padding is generous so messages scroll *behind* the translucent glass composer.
  // On mobile, collapse the desktop rail gutter so content is edge-to-edge like /home.
  const isMobile = useIsMobile();
  const containerStyle: CSSProperties = {
    flex: 1, overflowY: "auto", overflowX: "hidden",
    overscrollBehaviorY: "contain",
    padding: isMobile ? "32px 14px 20px 14px" : "56px 104px 28px 24px",
    position: "relative", scrollbarWidth: "none",
  };

  return (
    <div style={{ position: "relative", flex: 1, minHeight: 0, display: "flex", flexDirection: "column" }}>
    <div

      ref={scrollRef}
      aria-live="polite"
      aria-label="Atlas conversation"
      aria-busy={chatPending ? "true" : "false"}
      onScroll={onScroll}
      style={containerStyle}
      className="scrollbar-none atlas-chat-timeline"
    >
      {messages.length === 0 && !chatPending && priorLoaded !== false && isHomeHandoff && homeHandoffMeta && (
        <div style={{ padding: "52px 20px 32px", display: "flex", flexDirection: "column", alignItems: "center" }}>
          <div style={{ maxWidth: 520, color: "var(--atlas-fg)", fontSize: 15, lineHeight: 1.75, textAlign: "center", opacity: 0.88 }}>
            Picked up where we left off. Your flow map has {homeHandoffMeta.flowNodeCount} nodes — {homeHandoffMeta.goalLabel} is the center. What do you want to tackle first?
          </div>
        </div>
      )}
      {messages.length === 0 && !chatPending && priorLoaded !== false && !(isHomeHandoff && homeHandoffMeta) && (
        <div style={{
          display: "flex", flexDirection: "column", alignItems: "flex-start",
          padding: "32px 4px 8px", gap: 8,
        }}>
          {greetingLoading ? (
            <div style={{ fontFamily: "var(--app-font-mono)", fontSize: 11, color: "var(--atlas-muted)", letterSpacing: "0.12em", textTransform: "uppercase", opacity: 0.7 }}>
              Atlas is here…
            </div>
          ) : (
            <div style={{
              maxWidth: 540,
              color: "var(--atlas-fg)",
              fontSize: 17,
              lineHeight: 1.55,
              fontWeight: 400,
              letterSpacing: "-0.005em",
              opacity: 0.92,
            }}>
              {atlasGreeting?.trim() || "What are we shaping here?"}
            </div>
          )}
        </div>
      )}


      {messages.map((msg, i) =>
        msg.role === "user" ? (
          <div key={i} data-atlas-msg-idx={i} data-msg-idx={i}>
            {isAutoVerifyMessage(msg) ? (
              <AutoVerifyMessage content={msg.content} />
            ) : (
              <UserBubble
                content={msg.content}
                sentAt={msg.sentAt}
                imageB64={msg.imageB64}
                imageMimeType={msg.imageMimeType}
                attachments={msg.attachments}
                onCopy={() => {}}
                onEdit={() => onEditUserMessage(msg.content)}
              />
            )}
          </div>
        ) : (
          <div key={i} data-atlas-msg-idx={i} data-msg-idx={i}>
            {activityStream.active && i === messages.length - 1 && (
              liveGeneration.shouldShow ? (
                <LiveGenerationCard
                  mode={liveGeneration.mode as never}
                  steps={liveGeneration.steps as never}
                  isComplete={false}
                />
              ) : (
                <AtlasActivityBar content={activityStream.content} lens={wsLens} />
              )
            )}
            <AssistantBubble
              message={msg}
              isNew={msg.role === "assistant" && i >= (historyMsgCountRef.current ?? 0) && i === messages.map((m, idx) => m.role === "assistant" ? idx : -1).reduce((a, b) => b > a ? b : a, -1)}
              projectId={projectId}
              sessionId={sessionId || 0}
              linkedRepo={linkedRepo as LinkedRepoLike extends infer T ? T : never}
              onPark={onPark}
              onCommit={onCommit}
              onRegenerate={() => onRegenerate(i)}
              onSend={onSend}
              onPreviewCode={onPreviewCode}
              onRunCommand={onRunCommand}
              onPrCreated={onPrCreated}
              onExtractToForge={onExtractToForge}
              onForgeIntake={onForgeIntake}
              onReviewDiff={onReviewDiff}
              onOpenArtifact={onOpenArtifact}
              onEditDeclined={onEditDeclined}
              onAlertDismiss={() => onAlertDismiss(msg)}
              onStreamActivityUpdate={(content: string) => onStreamActivityUpdate(msg, content)}
              onStreamActivityComplete={onStreamActivityComplete}
              onCommitCardDone={onCommitCardDone}
              planState={planStates.get(msg.id ?? 0) ?? "pending"}
              planExecution={planExecutions.get(msg.id ?? 0)}
              onPlanStateChange={onPlanStateChange}
              onPlanExecutionChange={onPlanExecutionChange}
              onExecuteHomePlan={onExecuteHomePlan}
              trustMode={trustMode}
              onPushSuccess={onPushSuccess}
            />
            {Boolean(msg.terminalCmd || msg.terminalResult) && (
              <div style={{ maxWidth: "80%", marginTop: -18, marginBottom: 24 }}>
                <InlineTerminalBlock terminalCmd={msg.terminalCmd} terminalResult={msg.terminalResult} projectId={projectId} />
              </div>
            )}
            {!msg.imageB64 && !msg.imageGen && (
              <InlineSketchOffer text={msg.content || ""} onSend={onSend} />
            )}
          </div>
        )
      )}

      {messages.filter(m => m.role !== "user").length >= 60 && !chatPending && wsModel !== "gemini" && (
        <div style={{
          display: "flex", alignItems: "center", gap: 8, margin: "4px 0 16px",
          padding: "8px 12px", borderRadius: 8,
          background: "rgba(66,133,244,0.06)", border: "1px solid rgba(66,133,244,0.2)",
        }}>
          <svg width="13" height="13" viewBox="0 0 16 16" fill="none" style={{ flexShrink: 0 }}>
            <circle cx="8" cy="8" r="6" stroke="rgba(66,133,244,0.7)" strokeWidth="1.3" />
            <path d="M8 5v4M8 10.5v.5" stroke="rgba(66,133,244,0.7)" strokeWidth="1.3" strokeLinecap="round" />
          </svg>
          <span style={{ fontFamily: "var(--app-font-mono)", fontSize: 9.5, color: "var(--atlas-fg)", letterSpacing: "0.04em", flex: 1 }}>
            Long thread. Gemini handles more context without losing the top.
          </span>
          <button
            onClick={onSwitchToGemini}
            style={{
              fontFamily: "var(--app-font-mono)", fontSize: 9, letterSpacing: "0.08em",
              padding: "3px 8px", borderRadius: 4, cursor: "pointer",
              background: "rgba(66,133,244,0.15)", border: "1px solid rgba(66,133,244,0.35)",
              color: "#4285f4", whiteSpace: "nowrap",
            }}
          >
            Switch →
          </button>
        </div>
      )}

      {activityStream.active && (messages.length === 0 || messages[messages.length - 1].role === "user") ? (
        liveGeneration.shouldShow ? (
          <LiveGenerationCard
            mode={liveGeneration.mode as never}
            steps={liveGeneration.steps as never}
            isComplete={false}
          />
        ) : (
          <AtlasActivityBar content={activityStream.content} lens={wsLens} />
        )
      ) : null}
      {thinkingBlock}


      <div ref={bottomRef} />


    </div>
      {showScrollBtn && (
        <button
          onPointerDown={(e) => {
            if (e.pointerType !== "mouse") {
              e.preventDefault();
              onScrollToLatest();
            }
          }}
          onClick={(e) => {
            if (e.detail === 0) onScrollToLatest();
          }}
          aria-label="Scroll to latest"
          style={{
            position: "absolute",
            bottom: 10,
            right: 12,
            width: 32,
            height: 32,
            borderRadius: "50%",
            background: "var(--atlas-surface)",
            border: "1px solid var(--atlas-gold)",
            color: "var(--atlas-gold)",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            cursor: "pointer",
            boxShadow: "0 2px 12px rgba(0,0,0,0.4)",
            zIndex: 50,
            pointerEvents: "auto",
          }}
        >
          <svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
            <path d="M8 3v10M4 9l4 4 4-4"/>
          </svg>
        </button>
      )}
      <TimelineRail bottomOffset={isMobile ? 228 : 110} messages={messages.map((m) => ({ role: m.role as "user" | "assistant", createdAt: m.sentAt, hasSurfacedMemory: !!(m.memoryChips && m.memoryChips.length > 0), text: m.content }))} />
    </div>
  );
}
