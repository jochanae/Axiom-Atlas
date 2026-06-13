/**
 * GlobalInsightSurface — standalone Global Insight chat surface.
 *
 * Owns its own fixed-overlay layout, isolated scroll container, and a
 * minimal composer. No `globalInsightOpen` ternaries, no shared scroll
 * with the ambient home shell. Renders only when `open` is true.
 *
 * Layout invariants:
 *   - Fixed positioning below the page header (--atlas-header-height)
 *   - Scroll lives ONLY inside `.atlas-global-insight-scroll`
 *   - Composer is pinned to the bottom edge (above the safe-area inset)
 */
import { useEffect, useRef, useState } from "react";
import { useLocation } from "wouter";
import { useThemeMode } from "@/lib/theme";
import { GenesisCard } from "./GenesisCard";
import { GlobalInsightRenderer } from "./GlobalInsightRenderer";

export type GlobalInsightMessage = {
  role: "user" | "assistant";
  content: string;
  kind?: "genesis";
  genesisData?: { projectName: string; timestamp: string };
  streaming?: boolean;
  createdAt?: string;
};

export type GlobalInsightLiveStep = {
  verb: string;
  target?: string | null;
  status?: "ok" | "warn" | "fail" | string;
} | null;

type GlobalInsightProject = {
  id: number;
  name: string;
};

interface Props {
  open: boolean;
  messages: GlobalInsightMessage[];
  projects: GlobalInsightProject[];
  conversationId?: string | null;
  input: string;
  setInput: (v: string) => void;
  onSubmit: () => void | Promise<void>;
  isSending: boolean;
  isStreaming: boolean;
  pendingPhrase: string;
  liveStep?: GlobalInsightLiveStep;
  isListening: boolean;
  toggleVoice: () => void;
  onOpenHistory: () => void | Promise<void>;
  onExit: () => void;
  onCreateProject?: () => void;
  onAddAsset?: () => void;
  onMore?: () => void;
}

const GLOBAL_INSIGHT_PLACEHOLDERS = [
  "Ask the global view…",
  "What's conflicting across projects…",
  "Which project is most worth doing next…",
  "Where are decisions stalling…",
  "What pattern keeps repeating…",
];

const PROJECT_OPEN_INTENT_RE = /\b(go|jump|open|workspace|inside)\b|\binto\s+that\b/i;
const NAVIGATE_TO_RE = /\bNAVIGATE_TO:\s*(\{[^\n]+\})/;

type NavigateTarget = { projectId: number; projectName: string } | null;

function extractNavigateTo(content: string): { target: NavigateTarget; cleanContent: string } {
  const match = content.match(NAVIGATE_TO_RE);
  if (!match) return { target: null, cleanContent: content };
  try {
    const parsed = JSON.parse(match[1]) as { projectId?: unknown; projectName?: unknown };
    if (typeof parsed.projectId === "number" && typeof parsed.projectName === "string") {
      const cleanContent = content.replace(NAVIGATE_TO_RE, "").replace(/\n{3,}/g, "\n\n").trim();
      return { target: { projectId: parsed.projectId, projectName: parsed.projectName }, cleanContent };
    }
  } catch {}
  return { target: null, cleanContent: content };
}

function escapeRegExp(value: string) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function findProjectOpenTarget(content: string, projects: GlobalInsightProject[]) {
  if (!PROJECT_OPEN_INTENT_RE.test(content)) return null;

  for (const project of projects) {
    const name = project.name.trim();
    if (!name) continue;
    const nameRe = new RegExp(`(^|[^a-z0-9])${escapeRegExp(name)}(?=$|[^a-z0-9])`, "i");
    if (nameRe.test(content)) return project;
  }

  return null;
}

// Mirror of home.tsx's useTypewriter — same cadence so the surface feels native.
function useTypewriter(phrases: string[], paused: boolean) {
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

    timer = setTimeout(tick, 600);
    return () => clearTimeout(timer);
  }, [paused]);

  return display;
}

export function GlobalInsightSurface({
  open,
  messages,
  projects,
  conversationId,
  input,
  setInput,
  onSubmit,
  isSending,
  isStreaming,
  pendingPhrase,
  liveStep,
  isListening,
  toggleVoice,
  onOpenHistory,
  onExit,
  onCreateProject,
  onAddAsset,
  onMore,
}: Props) {
  const scrollRef = useRef<HTMLDivElement | null>(null);
  const textareaRef = useRef<HTMLTextAreaElement | null>(null);
  const [, setLocation] = useLocation();
  const [focused, setFocused] = useState(false);
  const [copiedIdx, setCopiedIdx] = useState<number | null>(null);
  const isParchment = useThemeMode() === "parchment";

  // Auto-scroll on new messages / streaming
  useEffect(() => {
    if (!open) return;
    const el = scrollRef.current;
    if (!el) return;
    el.scrollTo({ top: el.scrollHeight, behavior: "smooth" });
  }, [open, messages.length, isStreaming]);

  const hasInput = input.length > 0;
  const showPlaceholder = open && !hasInput && !focused && messages.length === 0;
  const typed = useTypewriter(GLOBAL_INSIGHT_PLACEHOLDERS, !showPlaceholder);

  if (!open) return null;

  const canSubmit = input.trim().length > 0 && !isSending;

  const handleSubmit = () => {
    if (!canSubmit) return;
    void onSubmit();
  };

  const handleProjectOpen = async (projectId: number) => {
    const route = `/project/${projectId}`;

    try {
      await fetch("/api/nexus/handoff", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({
          messages: messages.slice(-10),
          projectId,
          conversationId,
        }),
      });
    } catch {
      // Handoff is best-effort; navigation should still feel immediate on failure.
    }

    setLocation(route);
  };

  const handleCopy = (content: string, idx: number) => {
    void navigator.clipboard.writeText(content).then(() => {
      setCopiedIdx(idx);
      setTimeout(() => setCopiedIdx(null), 1800);
    });
  };

  const handleKey = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      handleSubmit();
    }
  };

  const pickStarter = (starter: string) => {
    setInput(starter);
    requestAnimationFrame(() => {
      const el = textareaRef.current;
      if (!el) return;
      el.style.height = "0px";
      el.style.height = `${Math.min(el.scrollHeight, 140)}px`;
    });
  };

  const intents: Array<{ label: string; action: () => void; premium?: boolean }> = [
    { label: "Where were we", action: () => void onOpenHistory(), premium: true },
    { label: "Think out loud", action: () => pickStarter("Think out loud about this with me: ") },
    { label: "Untangle something", action: () => pickStarter("Something's tangled and I can't quite see the shape of it. Here's what I know: ") },
    { label: "Weigh a decision", action: () => pickStarter("I'm trying to decide between ") },
  ];

  return (
    <div
      className="atlas-global-insight-surface"
      role="dialog"
      aria-label="Global Insight"
      style={{
        position: "fixed",
        top: "var(--atlas-header-height, 56px)",
        left: 0,
        right: 0,
          bottom: "var(--atlas-dock-height, 64px)",
        display: "flex",
        flexDirection: "column",
        background: "var(--atlas-bg)",
        zIndex: 60,
        overscrollBehavior: "contain",
        touchAction: "none",
      }}
    >
        <button
          type="button"
          onClick={onExit}
          aria-label="New conversation"
          style={{
            position: "absolute",
            top: 10,
            right: 12,
            width: 32,
            height: 32,
            borderRadius: 999,
            background: "transparent",
            border: "1px solid rgba(212,175,55,0.2)",
            color: "var(--atlas-gold)",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            cursor: "pointer",
            WebkitTapHighlightColor: "transparent",
            zIndex: 2,
          }}
        >
          <svg width="13" height="13" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
            <path d="M8 2v12M2 8h12" />
          </svg>
        </button>

      {/* Isolated scroll container */}
      <div
        ref={scrollRef}
        className="atlas-global-insight-scroll"
        style={{
          flex: 1,
          minHeight: 0,
          overflowY: "auto",
          overflowX: "hidden",
          overscrollBehavior: "contain",
          WebkitOverflowScrolling: "touch",
          touchAction: "pan-y",
          padding: "18px 20px 24px",
          display: "flex",
          flexDirection: "column",
          gap: 16,
          scrollbarWidth: "none",
          msOverflowStyle: "none",
        }}
      >
        <div
          style={{
            alignSelf: "center",
            paddingTop: 4,
            paddingInline: 36,
            fontSize: 10,
            color: "var(--atlas-gold)",
            opacity: 0.68,
            fontFamily: "var(--app-font-mono)",
            letterSpacing: "0.12em",
            textTransform: "uppercase",
            textAlign: "center",
          }}
        >
          Global Insight · All projects
        </div>

        {messages.length === 0 && (
          <div
            style={{
              minHeight: "calc(100% - 12px)",
              display: "flex",
              flexDirection: "column",
              alignItems: "center",
              justifyContent: "center",
              gap: 16,
              paddingBottom: 24,
            }}
          >
            <p
              style={{
                margin: 0,
                fontSize: "clamp(22px, 6vw, 30px)",
                lineHeight: 1.2,
                fontWeight: 300,
                color: "var(--atlas-fg)",
                textAlign: "center",
              }}
            >
              Ask across every project.
            </p>

            <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 10, width: "100%", maxWidth: 420 }}>
              <div style={{ display: "flex", alignItems: "center", gap: 8, width: "100%", minWidth: 0 }}>
                {intents.map((it) => {
                  const premium = it.premium;
                  // Theme-aware tokens
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
                  const restColor = isParchment ? "rgba(64,64,64,0.92)" : "rgba(212,175,55,0.78)";
                  const restColorHover = isParchment ? "rgba(23,23,23,1)" : "rgba(245,215,130,1)";
                  return (
                    <span key={it.label} style={{ display: "inline-flex", alignItems: "center", flex: "1 1 0", minWidth: 0, justifyContent: "center" }}>
                      <button
                        type="button"
                        onClick={it.action}
                        style={{
                          width: "100%",
                          minWidth: 0,
                          background: premium ? premiumBg : restBg,
                          border: premium ? premiumBorder : restBorder,
                          borderRadius: 999,
                          padding: "6px 10px",
                          color: premium ? premiumColor : restColor,
                          cursor: "pointer",
                          fontFamily: "var(--app-font-sans)",
                          fontSize: "clamp(10px, 2.9vw, 12px)",
                          fontWeight: premium ? 600 : 500,
                          whiteSpace: "nowrap",
                          overflow: "hidden",
                          textOverflow: "ellipsis",
                          boxShadow: premium ? premiumShadow : "none",
                          backdropFilter: isParchment && !premium ? "blur(8px)" : "none",
                          opacity: 1,
                          transition: "color 160ms ease, box-shadow 160ms ease, background 160ms ease",
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
            </div>
          </div>
        )}

        {messages.map((msg, i) => {
          if (msg.kind === "genesis" && msg.genesisData) {
            return (
              <GenesisCard
                key={i}
                projectName={msg.genesisData.projectName}
                timestamp={msg.genesisData.timestamp}
              />
            );
          }

          if (msg.role === "assistant") {
            const { target: tokenTarget, cleanContent } = extractNavigateTo(msg.content);
            const displayContent = cleanContent;
            return (
              <div key={i} style={{ display: "flex", flexDirection: "column", gap: 4 }}>
                <span
                  style={{
                    fontSize: 10,
                    fontFamily: "var(--app-font-mono)",
                    letterSpacing: "0.12em",
                    textTransform: "uppercase",
                    color: "var(--atlas-gold)",
                    opacity: 0.55,
                  }}
                >
                  Atlas
                </span>
                <div
                  style={{
                    fontSize: 16,
                    lineHeight: 1.75,
                    color: "var(--atlas-fg)",
                    fontFamily: "var(--app-font-sans)",
                    whiteSpace: "pre-wrap",
                    wordBreak: "break-word",
                    opacity: 0.92,
                  }}
                >
                  <GlobalInsightRenderer
                    content={displayContent}
                    projects={projects}
                    onNavigate={(id) => void handleProjectOpen(id)}
                    isParchment={isParchment}
                  />
                </div>
                {tokenTarget && (
                  <button
                    type="button"
                    onClick={() => void handleProjectOpen(tokenTarget.projectId)}
                    aria-label={`Open ${tokenTarget.projectName}`}
                    style={{
                      alignSelf: "flex-start",
                      marginTop: 4,
                      fontSize: 11,
                      fontFamily: "var(--app-font-mono)",
                      letterSpacing: "0.06em",
                      opacity: 0.6,
                      padding: "3px 8px",
                      border: "1px solid rgba(212,175,55,0.18)",
                      borderRadius: 6,
                      background: "transparent",
                      color: "var(--atlas-gold)",
                      cursor: "pointer",
                      lineHeight: 1.2,
                      WebkitTapHighlightColor: "transparent",
                    }}
                  >
                    → Open {tokenTarget.projectName}
                  </button>
                )}
                {!msg.streaming && displayContent.length > 0 && (
                  <button
                    type="button"
                    onClick={() => handleCopy(displayContent, i)}
                    aria-label="Copy message"
                    style={{
                      alignSelf: "flex-start",
                      marginTop: 2,
                      background: "transparent",
                      border: "none",
                      padding: "4px 2px",
                      cursor: "pointer",
                      color: copiedIdx === i ? "var(--atlas-gold)" : "var(--atlas-muted)",
                      opacity: copiedIdx === i ? 1 : 0.45,
                      display: "flex",
                      alignItems: "center",
                      gap: 4,
                      fontSize: 11,
                      fontFamily: "var(--app-font-mono)",
                      letterSpacing: "0.06em",
                      WebkitTapHighlightColor: "transparent",
                    }}
                  >
                    {copiedIdx === i ? "✓ copied" : (
                      <svg width="13" height="13" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
                        <rect x="5" y="5" width="8" height="9" rx="1.5" />
                        <path d="M11 5V4a1.5 1.5 0 00-1.5-1.5h-6A1.5 1.5 0 002 4v7A1.5 1.5 0 003.5 12.5H5" />
                      </svg>
                    )}
                  </button>
                )}
              </div>
            );
          }

          return (
            <div key={i} style={{ display: "flex", flexDirection: "column", alignItems: "flex-end", gap: 4 }}>
              <span
                style={{
                  fontSize: 10,
                  fontFamily: "var(--app-font-mono)",
                  letterSpacing: "0.12em",
                  textTransform: "uppercase",
                  color: "rgba(212,175,55,0.85)",
                  opacity: 0.65,
                }}
              >
                You
              </span>
              <div
                style={{
                  padding: "10px 14px",
                  background: "rgba(212,175,55,0.05)",
                  border: "1px solid rgba(212,175,55,0.22)",
                  borderRadius: 12,
                  maxWidth: "82%",
                  fontSize: 16,
                  lineHeight: 1.6,
                  color: "var(--atlas-fg)",
                  fontFamily: "var(--app-font-sans)",
                  whiteSpace: "pre-wrap",
                  wordBreak: "break-word",
                }}
              >
                {msg.content}
              </div>
            </div>
          );
        })}

        {isStreaming && !messages.some((m) => m.streaming && m.content.length > 0) && (
          <div style={{ display: "flex", alignItems: "center", gap: 10, opacity: 0.75 }}>
            <span
              style={{
                width: 8,
                height: 8,
                borderRadius: "50%",
                background: "var(--atlas-gold)",
                animation: "atlas-pulse 1.4s ease-in-out infinite",
              }}
            />
            <span
              style={{
                fontFamily: "var(--app-font-mono)",
                fontSize: 11,
                letterSpacing: "0.08em",
                color: "var(--atlas-muted)",
              }}
            >
              {liveStep ? `${liveStep.verb}${liveStep.target ? " " + liveStep.target : ""}` : pendingPhrase}
            </span>
          </div>
        )}
      </div>

      {/* Composer — minimal, transparent. Cursor + action row only. */}
      <div
        style={{
          flexShrink: 0,
          padding: "12px 14px calc(14px + env(safe-area-inset-bottom, 0px))",
          background: "transparent",
        }}
      >
        <div
          style={{
            position: "relative",
            display: "flex",
            flexDirection: "column",
            gap: 8,
            background: isParchment
              ? "rgba(255,255,255,0.55)"
              : "rgba(20,17,14,0.55)",
            border: isParchment
              ? "1px solid rgba(180,83,9,0.30)"
              : "1px solid rgba(212,175,55,0.32)",
            borderRadius: 16,
            padding: "10px 12px 8px",
            backdropFilter: "blur(10px)",
            WebkitBackdropFilter: "blur(10px)",
            boxShadow: isParchment
              ? "0 2px 12px rgba(146,64,14,0.08)"
              : "0 2px 14px rgba(0,0,0,0.35), 0 0 0 1px rgba(212,175,55,0.06) inset",
            transition: "border-color 200ms ease, box-shadow 200ms ease",
            minHeight: 96,
          }}
        >
          {/* Textarea row — full width, generous height */}
          <div style={{ position: "relative", flex: 1, minHeight: 56 }}>
            {showPlaceholder && (
              <div
                aria-hidden
                style={{
                  position: "absolute",
                  top: 4,
                  left: 2,
                  right: 2,
                  pointerEvents: "none",
                  color: "var(--atlas-muted)",
                  opacity: 0.55,
                  fontSize: 16,
                  lineHeight: 1.55,
                  fontFamily: "var(--app-font-sans)",
                  letterSpacing: "-0.005em",
                  whiteSpace: "nowrap",
                  overflow: "hidden",
                  textOverflow: "ellipsis",
                }}
              >
                {typed}
                <span className="atlas-cursor" />
              </div>
            )}
            <textarea
              ref={textareaRef}
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={handleKey}
              onFocus={() => setFocused(true)}
              onBlur={() => setFocused(false)}
              rows={2}
              style={{
                width: "100%",
                background: "transparent",
                border: "none",
                outline: "none",
                resize: "none",
                appearance: "none",
                WebkitAppearance: "none",
                boxShadow: "none",
                color: isParchment ? "#171717" : "var(--atlas-fg)",
                fontSize: 16,
                lineHeight: 1.55,
                letterSpacing: "-0.005em",
                fontFamily: "var(--app-font-sans)",
                padding: "4px 2px",
                minHeight: 56,
                maxHeight: 180,
                position: "relative",
                zIndex: 1,
                display: "block",
              }}
            />
          </div>

          {/* Action row — left utilities, right send cluster */}
          <div
            style={{
              display: "flex",
              alignItems: "center",
              justifyContent: "space-between",
              gap: 8,
              paddingTop: 6,
              borderTop: "none",
              marginTop: 2,
            }}
          >
            <div style={{ display: "flex", alignItems: "center", gap: 4 }}>
              <UtilityButton
                ariaLabel="Where were we"
                title="Where were we?"
                onClick={() => void onOpenHistory()}
                tinted
              >
                <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round">
                  <circle cx="12" cy="12" r="9" />
                  <polyline points="12 7 12 12 15 14" />
                </svg>
              </UtilityButton>
              {messages.length > 0 && (
                <UtilityButton
                  ariaLabel="Create project from this conversation"
                  title="Create project from this conversation"
                  onClick={() => onCreateProject?.()}
                >
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M4 6.5h5l2 2H20v9.5a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2z" />
                    <path d="M12 12v5" />
                    <path d="M9.5 14.5h5" />
                  </svg>
                </UtilityButton>
              )}
              <UtilityButton
                ariaLabel="Add asset"
                title="Add asset"
                onClick={() => onAddAsset?.()}
              >
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round">
                  <line x1="12" y1="5" x2="12" y2="19" />
                  <line x1="5" y1="12" x2="19" y2="12" />
                </svg>
              </UtilityButton>
              <UtilityButton
                ariaLabel="More options"
                title="More"
                onClick={() => onMore?.()}
              >
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round">
                  <circle cx="5" cy="12" r="1.4" />
                  <circle cx="12" cy="12" r="1.4" />
                  <circle cx="19" cy="12" r="1.4" />
                </svg>
              </UtilityButton>
            </div>

            <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
              <UtilityButton
                ariaLabel={isListening ? "Stop voice" : "Voice input"}
                onClick={toggleVoice}
                active={isListening}
              >
                <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round">
                  <rect x="9" y="2" width="6" height="11" rx="3" />
                  <path d="M5 10a7 7 0 0014 0" />
                  <line x1="12" y1="19" x2="12" y2="23" />
                  <line x1="8" y1="23" x2="16" y2="23" />
                </svg>
              </UtilityButton>
              <button
                type="button"
                onPointerDown={(e) => {
                  e.preventDefault();
                  if (canSubmit) handleSubmit();
                }}
                onClick={(e) => {
                  if (e.detail === 0) handleSubmit();
                }}
                disabled={!canSubmit}
                aria-label="Send"
                style={{
                  width: 38,
                  height: 38,
                  flexShrink: 0,
                  borderRadius: 999,
                  border: `1px solid ${canSubmit ? "rgba(212,175,55,0.55)" : "rgba(212,175,55,0.15)"}`,
                  background: canSubmit
                    ? "linear-gradient(135deg, rgba(212,175,55,0.32), rgba(201,162,76,0.16))"
                    : "rgba(255,255,255,0.02)",
                  color: canSubmit ? "rgba(245,215,130,1)" : "var(--atlas-muted)",
                  cursor: canSubmit ? "pointer" : "not-allowed",
                  display: "inline-flex",
                  alignItems: "center",
                  justifyContent: "center",
                  padding: 0,
                  opacity: isSending ? 0.55 : 1,
                  boxShadow: canSubmit ? "0 0 18px -4px rgba(212,175,55,0.45)" : "none",
                  transition: "background 200ms ease, border-color 200ms ease, box-shadow 200ms ease",
                }}
              >
                <svg viewBox="0 0 20 20" width={16} height={16} fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round">
                  <path d="M2.5 10L17 3 13 17l-3.5-5.5z" />
                  <path d="M17 3 9.5 11.5" />
                </svg>
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

function UtilityButton({
  children,
  ariaLabel,
  title,
  onClick,
  tinted,
  active,
}: {
  children: React.ReactNode;
  ariaLabel: string;
  title?: string;
  onClick?: () => void;
  tinted?: boolean;
  active?: boolean;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={ariaLabel}
      title={title ?? ariaLabel}
      style={{
        width: 34,
        height: 34,
        flexShrink: 0,
        borderRadius: 10,
        border: "1px solid transparent",
        background: active
          ? "rgba(212,175,55,0.14)"
          : tinted
            ? "rgba(212,175,55,0.06)"
            : "transparent",
        color: active
          ? "var(--atlas-gold)"
          : tinted
            ? "rgba(212,175,55,0.85)"
            : "var(--atlas-muted)",
        display: "inline-flex",
        alignItems: "center",
        justifyContent: "center",
        cursor: onClick ? "pointer" : "default",
        padding: 0,
        WebkitTapHighlightColor: "transparent",
        transition: "background 160ms ease, color 160ms ease, border-color 160ms ease",
      }}
      onMouseEnter={(e) => {
        if (!onClick) return;
        const el = e.currentTarget as HTMLButtonElement;
        el.style.background = "rgba(212,175,55,0.10)";
        el.style.color = "rgba(245,215,130,1)";
      }}
      onMouseLeave={(e) => {
        const el = e.currentTarget as HTMLButtonElement;
        el.style.background = active
          ? "rgba(212,175,55,0.14)"
          : tinted
            ? "rgba(212,175,55,0.06)"
            : "transparent";
        el.style.color = active
          ? "var(--atlas-gold)"
          : tinted
            ? "rgba(212,175,55,0.85)"
            : "var(--atlas-muted)";
      }}
    >
      {children}
    </button>
  );
}

export default GlobalInsightSurface;
