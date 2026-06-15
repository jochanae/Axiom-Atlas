import { useState, useRef, useEffect, useCallback, useMemo, Fragment, type ReactNode } from "react";
import ReactMarkdown from "react-markdown";
import { Project, getListProjectsQueryKey, createProject, useCreateProject, createEntry, useCreateEntry } from "@workspace/api-client-react";
import { createPortal } from "react-dom";
import { useLocation } from "wouter";
import { LoadingSpinner } from "../components/ui/loading-spinner";
import { CollapsibleMessageText } from "@/components/CollapsibleMessageText";
import { HistoryBookmarksSheet } from "@/components/HistoryBookmarksSheet";
import { useQueryClient } from "@tanstack/react-query";
import { useListProjects } from "@workspace/api-client-react";
import { getLinkedRepoFullName, normalizeGitHubRepoInput, serializeLinkedRepo } from "@/lib/githubRepo";
import { API_BASE } from "@/lib/api";
import { ProjectsDrawer } from "../components/ProjectsDrawer";
import { TimelineRail } from "../components/TimelineRail";
import { UserMenuDropdown } from "../components/UserMenuDropdown";
import SketchReveal from "@/components/chat/SketchReveal";
import InlineSketchOffer from "@/components/chat/InlineSketchOffer";
import { UnifiedConversationSurface } from "../components/UnifiedConversationSurface";
import { UnifiedContextDock } from "../components/UnifiedContextDock";
import { UnifiedSubheader, type UnifiedSubheaderTab } from "../components/UnifiedSubheader";
import { AccountHubPanel } from "../components/AccountHubPanel";
import { BelowFoldDashboard } from "../components/BelowFoldDashboard";
import { TheForge } from "../components/TheForge";
import { InlineTerminalBlock } from "../components/InlineTerminalBlock";
import { ResearchCard } from "../components/ResearchCard";
import { ComposerActions } from "../components/composer/ComposerActions";
import { GlobalInsightSurface } from "@/components/home/GlobalInsightSurface";
import { SessionHistorySheet } from "@/components/SessionHistorySheet";

import { VisualVault } from "../components/VisualVault";
import { InviteModal } from "../components/InviteModal";

import { extractApiErrorMessage } from "../lib/atlas-utils";
import { ingestRepository } from "../lib/repoIngest";
import { chooseGreeting, readLastActive, markActiveNow } from "../lib/atlas-voice";
import { useRequireAuth } from "../hooks/useAuth";
import { useThemeMode } from "../lib/theme";
import { useSubscription } from "../hooks/useSubscription";
import { useProjectState } from "../hooks/useProjectState";
import { toast } from "sonner";
import { UpgradeModal } from "../components/UpgradeModal";
import { NewProjectModal } from "../components/NewProjectModal";
import { CompactReadinessRing, computeScoreFromNodeState } from "../components/ReadinessRing";
import { PlanCard } from "../components/PlanCard";
import { detectPlanFromText } from "../lib/plan";
import type { Plan } from "../lib/plan";
import { Briefcase } from "lucide-react";
import type { RunStatus, RunAction, RunArtifact } from "../components/RunSummary";
import { useShellState } from "../components/UnifiedShell";
import { useShellStore } from "../store/shellStore";
import { usePullToRefresh } from "@/hooks/usePullToRefresh";
import { useNexusChatStream } from "@/hooks/useNexusChatStream";
import { followScrollIfNearBottom } from "@/lib/textPacer";
import { useIsMobile } from "@/hooks/use-mobile";
import { fileToBase64Safe } from "@/lib/image-resize";


const PLACEHOLDERS = [
  "What are we actually trying to solve here…",
  "What decision do you keep circling back to…",
  "Where did the last session leave things…",
  "What's the constraint you haven't named yet…",
  "What would have to be true for this to work…",
];

const HOME_PENDING_PHRASES = [
  "Loading context…",
  "Reading your ledger…",
  "Thinking…",
  "Checking for conflicts…",
  "Reviewing your portfolio…",
  "Composing a response…",
];

const OPENING_MESSAGE_STORAGE_KEY = "atlas-opening-message";
const OPENING_MESSAGE_PROJECT_ID_STORAGE_KEY = "atlas-opening-message-project-id";
const OPENING_CONVERSATION_STORAGE_KEY = "atlas-opening-conversation";
const THINK_FREELY_THREAD_STORAGE_KEY = "atlas-think-freely-thread";
const THINK_OUT_LOUD_STARTER = "I've been turning something over and want to think it through out loud — ";
const GLOBAL_INSIGHT_PORTFOLIO_SEED =
  "Across all my projects, what should I know right now — any conflicts between decisions, which projects are active versus stalled, and the one or two things most worth doing next?";

type HomeHandoffSignal = {
  readyToHandoff: boolean;
  confidence: "high" | "medium" | "low";
  projectName: string | null;
  reason: string | null;
  projectId?: number | null;
};

type AmbientSurface = {
  type: "MAP" | "WORKSPACE" | "DECISION";
  label: string;
  reason?: string | null;
  projectId?: number | null;
  workspaceId?: number | null;
} | null;

type HomeMessage = {
  role: "user" | "assistant";
  content: string;
  kind?: "genesis";
  genesisData?: { projectName: string; timestamp: string };
  researchResult?: { type: "research"; url: string; title: string; summary: string | null; headings: string[] } | null;
  terminalCmd?: unknown;
  terminalResult?: unknown;
  imageUrl?: string;
  attachments?: Array<{ base64: string; mediaType: string; name?: string }>;
  imageGen?: {
    images: Array<{
      imageUrl: string;
      prompt: string;
      model: string;
      mode: string;
    }>;
  } | null;
  model?: string;
  modelUsed?: string | null;
  intentType?: string | null;
  isNew?: boolean;
  id?: string;
  streaming?: boolean;
  handoffSignal?: HomeHandoffSignal;
  focusSuggestion?: { projectId: number; projectName: string };
  plan?: Plan;
  createdAt?: string;
  executionTimeMs?: number | null;
  inputTokens?: number | null;
  outputTokens?: number | null;
  costUsd?: number | null;
  runStatus?: RunStatus | null;
  runSummary?: string | null;
  runActions?: RunAction[] | null;
  runArtifacts?: RunArtifact[] | null;
  errorMessage?: string | null;
  surface?: AmbientSurface;
  surfacedMemoriesCount?: number;
  visualLoading?: boolean;
  visualImageBase64?: string | null;
  visualCaption?: string | null;
};

function formatMessageTime(iso?: string): string {
  if (!iso) return "";
  const d = new Date(iso);
  if (isNaN(d.getTime())) return "";
  const now = new Date();
  const sameDay = d.toDateString() === now.toDateString();
  const time = d.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" });
  if (sameDay) return time;
  const date = d.toLocaleDateString("en-US", { month: "short", day: "numeric" });
  return `${date} · ${time}`;
}

function formatGenesisTimestamp(date: Date): string {
  const day = String(date.getDate()).padStart(2, "0");
  const month = date.toLocaleString("en-US", { month: "short" }).toUpperCase();
  const year = date.getFullYear();
  const hour = String(date.getHours()).padStart(2, "0");
  const minute = String(date.getMinutes()).padStart(2, "0");
  return `${day} ${month} ${year} · ${hour}:${minute}`;
}

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

function normalizeLoadedHomeMessages(
  msgs: Array<{ role: string; content: string; createdAt?: string; [k: string]: any }>,
  mapMessage?: (message: { role: "user" | "assistant"; content: string; createdAt?: string }, index: number) => HomeMessage,
): HomeMessage[] {
  const thread = msgs.filter(
    (message): message is { role: "user" | "assistant"; content: string; createdAt?: string; [k: string]: any } =>
      (message.role === "user" || message.role === "assistant") && typeof message.content === "string",
  );

  const firstUserIndex = thread.findIndex((message) => message.role === "user");
  if (firstUserIndex === -1) return [];

  const trimmed = thread.slice(firstUserIndex);
  const demoRunSummary =
    typeof window !== "undefined" &&
    (window.location.search.includes("demo=runsummary") ||
      window.localStorage.getItem("atlas_demo_runsummary") === "1");

  const enrich = (m: any): Partial<HomeMessage> => {
    const runStatus = (m.runStatus ?? m.run_status ?? null) as RunStatus | null;
    const runActions = (m.runActions ?? m.run_actions ?? null) as RunAction[] | null;
    const runArtifacts = (m.runArtifacts ?? m.run_artifacts ?? null) as RunArtifact[] | null;
    const runSummary = m.runSummary ?? m.run_summary ?? null;

    const shouldMock = demoRunSummary && m.role === "assistant" && !runStatus;
    return {
      attachments: Array.isArray(m.attachments)
        ? m.attachments.filter((a: any) => a && typeof a.base64 === "string" && typeof a.mediaType === "string")
        : undefined,
      imageUrl: typeof m.imageUrl === "string" ? m.imageUrl : undefined,
      executionTimeMs: m.executionTimeMs ?? m.execution_time_ms ?? null,
      inputTokens: m.inputTokens ?? m.input_tokens ?? null,
      outputTokens: m.outputTokens ?? m.output_tokens ?? null,
      costUsd: m.costUsd != null ? Number(m.costUsd) : m.cost_usd != null ? Number(m.cost_usd) : null,
      runStatus: shouldMock ? ("completed" as RunStatus) : runStatus,
      runSummary: shouldMock
        ? "Wired run metadata into the SSE done event and persisted to chat_messages."
        : runSummary,
      runActions: shouldMock
        ? ([
            { verb: "Read", target: "chat_messages.ts", status: "ok" },
            { verb: "Grepped", target: "codebase", status: "ok" },
            { verb: "Read", target: "nexus.ts L1180–1420", status: "ok" },
            { verb: "Updated", target: "nexus.ts", status: "ok" },
            { verb: "Skipped", target: "_journal.json (no changes needed)", status: "warn" },
            { verb: "Pushed", target: "main", status: "ok" },
          ] as RunAction[])
        : runActions,
      runArtifacts: shouldMock
        ? ([
            { type: "commit", label: "fa20782", href: "https://github.com/" },
            { type: "file", label: "nexus.ts", href: "https://github.com/" },
            { type: "url", label: "preview.lovable.app", href: "https://preview.lovable.app" },
          ] as RunArtifact[])
        : runArtifacts,
      terminalCmd: m.terminalCmd ?? m.terminal_cmd,
      terminalResult: m.terminalResult ?? m.terminal_result,
      modelUsed: m.modelUsed ?? m.model_used ?? null,
      errorMessage: m.errorMessage ?? m.error_message ?? null,
      surface: m.surface ?? null,
      surfacedMemoriesCount: Array.isArray(m.surfaced_memories)
        ? m.surfaced_memories.length
        : Array.isArray(m.surfacedMemories)
          ? m.surfacedMemories.length
          : 0,
    };
  };
  return mapMessage
    ? trimmed.map((m, i) => ({ ...mapMessage(m, i), ...enrich(m) }))
    : trimmed.map((m) => ({ ...m, ...enrich(m) }));
}

function deriveAtlasProposedProjectName(messages: HomeMessage[]): string | null {
  const proposedNamePatterns = [
    /^\*?\*?([A-Z][A-Za-z0-9]+)\*?\*?\s*[-—]\s*working title/im,
    /(?:let'?s call (?:it|this)|i'?ll call (?:it|this))\s+\*?\*?([A-Z][A-Za-z0-9]+)\*?\*?/i,
    /^\*?\*?([A-Z][A-Za-z0-9]+)\*?\*?\s*[-—]\s*(?:working|project)\s*name/im,
  ];

  for (let i = messages.length - 1; i >= 0; i -= 1) {
    const message = messages[i];
    if (message.role !== "assistant") continue;

    for (const pattern of proposedNamePatterns) {
      const match = pattern.exec(message.content);
      const proposedName = match?.[1]?.replace(/^\*+|\*+$/g, "").trim();
      if (proposedName) return proposedName;
    }
  }

  return null;
}

function deriveProjectNameFromConversation(messages: HomeMessage[]): string {
  const atlasProposedName = deriveAtlasProposedProjectName(messages);
  if (atlasProposedName) return atlasProposedName;

  const firstUserMessage = messages.find((message) => message.role === "user" && message.content.trim().length > 0);
  const normalized = firstUserMessage?.content.replace(/\s+/g, " ").trim() ?? "";
  if (!normalized) return "New Project";
  if (normalized.length <= 40) return normalized;

  const clipped = normalized.slice(0, 40).trimEnd();
  const lastSpace = clipped.lastIndexOf(" ");
  return (lastSpace > 0 ? clipped.slice(0, lastSpace) : clipped).trim() || "New Project";
}

const HOME_IMAGE_URL_RE = /(https?:\/\/[^\s<>"')]+\.(?:png|jpe?g|webp|gif)(?:\?[^\s<>"')]+)?)/gi;
const HOME_CODE_BLOCK_RE = /```([\w+-]*)\n?([\s\S]*?)```/g;
const HOME_CARD_TITLE_RE = /^(?:#{1,3}\s*)?(synthesis|analysis|surface|insight|tension|conflict|file_edit|file edit|diff|code)\b[:\s-]*/i;

function plainTextFromNode(node: ReactNode): string {
  if (node == null || typeof node === "boolean") return "";
  if (typeof node === "string" || typeof node === "number") return String(node);
  if (Array.isArray(node)) return node.map(plainTextFromNode).join("");
  if (typeof node === "object" && "props" in node) {
    return plainTextFromNode((node as { props?: { children?: ReactNode } }).props?.children);
  }
  return "";
}

function imageUrlParts(text: string): Array<{ type: "text"; value: string } | { type: "image"; value: string }> {
  const parts: Array<{ type: "text"; value: string } | { type: "image"; value: string }> = [];
  const re = new RegExp(HOME_IMAGE_URL_RE);
  let last = 0;
  let match: RegExpExecArray | null;
  while ((match = re.exec(text)) !== null) {
    if (match.index > last) parts.push({ type: "text", value: text.slice(last, match.index) });
    parts.push({ type: "image", value: match[1] });
    last = match.index + match[1].length;
  }
  if (last < text.length) parts.push({ type: "text", value: text.slice(last) });
  return parts;
}

function extractNumberedOptions(text: string): Array<{ number: string; label: string }> {
  const normalized = text.replace(/\s+/g, " ").trim();
  const optionRe = /(?:^|\s)(\d+)\.\s+(.+?)(?=\s+\d+\.\s+|$)/g;
  const options: Array<{ number: string; label: string }> = [];
  let match: RegExpExecArray | null;
  while ((match = optionRe.exec(normalized)) !== null) {
    const label = match[2].trim();
    if (label) options.push({ number: match[1], label });
  }
  return options;
}

function isDecisionChoiceText(text: string): boolean {
  const options = extractNumberedOptions(text);
  return options.length >= 2 && /(\?|option|choice|choose|pick|write your own)/i.test(text);
}

function classifyHomeCard(text: string): {
  title: string;
  body: string;
  kind: "decision" | "tension" | "file" | "code" | "thought";
  alwaysOpen: boolean;
} | null {
  const trimmed = text.trim();
  if (!trimmed) return null;
  if (isDecisionChoiceText(trimmed)) {
    return { title: "Decision", body: trimmed, kind: "decision", alwaysOpen: true };
  }
  const firstLine = trimmed.split("\n", 1)[0] ?? "";
  const match = firstLine.match(HOME_CARD_TITLE_RE);
  if (!match) return null;
  const normalized = match[1].replace(/\s+/g, "_").toUpperCase();
  const body = trimmed.slice(firstLine.length).trim() || firstLine.replace(HOME_CARD_TITLE_RE, "").trim();
  const title = normalized === "FILE_EDIT"
    ? "File edit"
    : normalized.charAt(0) + normalized.slice(1).toLowerCase().replace(/_/g, " ");
  const kind = normalized === "TENSION" || normalized === "CONFLICT"
    ? "tension"
    : normalized === "FILE_EDIT" || normalized === "DIFF"
      ? "file"
      : normalized === "CODE"
        ? "code"
        : "thought";
  return {
    title,
    body: body || trimmed,
    kind,
    alwaysOpen: kind === "tension",
  };
}

function HomeMarkdown({ text }: { text: string }) {
  return (
    <ReactMarkdown
      components={{
        p: ({ children }) => (
          <p style={{ margin: "0 0 10px", lineHeight: 1.85 }}>{children}</p>
        ),
        strong: ({ children }) => <strong style={{ fontWeight: 650, color: "var(--atlas-fg)" }}>{children}</strong>,
        em: ({ children }) => <em style={{ color: "var(--atlas-muted)" }}>{children}</em>,
        h1: ({ children }) => <div style={{ fontSize: 14, fontWeight: 700, color: "var(--atlas-fg)", margin: "8px 0 4px" }}>{children}</div>,
        h2: ({ children }) => <div style={{ fontSize: 13, fontWeight: 700, color: "var(--atlas-fg)", margin: "8px 0 3px" }}>{children}</div>,
        h3: ({ children }) => <div style={{ fontSize: 11, fontWeight: 700, color: "var(--atlas-gold)", letterSpacing: "0.07em", textTransform: "uppercase", margin: "10px 0 3px" }}>{children}</div>,
        ul: ({ children }) => <ul style={{ margin: "4px 0 10px 18px", padding: 0 }}>{children}</ul>,
        ol: ({ children }) => <ol style={{ margin: "4px 0 10px 18px", padding: 0 }}>{children}</ol>,
        li: ({ children }) => <li style={{ margin: "2px 0", lineHeight: 1.75 }}>{children}</li>,
        code: ({ children, className }) => {
          const isBlock = Boolean(className);
          if (isBlock) {
            return <code style={{ fontFamily: "var(--app-font-mono)", fontSize: 12, whiteSpace: "pre-wrap" }}>{children}</code>;
          }
          return (
            <code style={{
              fontFamily: "var(--app-font-mono)",
              fontSize: 11,
              background: "var(--atlas-surface)",
              padding: "1px 5px",
              borderRadius: 3,
              color: "rgba(201,162,76,0.9)",
            }}>
              {children}
            </code>
          );
        },
        pre: ({ children }) => {
          const code = plainTextFromNode(children);
          return <HomeThoughtCard title="Code" kind="code" text={code} defaultCollapsed alwaysOpen={code.replace(/\s+/g, " ").trim().length < 120} />;
        },
        a: ({ href, children }) => {
          const imageUrl = href && /\.(?:png|jpe?g|webp|gif)(?:\?|$)/i.test(href);
          if (imageUrl) return <HomeInlineImage src={href} alt={plainTextFromNode(children) || "Atlas image"} />;
          return <a href={href} target="_blank" rel="noreferrer" style={{ color: "var(--atlas-gold)" }}>{children}</a>;
        },
      }}
    >
      {text}
    </ReactMarkdown>
  );
}

function HomeInlineImage({ src, alt = "Atlas image" }: { src: string; alt?: string }) {
  return (
    <img
      src={src}
      alt={alt}
      loading="lazy"
      style={{
        display: "block",
        maxWidth: "100%",
        height: "auto",
        borderRadius: 8,
        border: "1px solid var(--atlas-border)",
        margin: "10px 0",
      }}
    />
  );
}

function HomeChoiceCard({ text }: { text: string }) {
  const options = extractNumberedOptions(text);
  const lead = text.replace(/(?:^|\s)\d+\.\s+.+?(?=\s+\d+\.\s+|$)/g, "").trim();
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
      {lead && <HomeMarkdown text={lead} />}
      <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
        {options.map((option) => (
          <button
            key={`${option.number}-${option.label}`}
            type="button"
            onClick={(event) => event.stopPropagation()}
            style={{
              display: "inline-flex",
              alignItems: "center",
              gap: 7,
              padding: "7px 10px",
              borderRadius: 999,
              border: "1px solid color-mix(in oklab, var(--atlas-gold) 24%, var(--atlas-border))",
              background: "color-mix(in oklab, var(--atlas-gold) 7%, var(--atlas-surface))",
              color: "var(--atlas-fg)",
              cursor: "pointer",
              fontSize: 13,
              lineHeight: 1.35,
              textAlign: "left",
            }}
          >
            <span style={{ fontFamily: "var(--app-font-mono)", fontSize: 10, color: "var(--atlas-gold)", opacity: 0.85 }}>
              {option.number}.
            </span>
            <span>{option.label}</span>
          </button>
        ))}
      </div>
    </div>
  );
}

function HomeThoughtCard({
  title,
  kind,
  text,
  defaultCollapsed,
  alwaysOpen = false,
}: {
  title: string;
  kind: "decision" | "tension" | "file" | "code" | "thought";
  text: string;
  defaultCollapsed?: boolean;
  alwaysOpen?: boolean;
}) {
  const [expanded, setExpanded] = useState(false);
  const contentLength = text.replace(/\s+/g, " ").trim().length;
  const canCollapse = !alwaysOpen && (defaultCollapsed || contentLength >= 120);
  const open = !canCollapse || expanded;
  const preview = contentLength > 80
    ? `${text.replace(/\s+/g, " ").trim().slice(0, 80)}...`
    : text.trim();
  const isChoice = kind === "decision" && isDecisionChoiceText(text);
  const isCodeLike = kind === "code" || kind === "file";
  const tint = kind === "tension"
    ? "color-mix(in oklab, #b91c1c 9%, var(--atlas-surface))"
    : kind === "file" || kind === "code"
      ? "color-mix(in oklab, var(--atlas-gold) 5%, var(--atlas-surface))"
      : "color-mix(in oklab, white 6%, var(--atlas-surface))";

  return (
    <div
      role={canCollapse ? "button" : undefined}
      tabIndex={canCollapse ? 0 : undefined}
      onClick={canCollapse ? () => setExpanded(value => !value) : undefined}
      onKeyDown={canCollapse ? (event) => {
        if (event.key === "Enter" || event.key === " ") {
          event.preventDefault();
          setExpanded(value => !value);
        }
      } : undefined}
      className="atlas-home-thought-card"
      style={{
        margin: "10px 0",
        padding: "12px 16px",
        borderRadius: 14,
        border: "1px solid color-mix(in oklab, var(--atlas-gold) 14%, var(--atlas-border))",
        background: tint,
        boxShadow: "0 8px 24px -20px rgba(0,0,0,0.55)",
        cursor: canCollapse ? "pointer" : "default",
        overflow: "hidden",
      }}
    >
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12 }}>
        <div style={{
          fontFamily: "var(--app-font-mono)",
          fontSize: 10,
          letterSpacing: "0.12em",
          textTransform: "uppercase",
          color: kind === "tension" ? "#c56a6a" : "var(--atlas-gold)",
          opacity: 0.86,
        }}>
          {title}
        </div>
        {canCollapse && (
          <span
            aria-hidden
            style={{
              color: "var(--atlas-muted)",
              transform: open ? "rotate(180deg)" : "rotate(0deg)",
              transition: "transform 200ms ease-out",
              lineHeight: 0,
            }}
          >
            <svg width="13" height="13" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
              <path d="M4 6l4 4 4-4" />
            </svg>
          </span>
        )}
      </div>
      {canCollapse && (
        <div
          style={{
            maxHeight: open ? 0 : 120,
            opacity: open ? 0 : 1,
            overflow: "hidden",
            transition: "max-height 200ms ease-out, opacity 140ms ease-out",
            marginTop: open ? 0 : 7,
            color: "var(--atlas-muted)",
            fontSize: 13,
            lineHeight: 1.55,
          }}
        >
          {preview}
        </div>
      )}
      <div
        style={{
          maxHeight: open ? 8000 : 0,
          opacity: open ? 1 : 0,
          overflow: "hidden",
          transition: "max-height 200ms ease-out, opacity 160ms ease-out",
          marginTop: open ? 8 : 0,
        }}
      >
        {isChoice ? (
          <HomeChoiceCard text={text} />
        ) : isCodeLike ? (
          <pre style={{
            margin: 0,
            whiteSpace: "pre-wrap",
            overflowX: "auto",
            fontFamily: "var(--app-font-mono)",
            fontSize: 12,
            lineHeight: 1.6,
            color: "var(--atlas-fg)",
          }}>
            <code>{text.trim()}</code>
          </pre>
        ) : (
          <HomeRichText text={text} />
        )}
      </div>
    </div>
  );
}

function HomeTextSegment({ text }: { text: string }) {
  const card = classifyHomeCard(text);
  if (card) {
    return (
      <HomeThoughtCard
        title={card.title}
        kind={card.kind}
        text={card.body}
        alwaysOpen={card.alwaysOpen || card.body.replace(/\s+/g, " ").trim().length < 120}
        defaultCollapsed={card.kind === "code" || card.kind === "file" || card.body.replace(/\s+/g, " ").trim().length >= 120}
      />
    );
  }

  return (
    <>
      {imageUrlParts(text).map((part, index) => part.type === "image" ? (
        <HomeInlineImage key={`${part.value}-${index}`} src={part.value} />
      ) : part.value.trim() ? (
        <HomeMarkdown key={index} text={part.value} />
      ) : null)}
    </>
  );
}

function HomeRichText({ text }: { text: string }) {
  const segments = useMemo(() => {
    const output: Array<
      | { type: "text"; value: string }
      | { type: "code"; value: string; language: string }
    > = [];
    let last = 0;
    let match: RegExpExecArray | null;
    const re = new RegExp(HOME_CODE_BLOCK_RE);
    while ((match = re.exec(text)) !== null) {
      if (match.index > last) output.push({ type: "text", value: text.slice(last, match.index) });
      output.push({ type: "code", value: match[2], language: match[1] || "code" });
      last = match.index + match[0].length;
    }
    if (last < text.length) output.push({ type: "text", value: text.slice(last) });
    return output;
  }, [text]);

  return (
    <>
      {segments.map((segment, index) => segment.type === "code" ? (
        <HomeThoughtCard
          key={`code-${index}`}
          title={segment.language || "Code"}
          kind="code"
          text={segment.value}
          defaultCollapsed
          alwaysOpen={segment.value.replace(/\s+/g, " ").trim().length < 120}
        />
      ) : (
        <HomeTextSegment key={`text-${index}`} text={segment.value} />
      ))}
    </>
  );
}

function HomeStreamingText({ text, animate, style }: { text: string; animate: boolean; style?: React.CSSProperties }) {
  if (!animate) return <div style={style}><HomeRichText text={text} /></div>;

  const parts = text.match(/\S+|\s+/g) ?? [];
  let lastWordIndex = -1;
  for (let i = parts.length - 1; i >= 0; i -= 1) {
    if (/\S/.test(parts[i])) {
      lastWordIndex = i;
      break;
    }
  }

  return (
    <div style={{ ...style, whiteSpace: "pre-wrap", overflowWrap: "anywhere" }}>
      {parts.map((part, index) => /\S/.test(part) ? (
        <span key={`${index}-${part}`} className={index === lastWordIndex ? "atlas-streaming-word-shimmer" : undefined}>
          {part}
        </span>
      ) : (
        <Fragment key={`${index}-space`}>{part}</Fragment>
      ))}
      <span className="atlas-cursor" />
    </div>
  );
}

function splitHomeChunks(text: string): string[] {
  const cleaned = text.replace(/^INTENT_TYPE:\s*\S+$/gm, "").trim();
  if (cleaned.length < 200) return [cleaned];
  return cleaned.split(/\n{2,}/).reduce((acc: string[], chunk) => {
    if (chunk.trim()) acc.push(chunk);
    return acc;
  }, []);
}

function HomeChunkedBubbles({ text, isNew, isStreaming }: { text: string; isNew: boolean; isStreaming: boolean }) {
  const chunks = splitHomeChunks(text);
  const [revealed, setRevealed] = useState(isNew ? 0 : chunks.length);

  useEffect(() => {
    if (!isNew || revealed >= chunks.length) return;
    const t = setTimeout(() => setRevealed(r => r + 1), revealed === 0 ? 80 : 500 + Math.random() * 300);
    return () => clearTimeout(t);
  }, [revealed, chunks.length, isNew]);

  if (isStreaming) return <HomeStreamingText text={text} animate={true} />;

  const visible = chunks.slice(0, isNew ? Math.min(revealed + 1, chunks.length) : chunks.length);
  return (
    <>
      {visible.map((chunk, i) => (
        <HomeStreamingText
          key={i}
          text={chunk}
          animate={false}
          style={i < visible.length - 1 ? { marginBottom: 14 } : undefined}
        />
      ))}
    </>
  );
}

function AmbientEmergenceCard({ surface, onAction }: { surface: AmbientSurface; onAction: (surface: NonNullable<AmbientSurface>) => void }) {
  if (!surface) return null;
  const actionLabel = surface.type === "MAP"
    ? "View Structure"
    : surface.type === "WORKSPACE"
      ? "Continue Working"
      : surface.type === "DECISION"
        ? "Capture Decision"
        : null;
  if (!actionLabel) return null;

  return (
    <div
      style={{
        marginTop: 6,
        marginLeft: 14,
        maxWidth: 420,
        background: "var(--atlas-surface-alt)",
        border: "1px solid rgba(201,162,76,0.3)",
        borderRadius: 10,
        padding: "12px 16px",
        animation: "fadeIn 260ms ease forwards",
      }}
    >
      <div style={{ fontSize: "var(--ts-md)", lineHeight: 1.4, color: "var(--atlas-fg)", marginBottom: surface.reason ? 4 : 8 }}>
        {surface.label}
      </div>
      {surface.reason && (
        <div style={{ fontSize: "var(--ts-label)", lineHeight: 1.45, color: "var(--atlas-muted)", opacity: 0.72, marginBottom: 10 }}>
          {surface.reason}
        </div>
      )}
      <button
        type="button"
        onClick={() => onAction(surface)}
        style={{
          background: "transparent",
          border: "1px solid rgba(201,162,76,0.28)",
          borderRadius: 999,
          color: "var(--atlas-gold)",
          cursor: "pointer",
          fontFamily: "var(--app-font-mono)",
          fontSize: "var(--ts-micro)",
          letterSpacing: "0.08em",
          padding: "5px 10px",
          textTransform: "uppercase",
          opacity: 0.78,
        }}
      >
        {actionLabel}
      </button>
    </div>
  );
}

function HomeHandoffCard({
  signal,
  projectName,
  projectId,
  onProjectNameChange,
  onStart,
  onDismiss,
  loading,
  stage,
}: {
  signal: HomeHandoffSignal;
  projectName: string;
  projectId?: number | null;
  onProjectNameChange: (value: string) => void;
  onStart: () => void;
  onDismiss: () => void;
  loading: boolean;
  stage: string;
}) {
  const { setActiveProjectId } = useShellState();

  useEffect(() => {
    if (projectId != null) setActiveProjectId(projectId);
  }, [projectId, setActiveProjectId]);

  return (
    <div
      style={{
        marginTop: 12,
        padding: "13px 14px",
        borderRadius: 10,
        background: "color-mix(in oklab, var(--atlas-gold) 7%, transparent)",
        border: "1px solid color-mix(in oklab, var(--atlas-gold) 24%, transparent)",
      }}
    >
      <div style={{ fontSize: "var(--ts-body)", fontWeight: 700, color: "var(--atlas-fg)", marginBottom: 4 }}>
        This is ready to build.
      </div>
      <div style={{ fontSize: "var(--ts-caption)", color: "var(--atlas-muted)", lineHeight: 1.55, marginBottom: 10 }}>
        {signal.reason ?? "Atlas has enough shape to start a workspace."}
      </div>
      <input
        value={projectName}
        onChange={(e) => onProjectNameChange(e.target.value)}
        disabled={loading}
        style={{
          width: "100%",
          boxSizing: "border-box",
          marginBottom: 10,
          padding: "8px 10px",
          borderRadius: 7,
          background: "var(--atlas-bg)",
          border: "1px solid var(--atlas-border)",
          color: "var(--atlas-fg)",
          outline: "none",
          fontFamily: "var(--app-font-sans)",
          fontSize: "var(--ts-label)",
        }}
      />
      {loading && (
        <div style={{ fontFamily: "var(--app-font-mono)", fontSize: "var(--ts-micro)", color: "var(--atlas-gold)", marginBottom: 10, letterSpacing: "0.06em" }}>
          {stage || "Setting up your workspace..."}
        </div>
      )}
      <div style={{ display: "flex", gap: 8 }}>
        <button
          type="button"
          onClick={onStart}
          disabled={loading}
          style={{
            flex: 1,
            padding: "8px 12px",
            borderRadius: 7,
            background: "var(--atlas-gold)",
            border: "1px solid var(--atlas-gold)",
            color: "var(--atlas-bg)",
            cursor: loading ? "not-allowed" : "pointer",
            opacity: loading ? 0.55 : 1,
            fontFamily: "var(--app-font-mono)",
            fontSize: "var(--ts-sm)",
            fontWeight: 800,
            letterSpacing: "0.08em",
            textTransform: "uppercase",
          }}
        >
          Start Building →
        </button>
        <button
          type="button"
          onClick={onDismiss}
          disabled={loading}
          style={{
            padding: "8px 12px",
            borderRadius: 7,
            background: "transparent",
            border: "1px solid var(--atlas-border)",
            color: "var(--atlas-muted)",
            cursor: loading ? "not-allowed" : "pointer",
            opacity: loading ? 0.55 : 1,
            fontFamily: "var(--app-font-mono)",
            fontSize: "var(--ts-sm)",
            letterSpacing: "0.08em",
            textTransform: "uppercase",
          }}
        >
          Keep Talking
        </button>
      </div>
    </div>
  );
}

// ── Typewriter hook ──────────────────────────────────────────────────────────
function useTypewriter(phrases: string[], paused = false) {
  const [display, setDisplay] = useState("");
  const state = useRef({ phraseIdx: 0, charIdx: 0, phase: "typing" as "typing" | "erasing" });
  const phrasesRef = useRef(phrases);
  phrasesRef.current = phrases;

  useEffect(() => {
    if (paused) return;
    let timer: ReturnType<typeof setTimeout>;

    function tick() {
      const s = state.current;
      const phrase = phrasesRef.current[s.phraseIdx];

      if (s.phase === "typing") {
        if (s.charIdx < phrase.length) {
          s.charIdx++;
          setDisplay(phrase.slice(0, s.charIdx));
          timer = setTimeout(tick, 38);
        } else {
          timer = setTimeout(() => {
            s.phase = "erasing";
            tick();
          }, 2000);
        }
      } else {
        if (s.charIdx > 0) {
          s.charIdx--;
          setDisplay(phrase.slice(0, s.charIdx));
          timer = setTimeout(tick, 22);
        } else {
          s.phraseIdx = (s.phraseIdx + 1) % phrasesRef.current.length;
          s.phase = "typing";
          timer = setTimeout(tick, 200);
        }
      }
    }

    timer = setTimeout(tick, 900);
    return () => clearTimeout(timer);
  }, [paused]);

  return display;
}

// ── InlineTimestamp ──────────────────────────────────────────────────────────
function InlineTimestamp() {
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    const id = setInterval(() => setNow(new Date()), 30_000);
    return () => clearInterval(id);
  }, []);
  const days = ["SUN", "MON", "TUE", "WED", "THU", "FRI", "SAT"];
  const months = ["JAN","FEB","MAR","APR","MAY","JUN","JUL","AUG","SEP","OCT","NOV","DEC"];
  const day = days[now.getDay()];
  const mon = months[now.getMonth()];
  const date = now.getDate();
  let h = now.getHours();
  const m = now.getMinutes().toString().padStart(2, "0");
  const ampm = h >= 12 ? "PM" : "AM";
  h = h % 12 || 12;
  return (
    <div
      aria-hidden
      style={{
        fontFamily: "var(--app-font-mono)",
        fontSize: "var(--ts-micro)",
        letterSpacing: "0.18em",
        color: "rgba(120,113,108,0.5)",
        userSelect: "none",
        textTransform: "uppercase",
      }}
    >
      {day} {mon} {date} · {h}:{m} {ampm}
    </div>
  );
}

// ── AtlasLogo ────────────────────────────────────────────────────────────────
function AtlasLogo() {
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
      <img
        src="/axiom-logo.svg"
        alt="Axiom"
        width={26}
        height={26}
        style={{ borderRadius: "20%", flexShrink: 0 }}
      />
      <span
        style={{
          fontFamily: "'IBM Plex Mono', var(--app-font-mono)",
          fontSize: "var(--ts-label)",
          fontWeight: 700,
          letterSpacing: "0.18em",
          color: "var(--atlas-gold)",
          textTransform: "uppercase",
        }}
      >
        AXIOM
      </span>
    </div>
  );
}

// ── SettingsBtn ──────────────────────────────────────────────────────────────
function SettingsBtn({ onClick }: { onClick?: () => void }) {
  const [hov, setHov] = useState(false);
  return (
    <button
      title="Settings"
      onClick={onClick}
      onMouseEnter={() => setHov(true)}
      onMouseLeave={() => setHov(false)}
      style={{
        width: 30,
        height: 30,
        borderRadius: 8,
        background: "transparent",
        border: "none",
        cursor: "pointer",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        opacity: hov ? 0.75 : 0.32,
        transition: "opacity 160ms ease",
        flexShrink: 0,
      }}
    >
      <svg width="15" height="15" viewBox="0 0 20 20" fill="none" aria-hidden>
        <circle cx="10" cy="10" r="2.6" stroke="var(--atlas-fg)" strokeWidth="1.25" />
        <path
          d="M10 1.5v2M10 16.5v2M1.5 10h2M16.5 10h2M4.1 4.1l1.42 1.42M14.48 14.48l1.42 1.42M4.1 15.9l1.42-1.42M14.48 5.52l1.42-1.42"
          stroke="var(--atlas-fg)"
          strokeWidth="1.25"
          strokeLinecap="round"
        />
      </svg>
    </button>
  );
}

// ── UserAvatar ───────────────────────────────────────────────────────────────
function UserAvatar({ onClick }: { onClick?: () => void }) {
  const [hov, setHov] = useState(false);
  const photoUrl = (() => {
    try { const r = localStorage.getItem("atlas-user-profile"); return r ? JSON.parse(r).photoUrl ?? "" : ""; } catch { return ""; }
  })();
  return (
    <button
      title="Account"
      onClick={onClick}
      onMouseEnter={() => setHov(true)}
      onMouseLeave={() => setHov(false)}
      style={{
        width: 30,
        height: 30,
        borderRadius: "50%",
        background: photoUrl ? "transparent" : hov ? "rgba(201,162,76,0.18)" : "rgba(201,162,76,0.08)",
        border: `1px solid ${hov ? "rgba(201,162,76,0.42)" : "rgba(201,162,76,0.2)"}`,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        cursor: "pointer",
        transition: "all 160ms ease",
        flexShrink: 0,
        overflow: "hidden",
        padding: 0,
      }}
    >
      {photoUrl ? (
        <img src={photoUrl} alt="" style={{ width: "100%", height: "100%", borderRadius: "50%", objectFit: "cover" }} />
      ) : (
        <svg width="14" height="14" viewBox="0 0 20 20" fill="none" aria-hidden>
          <circle cx="10" cy="7.5" r="3.2" stroke="#C9A24C" strokeWidth="1.2" />
          <path d="M3 18.5c0-3.866 3.134-7 7-7s7 3.134 7 7" stroke="#C9A24C" strokeWidth="1.2" strokeLinecap="round" />
        </svg>
      )}
    </button>
  );
}

// ── ProjectThumbnail ─────────────────────────────────────────────────────────
function ProjectThumbnail({ name, id }: { name: string; id: number }) {
  const hash = (name + id).split("").reduce((acc, c) => acc + c.charCodeAt(0), 17);
  const hue = hash % 360;
  const initial = name.trim()[0]?.toUpperCase() ?? "?";
  return (
    <div
      style={{
        width: 40,
        height: 40,
        borderRadius: 8,
        background: `linear-gradient(145deg, hsla(${hue},28%,13%,1) 0%, hsla(${(hue + 45) % 360},18%,9%,1) 100%)`,
        border: `1px solid hsla(${hue},22%,20%,0.7)`,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        flexShrink: 0,
        position: "relative",
        overflow: "hidden",
      }}
    >
      {/* subtle diagonal stripe texture */}
      <div
        aria-hidden
        style={{
          position: "absolute",
          inset: 0,
          backgroundImage: `repeating-linear-gradient(
            -45deg,
            transparent,
            transparent 5px,
            hsla(${hue},30%,50%,0.04) 5px,
            hsla(${hue},30%,50%,0.04) 6px
          )`,
        }}
      />
      <span
        style={{
          fontFamily: "var(--app-font-mono)",
          fontSize: "var(--ts-h3)",
          fontWeight: 600,
          color: `hsla(${hue},52%,62%,0.9)`,
          letterSpacing: "-0.02em",
          position: "relative",
          zIndex: 1,
          lineHeight: 1,
        }}
      >
        {initial}
      </span>
    </div>
  );
}

// ── LiveThumbnail ─────────────────────────────────────────────────────────────
function LiveThumbnail({ url, name, id }: { url: string; name: string; id: number }) {
  const [state, setState] = useState<"loading" | "loaded" | "error">("loading");
  const src = `https://api.microlink.io/?url=${encodeURIComponent(url)}&screenshot=true&meta=false&embed=screenshot.url`;
  return (
    <div style={{ width: 40, height: 40, borderRadius: 8, overflow: "hidden", flexShrink: 0, position: "relative" }}>
      {state !== "error" && (
        <img
          src={src}
          alt={name}
          onLoad={() => setState("loaded")}
          onError={() => setState("error")}
          style={{
            width: "100%", height: "100%", objectFit: "cover",
            display: state === "loaded" ? "block" : "none",
          }}
        />
      )}
      {state !== "loaded" && <ProjectThumbnail name={name} id={id} />}
    </div>
  );
}

// ── ProjectCard ──────────────────────────────────────────────────────────────
function ProjectCard({ project, onSelect }: { project: Project; onSelect: () => void }) {
  const [hov, setHov] = useState(false);
  const date = new Date(project.createdAt).toLocaleDateString("en-US", {
    month: "short", day: "numeric",
  });
  return (
    <button
      onClick={onSelect}
      onMouseEnter={() => setHov(true)}
      onMouseLeave={() => setHov(false)}
      style={{
        width: "100%",
        textAlign: "left",
        padding: "11px 14px",
        borderRadius: 10,
        background: hov ? "rgba(201,162,76,0.04)" : "var(--atlas-surface)",
        border: `1px solid ${hov ? "rgba(201,162,76,0.28)" : "var(--atlas-surface)"}`,
        cursor: "pointer",
        transition: "all 180ms var(--ease-cinematic)",
        display: "flex",
        alignItems: "center",
        gap: 13,
      }}
    >
      {project.previewUrl
        ? <LiveThumbnail url={project.previewUrl} name={project.name} id={project.id} />
        : <ProjectThumbnail name={project.name} id={project.id} />
      }

      <div style={{ minWidth: 0, flex: 1 }}>
        <div
          style={{
            fontSize: "var(--ts-body)",
            fontWeight: 500,
            color: hov ? "var(--atlas-fg)" : "var(--atlas-fg)",
            whiteSpace: "nowrap",
            overflow: "hidden",
            textOverflow: "ellipsis",
            marginBottom: (project.description || project.linkedRepo) ? 3 : 0,
            transition: "color 180ms ease",
          }}
        >
          {project.name}
        </div>
        {project.description && (
          <div
            style={{
              fontSize: "var(--ts-caption)",
              color: "var(--atlas-muted)",
              whiteSpace: "nowrap",
              overflow: "hidden",
              textOverflow: "ellipsis",
              opacity: 0.75,
              marginBottom: project.linkedRepo ? 4 : 0,
            }}
          >
            {project.description}
          </div>
        )}
        {project.linkedRepo ? (
          <div style={{ display: "flex", alignItems: "center", gap: 4 }}>
            <svg width="10" height="10" viewBox="0 0 16 16" fill="rgba(74,222,128,0.75)" aria-hidden="true">
              <path d="M8 0C3.58 0 0 3.58 0 8c0 3.54 2.29 6.53 5.47 7.59.4.07.55-.17.55-.38 0-.19-.01-.82-.01-1.49-2.01.37-2.53-.49-2.69-.94-.09-.23-.48-.94-.82-1.13-.28-.15-.68-.52-.01-.53.63-.01 1.08.58 1.23.82.72 1.21 1.87.87 2.33.66.07-.52.28-.87.51-1.07-1.78-.2-3.64-.89-3.64-3.95 0-.87.31-1.59.82-2.15-.08-.2-.36-1.02.08-2.12 0 0 .67-.21 2.2.82.64-.18 1.32-.27 2-.27.68 0 1.36.09 2 .27 1.53-1.04 2.2-.82 2.2-.82.44 1.1.16 1.92.08 2.12.51.56.82 1.27.82 2.15 0 3.07-1.87 3.75-3.65 3.95.29.25.54.73.54 1.48 0 1.07-.01 1.93-.01 2.2 0 .21.15.46.55.38A8.013 8.013 0 0016 8c0-4.42-3.58-8-8-8z" />
            </svg>
            <span style={{
              fontSize: "var(--ts-micro)",
              fontFamily: "var(--app-font-mono)",
              color: "rgba(74,222,128,0.65)",
              letterSpacing: "0.02em",
              whiteSpace: "nowrap",
              overflow: "hidden",
              textOverflow: "ellipsis",
              maxWidth: 140,
            }}>
              {(() => {
                const full = getLinkedRepoFullName(project.linkedRepo) ?? project.linkedRepo;
                return full.includes("/") ? full.split("/")[1] : full;
              })()}
            </span>
          </div>
        ) : (
          <div style={{ display: "flex", alignItems: "center", gap: 4 }}>
            <svg width="10" height="10" viewBox="0 0 16 16" fill="none" stroke="rgba(120,113,108,0.4)" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <path d="M21 15a2 2 0 01-2 2H7l-4 4V5a2 2 0 012-2h14a2 2 0 012 2z" />
              <circle cx="8" cy="10" r="1" fill="rgba(120,113,108,0.4)" stroke="none" />
              <circle cx="12" cy="10" r="1" fill="rgba(120,113,108,0.4)" stroke="none" />
            </svg>
            <span style={{
              fontSize: "var(--ts-micro)",
              fontFamily: "var(--app-font-mono)",
              color: "rgba(120,113,108,0.4)",
              letterSpacing: "0.02em",
            }}>
              Chat only
            </span>
          </div>
        )}
      </div>

      <div style={{ display: "flex", alignItems: "center", gap: 10, flexShrink: 0 }}>
        <CompactReadinessRing score={project.latestSnapshotScore ?? computeScoreFromNodeState(project.nodeState)} />
        <span
          style={{
            fontFamily: "var(--app-font-mono)",
            fontSize: "var(--ts-xs)",
            letterSpacing: "0.1em",
            textTransform: "uppercase",
            color: "rgba(120,113,108,0.5)",
          }}
        >
          {date}
        </span>
        <svg
          width="12"
          height="12"
          viewBox="0 0 12 12"
          fill="none"
          style={{ opacity: hov ? 0.5 : 0.2, transition: "opacity 180ms ease" }}
        >
          <path d="M4.5 2.5L8.5 6L4.5 9.5" stroke="var(--atlas-gold)" strokeWidth="1.2" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      </div>
    </button>
  );
}

type HomeRepo = { fullName: string; name: string; defaultBranch: string };

// ── RepoSearchSheet ────────────────────────────────────────────────────────────
function RepoSearchSheet({
  current, onSelect, onClose,
}: {
  current: HomeRepo | null;
  onSelect: (r: HomeRepo) => void;
  onClose: () => void;
}) {
  const [query, setQuery] = useState("");
  const [repos, setRepos] = useState<HomeRepo[]>([]);
  const [loading, setLoading] = useState(true);
  const reposRequestRef = useRef(0);

  useEffect(() => {
    if (reposRequestRef.current > 0) return;
    const requestId = 1;
    reposRequestRef.current = requestId;
    setLoading(true);
    fetch("/api/github/repos", { headers: { "x-github-token": "__server__" }, credentials: "include" })
      .then(r => r.ok ? r.json() : [])
      .then((data: any[]) => {
        if (reposRequestRef.current !== requestId) return;
        setRepos(data.map((r: any) => ({ fullName: r.fullName, name: r.name, defaultBranch: r.defaultBranch ?? "main" })));
        setLoading(false);
      })
      .catch(() => { if (reposRequestRef.current === requestId) setLoading(false); });
  }, []);

  const filtered = repos.filter(r =>
    !query || r.fullName.toLowerCase().includes(query.toLowerCase())
  );

  return (
    <div style={{ position: "fixed", inset: 0, zIndex: 300, display: "flex", alignItems: "flex-end", justifyContent: "center" }}>
      <div onClick={onClose} style={{ position: "absolute", inset: 0, background: "rgba(0,0,0,0.6)", backdropFilter: "blur(4px)" }} />
      <div style={{
        position: "relative", zIndex: 1, width: "100%", maxWidth: 480,
        background: "var(--atlas-surface)", borderRadius: "16px 16px 0 0",
        borderTop: "1px solid rgba(201,162,76,0.18)",
        display: "flex", flexDirection: "column",
        maxHeight: "72dvh",
        boxShadow: "0 -8px 40px rgba(0,0,0,0.5)",
      }}>
        {/* Handle */}
        <div style={{ width: 36, height: 4, borderRadius: 2, background: "var(--atlas-border)", margin: "12px auto 4px" }} />
        {/* Header */}
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "8px 16px 10px" }}>
          <span style={{ fontFamily: "var(--app-font-mono)", fontSize: "var(--ts-micro)", letterSpacing: "0.14em", textTransform: "uppercase", color: "var(--atlas-gold)" }}>
            Choose Repository
          </span>
          <button onClick={onClose} style={{ background: "none", border: "none", cursor: "pointer", color: "rgba(120,113,108,0.6)", fontSize: "var(--ts-display)", lineHeight: 1, padding: 4 }}>×</button>
        </div>
        {/* Search */}
        <div style={{ padding: "0 14px 10px" }}>
          <div style={{ display: "flex", alignItems: "center", gap: 8, padding: "7px 10px", borderRadius: 8, background: "var(--atlas-surface-alt)", border: "1px solid var(--atlas-border)" }}>
            <svg width="13" height="13" viewBox="0 0 16 16" fill="none" stroke="var(--atlas-muted)" strokeWidth="1.5" strokeLinecap="round">
              <circle cx="6.5" cy="6.5" r="4.5" /><path d="M11 11l2.5 2.5" />
            </svg>
            <input
              autoFocus
              value={query}
              onChange={e => setQuery(e.target.value)}
              placeholder="Search repositories..."
              style={{ flex: 1, background: "transparent", border: "none", outline: "none", color: "var(--atlas-fg)", fontSize: "var(--ts-body)", fontFamily: "var(--app-font-sans)" }}
            />
          </div>
        </div>
        {/* List */}
        <div style={{ overflowY: "auto", flex: 1, padding: "0 14px 32px" }}>
          {loading && (
            <div style={{ padding: "24px 0", textAlign: "center", fontFamily: "var(--app-font-mono)", fontSize: "var(--ts-caption)", color: "var(--atlas-muted)", opacity: 0.5 }}>
              Loading...
            </div>
          )}
          {!loading && filtered.length === 0 && (
            <div style={{ padding: "24px 0", textAlign: "center", fontFamily: "var(--app-font-mono)", fontSize: "var(--ts-caption)", color: "var(--atlas-muted)", opacity: 0.5 }}>
              No repositories found
            </div>
          )}
          {filtered.map(r => (
            <button
              key={r.fullName}
              onClick={() => { onSelect(r); onClose(); }}
              style={{
                width: "100%", textAlign: "left", padding: "10px 12px", borderRadius: 8,
                background: current?.fullName === r.fullName ? "rgba(201,162,76,0.06)" : "transparent",
                border: `1px solid ${current?.fullName === r.fullName ? "rgba(201,162,76,0.22)" : "transparent"}`,
                cursor: "pointer", display: "flex", alignItems: "center", gap: 10, marginBottom: 2,
                transition: "all 140ms ease",
              }}
              onMouseEnter={e => (e.currentTarget.style.background = "rgba(201,162,76,0.05)")}
              onMouseLeave={e => (e.currentTarget.style.background = current?.fullName === r.fullName ? "rgba(201,162,76,0.06)" : "transparent")}
            >
              <svg width="13" height="13" viewBox="0 0 16 16" fill="rgba(120,113,108,0.6)" style={{ flexShrink: 0 }}>
                <path d="M8 0C3.58 0 0 3.58 0 8c0 3.54 2.29 6.53 5.47 7.59.4.07.55-.17.55-.38 0-.19-.01-.82-.01-1.49-2.01.37-2.53-.49-2.69-.94-.09-.23-.48-.94-.82-1.13-.28-.15-.68-.52-.01-.53.63-.01 1.08.58 1.23.82.72 1.21 1.87.87 2.33.66.07-.52.28-.87.51-1.07-1.78-.2-3.64-.89-3.64-3.95 0-.87.31-1.59.82-2.15-.08-.2-.36-1.02.08-2.12 0 0 .67-.21 2.2.82.64-.18 1.32-.27 2-.27.68 0 1.36.09 2 .27 1.53-1.04 2.2-.82 2.2-.82.44 1.1.16 1.92.08 2.12.51.56.82 1.27.82 2.15 0 3.07-1.87 3.75-3.65 3.95.29.25.54.73.54 1.48 0 1.07-.01 1.93-.01 2.2 0 .21.15.46.55.38A8.013 8.013 0 0016 8c0-4.42-3.58-8-8-8z" />
              </svg>
              <div style={{ minWidth: 0, flex: 1 }}>
                <div style={{ fontFamily: "var(--app-font-sans)", fontSize: "var(--ts-label)", fontWeight: 500, color: "var(--atlas-fg)", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
                  {r.name}
                </div>
                <div style={{ fontFamily: "var(--app-font-mono)", fontSize: "var(--ts-micro)", color: "var(--atlas-muted)", opacity: 0.6, marginTop: 1 }}>
                  {r.fullName}
                </div>
              </div>
              {current?.fullName === r.fullName && (
                <svg width="12" height="12" viewBox="0 0 12 12" fill="none">
                  <path d="M2 6l3 3 5-5" stroke="var(--atlas-gold)" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" />
                </svg>
              )}
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}

// ── BranchPickerSheet ─────────────────────────────────────────────────────────
function BranchPickerSheet({
  repo, current, onSelect, onClose,
}: {
  repo: HomeRepo | null; current: string;
  onSelect: (b: string) => void; onClose: () => void;
}) {
  const [branches, setBranches] = useState<string[]>([]);
  const [loading, setLoading] = useState(false);
  const branchRequestRef = useRef<{ key: string; requestId: number } | null>(null);
  const repoFullName = repo?.fullName ?? null;
  const repoDefaultBranch = repo?.defaultBranch ?? "main";

  useEffect(() => {
    if (!repoFullName) return;
    const requestKey = `${repoFullName}:${repoDefaultBranch}`;
    if (branchRequestRef.current?.key === requestKey) return;
    const requestId = (branchRequestRef.current?.requestId ?? 0) + 1;
    branchRequestRef.current = { key: requestKey, requestId };
    setLoading(true);
    fetch(`/api/github/repos/${encodeURIComponent(repoFullName)}/branches`, {
      headers: { "x-github-token": "__server__" }, credentials: "include",
    })
      .then(r => r.ok ? r.json() : null)
      .then((data: any) => {
        if (branchRequestRef.current?.requestId !== requestId) return;
        const list = Array.isArray(data)
          ? data.map((b: any) => b.name ?? b)
          : [repoDefaultBranch];
        setBranches(list.length ? list : [repoDefaultBranch]);
        setLoading(false);
      })
      .catch(() => {
        if (branchRequestRef.current?.requestId !== requestId) return;
        setBranches([repoDefaultBranch]);
        setLoading(false);
      });
  }, [repoFullName, repoDefaultBranch]);

  const displayBranches = branches.length ? branches : (repo ? [repo.defaultBranch ?? "main"] : ["main"]);

  return (
    <div style={{ position: "fixed", inset: 0, zIndex: 300, display: "flex", alignItems: "flex-end", justifyContent: "center" }}>
      <div onClick={onClose} style={{ position: "absolute", inset: 0, background: "rgba(0,0,0,0.6)", backdropFilter: "blur(4px)" }} />
      <div style={{
        position: "relative", zIndex: 1, width: "100%", maxWidth: 480,
        background: "var(--atlas-surface)", borderRadius: "16px 16px 0 0",
        borderTop: "1px solid rgba(201,162,76,0.18)",
        maxHeight: "55dvh", display: "flex", flexDirection: "column",
        boxShadow: "0 -8px 40px rgba(0,0,0,0.5)",
      }}>
        <div style={{ width: 36, height: 4, borderRadius: 2, background: "var(--atlas-border)", margin: "12px auto 4px" }} />
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "8px 16px 10px" }}>
          <span style={{ fontFamily: "var(--app-font-mono)", fontSize: "var(--ts-micro)", letterSpacing: "0.14em", textTransform: "uppercase", color: "var(--atlas-gold)" }}>
            Choose Branch
          </span>
          <button onClick={onClose} style={{ background: "none", border: "none", cursor: "pointer", color: "rgba(120,113,108,0.6)", fontSize: "var(--ts-display)", lineHeight: 1, padding: 4 }}>×</button>
        </div>
        {!repo && (
          <div style={{ padding: "20px 16px 32px", fontFamily: "var(--app-font-mono)", fontSize: "var(--ts-caption)", color: "var(--atlas-muted)", opacity: 0.5, textAlign: "center" }}>
            Link a repository first
          </div>
        )}
        {repo && (
          <div style={{ overflowY: "auto", flex: 1, padding: "0 14px 32px" }}>
            {loading ? (
              <div style={{ padding: "20px 0", textAlign: "center", fontFamily: "var(--app-font-mono)", fontSize: "var(--ts-caption)", color: "var(--atlas-muted)", opacity: 0.5 }}>Loading...</div>
            ) : displayBranches.map(b => (
              <button
                key={b}
                onClick={() => { onSelect(b); onClose(); }}
                style={{
                  width: "100%", textAlign: "left", padding: "10px 12px", borderRadius: 8,
                  background: current === b ? "rgba(201,162,76,0.06)" : "transparent",
                  border: `1px solid ${current === b ? "rgba(201,162,76,0.22)" : "transparent"}`,
                  cursor: "pointer", display: "flex", alignItems: "center", gap: 10, marginBottom: 2,
                  transition: "all 140ms ease",
                }}
                onMouseEnter={e => (e.currentTarget.style.background = "rgba(201,162,76,0.05)")}
                onMouseLeave={e => (e.currentTarget.style.background = current === b ? "rgba(201,162,76,0.06)" : "transparent")}
              >
                <svg width="12" height="12" viewBox="0 0 16 16" fill="rgba(120,113,108,0.6)" style={{ flexShrink: 0 }}>
                  <path d="M11.75 2.5a.75.75 0 1 0 0 1.5.75.75 0 0 0 0-1.5zm-2.25.75a2.25 2.25 0 1 1 3 2.122V6A2.5 2.5 0 0 1 10 8.5H6a1 1 0 0 0-1 1v1.128a2.251 2.251 0 1 1-1.5 0V5.372a2.25 2.25 0 1 1 1.5 0v1.836A2.493 2.493 0 0 1 6 7h4a1 1 0 0 0 1-1v-.628A2.25 2.25 0 0 1 9.5 3.25zM4.25 12a.75.75 0 1 0 0 1.5.75.75 0 0 0 0-1.5zM4.25 2.5a.75.75 0 1 0 0 1.5.75.75 0 0 0 0-1.5z" />
                </svg>
                <span style={{ fontFamily: "var(--app-font-sans)", fontSize: "var(--ts-label)", fontWeight: 500, color: "var(--atlas-fg)" }}>{b}</span>
                {current === b && (
                  <svg width="12" height="12" viewBox="0 0 12 12" fill="none" style={{ marginLeft: "auto" }}>
                    <path d="M2 6l3 3 5-5" stroke="var(--atlas-gold)" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" />
                  </svg>
                )}
              </button>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}



// ── First-run overlay ────────────────────────────────────────────────────────
function FirstRunOverlay({
  loading,
  onSpecMode,
  onWorkspace,
  onDismiss,
  repoUrl,
  setRepoUrl,
  error,
  backendReady,
}: {
  loading: boolean;
  onSpecMode: () => void;
  onWorkspace: () => void;
  onDismiss?: () => void;
  repoUrl: string;
  setRepoUrl: (v: string) => void;
  error?: string | null;
  backendReady: boolean;
}) {

  return createPortal(
    <div
      style={{
        position: "fixed",
        inset: 0,
        zIndex: 9999,
        background: "rgba(8,6,5,0.97)",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        animation: "atlas-overlay-fadein 500ms ease forwards",
        padding: "0 24px",
      }}
    >
      <div style={{ display: "flex", flexDirection: "column", width: "100%", maxWidth: 340 }}>

        {/* Identity */}
        <div style={{ textAlign: "center", marginBottom: 32 }}>
          <div style={{
            width: 44, height: 44, borderRadius: 11, background: "rgba(201,162,76,0.1)",
            border: "1.5px solid rgba(201,162,76,0.35)", display: "flex", alignItems: "center",
            justifyContent: "center", margin: "0 auto 14px",
          }}>
            <svg viewBox="0 0 48 48" width="26" height="26">
              <polygon points="24,8 16,40 20,40 25.5,18" fill="#D4AF37" />
              <polygon points="24,8 32,40 28,40 22.5,18" fill="#D4AF37" />
              <rect x="16" y="27" width="16" height="4" rx="1" fill="#D4AF37" />
            </svg>
          </div>
          <div style={{ fontSize: "var(--ts-micro)", fontFamily: "var(--app-font-mono)", letterSpacing: "0.22em", color: "rgba(201,162,76,0.7)", textTransform: "uppercase", marginBottom: 12 }}>
            AXIOM
          </div>
          <div style={{ fontSize: "var(--ts-body)", color: "rgba(120,113,108,0.6)", fontFamily: "var(--app-font-mono)", letterSpacing: "0.06em", lineHeight: 1.5 }}>
            Structure before speed.
          </div>
        </div>

        {backendReady ? (
          <div style={{ marginBottom: 14 }}>
            <input
              type="url"
              value={repoUrl}
              onChange={(e) => setRepoUrl(e.target.value)}
              placeholder="Paste primary repository URL (GitHub) — optional"
              spellCheck={false}
              autoCapitalize="off"
              autoCorrect="off"
              style={{
                width: "100%",
                padding: "12px 14px",
                background: "rgba(20,16,12,0.6)",
                border: "1px solid rgba(201,162,76,0.22)",
                borderRadius: 10,
                color: "#E7E1D6",
                fontSize: "var(--ts-caption)",
                fontFamily: "var(--app-font-mono)",
                letterSpacing: "0.02em",
                outline: "none",
              }}
              onFocus={(e) => { e.currentTarget.style.borderColor = "rgba(212,175,55,0.55)"; }}
              onBlur={(e) => { e.currentTarget.style.borderColor = "rgba(201,162,76,0.22)"; }}
            />
          </div>
        ) : (
          <div style={{ marginBottom: 14, padding: "12px 14px", borderRadius: 10, border: "1px solid rgba(201,162,76,0.16)", background: "rgba(20,16,12,0.45)" }}>
            <div style={{ fontSize: "var(--ts-caption)", fontFamily: "var(--app-font-mono)", color: "rgba(231,225,214,0.72)", lineHeight: 1.6 }}>
              GitHub import is offline in this preview because the backend API URL is not configured.
            </div>
          </div>
        )}

        {error && (
          <div style={{
            marginBottom: 12, padding: "10px 12px", borderRadius: 8,
            background: "rgba(239,68,68,0.08)", border: "1px solid rgba(239,68,68,0.35)",
            color: "rgba(252,165,165,0.95)", fontSize: "var(--ts-caption)",
            fontFamily: "var(--app-font-mono)", letterSpacing: "0.02em", textAlign: "center",
          }}>
            {error}
          </div>
        )}

        {/* CTA buttons */}
        <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
          <button
            disabled={loading}
            onClick={onWorkspace}
            style={{
              width: "100%", padding: "15px 24px",
              background: "#D4AF37", border: "none", borderRadius: 11,
              color: "#0C0A09", cursor: loading ? "not-allowed" : "pointer",
              opacity: loading ? 0.55 : 1,
              animation: "atlas-btn-rise 500ms cubic-bezier(0.34,1.56,0.64,1) 480ms both, atlas-btn-glow 2.8s ease-in-out 1000ms infinite",
              transition: "background 160ms ease",
            }}
            onMouseEnter={(e) => { e.currentTarget.style.background = "#C9A24C"; }}
            onMouseLeave={(e) => { e.currentTarget.style.background = "#D4AF37"; }}
          >
            <div style={{ fontSize: "var(--ts-md)", fontWeight: 700, fontFamily: "var(--app-font-mono)", letterSpacing: "0.04em" }}>
              Start a project →
            </div>
            <div style={{ fontSize: "var(--ts-micro)", fontWeight: 400, opacity: 0.6, marginTop: 3, fontFamily: "var(--app-font-mono)" }}>
              Chat + Decision Ledger
            </div>
          </button>

          <button
            disabled={loading}
            onClick={onSpecMode}
            style={{
              width: "100%", padding: "14px 24px",
              background: "transparent", border: "1px solid rgba(201,162,76,0.4)",
              borderRadius: 11, color: "#D4AF37",
              cursor: loading ? "not-allowed" : "pointer",
              opacity: loading ? 0.55 : 1,
              animation: "atlas-btn-rise 500ms cubic-bezier(0.34,1.56,0.64,1) 560ms both",
              transition: "background 160ms ease, border-color 160ms ease",
            }}
            onMouseEnter={(e) => { e.currentTarget.style.background = "rgba(212,175,55,0.06)"; e.currentTarget.style.borderColor = "rgba(212,175,55,0.65)"; }}
            onMouseLeave={(e) => { e.currentTarget.style.background = "transparent"; e.currentTarget.style.borderColor = "rgba(201,162,76,0.4)"; }}
          >
            <div style={{ fontSize: "var(--ts-md)", fontWeight: 700, fontFamily: "var(--app-font-mono)", letterSpacing: "0.04em" }}>
              Map my architecture
            </div>
            <div style={{ fontSize: "var(--ts-micro)", fontWeight: 400, opacity: 0.55, marginTop: 3, fontFamily: "var(--app-font-mono)" }}>
              System Map + Intent Capture
            </div>
          </button>
        </div>

        {/* Skip */}
        {onDismiss && (
          <button
            onClick={onDismiss}
            style={{
              background: "none", border: "none", cursor: "pointer",
              color: "rgba(120,113,108,0.45)", fontSize: "var(--ts-caption)",
              fontFamily: "var(--app-font-mono)", letterSpacing: "0.04em",
              marginTop: 18, textAlign: "center", padding: "4px 0",
              animation: "atlas-btn-rise 400ms ease 640ms both",
            }}
            onMouseEnter={(e) => { e.currentTarget.style.color = "rgba(120,113,108,0.75)"; }}
            onMouseLeave={(e) => { e.currentTarget.style.color = "rgba(120,113,108,0.45)"; }}
          >
            Skip for now
          </button>
        )}

      </div>
    </div>,
    document.body
  );
}

// ── Home ─────────────────────────────────────────────────────────────────────
export default function Home() {
  const [input, setInput] = useState("");
  const [starterIdx, setStarterIdx] = useState(0);
  const [createError, setCreateError] = useState<string | null>(null);
  const backendReady = true;
  const [attachedFiles, setAttachedFiles] = useState<File[]>([]);
  const filePreviewUrls = useRef<Map<File, string>>(new Map());

  // Create/revoke Object URLs exactly once per file — never inside JSX
  useEffect(() => {
    const current = new Set(attachedFiles);
    // Revoke URLs for files that were removed
    for (const [file, url] of filePreviewUrls.current.entries()) {
      if (!current.has(file)) {
        URL.revokeObjectURL(url);
        filePreviewUrls.current.delete(file);
      }
    }
    // Create URLs for newly added files
    for (const file of attachedFiles) {
      if (file.type.startsWith("image/") && !filePreviewUrls.current.has(file)) {
        filePreviewUrls.current.set(file, URL.createObjectURL(file));
      }
    }
  }, [attachedFiles]);
  const [showVault, setShowVault] = useState(false);
  const [showScrollBtn, setShowScrollBtn] = useState(false);
  const [isTinyScreen, setIsTinyScreen] = useState(() => window.innerWidth < 390);
  const isMobile = useIsMobile();
  const briefingRequestRef = useRef(0);
  const conversationsRequestRef = useRef(0);
  const conversationThreadRequestRef = useRef<{ conversationId: string; requestId: number } | null>(null);
  const prunedAbandonedProjectIdsRef = useRef<Set<number>>(new Set());
  const thinkOutLoudInlineRef = useRef(false);
  useEffect(() => {
    const handler = () => setIsTinyScreen(window.innerWidth < 390);
    window.addEventListener("resize", handler);
    return () => window.removeEventListener("resize", handler);
  }, []);
  const isParchment = useThemeMode() === "parchment";
  const chatScrollRef = useRef<HTMLDivElement>(null);
  const [showQuickPrompt, setShowQuickPrompt] = useState(false);
  const { user: authUser } = useRequireAuth();
  const [showProfile, setShowProfile] = useState(false);
  const [showInvite, setShowInvite] = useState(false);
  const [showDrawer, setShowDrawer] = useState(false);
  useEffect(() => {
    const open = () => setShowDrawer(true);
    window.addEventListener("axiom:open-projects-drawer", open);
    window.addEventListener("axiom:open-nav-drawer", open);
    return () => {
      window.removeEventListener("axiom:open-projects-drawer", open);
      window.removeEventListener("axiom:open-nav-drawer", open);
    };
  }, []);
  useEffect(() => {
    const mountedAt = Date.now();
    const open = () => {
      if (Date.now() - mountedAt > 400) setShowProfile(true);
    };
    window.addEventListener("axiom:open-account-hub", open);
    return () => window.removeEventListener("axiom:open-account-hub", open);
  }, []);
  useEffect(() => {
    const open = () => setShowInvite(true);
    window.addEventListener("axiom:open-invite", open);
    return () => window.removeEventListener("axiom:open-invite", open);
  }, []);
  const [showProjectsSheet, setShowProjectsSheet] = useState(false);
  const [showOverviewSheet, setShowOverviewSheet] = useState(false);
  const [isOverviewSheetClosing, setIsOverviewSheetClosing] = useState(false);
  const overviewCloseTimerRef = useRef<number | null>(null);
  const [showUpgrade, setShowUpgrade] = useState(false);
  const [isListening, setIsListening] = useState(false);
  const [activeConversationId, setActiveConversationId] = useState<string | null>(() => {
    try {
      return sessionStorage.getItem("atlas-home-conversation-id") ||
        localStorage.getItem("atlas-home-conversation-id");
    } catch {
      return null;
    }
  });
  const rememberActiveConversationId = useCallback((conversationId: string) => {
    try { localStorage.setItem("atlas-home-conversation-id", conversationId); } catch {}
    try { sessionStorage.setItem("atlas-home-conversation-id", conversationId); } catch {}
  }, []);
  const handleStreamConversationId = useCallback((conversationId: string) => {
    if (!conversationId || conversationId === activeConversationId) return;
    conversationThreadRequestRef.current = {
      conversationId,
      requestId: (conversationThreadRequestRef.current?.requestId ?? 0) + 1,
    };
    rememberActiveConversationId(conversationId);
    setActiveConversationId(conversationId);
  }, [activeConversationId, rememberActiveConversationId]);
  // ── Home context: repo / branch / model ────────────────────────────────────
  const [homeFocus, setHomeFocus] = useState<number | null>(null);
  const homeFocusUserInitiatedRef = useRef(false);
  const [showFocusPicker, setShowFocusPicker] = useState(false);
  const [homeModel] = useState<string>("claude");
  const [homeMode] = useState<string>("strategic");
  const homeProjectState = useProjectState(homeFocus);
  const nexusChat = useNexusChatStream({
    focusProjectId: homeFocus ?? null,
    model: homeModel,
    mode: homeMode,
    conversationId: activeConversationId,
    
    projectContext: homeFocus != null ? {
      projectId: homeFocus,
      memorySummary: homeProjectState.memorySummary,
      decisions: homeProjectState.decisions,
    } : null,
  });
  const focusProjectId = homeFocus;
  const [shapingPayload, setShapingPayload] = useState<{
    title: string;
    audience: string;
    tension: string;
    what: string;
  } | null>(null);
  const [shapingHeld, setShapingHeld] = useState(false);
  // ── Global Insight mode ────────────────────────────────────────────────────────
  const [globalInsightOpen, setGlobalInsightOpen] = useState(false);
  const [showShredChoice, setShowShredChoice] = useState(false);
  const [isShredding, setIsShredding] = useState(false);
  const [showGoneFlash, setShowGoneFlash] = useState(false);
  useEffect(() => {
    const active = globalInsightOpen || nexusChat.messages.length > 0;
    document.body.setAttribute("data-axiom-thread", active ? "active" : "empty");
    return () => { document.body.removeAttribute("data-axiom-thread"); };
  }, [globalInsightOpen, nexusChat.messages.length]);

  useEffect(() => {
    document.body.setAttribute("data-axiom-global-insight", globalInsightOpen ? "true" : "false");
    return () => { document.body.removeAttribute("data-axiom-global-insight"); };
  }, [globalInsightOpen]);

  // Keep showScrollBtn in sync as streaming content grows the scroll container.
  // Without this, the arrow only updates on user scroll events and can miss
  // backlog produced while Atlas streams a reply.
  useEffect(() => {
    const el = chatScrollRef.current;
    if (!el) return;
    const recompute = () => {
      setShowScrollBtn(el.scrollHeight - el.scrollTop - el.clientHeight > 120);
    };
    recompute();
    const ro = new ResizeObserver(recompute);
    ro.observe(el);
    Array.from(el.children).forEach((c) => ro.observe(c as Element));
    const mo = new MutationObserver(() => {
      Array.from(el.children).forEach((c) => ro.observe(c as Element));
      recompute();
    });
    mo.observe(el, { childList: true, subtree: true, characterData: true });
    return () => { ro.disconnect(); mo.disconnect(); };
  }, [nexusChat.messages.length]);
  const [loadedHistoryCount, setLoadedHistoryCount] = useState(0);
  const [isAtlasStreaming, setIsAtlasStreaming] = useState(false);
  const [isSending, setIsSending] = useState(false);
  const [pendingPhraseIdx, setPendingPhraseIdx] = useState(0);
  const [copiedMsgIdx, setCopiedMsgIdx] = useState<number | null>(null);
  // Home lens state removed — lenses live in workspace only

  // Earned title: identity emerges, never derived from latest message.
  // Sources: manual rename, commit, or AI-proposed summary (≥4 exchanges + non-THINK intent).
  // Persisted per conversation id under `atlas-thread-title:<id>`.
  const [earnedTitle, setEarnedTitle] = useState<string | null>(null);

  const [threadLoading, setThreadLoading] = useState(true);
  const [showHistory, setShowHistory] = useState(false);
  const [conversations, setConversations] = useState<Array<{ id: string; title: string; createdAt: string; messageCount: number }>>([]);
  const [historyLoading, setHistoryLoading] = useState(false);
  const [showTimeTravel, setShowTimeTravel] = useState(false);
  const [briefing, setBriefing] = useState<string | null>(null);
  const [briefingLoading, setBriefingLoading] = useState(true);
  const [showBriefingPanel, setShowBriefingPanel] = useState(false);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const globalInsightComposerRef = useRef<HTMLDivElement>(null);
  const greetingRef = useRef<{ head: string; sub: string } | null>(null);
  const greetingNameRef = useRef<string | null>(null);
  const { isFree } = useSubscription();
  const { setDepth, setActiveProjectId, setActiveConversationTitle } = useShellState();
  const [, setLocation] = useLocation();
  const queryClient = useQueryClient();
  const { data: projects, isLoading } = useListProjects();
  const mostRecentActiveProjectId = useMemo(() => {
    const activeProjects = (projects ?? []).filter((project: Project) => project.status === "committed" || (project as { entity_type?: string }).entity_type === "idea");
    const candidates = activeProjects.length > 0 ? activeProjects : projects ?? [];
    const latest = candidates.reduce<Project | null>((current, project: Project) => {
      if (!current) return project;
      return new Date(project.updatedAt).getTime() > new Date(current.updatedAt).getTime()
        ? project
        : current;
    }, null);
    return latest?.id ?? null;
  }, [projects]);
  const previousHomeMessageCountRef = useRef(0);
  const [globalInsightComposerHeight, setGlobalInsightComposerHeight] = useState(148);
  const globalInsightSeedPendingRef = useRef(false);

  useEffect(() => {
    const previousCount = previousHomeMessageCountRef.current;
    if (globalInsightOpen) {
      setDepth("active");
    } else if (nexusChat.messages.length === 0) {
      setDepth("ambient");
    } else if (previousCount === 0 && nexusChat.messages.length === 1) {
      setDepth("active");
    }
    previousHomeMessageCountRef.current = nexusChat.messages.length;
  }, [globalInsightOpen, nexusChat.messages.length, setDepth]);

  useEffect(() => {
    setActiveProjectId(homeFocus);
    return () => setActiveProjectId(null);
  }, [homeFocus, setActiveProjectId]);

  // Derive first name from auth (updates when /me resolves)
  {
    const fullName = (authUser?.name ?? "").trim();
    const emailLocal = (authUser?.email ?? "").split("@")[0] ?? "";
    const raw = fullName || emailLocal;
    const first = raw.split(/[\s._-]+/)[0] ?? "";
    if (first) {
      const pretty = first.charAt(0).toUpperCase() + first.slice(1);
      if (greetingNameRef.current !== pretty) greetingNameRef.current = pretty;
    }
  }

  // Greeting is computed below, after `projects` is available.

  const [showHandoff, setShowHandoff] = useState(false);
  const [handoffLoading, setHandoffLoading] = useState(false);
  const [handoffStage, setHandoffStage] = useState("");
  const [handoffCardDismissed, setHandoffCardDismissed] = useState(() => {
    try { return sessionStorage.getItem(`atlas-home-handoff-dismissed-${activeConversationId}`) === "1"; } catch { return false; }
  });
  const [handoffProjectName, setHandoffProjectName] = useState("");
  const [reviewingPlanIds, setReviewingPlanIds] = useState<Set<string>>(() => new Set());

  const homeConversationTitle = globalInsightOpen
    ? "Global Insight"
    : homeFocus == null && nexusChat.messages.length > 0
      ? earnedTitle ?? "Untitled conversation"
      : null;

  useEffect(() => {
    setActiveConversationTitle(homeConversationTitle);
    return () => setActiveConversationTitle(null);
  }, [homeConversationTitle, setActiveConversationTitle]);

  const vibrate = useCallback((pattern: number | number[]) => {
    try { if (typeof navigator !== "undefined" && "vibrate" in navigator) (navigator as any).vibrate(pattern); } catch {}
  }, []);

  const callGlobalInsightMode = useCallback(async (enabled: boolean) => {
    if (!activeConversationId) return;
    try {
      await fetch(`/api/sessions/${encodeURIComponent(activeConversationId)}/reflection-mode`, {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ enabled }),
      });
    } catch {}
  }, [activeConversationId]);

  const handleLockTap = useCallback(() => {
    vibrate(50);
    if (globalInsightOpen) {
      // Exit Global Insight → return to the ambient homepage, NOT a stranded
      // "Untitled conversation" view. Clear the active thread and message
      // stream so the hero/quick-actions come back.
      void callGlobalInsightMode(false);
      setGlobalInsightOpen(false);
      try { localStorage.removeItem("atlas-home-conversation-id"); } catch {}
      try { sessionStorage.removeItem("atlas-home-conversation-id"); } catch {}
      conversationThreadRequestRef.current = null;
      thinkOutLoudInlineRef.current = false;
      setActiveConversationId(null);
      nexusChat.setMessages([]);
      setEarnedTitle(null);
      setDepth("ambient");
    } else {
      setShowOverviewSheet(false);
      setShowBriefingPanel(false);
      setShowHistory(false);
      setShowFocusPicker(false);
      setGlobalInsightOpen(true);
      if (mostRecentActiveProjectId) {
        setLocation(`/project/${mostRecentActiveProjectId}?global=true`);
      } else {
        setLocation("/projects");
      }
      window.setTimeout(() => window.dispatchEvent(new Event("atlas:focus-composer")), 120);
      toast("Global Insight · Strategic view", {
        className: "atlas-toast-premium",
        description: "Macro view across every project.",
      });
    }
  }, [globalInsightOpen, mostRecentActiveProjectId, vibrate, callGlobalInsightMode, nexusChat.setMessages, setDepth, setLocation]);

  const handleKeepIt = useCallback(async () => {
    const messagesToKeep = nexusChat.messages;
    vibrate([50, 50, 50]);
    void callGlobalInsightMode(false);
    setGlobalInsightOpen(false);
    setShowShredChoice(false);
    setCreateError(null);

    try {
      const authToken = localStorage.getItem("atlas-auth-token");
      const createRes = await fetch("/api/projects", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...(authToken ? { "Authorization": `Bearer ${authToken}` } : {}),
        },
        credentials: "include",
        body: JSON.stringify({ name: "New Project" }),
      });
      const project = (await createRes.json().catch(() => null)) as {
        id?: number | string;
        error?: string;
        message?: string;
      } | null;
      if (!createRes.ok || !project?.id) {
        const err = new Error(
          project?.error ?? project?.message ?? "Failed to create project",
        ) as Error & { status?: number };
        err.status = createRes.status;
        throw err;
      }
      const projectId = Number(project.id);
      if (!Number.isFinite(projectId)) throw new Error("Failed to create project");
      try {
        sessionStorage.setItem(THINK_FREELY_THREAD_STORAGE_KEY, JSON.stringify(messagesToKeep));
      } catch {}
      queryClient.invalidateQueries({ queryKey: getListProjectsQueryKey() });
      setActiveProjectId(projectId);
      setLocation(`/project/${projectId}`);
    } catch (err) {
      const msg =
        extractApiErrorMessage(err) ??
        (err instanceof Error ? err.message : "Failed to create project");
      if (
        msg?.includes("PROJECT_LIMIT_REACHED") ||
        (err as { status?: number } | null)?.status === 402
      ) {
        setShowUpgrade(true);
      } else {
        setCreateError(msg);
      }
    }
  }, [
    callGlobalInsightMode,
    nexusChat.messages,
    queryClient,
    setActiveProjectId,
    setLocation,
    vibrate,
  ]);

  const handleShredIt = useCallback(() => {
    vibrate(200);
    void callGlobalInsightMode(false);
    setShowShredChoice(false);
    setIsShredding(true);
    setTimeout(() => {
      nexusChat.setMessages([]);
      setIsShredding(false);
      setGlobalInsightOpen(false);
      setShowGoneFlash(true);
      setTimeout(() => setShowGoneFlash(false), 1500);
    }, 700);
  }, [vibrate, callGlobalInsightMode, nexusChat.setMessages]);

  // Cycle pending phrases while Atlas is generating
  useEffect(() => {
    if (!isAtlasStreaming) { setPendingPhraseIdx(0); return; }
    const t = setInterval(() => setPendingPhraseIdx(i => (i + 1) % HOME_PENDING_PHRASES.length), 2400);
    return () => clearInterval(t);
  }, [isAtlasStreaming]);

  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const recognitionRef = useRef<any>(null);
  const ptrContainerRef = useRef<HTMLDivElement>(null);
  const {
    pulling: ptr_pulling,
    distance: ptr_distance,
    refreshing: ptr_refreshing,
  } = usePullToRefresh(
    async () => {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: getListProjectsQueryKey() }),
        fetch("/api/nexus/briefing", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          credentials: "include",
          body: JSON.stringify({}),
        })
          .then((r) => (r.ok ? r.json() : { briefing: null }))
          .then((data: any) => setBriefing(data.briefing ?? null))
          .catch(() => {}),
      ]);
    },
    !isAtlasStreaming,
    ptrContainerRef,
  );

  // Atlas Core center-button → focus composer
  useEffect(() => {
    const onFocus = () => {
      const el = textareaRef.current;
      if (!el) return;
      try { el.scrollIntoView({ behavior: "smooth", block: "center" }); } catch {}
      setTimeout(() => el.focus(), 60);
    };
    window.addEventListener("atlas:focus-composer", onFocus);
    // Handle deferred focus from variant-switcher cross-page nav
    if (typeof sessionStorage !== "undefined" && sessionStorage.getItem("atlas:focusComposerOnLoad")) {
      sessionStorage.removeItem("atlas:focusComposerOnLoad");
      setTimeout(onFocus, 250);
    }
    return () => window.removeEventListener("atlas:focus-composer", onFocus);
  }, []);



  const toggleVoice = useCallback(() => {
    if (isListening) {
      recognitionRef.current?.stop();
      setIsListening(false);
      document.body.dataset.voiceActive = "false";
      return;
    }
    const SR = (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;
    if (!SR) return;
    const rec = new SR();
    rec.continuous = true;
    rec.interimResults = true;
    rec.lang = "en-US";
    let finalTranscript = "";
    rec.onresult = (e: any) => {
      let interim = "";
      for (let i = e.resultIndex; i < e.results.length; i++) {
        const result = e.results[i];
        if (result.isFinal) {
          finalTranscript += result[0].transcript;
        } else {
          interim += result[0].transcript;
        }
      }
      // Only update input on final results to avoid per-syllable re-renders
      if (finalTranscript) {
        setInput(prev => {
          const base = prev.trimEnd();
          const join = base.length > 0 ? " " : "";
          return base + join + finalTranscript.trimStart();
        });
        finalTranscript = "";
      } else if (interim) {
        // Show interim text as a preview only — debounced via requestAnimationFrame
        requestAnimationFrame(() => {
          if (textareaRef.current) {
            textareaRef.current.dataset.interim = interim;
          }
        });
      }
    };
    rec.onend = () => {
      setIsListening(false);
      document.body.dataset.voiceActive = "false";
      if (textareaRef.current) delete textareaRef.current.dataset.interim;
    };
    rec.onerror = () => {
      setIsListening(false);
      document.body.dataset.voiceActive = "false";
    };
    rec.start();
    recognitionRef.current = rec;
    setIsListening(true);
    document.body.dataset.voiceActive = "true";
  }, [isListening]);

  const [typewriterPaused, setTypewriterPaused] = useState(false);
  const [inputFocused, setInputFocused] = useState(false);
  const placeholder = useTypewriter(PLACEHOLDERS, typewriterPaused);

  useEffect(() => {
    if (!projects || projects.length === 0) return;
    const cutoff = Date.now() - 24 * 60 * 60 * 1000; // 24 hours ago
    const abandoned = projects.filter((p: any) =>
      p.entity_type === "idea" &&
      new Date(p.updatedAt ?? p.createdAt).getTime() < cutoff &&
      !prunedAbandonedProjectIdsRef.current.has(p.id)
    );
    abandoned.forEach((p: any) => {
      prunedAbandonedProjectIdsRef.current.add(p.id);
      fetch(`/api/projects/${p.id}`, {
        method: "DELETE",
        credentials: "include",
      }).catch(() => {});
    });
  }, [projects]);
  useEffect(() => {
    if (!projects || !Array.isArray(projects)) return;
    const existing = (projects as any[]).find(
      (p: any) => p.entity_type === "idea"
    );
    if (existing && !nexusChat.shapingHeld) {
      let desc: { 
        title?: string; tension?: string; 
        audience?: string; what?: string 
      } = {};
      try {
        desc = typeof existing.description === "string"
          ? JSON.parse(existing.description)
          : existing.description ?? {};
      } catch {}
      nexusChat.setShapingPayload({
        title: existing.name ?? "Untitled idea",
        tension: desc.tension ?? "",
        audience: desc.audience ?? "",
        what: desc.what ?? "",
      });
      nexusChat.setShapingHeld(true);
    } else if (!existing) {
      // No shaping project exists — clear state
      nexusChat.setShapingPayload(null);
      nexusChat.setShapingHeld(false);
    }
  }, [projects, nexusChat.shapingHeld, nexusChat.setShapingHeld, nexusChat.setShapingPayload]);
  const handleHomeFocusSelect = useCallback((projectId: number) => {
    homeFocusUserInitiatedRef.current = true;
    setHomeFocus(projectId);
    setShowFocusPicker(false);
  }, []);
  const handleHomeSubheaderTabChange = useCallback((tab: UnifiedSubheaderTab) => {
    const userInitiated = homeFocusUserInitiatedRef.current;
    if (tab === "chat" || homeFocus == null || !userInitiated) return;
    const workspaceTab =
      tab === "changes" ? "diff"
      : tab === "console" ? "terminal"
      : tab;
    try {
      sessionStorage.setItem("atlas-open-left-tab", workspaceTab);
    } catch {}
    setLocation(`/project/${homeFocus}`);
  }, [homeFocus, setLocation]);
  const createProject = useCreateProject();
  const createEntry = useCreateEntry();

  const logProjectInitialized = useCallback((projectId: number) => {
    createEntry.mutate({
      projectId,
      data: {
        title: "Project initialized: Sovereign context anchored.",
        summary: "Genesis anchor — the project exists; context is bound and ready for Forge.",
        status: "committed",
        severity: "committed",
        mode: "decide",
      },
    });
  }, [createEntry]);

  // Optional GitHub URL captured in the FirstRunOverlay. Mirrors the
  // onboarding wizard's repo-scan upgrade path so both entry doors gain
  // the same autonomous architecture-ingest behavior.
  const [overlayRepoUrl, setOverlayRepoUrl] = useState("");

  // Silent, non-blocking repo scan: derive architecture nodes from a public
  // GitHub URL, PATCH them straight into project.nodeState, and append a
  // "Repo ingested" Ledger milestone. Failures never interrupt routing.
  const runRepoScan = useCallback((projectId: number, rawUrl: string) => {
    const trimmed = rawUrl.trim();
    if (!trimmed) return;
    ingestRepository(trimmed)
      .then(async (result) => {
        if (result.nodes.length === 0) return;
        const nodeState: Record<string, unknown> = {};
        result.nodes.forEach((n) => {
          nodeState[n.id] = {
            resolved: n.resolved,
            label: n.label,
            type: n.type,
            x: n.x,
            y: n.y,
            ...(n.details ? { details: n.details } : {}),
            ...(n.strategicAnswer ? { strategicAnswer: n.strategicAnswer } : {}),
          };
        });
        await fetch(`/api/projects/${projectId}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          credentials: "include",
          body: JSON.stringify({ nodeState }),
        }).catch(() => {});
        await fetch(`/api/projects/${projectId}/entries`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          credentials: "include",
          body: JSON.stringify({
            title: `Repo ingested · ${result.nodes.length} nodes autonomously derived.`,
            summary: result.summary,
            status: "committed",
            severity: "committed",
            mode: "build",
            verb: "new",
          }),
        }).catch(() => {});
      })
      .catch((scanErr) => {
        console.warn("[home overlay] repo scan failed:", scanErr);
      });
  }, []);


  // Compute greeting once on mount with full micro-state context
  if (greetingRef.current === null) {
    const lastActive = readLastActive();
    greetingRef.current = chooseGreeting({
      hour: new Date().getHours(),
      projectCount: projects?.length ?? 0,
      hasHistory: conversations.length > 0,
      msSinceLastActive: lastActive ? Date.now() - lastActive : null,
      name: greetingNameRef.current,
    });
    markActiveNow();
    try {
      if (typeof localStorage !== "undefined") localStorage.setItem("atlas-home-visited", "1");
    } catch {}
  }

  useEffect(() => {
    if (briefingRequestRef.current > 0) return;
    const requestId = 1;
    briefingRequestRef.current = requestId;
    setBriefingLoading(true);
    fetch("/api/nexus/briefing", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      credentials: "include",
      body: JSON.stringify({}),
    })
      .then(r => r.ok ? r.json() : { briefing: null })
      .then((data: any) => {
        if (briefingRequestRef.current !== requestId) return;
        setBriefing(data.briefing ?? null);
        setBriefingLoading(false);
      })
      .catch(() => {
        if (briefingRequestRef.current === requestId) setBriefingLoading(false);
      });
  }, []);

  useEffect(() => {
    if (conversationsRequestRef.current > 0) return;
    const requestId = 1;
    conversationsRequestRef.current = requestId;
    fetch("/api/nexus/conversations", { credentials: "include" })
      .then(r => r.ok ? r.json() : { conversations: [] })
      .then((data: any) => {
        if (conversationsRequestRef.current !== requestId) return;
        const list = data.conversations ?? [];
        setConversations(list);
      })
      .catch(() => {});
  }, []);


  useEffect(() => {
    if (nexusChat.messages.length === 0) return;
    const container = messagesEndRef.current?.parentElement;
    // Only auto-scroll if the user is near the bottom — never yank them
    // away from earlier text they're reading.
    followScrollIfNearBottom(container, 120);
  }, [nexusChat.messages]);

  // Per-turn persistence: save after every completed assistant turn (not just on unload).
  // Previously this only saved on beforeunload AND only when >=4 messages —
  // mobile tab switches, navigation, and short threads all dropped history silently.
  const lastSavedTurnRef = useRef<number>(0);
  useEffect(() => {
    const msgs = nexusChat.messages;
    if (msgs.length < 2) return;
    const last = msgs[msgs.length - 1] as any;
    // Only save once per completed assistant turn.
    if (last?.role !== "assistant" || last?.streaming) return;
    if (msgs.length === lastSavedTurnRef.current) return;
    lastSavedTurnRef.current = msgs.length;
    const conversationId = activeConversationId;
    fetch("/api/nexus/conversation/save", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      credentials: "include",
      body: JSON.stringify({ conversationId, messages: msgs }),
    })
      .then(r => r.ok ? r.json().catch(() => null) : null)
      .then((data: any) => {
        const newId = data?.conversationId ?? data?.id;
        if (newId && newId !== activeConversationId) {
          rememberActiveConversationId(newId);
          setActiveConversationId(newId);
        }
      })
      .catch(() => { /* non-fatal; next turn retries */ });
  }, [nexusChat.messages, activeConversationId, rememberActiveConversationId]);

  // Keep the unload save as a last-ditch safety net for in-flight streams.
  useEffect(() => {
    const handleBeforeUnload = () => {
      const msgs = nexusChat.messages;
      if (msgs.length < 2) return;
      try {
        fetch("/api/nexus/conversation/save", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          credentials: "include",
          body: JSON.stringify({ conversationId: activeConversationId, messages: msgs }),
          keepalive: true,
        });
      } catch {}
    };
    window.addEventListener("beforeunload", handleBeforeUnload);
    return () => window.removeEventListener("beforeunload", handleBeforeUnload);
  }, [nexusChat.messages, activeConversationId]);

  // Load the active conversation from DB (re-runs when conversationId changes)
  useEffect(() => {
    if (!activeConversationId) {
      nexusChat.setMessages([]);
      setLoadedHistoryCount(0);
      setThreadLoading(false);
      setHandoffProjectName("");
      return;
    }
    if (conversationThreadRequestRef.current?.conversationId === activeConversationId) return;
    const requestId = (conversationThreadRequestRef.current?.requestId ?? 0) + 1;
    conversationThreadRequestRef.current = { conversationId: activeConversationId, requestId };
    nexusChat.setMessages([]);
    setLoadedHistoryCount(0);
    setThreadLoading(true);
    try {
      setHandoffCardDismissed(sessionStorage.getItem(`atlas-home-handoff-dismissed-${activeConversationId}`) === "1");
    } catch {
      setHandoffCardDismissed(false);
    }
    setHandoffProjectName("");
    fetch(`/api/nexus/thread?conversationId=${encodeURIComponent(activeConversationId)}`, { credentials: "include" })
      .then(r => r.ok ? r.json() : [])
      .then(async (msgs: Array<{ role: string; content: string }>) => {
        if (conversationThreadRequestRef.current?.requestId !== requestId) return;
        const normalizedMessages = normalizeLoadedHomeMessages(msgs);
        if (normalizedMessages.length > 0) {
          nexusChat.setMessages(normalizedMessages as any);
          setLoadedHistoryCount(normalizedMessages.length);
          return;
        }
      })
      .catch(() => {})
      .finally(() => {
        if (conversationThreadRequestRef.current?.requestId === requestId) {
          setThreadLoading(false);
        }
      });
  }, [activeConversationId, nexusChat.setMessages]);

  useEffect(() => {
    if (nexusChat.messages.length > 0 && !globalInsightOpen) {
      setGlobalInsightOpen(true);
      if (mostRecentActiveProjectId) {
        setLocation(`/project/${mostRecentActiveProjectId}?global=true`);
      } else {
        setLocation("/projects");
      }
    }
  }, [globalInsightOpen, mostRecentActiveProjectId, nexusChat.messages.length, setLocation]);

  // Rehydrate Global Insight mode on hard refresh / initial load.
  // The server is the source of truth (reflection_mode is set per-session
  // via POST /api/sessions/:id/reflection-mode). Without this, a refresh
  // resets the in-memory `globalInsightOpen` to false and the conversation
  // renders as the ambient/active homepage instead of the Global Insight surface.
  useEffect(() => {
    if (!activeConversationId) return;
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch(
          `/api/sessions/${encodeURIComponent(activeConversationId)}`,
          { credentials: "include" },
        );
        if (!res.ok || cancelled) return;
        const data: any = await res.json().catch(() => null);
        if (!data || cancelled) return;
        const session = data.session ?? data;
        const isReflection =
          session?.mode === "reflection" ||
          session?.mode === "global_insight" ||
          session?.reflection_mode === true ||
          session?.reflectionMode === true;
        if (isReflection) {
          setGlobalInsightOpen(true);
          setDepth("active");
        }
      } catch {}
    })();
    return () => { cancelled = true; };
  }, [activeConversationId, setDepth]);



  const [showNewProjectModal, setShowNewProjectModal] = useState(false);

  const performCreateProject = useCallback((name: string, githubRepo?: string) => {
    if (!backendReady) {
      setCreateError("Project creation is unavailable in this preview because the backend API URL is not configured.");
      return;
    }
    if (isFree && (projects?.length ?? 0) >= 1) {
      setShowNewProjectModal(false);
      setShowUpgrade(true);
      return;
    }
    createProject.mutate(
      { data: { name } },
      {
        onSuccess: (p) => {
          setShowNewProjectModal(false);
          queryClient.invalidateQueries({ queryKey: getListProjectsQueryKey() });
          logProjectInitialized(p.id);
          const normalizedRepo = normalizeGitHubRepoInput(githubRepo);
          if (normalizedRepo) {
            void fetch(`/api/projects/${p.id}`, {
              method: "PATCH",
              headers: { "Content-Type": "application/json" },
              credentials: "include",
              body: JSON.stringify({ linkedRepo: serializeLinkedRepo({ fullName: normalizedRepo }) }),
            }).catch(() => {});
            if (/^https?:\/\//i.test(githubRepo ?? "")) {
              runRepoScan(p.id, githubRepo!.trim());
            }
          }
          setLocation(`/project/${p.id}?intake=true`);
        },
        onError: (err: any) => {
          const msg = extractApiErrorMessage(err);
          if (msg?.includes("PROJECT_LIMIT_REACHED") || err?.status === 402) {
            setShowNewProjectModal(false);
            setShowUpgrade(true);
          } else {
            setCreateError(msg ?? "Failed to create project");
          }
        },
      }
    );
  }, [backendReady, isFree, projects, createProject, queryClient, runRepoScan, setLocation]);

  const handleNewProject = useCallback((_name = "New Project") => {
    if (isFree && (projects?.length ?? 0) >= 1) {
      setShowUpgrade(true);
      return;
    }
    setCreateError(null);
    setShowNewProjectModal(true);
  }, [isFree, projects]);

  useEffect(() => {
    try { sessionStorage.removeItem("atlas-from-landing"); } catch {}
  }, []);

  // First-run overlay — only for new users with no projects, only once per session
  const [overlayDismissed, setOverlayDismissed] = useState(() => {
    try { return !!sessionStorage.getItem("atlas-choice-shown"); } catch { return false; }
  });
  const dismissOverlay = () => {
    try { sessionStorage.setItem("atlas-choice-shown", "1"); } catch {}
    setOverlayDismissed(true);
  };
  const showOverlay = !isLoading && projects !== undefined && projects.length === 0 && !overlayDismissed;
  const firstHandoffMessageIndex = (nexusChat.messages as HomeMessage[]).findIndex(m => m.role === "assistant" && !!m.handoffSignal);

  const navigateToProject = useCallback(
    (projectId: number) => {
      if (input.trim()) {
        sessionStorage.setItem(`atlas-initial-${projectId}`, input.trim());
      }
      setLocation(`/project/${projectId}`);
    },
    [input, setLocation],
  );

  const openOverviewSheet = useCallback(() => {
    if (overviewCloseTimerRef.current) {
      window.clearTimeout(overviewCloseTimerRef.current);
      overviewCloseTimerRef.current = null;
    }
    setIsOverviewSheetClosing(false);
    setShowOverviewSheet(true);
  }, []);

  const closeOverviewSheet = useCallback(() => {
    setIsOverviewSheetClosing(true);
    if (overviewCloseTimerRef.current) {
      window.clearTimeout(overviewCloseTimerRef.current);
    }
    overviewCloseTimerRef.current = window.setTimeout(() => {
      setShowOverviewSheet(false);
      setIsOverviewSheetClosing(false);
      overviewCloseTimerRef.current = null;
    }, 250);
  }, []);

  useEffect(() => {
    return () => {
      if (overviewCloseTimerRef.current) {
        window.clearTimeout(overviewCloseTimerRef.current);
      }
    };
  }, []);

  const renderOverviewDashboard = (closeOnNavigate = false) => (
    <BelowFoldDashboard
      projects={(projects ?? []).map((p: Project) => ({
        id: p.id,
        name: p.name,
        description: p.description,
        updatedAt: p.createdAt,
        latestSnapshotScore: p.latestSnapshotScore ?? null,
      }))}
      onOpenProject={(id) => {
        if (closeOnNavigate) closeOverviewSheet();
        navigateToProject(id);
      }}
      onOpenLedger={() => {
        if (closeOnNavigate) closeOverviewSheet();
        const p = projects?.[0];
        if (p) setLocation(`/ledger/${p.id}`);
      }}
      onOpenParking={() => {
        if (closeOnNavigate) closeOverviewSheet();
        setLocation("/parking");
      }}
      parkedCount={0}
      committedCount={0}
      briefing={briefing}
      briefingLoading={briefingLoading}
    />
  );

  const handleSubmit = useCallback(async (
    messageOverride?: string,
    options?: { forceStayOnHome?: boolean },
  ) => {
    const liveText = messageOverride ?? textareaRef.current?.value ?? input;
    const text = liveText.trim();
    const files = messageOverride ? [] : attachedFiles;
    const hasImages = files.some((f) => f.type.startsWith("image/"));
    if ((!text && !hasImages) || isSending) return;
    const shouldStayOnHome = true;
    if (!globalInsightOpen && !thinkOutLoudInlineRef.current) {
      setGlobalInsightOpen(true);
      if (mostRecentActiveProjectId) {
        setLocation(`/project/${mostRecentActiveProjectId}?global=true`);
      } else {
        setLocation("/projects");
      }
    }
    if (!shouldStayOnHome && !backendReady) {
      setCreateError(
        "Project creation is unavailable in this preview because the backend API URL is not configured.",
      );
      return;
    }
    if (!shouldStayOnHome && isFree && (projects?.length ?? 0) >= 1) {
      setShowUpgrade(true);
      return;
    }
    // Block PTR and double-sends immediately — before any async work
    setIsSending(true);
    document.body.dataset.voiceActive = "true";
    setInput("");
    setAttachedFiles([]);

    const imageFiles = files.filter((f) => f.type.startsWith("image/"));
    const otherFiles = files.filter((f) => !f.type.startsWith("image/"));
    const suffix =
      otherFiles.length > 0 ? `\n[Attached: ${otherFiles.map((f) => f.name).join(", ")}]` : "";
    const fullText = text + suffix;

    // Preserve the existing text note for multi-image starts; inline home sends attach the first image.
    const imageNote =
      imageFiles.length > 1
        ? ` [${imageFiles.length} images attached — showing first]`
        : "";
    const messageText = fullText + imageNote;

    setCreateError(null);
    setIsAtlasStreaming(true);
    setIsSending(true);

    const handleSubmitError = (err: unknown) => {
      const msg =
        extractApiErrorMessage(err) ??
        (err instanceof Error ? err.message : "Failed to create project");
      if (
        msg?.includes("PROJECT_LIMIT_REACHED") ||
        (err as { status?: number } | null)?.status === 402
      ) {
        setShowUpgrade(true);
      } else {
        setCreateError(msg);
      }
    };

    const resetSubmitState = () => {
      setIsAtlasStreaming(false);
      setIsSending(false);
      document.body.dataset.voiceActive = "false";
    };

    if (shouldStayOnHome) {
      try {
        let attachments: Array<{ base64: string; mediaType: string; name: string }> | undefined;
        if (imageFiles.length > 0) {
          try {
            const capped = imageFiles.slice(0, 10);
            attachments = await Promise.all(capped.map(async (f) => {
              const safe = await fileToBase64Safe(f);
              return { base64: safe.base64, mediaType: safe.mediaType, name: f.name };
            }));
          } catch {}
        }
        await nexusChat.send({
          text: messageText,
          attachments,
        });
      } catch (err) {
        handleSubmitError(err);
      } finally {
        setIsAtlasStreaming(false);
        setIsSending(false);
        document.body.dataset.voiceActive = "false";
      }
      return;
    }

    try {
      const authToken = localStorage.getItem("atlas-auth-token");
      const createRes = await fetch("/api/projects", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...(authToken ? { "Authorization": `Bearer ${authToken}` } : {}),
        },
        credentials: "include",
        body: JSON.stringify({ name: "New Project" }),
      });
      const project = (await createRes.json().catch(() => null)) as {
        id?: number | string;
        error?: string;
        message?: string;
      } | null;
      if (!createRes.ok || !project?.id) {
        const err = new Error(
          project?.error ?? project?.message ?? "Failed to create project",
        ) as Error & { status?: number };
        err.status = createRes.status;
        throw err;
      }
      const projectId = Number(project.id);
      if (!Number.isFinite(projectId)) throw new Error("Failed to create project");
      try {
        sessionStorage.setItem(OPENING_MESSAGE_STORAGE_KEY, messageText);
        sessionStorage.setItem(OPENING_MESSAGE_PROJECT_ID_STORAGE_KEY, String(projectId));
      } catch {}
      queryClient.invalidateQueries({ queryKey: getListProjectsQueryKey() });
      setActiveProjectId(projectId);
      setLocation(`/project/${projectId}`);
    } catch (err) {
      handleSubmitError(err);
    } finally {
      resetSubmitState();
    }
  }, [
    input,
    attachedFiles,
    isSending,
    globalInsightOpen,
    mostRecentActiveProjectId,
    backendReady,
    isFree,
    projects,
    queryClient,
    nexusChat.send,
    setActiveProjectId,
    setLocation,
  ]);

  const performCreateProjectFromConversation = useCallback(async () => {
    const conversationMessages = nexusChat.messages as HomeMessage[];
    if (conversationMessages.length === 0 || isSending) return;
    if (!backendReady) {
      setCreateError(
        "Project creation is unavailable in this preview because the backend API URL is not configured.",
      );
      return;
    }
    if (isFree && (projects?.length ?? 0) >= 1) {
      setShowUpgrade(true);
      return;
    }

    setCreateError(null);
    setIsAtlasStreaming(true);
    setIsSending(true);

    try {
      const name = deriveProjectNameFromConversation(conversationMessages);
      const authToken = localStorage.getItem("atlas-auth-token");
      const createRes = await fetch("/api/projects", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...(authToken ? { "Authorization": `Bearer ${authToken}` } : {}),
        },
        credentials: "include",
        body: JSON.stringify({ name }),
      });
      const project = (await createRes.json().catch(() => null)) as {
        id?: number | string;
        error?: string;
        message?: string;
      } | null;
      if (!createRes.ok || !project?.id) {
        const err = new Error(
          project?.error ?? project?.message ?? "Failed to create project",
        ) as Error & { status?: number };
        err.status = createRes.status;
        throw err;
      }
      const projectId = Number(project.id);
      if (!Number.isFinite(projectId)) throw new Error("Failed to create project");
      try {
        sessionStorage.setItem(OPENING_CONVERSATION_STORAGE_KEY, JSON.stringify(conversationMessages));
        sessionStorage.setItem(OPENING_MESSAGE_PROJECT_ID_STORAGE_KEY, String(projectId));
      } catch {}
      queryClient.invalidateQueries({ queryKey: getListProjectsQueryKey() });
      setActiveProjectId(projectId);
      const createdAt = new Date();
      const timestamp = formatGenesisTimestamp(createdAt);
      nexusChat.setMessages(prev => [
        ...prev,
        {
          id: `genesis-${createdAt.getTime()}`,
          role: "assistant",
          content: "",
          kind: "genesis",
          genesisData: { projectName: name, timestamp },
          createdAt: createdAt.toISOString(),
        },
      ]);
      await new Promise(resolve => setTimeout(resolve, 700));
      setLocation(`/project/${projectId}`);
    } catch (err) {
      const msg =
        extractApiErrorMessage(err) ??
        (err instanceof Error ? err.message : "Failed to create project");
      if (
        msg?.includes("PROJECT_LIMIT_REACHED") ||
        (err as { status?: number } | null)?.status === 402
      ) {
        setShowUpgrade(true);
      } else {
        setCreateError(msg);
      }
    } finally {
      setIsAtlasStreaming(false);
      setIsSending(false);
    }
  }, [
    backendReady,
    isFree,
    isSending,
    nexusChat.messages,
    nexusChat.setMessages,
    projects,
    queryClient,
    setActiveProjectId,
    setLocation,
  ]);

  useEffect(() => {
    let surface: string | null = null;
    let seed: string | null = null;
    try {
      const params = new URLSearchParams(window.location.search);
      surface = params.get("surface");
      seed = params.get("seed");
    } catch {
      return;
    }

    if (surface !== "global-insight") return;

    setGlobalInsightOpen(true);
    if (seed === "portfolio") {
      globalInsightSeedPendingRef.current = true;
    }

    try {
      window.history.replaceState(
        window.history.state,
        "",
        `${window.location.pathname}${window.location.hash}`,
      );
    } catch {}
  }, []);

  useEffect(() => {
    if (!globalInsightSeedPendingRef.current || threadLoading || isSending) return;
    if (nexusChat.messages.length > 0) {
      globalInsightSeedPendingRef.current = false;
      return;
    }

    globalInsightSeedPendingRef.current = false;
    void handleSubmit(GLOBAL_INSIGHT_PORTFOLIO_SEED, { forceStayOnHome: true });
  }, [handleSubmit, isSending, nexusChat.messages.length, threadLoading]);


  const handleHandoff = useCallback(async (signal?: HomeHandoffSignal, projectNameOverride?: string, plan?: Plan) => {
    if (!nexusChat.messages.length) return;
    setHandoffLoading(true);
    setHandoffStage("Setting up your workspace...");
    try {
      let name = (projectNameOverride || signal?.projectName || "").trim();
      const DEFAULT_PROJECT_NAMES = new Set(["New Project", "New Idea", "My Project", "Untitled", ""]);
      if (DEFAULT_PROJECT_NAMES.has(name)) {
        const lastUserMsg = [...(nexusChat.messages as HomeMessage[])].reverse().find(m => m.role === "user");
        if (lastUserMsg?.content) {
          try {
            const nameRes = await fetch("/api/nexus/name", {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              credentials: "include",
              body: JSON.stringify({ message: lastUserMsg.content }),
            });
            if (nameRes.ok) {
              const nameData = await nameRes.json() as { name?: string };
              if (nameData.name?.trim()) name = nameData.name.trim();
            }
          } catch {}
        }
        if (!name) name = "New Project";
      }
      const authToken = localStorage.getItem("atlas-auth-token");
      const createRes = await fetch("/api/projects", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...(authToken ? { Authorization: `Bearer ${authToken}` } : {}),
        },
        credentials: "include",
        body: JSON.stringify({ name }),
      });
      const project = await createRes.json();
      if (!createRes.ok || !project.id) throw new Error(project?.error ?? "Project creation failed");
      const projectId = Number(project.id);
      setActiveProjectId(projectId);
      const transcriptMessages = (nexusChat.messages as HomeMessage[]).slice(-20).map(({ role, content }) => ({ role, content }));
      const transcript = transcriptMessages.map(m => `${m.role === "user" ? "User" : "Atlas"}: ${m.content}`).join("\n\n");
      const summary = signal?.reason || transcriptMessages.map(m => m.content).join(" ").slice(0, 800);

      setHandoffStage("Loading your conversation...");
      await fetch(`/api/projects/${projectId}/memories`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ tier: "episodic", summary, messages: transcriptMessages }),
      }).catch(() => {});

      setHandoffStage("Mapping your ideas...");
      const forgeRes = await fetch("/api/forge", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ transcript, projectId, moscow: true }),
      });
      const forgeData = forgeRes.ok
        ? await forgeRes.json() as { nodes?: Array<{ id: string; label: string; type: string; x: number; y: number; resolved?: boolean; meta?: string; moscow?: string; details?: string; question?: string }> }
        : { nodes: [] };
      const nodes = (forgeData.nodes ?? []).map(n => ({ ...n, resolved: Boolean(n.resolved) }));
      const goal = nodes.find(n => n.type === "goal") ?? nodes[0];
      const edges = goal
        ? nodes.filter(n => n.id !== goal.id).map(n => ({ id: `e-${goal.id}-${n.id}`, from: goal.id, to: n.id }))
        : [];
      try {
        localStorage.setItem(`axiom-flow-nodes-${projectId}`, JSON.stringify(nodes));
        localStorage.setItem(`axiom-flow-nodes-${projectId}-edges`, JSON.stringify(edges));
      } catch {}
      const nodeState = Object.fromEntries(nodes.map(n => [n.id, {
        resolved: Boolean(n.resolved),
        label: n.label,
        type: n.type,
        x: n.x,
        y: n.y,
        ...(n.details ? { details: n.details } : {}),
        ...(n.meta ? { meta: n.meta } : {}),
        ...(n.moscow ? { moscow: n.moscow } : {}),
        ...(n.question ? { question: n.question } : {}),
      }]));
      await fetch(`/api/projects/${projectId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ nodeState }),
      }).catch(() => {});

      const ideaTexts = transcriptMessages
        .filter(m => m.role === "user" && m.content.trim().length > 20)
        .slice(-4)
        .map(m => m.content.replace(/\s+/g, " ").trim());
      await Promise.all(ideaTexts.map((idea, idx) => fetch(`/api/projects/${projectId}/entries`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({
          title: idea.slice(0, 80),
          summary: idea.slice(0, 500),
          status: "parked",
          severity: "parked",
          mode: "home",
          verb: idx === 0 ? "home_handoff" : "idea",
        }),
      }).catch(() => null)));

      setHandoffStage("Ready.");
      try {
        sessionStorage.setItem(`atlas-home-handoff-${projectId}`, JSON.stringify({
          parkedCount: ideaTexts.length,
          flowNodeCount: nodes.length,
          goalLabel: goal?.label ?? "your goal",
          nodes: nodes.map(n => ({ id: n.id, label: n.label, type: n.type, details: n.details, meta: n.meta, moscow: n.moscow, resolved: n.resolved })),
          parkedTitles: ideaTexts.map(idea => idea.slice(0, 80)),
        }));
        sessionStorage.setItem("atlas-open-tab", "map");
        if (plan) {
          sessionStorage.setItem(`atlas-home-plan-${projectId}`, JSON.stringify(plan));
        }
      } catch {}

      queryClient.invalidateQueries({ queryKey: getListProjectsQueryKey() });
      setLocation(`/project/${projectId}?source=home-handoff`);
      return;
    } catch {
      toast("Handoff failed — try again");
    } finally {
      setHandoffLoading(false);
      setHandoffStage("");
    }
  }, [nexusChat.messages, queryClient, setActiveProjectId, setLocation]);

  const handleAmbientSurfaceAction = useCallback(async (surface: NonNullable<AmbientSurface>) => {
    if (surface.type === "MAP") {
      if (surface.projectId) {
        setLocation(`/project/${surface.projectId}?tab=map`);
      } else {
        setLocation("/map");
      }
      return;
    }


    const activeProjectId = surface.projectId ?? surface.workspaceId ?? homeProjectState.project?.id ?? mostRecentActiveProjectId;

    if (surface.type === "WORKSPACE") {
      if (activeProjectId) {
        setLocation(`/project/${activeProjectId}`);
        return;
      }
      await handleHandoff(undefined, surface.label || "New Project");
      return;
    }

    if (surface.type === "DECISION") {
      if (!activeProjectId) return;
      try {
        const res = await fetch(`/api/projects/${activeProjectId}/entries`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          credentials: "include",
          body: JSON.stringify({
            title: surface.label,
            status: "committed",
            severity: "committed",
            summary: "Logged from Atlas surface signal",
          }),
        });
        if (res.ok) {
          toast("Decision captured");
          queryClient.invalidateQueries({ queryKey: getListProjectsQueryKey() });
        }
      } catch {
        // Surface actions stay ambient; failures should not interrupt the thread.
      }
    }
  }, [handleHandoff, homeProjectState.project?.id, mostRecentActiveProjectId, queryClient, setLocation]);

  const handleNewConversation = useCallback(() => {
    try { localStorage.removeItem("atlas-home-conversation-id"); } catch {}
    try { sessionStorage.removeItem("atlas-home-conversation-id"); } catch {}
    conversationThreadRequestRef.current = null;
    thinkOutLoudInlineRef.current = false;
    setActiveConversationId(null);
    nexusChat.clearMessages();
    setReviewingPlanIds(new Set());
    setShowHistory(false);
    setEarnedTitle(null);
  }, [nexusChat.clearMessages]);

  // Wordmark click while on /home resets the tray back to an ambient blank Nexus.
  useEffect(() => {
    const reset = () => {
      setGlobalInsightOpen(false);
      handleNewConversation();
      setDepth("ambient");
      try { window.scrollTo({ top: 0, behavior: "smooth" }); } catch {}
    };
    window.addEventListener("axiom:home-reset", reset);
    return () => window.removeEventListener("axiom:home-reset", reset);
  }, [handleNewConversation, setDepth]);


  // Hydrate earned title when the active conversation changes.
  useEffect(() => {
    if (!activeConversationId) {
      setEarnedTitle(null);
      return;
    }
    try {
      const stored = localStorage.getItem(`atlas-thread-title:${activeConversationId}`);
      setEarnedTitle(stored && stored.trim() ? stored : null);
    } catch {
      setEarnedTitle(null);
    }
  }, [activeConversationId]);

  const handleOpenHistory = useCallback(async () => {
    setShowHistory(true);
    setHistoryLoading(true);
    try {
      const res = await fetch("/api/nexus/conversations", { credentials: "include" });
      const data = await res.json();
      setConversations(data.conversations ?? []);
    } catch {} finally {
      setHistoryLoading(false);
    }
  }, []);

  const handleSwitchConversation = useCallback(async (id: string) => {
    try {
      const res = await fetch(`/api/nexus/thread?conversationId=${encodeURIComponent(id)}`, { credentials: "include" });
      const msgs = await res.json() as Array<{ role: string; content: string }>;
      const normalizedMessages = Array.isArray(msgs)
        ? normalizeLoadedHomeMessages(msgs, (message, index) => {
            const plan = message.role === "assistant" ? detectPlanFromText(message.content) : null;
            return {
              role: message.role,
              content: message.content,
              id: `${id}-history-${index}`,
              ...(plan ? { plan } : {}),
            };
          })
        : [];

      nexusChat.setMessages(normalizedMessages.length > 0 ? (normalizedMessages as any) : []);
      setActiveConversationId(id);
      setReviewingPlanIds(new Set());
      try { localStorage.setItem("atlas-home-conversation-id", id); } catch {}
      try { sessionStorage.setItem("atlas-home-conversation-id", id); } catch {}

      // The home composer's gold-clock history exclusively lists Global Insight
      // threads ("GLOBAL INSIGHT · HISTORY"). Resuming one must re-enter Global
      // Insight mode so the surface, reflection flag, and depth all match — not
      // strand the thread in the ambient homepage where it tries to earn a
      // title and reads as half-broken.
      setGlobalInsightOpen(true);
      setDepth("active");
      try {
        await fetch(`/api/sessions/${encodeURIComponent(id)}/reflection-mode`, {
          method: "POST",
          credentials: "include",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ enabled: true }),
        });
      } catch {}

      setShowHistory(false);
    } catch {}
  }, [setActiveConversationId, nexusChat.setMessages, setDepth]);

  const handleDeleteConversation = useCallback(async (id: string) => {
    await fetch(`/api/nexus/thread?conversationId=${encodeURIComponent(id)}`, {
      method: "DELETE",
      credentials: "include",
    }).catch(() => {});

    setConversations((prev) => prev.filter((conversation) => conversation.id !== id));

    if (id === activeConversationId) {
      handleNewConversation();
    }

    try { localStorage.removeItem(`atlas-thread-title:${id}`); } catch {}
    toast("Conversation deleted");
  }, [activeConversationId, handleNewConversation]);

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    // On touch devices Enter inserts a newline — user submits via the Send button.
    // Only desktop (fine pointer) gets Enter-to-send.
    const isTouch = typeof window !== "undefined" && window.matchMedia?.("(pointer: coarse)").matches;
    if (!isTouch && e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
      e.preventDefault();
      void handleSubmit();
    }
  };

  const autoResize = () => {
    const el = textareaRef.current;
    if (!el) return;
    const currentH = parseFloat(el.style.height) || 0;
    // Only collapse to auto when shrinking — avoids the flash-collapse on every keystroke
    if (el.scrollHeight < currentH) {
      el.style.height = "auto";
    }
    el.style.height = Math.min(el.scrollHeight, 160) + "px";
  };

  useEffect(() => {
    if (!globalInsightOpen) return;
    const el = globalInsightComposerRef.current;
    if (!el) return;

    const recompute = () => {
      const nextHeight = Math.ceil(el.getBoundingClientRect().height);
      if (nextHeight > 0) setGlobalInsightComposerHeight(nextHeight);
    };

    recompute();
    const ro = new ResizeObserver(recompute);
    ro.observe(el);
    return () => ro.disconnect();
  }, [globalInsightOpen, input, attachedFiles.length, inputFocused]);

  const hasInput = input.trim().length > 0;
  const hasAttachments = attachedFiles.length > 0;
  const canSubmit = hasInput || hasAttachments;
  const canSubmitNow = () => {
    const liveText = textareaRef.current?.value ?? input;
    return liveText.trim().length > 0 || attachedFiles.length > 0;
  };
  const [shapingHeaderSlot, setShapingHeaderSlot] = useState<HTMLElement | null>(null);

  useEffect(() => {
    const header = document.querySelector(".atlas-app-header");
    if (!header) return;
    const logoRegion = header.children[0] as HTMLElement | undefined;

    const slot = document.createElement("div");
    slot.setAttribute("data-home-shaping-slot", "true");
    slot.style.display = "flex";
    slot.style.alignItems = "center";
    slot.style.flexShrink = "0";
    slot.style.position = "relative";
    slot.style.zIndex = "2";

    const previousDisplay = logoRegion?.style.display ?? "";
    const previousAlignItems = logoRegion?.style.alignItems ?? "";
    const previousGap = logoRegion?.style.gap ?? "";
    if (logoRegion) {
      logoRegion.style.display = "flex";
      logoRegion.style.alignItems = "center";
      logoRegion.style.gap = "12px";
      logoRegion.appendChild(slot);
    } else {
      header.insertBefore(slot, header.children[1] ?? null);
    }
    setShapingHeaderSlot(slot);

    return () => {
      slot.remove();
      if (logoRegion) {
        logoRegion.style.display = previousDisplay;
        logoRegion.style.alignItems = previousAlignItems;
        logoRegion.style.gap = previousGap;
      }
      setShapingHeaderSlot(null);
    };
  }, []);

  return (
    <div
      ref={ptrContainerRef}
      className="atlas-home-bg"
      style={{
        height: "100dvh",
        backgroundColor: "var(--atlas-bg)",
        display: "flex",
        flexDirection: "column",
        overflowY: globalInsightOpen ? "hidden" : "auto",
        overflowX: "hidden",
      }}
    >
      {/* Global Insight runs inline through the ambient home shell.
          The "● Global Insight" pill in the subheader is the only visual marker —
          no overlay, no duplicate header, no separate composer. */}

      {shapingHeaderSlot && nexusChat.shapingPayload && createPortal(
        <div
          onClick={async () => {
            if (!nexusChat.shapingPayload) return;

            // If already held — navigate to existing project
            if (nexusChat.shapingHeld) {
              const existing = (projects as any[])?.find(
                (p: any) => p.entity_type === "idea"
              );
              if (existing) {
                window.location.href = `/project/${existing.id}`;
              }
              return;
            }

            // Not yet held — save it with the correct title
            try {
              const res = await fetch("/api/shaping/hold", {
                method: "POST",
                credentials: "include",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                  title: nexusChat.shapingPayload.title,
                  audience: nexusChat.shapingPayload.audience,
                  tension: nexusChat.shapingPayload.tension,
                  what: nexusChat.shapingPayload.what,
                }),
              });
              if (res.ok) {
                nexusChat.setShapingHeld(true);
                // Refresh projects so the next tap can find the new idea
                await queryClient.invalidateQueries({ queryKey: getListProjectsQueryKey() });
                // If the response includes the new project id, navigate immediately
                try {
                  const data = await res.clone().json();
                  const newId = data?.id ?? data?.project?.id ?? data?.projectId;
                  if (newId) {
                    window.location.href = `/project/${newId}`;
                  }
                } catch { /* response may not be JSON — non-fatal */ }
              }
            } catch { /* non-fatal */ }
          }}
          style={{
            display: "flex",
            alignItems: "center",
            gap: "6px",
            padding: "4px 10px",
            borderRadius: "999px",
            border: `1px solid rgba(201, 162, 76, ${
              nexusChat.shapingHeld ? "0.4" : "0.6"
            })`,
            background: `rgba(201, 162, 76, ${
              nexusChat.shapingHeld ? "0.06" : "0.1"
            })`,
            cursor: "pointer",
            animation: !nexusChat.shapingHeld
              ? "shapingPulse 2s ease-in-out infinite"
              : "none",
          }}
        >
          <div style={{
            width: "6px",
            height: "6px",
            borderRadius: "50%",
            background: "var(--atlas-gold)",
            opacity: nexusChat.shapingHeld ? 0.7 : 1,
          }} />
          <span style={{
            fontSize: "10px",
            color: "var(--atlas-gold)",
            letterSpacing: "0.1em",
            fontFamily: "var(--app-font-mono)",
          }}>
            {nexusChat.shapingHeld
              ? nexusChat.shapingPayload.title
              : "SHAPING"}
          </span>
        </div>,
        shapingHeaderSlot
      )}
      {(ptr_pulling || ptr_refreshing) && (
        <div
          style={{
            position: "fixed",
            top: 0,
            left: 0,
            right: 0,
            zIndex: 100,
            display: "flex",
            justifyContent: "center",
            alignItems: "flex-end",
            height: Math.min(ptr_distance, 72) + 16,
            pointerEvents: "none",
          }}
        >
          <div
            style={{
              width: 26,
              height: 26,
              borderRadius: "50%",
              border: "1.5px solid rgba(201,162,76,0.25)",
              borderTopColor:
                ptr_distance >= 96 || ptr_refreshing
                  ? "var(--atlas-gold)"
                  : "rgba(201,162,76,0.5)",
              opacity: Math.min(ptr_distance / 60, 1),
              animation: ptr_refreshing ? "ptr-spin 700ms linear infinite" : "none",
              transform: ptr_refreshing
                ? "none"
                : `rotate(${Math.min((ptr_distance / 96) * 270, 270)}deg)`,
            }}
          />
        </div>
      )}

      <UnifiedSubheader
        activeTab="chat"
        onTabChange={handleHomeSubheaderTabChange}
        hasProject={false}
        isMobile={isMobile}
        hasConversation={nexusChat.messages.length > 0}
      />
      


      {/* Lens chips removed from home — lenses live in the workspace only */}


      {/* Shred-It modal removed — exit Global Insight directly via the header sparkle. */}

      {showOverlay && (
        <FirstRunOverlay
          loading={createProject.isPending}
          backendReady={backendReady}
          repoUrl={overlayRepoUrl}
          setRepoUrl={setOverlayRepoUrl}
          error={createError}
          onSpecMode={() => {
            setCreateError(null);
            createProject.mutate({ data: { name: "Untitled" } }, {
              onSuccess: (p) => {
                dismissOverlay();
                queryClient.invalidateQueries({ queryKey: getListProjectsQueryKey() });
                logProjectInitialized(p.id);
                const normalizedRepo = normalizeGitHubRepoInput(overlayRepoUrl);
                if (normalizedRepo) {
                  void fetch(`/api/projects/${p.id}`, {
                    method: "PATCH",
                    headers: { "Content-Type": "application/json" },
                    credentials: "include",
                    body: JSON.stringify({ linkedRepo: serializeLinkedRepo({ fullName: normalizedRepo }) }),
                  }).catch(() => {});
                }
                runRepoScan(p.id, overlayRepoUrl);
                sessionStorage.setItem("atlas-open-tab", "map");
                setLocation(`/project/${p.id}?intake=true`);
              },
              onError: (err: any) => {
                setCreateError(extractApiErrorMessage(err) ?? "Failed to create project");
              },
            });
          }}
          onWorkspace={() => {
            setCreateError(null);
            createProject.mutate({ data: { name: "Untitled" } }, {
              onSuccess: (p) => {
                dismissOverlay();
                queryClient.invalidateQueries({ queryKey: getListProjectsQueryKey() });
                logProjectInitialized(p.id);
                const normalizedRepo = normalizeGitHubRepoInput(overlayRepoUrl);
                if (normalizedRepo) {
                  void fetch(`/api/projects/${p.id}`, {
                    method: "PATCH",
                    headers: { "Content-Type": "application/json" },
                    credentials: "include",
                    body: JSON.stringify({ linkedRepo: serializeLinkedRepo({ fullName: normalizedRepo }) }),
                  }).catch(() => {});
                }
                runRepoScan(p.id, overlayRepoUrl);
                setLocation(`/project/${p.id}?intake=true`);
              },
              onError: (err: any) => {
                setCreateError(extractApiErrorMessage(err) ?? "Failed to create project");
              },
            });
          }}
          onDismiss={dismissOverlay}
        />
      )}

      {/* Main content */}
      <div
        className="atlas-home-responsive-shell"
        style={{
          display: "flex",
          justifyContent: "center",
          padding: "0 24px",
        }}
      >
        <UnifiedConversationSurface
          mode={nexusChat.messages.length > 0 ? "active" : "ambient"}
          hostShell={({ stream }) => (
            <div className="atlas-home-chat-column">
              <div
                className="atlas-home-chat-inner"
                style={{
                  width: "100%",
                  maxWidth: 560,
                  paddingBottom: globalInsightOpen ? 0 : "var(--atlas-dock-clearance)",
                  display: globalInsightOpen ? "flex" : undefined,
                  flexDirection: globalInsightOpen ? "column" : undefined,
                  height: globalInsightOpen
                    ? "calc(100dvh - var(--atlas-header-height) - var(--atlas-dock-clearance))"
                    : undefined,
                  minHeight: globalInsightOpen
                    ? "calc(100dvh - var(--atlas-header-height) - var(--atlas-dock-clearance))"
                    : undefined,
                  minWidth: 0,
                }}
              >

                {stream}
              </div>
            </div>
          )}
          streamSlot={<>

          {/* Hero — fills the viewport above the mobile nav, content vertically centered */}
          <div style={{
            minHeight: globalInsightOpen
              ? 0
              : (nexusChat.messages.length > 0 ? 0 : "calc(100svh - var(--atlas-header-height) - var(--atlas-dock-clearance) - env(safe-area-inset-bottom, 0px))"),
            height: globalInsightOpen ? "100%" : undefined,
            display: "flex",
            flexDirection: "column",
            justifyContent: globalInsightOpen ? "flex-start" : "center",
            position: "relative",
            paddingBottom: globalInsightOpen ? 0 : "var(--atlas-dock-clearance)",
            paddingTop: globalInsightOpen ? 0 : 0,
            minWidth: 0,
            overflow: globalInsightOpen ? "hidden" : "visible",
          }}>
            {/* Atmospheric pulse — behind everything, theme-aware */}
            <div className="atlas-home-atmosphere" style={{
              position: "absolute",
              top: "38%",
              left: "50%",
              transform: "translate(-50%, -50%)",
              width: "110%",
              height: 340,
              filter: "blur(28px)",
              pointerEvents: "none",
              animation: "homePurpleAtmosphere 7s ease-in-out infinite",
              zIndex: 0,
            }} />

            {/* Greeting — same in ambient + Global Insight. GI is signaled
                only by the subheader "● Global Insight" pill, so the home shell
                stays visually identical. */}
            {nexusChat.messages.length === 0 && (
              <div style={{
                textAlign: "center",
                marginBottom: 24,
                marginTop: 72,
                position: "relative",
                zIndex: 1,
                transform: inputFocused ? "translateY(-12px)" : "translateY(0)",
                opacity: inputFocused ? 0.3 : 1,
                transition: "transform 200ms ease-in-out, opacity 200ms ease-in-out",
              }}>
                <h1 style={{
                  fontSize: "var(--ts-display-xl)", fontWeight: 300,
                  letterSpacing: "-0.025em", lineHeight: 1.2, margin: "0 0 10px",
                  color: globalInsightOpen ? undefined : "var(--atlas-fg)",
                  opacity: globalInsightOpen ? 1 : 0.85,
                  background: globalInsightOpen
                    ? "linear-gradient(135deg, #FFD27A 0%, #E8843C 55%, #C2410C 100%)"
                    : undefined,
                  WebkitBackgroundClip: globalInsightOpen ? "text" : undefined,
                  WebkitTextFillColor: globalInsightOpen ? "transparent" : undefined,
                  backgroundClip: globalInsightOpen ? "text" : undefined,
                  filter: globalInsightOpen ? "drop-shadow(0 0 18px rgba(232,132,60,0.35))" : undefined,
                }}>
                  {globalInsightOpen ? "Global Insight." : greetingRef.current?.head}
                </h1>
                <p style={{
                  fontSize: "var(--ts-body)" as any,
                  color: globalInsightOpen ? "var(--atlas-gold)" : "var(--atlas-muted)",
                  opacity: globalInsightOpen ? 0.75 : 0.55,
                  margin: 0,
                  fontStyle: "italic",
                }}>
                  {globalInsightOpen ? "Ask across every thread." : greetingRef.current?.sub}
                </p>
              </div>
            )}

            {/* Chat thread */}
            <div style={{
              margin: globalInsightOpen
                ? (nexusChat.messages.length > 0 ? "0 0 14px" : "0 0 12px")
                : (nexusChat.messages.length > 0 ? "6px 0 26px" : "18px 0 26px"),
              minHeight: globalInsightOpen ? 0 : (nexusChat.messages.length > 0 ? 60 : 0),
              flex: globalInsightOpen ? 1 : undefined,
              display: globalInsightOpen ? "flex" : undefined,
              flexDirection: globalInsightOpen ? "column" : undefined,
              minWidth: 0,
            }}>
              {nexusChat.messages.length > 0 && (
                <div style={{ display: "flex", alignItems: "center", width: "100%", gap: 12, marginBottom: 14 }}>
                  <div style={{ flex: 1, height: 1, background: "linear-gradient(to right, transparent, rgba(180,83,9,0.18), transparent)" }} />
                </div>
              )}
            {nexusChat.messages.length === 0 && !isAtlasStreaming && !threadLoading ? (
              <div style={{ display: "flex", justifyContent: "center", marginTop: 10, opacity: 0.7, animation: "fadeIn 600ms ease forwards" }}>
                <button
                  type="button"
                  aria-label="Focus composer"
                  onClick={() => window.dispatchEvent(new Event("atlas:focus-composer"))}
                  style={{ background: "transparent", border: "none", padding: 8, cursor: "pointer", borderRadius: 999, WebkitTapHighlightColor: "transparent" }}
                >
                  <LoadingSpinner size="sm" color="atlas" />
                </button>
              </div>
            ) : nexusChat.messages.length === 0 && !isAtlasStreaming ? (
              <div style={{ display: "flex", justifyContent: "center" }}>
                <button
                  type="button"
                  aria-label="Focus composer"
                  onClick={() => window.dispatchEvent(new Event("atlas:focus-composer"))}
                  style={{ background: "transparent", border: "none", padding: 8, cursor: "pointer", borderRadius: 999, WebkitTapHighlightColor: "transparent" }}
                >
                  <LoadingSpinner size="sm" color="atlas" />
                </button>
              </div>

            ) : (
              <div style={{ display: "flex", flexDirection: "column", flex: 1, minHeight: globalInsightOpen ? 0 : undefined }}>
                {/* Messages */}
                <div
                  ref={chatScrollRef}
                  className="atlas-home-chat-messages-scroll"
                  onScroll={(e) => {
                    const el = e.currentTarget;
                    setShowScrollBtn(el.scrollHeight - el.scrollTop - el.clientHeight > 120);
                  }}
                  style={{
                    display: "flex", flexDirection: "column", gap: 12,
                    flex: 1, minHeight: 0, overflowY: "auto", overflowX: "hidden",
                    overscrollBehaviorY: "contain",
                    scrollbarWidth: "none", msOverflowStyle: "none",
                    WebkitOverflowScrolling: "touch",
                    touchAction: "pan-y",
                    paddingRight: globalInsightOpen ? 0 : 80,
                    paddingLeft: globalInsightOpen ? 0 : 0,
                    position: "relative",
                    border: "none",
                    borderRadius: 0,
                    paddingTop: globalInsightOpen ? 16 : (nexusChat.messages.length > 0 ? 16 : 56),
                    scrollPaddingTop: globalInsightOpen ? 16 : (nexusChat.messages.length > 0 ? 16 : 56),
                    paddingBottom: globalInsightOpen
                      ? "calc(24px + env(safe-area-inset-bottom, 0px))"
                      : 96,
                    WebkitMaskImage: globalInsightOpen
                      ? "none"
                      : "linear-gradient(to bottom, #000 0, #000 calc(100% - 72px), rgba(0,0,0,0) 100%)",
                    maskImage: globalInsightOpen
                      ? "none"
                      : "linear-gradient(to bottom, #000 0, #000 calc(100% - 72px), rgba(0,0,0,0) 100%)",
                    transition: "border-color 200ms",
                  }}
                >
                  {showGoneFlash && nexusChat.messages.length === 0 && (
                    <div style={{ textAlign: "center", padding: "24px 0", fontSize: "var(--ts-caption)", fontFamily: "var(--app-font-mono)", color: "var(--atlas-muted)", opacity: 0.6, letterSpacing: "0.08em", animation: "fadeOut 1500ms ease forwards" }}>
                      Gone.
                    </div>
                  )}
                  {(nexusChat.messages as HomeMessage[]).map((msg, i) => (
                    <Fragment key={i}>
                      {loadedHistoryCount > 0 && i === loadedHistoryCount && nexusChat.messages.length > loadedHistoryCount && (
                        <div style={{ display: "flex", alignItems: "center", gap: 10, margin: "8px 0", opacity: 0.3 }}>
                          <div style={{ flex: 1, height: 1, background: "var(--atlas-border)" }} />
                          <span style={{ fontFamily: "var(--app-font-mono)", fontSize: "var(--ts-xs)", letterSpacing: "0.14em", color: "var(--atlas-muted)", textTransform: "lowercase" }}>
                            — earlier —
                          </span>
                          <div style={{ flex: 1, height: 1, background: "var(--atlas-border)" }} />
                        </div>
                      )}
                    <div data-msg-idx={i} style={{ display: "flex", flexDirection: msg.role === 'user' ? "row-reverse" : "row", alignItems: "flex-start", gap: 6, animation: isShredding ? `atlas-shred 600ms ${i * 80}ms ease-in forwards` : "fadeIn 250ms ease forwards" }}>
                      {msg.role === 'assistant' ? (
                        <div style={{ minWidth: 0, flex: 1 }}>
                          {/* Model label + intent badge */}
                          <div style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: 5 }}>
                            <span style={{
                              fontSize: "var(--ts-xs)", fontFamily: "var(--app-font-mono)", letterSpacing: "0.1em",
                              textTransform: "uppercase", opacity: 0.45,
                              color: globalInsightOpen ? "var(--atlas-gold)" : (msg.model === "gpt4o" ? "#10a37f" : msg.model === "gemini" ? "#4285f4" : "var(--atlas-gold)"),
                            }}>Atlas</span>
                            {msg.intentType && (
                              <span style={{
                                fontSize: "var(--ts-xs)", fontFamily: "var(--app-font-mono)", letterSpacing: "0.08em",
                                padding: "1px 6px", borderRadius: 3,
                                background: msg.intentType === "BUILD" ? "rgba(74,222,128,0.1)" : "rgba(201,162,76,0.1)",
                                border: `1px solid ${msg.intentType === "BUILD" ? "rgba(74,222,128,0.25)" : "rgba(201,162,76,0.25)"}`,
                                color: msg.intentType === "BUILD" ? "#4ade80" : "var(--atlas-gold)",
                              }}>{msg.intentType}</span>
                            )}
                          </div>
                          {/* Bubble */}
                          <div style={{
                            padding: "4px 0",
                            background: "transparent",
                            border: "none",
                            fontSize: 16, lineHeight: 1.85, color: "var(--atlas-fg)", opacity: 0.9,
                            fontFamily: "var(--app-font-sans)",
                          }}>
                            <HomeChunkedBubbles text={msg.content} isNew={!!msg.isNew} isStreaming={!!msg.streaming} />
                            {msg.imageGen?.images?.map((img, i) => (
                              <img
                                key={i}
                                src={img.imageUrl}
                                alt={img.prompt}
                                style={{ maxWidth: '100%', borderRadius: 12, marginTop: 12 }}
                              />
                            ))}
                          </div>
                          {!msg.streaming && !!msg.content && (
                            <InlineSketchOffer
                              text={msg.content}
                              onSend={(prompt) => { void nexusChat.send({ text: prompt }); }}
                            />
                          )}
                          {msg.researchResult && (
                            <ResearchCard
                              url={msg.researchResult.url}
                              title={msg.researchResult.title}
                              summary={msg.researchResult.summary}
                              headings={msg.researchResult.headings ?? []}
                            />
                          )}
                          {msg.focusSuggestion && !msg.streaming && (
                            <div style={{ marginTop: 8, marginLeft: 4 }}>
                              <button
                                onClick={() => setLocation(`/project/${msg.focusSuggestion!.projectId}`)}
                                style={{
                                  background: "transparent",
                                  border: "1px solid rgba(201,162,76,0.35)",
                                  borderRadius: "20px",
                                  color: "var(--atlas-gold)",
                                  fontSize: "12px",
                                  padding: "6px 14px",
                                  cursor: "pointer",
                                  display: "inline-flex",
                                  alignItems: "center",
                                  gap: "6px",
                                  fontFamily: "var(--app-font-sans)",
                                  letterSpacing: "0.02em",
                                }}
                              >
                                → Open {msg.focusSuggestion.projectName} workspace
                              </button>
                            </div>
                          )}

                          {(msg.visualLoading || (msg.streaming && !!msg.imageGen?.images?.length)) && !msg.visualImageBase64 && !msg.imageGen?.images?.[0]?.imageUrl && (
                            <SketchReveal loading caption="Sketching a concept…" />
                          )}

                          {(msg.visualImageBase64 || msg.imageGen?.images?.[0]?.imageUrl) && !msg.visualLoading && (
                            <SketchReveal
                              src={msg.visualImageBase64 ? `data:image/png;base64,${msg.visualImageBase64}` : (msg.imageGen?.images?.[0]?.imageUrl ?? "")}
                              alt={msg.visualCaption ?? msg.imageGen?.images?.[0]?.prompt ?? "Concept sketch"}
                              caption={msg.visualCaption ?? ([msg.imageGen?.images?.[0]?.mode, msg.imageGen?.images?.[0]?.model].filter(Boolean).join(" · ") || null)}
                            />
                          )}

                          {!msg.streaming && Boolean(msg.terminalCmd || msg.terminalResult) && (
                            <InlineTerminalBlock terminalCmd={msg.terminalCmd} terminalResult={msg.terminalResult} />
                          )}
                          {msg.plan && !msg.streaming && (() => {
                            const planKey = msg.id ?? `home-plan-${i}`;
                            const isExpanded = reviewingPlanIds.has(planKey);
                            return (
                              <PlanCard
                                plan={msg.plan}
                                messageId={i}
                                projectId={homeFocus ?? 0}
                                displayMode="home"
                                isExecuting={false}
                                isExpanded={isExpanded}
                                onReview={() => {
                                  setReviewingPlanIds((prev) => {
                                    const next = new Set(prev);
                                    if (next.has(planKey)) next.delete(planKey);
                                    else next.add(planKey);
                                    return next;
                                  });
                                }}
                                onSkip={() => {}}
                                onApprove={() => {}}
                                onTakeToWorkspace={() => void handleHandoff(
                                  msg.handoffSignal,
                                  handoffProjectName || msg.handoffSignal?.projectName || msg.plan?.title || "New Project",
                                  msg.plan
                                )}
                              />
                            );
                          })()}
                          {msg.handoffSignal && i === firstHandoffMessageIndex && !handoffCardDismissed && !msg.streaming && nexusChat.messages.filter(m => m.role === "user").length >= 5 && (
                            <HomeHandoffCard
                              signal={msg.handoffSignal}
                              projectName={handoffProjectName || msg.handoffSignal.projectName || "New Project"}
                              projectId={msg.handoffSignal.projectId ?? null}
                              onProjectNameChange={setHandoffProjectName}
                              loading={handoffLoading}
                              stage={handoffStage}
                              onStart={() => void handleHandoff(msg.handoffSignal, handoffProjectName || msg.handoffSignal?.projectName || "New Project")}
                              onDismiss={() => {
                                try { sessionStorage.setItem(`atlas-home-handoff-dismissed-${activeConversationId}`, "1"); } catch {}
                                setHandoffCardDismissed(true);
                              }}
                            />
                          )}
                          {/* Copy button */}
                          {msg.content && (
                            <button
                              title={copiedMsgIdx === i ? "Copied!" : "Copy"}
                              onClick={() => {
                                navigator.clipboard.writeText(msg.content).catch(() => {});
                                setCopiedMsgIdx(i);
                                setTimeout(() => setCopiedMsgIdx(prev => prev === i ? null : prev), 1800);
                              }}
                              style={{
                                background: "transparent", border: "none", padding: "3px 2px", cursor: "pointer",
                                opacity: copiedMsgIdx === i ? 0.9 : 0.28,
                                color: copiedMsgIdx === i ? "var(--atlas-gold)" : "var(--atlas-muted)",
                                lineHeight: 1, transition: "opacity 140ms, color 140ms", marginTop: 3,
                              }}
                              onMouseEnter={e => (e.currentTarget.style.opacity = "0.65")}
                              onMouseLeave={e => (e.currentTarget.style.opacity = copiedMsgIdx === i ? "0.9" : "0.28")}
                            >
                              {copiedMsgIdx === i ? (
                                <svg width="11" height="11" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><path d="M3 8l4 4 6-7"/></svg>
                              ) : (
                                <svg width="11" height="11" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round"><rect x="5" y="1" width="10" height="13" rx="1.5"/><path d="M3 3H2a1 1 0 00-1 1v11a1 1 0 001 1h10a1 1 0 001-1v-1"/></svg>
                              )}
                            </button>
                          )}
                          {msg.createdAt && !msg.streaming && (
                            <div style={{ fontFamily: "var(--app-font-mono)", fontSize: "var(--ts-xs)", letterSpacing: "0.08em", color: "var(--atlas-muted)", opacity: 0.45, marginTop: 4, textTransform: "lowercase" }}>
                              {formatMessageTime(msg.createdAt)}
                            </div>
                          )}
                          {!globalInsightOpen && !msg.streaming && formatModelUsedLabel(msg.modelUsed) && (
                            <div style={{ fontFamily: "var(--app-font-mono)", fontSize: 9, color: "rgba(120,113,108,0.4)", marginTop: 2 }}>
                              {formatModelUsedLabel(msg.modelUsed)}
                            </div>
                          )}
                        </div>
                       ) : (
                         <div style={{
                           display: "flex", flexDirection: "column",
                           alignItems: "flex-end",
                           maxWidth: "85%", gap: 3,
                           marginBottom: 14, marginLeft: "auto",
                         }}>
                          <div style={{
                            fontSize: "var(--ts-xs)", fontFamily: "var(--app-font-mono)", letterSpacing: "0.1em",
                            textTransform: "uppercase", opacity: 0.55, color: "rgba(212,175,55,0.85)",
                            marginBottom: 4,
                            alignSelf: "flex-end",
                          }}>You</div>
                          <div style={{
                            padding: "10px 14px",
                            background: "rgba(212,175,55,0.06)",
                            border: "1px solid rgba(212,175,55,0.22)",
                            borderRadius: "12px 12px 4px 12px",
                            alignSelf: "flex-end",
                            fontSize: 16, lineHeight: 1.6, color: "var(--atlas-fg)",
                            fontFamily: "var(--app-font-sans)",
                          }}>
                            {(() => {
                              const imgs = (msg as any).attachments && (msg as any).attachments.length > 0
                                ? (msg as any).attachments as Array<{ base64: string; mediaType: string; name?: string }>
                                : (msg.imageUrl
                                    ? [{ base64: "", mediaType: "", name: undefined, _url: msg.imageUrl }] as any
                                    : []);
                              if (imgs.length === 0) return null;
                              return (
                                <div style={{ display: "flex", flexWrap: "wrap", gap: 6, marginBottom: msg.content ? 8 : 0 }}>
                                  {imgs.map((img: any, idx: number) => {
                                    const url = img._url ?? `data:${img.mediaType};base64,${img.base64}`;
                                    return (
                                      <div key={idx} style={{ position: "relative" }}>
                                        <img
                                          src={url}
                                          alt={img.name || "Attached"}
                                          style={{
                                            width: imgs.length === 1 ? "100%" : 110,
                                            maxWidth: "100%",
                                            height: imgs.length === 1 ? "auto" : 110,
                                            maxHeight: imgs.length === 1 ? 320 : 110,
                                            objectFit: "cover",
                                            borderRadius: 8,
                                            display: "block",
                                            border: "0.5px solid rgba(212,175,55,0.25)",
                                          }}
                                        />
                                        <span
                                          aria-hidden
                                          style={{
                                            position: "absolute",
                                            top: 4,
                                            right: 4,
                                            width: 18,
                                            height: 18,
                                            borderRadius: 999,
                                            background: "rgba(0,0,0,0.55)",
                                            color: "var(--atlas-gold)",
                                            display: "flex",
                                            alignItems: "center",
                                            justifyContent: "center",
                                          }}
                                        >
                                          <svg width="10" height="10" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
                                            <path d="M13 7.5l-5 5a3 3 0 01-4.24-4.24l6-6a2 2 0 012.83 2.83l-6 6a1 1 0 11-1.41-1.41L9.5 5" />
                                          </svg>
                                        </span>
                                      </div>
                                    );
                                  })}
                                </div>
                              );
                            })()}
                            <CollapsibleMessageText
                              fadeFromColor="rgba(212,175,55,0.06)"
                              textStyle={{
                                fontSize: 16,
                                lineHeight: 1.6,
                                color: "var(--atlas-fg)",
                                fontFamily: "var(--app-font-sans)",
                                whiteSpace: "pre-wrap",
                                wordBreak: "break-word",
                              }}
                            >
                              {msg.content}
                            </CollapsibleMessageText>
                          </div>
                          <div style={{ display: "flex", alignItems: "center", gap: 4, marginTop: 4, alignSelf: "flex-end", flexDirection: "row-reverse" }}>
                            <button
                              type="button"
                              title={copiedMsgIdx === i ? "Copied!" : "Copy"}
                              aria-label="Copy message"
                              onClick={() => {
                                navigator.clipboard.writeText(msg.content).catch(() => {});
                                setCopiedMsgIdx(i);
                                setTimeout(() => setCopiedMsgIdx(prev => prev === i ? null : prev), 1800);
                              }}
                              style={{
                                background: "transparent", border: "none", padding: "3px 4px", cursor: "pointer",
                                opacity: copiedMsgIdx === i ? 0.9 : 0.35,
                                color: copiedMsgIdx === i ? "var(--atlas-gold)" : "var(--atlas-muted)",
                                lineHeight: 1, transition: "opacity 140ms, color 140ms",
                              }}
                              onMouseEnter={e => (e.currentTarget.style.opacity = "0.75")}
                              onMouseLeave={e => (e.currentTarget.style.opacity = copiedMsgIdx === i ? "0.9" : "0.35")}
                            >
                              {copiedMsgIdx === i ? (
                                <svg width="11" height="11" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><path d="M3 8l4 4 6-7"/></svg>
                              ) : (
                                <svg width="11" height="11" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round"><rect x="5" y="1" width="10" height="13" rx="1.5"/><path d="M3 3H2a1 1 0 00-1 1v11a1 1 0 001 1h10a1 1 0 001-1v-1"/></svg>
                              )}
                            </button>
                            <button
                              type="button"
                              title="Edit & resend"
                              aria-label="Edit message"
                              onClick={() => {
                                setInput(msg.content);
                                try {
                                  const ta = document.querySelector<HTMLTextAreaElement>('textarea[data-atlas-composer], textarea');
                                  ta?.focus();
                                } catch {}
                              }}
                              style={{
                                background: "transparent", border: "none", padding: "3px 4px", cursor: "pointer",
                                opacity: 0.35, color: "var(--atlas-muted)",
                                lineHeight: 1, transition: "opacity 140ms, color 140ms",
                              }}
                              onMouseEnter={e => { e.currentTarget.style.opacity = "0.75"; e.currentTarget.style.color = "var(--atlas-gold)"; }}
                              onMouseLeave={e => { e.currentTarget.style.opacity = "0.35"; e.currentTarget.style.color = "var(--atlas-muted)"; }}
                            >
                              <svg width="11" height="11" viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
                                <path d="M9.5 2.5l2 2L4 12H2v-2L9.5 2.5z" />
                              </svg>
                            </button>
                            {msg.createdAt && (
                              <div style={{ fontFamily: "var(--app-font-mono)", fontSize: "var(--ts-xs)", letterSpacing: "0.08em", color: "var(--atlas-muted)", opacity: 0.45, textTransform: "lowercase", marginRight: 4 }}>
                                {formatMessageTime(msg.createdAt)}
                              </div>
                            )}
                          </div>
                        </div>
                        )}
                    </div>
                    </Fragment>
                  ))}

                  {/* Thinking indicator — only before first token arrives.
                      Once the streaming assistant message has content, that
                      bubble renders its own ATLAS label + text, so this
                      standalone block would duplicate (two ATLAS rows with
                      Thinking… stuck below the text). */}
                  {isAtlasStreaming && !nexusChat.messages.some(m => (m as any).streaming && m.content && m.content.length > 0) && (
                    <div style={{ display: "flex", flexDirection: "row", alignItems: "flex-start", gap: 6, animation: "fadeIn 200ms ease forwards" }}>
                      <div style={{ minWidth: 0 }}>
                        <div style={{ fontSize: "var(--ts-xs)", fontFamily: "var(--app-font-mono)", letterSpacing: "0.1em", textTransform: "uppercase", color: "var(--atlas-gold)", opacity: 0.4, marginBottom: 6 }}>
                          Atlas
                        </div>
                        <div style={{ display: "flex", alignItems: "flex-start", gap: 8 }}>
                          <LoadingSpinner size="sm" color="atlas" />
                          <span
                            style={{
                              fontFamily: "var(--app-font-mono)",
                              fontSize: "var(--ts-micro)",
                              color: "var(--atlas-muted)",
                              letterSpacing: "0.07em",
                              opacity: 0.7,
                              animation: "fadeIn 360ms ease",
                              display: "inline-block",
                            }}
                          >
                            {HOME_PENDING_PHRASES[pendingPhraseIdx]}
                          </span>
                        </div>
                      </div>
                    </div>
                  )}

                  {showScrollBtn && (
                    <button
                      onClick={() => chatScrollRef.current?.scrollTo({ top: chatScrollRef.current.scrollHeight, behavior: "smooth" })}
                      aria-label="Scroll to latest"
                      style={{
                        position: "sticky",
                        bottom: 12,
                        left: "100%",
                        transform: "translateX(-100%)",
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
                        zIndex: 10,
                        flexShrink: 0,
                      }}
                    >
                      <svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
                        <path d="M8 3v10M4 9l4 4 4-4"/>
                      </svg>
                    </button>

                  )}
                  <div ref={messagesEndRef} />

                </div>
              </div>
            )}
          </div>

          {/* Continuity strip — moved below; anchors above quick-action pills */}

          {/* Input shell */}
          <div style={{ position: "relative", zIndex: 200, isolation: "isolate", flexShrink: 0, display: globalInsightOpen ? "none" : undefined }}>
          <div ref={globalInsightOpen ? globalInsightComposerRef : null} className="atlas-input-shell" style={{
            position: globalInsightOpen ? "relative" : "sticky",
            left: globalInsightOpen ? undefined : 0,
            right: globalInsightOpen ? undefined : 0,
            bottom: globalInsightOpen ? undefined : 0,
            padding: globalInsightOpen
              ? "12px 0 0"
              : "14px 20px calc(14px + env(safe-area-inset-bottom, 0px))",
            flexShrink: 0,
            zIndex: globalInsightOpen ? 1 : 250,
            pointerEvents: "auto",
            background: "transparent",
            maxWidth: globalInsightOpen ? undefined : 680,
            margin: globalInsightOpen ? 0 : undefined,
          }}>
  
   {/* Hidden file input — uses id so label can trigger it natively on mobile */}
            <input
              ref={fileInputRef}
              id="home-file-input"
              type="file"
              accept="*/*"
              style={{ position: "absolute", width: "1px", height: "1px", opacity: 0, pointerEvents: "none", overflow: "hidden" }}
              multiple
              onChange={(e) => {
                const incoming = Array.from(e.target.files ?? []);
                const combined = [...attachedFiles, ...incoming].slice(0, 10);
                if (incoming.length + attachedFiles.length > 10) {
                  toast("Max 10 items at a time");
                }
                setAttachedFiles(combined);
                e.target.value = "";
              }}
            />


            {/* Project focus picker sheet */}
            {showFocusPicker && (
              <>
                <div onClick={() => setShowFocusPicker(false)} style={{ position: "fixed", inset: 0, zIndex: 9998, background: "rgba(0,0,0,0.5)", backdropFilter: "blur(4px)" }} />
                <div style={{ position: "fixed", bottom: 0, left: 0, right: 0, zIndex: 9999, background: "var(--atlas-surface)", border: "1px solid var(--atlas-border)", borderRadius: "16px 16px 0 0", padding: "16px 0 32px", maxHeight: "60vh", overflowY: "auto", boxShadow: "0 -8px 32px rgba(0,0,0,0.4)" }}>
                  <div style={{ padding: "4px 16px 10px", fontFamily: "var(--app-font-mono)", fontSize: 9, letterSpacing: "0.12em", color: "var(--atlas-muted)", textTransform: "uppercase", opacity: 0.6 }}>Focus a project</div>
                  {(projects ?? []).filter((p: any) => p.status !== "shaping" && p.status !== "archived").map((p: any) => (
                    <button
                      key={p.id}
                      onClick={() => handleHomeFocusSelect(p.id)}
                      style={{ width: "100%", display: "flex", alignItems: "center", gap: 10, padding: "10px 16px", background: "transparent", border: "none", cursor: "pointer", color: "var(--atlas-fg)", textAlign: "left", fontFamily: "var(--app-font-sans)", fontSize: 14 }}
                    >
                      <span style={{ width: 7, height: 7, borderRadius: "50%", background: "rgba(201,162,76,0.45)", flexShrink: 0 }} />
                      {p.name}
                    </button>
                  ))}
                </div>
              </>
            )}

            {/* Attached files preview strip */}
            {attachedFiles.length > 0 && (
              <div style={{ display: "flex", gap: 6, marginBottom: 10, overflowX: "auto", paddingBottom: 2, flexShrink: 0 }}>
                {attachedFiles.map((file, idx) => (
                  <div key={idx} style={{ position: "relative", flexShrink: 0 }}>
                    {file.type.startsWith("image/") ? (
                      <img
                        src={filePreviewUrls.current.get(file)}
                        alt={file.name}
                        style={{ width: 54, height: 54, borderRadius: 7, objectFit: "cover", border: "1px solid rgba(201,162,76,0.25)", display: "block" }}
                      />
                    ) : (
                      <div style={{ width: 54, height: 54, borderRadius: 7, background: "rgba(201,162,76,0.07)", border: "1px solid rgba(201,162,76,0.2)", display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", gap: 3, overflow: "hidden" }}>
                        <svg width="16" height="16" viewBox="0 0 16 16" fill="none"><path d="M13 7.5l-5.5 5.5a4 4 0 01-5.66-5.66l6-6a2.5 2.5 0 013.54 3.54l-6 6a1 1 0 01-1.42-1.42l5.5-5.5" stroke="rgba(201,162,76,0.6)" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round" /></svg>
                        <span style={{ fontSize: "var(--ts-tiny)", color: "rgba(201,162,76,0.55)", maxWidth: 46, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", fontFamily: "var(--app-font-mono)", letterSpacing: "0.06em" }}>{file.name.split(".").pop()?.toUpperCase() ?? "FILE"}</span>
                      </div>
                    )}
                    <button
                      onClick={() => setAttachedFiles(prev => prev.filter((_, i) => i !== idx))}
                      aria-label="Remove attachment"
                      style={{ position: "absolute", top: -6, right: -6, width: 18, height: 18, borderRadius: "50%", background: "rgba(8,8,10,0.92)", border: "1px solid rgba(201,162,76,0.32)", cursor: "pointer", color: "var(--atlas-fg)", fontSize: 10, lineHeight: 1, display: "flex", alignItems: "center", justifyContent: "center", padding: 0, zIndex: 2 }}
                    >×</button>
                  </div>
                ))}
              </div>
            )}

            <div style={{
              position: "relative",
              borderRadius: 14,
              padding: (inputFocused || hasInput || attachedFiles.length > 0) ? "12px 14px" : 0,
              background: (inputFocused || hasInput || attachedFiles.length > 0)
                ? "rgba(20,16,10,0.32)"
                : "transparent",
              border: "1px solid",
              borderColor: (inputFocused || hasInput || attachedFiles.length > 0)
                ? "rgba(212,175,55,0.45)"
                : "rgba(212,175,55,0)",
              boxShadow: (inputFocused || hasInput || attachedFiles.length > 0)
                ? "inset 0 0 22px rgba(212,175,55,0.08), 0 0 18px rgba(212,175,55,0.06)"
                : "none",
              backdropFilter: (inputFocused || hasInput || attachedFiles.length > 0) ? "blur(6px)" : "none",
              transition: "border-color 200ms ease-in-out, box-shadow 200ms ease-in-out, background 200ms ease-in-out, padding 200ms ease-in-out",
            }}>
              {!hasInput && !inputFocused && (nexusChat.messages.length === 0 || globalInsightOpen) && (
                <div
                  style={{
                    position: "absolute",
                    top: 0,
                    left: 0,
                    right: 44,
                    zIndex: 2,
                    color: "var(--atlas-muted)",
                    fontSize: "var(--ts-h3)",
                    lineHeight: 1.55,
                    opacity: typewriterPaused ? 0.4 : 0.65,
                    cursor: "text",
                    display: "-webkit-box",
                    WebkitLineClamp: 2,
                    WebkitBoxOrient: "vertical",
                    overflow: "hidden",
                    fontFamily: "var(--app-font-sans)",
                    transition: "opacity 160ms ease",
                    pointerEvents: "none",
                  }}
                >
                  {globalInsightOpen ? "Ask the global view..." : placeholder}
                  {!globalInsightOpen && !typewriterPaused && <span className="atlas-cursor" />}
                </div>
              )}
              <textarea
                ref={textareaRef}
                value={input}
                onChange={(e) => {
                  const nextInput = e.target.value;
                  setInput(nextInput);
                  if (!nextInput.trim()) thinkOutLoudInlineRef.current = false;
                  autoResize();
                  if (createError) setCreateError(null);
                }}
                onKeyDown={handleKeyDown}
                onFocus={() => { setInputFocused(true); setTypewriterPaused(true); }}
                onBlur={() => setInputFocused(false)}
                rows={2}
                style={{
                  width: "100%",
                  background: "transparent",
                  border: "none",
                  outline: "none",
                  color: "var(--atlas-fg)",
                  fontSize: "var(--ts-h3)",
                  lineHeight: 1.6,
                  resize: "none",
                  fontFamily: "var(--app-font-sans)",
                  position: "relative",
                  zIndex: 1,
                  minHeight: 52,
                  maxHeight: 160,
                  overflowY: "hidden",
                  display: "block",
                }}
              />
            </div>

            {/* Bottom action bar — hidden at rest, fades in when the surface anchors */}
            <div style={{
              display: "flex", alignItems: "center", marginTop: 12, gap: 2, position: "relative",
              opacity: (inputFocused || hasInput || attachedFiles.length > 0) ? 1 : 0,
              pointerEvents: (inputFocused || hasInput || attachedFiles.length > 0) ? "auto" : "none",
              transition: "opacity 200ms ease-in-out",
            }}>
              <div style={{ display: "flex", alignItems: "center", gap: 4, flex: 1, justifyContent: "flex-start", minWidth: 0 }}>

              {/* Global Insight history — gold clock pill. Always visible so
                  users can resume any prior Global Insight thread from the
                  home composer, even on a fresh page load. Separate from the
                  workspace/projects browser so the home chat isn't lost. */}
              <button
                type="button"
                title="Where were we? · Resume Global Insight"
                aria-label="Open Global Insight history"
                onClick={() => { void handleOpenHistory(); }}
                onFocus={(e) => {
                  e.currentTarget.style.color = "var(--atlas-gold)";
                  e.currentTarget.style.boxShadow = "0 0 0 3px rgba(212,175,55,0.12)";
                }}
                onBlur={(e) => {
                  e.currentTarget.style.color = "rgba(212,175,55,0.85)";
                  e.currentTarget.style.boxShadow = "none";
                }}
                onMouseEnter={(e) => {
                  e.currentTarget.style.color = "var(--atlas-gold)";
                  e.currentTarget.style.background = "rgba(212,175,55,0.16)";
                }}
                onMouseLeave={(e) => {
                  e.currentTarget.style.color = "rgba(212,175,55,0.85)";
                  e.currentTarget.style.background = "rgba(212,175,55,0.10)";
                }}
                style={{
                  width: 34,
                  height: 34,
                  minWidth: 34,
                  minHeight: 34,
                  flexShrink: 0,
                  display: "inline-flex",
                  alignItems: "center",
                  justifyContent: "center",
                  borderRadius: 999,
                  background: "rgba(212,175,55,0.10)",
                  border: "1px solid rgba(212,175,55,0.28)",
                  color: "rgba(212,175,55,0.85)",
                  cursor: "pointer",
                  transition: "color 160ms ease, background 160ms ease, box-shadow 160ms ease",
                  WebkitTapHighlightColor: "transparent",
                  padding: 0,
                  marginRight: 2,
                }}
              >
                <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round">
                  <circle cx="12" cy="12" r="9" />
                  <polyline points="12 7 12 12 15 14" />
                </svg>
              </button>

              <ComposerActions
                scope="home"
                hasProjectContext={false}
                borderless={true}
                hasAttachments={attachedFiles.length > 0}
                onFiles={(files) => {
                  const combined = [...attachedFiles, ...files].slice(0, 10);
                  if (files.length + attachedFiles.length > 10) toast("Max 10 items at a time");
                  setAttachedFiles(combined);
                }}
                onSketch={(prompt) => { void nexusChat.send({ text: prompt }); }}
                onMenuAction={(action) => {
                  if (action === "history") { setShowTimeTravel(true); return; }
                  if (action === "settings") { setLocation("/account"); return; }
                  // Project-scoped items: route the user to the projects list so
                  // whatever they pick up at home (attachments, intent) carries
                  // into the same workspace. Keeps home + workspace menus identical.
                  if (action === "code") { setLocation("/code"); return; }
                  if (action === "connectors") { setLocation("/connectors"); return; }
                  if (action === "files" || action === "share" ||
                      action === "publish" ||
                      action === "more:forge") { setLocation("/projects"); return; }
                  toast("Open a project to use that");
                }}
              />



              </div>

              {/* Mic + Send — pinned to right via auto left margin */}
              <div style={{ display: "flex", alignItems: "center", gap: 4, marginLeft: "auto" }}>
                {/* Mic + waveform */}
                <button
                  title={isListening ? "Stop listening" : "Voice input"}
                  onClick={toggleVoice}
                  style={{
                    height: 32, borderRadius: 8, border: "none",
                    background: isListening ? "rgba(201,162,76,0.08)" : "transparent",
                    color: isListening ? "var(--atlas-gold)" : "rgba(120,113,108,0.45)", cursor: "pointer",
                    display: "flex", alignItems: "center", justifyContent: "center", gap: 5,
                    padding: "0 8px", transition: "color 160ms ease, background 160ms ease", flexShrink: 0,
                  }}
                  onMouseEnter={(e) => { if (!isListening) e.currentTarget.style.color = "var(--atlas-fg)"; }}
                  onMouseLeave={(e) => { if (!isListening) e.currentTarget.style.color = "rgba(120,113,108,0.45)"; }}
                >
                  <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
                    <rect x="9" y="2" width="6" height="11" rx="3" />
                    <path d="M5 10a7 7 0 0014 0" />
                    <line x1="12" y1="19" x2="12" y2="23" />
                    <line x1="8" y1="23" x2="16" y2="23" />
                  </svg>
                  <div className={`atlas-waveform${isListening ? " is-active" : ""}`} style={{ color: "var(--atlas-gold)" }}>
                    <span /><span /><span />
                  </div>
                </button>

                {/* Send */}
                <button
                  className="atlas-send-btn"
                  type="button"
                  // Fire on pointerdown so a mobile tap submits BEFORE the textarea
                  // blurs and the virtual keyboard reflows the layout (which used to
                  // cause the synthesized click to land on a different element).
                  onPointerDown={(e) => {
                    e.preventDefault();
                    e.stopPropagation();
                    if (!isSending && canSubmitNow()) void handleSubmit();
                  }}
                  onClick={(e) => {
                    // Desktop fallback (no pointer events / keyboard activation)
                    if (e.detail === 0) void handleSubmit();
                  }}
                  disabled={isSending}
                  style={{
                    width: 40, height: 40, flexShrink: 0,
                    background: "transparent",
                    border: "none",
                    boxShadow: "none",
                    padding: 0,
                    opacity: isSending ? 0.5 : 1,
                    touchAction: "none",
                    display: "inline-flex",
                    alignItems: "center",
                    justifyContent: "center",
                  }}
                >
                  {isSending ? (
                    <LoadingSpinner size="sm" color="ember" />
                  ) : (
                    <svg viewBox="0 0 20 20" width={18} height={18}
                      fill="none"
                      stroke={canSubmit ? "var(--atlas-gold)" : "var(--atlas-muted)"}
                      strokeWidth={1.6} strokeLinecap="round" strokeLinejoin="round"
                      style={{
                        filter: canSubmit ? "drop-shadow(0 0 6px rgba(201,162,76,0.45))" : "none",
                        transition: "stroke 160ms ease, filter 160ms ease",
                      }}
                    >
                      <path d="M2.5 10L17 3 13 17l-3.5-5.5z" />
                      <path d="M17 3 9.5 11.5" />
                    </svg>
                  )}
                </button>
              </div>
            </div>
          </div>
          </div>

          {/* Intent row — soft orientation under the input. Permission, not features. */}

          {nexusChat.messages.length === 0 && (() => {
            const pickStarter = (starter: string, inlineOnHome = false) => {
              thinkOutLoudInlineRef.current = inlineOnHome;
              setInput(starter);
              // Do NOT focus the textarea — that opens the mobile keyboard.
              // Let the user tap the input themselves when they've picked a line.
              setTimeout(() => {
                autoResize();
              }, 0);
            };

            const intents: Array<{ label: string; action: () => void; premium?: boolean }> = [
              { label: "Where were we", action: () => setShowBriefingPanel(true), premium: true },
              { label: "Think out loud", action: () => pickStarter(THINK_OUT_LOUD_STARTER, true) },
              { label: "Untangle something", action: () => pickStarter("Something's tangled and I can't quite see the shape of it. Here's what I know: ") },
              { label: "Weigh a decision", action: () => pickStarter("I'm trying to decide between ") },
            ];
            const rotate = () => {
              const next = (starterIdx + 1) % PLACEHOLDERS.length;
              setStarterIdx(next);
              pickStarter(PLACEHOLDERS[next].replace(/…$/, ""));
            };
            return (
              <div className="ambient-suggestion-chips-wrap" style={{
                marginTop: 20,
                display: "flex",
                flexDirection: "column",
                alignItems: "center",
                gap: 10,
                position: "relative",
                zIndex: 20,
                transform: "translateY(-20px)",
              }}>

                <div className="suggestion-chips-row" style={{
                  display: "flex",
                  flexWrap: "nowrap",
                  justifyContent: "center",
                  alignItems: "center",
                  gap: 6,
                  fontFamily: "var(--app-font-sans)",
                  fontSize: "var(--ts-label)",
                  letterSpacing: "0.01em",
                  color: "var(--atlas-muted)",
                  paddingInline: 8,
                  width: "100%",
                  maxWidth: "100%",
                  position: "relative",
                  zIndex: 20,
                }}>
                  {intents.map((it) => {
                    const premium = it.premium;
                    // Light-mode (parchment) gold = richer amber, dark-mode = neon gold
                    const premiumBg = isParchment
                      ? "linear-gradient(135deg, rgba(217,119,6,0.12), rgba(180,83,9,0.06))"
                      : "linear-gradient(135deg, rgba(212,175,55,0.22), rgba(201,162,76,0.10))";
                    const premiumBorder = isParchment ? "1px solid rgba(180,83,9,0.45)" : "1px solid rgba(212,175,55,0.55)";
                    const premiumColor = isParchment ? "rgba(146,64,14,1)" : "rgba(245,215,130,1)";
                    const premiumShadow = isParchment
                      ? "0 2px 8px rgba(217,119,6,0.15)"
                      : "0 0 0 1px rgba(212,175,55,0.18), 0 0 14px rgba(212,175,55,0.22)";
                    const premiumShadowHover = isParchment
                      ? "0 4px 14px rgba(217,119,6,0.22)"
                      : "0 0 0 1px rgba(212,175,55,0.32), 0 0 22px rgba(212,175,55,0.4)";
                    const restBg = isParchment ? "rgba(255,255,255,0.55)" : "rgba(255,255,255,0.025)";
                    const restBorder = isParchment ? "1px solid rgba(17,17,17,0.10)" : "1px solid rgba(212,175,55,0.18)";
                    const restColor = isParchment ? "rgba(64,64,64,0.92)" : (globalInsightOpen ? "rgba(245,215,130,1)" : "rgba(212,175,55,0.78)");
                    const restColorHover = isParchment ? "rgba(23,23,23,1)" : "rgba(245,215,130,1)";
                    return (
                    <span key={it.label} style={{ display: "inline-flex", alignItems: "center", flex: "1 1 0", minWidth: 0, justifyContent: "center" }}>
                      <button
                        type="button"
                        onClick={it.action}
                        style={{
                          background: premium ? premiumBg : restBg,
                          border: premium ? premiumBorder : restBorder,
                          backdropFilter: isParchment && !premium ? "blur(8px)" : (premium && !globalInsightOpen ? "blur(8px)" : "none"),
                          borderRadius: 999,
                          padding: "6px 10px",
                          width: "100%",
                          minWidth: 0,
                          color: premium ? premiumColor : restColor,
                          cursor: "pointer",
                          fontFamily: "inherit",
                          fontSize: "clamp(10px, 2.8vw, var(--ts-caption))",
                          letterSpacing: "inherit",
                          fontWeight: premium ? 600 : 500,
                          whiteSpace: "nowrap",
                          overflow: "hidden",
                          textOverflow: "ellipsis",
                          boxShadow: premium ? premiumShadow : "none",
                          transition: "color 160ms ease, box-shadow 160ms ease, border-color 160ms ease, background 160ms ease",
                        }}
                        onMouseEnter={(e) => {
                          const el = e.currentTarget as HTMLButtonElement;
                          if (premium) {
                            el.style.boxShadow = premiumShadowHover;
                            return;
                          }
                          el.style.color = restColorHover;
                        }}
                        onMouseLeave={(e) => {
                          const el = e.currentTarget as HTMLButtonElement;
                          if (premium) {
                            el.style.boxShadow = premiumShadow;
                            return;
                          }
                          el.style.color = restColor;
                        }}
                      >
                        {it.label}
                      </button>
                    </span>
                    );
                  })}
                </div>
                <button
                  type="button"
                  onClick={rotate}
                  aria-label="Suggest a starting point"
                  style={{
                    background: "transparent",
                    border: "none",
                    padding: "2px 6px",
                    color: isParchment ? "rgba(146,64,14,0.95)" : "rgba(212,175,55,0.6)",
                    cursor: "pointer",
                    fontFamily: "var(--app-font-sans)",
                    fontSize: "var(--ts-caption)",
                    letterSpacing: "0.01em",
                    fontWeight: isParchment ? 600 : 400,
                    display: "inline-flex",
                    alignItems: "center",
                    gap: 6,
                    transition: "color 160ms ease",
                  }}
                  onMouseEnter={(e) => { (e.currentTarget as HTMLButtonElement).style.color = isParchment ? "rgba(120,53,15,1)" : "rgba(212,175,55,0.95)"; }}
                  onMouseLeave={(e) => { (e.currentTarget as HTMLButtonElement).style.color = isParchment ? "rgba(146,64,14,0.95)" : "rgba(212,175,55,0.6)"; }}
                >
                  <span className="atlas-pulse-dot" style={{ width: 6, height: 6, borderRadius: "50%", background: isParchment ? "rgba(146,64,14,0.7)" : "rgba(212,175,55,0.7)", display: "inline-block" }} />
                  need a starting point?
                  <span style={{ fontSize: "var(--ts-label)", color: "inherit", display: "inline-block" }}>↻</span>
                </button>
              </div>
            );
          })()}



          {/* Continuity strip — status + expand CTA anchored below the suggestion chips */}
          {!globalInsightOpen && projects && projects.length > 0 && (() => {
            const activeProjects = (projects as Project[]).filter((p: Project) => p.status !== "archived");
            const mostRecent = [...activeProjects].sort((a, b) => {
              const at = new Date((a as any).updatedAt ?? a.createdAt ?? 0).getTime();
              const bt = new Date((b as any).updatedAt ?? b.createdAt ?? 0).getTime();
              return bt - at;
            })[0];
            const lastTs = mostRecent ? new Date((mostRecent as any).updatedAt ?? mostRecent.createdAt ?? Date.now()).getTime() : null;
            const formatAgo = (ts: number) => {
              const diff = Math.max(0, Date.now() - ts);
              const m = Math.floor(diff / 60000);
              if (m < 1) return "just now";
              if (m < 60) return `${m}m ago`;
              const h = Math.floor(m / 60);
              if (h < 24) return `${h}h ago`;
              const d = Math.floor(h / 24);
              return `${d}d ago`;
            };
            const lastTouched = lastTs ? formatAgo(lastTs) : null;
            return (
              <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 10, marginTop: 14 }}>
                {/* Static status pill — data only */}
                <div
                  style={{
                    display: "inline-flex",
                    alignItems: "center",
                    justifyContent: "center",
                    flexWrap: "wrap",
                    gap: 8,
                    padding: "6px 14px",
                    background: isParchment ? "rgba(255,255,255,0.55)" : "rgba(28,25,23,0.35)",
                    border: isParchment ? "1px solid rgba(17,17,17,0.06)" : "1px solid rgba(255,255,255,0.04)",
                    borderRadius: 999,
                    backdropFilter: "blur(6px)",
                    boxSizing: "border-box",
                    maxWidth: "100%",
                  }}
                >
                  <span style={{ position: "relative", width: 6, height: 6, flexShrink: 0 }}>
                    <span style={{ position: "absolute", inset: 0, borderRadius: "50%", background: isParchment ? "rgba(60,60,60,0.35)" : "rgba(201,162,76,0.5)", animation: "atlas-pulse 2.4s ease-in-out infinite" }} />
                    <span style={{ position: "absolute", inset: 1, borderRadius: "50%", background: isParchment ? "rgba(40,40,40,0.85)" : "var(--atlas-gold)", opacity: 0.9 }} />
                  </span>
                  <span style={{ fontSize: "clamp(9px, 2.4vw, var(--ts-xs))", fontFamily: "var(--app-font-mono)", letterSpacing: "0.14em", textTransform: "uppercase", color: isParchment ? "rgba(50,45,40,0.85)" : "var(--atlas-muted)", opacity: 0.9, textAlign: "center", lineHeight: 1.4, overflowWrap: "anywhere" }}>
                    {lastTouched ? <>last touched {lastTouched}</> : <>{activeProjects.length} in motion</>}
                    &nbsp;·&nbsp; <span style={{ color: isParchment ? "rgba(17,17,17,0.95)" : "var(--atlas-fg)", fontWeight: isParchment ? 600 : 500, opacity: 0.85 }}>{activeProjects.length} open</span>
                  </span>
                </div>

                {/* Subtle scroll hint — mobile only; dashboard sits right below */}
                <button
                  type="button"
                  aria-label="Scroll to overview"
                  className="atlas-home-scroll-hint"
                  onClick={() => {
                    const el = document.getElementById("atlas-home-overview");
                    if (el) el.scrollIntoView({ behavior: "smooth", block: "start" });
                    else window.scrollBy({ top: window.innerHeight * 0.7, behavior: "smooth" });
                  }}
                  style={{
                    display: "inline-flex",
                    alignItems: "center",
                    justifyContent: "center",
                    width: 28,
                    height: 28,
                    marginTop: 2,
                    background: "transparent",
                    border: "none",
                    cursor: "pointer",
                    color: isParchment ? "rgba(120,52,8,0.55)" : "rgba(201,162,76,0.55)",
                    animation: "atlasScrollHintBob 2.2s ease-in-out infinite",
                  }}
                >
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
                    <polyline points="6 9 12 15 18 9" />
                  </svg>
                </button>
              </div>
            );
          })()}


          {/* Inline create error (kept for in-flow context) */}
          {createError && (
            <div style={{
              marginTop: 8, padding: "6px 12px", borderRadius: 5, fontSize: "var(--ts-caption)",
              background: "rgba(146,64,14,0.1)",
              border: "0.5px solid rgba(146,64,14,0.35)",
              color: "var(--atlas-ember)",
              fontFamily: "var(--app-font-mono)",
              lineHeight: 1.4,
            }}>
              {createError}
            </div>
          )}

          {/* Floating create-error banner — always visible above the dock */}
          {createError && (
            <div
              role="alert"
              aria-live="assertive"
              style={{
                position: "fixed",
                left: 12,
                right: 12,
                bottom: "calc(env(safe-area-inset-bottom, 0px) + 96px)",
                zIndex: 260,
                padding: "10px 14px",
                borderRadius: 10,
                display: "flex",
                alignItems: "center",
                gap: 10,
                background: "rgba(40,16,8,0.96)",
                border: "1px solid rgba(var(--atlas-gold-rgb),0.35)",
                color: "var(--atlas-ember)",
                fontFamily: "var(--app-font-mono)",
                fontSize: "var(--ts-caption)",
                lineHeight: 1.4,
                boxShadow: "0 12px 32px rgba(0,0,0,0.55)",
                backdropFilter: "blur(8px)",
              }}
            >
              <span style={{ flex: 1, minWidth: 0 }}>{createError}</span>
              <button
                type="button"
                onClick={() => setCreateError(null)}
                aria-label="Dismiss error"
                style={{
                  flexShrink: 0,
                  width: 24, height: 24, borderRadius: 12,
                  border: "1px solid rgba(var(--atlas-gold-rgb),0.3)",
                  background: "transparent",
                  color: "var(--atlas-ember)",
                  cursor: "pointer",
                  display: "flex", alignItems: "center", justifyContent: "center",
                  fontSize: 14, lineHeight: 1,
                }}
              >
                ×
              </button>
            </div>
          )}


          {/* Gradient fade — clipped to hero, fades bottom into background */}
          <div aria-hidden style={{
            position: "absolute", bottom: 0, left: 0, right: 0,
            height: 56, pointerEvents: "none", zIndex: 1,
            background: "linear-gradient(to bottom, transparent, var(--atlas-bg))",
          }} />

          </div>{/* end hero */}

          </>}
        />

        {!globalInsightOpen && (
          <aside className="atlas-home-desktop-overview" aria-label="Overview">
            <div className="atlas-home-desktop-overview-scroll">
              {renderOverviewDashboard()}
            </div>
          </aside>
        )}
      </div>

      <GlobalInsightSurface
        open={globalInsightOpen}
        messages={nexusChat.messages as any}
        projects={(projects ?? []).map((p: Project) => ({ id: p.id, name: p.name }))}
        conversationId={activeConversationId}
        input={input}
        setInput={setInput}
        hasAttachments={attachedFiles.length > 0}
        onSubmit={() => {
          const result = handleSubmit(undefined, { forceStayOnHome: true });
          setInput("");
          return result;
        }}
        isSending={isSending}
        isStreaming={isAtlasStreaming}
        pendingPhrase={HOME_PENDING_PHRASES[pendingPhraseIdx]}
        liveStep={nexusChat.liveStep}
        isListening={isListening}
        toggleVoice={toggleVoice}
        onOpenHistory={handleOpenHistory}
        onExit={handleLockTap}
        onCreateProject={performCreateProjectFromConversation}
        onAddAsset={() => fileInputRef.current?.click()}
        onMore={() => setShowDrawer(true)}
        onFiles={(files) => {
          const combined = [...attachedFiles, ...files].slice(0, 10);
          if (files.length + attachedFiles.length > 10) toast("Max 10 items at a time");
          setAttachedFiles(combined);
        }}
        onSketch={(prompt) => { void nexusChat.send({ text: prompt }); }}
        attachedFiles={attachedFiles}
        onRemoveFile={(idx) => setAttachedFiles(prev => prev.filter((_, i) => i !== idx))}
        onMenuAction={(action) => {
          if (action === "history") { setShowTimeTravel(true); return; }
          if (action === "settings") { setLocation("/account"); return; }
          if (action === "code") { setLocation("/code"); return; }
          if (action === "connectors") { setLocation("/connectors"); return; }
          if (action === "files" || action === "share" ||
              action === "publish" ||
              action === "more:forge") { setLocation("/projects"); return; }
          toast("Open a project to use that");
        }}
      />

      {/* Below-the-fold: Recent Activity / Discovery section — hidden in Global Insight mode */}
      {!globalInsightOpen && (
        <div id="atlas-home-overview" className="atlas-home-tablet-overview" style={{ display: "flex", flexDirection: "column", alignItems: "center", padding: "8px 24px 140px" }}>
          <div style={{ display: "flex", alignItems: "center", width: "100%", gap: 12, marginBottom: 14 }}>
            <div style={{ flex: 1, height: 1, background: "linear-gradient(to right, transparent, rgba(180,83,9,0.18), transparent)" }} />
          </div>
          {renderOverviewDashboard()}
        </div>
      )}

      {showBriefingPanel && (
        <div
          style={{ position: "fixed", inset: 0, zIndex: 500, display: "flex", justifyContent: "flex-end" }}
          onClick={() => setShowBriefingPanel(false)}
        >
          <div style={{ position: "absolute", inset: 0, background: "var(--atlas-bg)", opacity: 0.4 }} />
          <div
            onClick={e => e.stopPropagation()}
            style={{
              position: "relative",
              width: "min(420px, 92vw)",
              maxHeight: "100vh",
              background: "var(--atlas-surface)",
              borderLeft: "1px solid var(--atlas-border)",
              padding: "20px 18px",
              overflowY: "auto",
              animation: "fadeIn 200ms ease forwards",
            }}
          >
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 14 }}>
              <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                <Briefcase size={13} strokeWidth={1.75} color="var(--atlas-gold)" />
                <span style={{ fontSize: "var(--ts-micro)", fontFamily: "var(--app-font-mono)", letterSpacing: "0.12em", color: "var(--atlas-gold)", textTransform: "uppercase", opacity: 0.8 }}>
                  Briefing
                </span>
              </div>
              <button
                onClick={() => setShowBriefingPanel(false)}
                style={{ background: "transparent", border: "none", color: "var(--atlas-muted)", cursor: "pointer", fontSize: "var(--ts-h2)", lineHeight: 1, padding: 4 }}
                aria-label="Close briefing"
              >
                ×
              </button>
            </div>
            {briefingLoading ? (
              <div style={{ fontSize: "var(--ts-label)", color: "var(--atlas-muted)", fontFamily: "var(--app-font-mono)", opacity: 0.6 }}>
                Atlas is preparing your briefing…
              </div>
            ) : briefing ? (
              <p style={{ margin: 0, fontSize: "var(--ts-body)", color: "var(--atlas-fg)", lineHeight: 1.6, fontFamily: "var(--app-font-sans)", opacity: 0.9, whiteSpace: "pre-wrap" }}>
                {briefing}
              </p>
            ) : (
              <p style={{ margin: 0, fontSize: "var(--ts-label)", color: "var(--atlas-muted)", fontStyle: "italic", opacity: 0.6 }}>
                No briefing available yet.
              </p>
            )}
          </div>
        </div>
      )}

      <SessionHistorySheet
        open={showHistory}
        onClose={() => setShowHistory(false)}
        title="GLOBAL INSIGHT · HISTORY"
        loading={historyLoading}
        emptyHint="No saved Global Insight threads yet. Start a conversation above — it will appear here."
        items={conversations.map((c) => ({
          id: c.id,
          title: c.title || "Untitled thread",
          msgCount: c.messageCount ?? 0,
          timestamp: c.createdAt ?? null,
          active: c.id === activeConversationId,
        }))}
        onNew={() => {
          setShowHistory(false);
          handleNewConversation();
          setGlobalInsightOpen(true);
          setDepth("active");
        }}
        onSelect={(id) => handleSwitchConversation(String(id))}
        onDelete={(id) => handleDeleteConversation(String(id))}
      />


      {showInvite && <InviteModal onClose={() => setShowInvite(false)} />}
      {showProfile && <AccountHubPanel onClose={() => setShowProfile(false)} />}
      {showUpgrade && <UpgradeModal onClose={() => setShowUpgrade(false)} reason="project_limit" />}
      <NewProjectModal
        open={showNewProjectModal}
        onClose={() => { setShowNewProjectModal(false); setCreateError(null); }}
        onCreate={(name, repo) => performCreateProject(name, repo)}
        creating={createProject.isPending}
        error={createError}
      />


      {showProjectsSheet && (
        <ProjectsGridSheet
          projects={(projects ?? []).map((p: Project) => ({ id: p.id, name: p.name, description: p.description, latestSnapshotScore: p.latestSnapshotScore ?? null }))}
          onOpenProject={(id) => { setShowProjectsSheet(false); navigateToProject(id); }}
          onNewProject={() => {
            setShowProjectsSheet(false);
            handleNewProject("New Project");
          }}
          onClose={() => setShowProjectsSheet(false)}
        />
      )}

      {/* Right-edge timeline rail (ticks per assistant message, long-press for timeframe jump) */}
      <TimelineRail messages={(nexusChat.messages as HomeMessage[]).map(m => ({ role: m.role, createdAt: m.createdAt, hasSurfacedMemory: !!(m.surfacedMemoriesCount && m.surfacedMemoriesCount > 0), text: m.content }))} />

      {/* Projects Drawer (slide-in menu) */}
      <ProjectsDrawer
        open={showDrawer}
        onClose={() => setShowDrawer(false)}
        projects={(projects ?? []).map((p: Project) => ({ id: p.id, name: p.name, description: p.description, latestSnapshotScore: p.latestSnapshotScore ?? null, status: (p as { status?: "shaping" | "committed" | "archived" }).status }))}
        onOpenProject={navigateToProject}
        onNewProject={() => { setShowDrawer(false); handleNewProject("New Project"); }}
        onOpenLedger={(id) => setLocation(`/ledger/${id}`)}
        onOpenParking={() => setLocation("/parking")}
        onOpenQuickPrompt={() => { setShowDrawer(false); setShowQuickPrompt(true); }}
        userLabel={(() => { try { const r = localStorage.getItem("atlas-user-profile"); return r ? JSON.parse(r).name || null : null; } catch { return null; } })()}
      />

      {showVault && (
        <VisualVault
          projectId={homeFocus ?? undefined}
          onClose={() => setShowVault(false)}
        />
      )}


      {showQuickPrompt && (
        <TheForge
          defaultTab="prompt"
          projectId={homeFocus ?? undefined}
          activeProjectName={homeFocus ? (projects?.find(p => p.id === homeFocus)?.name ?? undefined) : undefined}
          onClose={() => setShowQuickPrompt(false)}
        />
      )}

      {/* Time-travel sheet (History | Bookmarks) — opened from composer More → History */}
      <HistoryBookmarksSheet
        projectId={homeFocus ?? 0}
        open={showTimeTravel}
        onClose={() => setShowTimeTravel(false)}
      />





      {/* Fixed 5-item bottom nav — true flex row, even spacing */}
      <style>{`
        @keyframes homePurpleAtmosphere {
          0%, 100% { opacity: 0.45; }
          50%       { opacity: 1; }
        }
        @keyframes ptr-spin { to { transform: rotate(360deg); } }
        @keyframes spin { to { transform: rotate(360deg); } }
        @keyframes fadeIn { from { opacity: 0; transform: translateY(6px); } to { opacity: 1; transform: translateY(0); } }
        @keyframes ping {
          75%, 100% { transform: scale(1.8); opacity: 0; }
        }
        @keyframes atlasTokenShimmer {
          from { background-position: 160% 50%; }
          to   { background-position: -60% 50%; }
        }
        .atlas-streaming-word-shimmer {
          --atlas-token-shimmer-base: color-mix(in oklab, var(--atlas-gold) 78%, var(--atlas-fg));
          --atlas-token-shimmer-glint: color-mix(in oklab, white 76%, var(--atlas-gold));
          display: inline-block;
          color: transparent;
          background-image: linear-gradient(105deg, var(--atlas-token-shimmer-base) 0%, var(--atlas-token-shimmer-base) 34%, var(--atlas-token-shimmer-glint) 50%, var(--atlas-token-shimmer-base) 66%, var(--atlas-token-shimmer-base) 100%);
          background-size: 220% 100%;
          -webkit-background-clip: text;
          background-clip: text;
          text-shadow: 0 0 12px color-mix(in oklab, var(--atlas-gold) 26%, transparent);
          animation: atlasTokenShimmer 600ms linear infinite;
        }
        [data-theme="parchment"] .atlas-streaming-word-shimmer {
          --atlas-token-shimmer-base: color-mix(in oklab, var(--atlas-muted) 74%, var(--atlas-fg));
          --atlas-token-shimmer-glint: color-mix(in oklab, var(--atlas-gold) 30%, #f6f1ea);
          text-shadow: 0 0 8px rgba(139,94,60,0.12);
        }
        .atlas-home-thought-card:hover {
          border-color: color-mix(in oklab, var(--atlas-gold) 24%, var(--atlas-border));
        }
        @keyframes homeAxiomPulse {
          0%, 100% {
            box-shadow:
              0 0 0 2px rgba(212,175,55,0.55),
              0 0 10px 2px rgba(212,175,55,0.20),
              0 0 28px 6px rgba(212,175,55,0.08);
          }
          50% {
            box-shadow:
              0 0 0 2px rgba(212,175,55,0.90),
              0 0 16px 4px rgba(212,175,55,0.38),
              0 0 44px 12px rgba(212,175,55,0.14);
          }
        }
        .atlas-home-chat-messages-scroll::-webkit-scrollbar {
          display: none;
        }
        @keyframes atlasOverviewSheetUp {
          from { transform: translateY(100%); }
          to   { transform: translateY(0); }
        }
        @keyframes atlasOverviewSheetDown {
          from { transform: translateY(0); }
          to   { transform: translateY(100%); }
        }
        .atlas-home-chat-column {
          width: 100%;
          display: flex;
          justify-content: center;
          min-width: 0;
        }
        .atlas-home-desktop-overview {
          display: none;
        }
        .atlas-overview-sheet-layer {
          position: fixed;
          inset: 0;
          z-index: 220;
          display: flex;
          align-items: flex-end;
        }
        .atlas-overview-scrim {
          position: absolute;
          inset: 0;
          background: rgba(0,0,0,0.5);
        }
        .atlas-overview-bottom-sheet {
          position: relative;
          width: 100%;
          height: 78dvh;
          background: var(--atlas-bg);
          border: 1px solid var(--atlas-border);
          border-bottom: none;
          border-radius: 20px 20px 0 0;
          display: flex;
          flex-direction: column;
          animation: atlasOverviewSheetUp 300ms ease-out both;
        }
        .atlas-overview-bottom-sheet.is-closing {
          animation: atlasOverviewSheetDown 250ms ease-in both;
        }
        .atlas-overview-sheet-handle {
          width: 40px;
          height: 4px;
          border-radius: 999px;
          background: var(--atlas-border);
          margin: 12px auto 8px;
          flex-shrink: 0;
        }
        .atlas-overview-sheet-scroll {
          flex: 1;
          min-height: 0;
          overflow-y: auto;
          padding: 0 16px max(20px, env(safe-area-inset-bottom));
        }
        .atlas-overview-sheet-scroll > .atlas-below-fold-dashboard {
          max-width: none !important;
          padding-bottom: 0 !important;
        }
        @keyframes atlasScrollHintBob {
          0%, 100% { transform: translateY(0); opacity: 0.6; }
          50%      { transform: translateY(3px); opacity: 1; }
        }
        @media (min-width: 768px) {
          .atlas-home-scroll-hint {
            display: none !important;
          }
          .atlas-overview-sheet-layer {
            display: none;
          }
        }

        @media (min-width: 1024px) {
          /* Hero stays a centered single column — chat down the middle */
          .atlas-home-responsive-shell {
            width: 100%;
            max-width: none;
            margin: 0 auto;
            display: block !important;
            grid-template-columns: none !important;
            justify-content: initial !important;
          }
          .atlas-home-chat-column {
            justify-content: stretch;
          }
          .atlas-home-chat-inner {
            max-width: 768px !important;
            margin: 0 auto;
            padding-bottom: 48px !important;
          }
          /* Right-aside dashboard removed on desktop — moved below the fold */
          .atlas-home-desktop-overview {
            display: none !important;
          }
          .atlas-home-bottom-nav {
            display: none !important;
          }
          /* Show below-fold dashboard, expanded to wide grid */
          .atlas-home-tablet-overview {
            display: flex !important;
            max-width: 1400px;
            margin: 0 auto;
            padding: 8px 32px 140px !important;
          }
          .atlas-home-tablet-overview > .atlas-below-fold-dashboard {
            max-width: none !important;
            padding-bottom: 24px !important;
            display: grid !important;
            grid-template-columns: repeat(12, minmax(0, 1fr));
            grid-auto-flow: row dense;
            column-gap: 24px;
            row-gap: 24px;
          }
          /* Divider spans full width */
          .atlas-home-tablet-overview > .atlas-below-fold-dashboard > div:not(.bfd-col-left):not(.bfd-col-right) {
            grid-column: 1 / -1;
          }
          .bfd-col-left  { grid-column: span 8; }
          .bfd-col-right { grid-column: span 4; }
        }

      `}</style>
      <div className="atlas-home-bottom-nav">
        <UnifiedContextDock
          mode="ambient"
          onAtlasCore={() => window.scrollTo({ top: 0, behavior: "smooth" })}
          onHome={() => window.scrollTo({ top: 0, behavior: "smooth" })}
          onProjects={() => setShowProjectsSheet(true)}
          onDecisions={() => setLocation("/ledger")}
          onYou={() => setShowProfile(true)}
          onMap={() => setLocation("/map")}
          onFiles={() => setShowDrawer(true)}
          onForge={() => setShowQuickPrompt(true)}
        />
      </div>

      {/* Desktop left rail (lg+ only) — persistent navigation surface */}
      <nav
        aria-label="Primary"
        style={{
          position: "fixed",
          top: 16,
          left: 16,
          bottom: 16,
          width: 56,
          display: "none",
          flexDirection: "column",
          alignItems: "center",
          gap: 6,
          padding: "12px 0",
          background: "color-mix(in oklab, var(--atlas-bg) 70%, transparent)",
          border: "1px solid color-mix(in oklab, var(--atlas-fg) 8%, transparent)",
          borderRadius: 14,
          backdropFilter: "blur(12px)",
          zIndex: 40,
        }}
        className="atlas-home-desktop-rail"
      >
        {[
          { label: "Projects", onClick: () => setShowProjectsSheet(true), icon: (
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"><rect x="3" y="5" width="18" height="14" rx="2"/><line x1="9" y1="5" x2="9" y2="19"/></svg>
          )},
          { label: "Decisions", onClick: () => setLocation("/ledger"), icon: (
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="10"/><path d="M2 12h20"/></svg>
          )},
          { label: "Map", onClick: () => setLocation("/map"), icon: (
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="2"/><circle cx="4" cy="4" r="1.5"/><circle cx="20" cy="4" r="1.5"/><circle cx="4" cy="20" r="1.5"/><circle cx="20" cy="20" r="1.5"/></svg>
          )},
          { label: "Parking", onClick: () => setLocation("/parking"), icon: (
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"><rect x="4" y="4" width="16" height="16" rx="2"/><path d="M10 16V8h3a2.5 2.5 0 010 5h-3"/></svg>
          )},
          { label: "Profile", onClick: () => setShowProfile(true), icon: (
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"><path d="M20 21v-2a4 4 0 00-4-4H8a4 4 0 00-4 4v2"/><circle cx="12" cy="7" r="4"/></svg>
          )},
        ].map((item) => (
          <button
            key={item.label}
            onClick={item.onClick}
            title={item.label}
            aria-label={item.label}
            style={{
              width: 40, height: 40, display: "flex", alignItems: "center", justifyContent: "center",
              background: "transparent", border: "none", color: "var(--atlas-muted)",
              cursor: "pointer", borderRadius: 10, opacity: 0.7, transition: "opacity 150ms, background 150ms, color 150ms",
            }}
            onMouseEnter={(e) => { e.currentTarget.style.opacity = "1"; e.currentTarget.style.color = "var(--atlas-fg)"; e.currentTarget.style.background = "color-mix(in oklab, var(--atlas-fg) 6%, transparent)"; }}
            onMouseLeave={(e) => { e.currentTarget.style.opacity = "0.7"; e.currentTarget.style.color = "var(--atlas-muted)"; e.currentTarget.style.background = "transparent"; }}
          >
            {item.icon}
          </button>
        ))}
      </nav>
      <style>{`@media (min-width: 1024px) { .atlas-home-desktop-rail { display: flex !important; } }`}</style>
    </div>
  );
}

function OverviewBottomSheet({
  closing,
  onClose,
  children,
}: {
  closing: boolean;
  onClose: () => void;
  children: ReactNode;
}) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const touchStartYRef = useRef<number | null>(null);
  const touchStartScrollTopRef = useRef(0);

  return (
    <div className="atlas-overview-sheet-layer" role="presentation">
      <div className="atlas-overview-scrim" onClick={onClose} />
      <section
        className={`atlas-overview-bottom-sheet${closing ? " is-closing" : ""}`}
        role="dialog"
        aria-modal="true"
        aria-label="Overview"
        onClick={(e) => e.stopPropagation()}
        onTouchStart={(e) => {
          touchStartYRef.current = e.touches[0]?.clientY ?? null;
          touchStartScrollTopRef.current = scrollRef.current?.scrollTop ?? 0;
        }}
        onTouchEnd={(e) => {
          const startY = touchStartYRef.current;
          if (startY === null) return;
          const endY = e.changedTouches[0]?.clientY ?? startY;
          if (endY - startY > 70 && touchStartScrollTopRef.current <= 0) {
            onClose();
          }
          touchStartYRef.current = null;
        }}
      >
        <div className="atlas-overview-sheet-handle" aria-hidden />
        <div ref={scrollRef} className="atlas-overview-sheet-scroll">
          {children}
        </div>
      </section>
    </div>
  );
}

// ── Projects Grid Sheet ───────────────────────────────────────────────────────
type SheetProject = { id: number; name: string; description?: string | null; latestSnapshotScore?: number | null };

function ProjectsGridSheet({
  projects,
  onOpenProject,
  onNewProject,
  onClose,
}: {
  projects: SheetProject[];
  onOpenProject: (id: number) => void;
  onNewProject: () => void;
  onClose: () => void;
}) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [onClose]);

  const COLORS = ["#92400E", "#1e3a5f", "#1a3a2a", "#3b1f4e", "#3b2a0e", "#1f3b3b"];
  const ICONS = [
    <path key="a" d="M9 12l2 2 4-4M7.835 4.697a3.42 3.42 0 001.946-.806 3.42 3.42 0 014.438 0 3.42 3.42 0 001.946.806 3.42 3.42 0 013.138 3.138 3.42 3.42 0 00.806 1.946 3.42 3.42 0 010 4.438 3.42 3.42 0 00-.806 1.946 3.42 3.42 0 01-3.138 3.138 3.42 3.42 0 00-1.946.806 3.42 3.42 0 01-4.438 0 3.42 3.42 0 00-1.946-.806 3.42 3.42 0 01-3.138-3.138 3.42 3.42 0 00-.806-1.946 3.42 3.42 0 010-4.438 3.42 3.42 0 00.806-1.946 3.42 3.42 0 013.138-3.138z" />,
    <path key="b" d="M13 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V9z M13 2v7h7" />,
    <g key="c"><circle cx="12" cy="12" r="3"/><path d="M19.07 4.93a10 10 0 010 14.14M4.93 4.93a10 10 0 000 14.14"/></g>,
    <path key="d" d="M3 9l9-7 9 7v11a2 2 0 01-2 2H5a2 2 0 01-2-2z M9 22V12h6v10" />,
    <g key="e"><rect x="2" y="3" width="20" height="14" rx="2"/><path d="M8 21h8M12 17v4"/></g>,
    <path key="f" d="M12 2L2 7l10 5 10-5-10-5zM2 17l10 5 10-5M2 12l10 5 10-5" />,
  ];

  return (
    <>
      {/* Scrim */}
      <div
        onClick={onClose}
        style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.55)", backdropFilter: "blur(4px)", zIndex: 200 }}
      />

      {/* Sheet — slides up from bottom */}
      <div
        style={{
          position: "fixed", left: 0, right: 0, bottom: 0,
          zIndex: 201,
          background: "var(--atlas-surface)",
          borderTop: "1px solid rgba(212,175,55,0.18)",
          borderRadius: "20px 20px 0 0",
          maxHeight: "80dvh",
          display: "flex", flexDirection: "column",
          animation: "projectSheetSlideUp 220ms cubic-bezier(0.32,0.72,0,1) both",
        }}
      >
        <style>{`
          @keyframes projectSheetSlideUp {
            from { transform: translateY(100%); opacity: 0.5; }
            to   { transform: translateY(0);    opacity: 1; }
          }
        `}</style>

        {/* Handle */}
        <div style={{ display: "flex", justifyContent: "center", padding: "12px 0 4px" }}>
          <div style={{ width: 36, height: 4, borderRadius: 2, background: "rgba(120,113,108,0.35)" }} />
        </div>

        {/* Header */}
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "8px 20px 12px" }}>
          <span style={{ fontFamily: "var(--app-font-mono)", fontSize: "var(--ts-caption)", fontWeight: 700, letterSpacing: "0.12em", textTransform: "uppercase", color: "var(--atlas-gold)" }}>
            Projects
          </span>
          <button
            onClick={onClose}
            style={{ background: "none", border: "none", cursor: "pointer", color: "rgba(120,113,108,0.6)", fontSize: "var(--ts-display)", lineHeight: 1, padding: 4 }}
          >
            ×
          </button>
        </div>

        {/* Grid */}
        <div style={{ overflowY: "auto", padding: "0 16px 32px", flex: 1 }}>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>

            {/* New Project card */}
            <button
              onClick={onNewProject}
              style={{
                background: "none", border: "1px dashed rgba(212,175,55,0.3)", borderRadius: 14,
                cursor: "pointer", padding: 0, overflow: "hidden", textAlign: "left",
                transition: "border-color 160ms",
              }}
              onMouseEnter={(e) => (e.currentTarget.style.borderColor = "rgba(212,175,55,0.65)")}
              onMouseLeave={(e) => (e.currentTarget.style.borderColor = "rgba(212,175,55,0.3)")}
            >
              <div style={{ height: 90, background: "rgba(212,175,55,0.04)", display: "flex", alignItems: "center", justifyContent: "center" }}>
                <span style={{ fontSize: "var(--ts-display-lg)", color: "rgba(212,175,55,0.45)", lineHeight: 1 }}>+</span>
              </div>
              <div style={{ padding: "10px 12px 12px" }}>
                <p style={{ margin: 0, fontFamily: "var(--app-font-sans)", fontSize: "var(--ts-label)", fontWeight: 600, color: "rgba(212,175,55,0.7)" }}>New Project</p>
                <p style={{ margin: "3px 0 0", fontFamily: "var(--app-font-mono)", fontSize: "var(--ts-xs)", color: "rgba(120,113,108,0.5)", letterSpacing: "0.05em" }}>Start fresh</p>
              </div>
            </button>

            {/* Project cards */}
            {projects.map((p, i) => {
              const bg = COLORS[i % COLORS.length];
              const icon = ICONS[i % ICONS.length];
              const initials = p.name.split(" ").slice(0, 2).map(w => w[0]?.toUpperCase() ?? "").join("");
              return (
                <button
                  key={p.id}
                  onClick={() => onOpenProject(p.id)}
                  style={{
                    background: "none", border: "1px solid var(--atlas-glass-bg)", borderRadius: 14,
                    cursor: "pointer", padding: 0, overflow: "hidden", textAlign: "left",
                    transition: "border-color 160ms, transform 120ms",
                  }}
                  onMouseEnter={(e) => { e.currentTarget.style.borderColor = "rgba(212,175,55,0.3)"; e.currentTarget.style.transform = "scale(1.02)"; }}
                  onMouseLeave={(e) => { e.currentTarget.style.borderColor = "var(--atlas-glass-bg)"; e.currentTarget.style.transform = "scale(1)"; }}
                >
                  {/* Colored thumbnail with subtle grid texture */}
                  <div style={{ height: 90, background: bg, display: "flex", alignItems: "center", justifyContent: "center", position: "relative", overflow: "hidden" }}>
                    <div style={{
                      position: "absolute", inset: 0, opacity: 0.12,
                      backgroundImage: "linear-gradient(rgba(255,255,255,0.4) 1px, transparent 1px), linear-gradient(90deg, rgba(255,255,255,0.4) 1px, transparent 1px)",
                      backgroundSize: "14px 14px",
                    }} />
                    <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="rgba(255,255,255,0.55)" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" style={{ position: "relative", zIndex: 1 }}>
                      {icon}
                    </svg>
                    <div style={{ position: "absolute", top: 8, right: 8, fontFamily: "var(--app-font-mono)", fontSize: "var(--ts-xs)", fontWeight: 700, letterSpacing: "0.08em", color: "rgba(255,255,255,0.5)" }}>
                      {initials}
                    </div>
                  </div>
                  <div style={{ padding: "10px 12px 12px" }}>
                    <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8, marginBottom: 2 }}>
                      <p style={{ margin: 0, fontFamily: "var(--app-font-sans)", fontSize: "var(--ts-label)", fontWeight: 600, color: "var(--atlas-fg)", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis", flex: 1, minWidth: 0 }}>
                        {p.name}
                      </p>
                      <CompactReadinessRing score={p.latestSnapshotScore ?? 0} />
                    </div>
                    <p style={{ margin: 0, fontFamily: "var(--app-font-mono)", fontSize: "var(--ts-xs)", color: "var(--atlas-muted)", letterSpacing: "0.05em", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
                      {p.description ?? "No description"}
                    </p>
                  </div>
                </button>
              );
            })}

          </div>
        </div>

        {/* Footer — manage link */}
        <div style={{ flexShrink: 0, borderTop: "1px solid rgba(120,113,108,0.15)", padding: "12px 20px", paddingBottom: "max(12px, env(safe-area-inset-bottom))" }}>
          <button
            onClick={() => { onClose(); window.location.href = "/projects"; }}
            style={{
              width: "100%", padding: "11px 0", borderRadius: 10,
              background: "transparent", border: "1px solid rgba(201,162,76,0.25)",
              cursor: "pointer", fontFamily: "var(--app-font-mono)", fontSize: "var(--ts-caption)",
              fontWeight: 700, letterSpacing: "0.1em", textTransform: "uppercase",
              color: "var(--atlas-gold)", transition: "all 160ms ease",
            }}
            onMouseEnter={(e) => { e.currentTarget.style.background = "rgba(201,162,76,0.08)"; e.currentTarget.style.borderColor = "rgba(201,162,76,0.5)"; }}
            onMouseLeave={(e) => { e.currentTarget.style.background = "transparent"; e.currentTarget.style.borderColor = "rgba(201,162,76,0.25)"; }}
          >
            Manage all projects →
          </button>
        </div>
      </div>
    </>
  );
}
