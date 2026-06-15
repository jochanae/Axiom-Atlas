import type React from "react";
import { Message } from "@workspace/api-client-react";
import { useEffect, useRef, useState } from "react";
import { ZipPanel } from "../ZipImport";
import type { ZipEntry } from "../ZipImport";
import { GenerateBlueprintPill } from "../BlueprintsTab";
import type { WorkspaceLens } from "@/hooks/useChatLens";
import type { ChatMessage } from "@/pages/workspace";
import { ComposerActions, type ComposerMenuAction } from "@/components/composer/ComposerActions";
// CaptureBar removed from composer (2026-06-09) — intake lives in ForgeIntakeSheet.


const LENS_PLACEHOLDERS: Record<WorkspaceLens, string[]> = {
  flow: [
    "What are you turning over…",
    "What's the constraint you haven't named…",
    "What would have to be true for this to work…",
    "Where did the last session leave things…",
  ],
  build: [
    "What needs to be built or fixed…",
    "What's the smallest next step…",
    "Where does this slot into the system…",
  ],
  look: [
    "What visual change do you need…",
    "What feels off in the UI…",
    "Describe the vibe you're chasing…",
  ],
  scenario: [
    "What if…",
    "What changes if this assumption flips…",
    "Walk a scenario forward — what breaks first…",
  ],
};

function useComposerTypewriter(phrases: string[], paused: boolean) {
  const [display, setDisplay] = useState("");
  const state = useRef({ phraseIdx: 0, charIdx: 0, phase: "typing" as "typing" | "erasing" });
  const phrasesRef = useRef(phrases);
  phrasesRef.current = phrases;

  useEffect(() => {
    if (paused || phrases.length === 0) { setDisplay(""); return; }
    state.current = { phraseIdx: 0, charIdx: 0, phase: "typing" };
    let timer: ReturnType<typeof setTimeout>;
    function tick() {
      const s = state.current;
      const phrase = phrasesRef.current[s.phraseIdx] ?? "";
      if (s.phase === "typing") {
        if (s.charIdx < phrase.length) {
          s.charIdx++;
          setDisplay(phrase.slice(0, s.charIdx));
          timer = setTimeout(tick, 38);
        } else {
          timer = setTimeout(() => { s.phase = "erasing"; tick(); }, 2200);
        }
      } else {
        if (s.charIdx > 0) {
          s.charIdx--;
          setDisplay(phrase.slice(0, s.charIdx));
          timer = setTimeout(tick, 22);
        } else {
          s.phraseIdx = (s.phraseIdx + 1) % phrasesRef.current.length;
          s.phase = "typing";
          timer = setTimeout(tick, 220);
        }
      }
    }
    timer = setTimeout(tick, 600);
    return () => clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [paused, phrases.join("|")]);

  return display;
}

function RotatingPlaceholder({ wsLens, hasInput, inputFocused, hasMessages }: { wsLens: WorkspaceLens; hasInput: boolean; inputFocused: boolean; hasMessages: boolean }) {
  const pool = LENS_PLACEHOLDERS[wsLens] ?? LENS_PLACEHOLDERS.flow;
  const paused = hasInput || inputFocused || hasMessages;
  const typed = useComposerTypewriter(pool, paused);
  if (paused) return null;
  return (
    <div
      aria-hidden
      style={{
        position: "absolute", top: 0, left: 2,
        color: "var(--atlas-muted)", fontSize: 14, lineHeight: 1.6,
        opacity: 0.6, pointerEvents: "none",
        fontFamily: "var(--app-font-sans)",
      }}
    >
      {typed || pool[0]}
    </div>
  );
}

export interface ChatComposerProps {
  // Visibility gate
  leftTab: "chat" | "diff" | "blueprints" | "terminal" | string;

  // File / image / ZIP
  fileInputRef: React.RefObject<HTMLInputElement | null>;
  processZip: (file: File) => Promise<void>;
  attachedFiles: File[];
  setAttachedFiles: React.Dispatch<React.SetStateAction<File[]>>;
  zipFiles: ZipEntry[];
  zipName: string;
  zipTruncated: boolean;
  toggleZipFile: (path: string) => void;
  setAllZip: (selected: boolean) => void;
  clearZip: () => void;

  // Server-side code-context upload
  uploadCodeContextZip: (file: File) => Promise<void>;
  codeContextStatus: { summary: string; fileCount: number } | null;
  codeContextUploading: boolean;
  clearCodeContext: () => void;

  // First-run overlay
  firstRunDismissed: boolean;
  setFirstRunDismissed: (v: boolean) => void;
  sessionsLoading: boolean;
  projectLoading: boolean;
  sessions: ReadonlyArray<unknown> | undefined;
  messages: ChatMessage[];
  entries: ReadonlyArray<unknown> | undefined;
  linkedRepo: unknown | null | undefined;
  firstRunInput: string;
  setFirstRunInput: (v: string) => void;
  sessionId: number | null;
  doSend: (
    text: string,
    sid: number,
    currentMessages: ChatMessage[],
    ctx?: string | null,
    attachments?: Array<{ base64: string; mediaType: string; name?: string }>,
  ) => void;

  // Blueprint pill
  projectId: number;
  isMobile: boolean;
  setMobileTab: (t: any) => void;
  setDesktopForceTab: (t: any) => void;

  // Textarea
  hasInput: boolean;
  hasAttachments?: boolean;
  inputFocused: boolean;
  setInputFocused: (v: boolean) => void;
  wsLens: WorkspaceLens;
  textareaRef: React.RefObject<HTMLTextAreaElement | null>;
  input: string;
  setInput: React.Dispatch<React.SetStateAction<string>>;
  autoResize: () => void;
  handleKeyDown: (e: React.KeyboardEvent<HTMLTextAreaElement>) => void;

  // Voice
  voiceSupported: boolean;
  voiceListening: boolean;
  toggleVoice: () => void;

  // Send
  chatPending: boolean;
  handleSend: (opts?: { planMode?: boolean }) => void;
  createSessionPending: boolean;
  onAbort?: () => void;

  sendPreparingSession: boolean;


  // Parking trigger
  parkedCount: number;
  showParkingDrawer: boolean;
  setShowParkingDrawer: (v: boolean) => void;
  refreshParkedEntries: () => Promise<unknown> | unknown;
  /** Proactive park-your-own-thought from the CaptureBar mounted in the composer. */
  onPark?: (content: string) => void;
  /** Forge intake — raw context dump routed straight to /api/forge. Parent owns
      the merge of returned nodes into the Flow canvas. */
  onForgeIntake?: (content: string) => Promise<void> | void;

  // Model picker (only renders chip when showModelPicker is true)
  showModelPicker?: boolean;
  wsModel?: string;
  onOpenModelSheet?: () => void;

  // Universal "..." menu action routing
  onComposerMenuAction?: (action: ComposerMenuAction) => void;

  /** Opens the unified sessions sheet (gold-clock). */
  onOpenSessionsHistory?: () => void;

  /** Manual image-generation entry point from the composer "+" sheet.
   *  Receives the composed `[SKETCH:<preset>] …` prompt — wire to doSend. */
  onSketch?: (prompt: string) => void;
}



export function ChatComposer(props: ChatComposerProps) {
  const {
    leftTab,
    fileInputRef,
    processZip,
    attachedFiles,
    setAttachedFiles,
    zipFiles,
    zipName,
    zipTruncated,
    toggleZipFile,
    setAllZip,
    clearZip,
    uploadCodeContextZip,
    codeContextStatus,
    codeContextUploading,
    clearCodeContext,
    firstRunDismissed,
    setFirstRunDismissed,
    sessionsLoading,
    projectLoading,
    sessions,
    messages,
    entries,
    linkedRepo,
    firstRunInput,
    setFirstRunInput,
    sessionId,
    doSend,
    projectId,
    isMobile,
    setMobileTab,
    setDesktopForceTab,
    hasInput,
    hasAttachments = false,
    inputFocused,
    setInputFocused,
    wsLens,
    textareaRef,
    input,
    setInput,
    autoResize,
    handleKeyDown,
    voiceSupported,
    voiceListening,
    toggleVoice,
    chatPending,
    handleSend,
    createSessionPending,
    onAbort,
    sendPreparingSession,

    parkedCount,
    showParkingDrawer,
    setShowParkingDrawer,
    refreshParkedEntries,
    onPark,
    onForgeIntake,
    showModelPicker,
    wsModel,
    onOpenModelSheet,
    onComposerMenuAction,
    onOpenSessionsHistory,
  } = props;


  const modelChipLabel = (() => {
    switch (wsModel) {
      case "claude": return "Claude";
      case "gpt4o": return "GPT-4o";
      case "gemini": return "Gemini";
      case "multi":
      default: return "Multi-Agent";
    }
  })();
  const isMultiAgent = !wsModel || wsModel === "multi";

  const [planMode, setPlanMode] = useState(false);
  const [planBannerVisible, setPlanBannerVisible] = useState(false);
  const filePreviewUrls = useRef<Map<File, string>>(new Map());
  // Intake mode lives in ForgeIntakeSheet now — composer no longer tracks it.

  const togglePlanMode = () => {
    setPlanMode(v => {
      const next = !v;
      if (next) {
        setPlanBannerVisible(true);
        window.setTimeout(() => setPlanBannerVisible(false), 1500);
      } else {
        setPlanBannerVisible(false);
      }
      try { (navigator as any).vibrate?.(10); } catch {}
      return next;
    });
  };

  

  

  // When the project is empty, focus the composer so Atlas feels "already in the room".
  // Skip on mobile to avoid yanking the keyboard up uninvited.
  useEffect(() => {
    if (isMobile) return;
    if (messages.length !== 0) return;

    const t = setTimeout(() => { textareaRef.current?.focus(); }, 120);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [messages.length, isMobile]);

  useEffect(() => {
    const current = new Set(attachedFiles);
    for (const [file, url] of filePreviewUrls.current.entries()) {
      if (!current.has(file)) {
        URL.revokeObjectURL(url);
        filePreviewUrls.current.delete(file);
      }
    }
    for (const file of attachedFiles) {
      if (file.type.startsWith("image/") && !filePreviewUrls.current.has(file)) {
        filePreviewUrls.current.set(file, URL.createObjectURL(file));
      }
    }
    return () => {
      if (attachedFiles.length === 0) {
        for (const url of filePreviewUrls.current.values()) URL.revokeObjectURL(url);
        filePreviewUrls.current.clear();
      }
    };
  }, [attachedFiles]);


  return (

    <>
      {/* Input — hidden when Terminal tab is active (terminal has its own input row) */}
      {leftTab !== "terminal" && leftTab !== "blueprints" && leftTab !== "artifacts" && <div className="atlas-composer-glass" style={{ padding: "12px 14px 14px", flexShrink: 0, position: "sticky", bottom: 0, zIndex: 30 }}>
        {/* Hidden file input — unrestricted multi-mime; used by drag-drop/legacy callers.
            Primary picker is the unified ComposerActions sheet below. */}
        <input
          ref={fileInputRef}
          id="ws-file-input"
          type="file"
          accept="*/*"
          style={{ position: "absolute", width: "1px", height: "1px", opacity: 0, overflow: "hidden" }}
          multiple
          onChange={async (e) => {
            const files = Array.from(e.target.files ?? []);
            const zipFile = files.find(f => f.name.endsWith(".zip") || f.type === "application/zip");
            const others = files.filter(f => !f.name.endsWith(".zip") && f.type !== "application/zip");
            if (zipFile) await processZip(zipFile);
            if (others.length > 0) setAttachedFiles(prev => [...prev, ...others].slice(0, 10));
            e.target.value = "";
          }}
        />

        {/* Hidden input dedicated to server-side code-context zip upload (persistent project context) */}
        <input
          id="ws-code-context-input"
          type="file"
          accept=".zip,application/zip"
          style={{ position: "absolute", width: 1, height: 1, opacity: 0, overflow: "hidden" }}
          onChange={async (e) => {
            const f = e.target.files?.[0];
            if (f) await uploadCodeContextZip(f);
            e.target.value = "";
          }}
        />




        {/* Server code-context status badge */}
        {codeContextStatus && (
          <div style={{
            display: "flex", alignItems: "center", gap: 8, marginBottom: 8,
            padding: "6px 10px", borderRadius: 8,
            background: "rgba(201,162,76,0.06)", border: "1px solid rgba(201,162,76,0.22)",
            fontSize: 11, fontFamily: "var(--app-font-mono)", color: "rgba(201,162,76,0.85)",
          }}>
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
              <path d="M21 16V8a2 2 0 00-1-1.73l-7-4a2 2 0 00-2 0l-7 4A2 2 0 003 8v8a2 2 0 001 1.73l7 4a2 2 0 002 0l7-4A2 2 0 0021 16z" />
            </svg>
            <span style={{ flex: 1, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
              {codeContextStatus.summary || `${codeContextStatus.fileCount} files loaded from zip`}
            </span>
            <button
              onClick={clearCodeContext}
              aria-label="Clear code context"
              title="Clear code context"
              style={{ background: "transparent", border: "none", cursor: "pointer", padding: "2px 4px", color: "rgba(201,162,76,0.7)", display: "flex", alignItems: "center" }}
            >
              <svg width="11" height="11" viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round">
                <path d="M2 2l10 10M12 2L2 12" />
              </svg>
            </button>
          </div>
        )}

        {/* CaptureBar + intake toggle removed (2026-06-09).
            Intake now lives in the ForgeIntakeSheet, opened from:
              • long-press on the Atlas Pulse glyph (LifecycleGlyph)
              • "+" menu → "Forge intake" (ComposerActions)
            This restores the composer to its lightweight resting state on mobile. */}

        {/* ZIP panel — shows when a ZIP is loaded */}
        {zipFiles.length > 0 && (
          <ZipPanel
            zipName={zipName}
            entries={zipFiles}
            truncated={zipTruncated}
            onToggle={toggleZipFile}
            onSelectAll={() => setAllZip(true)}
            onDeselectAll={() => setAllZip(false)}
            onClear={clearZip}
          />
        )}

        {/* First-run banner removed — empty state now lives in the conversation surface
            as a single Atlas-voiced shaping question. No wizard, no setup card. */}


        {/* Generate Blueprint pill — only surfaces when Atlas explicitly offers it */}
        {(() => {
          const assistantMsgs = messages.filter(m => m.role === "assistant");
          const last = assistantMsgs[assistantMsgs.length - 1]?.content ?? "";
          const phraseHit = /Want me to generate a blueprint|Blueprint ready|Shall I generate a blueprint/i.test(last);
          if (!phraseHit) return null;
          return (
            <GenerateBlueprintPill
              projectId={projectId}
              onCreated={() => { if (isMobile) setMobileTab("blueprints"); else setDesktopForceTab("blueprints"); }}
            />
          );
        })()}

        {/* Attachment preview strip */}
        {attachedFiles.length > 0 && (
          <div style={{ display: "flex", gap: 6, marginBottom: 8, overflowX: "auto", paddingBottom: 2, flexShrink: 0 }}>
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
                    <span style={{ fontSize: 8, color: "rgba(201,162,76,0.55)", maxWidth: 46, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", fontFamily: "var(--app-font-mono)", letterSpacing: "0.06em" }}>{file.name.split(".").pop()?.toUpperCase() ?? "FILE"}</span>
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

        {planBannerVisible && (
          <div
            role="status"
            aria-live="polite"
            style={{
              display: "flex", justifyContent: "center", alignItems: "center", gap: 6,
              marginBottom: 6,
              fontFamily: "var(--app-font-mono)",
              fontSize: 10, letterSpacing: "0.14em", textTransform: "uppercase",
              color: "var(--atlas-gold)",
              opacity: 0.85,
              animation: "fade-in 0.2s ease-out",
              pointerEvents: "none",
            }}
          >
            <span style={{
              width: 5, height: 5, borderRadius: "50%",
              background: "var(--atlas-gold)",
              boxShadow: "0 0 6px rgba(201,162,76,0.7)",
            }} />
            Plan Mode Active · Strategizing
          </div>
        )}

        <div
          className="atlas-input-shell"
          style={{
            padding: "4px 4px",
            transition: "none",
          }}
        >
          <div style={{ display: "flex", alignItems: "flex-start", gap: 6 }}>
            <div style={{ position: "relative", flex: 1 }}>
              {planMode && !hasInput ? (
                <div
                  aria-hidden
                  style={{
                    position: "absolute", top: 0, left: 2,
                    color: "var(--atlas-gold)", fontSize: 14, lineHeight: 1.6,
                    opacity: planBannerVisible ? 0.75 : 0,
                    transition: "opacity 1.5s ease-out",
                    pointerEvents: "none",
                    fontFamily: "var(--app-font-sans)",
                    fontStyle: "italic",
                  }}
                >
                  Strategizing…
                </div>
              ) : (
                <RotatingPlaceholder wsLens={wsLens} hasInput={hasInput} inputFocused={inputFocused} hasMessages={messages.length > 0} />
              )}

              <textarea
                ref={textareaRef}
                aria-label="Message Atlas"
                value={input}
                onChange={(e) => { setInput(e.target.value); autoResize(); }}
                onFocus={() => setInputFocused(true)}
                onBlur={() => setInputFocused(false)}
                onKeyDown={(e) => {
                  // Touch devices: Enter always inserts a newline (the on-screen
                  // keyboard's "return" must not submit incomplete messages).
                  const isTouch =
                    typeof window !== "undefined" &&
                    window.matchMedia?.("(pointer: coarse)").matches;
                  if (!isTouch && e.key === "Enter" && !e.shiftKey) {
                    e.preventDefault();
                    handleSend();
                  } else {
                    handleKeyDown(e);
                  }
                }}
                onPaste={(e) => {
                  // Native clipboard pasting → append image/file items to the
                  // attachment carousel (capped at 10, matches picker behavior).
                  const items = e.clipboardData?.items;
                  if (!items || items.length === 0) return;
                  const pasted: File[] = [];
                  for (let i = 0; i < items.length; i++) {
                    const it = items[i];
                    if (it.kind === "file") {
                      const f = it.getAsFile();
                      if (f) pasted.push(f);
                    }
                  }
                  if (pasted.length === 0) return;
                  // Prevent the default paste only when we captured files,
                  // so plain text pastes still work normally.
                  e.preventDefault();
                  setAttachedFiles(prev => [...prev, ...pasted].slice(0, 10));
                }}
                rows={1}
                style={{
                  width: "100%", background: "transparent", border: "none", outline: "none",
                  color: "var(--atlas-fg)", fontSize: 14, lineHeight: 1.6,
                  resize: "none", fontFamily: "var(--app-font-sans)",
                  position: "relative", zIndex: 1,
                  minHeight: 24, maxHeight: 180, overflowY: "hidden", display: "block",
                  padding: "2px 2px",
                }}
              />
            </div>
          </div>


          <div className="atlas-input-actionrow" style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginTop: 20, flexWrap: "nowrap", gap: 4 }}>


            {/* Universal composer actions: [clock] + [+] + [...] */}
            <div style={{ display: "flex", alignItems: "center", gap: 4, position: "relative" }}>
              {onOpenSessionsHistory && (
                <button
                  type="button"
                  onClick={onOpenSessionsHistory}
                  aria-label="Sessions — resume or start new"
                  title="Sessions — resume or start new"
                  style={{
                    display: "inline-flex", alignItems: "center", justifyContent: "center",
                    width: 32, height: 32, borderRadius: 999,
                    background: "color-mix(in oklab, var(--atlas-gold) 10%, transparent)",
                    border: "1px solid color-mix(in oklab, var(--atlas-gold) 28%, transparent)",
                    color: "var(--atlas-gold)",
                    cursor: "pointer",
                    flexShrink: 0,
                  }}
                >
                  <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round">
                    <circle cx="12" cy="12" r="9" />
                    <polyline points="12 7 12 12 15 14" />
                  </svg>
                </button>
              )}
              <ComposerActions
                scope="ws"
                hasProjectContext
                borderless
                hasAttachments={attachedFiles.length > 0 || zipFiles.length > 0 || !!codeContextStatus}
                onFiles={async (files) => {
                  const zipFile = files.find(f => f.name.endsWith(".zip") || f.type === "application/zip");
                  const others = files.filter(f => !f.name.endsWith(".zip") && f.type !== "application/zip");
                  if (zipFile) await processZip(zipFile);
                  if (others.length > 0) setAttachedFiles(prev => [...prev, ...others].slice(0, 10));
                }}
                onSketch={props.onSketch}
                onMenuAction={(action) => onComposerMenuAction?.(action)}
              />

            </div>



            {/* Model chip — only renders when the setting is enabled */}
            {showModelPicker && onOpenModelSheet && (
              <button
                type="button"
                onClick={onOpenModelSheet}
                title={isMultiAgent ? "Multi-Agent orchestration (default) — tap to change" : `Forced: ${modelChipLabel} — tap to change`}
                aria-label={`Model: ${modelChipLabel}`}
                style={{
                  display: "inline-flex", alignItems: "center", gap: 6,
                  padding: "6px 10px", borderRadius: 999,
                  background: "rgba(255,255,255,0.03)",
                  backdropFilter: "blur(10px) saturate(140%)",
                  border: "none",
                  color: "var(--atlas-gold)",
                  cursor: "pointer",
                  fontFamily: "var(--app-font-mono)",
                  fontSize: 10, letterSpacing: "0.08em", textTransform: "uppercase",
                  whiteSpace: "nowrap", flexShrink: 0,
                  marginLeft: 4,
                }}
              >
                <span style={{
                  width: 6, height: 6, borderRadius: "50%",
                  background: isMultiAgent ? "var(--atlas-gold)" : "var(--atlas-ember)",
                  boxShadow: isMultiAgent
                    ? "0 0 8px rgba(201,162,76,0.6)"
                    : "0 0 8px rgba(146,64,14,0.55)",
                }} />
                {modelChipLabel}
                <svg width="8" height="8" viewBox="0 0 10 10" fill="none" style={{ opacity: 0.55 }}>
                  <path d="M2 4l3 3 3-3" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" />
                </svg>
              </button>
            )}


            {/* Right: plan mode + voice input + send */}
            <div style={{ display: "flex", alignItems: "center", gap: 6, flexShrink: 0, marginLeft: "auto" }}>
              <button
                onClick={togglePlanMode}
                title="Plan mode"
                aria-label={planMode ? "Disable plan mode" : "Enable plan mode"}
                aria-pressed={planMode}
                style={{
                  minWidth: 44, minHeight: 44, padding: 7, borderRadius: 8,
                  background: planMode
                    ? "linear-gradient(135deg, rgba(201,162,76,0.28), rgba(201,162,76,0.14))"
                    : "transparent",
                  border: `1px solid ${planMode ? "rgba(201,162,76,0.55)" : "transparent"}`,
                  boxShadow: planMode ? "0 0 14px -4px rgba(201,162,76,0.55), inset 0 0 0 1px rgba(201,162,76,0.15)" : "none",
                  color: planMode ? "var(--atlas-gold)" : "var(--atlas-muted)",
                  cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center",
                  transition: "all var(--motion-fast) var(--ease-standard)", flexShrink: 0,
                }}
              >
                {/* Checklist + gold dot — Plan mode signifier */}
                <svg width="16" height="16" viewBox="0 0 20 20" fill="none" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M2.5 6L4 7.5L6.5 5" stroke="currentColor" strokeWidth="1.5" />
                  <path d="M2.5 12L4 13.5L6.5 11" stroke="currentColor" strokeWidth="1.5" />
                  <line x1="9" y1="6.5" x2="14" y2="6.5" stroke="currentColor" strokeWidth="1.5" />
                  <line x1="9" y1="12.5" x2="13" y2="12.5" stroke="currentColor" strokeWidth="1.5" />
                  <circle
                    cx="16"
                    cy="4"
                    r={planMode ? 2.4 : 2}
                    fill="#C9A24C"
                    style={{
                      filter: planMode ? "drop-shadow(0 0 4px rgba(201,162,76,0.75))" : "none",
                      transition: "all var(--motion-fast) var(--ease-standard)",
                    }}
                  />
                </svg>
              </button>
              <button
                onClick={toggleVoice}
                disabled={!voiceSupported}
                title={voiceListening ? "Stop listening" : "Voice input"}
                aria-label="Voice input"
                className={voiceListening ? "atlas-voice-active" : ""}
                style={{
                  minWidth: 44, minHeight: 44, padding: 6, borderRadius: 8,
                  background: voiceListening ? "var(--atlas-ember)" : "transparent",
                  border: `1px solid ${voiceListening ? "var(--atlas-ember)" : "transparent"}`,
                  color: voiceListening ? "var(--atlas-fg)" : "var(--atlas-muted)",
                  cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center",
                  opacity: voiceSupported ? 1 : 0.35,
                  transition: "all var(--motion-base) var(--ease-standard)", flexShrink: 0,
                }}
              >
                <svg width="13" height="13" viewBox="0 0 16 16" fill="none">
                  <rect x="5" y="1" width="6" height="9" rx="3" stroke="currentColor" strokeWidth="1.3" />
                  <path d="M2 8a6 6 0 0012 0" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" />
                  <line x1="8" y1="14" x2="8" y2="16" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" />
                </svg>
              </button>

              <button
                className="atlas-send-btn"
                onClick={() => {
                  if (chatPending && onAbort) { onAbort(); return; }
                  handleSend({ planMode });
                }}
                disabled={chatPending ? !onAbort : (!(hasInput || hasAttachments) || createSessionPending)}
                aria-label={chatPending ? "Stop generation" : sendPreparingSession ? "Preparing session" : "Send message"}
                title={chatPending ? "Stop" : "Send"}
                style={{
                  minWidth: 44, minHeight: 44, padding: 3,
                  background: chatPending
                    ? "var(--atlas-ember)"
                    : ((hasInput || hasAttachments) && !sendPreparingSession ? "var(--atlas-ember)" : "transparent"),
                  border: (chatPending || hasInput || hasAttachments) ? "none" : "1px solid transparent",
                  boxShadow: (chatPending || hasInput || hasAttachments) ? "0 0 16px -3px rgba(146,64,14,0.5)" : "none",
                  borderRadius: 10,
                  display: "flex", alignItems: "center", justifyContent: "center",
                  cursor: chatPending ? "pointer" : ((hasInput || hasAttachments) ? "pointer" : "default"),
                }}
              >
                {chatPending ? (
                  <svg viewBox="0 0 16 16" width={13} height={13} aria-hidden>
                    <rect x="3.5" y="3.5" width="9" height="9" rx="1.5" fill="var(--atlas-fg)" />
                  </svg>
                ) : sendPreparingSession ? (
                  <svg width="13" height="13" viewBox="0 0 16 16" fill="none" style={{ animation: "spin 1s linear infinite" }}>
                    <circle cx="8" cy="8" r="6" stroke="var(--atlas-muted)" strokeWidth="1.5" strokeDasharray="10 6" />
                  </svg>
                ) : (
                  <svg viewBox="0 0 20 20" width={13} height={13}
                    fill={hasInput || hasAttachments ? "var(--atlas-fg)" : "none"}
                    stroke={hasInput || hasAttachments ? "var(--atlas-fg)" : "var(--atlas-muted)"}
                    strokeWidth={1.5} strokeLinecap="round" strokeLinejoin="round">
                    <path d="M2.5 10L17 3 13 17l-3.5-5.5z" />
                    <path d="M17 3 9.5 11.5" />
                  </svg>
                )}
              </button>

            </div>
          </div>
        </div>
      </div>}

      {/* Floating "{n} items" pill removed — parked count now renders inline
          in the CaptureBar mounted above the input. */}
    </>
  );
}
