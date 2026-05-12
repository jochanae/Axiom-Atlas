import { useState, useRef, useEffect, useCallback } from "react";
import { useLocation } from "wouter";
import { useListThoughts, useCreateThought, useDeleteThought } from "@workspace/api-client-react";
import { Mic, MicOff, Save, Search, Trash2, X } from "lucide-react";

// ── Toast ──────────────────────────────────────────────────────────────────
type ToastState = { message: string; kind: "success" | "error" } | null;

function Toast({ toast, onDismiss }: { toast: ToastState; onDismiss: () => void }) {
  useEffect(() => {
    if (!toast) return;
    const t = setTimeout(onDismiss, 3000);
    return () => clearTimeout(t);
  }, [toast, onDismiss]);

  if (!toast) return null;

  return (
    <div
      style={{
        position: "fixed", bottom: 24, left: "50%", transform: "translateX(-50%)",
        zIndex: 9999,
        background: toast.kind === "success" ? "var(--atlas-surface)" : "#4B1717",
        border: `1px solid ${toast.kind === "success" ? "var(--atlas-gold)" : "#922"}`,
        color: "var(--atlas-fg)", borderRadius: 8,
        padding: "10px 18px", display: "flex", alignItems: "center", gap: 10,
        fontFamily: "var(--app-font-sans)", fontSize: 13,
        boxShadow: "0 4px 24px rgba(0,0,0,0.5)",
        animation: "atlas-bubble-in 0.18s ease-out",
        whiteSpace: "nowrap",
      }}
    >
      {toast.kind === "success" ? (
        <span style={{ color: "var(--atlas-gold)", fontSize: 14 }}>✓</span>
      ) : (
        <span style={{ color: "#f87171", fontSize: 14 }}>!</span>
      )}
      {toast.message}
      <button
        type="button"
        onClick={onDismiss}
        style={{ background: "none", border: "none", cursor: "pointer", color: "var(--atlas-muted)", padding: 0, marginLeft: 4, display: "flex" }}
      >
        <X size={12} />
      </button>
    </div>
  );
}

// ── Relative time ──────────────────────────────────────────────────────────
function relativeTime(iso: string) {
  const diff = Date.now() - new Date(iso).getTime();
  const s = Math.floor(diff / 1000);
  if (s < 60) return "just now";
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  return `${Math.floor(h / 24)}d ago`;
}

// ── Web Speech API types ───────────────────────────────────────────────────
declare global {
  interface Window {
    SpeechRecognition?: new () => SpeechRecognition;
    webkitSpeechRecognition?: new () => SpeechRecognition;
  }
}

interface SpeechRecognition extends EventTarget {
  continuous: boolean;
  interimResults: boolean;
  lang: string;
  start(): void;
  stop(): void;
  onresult: ((event: SpeechRecognitionEvent) => void) | null;
  onend: (() => void) | null;
  onerror: ((event: SpeechRecognitionErrorEvent) => void) | null;
}

interface SpeechRecognitionEvent {
  resultIndex: number;
  results: SpeechRecognitionResultList;
}

interface SpeechRecognitionResultList {
  length: number;
  item(index: number): SpeechRecognitionResult;
  [index: number]: SpeechRecognitionResult;
}

interface SpeechRecognitionResult {
  isFinal: boolean;
  length: number;
  item(index: number): SpeechRecognitionAlternative;
  [index: number]: SpeechRecognitionAlternative;
}

interface SpeechRecognitionAlternative {
  transcript: string;
  confidence: number;
}

interface SpeechRecognitionErrorEvent extends Event {
  error: string;
}

// ── Main page ──────────────────────────────────────────────────────────────
export default function ThinkFreely() {
  const [, setLocation] = useLocation();
  const [text, setText] = useState("");
  const [isRecording, setIsRecording] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");
  const [toast, setToast] = useState<ToastState>(null);
  const [deletingId, setDeletingId] = useState<number | null>(null);

  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const recognitionRef = useRef<SpeechRecognition | null>(null);
  const interimRef = useRef("");

  const { data: thoughts, refetch: refetchThoughts } = useListThoughts();
  const { mutateAsync: createThought, isPending: isSaving } = useCreateThought();
  const { mutateAsync: deleteThought } = useDeleteThought();

  useEffect(() => { textareaRef.current?.focus(); }, []);

  const showToast = (message: string, kind: "success" | "error" = "success") => {
    setToast({ message, kind });
  };

  const wordCount = text.trim() ? text.trim().split(/\s+/).length : 0;

  // ── Voice input ───────────────────────────────────────────────────────
  const SpeechAPI = typeof window !== "undefined"
    ? (window.SpeechRecognition ?? window.webkitSpeechRecognition)
    : undefined;

  const toggleRecording = useCallback(() => {
    if (!SpeechAPI) {
      showToast("Voice input not supported in this browser", "error");
      return;
    }

    if (isRecording) {
      recognitionRef.current?.stop();
      setIsRecording(false);
      return;
    }

    const recognition = new SpeechAPI();
    recognition.continuous = true;
    recognition.interimResults = true;
    recognition.lang = "en-US";
    recognitionRef.current = recognition;

    const baseText = text;
    interimRef.current = "";

    recognition.onresult = (event: SpeechRecognitionEvent) => {
      let interim = "";
      let finalSegment = "";
      for (let i = event.resultIndex; i < event.results.length; i++) {
        const result = event.results[i];
        if (result.isFinal) {
          finalSegment += result[0].transcript;
        } else {
          interim += result[0].transcript;
        }
      }
      if (finalSegment) {
        interimRef.current = "";
        const separator = baseText && !baseText.endsWith(" ") ? " " : "";
        setText(baseText + separator + finalSegment.trim() + " ");
      } else {
        interimRef.current = interim;
        const separator = baseText && !baseText.endsWith(" ") ? " " : "";
        setText(baseText + separator + interim);
      }
    };

    recognition.onend = () => setIsRecording(false);
    recognition.onerror = (e: SpeechRecognitionErrorEvent) => {
      if (e.error !== "aborted") showToast("Voice recognition error: " + e.error, "error");
      setIsRecording(false);
    };

    recognition.start();
    setIsRecording(true);
  }, [isRecording, text, SpeechAPI]);

  // Stop recognition on unmount
  useEffect(() => () => { recognitionRef.current?.stop(); }, []);

  // ── Save thought ──────────────────────────────────────────────────────
  const handleSave = async () => {
    const trimmed = text.trim();
    if (!trimmed) return;
    try {
      await createThought({ data: { content: trimmed } });
      await refetchThoughts();
      setText("");
      textareaRef.current?.focus();
      showToast("Thought saved");
    } catch {
      showToast("Failed to save thought", "error");
    }
  };

  // ── Delete thought ────────────────────────────────────────────────────
  const handleDelete = async (id: number) => {
    setDeletingId(id);
    try {
      await deleteThought({ id });
      await refetchThoughts();
    } catch {
      showToast("Failed to delete", "error");
    } finally {
      setDeletingId(null);
    }
  };

  // ── Copy / Clear ──────────────────────────────────────────────────────
  const handleCopy = async () => {
    if (!text) return;
    await navigator.clipboard.writeText(text);
    showToast("Copied to clipboard");
  };

  const handleClear = () => {
    if (text && !confirm("Clear your freewrite?")) return;
    setText("");
    textareaRef.current?.focus();
  };

  // ── Filtered thoughts ─────────────────────────────────────────────────
  const filteredThoughts = (thoughts ?? []).filter(t =>
    !searchQuery || t.content.toLowerCase().includes(searchQuery.toLowerCase())
  );

  const hasThoughts = (thoughts ?? []).length > 0;

  return (
    <div style={{ height: "100dvh", background: "transparent", color: "var(--atlas-fg)", display: "flex", flexDirection: "column", overflow: "hidden" }}>

      {/* ── Header ── */}
      <header style={{
        flexShrink: 0, padding: "10px 16px",
        borderBottom: "1px solid var(--atlas-border)",
        display: "flex", alignItems: "center", justifyContent: "space-between",
      }}>
        <div style={{ display: "flex", alignItems: "center", gap: 14 }}>
          <button
            type="button"
            onClick={() => setLocation("/home")}
            style={{ fontFamily: "var(--app-font-mono)", fontSize: 9, letterSpacing: "0.14em", textTransform: "uppercase", color: "var(--atlas-muted)", background: "transparent", border: "none", padding: 0, cursor: "pointer", opacity: 0.7 }}
          >
            ← Home
          </button>
          <span style={{ fontSize: 14, fontWeight: 600, color: "var(--atlas-fg)", letterSpacing: "-0.01em" }}>Think Freely</span>
        </div>

        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          {text && (
            <>
              <button
                type="button"
                onClick={handleCopy}
                title="Copy to clipboard"
                style={{ fontFamily: "var(--app-font-mono)", fontSize: 9, letterSpacing: "0.1em", textTransform: "uppercase", color: "var(--atlas-muted)", background: "transparent", border: "1px solid var(--atlas-border)", padding: "4px 10px", borderRadius: 5, cursor: "pointer", opacity: 0.7 }}
              >
                Copy
              </button>
              <button
                type="button"
                onClick={handleClear}
                title="Clear"
                style={{ fontFamily: "var(--app-font-mono)", fontSize: 9, letterSpacing: "0.1em", textTransform: "uppercase", color: "var(--atlas-muted)", background: "transparent", border: "1px solid var(--atlas-border)", padding: "4px 10px", borderRadius: 5, cursor: "pointer", opacity: 0.7 }}
              >
                Clear
              </button>
            </>
          )}
          <span style={{ fontFamily: "var(--app-font-mono)", fontSize: 9, color: "var(--atlas-muted)", opacity: 0.4, letterSpacing: "0.06em" }}>
            {wordCount} {wordCount === 1 ? "word" : "words"}
          </span>
        </div>
      </header>

      {/* ── Freewrite canvas ── */}
      <div style={{ flex: "0 0 52%", overflow: "hidden", position: "relative" }}>
        {!text && (
          <div
            aria-hidden
            style={{
              position: "absolute", top: "50%", left: "50%",
              transform: "translate(-50%, -50%)",
              fontFamily: "var(--app-font-mono)", fontSize: 12,
              color: "var(--atlas-muted)", opacity: 0.25,
              textAlign: "center", lineHeight: 1.8, pointerEvents: "none",
              letterSpacing: "0.04em",
            }}
          >
            No rules. No structure.<br />Just write until something becomes clear.
          </div>
        )}
        <textarea
          ref={textareaRef}
          value={text}
          onChange={(e) => setText(e.target.value)}
          placeholder=""
          style={{
            width: "100%", height: "100%",
            background: "transparent", border: "none", outline: "none",
            color: "var(--atlas-fg)", fontSize: 15, lineHeight: 1.85,
            resize: "none", padding: "28px 24px",
            fontFamily: "var(--app-font-sans)",
            boxSizing: "border-box",
          }}
        />
      </div>

      {/* ── Action bar ── */}
      <div style={{
        flexShrink: 0,
        padding: "10px 16px",
        borderTop: "1px solid var(--atlas-border)",
        borderBottom: "1px solid var(--atlas-border)",
        display: "flex", alignItems: "center", gap: 10,
        background: "var(--atlas-surface)",
      }}>
        {/* Mic button */}
        <button
          type="button"
          onClick={toggleRecording}
          title={isRecording ? "Stop recording" : "Start voice input"}
          style={{
            display: "flex", alignItems: "center", justifyContent: "center",
            width: 34, height: 34, borderRadius: 8,
            border: isRecording ? "1px solid #ef4444" : "1px solid var(--atlas-border)",
            background: isRecording ? "rgba(239,68,68,0.12)" : "transparent",
            color: isRecording ? "#ef4444" : "var(--atlas-muted)",
            cursor: "pointer", transition: "all 0.15s ease", flexShrink: 0,
          }}
        >
          {isRecording
            ? <MicOff size={15} strokeWidth={1.8} />
            : <Mic size={15} strokeWidth={1.8} />}
        </button>

        {isRecording && (
          <span style={{
            fontFamily: "var(--app-font-mono)", fontSize: 9, letterSpacing: "0.1em",
            textTransform: "uppercase", color: "#ef4444", opacity: 0.8,
            animation: "pulse 1.4s ease-in-out infinite",
          }}>
            ● recording
          </span>
        )}

        <div style={{ flex: 1 }} />

        {/* Save button */}
        <button
          type="button"
          onClick={handleSave}
          disabled={!text.trim() || isSaving}
          title="Save thought"
          style={{
            display: "flex", alignItems: "center", gap: 7,
            padding: "7px 16px", borderRadius: 8,
            border: "1px solid var(--atlas-gold)",
            background: text.trim() && !isSaving ? "rgba(201,162,76,0.1)" : "transparent",
            color: text.trim() && !isSaving ? "var(--atlas-gold)" : "var(--atlas-muted)",
            cursor: text.trim() && !isSaving ? "pointer" : "default",
            fontFamily: "var(--app-font-sans)", fontSize: 12.5, fontWeight: 500,
            opacity: text.trim() && !isSaving ? 1 : 0.4,
            transition: "all 0.15s ease",
          }}
        >
          <Save size={13} strokeWidth={1.8} />
          {isSaving ? "Saving…" : "Save Thought"}
        </button>
      </div>

      {/* ── Saved thoughts panel ── */}
      <div style={{ flex: 1, overflow: "hidden", display: "flex", flexDirection: "column" }}>
        {/* Search bar */}
        {hasThoughts && (
          <div style={{ flexShrink: 0, padding: "10px 16px 0", display: "flex", alignItems: "center", gap: 8 }}>
            <div style={{
              flex: 1, display: "flex", alignItems: "center", gap: 8,
              background: "var(--atlas-surface)", border: "1px solid var(--atlas-border)",
              borderRadius: 7, padding: "6px 10px",
            }}>
              <Search size={12} strokeWidth={1.8} style={{ color: "var(--atlas-muted)", flexShrink: 0, opacity: 0.5 }} />
              <input
                type="text"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder="Search thoughts…"
                style={{
                  flex: 1, background: "transparent", border: "none", outline: "none",
                  color: "var(--atlas-fg)", fontFamily: "var(--app-font-sans)", fontSize: 12.5,
                }}
              />
              {searchQuery && (
                <button type="button" onClick={() => setSearchQuery("")}
                  style={{ background: "none", border: "none", cursor: "pointer", color: "var(--atlas-muted)", padding: 0, display: "flex" }}>
                  <X size={11} />
                </button>
              )}
            </div>
            <span style={{ fontFamily: "var(--app-font-mono)", fontSize: 9, color: "var(--atlas-muted)", opacity: 0.4, letterSpacing: "0.06em", flexShrink: 0 }}>
              {filteredThoughts.length} / {(thoughts ?? []).length}
            </span>
          </div>
        )}

        {/* List */}
        <div style={{ flex: 1, overflowY: "auto", padding: "10px 16px 16px" }}>
          {!hasThoughts ? (
            <div style={{
              display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center",
              height: "100%", gap: 6, opacity: 0.3,
              fontFamily: "var(--app-font-mono)", fontSize: 10, color: "var(--atlas-muted)", letterSpacing: "0.06em",
              textAlign: "center",
            }}>
              <Save size={16} strokeWidth={1.4} />
              <span>Saved thoughts will appear here</span>
            </div>
          ) : filteredThoughts.length === 0 ? (
            <div style={{
              display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center",
              height: "100%", gap: 6, opacity: 0.35,
              fontFamily: "var(--app-font-mono)", fontSize: 10, color: "var(--atlas-muted)", letterSpacing: "0.06em",
            }}>
              <Search size={16} strokeWidth={1.4} />
              <span>No results for "{searchQuery}"</span>
            </div>
          ) : (
            <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
              {filteredThoughts.map(t => (
                <div
                  key={t.id}
                  style={{
                    background: "var(--atlas-surface)",
                    border: "1px solid var(--atlas-border)",
                    borderRadius: 8, padding: "10px 12px",
                    display: "flex", alignItems: "flex-start", gap: 10,
                    transition: "border-color 0.15s",
                  }}
                  onMouseEnter={(e) => (e.currentTarget.style.borderColor = "rgba(201,162,76,0.25)")}
                  onMouseLeave={(e) => (e.currentTarget.style.borderColor = "var(--atlas-border)")}
                >
                  <p style={{
                    flex: 1, margin: 0,
                    fontFamily: "var(--app-font-sans)", fontSize: 13, lineHeight: 1.6,
                    color: "var(--atlas-fg)", whiteSpace: "pre-wrap", wordBreak: "break-word",
                  }}>
                    {searchQuery
                      ? highlightMatch(t.content, searchQuery)
                      : t.content}
                  </p>
                  <div style={{ display: "flex", alignItems: "center", gap: 8, flexShrink: 0 }}>
                    <span style={{ fontFamily: "var(--app-font-mono)", fontSize: 9, color: "var(--atlas-muted)", opacity: 0.4, letterSpacing: "0.04em" }}>
                      {relativeTime(t.createdAt)}
                    </span>
                    <button
                      type="button"
                      onClick={() => handleDelete(t.id)}
                      disabled={deletingId === t.id}
                      title="Delete"
                      style={{
                        background: "none", border: "none", cursor: "pointer", padding: 2,
                        color: "var(--atlas-muted)", opacity: deletingId === t.id ? 0.3 : 0.45,
                        display: "flex", borderRadius: 4, transition: "opacity 0.15s",
                      }}
                      onMouseEnter={(e) => (e.currentTarget.style.opacity = "0.9")}
                      onMouseLeave={(e) => (e.currentTarget.style.opacity = deletingId === t.id ? "0.3" : "0.45")}
                    >
                      <Trash2 size={12} strokeWidth={1.8} />
                    </button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      <Toast toast={toast} onDismiss={() => setToast(null)} />
    </div>
  );
}

// ── Highlight matched text ─────────────────────────────────────────────────
function highlightMatch(content: string, query: string) {
  const parts = content.split(new RegExp(`(${query.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")})`, "gi"));
  return parts.map((part, i) =>
    part.toLowerCase() === query.toLowerCase()
      ? <mark key={i} style={{ background: "rgba(201,162,76,0.25)", color: "var(--atlas-gold)", borderRadius: 2, padding: "0 1px" }}>{part}</mark>
      : part
  );
}
