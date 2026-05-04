import { useState, useRef, useEffect, useCallback } from "react";
import type React from "react";
import { useParams, useLocation } from "wouter";
import { StatusGlyph } from "../components/StatusGlyph";
import { CapsuleTag } from "../components/CapsuleTag";
import {
  useGetProject,
  useListSessions,
  useListEntries,
  useCreateSession,
  useCreateEntry,
  useUpdateProject,
  getListEntriesQueryKey,
  getListSessionsQueryKey,
  getGetProjectQueryKey,
} from "@workspace/api-client-react";
import type { Entry } from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";

// ── Types ────────────────────────────────────────────────────────────────────
interface CatchPayload {
  v: number;
  against: { id: string; title: string };
  leadSentence: string;
}

interface FileEdit {
  path: string;
  language: string;
  content: string;
}

interface ChatMessage {
  id?: number;
  role: "user" | "assistant";
  content: string;
  intentType?: string | null;
  catchPayload?: CatchPayload | null;
  catchResolved?: boolean;
  fileEdit?: FileEdit;
}

interface LinkedRepo {
  fullName: string;
  defaultBranch: string;
  name: string;
}

type RightTab = "ledger" | "files" | "preview" | "memory";

// ── User profile helpers ──────────────────────────────────────────────────────
interface UserProfile {
  name: string;
  stack: string;
  projects: string;
  notes: string;
}

function loadProfile(): UserProfile {
  try {
    const raw = localStorage.getItem("atlas-user-profile");
    if (raw) return JSON.parse(raw);
  } catch {}
  return { name: "", stack: "React, React Router, Tailwind CSS, Supabase", projects: "Compani, IntoIQ, CoinsBloom, PresentQ, SanctumIQ, Atlas", notes: "" };
}

function saveProfile(p: UserProfile) {
  try { localStorage.setItem("atlas-user-profile", JSON.stringify(p)); } catch {}
}

function profileToString(p: UserProfile): string {
  const parts: string[] = [];
  if (p.name) parts.push(`Name: ${p.name}`);
  if (p.stack) parts.push(`Stack: ${p.stack}`);
  if (p.projects) parts.push(`Projects: ${p.projects}`);
  if (p.notes) parts.push(`Notes: ${p.notes}`);
  return parts.join("\n");
}

// ── Hooks ────────────────────────────────────────────────────────────────────
function useIsMobile() {
  const [mobile, setMobile] = useState(() => window.innerWidth < 768);
  useEffect(() => {
    const handler = () => setMobile(window.innerWidth < 768);
    window.addEventListener("resize", handler);
    return () => window.removeEventListener("resize", handler);
  }, []);
  return mobile;
}

// ── useVoiceInput ─────────────────────────────────────────────────────────────
function useVoiceInput(onTranscript: (text: string) => void) {
  const [listening, setListening] = useState(false);
  const recRef = useRef<any>(null);
  const callbackRef = useRef(onTranscript);
  callbackRef.current = onTranscript;

  const isSupported =
    typeof window !== "undefined" &&
    ("SpeechRecognition" in window || "webkitSpeechRecognition" in window);

  const toggle = useCallback(() => {
    if (!isSupported) return;
    if (listening) {
      recRef.current?.stop();
      return;
    }
    const SR =
      (window as any).SpeechRecognition ||
      (window as any).webkitSpeechRecognition;
    const rec = new SR();
    rec.continuous = false;
    rec.interimResults = false;
    rec.lang = "en-US";
    rec.onresult = (e: any) => {
      const text = Array.from(e.results as any[])
        .map((r: any) => r[0].transcript)
        .join(" ");
      callbackRef.current(text);
    };
    rec.onend = () => setListening(false);
    rec.onerror = () => setListening(false);
    recRef.current = rec;
    rec.start();
    setListening(true);
  }, [isSupported, listening]);

  return { listening, toggle, isSupported };
}

// ── AtlasLogo ────────────────────────────────────────────────────────────────
function AtlasLogo({ small }: { small?: boolean }) {
  const s = small ? 15 : 18;
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
      <svg width={s} height={s} viewBox="0 0 20 20" fill="none" aria-hidden>
        <circle cx="10" cy="10" r="8" stroke="#C9A24C" strokeWidth="1.2" />
        <circle cx="10" cy="10" r="3.2" stroke="#C9A24C" strokeWidth="0.9" />
        <line x1="10" y1="2" x2="10" y2="18" stroke="#C9A24C" strokeWidth="0.7" strokeDasharray="1.8 2.4" />
        <line x1="2" y1="10" x2="18" y2="10" stroke="#C9A24C" strokeWidth="0.7" strokeDasharray="1.8 2.4" />
      </svg>
      <span
        style={{
          fontFamily: "var(--app-font-sans)",
          fontSize: small ? 12 : 13,
          fontWeight: 500,
          letterSpacing: "0.14em",
          color: "var(--atlas-fg)",
          textTransform: "uppercase",
          opacity: 0.82,
        }}
      >
        Atlas
      </span>
    </div>
  );
}

// ── DecisionCatchCard ────────────────────────────────────────────────────────
function DecisionCatchCard({
  payload,
  projectId,
  sessionId,
  onProceed,
  onAdjust,
}: {
  payload: CatchPayload;
  projectId: number;
  sessionId: number;
  onProceed: () => void;
  onAdjust: () => void;
}) {
  const createEntry = useCreateEntry();
  const queryClient = useQueryClient();
  const [reason, setReason] = useState("");
  const [showReason, setShowReason] = useState(false);

  const handleProceed = () => {
    if (!showReason) { setShowReason(true); return; }
    createEntry.mutate(
      {
        projectId,
        data: {
          title: `Override: ${payload.against.title}`,
          summary: reason || payload.leadSentence,
          status: "committed",
          severity: "committed",
          mode: "decide",
          sessionId,
        },
      },
      {
        onSuccess: () => {
          queryClient.invalidateQueries({ queryKey: getListEntriesQueryKey(projectId, {}) });
          onProceed();
        },
      }
    );
  };

  return (
    <div
      role="alert"
      aria-label="Decision Catch"
      className="atlas-catch-card atlas-bubble-in"
      style={{ padding: "12px 14px", marginTop: 10 }}
    >
      {/* Header label */}
      <div style={{ display: "flex", alignItems: "center", gap: 7, marginBottom: 9 }}>
        <span
          aria-hidden
          style={{
            width: 6, height: 6, borderRadius: "50%", flexShrink: 0,
            background: "var(--atlas-ember)",
            boxShadow: "0 0 8px color-mix(in oklab, var(--atlas-ember) 60%, transparent)",
          }}
        />
        <span
          style={{
            fontFamily: "var(--app-font-mono)", fontSize: 9.5,
            letterSpacing: "0.14em", textTransform: "uppercase" as const,
            color: "var(--atlas-ember)",
          }}
        >
          Before you do
        </span>
      </div>

      {/* Linked decision — the committed entry this catch is against */}
      <div
        style={{
          marginBottom: 10, padding: "7px 10px", borderRadius: 6,
          background: "color-mix(in oklab, var(--atlas-ember) 6%, transparent)",
          border: "0.5px solid color-mix(in oklab, var(--atlas-ember) 22%, transparent)",
        }}
      >
        <div
          style={{
            fontFamily: "var(--app-font-mono)", fontSize: 9, letterSpacing: "0.12em",
            textTransform: "uppercase" as const, color: "var(--atlas-ember)",
            opacity: 0.65, marginBottom: 3,
          }}
        >
          Against
        </div>
        <div style={{ fontSize: 12.5, fontWeight: 500, color: "var(--atlas-fg)", lineHeight: 1.35 }}>
          {payload.against.title}
        </div>
      </div>

      {/* Lead sentence */}
      <p style={{ margin: "0 0 12px", fontSize: 13, lineHeight: 1.65, color: "var(--atlas-fg)", opacity: 0.85 }}>
        {payload.leadSentence}
      </p>

      {/* Optional reason textarea */}
      {showReason && (
        <textarea
          autoFocus
          value={reason}
          onChange={(e) => setReason(e.target.value)}
          placeholder="One line on why — optional, but it helps later."
          rows={2}
          style={{
            marginBottom: 12, width: "100%",
            background: "var(--atlas-surface-alt)",
            border: "1px solid var(--atlas-border)",
            borderRadius: 6, padding: "8px 10px",
            fontSize: 12, color: "var(--atlas-fg)",
            fontFamily: "var(--app-font-sans)", outline: "none", resize: "none",
            transition: "border-color 160ms ease",
          }}
          onFocus={(e) => (e.currentTarget.style.borderColor = "rgba(201,162,76,0.35)")}
          onBlur={(e) => (e.currentTarget.style.borderColor = "var(--atlas-border)")}
        />
      )}

      {/* Actions */}
      <div style={{ display: "flex", gap: 7, alignItems: "center" }}>
        {/* Ghost: Proceed anyway */}
        <button
          disabled={createEntry.isPending}
          onClick={handleProceed}
          style={{
            padding: "5px 12px", fontSize: 10, fontWeight: 600,
            fontFamily: "var(--app-font-mono)", letterSpacing: "0.1em",
            textTransform: "uppercase" as const,
            background: "transparent",
            color: "color-mix(in oklab, var(--atlas-ember) 90%, var(--atlas-fg))",
            border: "0.5px solid color-mix(in oklab, var(--atlas-ember) 55%, transparent)",
            borderRadius: 4,
            cursor: createEntry.isPending ? "not-allowed" : "pointer",
            opacity: createEntry.isPending ? 0.5 : 1,
            transition: "all 160ms ease",
          }}
        >
          {createEntry.isPending ? "Logging…" : showReason ? "Confirm" : "Proceed anyway"}
        </button>

        {/* Primary: Adjust */}
        <button
          disabled={createEntry.isPending}
          onClick={() => { setShowReason(false); setReason(""); onAdjust(); }}
          style={{
            padding: "6px 13px", fontSize: 10, fontWeight: 600,
            fontFamily: "var(--app-font-mono)", letterSpacing: "0.1em",
            textTransform: "uppercase" as const,
            background: "linear-gradient(180deg, var(--atlas-gold) 0%, color-mix(in oklab, var(--atlas-gold) 78%, #6a4a18) 100%)",
            color: "var(--atlas-bg)",
            border: "0.5px solid color-mix(in oklab, var(--atlas-gold) 75%, transparent)",
            borderRadius: 4,
            boxShadow: "0 0 12px -4px color-mix(in oklab, var(--atlas-gold) 50%, transparent), inset 0 1px 0 rgba(255,255,255,0.15)",
            cursor: createEntry.isPending ? "not-allowed" : "pointer",
            transition: "opacity 160ms ease",
          }}
        >
          Adjust
        </button>

        {showReason && (
          <button
            onClick={() => { setShowReason(false); setReason(""); }}
            style={{
              marginLeft: "auto", fontSize: 10,
              fontFamily: "var(--app-font-mono)", letterSpacing: "0.08em",
              background: "transparent", color: "var(--atlas-muted)",
              border: "none", cursor: "pointer", opacity: 0.6,
            }}
          >
            cancel
          </button>
        )}
      </div>
    </div>
  );
}

// ── Chat bubbles + Memory Chips ──────────────────────────────────────────────
// ── MemoryChips ───────────────────────────────────────────────────────────────
function MemoryChips({
  chips,
  onDismiss,
}: {
  chips: string[];
  onDismiss: (chip: string) => void;
}) {
  if (chips.length === 0) return null;
  return (
    <div
      style={{
        display: "flex", flexWrap: "wrap", gap: 5,
        padding: "6px 14px 2px", flexShrink: 0,
      }}
    >
      {chips.map((chip) => (
        <span
          key={chip}
          className="atlas-bubble-in"
          style={{
            display: "inline-flex", alignItems: "center", gap: 4,
            padding: "3px 7px 3px 9px", borderRadius: 20,
            fontFamily: "var(--app-font-mono)", fontSize: 9.5,
            letterSpacing: "0.05em",
            color: "var(--atlas-muted)",
            background: "color-mix(in oklab, var(--atlas-surface) 85%, var(--atlas-bg))",
            border: "0.5px solid var(--atlas-border)",
            transition: "border-color 160ms ease",
          }}
          onMouseEnter={(e) => ((e.currentTarget as HTMLElement).style.borderColor = "rgba(201,162,76,0.22)")}
          onMouseLeave={(e) => ((e.currentTarget as HTMLElement).style.borderColor = "var(--atlas-border)")}
        >
          {chip}
          <button
            onClick={() => onDismiss(chip)}
            aria-label={`Dismiss ${chip}`}
            style={{
              background: "none", border: "none", cursor: "pointer",
              color: "var(--atlas-muted)", opacity: 0.45,
              fontSize: 12, lineHeight: 1, padding: "0 1px",
              display: "flex", alignItems: "center",
            }}
          >
            ×
          </button>
        </span>
      ))}
    </div>
  );
}

function UserBubble({ content }: { content: string }) {
  return (
    <div className="atlas-bubble-in" style={{ display: "flex", justifyContent: "flex-end", marginBottom: 24 }}>
      <div
        style={{
          maxWidth: "74%",
          padding: "11px 15px",
          borderRadius: "12px 12px 3px 12px",
          background: "rgba(146,64,14,0.10)",
          border: "1px solid rgba(146,64,14,0.22)",
        }}
      >
        <div
          style={{
            fontFamily: "var(--app-font-mono)", fontSize: 9,
            letterSpacing: "0.12em", textTransform: "uppercase",
            color: "var(--atlas-ember)", opacity: 0.65, marginBottom: 6,
          }}
        >
          You
        </div>
        <div style={{ fontSize: 14, lineHeight: 1.7, color: "var(--atlas-fg)", whiteSpace: "pre-wrap" }}>
          {content}
        </div>
      </div>
    </div>
  );
}

// ── GitHubPushModal ───────────────────────────────────────────────────────────
function GitHubPushModal({
  fileEdit,
  linkedRepo,
  projectId,
  onClose,
}: {
  fileEdit: FileEdit;
  linkedRepo: LinkedRepo | null;
  projectId: number;
  onClose: () => void;
}) {
  const today = new Date().toISOString().slice(0, 10);
  const filename = fileEdit.path.split("/").pop() ?? fileEdit.path;
  const lineCount = fileEdit.content.split("\n").length;

  const [useNewBranch, setUseNewBranch] = useState(true);
  const [branchName, setBranchName] = useState(`atlas/fix-${today}`);
  const [commitMsg, setCommitMsg] = useState(`Atlas: update ${filename}`);
  const [pushing, setPushing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<{ commitUrl: string; branch: string } | null>(null);
  const [showCode, setShowCode] = useState(false);

  const token = (() => { try { return localStorage.getItem("atlas-gh-token"); } catch { return null; } })();

  const handlePush = async () => {
    if (!linkedRepo || !token) {
      setError("No linked repo or GitHub token found. Open the Files tab and link a repo first.");
      return;
    }
    setPushing(true);
    setError(null);
    try {
      const targetBranch = useNewBranch ? branchName : linkedRepo.defaultBranch;

      // Create new branch if needed
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

      // Commit the file
      const commitRes = await fetch("/api/github/commit", {
        method: "PUT",
        headers: { "Content-Type": "application/json", "x-github-token": token },
        body: JSON.stringify({
          repo: linkedRepo.fullName,
          branch: targetBranch,
          path: fileEdit.path,
          content: fileEdit.content,
          message: commitMsg,
        }),
      });
      if (!commitRes.ok) {
        const d = await commitRes.json().catch(() => ({})) as any;
        throw new Error(d.error || `Commit failed: HTTP ${commitRes.status}`);
      }
      const commitData = await commitRes.json() as { commitUrl: string; branch: string };
      setSuccess({ commitUrl: commitData.commitUrl, branch: targetBranch });
    } catch (e: any) {
      setError(e.message ?? "Push failed");
    } finally {
      setPushing(false);
    }
  };

  return (
    <div
      style={{
        position: "fixed", inset: 0, zIndex: 1000,
        background: "rgba(0,0,0,0.72)", backdropFilter: "blur(4px)",
        display: "flex", alignItems: "center", justifyContent: "center",
        padding: "20px 16px",
      }}
      onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}
    >
      <div
        style={{
          width: "100%", maxWidth: 560,
          background: "var(--atlas-surface)",
          border: "1px solid var(--atlas-border)",
          borderRadius: 12,
          boxShadow: "0 24px 64px rgba(0,0,0,0.6), 0 0 0 0.5px rgba(201,162,76,0.08)",
          display: "flex", flexDirection: "column",
          maxHeight: "90vh", overflow: "hidden",
        }}
      >
        {/* Header */}
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "16px 20px 0" }}>
          <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
            <div style={{
              width: 28, height: 28, borderRadius: 7,
              background: "rgba(201,162,76,0.1)", border: "1px solid rgba(201,162,76,0.2)",
              display: "flex", alignItems: "center", justifyContent: "center",
            }}>
              <svg width="14" height="14" viewBox="0 0 16 16" fill="none">
                <path d="M8 1C4.13 1 1 4.13 1 8c0 3.09 2 5.71 4.78 6.64.35.06.48-.15.48-.34v-1.2c-1.94.42-2.35-.94-2.35-.94-.32-.81-.78-1.03-.78-1.03-.64-.43.05-.42.05-.42.7.05 1.07.72 1.07.72.62 1.07 1.63.76 2.03.58.06-.45.24-.76.44-.93-1.55-.18-3.18-.77-3.18-3.44 0-.76.27-1.38.72-1.87-.07-.18-.31-.88.07-1.84 0 0 .59-.19 1.92.72A6.6 6.6 0 018 4.82c.59 0 1.19.08 1.74.23 1.33-.9 1.92-.72 1.92-.72.38.96.14 1.66.07 1.84.45.49.72 1.11.72 1.87 0 2.68-1.63 3.26-3.19 3.44.25.22.48.64.48 1.3v1.92c0 .19.13.4.48.33C13 13.71 15 11.09 15 8c0-3.87-3.13-7-7-7z" fill="currentColor" style={{ color: "var(--atlas-gold)" }} />
              </svg>
            </div>
            <div>
              <div style={{ fontSize: 13, fontWeight: 600, color: "var(--atlas-fg)" }}>Push to GitHub</div>
              {linkedRepo && (
                <div style={{ fontSize: 10, color: "var(--atlas-muted)", fontFamily: "var(--app-font-mono)", marginTop: 1 }}>
                  {linkedRepo.fullName}
                </div>
              )}
            </div>
          </div>
          <button
            onClick={onClose}
            style={{ background: "none", border: "none", cursor: "pointer", color: "var(--atlas-muted)", fontSize: 18, lineHeight: 1, padding: "4px 6px", opacity: 0.5 }}
            onMouseEnter={(e) => (e.currentTarget.style.opacity = "1")}
            onMouseLeave={(e) => (e.currentTarget.style.opacity = "0.5")}
          >×</button>
        </div>

        <div style={{ padding: "16px 20px", overflowY: "auto", flex: 1 }}>
          {success ? (
            /* Success state */
            <div style={{ textAlign: "center", padding: "24px 0" }}>
              <div style={{ fontSize: 28, marginBottom: 12 }}>✓</div>
              <div style={{ fontSize: 14, color: "var(--atlas-fg)", marginBottom: 6 }}>Pushed to <strong>{success.branch}</strong></div>
              <a
                href={success.commitUrl}
                target="_blank"
                rel="noopener noreferrer"
                style={{
                  display: "inline-flex", alignItems: "center", gap: 5,
                  padding: "6px 14px", borderRadius: 6,
                  background: "rgba(201,162,76,0.1)", border: "1px solid rgba(201,162,76,0.25)",
                  color: "var(--atlas-gold)", fontSize: 12,
                  fontFamily: "var(--app-font-mono)", textDecoration: "none",
                  marginTop: 8,
                }}
              >
                View commit on GitHub →
              </a>
              <div style={{ marginTop: 16 }}>
                <button
                  onClick={onClose}
                  style={{
                    padding: "6px 16px", borderRadius: 6, fontSize: 12,
                    background: "transparent", border: "1px solid var(--atlas-border)",
                    color: "var(--atlas-muted)", cursor: "pointer",
                  }}
                >
                  Close
                </button>
              </div>
            </div>
          ) : (
            <>
              {/* File info */}
              <div style={{
                padding: "10px 13px", borderRadius: 7,
                background: "rgba(0,0,0,0.25)", border: "1px solid var(--atlas-border)",
                marginBottom: 16,
              }}>
                <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
                  <div style={{ display: "flex", alignItems: "center", gap: 7 }}>
                    <svg width="12" height="12" viewBox="0 0 16 16" fill="none">
                      <path d="M9 1H3a1 1 0 00-1 1v12a1 1 0 001 1h10a1 1 0 001-1V6l-5-5z" stroke="currentColor" strokeWidth="1.2" />
                      <path d="M9 1v5h5" stroke="currentColor" strokeWidth="1.2" />
                    </svg>
                    <span style={{ fontFamily: "var(--app-font-mono)", fontSize: 11, color: "var(--atlas-fg)" }}>
                      {fileEdit.path}
                    </span>
                  </div>
                  <span style={{ fontFamily: "var(--app-font-mono)", fontSize: 10, color: "var(--atlas-muted)" }}>
                    {lineCount} lines
                  </span>
                </div>
                <button
                  onClick={() => setShowCode((v) => !v)}
                  style={{
                    marginTop: 8, background: "none", border: "none", cursor: "pointer",
                    color: "var(--atlas-muted)", fontSize: 10,
                    fontFamily: "var(--app-font-mono)", letterSpacing: "0.08em",
                    padding: 0, opacity: 0.6,
                  }}
                  onMouseEnter={(e) => (e.currentTarget.style.opacity = "1")}
                  onMouseLeave={(e) => (e.currentTarget.style.opacity = "0.6")}
                >
                  {showCode ? "Hide code ↑" : "Review code ↓"}
                </button>
                {showCode && (
                  <pre style={{
                    marginTop: 10, padding: "10px", borderRadius: 5,
                    background: "rgba(0,0,0,0.35)", border: "1px solid rgba(255,255,255,0.04)",
                    fontSize: 10.5, fontFamily: "var(--app-font-mono)", lineHeight: 1.6,
                    color: "rgba(231,229,228,0.7)", overflowX: "auto",
                    maxHeight: 220, overflowY: "auto",
                    whiteSpace: "pre",
                  }}>
                    {fileEdit.content}
                  </pre>
                )}
              </div>

              {/* Branch option */}
              <div style={{ marginBottom: 14 }}>
                <div style={{ fontSize: 11, color: "var(--atlas-muted)", fontFamily: "var(--app-font-mono)", letterSpacing: "0.08em", marginBottom: 8 }}>
                  TARGET BRANCH
                </div>
                <div style={{ display: "flex", gap: 8, marginBottom: 8 }}>
                  <button
                    onClick={() => setUseNewBranch(true)}
                    style={{
                      flex: 1, padding: "7px 10px", borderRadius: 6, fontSize: 12, cursor: "pointer",
                      background: useNewBranch ? "rgba(201,162,76,0.1)" : "transparent",
                      border: `1px solid ${useNewBranch ? "rgba(201,162,76,0.35)" : "var(--atlas-border)"}`,
                      color: useNewBranch ? "var(--atlas-gold)" : "var(--atlas-muted)",
                      transition: "all 160ms ease",
                    }}
                  >
                    New branch (safe)
                  </button>
                  <button
                    onClick={() => setUseNewBranch(false)}
                    style={{
                      flex: 1, padding: "7px 10px", borderRadius: 6, fontSize: 12, cursor: "pointer",
                      background: !useNewBranch ? "rgba(201,162,76,0.1)" : "transparent",
                      border: `1px solid ${!useNewBranch ? "rgba(201,162,76,0.35)" : "var(--atlas-border)"}`,
                      color: !useNewBranch ? "var(--atlas-gold)" : "var(--atlas-muted)",
                      transition: "all 160ms ease",
                    }}
                  >
                    {linkedRepo?.defaultBranch ?? "main"} (direct)
                  </button>
                </div>
                {useNewBranch && (
                  <input
                    value={branchName}
                    onChange={(e) => setBranchName(e.target.value)}
                    placeholder="branch name"
                    style={{
                      width: "100%", padding: "8px 11px", borderRadius: 6,
                      background: "rgba(0,0,0,0.3)", border: "1px solid var(--atlas-border)",
                      color: "var(--atlas-fg)", fontSize: 12,
                      fontFamily: "var(--app-font-mono)",
                      outline: "none", boxSizing: "border-box",
                    }}
                    onFocus={(e) => (e.currentTarget.style.borderColor = "rgba(201,162,76,0.4)")}
                    onBlur={(e) => (e.currentTarget.style.borderColor = "var(--atlas-border)")}
                  />
                )}
              </div>

              {/* Commit message */}
              <div style={{ marginBottom: 16 }}>
                <div style={{ fontSize: 11, color: "var(--atlas-muted)", fontFamily: "var(--app-font-mono)", letterSpacing: "0.08em", marginBottom: 8 }}>
                  COMMIT MESSAGE
                </div>
                <input
                  value={commitMsg}
                  onChange={(e) => setCommitMsg(e.target.value)}
                  placeholder="describe the change"
                  style={{
                    width: "100%", padding: "8px 11px", borderRadius: 6,
                    background: "rgba(0,0,0,0.3)", border: "1px solid var(--atlas-border)",
                    color: "var(--atlas-fg)", fontSize: 12,
                    outline: "none", boxSizing: "border-box",
                  }}
                  onFocus={(e) => (e.currentTarget.style.borderColor = "rgba(201,162,76,0.4)")}
                  onBlur={(e) => (e.currentTarget.style.borderColor = "var(--atlas-border)")}
                />
              </div>

              {!linkedRepo && (
                <div style={{
                  padding: "9px 12px", borderRadius: 6, marginBottom: 14,
                  background: "rgba(239,68,68,0.08)", border: "1px solid rgba(239,68,68,0.2)",
                  fontSize: 12, color: "rgba(252,165,165,0.8)",
                }}>
                  No repo linked. Open the Files tab and link a GitHub repo to this project first.
                </div>
              )}

              {error && (
                <div style={{
                  padding: "9px 12px", borderRadius: 6, marginBottom: 14,
                  background: "rgba(239,68,68,0.08)", border: "1px solid rgba(239,68,68,0.2)",
                  fontSize: 12, color: "rgba(252,165,165,0.8)",
                }}>
                  {error}
                </div>
              )}
            </>
          )}
        </div>

        {/* Footer */}
        {!success && (
          <div style={{
            padding: "14px 20px",
            borderTop: "1px solid var(--atlas-border)",
            display: "flex", gap: 10, justifyContent: "flex-end",
          }}>
            <button
              onClick={onClose}
              style={{
                padding: "8px 16px", borderRadius: 6, fontSize: 12,
                background: "transparent", border: "1px solid var(--atlas-border)",
                color: "var(--atlas-muted)", cursor: "pointer",
              }}
            >
              Cancel
            </button>
            <button
              onClick={handlePush}
              disabled={pushing || !linkedRepo}
              style={{
                padding: "8px 18px", borderRadius: 6, fontSize: 12, fontWeight: 600,
                background: "linear-gradient(180deg, var(--atlas-gold) 0%, color-mix(in oklab, var(--atlas-gold) 78%, #6a4a18) 100%)",
                color: "var(--atlas-bg)", border: "none",
                cursor: pushing || !linkedRepo ? "not-allowed" : "pointer",
                opacity: pushing || !linkedRepo ? 0.5 : 1,
                transition: "opacity 160ms ease",
              }}
            >
              {pushing ? "Pushing…" : "Push to GitHub"}
            </button>
          </div>
        )}
      </div>
    </div>
  );
}

function AssistantBubble({
  message,
  projectId,
  sessionId,
  linkedRepo,
  onCatchProceed,
  onCatchAdjust,
  onPark,
  onCommit,
}: {
  message: ChatMessage;
  projectId: number;
  sessionId: number;
  linkedRepo: LinkedRepo | null;
  onCatchProceed: () => void;
  onCatchAdjust: () => void;
  onPark: (content: string) => void;
  onCommit: (content: string) => void;
}) {
  const [hov, setHov] = useState(false);
  const [parkDone, setParkDone] = useState(false);
  const [commitDone, setCommitDone] = useState(false);
  const [showPushModal, setShowPushModal] = useState(false);

  return (
    <div
      className="atlas-bubble-in"
      style={{ display: "flex", justifyContent: "flex-start", marginBottom: 24 }}
      onMouseEnter={() => setHov(true)}
      onMouseLeave={() => setHov(false)}
    >
      <div style={{ maxWidth: "80%" }}>
        <div
          style={{
            fontFamily: "var(--app-font-mono)", fontSize: 9,
            letterSpacing: "0.12em", textTransform: "uppercase",
            color: "var(--atlas-gold)", opacity: 0.45, marginBottom: 7,
          }}
        >
          Atlas
        </div>
        <div style={{ fontSize: 14, lineHeight: 1.78, color: "var(--atlas-fg)", opacity: 0.9, whiteSpace: "pre-wrap" }}>
          {message.content}
        </div>

        {/* Code ready card */}
        {message.fileEdit && (
          <div
            style={{
              marginTop: 12, padding: "11px 14px",
              borderRadius: 8,
              background: "rgba(201,162,76,0.05)",
              border: "1px solid rgba(201,162,76,0.2)",
              display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12,
            }}
          >
            <div style={{ display: "flex", alignItems: "center", gap: 9, minWidth: 0 }}>
              <div style={{
                width: 26, height: 26, borderRadius: 6, flexShrink: 0,
                background: "rgba(201,162,76,0.12)", border: "1px solid rgba(201,162,76,0.25)",
                display: "flex", alignItems: "center", justifyContent: "center",
              }}>
                <svg width="12" height="12" viewBox="0 0 16 16" fill="none">
                  <path d="M3 2h8l3 3v9a1 1 0 01-1 1H3a1 1 0 01-1-1V3a1 1 0 011-1z" stroke="var(--atlas-gold)" strokeWidth="1.2" />
                  <path d="M11 2v4h4" stroke="var(--atlas-gold)" strokeWidth="1.2" />
                  <path d="M5 8.5h6M5 11h4" stroke="var(--atlas-gold)" strokeWidth="1.1" strokeLinecap="round" />
                </svg>
              </div>
              <div style={{ minWidth: 0 }}>
                <div style={{ fontSize: 11, fontWeight: 600, color: "var(--atlas-gold)", marginBottom: 2 }}>
                  Code ready
                </div>
                <div style={{
                  fontFamily: "var(--app-font-mono)", fontSize: 10,
                  color: "var(--atlas-muted)",
                  overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap",
                }}>
                  {message.fileEdit.path}
                  <span style={{ opacity: 0.5, marginLeft: 6 }}>
                    · {message.fileEdit.content.split("\n").length} lines
                  </span>
                </div>
              </div>
            </div>
            <button
              onClick={() => setShowPushModal(true)}
              style={{
                flexShrink: 0,
                padding: "6px 13px", borderRadius: 5, fontSize: 11, fontWeight: 600,
                fontFamily: "var(--app-font-mono)", letterSpacing: "0.08em",
                background: "linear-gradient(180deg, var(--atlas-gold) 0%, color-mix(in oklab, var(--atlas-gold) 78%, #6a4a18) 100%)",
                color: "var(--atlas-bg)", border: "none", cursor: "pointer",
                boxShadow: "0 0 12px -4px color-mix(in oklab, var(--atlas-gold) 50%, transparent)",
                transition: "opacity 160ms ease",
              }}
              onMouseEnter={(e) => (e.currentTarget.style.opacity = "0.85")}
              onMouseLeave={(e) => (e.currentTarget.style.opacity = "1")}
            >
              Review &amp; Push →
            </button>
          </div>
        )}

        {message.catchPayload && !message.catchResolved && (
          <DecisionCatchCard
            payload={message.catchPayload}
            projectId={projectId}
            sessionId={sessionId}
            onProceed={onCatchProceed}
            onAdjust={onCatchAdjust}
          />
        )}

        {/* Park / Commit actions */}
        <div
          style={{
            display: "flex", gap: 5, marginTop: 9,
            opacity: hov ? 1 : 0,
            transition: "opacity 180ms ease",
          }}
        >
          <button
            onClick={() => { if (!parkDone) { onPark(message.content); setParkDone(true); } }}
            style={{
              display: "flex", alignItems: "center", gap: 4,
              padding: "3px 9px", borderRadius: 4,
              background: parkDone ? "rgba(120,113,108,0.12)" : "transparent",
              border: `1px solid ${parkDone ? "rgba(120,113,108,0.2)" : "rgba(120,113,108,0.3)"}`,
              color: parkDone ? "rgba(120,113,108,0.55)" : "var(--atlas-muted)",
              fontSize: 9.5, fontFamily: "var(--app-font-mono)", letterSpacing: "0.1em",
              textTransform: "uppercase" as const,
              cursor: parkDone ? "default" : "pointer",
              transition: "all 160ms ease",
            }}
          >
            <svg width="9" height="9" viewBox="0 0 10 10" fill="none">
              <path d="M5 1v6M2 7h6M3.5 3.5L5 1l1.5 2.5" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
            {parkDone ? "Parked" : "Park"}
          </button>
          <button
            onClick={() => { if (!commitDone) { onCommit(message.content); setCommitDone(true); } }}
            style={{
              display: "flex", alignItems: "center", gap: 4,
              padding: "3px 9px", borderRadius: 4,
              background: commitDone ? "rgba(201,162,76,0.08)" : "transparent",
              border: `1px solid ${commitDone ? "rgba(201,162,76,0.3)" : "rgba(201,162,76,0.2)"}`,
              color: commitDone ? "var(--atlas-gold)" : "rgba(201,162,76,0.6)",
              fontSize: 9.5, fontFamily: "var(--app-font-mono)", letterSpacing: "0.1em",
              textTransform: "uppercase" as const,
              cursor: commitDone ? "default" : "pointer",
              transition: "all 160ms ease",
            }}
          >
            <svg width="9" height="9" viewBox="0 0 10 10" fill="none">
              <path d="M1.5 5.5l2.5 2.5 4.5-5" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
            {commitDone ? "Committed" : "Commit"}
          </button>
        </div>
      </div>

      {showPushModal && message.fileEdit && (
        <GitHubPushModal
          fileEdit={message.fileEdit}
          linkedRepo={linkedRepo}
          projectId={projectId}
          onClose={() => setShowPushModal(false)}
        />
      )}
    </div>
  );
}

// ── Ledger tab content ───────────────────────────────────────────────────────
function LedgerEntry({ entry }: { entry: Entry }) {
  const committed = entry.status === "committed";
  const severity = entry.severity as "blocker" | "parked" | "committed" | "neutral";

  const wrapperGradient = committed
    ? `linear-gradient(135deg,
        color-mix(in oklab, var(--atlas-gold) 55%, transparent) 0%,
        color-mix(in oklab, var(--atlas-gold) 18%, transparent) 28%,
        transparent 55%,
        color-mix(in oklab, var(--atlas-bg) 80%, transparent) 100%)`
    : `linear-gradient(135deg,
        color-mix(in oklab, var(--atlas-gold) 22%, transparent) 0%,
        color-mix(in oklab, var(--atlas-border) 70%, transparent) 60%,
        transparent 100%)`;

  const wrapperShadow = committed
    ? `0 1px 0 0 color-mix(in oklab, var(--atlas-gold) 8%, transparent) inset, 0 12px 32px -18px rgba(0,0,0,0.55)`
    : `0 6px 20px -14px rgba(0,0,0,0.4)`;

  const innerBg = committed
    ? "color-mix(in oklab, var(--atlas-bg) 92%, var(--atlas-surface))"
    : "var(--atlas-surface)";

  return (
    <article
      style={{
        padding: "0.5px", borderRadius: 6, marginBottom: 6,
        background: wrapperGradient,
        boxShadow: wrapperShadow,
      }}
    >
      <div
        style={{
          background: innerBg,
          borderRadius: 5.5,
          overflow: "hidden",
          backdropFilter: committed ? "blur(18px)" : "none",
          WebkitBackdropFilter: committed ? "blur(18px)" : "none",
        }}
      >
        {/* Header */}
        <div style={{ display: "flex", alignItems: "flex-start", gap: 10, padding: "10px 13px 8px" }}>
          <div style={{ paddingTop: 2, flexShrink: 0 }}>
            <StatusGlyph severity={severity} verb={entry.verb} size={14} />
          </div>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ display: "flex", alignItems: "center", gap: 6, flexWrap: "wrap" as const }}>
              <span style={{
                fontSize: 12.5, fontWeight: 600, lineHeight: 1.35, letterSpacing: "-0.01em",
                color: committed ? "rgba(231,229,228,0.92)" : "rgba(231,229,228,0.5)",
              }}>
                {entry.title}
              </span>
              {committed && <CapsuleTag severity="committed" size="xs">LOCKED</CapsuleTag>}
              {entry.deviation && <CapsuleTag severity="blocker" size="xs">DEVIATION</CapsuleTag>}
            </div>
          </div>
        </div>

        {/* Body */}
        {entry.summary && (
          <div style={{ padding: "0 13px 9px 37px" }}>
            <p style={{ margin: 0, fontSize: 11.5, lineHeight: 1.55, color: "var(--atlas-muted)" }}>
              {entry.summary}
            </p>
          </div>
        )}

        {/* Divider */}
        <div style={{
          margin: "0 13px", height: 1,
          background: "linear-gradient(to right, transparent, var(--atlas-border), transparent)",
        }} />

        {/* Footer */}
        <div style={{ display: "flex", alignItems: "center", gap: 6, padding: "5px 13px 7px" }}>
          <span style={{
            fontFamily: "var(--app-font-mono)", fontSize: 9, letterSpacing: "0.1em",
            textTransform: "uppercase", color: "var(--atlas-muted)", opacity: 0.45,
          }}>
            {new Date(entry.createdAt).toLocaleDateString("en-US", { month: "short", day: "numeric" })}
          </span>
          {entry.mode && (
            <span style={{
              marginLeft: "auto",
              fontFamily: "var(--app-font-mono)", fontSize: 8.5, letterSpacing: "0.1em",
              textTransform: "uppercase", padding: "2px 6px", borderRadius: 2,
              background: "color-mix(in oklab, var(--atlas-gold) 10%, transparent)",
              border: "0.5px solid color-mix(in oklab, var(--atlas-gold) 20%, var(--atlas-border))",
              color: "var(--atlas-gold)",
            }}>
              {entry.mode}
            </span>
          )}
        </div>
      </div>
    </article>
  );
}

function LedgerTab({
  projectId,
  entries,
  activeCatch,
}: {
  projectId: number;
  entries: Entry[];
  activeCatch: CatchPayload | null;
}) {
  const parked = entries.filter((e) => e.status === "parked");

  // Three committed groups — mirrors original DecisionLedgerGrouped
  const inTensionId = activeCatch ? String(activeCatch.against.id) : null;
  const allCommitted = entries.filter((e) => e.status === "committed");
  const committedClean = allCommitted.filter(
    (e) => !e.deviation && String(e.id) !== inTensionId
  );
  const inTension = inTensionId
    ? allCommitted.filter((e) => String(e.id) === inTensionId)
    : [];
  const overridden = allCommitted.filter((e) => e.deviation);

  const [showAdd, setShowAdd] = useState(false);
  const [newTitle, setNewTitle] = useState("");
  const createEntry = useCreateEntry();
  const queryClient = useQueryClient();

  const handleAdd = () => {
    if (!newTitle.trim()) return;
    createEntry.mutate(
      { projectId, data: { title: newTitle.trim(), status: "committed", severity: "committed", mode: "decide" } },
      {
        onSuccess: () => {
          queryClient.invalidateQueries({ queryKey: getListEntriesQueryKey(projectId, {}) });
          setNewTitle(""); setShowAdd(false);
        },
      }
    );
  };

  return (
    <div style={{ flex: 1, display: "flex", flexDirection: "column", overflow: "hidden" }}>
      {/* Add entry inline */}
      {showAdd && (
        <div style={{ padding: "10px 12px", borderBottom: "1px solid var(--atlas-border)", flexShrink: 0 }}>
          <input
            autoFocus value={newTitle}
            onChange={(e) => setNewTitle(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") handleAdd();
              if (e.key === "Escape") { setShowAdd(false); setNewTitle(""); }
            }}
            placeholder="Decision title…"
            style={{
              width: "100%", padding: "8px 10px", borderRadius: 6, marginBottom: 6,
              background: "rgba(12,10,9,0.6)", border: "1px solid var(--atlas-border)",
              color: "var(--atlas-fg)", fontSize: 12, outline: "none",
              fontFamily: "var(--app-font-sans)", transition: "border-color 160ms ease",
            }}
            onFocus={(e) => (e.currentTarget.style.borderColor = "rgba(201,162,76,0.35)")}
            onBlur={(e) => (e.currentTarget.style.borderColor = "var(--atlas-border)")}
          />
          <button
            onClick={handleAdd} disabled={createEntry.isPending}
            style={{
              width: "100%", padding: "7px", borderRadius: 6,
              background: "var(--atlas-ember)", border: "none",
              color: "var(--atlas-fg)", fontSize: 11,
              fontFamily: "var(--app-font-mono)", letterSpacing: "0.08em",
              cursor: createEntry.isPending ? "not-allowed" : "pointer",
              opacity: createEntry.isPending ? 0.6 : 1,
            }}
          >
            Commit
          </button>
        </div>
      )}

      {/* Entries list */}
      <div style={{ flex: 1, overflowY: "auto", padding: "12px" }} className="scrollbar-none">
        {entries.length === 0 ? (
          <div style={{ textAlign: "center", padding: "36px 12px", color: "var(--atlas-muted)", fontSize: 12, opacity: 0.5, lineHeight: 1.65 }}>
            Decisions made during your session will appear here.
          </div>
        ) : (
          <>
            {/* ── Group 1: Committed ── */}
            <div style={{ marginBottom: 22 }}>
              <div style={{ display: "flex", alignItems: "center", gap: 7, marginBottom: 10, padding: "0 2px" }}>
                <span style={{ width: 6, height: 6, borderRadius: "50%", flexShrink: 0, background: "var(--atlas-phosphor)", boxShadow: "0 0 6px color-mix(in oklab, var(--atlas-phosphor) 55%, transparent)" }} />
                <span style={{ fontFamily: "var(--app-font-mono)", fontSize: 9.5, letterSpacing: "0.14em", textTransform: "uppercase" as const, color: "var(--atlas-phosphor)" }}>
                  Committed
                </span>
                <span style={{ fontFamily: "var(--app-font-mono)", fontSize: 9.5, letterSpacing: "0.06em", color: "var(--atlas-muted)", marginLeft: "auto" }}>
                  {committedClean.length}
                </span>
              </div>
              {committedClean.length > 0 ? (
                committedClean.map((e) => <LedgerEntry key={e.id} entry={e} />)
              ) : (
                <div style={{ fontSize: 11, color: "var(--atlas-muted)", opacity: 0.45, padding: "6px 2px", lineHeight: 1.55 }}>
                  No committed decisions yet.
                </div>
              )}
            </div>

            {/* ── Group 2: In Tension ── */}
            <div style={{ marginBottom: 22 }}>
              <div style={{ display: "flex", alignItems: "center", gap: 7, marginBottom: 10, padding: "0 2px" }}>
                <span
                  aria-hidden
                  style={{
                    width: 6, height: 6, borderRadius: "50%", flexShrink: 0,
                    background: inTension.length > 0 ? "var(--atlas-ember)" : "var(--atlas-muted)",
                    boxShadow: inTension.length > 0
                      ? "0 0 8px color-mix(in oklab, var(--atlas-ember) 65%, transparent)"
                      : "none",
                    transition: "background 300ms ease, box-shadow 300ms ease",
                  }}
                />
                <span style={{ fontFamily: "var(--app-font-mono)", fontSize: 9.5, letterSpacing: "0.14em", textTransform: "uppercase" as const, color: inTension.length > 0 ? "var(--atlas-ember)" : "var(--atlas-muted)", transition: "color 300ms ease" }}>
                  In Tension
                </span>
                {inTension.length > 0 && (
                  <span style={{ fontFamily: "var(--app-font-mono)", fontSize: 9.5, letterSpacing: "0.06em", color: "var(--atlas-ember)", opacity: 0.7, marginLeft: "auto" }}>
                    {inTension.length}
                  </span>
                )}
              </div>
              {inTension.length > 0 ? (
                inTension.map((e) => (
                  <div
                    key={e.id}
                    style={{
                      borderRadius: 8,
                      border: "0.5px solid color-mix(in oklab, var(--atlas-ember) 30%, var(--atlas-border))",
                      background: "color-mix(in oklab, var(--atlas-ember) 4%, transparent)",
                      overflow: "hidden",
                    }}
                  >
                    <LedgerEntry entry={e} />
                  </div>
                ))
              ) : (
                <div style={{ fontSize: 11, color: "var(--atlas-muted)", opacity: 0.4, padding: "6px 2px", lineHeight: 1.55 }}>
                  No open tensions.
                </div>
              )}
            </div>

            {/* ── Group 3: Overridden ── */}
            <div style={{ marginBottom: 22 }}>
              <div style={{ display: "flex", alignItems: "center", gap: 7, marginBottom: 10, padding: "0 2px" }}>
                <span style={{ width: 6, height: 6, borderRadius: "50%", flexShrink: 0, background: "var(--atlas-muted)", opacity: 0.5 }} />
                <span style={{ fontFamily: "var(--app-font-mono)", fontSize: 9.5, letterSpacing: "0.14em", textTransform: "uppercase" as const, color: "var(--atlas-muted)", opacity: 0.65 }}>
                  Overridden
                </span>
                {overridden.length > 0 && (
                  <span style={{ fontFamily: "var(--app-font-mono)", fontSize: 9.5, letterSpacing: "0.06em", color: "var(--atlas-muted)", opacity: 0.5, marginLeft: "auto" }}>
                    {overridden.length}
                  </span>
                )}
              </div>
              {overridden.length > 0 ? (
                <div style={{ opacity: 0.65 }}>
                  {overridden.map((e) => <LedgerEntry key={e.id} entry={e} />)}
                </div>
              ) : (
                <div style={{ fontSize: 11, color: "var(--atlas-muted)", opacity: 0.4, padding: "6px 2px", lineHeight: 1.55 }}>
                  Nothing overridden.
                </div>
              )}
            </div>

            {/* ── Parked (parking lot) ── */}
            {parked.length > 0 && (
              <div>
                <div style={{ display: "flex", alignItems: "center", gap: 7, marginBottom: 10, padding: "0 2px" }}>
                  <span style={{ width: 6, height: 6, borderRadius: "50%", flexShrink: 0, background: "var(--atlas-gold)", boxShadow: "0 0 6px color-mix(in oklab, var(--atlas-gold) 45%, transparent)" }} />
                  <span style={{ fontFamily: "var(--app-font-mono)", fontSize: 9.5, letterSpacing: "0.14em", textTransform: "uppercase" as const, color: "var(--atlas-gold)" }}>
                    Parked
                  </span>
                  <span style={{ fontFamily: "var(--app-font-mono)", fontSize: 9.5, letterSpacing: "0.06em", color: "var(--atlas-muted)", marginLeft: "auto" }}>
                    {parked.length}
                  </span>
                </div>
                {parked.map((e) => <LedgerEntry key={e.id} entry={e} />)}
              </div>
            )}
          </>
        )}
      </div>

      {/* Footer add button */}
      <div style={{ padding: "8px 12px", borderTop: "1px solid var(--atlas-border)", flexShrink: 0 }}>
        <button
          onClick={() => setShowAdd(!showAdd)}
          style={{
            width: "100%", padding: "7px", borderRadius: 6,
            background: "transparent",
            border: "1px dashed rgba(201,162,76,0.2)",
            color: "var(--atlas-muted)", fontSize: 11,
            fontFamily: "var(--app-font-mono)", letterSpacing: "0.1em",
            textTransform: "uppercase",
            cursor: "pointer", opacity: 0.65,
            transition: "all 160ms ease",
          }}
          onMouseEnter={(e) => { e.currentTarget.style.opacity = "1"; e.currentTarget.style.borderColor = "rgba(201,162,76,0.45)"; }}
          onMouseLeave={(e) => { e.currentTarget.style.opacity = "0.65"; e.currentTarget.style.borderColor = "rgba(201,162,76,0.2)"; }}
        >
          + Add decision
        </button>
      </div>
    </div>
  );
}

// ── GitHub file browser ───────────────────────────────────────────────────────
interface GhRepo {
  id: number;
  name: string;
  fullName: string;
  private: boolean;
  description: string | null;
  language: string | null;
  defaultBranch: string;
  updatedAt: string;
}

interface GhTreeItem {
  path: string;
  type: "blob" | "tree";
  sha: string;
}

interface GhFileContent {
  path: string;
  content: string;
  size: number;
  truncated: boolean;
  lines: number;
}


function FileIcon({ ext }: { ext?: string }) {
  const color =
    ext === "md" ? "#C9A24C"
    : ext === "ts" || ext === "tsx" ? "#60a5fa"
    : ext === "js" || ext === "jsx" ? "#fbbf24"
    : ext === "css" ? "#a78bfa"
    : ext === "json" ? "#34d399"
    : "rgba(120,113,108,0.7)";
  return (
    <svg width="12" height="12" viewBox="0 0 16 16" fill="none" style={{ flexShrink: 0 }}>
      <path d="M3 2h7l3 3v9a1 1 0 01-1 1H3a1 1 0 01-1-1V3a1 1 0 011-1z" stroke={color} strokeWidth="1.1" />
      <path d="M10 2v3h3" stroke={color} strokeWidth="1.1" strokeLinejoin="round" />
    </svg>
  );
}

function FolderIcon({ open }: { open?: boolean }) {
  return (
    <svg width="12" height="12" viewBox="0 0 16 16" fill="none" style={{ flexShrink: 0 }}>
      <path
        d="M1 4h5l1.5 1.5H15v8H1V4z"
        stroke={open ? "rgba(201,162,76,0.7)" : "rgba(201,162,76,0.45)"}
        strokeWidth="1.1"
        fill={open ? "rgba(201,162,76,0.07)" : "none"}
      />
    </svg>
  );
}

function buildTree(items: GhTreeItem[]): GhTreeNode[] {
  const root: GhTreeNode[] = [];
  const map: Record<string, GhTreeNode> = {};

  const sorted = [...items].sort((a, b) => {
    if (a.type !== b.type) return a.type === "tree" ? -1 : 1;
    return a.path.localeCompare(b.path);
  });

  for (const item of sorted) {
    const parts = item.path.split("/");
    const name = parts[parts.length - 1];
    const ext = name.includes(".") ? name.split(".").pop() : undefined;
    const node: GhTreeNode = { name, path: item.path, type: item.type, ext, children: item.type === "tree" ? [] : undefined };
    map[item.path] = node;

    if (parts.length === 1) {
      root.push(node);
    } else {
      const parentPath = parts.slice(0, -1).join("/");
      const parent = map[parentPath];
      if (parent?.children) parent.children.push(node);
    }
  }

  return root;
}

interface GhTreeNode {
  name: string;
  path: string;
  type: "blob" | "tree";
  ext?: string;
  children?: GhTreeNode[];
}

function GhTreeNodeRow({
  node,
  depth,
  selectedPath,
  onSelect,
}: {
  node: GhTreeNode;
  depth: number;
  selectedPath: string | null;
  onSelect: (path: string) => void;
}) {
  const [open, setOpen] = useState(depth < 1);
  const isSelected = selectedPath === node.path;

  if (node.type === "tree") {
    return (
      <div>
        <button
          onClick={() => setOpen((o) => !o)}
          style={{
            width: "100%", display: "flex", alignItems: "center",
            gap: 5, padding: `3px 8px 3px ${8 + depth * 12}px`,
            background: "transparent", border: "none", cursor: "pointer",
            borderRadius: 3, transition: "background 100ms ease",
          }}
          onMouseEnter={(e) => (e.currentTarget.style.background = "rgba(201,162,76,0.04)")}
          onMouseLeave={(e) => (e.currentTarget.style.background = "transparent")}
        >
          <svg width="7" height="7" viewBox="0 0 8 8" fill="none" style={{ flexShrink: 0, opacity: 0.35, transform: open ? "rotate(90deg)" : "rotate(0deg)", transition: "transform 130ms ease" }}>
            <path d="M2 1l4 3-4 3" stroke="var(--atlas-fg)" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
          <FolderIcon open={open} />
          <span style={{ fontSize: 11.5, color: "rgba(231,229,228,0.6)", fontFamily: "var(--app-font-sans)", textAlign: "left" }}>
            {node.name}
          </span>
        </button>
        {open && node.children?.map((child) => (
          <GhTreeNodeRow key={child.path} node={child} depth={depth + 1} selectedPath={selectedPath} onSelect={onSelect} />
        ))}
      </div>
    );
  }

  return (
    <button
      onClick={() => onSelect(node.path)}
      style={{
        width: "100%", display: "flex", alignItems: "center",
        gap: 5, padding: `3px 8px 3px ${8 + depth * 12}px`,
        background: isSelected ? "rgba(201,162,76,0.09)" : "transparent",
        border: "none", cursor: "pointer", borderRadius: 3,
        transition: "background 100ms ease",
        borderLeft: isSelected ? "2px solid rgba(201,162,76,0.55)" : "2px solid transparent",
      }}
      onMouseEnter={(e) => { if (!isSelected) e.currentTarget.style.background = "rgba(255,255,255,0.03)"; }}
      onMouseLeave={(e) => { if (!isSelected) e.currentTarget.style.background = "transparent"; }}
    >
      <FileIcon ext={node.ext} />
      <span style={{ fontSize: 11.5, color: isSelected ? "rgba(231,229,228,0.92)" : "rgba(231,229,228,0.5)", fontFamily: "var(--app-font-sans)", textAlign: "left", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
        {node.name}
      </span>
    </button>
  );
}

function FilesTab({
  projectId,
  onFileContext,
}: {
  projectId: number;
  onFileContext: (ctx: string | null) => void;
}) {
  const linkedKey = `atlas-gh-linked-${projectId}`;

  const [tokenState, setTokenState] = useState<string | null>(() => {
    try { return localStorage.getItem("atlas-gh-token"); } catch { return null; }
  });
  const [tokenInput, setTokenInput] = useState("");
  const [repos, setRepos] = useState<GhRepo[]>([]);
  const [reposLoading, setReposLoading] = useState(false);
  const [reposError, setReposError] = useState<string | null>(null);
  const [selectedRepo, setSelectedRepo] = useState<GhRepo | null>(null);
  const [tree, setTree] = useState<GhTreeNode[]>([]);
  const [treeLoading, setTreeLoading] = useState(false);
  const [treeError, setTreeError] = useState<string | null>(null);
  const [repoBranch, setRepoBranch] = useState("main");
  const [selectedPath, setSelectedPath] = useState<string | null>(null);
  const [fileContent, setFileContent] = useState<GhFileContent | null>(null);
  const [fileLoading, setFileLoading] = useState(false);
  const [fileError, setFileError] = useState<string | null>(null);
  const [view, setView] = useState<"repos" | "tree" | "file">("repos");
  const autoLoadedRef = useRef(false);

  // Reset auto-load gate when project switches
  useEffect(() => {
    autoLoadedRef.current = false;
    setSelectedRepo(null);
    setTree([]);
    setSelectedPath(null);
    setFileContent(null);
    setView("repos");
    onFileContext(null);
  }, [projectId]);

  const saveToken = (t: string) => {
    try { localStorage.setItem("atlas-gh-token", t); } catch {}
    setTokenState(t);
  };

  const clearToken = () => {
    try { localStorage.removeItem("atlas-gh-token"); } catch {}
    setTokenState(null);
    setRepos([]); setSelectedRepo(null); setTree([]);
    setSelectedPath(null); setFileContent(null);
    setView("repos");
    onFileContext(null);
  };

  const ghFetch = useCallback(async (path: string) => {
    const res = await fetch(path, { headers: { "x-github-token": tokenState! } });
    if (!res.ok) {
      const d = await res.json().catch(() => ({}));
      throw new Error(d.error || `HTTP ${res.status}`);
    }
    return res.json();
  }, [tokenState]);

  useEffect(() => {
    if (!tokenState) return;
    setReposLoading(true);
    setReposError(null);
    ghFetch("/api/github/repos")
      .then((data) => setRepos(data as GhRepo[]))
      .catch((e) => setReposError(e.message))
      .finally(() => setReposLoading(false));
  }, [tokenState, ghFetch]);

  const loadTree = useCallback(async (repo: GhRepo) => {
    setSelectedRepo(repo);
    setView("tree");
    setTree([]);
    setTreeLoading(true);
    setTreeError(null);
    setSelectedPath(null);
    setFileContent(null);
    onFileContext(null);
    try {
      const data = await ghFetch(`/api/github/tree?repo=${encodeURIComponent(repo.fullName)}&branch=${repo.defaultBranch}`) as any;
      setRepoBranch(data.branch);
      const nodes = buildTree((data.tree as GhTreeItem[]).filter(i => i.type === "blob" || i.type === "tree"));
      setTree(nodes);
    } catch (e: any) {
      setTreeError(e.message);
    } finally {
      setTreeLoading(false);
    }
  }, [ghFetch, onFileContext]);

  // Auto-load linked repo once repos are available
  useEffect(() => {
    if (autoLoadedRef.current || repos.length === 0) return;
    try {
      const saved = localStorage.getItem(linkedKey);
      if (!saved) return;
      const savedRepo = JSON.parse(saved) as GhRepo;
      const match = repos.find(r => r.fullName === savedRepo.fullName);
      if (match) {
        autoLoadedRef.current = true;
        loadTree(match);
      }
    } catch {}
  }, [repos, linkedKey, loadTree]);

  // Link a repo to this project and load its tree
  const pickRepo = useCallback((repo: GhRepo) => {
    try { localStorage.setItem(linkedKey, JSON.stringify(repo)); } catch {}
    loadTree(repo);
  }, [linkedKey, loadTree]);

  // Unlink the repo from this project
  const unlinkRepo = useCallback(() => {
    try { localStorage.removeItem(linkedKey); } catch {}
    autoLoadedRef.current = false;
    setSelectedRepo(null);
    setTree([]);
    setSelectedPath(null);
    setFileContent(null);
    setView("repos");
    onFileContext(null);
  }, [linkedKey, onFileContext]);

  const loadFile = useCallback(async (path: string) => {
    if (!selectedRepo) return;
    setSelectedPath(path);
    setView("file");
    setFileContent(null);
    setFileLoading(true);
    setFileError(null);
    onFileContext(null);
    try {
      const data = await ghFetch(
        `/api/github/file?repo=${encodeURIComponent(selectedRepo.fullName)}&path=${encodeURIComponent(path)}&branch=${repoBranch}`
      ) as GhFileContent;
      setFileContent(data);
      const ctx = `File: ${data.path} (${selectedRepo.fullName}, branch: ${repoBranch})\n\`\`\`\n${data.content}\n\`\`\``;
      onFileContext(ctx);
    } catch (e: any) {
      setFileError(e.message);
    } finally {
      setFileLoading(false);
    }
  }, [selectedRepo, repoBranch, ghFetch, onFileContext]);

  const sMono: React.CSSProperties = { fontFamily: "var(--app-font-mono)" };
  const sMuted = { color: "var(--atlas-muted)", ...sMono };

  // Token setup screen
  if (!tokenState) {
    return (
      <div style={{ flex: 1, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", padding: "24px 18px", gap: 14 }}>
        <svg width="30" height="30" viewBox="0 0 24 24" fill="none" opacity={0.25}>
          <path d="M12 2C6.48 2 2 6.48 2 12c0 4.42 2.87 8.17 6.84 9.49.5.09.68-.22.68-.48v-1.69c-2.78.6-3.37-1.34-3.37-1.34-.46-1.16-1.11-1.47-1.11-1.47-.91-.62.07-.61.07-.61 1 .07 1.53 1.03 1.53 1.03.89 1.52 2.34 1.08 2.91.83.09-.65.35-1.08.63-1.33-2.22-.25-4.55-1.11-4.55-4.94 0-1.09.39-1.98 1.03-2.68-.1-.25-.45-1.27.1-2.64 0 0 .84-.27 2.75 1.02A9.56 9.56 0 0112 6.8c.85.004 1.71.11 2.51.33 1.91-1.29 2.75-1.02 2.75-1.02.55 1.37.2 2.39.1 2.64.64.7 1.03 1.59 1.03 2.68 0 3.84-2.34 4.68-4.57 4.93.36.31.68.92.68 1.85v2.74c0 .27.18.58.69.48A10.01 10.01 0 0022 12c0-5.52-4.48-10-10-10z" fill="var(--atlas-fg)" />
        </svg>
        <div style={{ textAlign: "center" }}>
          <div style={{ fontSize: 12.5, color: "var(--atlas-fg)", opacity: 0.7, fontWeight: 500, marginBottom: 5 }}>Connect GitHub</div>
          <div style={{ fontSize: 11, color: "var(--atlas-muted)", lineHeight: 1.6, opacity: 0.6 }}>
            Paste a GitHub personal access token<br />to browse your repos.
          </div>
        </div>
        <div style={{ width: "100%", display: "flex", flexDirection: "column", gap: 7 }}>
          <input
            type="password"
            value={tokenInput}
            onChange={(e) => setTokenInput(e.target.value)}
            onKeyDown={(e) => { if (e.key === "Enter" && tokenInput.trim()) saveToken(tokenInput.trim()); }}
            placeholder="ghp_…"
            autoComplete="off"
            style={{
              width: "100%", padding: "8px 10px", borderRadius: 6,
              background: "rgba(12,10,9,0.7)", border: "1px solid var(--atlas-border)",
              color: "var(--atlas-fg)", fontSize: 11, fontFamily: "var(--app-font-mono)",
              outline: "none", boxSizing: "border-box",
              transition: "border-color 160ms ease",
            }}
            onFocus={(e) => (e.currentTarget.style.borderColor = "rgba(201,162,76,0.4)")}
            onBlur={(e) => (e.currentTarget.style.borderColor = "var(--atlas-border)")}
          />
          <button
            onClick={() => tokenInput.trim() && saveToken(tokenInput.trim())}
            disabled={!tokenInput.trim()}
            style={{
              padding: "7px", borderRadius: 6, width: "100%",
              background: tokenInput.trim() ? "var(--atlas-ember)" : "rgba(37,34,32,0.6)",
              border: "none", color: "var(--atlas-fg)", fontSize: 10,
              fontFamily: "var(--app-font-mono)", letterSpacing: "0.1em",
              textTransform: "uppercase", cursor: tokenInput.trim() ? "pointer" : "not-allowed",
              transition: "background 160ms ease",
            }}
          >
            Connect
          </button>
        </div>
        <a
          href="https://github.com/settings/tokens/new?description=Atlas+Dev+Env&scopes=repo"
          target="_blank"
          rel="noopener noreferrer"
          style={{ fontSize: 9.5, color: "var(--atlas-gold)", opacity: 0.6, fontFamily: "var(--app-font-mono)", letterSpacing: "0.06em" }}
        >
          Create token on GitHub →
        </a>
      </div>
    );
  }

  return (
    <div style={{ flex: 1, display: "flex", flexDirection: "column", overflow: "hidden" }}>
      {/* Header breadcrumb */}
      <div style={{ padding: "7px 10px", borderBottom: "1px solid var(--atlas-border)", flexShrink: 0, display: "flex", alignItems: "center", gap: 6, minWidth: 0 }}>
        <button
          onClick={() => { setView("repos"); setSelectedRepo(null); setSelectedPath(null); setFileContent(null); onFileContext(null); }}
          style={{ background: "transparent", border: "none", cursor: "pointer", padding: 0, color: view === "repos" ? "var(--atlas-fg)" : "var(--atlas-muted)", fontSize: 10, fontFamily: "var(--app-font-mono)", letterSpacing: "0.08em", opacity: view === "repos" ? 0.8 : 0.45, flexShrink: 0 }}
        >
          repos
        </button>
        {selectedRepo && (
          <>
            <span style={{ color: "var(--atlas-border)", fontSize: 10, flexShrink: 0 }}>/</span>
            <button
              onClick={() => { setView("tree"); setSelectedPath(null); setFileContent(null); onFileContext(null); }}
              style={{ background: "transparent", border: "none", cursor: "pointer", padding: 0, color: view === "tree" ? "var(--atlas-gold)" : "var(--atlas-muted)", fontSize: 10, fontFamily: "var(--app-font-mono)", letterSpacing: "0.08em", opacity: view === "tree" ? 1 : 0.5, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", maxWidth: 90 }}
            >
              {selectedRepo.name}
            </button>
            {/* Linked badge + unlink */}
            <span
              title="Linked to this project — auto-loads next time"
              style={{
                display: "inline-flex", alignItems: "center", gap: 3,
                padding: "1px 5px", borderRadius: 3, flexShrink: 0,
                background: "rgba(52,211,153,0.07)",
                border: "0.5px solid rgba(52,211,153,0.2)",
              }}
            >
              <span style={{ width: 4, height: 4, borderRadius: "50%", background: "#34d399", flexShrink: 0 }} />
              <span style={{ fontSize: 7.5, fontFamily: "var(--app-font-mono)", letterSpacing: "0.1em", color: "#34d399" }}>linked</span>
            </span>
          </>
        )}
        {selectedPath && (
          <>
            <span style={{ color: "var(--atlas-border)", fontSize: 10, flexShrink: 0 }}>/</span>
            <span style={{ color: "var(--atlas-gold)", fontSize: 10, fontFamily: "var(--app-font-mono)", opacity: 0.8, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", maxWidth: 80 }}>
              {selectedPath.split("/").pop()}
            </span>
          </>
        )}
        <div style={{ marginLeft: "auto", display: "flex", alignItems: "center", gap: 4, flexShrink: 0 }}>
          {selectedRepo && (
            <button
              onClick={unlinkRepo}
              title="Unlink repo from this project"
              style={{ background: "transparent", border: "none", cursor: "pointer", color: "var(--atlas-muted)", fontSize: 9, fontFamily: "var(--app-font-mono)", letterSpacing: "0.06em", opacity: 0.35, padding: "2px 4px" }}
              onMouseEnter={(e) => (e.currentTarget.style.opacity = "0.8")}
              onMouseLeave={(e) => (e.currentTarget.style.opacity = "0.35")}
            >
              unlink
            </button>
          )}
          <button
            onClick={clearToken}
            title="Disconnect GitHub"
            style={{ background: "transparent", border: "none", cursor: "pointer", color: "var(--atlas-muted)", fontSize: 14, lineHeight: 1, opacity: 0.3, padding: "0 2px" }}
            onMouseEnter={(e) => (e.currentTarget.style.opacity = "0.7")}
            onMouseLeave={(e) => (e.currentTarget.style.opacity = "0.3")}
          >
            ×
          </button>
        </div>
      </div>

      {/* Repos list */}
      {view === "repos" && (
        <div style={{ flex: 1, overflowY: "auto", padding: "8px 6px" }} className="scrollbar-none">
          {reposLoading && (
            <div style={{ padding: "24px 12px", textAlign: "center", fontSize: 10, ...sMuted, opacity: 0.4 }}>
              Loading repos…
            </div>
          )}
          {reposError && (
            <div style={{ padding: "16px 12px", textAlign: "center", fontSize: 11, color: "var(--atlas-ember)", fontFamily: "var(--app-font-mono)" }}>
              {reposError}
            </div>
          )}
          {!reposLoading && repos.map((repo) => {
            let linkedFullName: string | null = null;
            try {
              const saved = localStorage.getItem(linkedKey);
              linkedFullName = saved ? JSON.parse(saved).fullName : null;
            } catch {}
            const isLinked = linkedFullName === repo.fullName;
            return (
              <button
                key={repo.id}
                onClick={() => pickRepo(repo)}
                style={{
                  width: "100%", display: "flex", flexDirection: "column", gap: 3,
                  padding: "8px 10px", borderRadius: 5, marginBottom: 2,
                  background: isLinked ? "rgba(52,211,153,0.04)" : "transparent",
                  border: `1px solid ${isLinked ? "rgba(52,211,153,0.15)" : "transparent"}`,
                  cursor: "pointer", textAlign: "left",
                  transition: "all 120ms ease",
                }}
                onMouseEnter={(e) => {
                  if (!isLinked) { e.currentTarget.style.background = "rgba(201,162,76,0.04)"; e.currentTarget.style.borderColor = "rgba(201,162,76,0.12)"; }
                }}
                onMouseLeave={(e) => {
                  if (!isLinked) { e.currentTarget.style.background = "transparent"; e.currentTarget.style.borderColor = "transparent"; }
                }}
              >
                <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                  {isLinked && (
                    <span style={{ width: 5, height: 5, borderRadius: "50%", background: "#34d399", flexShrink: 0 }} />
                  )}
                  <span style={{ fontSize: 12, color: isLinked ? "rgba(231,229,228,0.92)" : "rgba(231,229,228,0.75)", fontFamily: "var(--app-font-sans)", fontWeight: isLinked ? 600 : 500 }}>{repo.name}</span>
                  {repo.private && (
                    <span style={{ fontSize: 8, fontFamily: "var(--app-font-mono)", letterSpacing: "0.08em", padding: "1px 5px", borderRadius: 3, background: "rgba(120,113,108,0.12)", color: "var(--atlas-muted)", border: "0.5px solid rgba(120,113,108,0.2)" }}>
                      private
                    </span>
                  )}
                  {repo.language && (
                    <span style={{ fontSize: 8.5, color: "var(--atlas-muted)", marginLeft: "auto", fontFamily: "var(--app-font-mono)", opacity: 0.55 }}>{repo.language}</span>
                  )}
                </div>
                {repo.description && (
                  <div style={{ fontSize: 10.5, color: "var(--atlas-muted)", opacity: 0.55, lineHeight: 1.4, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", paddingLeft: isLinked ? 11 : 0 }}>
                    {repo.description}
                  </div>
                )}
              </button>
            );
          })}
        </div>
      )}

      {/* File tree */}
      {view === "tree" && (
        <div style={{ flex: 1, overflowY: "auto", padding: "6px 2px" }} className="scrollbar-none">
          {treeLoading && (
            <div style={{ padding: "24px 12px", textAlign: "center", fontSize: 10, ...sMuted, opacity: 0.4 }}>
              Loading tree…
            </div>
          )}
          {treeError && (
            <div style={{ padding: "16px 12px", textAlign: "center", fontSize: 11, color: "var(--atlas-ember)", fontFamily: "var(--app-font-mono)" }}>
              {treeError}
            </div>
          )}
          {!treeLoading && tree.map((node) => (
            <GhTreeNodeRow key={node.path} node={node} depth={0} selectedPath={selectedPath} onSelect={loadFile} />
          ))}
        </div>
      )}

      {/* File content */}
      {view === "file" && (
        <div style={{ flex: 1, display: "flex", flexDirection: "column", overflow: "hidden" }}>
          {fileLoading && (
            <div style={{ padding: "24px 12px", textAlign: "center", fontSize: 10, ...sMuted, opacity: 0.4 }}>
              Loading file…
            </div>
          )}
          {fileError && (
            <div style={{ padding: "16px 12px", textAlign: "center", fontSize: 11, color: "var(--atlas-ember)", fontFamily: "var(--app-font-mono)" }}>
              {fileError}
            </div>
          )}
          {fileContent && (
            <>
              <div style={{ padding: "6px 10px 5px", borderBottom: "1px solid var(--atlas-border)", flexShrink: 0, display: "flex", alignItems: "center", gap: 8 }}>
                <span style={{ fontSize: 9.5, fontFamily: "var(--app-font-mono)", color: "var(--atlas-gold)", opacity: 0.75, letterSpacing: "0.04em" }}>
                  {fileContent.lines} lines{fileContent.truncated ? " (truncated)" : ""}
                </span>
                <span style={{ fontSize: 9, fontFamily: "var(--app-font-mono)", color: "var(--atlas-muted)", opacity: 0.4, letterSpacing: "0.04em" }}>
                  {Math.round(fileContent.size / 1024 * 10) / 10} KB
                </span>
                <div style={{
                  marginLeft: "auto", display: "flex", alignItems: "center", gap: 4,
                  padding: "2px 7px", borderRadius: 4,
                  background: "rgba(52,211,153,0.08)", border: "0.5px solid rgba(52,211,153,0.2)",
                }}>
                  <span style={{ width: 5, height: 5, borderRadius: "50%", background: "#34d399", boxShadow: "0 0 6px rgba(52,211,153,0.6)", flexShrink: 0 }} />
                  <span style={{ fontSize: 8.5, fontFamily: "var(--app-font-mono)", letterSpacing: "0.1em", color: "#34d399" }}>
                    In context
                  </span>
                </div>
              </div>
              <div style={{ flex: 1, overflowY: "auto", padding: "10px 12px" }} className="scrollbar-none">
                <pre style={{
                  margin: 0, fontSize: 10.5, lineHeight: 1.7,
                  color: "rgba(231,229,228,0.65)",
                  fontFamily: "var(--app-font-mono)",
                  whiteSpace: "pre-wrap", wordBreak: "break-all",
                }}>
                  {fileContent.content}
                </pre>
              </div>
            </>
          )}
        </div>
      )}
    </div>
  );
}

// ── Preview tab ──────────────────────────────────────────────────────────────
function PreviewTab({ projectId }: { projectId: number }) {
  const storageKey = `atlas-preview-${projectId}`;
  const [urlInput, setUrlInput] = useState(() => {
    try { return localStorage.getItem(storageKey) || ""; } catch { return ""; }
  });
  const [liveUrl, setLiveUrl] = useState<string>(() => {
    try { return localStorage.getItem(storageKey) || ""; } catch { return ""; }
  });
  const [iframeError, setIframeError] = useState(false);

  // Re-sync when project changes (in case component stays mounted)
  useEffect(() => {
    const saved = localStorage.getItem(`atlas-preview-${projectId}`) || "";
    setUrlInput(saved);
    setLiveUrl(saved);
    setIframeError(false);
  }, [projectId]);

  const handleGo = () => {
    const raw = urlInput.trim();
    if (!raw) return;
    const normalized = raw.startsWith("http://") || raw.startsWith("https://") ? raw : `https://${raw}`;
    setIframeError(false);
    setLiveUrl(normalized);
    try { localStorage.setItem(storageKey, normalized); } catch {}
  };

  const handleClear = () => {
    setLiveUrl("");
    setUrlInput("");
    setIframeError(false);
    try { localStorage.removeItem(storageKey); } catch {}
  };

  return (
    <div style={{ flex: 1, display: "flex", flexDirection: "column", overflow: "hidden" }}>
      {/* URL bar */}
      <div style={{ padding: "8px 12px", borderBottom: "1px solid var(--atlas-border)", flexShrink: 0, display: "flex", gap: 6 }}>
        <div style={{ flex: 1, position: "relative", display: "flex", alignItems: "center" }}>
          <svg width="11" height="11" viewBox="0 0 16 16" fill="none" style={{ position: "absolute", left: 8, opacity: 0.3, flexShrink: 0 }}>
            <circle cx="8" cy="8" r="6" stroke="var(--atlas-fg)" strokeWidth="1.4" />
            <path d="M8 2c-2 3-2 9 0 12M2 8h12" stroke="var(--atlas-fg)" strokeWidth="1.2" strokeLinecap="round" />
          </svg>
          <input
            value={urlInput}
            onChange={(e) => setUrlInput(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && handleGo()}
            placeholder="Enter URL to preview…"
            style={{
              width: "100%", paddingLeft: 26, paddingRight: 8, paddingTop: 6, paddingBottom: 6,
              borderRadius: 6, background: "rgba(12,10,9,0.7)",
              border: "1px solid var(--atlas-border)",
              color: "var(--atlas-fg)", fontSize: 11,
              fontFamily: "var(--app-font-mono)", outline: "none",
              transition: "border-color 160ms ease",
            }}
            onFocus={(e) => (e.currentTarget.style.borderColor = "rgba(201,162,76,0.35)")}
            onBlur={(e) => (e.currentTarget.style.borderColor = "var(--atlas-border)")}
          />
        </div>
        <button
          onClick={handleGo}
          style={{
            padding: "6px 11px", borderRadius: 6,
            background: "var(--atlas-ember)", border: "none",
            color: "var(--atlas-fg)", fontSize: 10,
            fontFamily: "var(--app-font-mono)", letterSpacing: "0.08em",
            cursor: "pointer", flexShrink: 0,
          }}
        >
          Go
        </button>
        {liveUrl && (
          <button
            onClick={handleClear}
            title="Clear"
            style={{
              padding: "6px 8px", borderRadius: 6,
              background: "transparent", border: "1px solid var(--atlas-border)",
              color: "var(--atlas-muted)", fontSize: 12,
              cursor: "pointer", flexShrink: 0, lineHeight: 1,
              opacity: 0.55, transition: "opacity 160ms ease",
            }}
            onMouseEnter={(e) => (e.currentTarget.style.opacity = "1")}
            onMouseLeave={(e) => (e.currentTarget.style.opacity = "0.55")}
          >
            ×
          </button>
        )}
      </div>

      {/* Frame or empty state */}
      {liveUrl && !iframeError ? (
        <iframe
          key={liveUrl}
          src={liveUrl}
          title="Preview"
          style={{ flex: 1, border: "none", width: "100%", display: "block", background: "#fff" }}
          sandbox="allow-scripts allow-same-origin allow-forms allow-popups"
          onError={() => setIframeError(true)}
        />
      ) : iframeError ? (
        <div style={{ flex: 1, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", padding: "32px 20px", gap: 10 }}>
          <svg width="24" height="24" viewBox="0 0 24 24" fill="none" opacity={0.2}>
            <circle cx="12" cy="12" r="9" stroke="var(--atlas-fg)" strokeWidth="1.4" />
            <path d="M12 8v4M12 16h.01" stroke="var(--atlas-fg)" strokeWidth="1.5" strokeLinecap="round" />
          </svg>
          <div style={{ fontSize: 12, color: "var(--atlas-muted)", opacity: 0.55, textAlign: "center", lineHeight: 1.65 }}>
            This page can't be embedded.<br />Try opening it in a new tab.
          </div>
          <a
            href={liveUrl}
            target="_blank"
            rel="noopener noreferrer"
            style={{ fontSize: 10, color: "var(--atlas-gold)", opacity: 0.75, fontFamily: "var(--app-font-mono)", letterSpacing: "0.08em" }}
          >
            Open in new tab →
          </a>
        </div>
      ) : (
        <div style={{ flex: 1, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", padding: "32px 20px", gap: 10 }}>
          <svg width="28" height="28" viewBox="0 0 28 28" fill="none" opacity={0.15}>
            <rect x="2" y="5" width="24" height="18" rx="2" stroke="var(--atlas-fg)" strokeWidth="1.5" />
            <path d="M2 10h24" stroke="var(--atlas-fg)" strokeWidth="1.5" />
            <circle cx="6" cy="7.5" r="1" fill="var(--atlas-fg)" />
            <circle cx="10" cy="7.5" r="1" fill="var(--atlas-fg)" />
          </svg>
          <div style={{ fontSize: 12, color: "var(--atlas-muted)", opacity: 0.45, textAlign: "center", lineHeight: 1.65 }}>
            Enter a deployment URL above.<br />It's saved per project and reloads<br />automatically next time.
          </div>
        </div>
      )}
    </div>
  );
}

// ── MemoryTab ─────────────────────────────────────────────────────────────────
function MemoryTab({ projectId }: { projectId: number }) {
  const queryClient = useQueryClient();
  const { data: project, isLoading } = useGetProject(projectId, {
    query: { queryKey: getGetProjectQueryKey(projectId) },
  });
  const updateProject = useUpdateProject();
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState("");
  const [saving, setSaving] = useState(false);

  const memory = project?.memory ?? "";

  const startEdit = () => {
    setDraft(memory);
    setEditing(true);
  };

  const save = async () => {
    setSaving(true);
    updateProject.mutate(
      { id: projectId, data: { memory: draft.trim() || null } },
      {
        onSuccess: () => {
          queryClient.invalidateQueries({ queryKey: getGetProjectQueryKey(projectId) });
          setEditing(false);
        },
        onSettled: () => setSaving(false),
      }
    );
  };

  const clear = async () => {
    if (!window.confirm("Clear all project memory? This cannot be undone.")) return;
    setSaving(true);
    updateProject.mutate(
      { id: projectId, data: { memory: null } },
      {
        onSuccess: () => {
          queryClient.invalidateQueries({ queryKey: getGetProjectQueryKey(projectId) });
        },
        onSettled: () => setSaving(false),
      }
    );
  };

  const sMono: React.CSSProperties = { fontFamily: "var(--app-font-mono)" };

  if (isLoading) {
    return (
      <div style={{ flex: 1, display: "flex", alignItems: "center", justifyContent: "center" }}>
        <span style={{ fontSize: 10, ...sMono, color: "var(--atlas-muted)", opacity: 0.4 }}>Loading…</span>
      </div>
    );
  }

  return (
    <div style={{ flex: 1, display: "flex", flexDirection: "column", overflow: "hidden" }}>
      {/* Header */}
      <div style={{ padding: "7px 10px", borderBottom: "1px solid var(--atlas-border)", flexShrink: 0, display: "flex", alignItems: "center", gap: 6 }}>
        <span style={{ fontSize: 10, ...sMono, letterSpacing: "0.08em", color: "var(--atlas-muted)", opacity: 0.6 }}>project memory</span>
        <div style={{ marginLeft: "auto", display: "flex", gap: 4 }}>
          {!editing && memory && (
            <button
              onClick={clear}
              disabled={saving}
              style={{ background: "transparent", border: "none", cursor: "pointer", fontSize: 9, ...sMono, letterSpacing: "0.06em", color: "var(--atlas-muted)", opacity: 0.35, padding: "2px 4px" }}
              onMouseEnter={(e) => (e.currentTarget.style.opacity = "0.8")}
              onMouseLeave={(e) => (e.currentTarget.style.opacity = "0.35")}
            >
              clear
            </button>
          )}
          {!editing && (
            <button
              onClick={startEdit}
              style={{ background: "transparent", border: "none", cursor: "pointer", fontSize: 9, ...sMono, letterSpacing: "0.06em", color: "var(--atlas-gold)", opacity: 0.55, padding: "2px 4px" }}
              onMouseEnter={(e) => (e.currentTarget.style.opacity = "1")}
              onMouseLeave={(e) => (e.currentTarget.style.opacity = "0.55")}
            >
              edit
            </button>
          )}
          {editing && (
            <>
              <button
                onClick={() => setEditing(false)}
                style={{ background: "transparent", border: "none", cursor: "pointer", fontSize: 9, ...sMono, color: "var(--atlas-muted)", opacity: 0.4, padding: "2px 4px" }}
              >
                cancel
              </button>
              <button
                onClick={save}
                disabled={saving}
                style={{ background: "var(--atlas-ember)", border: "none", cursor: saving ? "not-allowed" : "pointer", fontSize: 9, ...sMono, letterSpacing: "0.08em", color: "var(--atlas-fg)", padding: "2px 8px", borderRadius: 4, opacity: saving ? 0.5 : 1 }}
              >
                {saving ? "saving…" : "save"}
              </button>
            </>
          )}
        </div>
      </div>

      {/* Content */}
      <div style={{ flex: 1, overflowY: "auto", padding: "10px 12px" }} className="scrollbar-none">
        {editing ? (
          <textarea
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            autoFocus
            style={{
              width: "100%", height: "100%", minHeight: 200, resize: "none",
              background: "rgba(12,10,9,0.6)", border: "1px solid rgba(201,162,76,0.25)",
              borderRadius: 6, color: "var(--atlas-fg)", fontSize: 11,
              ...sMono, lineHeight: 1.65, padding: "10px 12px",
              outline: "none", boxSizing: "border-box",
            }}
          />
        ) : memory ? (
          <pre style={{
            margin: 0, whiteSpace: "pre-wrap", wordBreak: "break-word",
            fontSize: 11, color: "var(--atlas-fg)", opacity: 0.75, lineHeight: 1.7,
            ...sMono,
          }}>
            {memory}
          </pre>
        ) : (
          <div style={{ padding: "48px 16px", textAlign: "center" }}>
            <div style={{ fontSize: 10, color: "var(--atlas-muted)", opacity: 0.4, lineHeight: 1.7, ...sMono }}>
              Nothing here yet.<br />
              As we work together, I'll build up<br />
              context about this project automatically.
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

// ── UserProfilePanel ──────────────────────────────────────────────────────────
function UserProfilePanel({ onClose }: { onClose: () => void }) {
  const [profile, setProfile] = useState<UserProfile>(loadProfile);
  const [saved, setSaved] = useState(false);

  const handleSave = () => {
    saveProfile(profile);
    setSaved(true);
    setTimeout(() => { setSaved(false); onClose(); }, 700);
  };

  const field = (label: string, key: keyof UserProfile, placeholder: string, multiline?: boolean) => (
    <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
      <label style={{ fontSize: 9, fontFamily: "var(--app-font-mono)", letterSpacing: "0.1em", color: "var(--atlas-muted)", opacity: 0.55, textTransform: "uppercase" }}>
        {label}
      </label>
      {multiline ? (
        <textarea
          value={profile[key]}
          onChange={(e) => setProfile((p) => ({ ...p, [key]: e.target.value }))}
          placeholder={placeholder}
          rows={3}
          style={{
            width: "100%", resize: "none", padding: "8px 10px", borderRadius: 6,
            background: "rgba(12,10,9,0.7)", border: "1px solid var(--atlas-border)",
            color: "var(--atlas-fg)", fontSize: 11, fontFamily: "var(--app-font-mono)",
            outline: "none", boxSizing: "border-box", lineHeight: 1.6,
          }}
          onFocus={(e) => (e.currentTarget.style.borderColor = "rgba(201,162,76,0.35)")}
          onBlur={(e) => (e.currentTarget.style.borderColor = "var(--atlas-border)")}
        />
      ) : (
        <input
          type="text"
          value={profile[key]}
          onChange={(e) => setProfile((p) => ({ ...p, [key]: e.target.value }))}
          placeholder={placeholder}
          style={{
            width: "100%", padding: "8px 10px", borderRadius: 6,
            background: "rgba(12,10,9,0.7)", border: "1px solid var(--atlas-border)",
            color: "var(--atlas-fg)", fontSize: 11, fontFamily: "var(--app-font-mono)",
            outline: "none", boxSizing: "border-box",
          }}
          onFocus={(e) => (e.currentTarget.style.borderColor = "rgba(201,162,76,0.35)")}
          onBlur={(e) => (e.currentTarget.style.borderColor = "var(--atlas-border)")}
        />
      )}
    </div>
  );

  return (
    <div style={{
      position: "fixed", inset: 0, zIndex: 100,
      display: "flex", alignItems: "flex-start", justifyContent: "flex-end",
    }}>
      <div onClick={onClose} style={{ position: "absolute", inset: 0, background: "rgba(0,0,0,0.5)" }} />
      <div style={{
        position: "relative", zIndex: 1,
        width: 320, height: "100%",
        background: "var(--atlas-surface)",
        borderLeft: "1px solid var(--atlas-border)",
        display: "flex", flexDirection: "column",
        boxShadow: "-8px 0 32px rgba(0,0,0,0.4)",
      }}>
        {/* Header */}
        <div style={{ padding: "14px 16px", borderBottom: "1px solid var(--atlas-border)", display: "flex", alignItems: "center", justifyContent: "space-between", flexShrink: 0 }}>
          <span style={{ fontSize: 11, fontFamily: "var(--app-font-mono)", letterSpacing: "0.1em", color: "var(--atlas-fg)", opacity: 0.8 }}>Your Profile</span>
          <button onClick={onClose} style={{ background: "transparent", border: "none", cursor: "pointer", fontSize: 18, color: "var(--atlas-muted)", lineHeight: 1, opacity: 0.45, padding: "0 2px" }}>×</button>
        </div>

        {/* Fields */}
        <div style={{ flex: 1, overflowY: "auto", padding: "16px", display: "flex", flexDirection: "column", gap: 14 }} className="scrollbar-none">
          <div style={{ fontSize: 10.5, color: "var(--atlas-muted)", opacity: 0.5, lineHeight: 1.6, fontFamily: "var(--app-font-mono)" }}>
            This gets injected into every conversation so Atlas always knows who you are and what you're building.
          </div>
          {field("Your name", "name", "e.g. Jane")}
          {field("Stack", "stack", "React, Tailwind, Supabase…")}
          {field("Projects", "projects", "Compani, IntoIQ, CoinsBloom…")}
          {field("Notes for Atlas", "notes", "Anything you want it to always know…", true)}
        </div>

        {/* Save */}
        <div style={{ padding: "12px 16px", borderTop: "1px solid var(--atlas-border)", flexShrink: 0 }}>
          <button
            onClick={handleSave}
            style={{
              width: "100%", padding: "9px", borderRadius: 6,
              background: saved ? "rgba(52,211,153,0.15)" : "var(--atlas-ember)",
              border: "none", color: saved ? "#34d399" : "var(--atlas-fg)",
              fontSize: 10, fontFamily: "var(--app-font-mono)", letterSpacing: "0.1em",
              textTransform: "uppercase", cursor: "pointer",
              transition: "background 200ms ease, color 200ms ease",
            }}
          >
            {saved ? "Saved ✓" : "Save Profile"}
          </button>
        </div>
      </div>
    </div>
  );
}

// ── RightPanel (tabbed) ──────────────────────────────────────────────────────
function RightPanel({
  projectId,
  entries,
  activeCatch,
  onClose,
  fullscreen,
  onToggleFullscreen,
  onFileContext,
}: {
  projectId: number;
  entries: Entry[];
  activeCatch: CatchPayload | null;
  onClose?: () => void;
  fullscreen?: boolean;
  onToggleFullscreen?: () => void;
  onFileContext: (ctx: string | null) => void;
}) {
  const [tab, setTab] = useState<RightTab>("ledger");

  const tabs: { id: RightTab; label: string; icon: React.ReactNode; badge?: number }[] = [
    {
      id: "ledger",
      label: "Ledger",
      badge: entries.length || undefined,
      icon: (
        <svg width="13" height="13" viewBox="0 0 16 16" fill="none">
          <rect x="2" y="1" width="12" height="14" rx="1.5" stroke="currentColor" strokeWidth="1.2" />
          <path d="M5 5h6M5 8h6M5 11h4" stroke="currentColor" strokeWidth="1.1" strokeLinecap="round" />
          <circle cx="3.5" cy="5" r="0.8" fill="currentColor" opacity={0.5} />
          <circle cx="3.5" cy="8" r="0.8" fill="currentColor" opacity={0.5} />
          <circle cx="3.5" cy="11" r="0.8" fill="currentColor" opacity={0.5} />
        </svg>
      ),
    },
    {
      id: "files",
      label: "Files",
      icon: (
        <svg width="13" height="13" viewBox="0 0 16 16" fill="none">
          <path d="M1 5h6l2 2h6v7H1V5z" stroke="currentColor" strokeWidth="1.2" />
          <path d="M1 5V3a1 1 0 011-1h4l2 2" stroke="currentColor" strokeWidth="1.2" />
        </svg>
      ),
    },
    {
      id: "preview",
      label: "Preview",
      icon: (
        <svg width="13" height="13" viewBox="0 0 16 16" fill="none">
          <rect x="1" y="3" width="14" height="10" rx="1.5" stroke="currentColor" strokeWidth="1.2" />
          <path d="M1 6h14" stroke="currentColor" strokeWidth="1.1" />
          <circle cx="3.5" cy="4.5" r="0.7" fill="currentColor" opacity={0.5} />
          <circle cx="5.5" cy="4.5" r="0.7" fill="currentColor" opacity={0.5} />
        </svg>
      ),
    },
    {
      id: "memory" as RightTab,
      label: "Memory",
      icon: (
        <svg width="13" height="13" viewBox="0 0 16 16" fill="none">
          <path d="M3 2h10a1 1 0 011 1v10a1 1 0 01-1 1H3a1 1 0 01-1-1V3a1 1 0 011-1z" stroke="currentColor" strokeWidth="1.2" />
          <path d="M5 5.5h6M5 8h6M5 10.5h4" stroke="currentColor" strokeWidth="1.1" strokeLinecap="round" />
          <circle cx="3.2" cy="5.5" r="0.7" fill="currentColor" opacity={0.45} />
          <circle cx="3.2" cy="8" r="0.7" fill="currentColor" opacity={0.45} />
          <circle cx="3.2" cy="10.5" r="0.7" fill="currentColor" opacity={0.45} />
        </svg>
      ),
    },
  ];

  return (
    <div
      style={{
        height: "100%", display: "flex", flexDirection: "column",
        background: "var(--atlas-surface-alt)",
        borderLeft: "1px solid var(--atlas-border)",
      }}
    >
      {/* Tab bar */}
      <div
        style={{
          display: "flex", alignItems: "center",
          borderBottom: "1px solid var(--atlas-border)",
          flexShrink: 0,
          paddingLeft: 4,
        }}
      >
        {tabs.map((t) => {
          const active = tab === t.id;
          return (
            <button
              key={t.id}
              onClick={() => setTab(t.id)}
              style={{
                display: "flex", alignItems: "center", gap: 5,
                padding: "10px 12px",
                background: "transparent", border: "none",
                borderBottom: `2px solid ${active ? "var(--atlas-gold)" : "transparent"}`,
                cursor: "pointer",
                color: active ? "var(--atlas-gold)" : "var(--atlas-muted)",
                opacity: active ? 1 : 0.55,
                transition: "all 160ms ease",
                fontFamily: "var(--app-font-mono)",
                fontSize: 9.5,
                letterSpacing: "0.12em",
                textTransform: "uppercase",
                marginBottom: -1,
              }}
              onMouseEnter={(e) => { if (!active) e.currentTarget.style.opacity = "0.8"; }}
              onMouseLeave={(e) => { if (!active) e.currentTarget.style.opacity = "0.55"; }}
            >
              {t.icon}
              {t.label}
              {t.badge !== undefined && (
                <span
                  style={{
                    padding: "1px 4px", borderRadius: 3,
                    background: active ? "rgba(201,162,76,0.15)" : "rgba(120,113,108,0.15)",
                    fontSize: 8.5,
                  }}
                >
                  {t.badge}
                </span>
              )}
            </button>
          );
        })}

        {/* Fullscreen toggle (mobile only) */}
        {onToggleFullscreen && (
          <button
            onClick={onToggleFullscreen}
            title={fullscreen ? "Restore" : "Full screen"}
            style={{
              marginLeft: onClose ? 0 : "auto", marginRight: 2,
              width: 28, height: 28, borderRadius: 6,
              background: "transparent", border: "none",
              color: "var(--atlas-muted)", cursor: "pointer",
              display: "flex", alignItems: "center", justifyContent: "center",
              opacity: 0.5, transition: "opacity 160ms ease",
            }}
            onMouseEnter={(e) => (e.currentTarget.style.opacity = "1")}
            onMouseLeave={(e) => (e.currentTarget.style.opacity = "0.5")}
          >
            {fullscreen ? (
              <svg width="13" height="13" viewBox="0 0 16 16" fill="none">
                <path d="M5 1H1v4M11 1h4v4M1 11v4h4M15 11v4h-4" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
            ) : (
              <svg width="13" height="13" viewBox="0 0 16 16" fill="none">
                <path d="M1 5V1h4M11 1h4v4M1 11v4h4M15 11v4h-4" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
            )}
          </button>
        )}

        {/* Close button (mobile only) */}
        {onClose && (
          <button
            onClick={onClose}
            style={{
              marginLeft: onToggleFullscreen ? 0 : "auto", marginRight: 6,
              width: 28, height: 28, borderRadius: 6,
              background: "transparent", border: "none",
              color: "var(--atlas-muted)", fontSize: 16, lineHeight: 1,
              cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center",
              opacity: 0.5, transition: "opacity 160ms ease",
            }}
            onMouseEnter={(e) => (e.currentTarget.style.opacity = "1")}
            onMouseLeave={(e) => (e.currentTarget.style.opacity = "0.5")}
          >
            ×
          </button>
        )}
      </div>

      {/* Tab content */}
      {tab === "ledger" && (
        <LedgerTab projectId={projectId} entries={entries} activeCatch={activeCatch} />
      )}
      {tab === "files" && <FilesTab projectId={projectId} onFileContext={onFileContext} />}
      {tab === "preview" && <PreviewTab projectId={projectId} />}
      {tab === "memory" && <MemoryTab projectId={projectId} />}
    </div>
  );
}

// ── Workspace ────────────────────────────────────────────────────────────────
export default function Workspace() {
  const { projectId } = useParams();
  const [, setLocation] = useLocation();
  const id = Number(projectId);
  const queryClient = useQueryClient();
  const isMobile = useIsMobile();

  const [input, setInput] = useState("");
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [sessionId, setSessionId] = useState<number | null>(null);
  const [activeCatch, setActiveCatch] = useState<CatchPayload | null>(null);
  const [memoryChips, setMemoryChips] = useState<string[]>([]);
  const [rightOpen, setRightOpen] = useState(false);
  const [showProfile, setShowProfile] = useState(false);
  const [chatWidth, setChatWidth] = useState(() => {
    try { return parseInt(localStorage.getItem("atlas-chat-w") || "0") || 520; } catch { return 520; }
  });

  const [attachedFile, setAttachedFile] = useState<File | null>(null);
  const [rightFullscreen, setRightFullscreen] = useState(false);
  const [fileContext, setFileContext] = useState<string | null>(null);
  const [chatPending, setChatPending] = useState(false);
  const [linkedRepo, setLinkedRepo] = useState<LinkedRepo | null>(() => {
    try {
      const raw = localStorage.getItem(`atlas-gh-linked-${Number(projectId)}`);
      return raw ? JSON.parse(raw) as LinkedRepo : null;
    } catch { return null; }
  });

  const bottomRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const resizing = useRef(false);
  const lastX = useRef(0);
  const initialSent = useRef(false);
  const touchStartX = useRef(0);

  const { data: project } = useGetProject(id, { query: { enabled: !!id, queryKey: getGetProjectQueryKey(id) } });
  const { data: sessions, isLoading: sessionsLoading } = useListSessions(id, {
    query: { enabled: !!id, queryKey: getListSessionsQueryKey(id) },
  });
  const { data: entries } = useListEntries(id, {}, { query: { enabled: !!id, queryKey: getListEntriesQueryKey(id, {}) } });
  const createSession = useCreateSession();
  const createEntry = useCreateEntry();

  useEffect(() => {
    if (sessionsLoading) return;
    if (sessions && sessions.length > 0) {
      setSessionId(sessions[0].id);
    } else if (!createSession.isPending && !sessionId) {
      createSession.mutate(
        { projectId: id, data: { title: "Session", mode: "think" } },
        {
          onSuccess: (s) => {
            setSessionId(s.id);
            queryClient.invalidateQueries({ queryKey: getListSessionsQueryKey(id) });
          },
        }
      );
    }
  }, [sessions, sessionsLoading, id]);

  const doSend = useCallback(
    (text: string, sid: number, currentMessages: ChatMessage[], ctx?: string | null) => {
      const userMsg: ChatMessage = { role: "user", content: text };
      const history = currentMessages.map((m) => ({ role: m.role, content: m.content }));
      const ledgerEntries = (entries || []).map((e: Entry) => ({ id: e.id, title: e.title, status: e.status }));
      const activeCtx = ctx !== undefined ? ctx : fileContext;

      setMessages((prev) => [...prev, userMsg]);
      setChatPending(true);

      const userProfileStr = profileToString(loadProfile());

      const body = {
        sessionId: sid,
        projectId: id,
        message: text,
        mode: "think",
        history,
        entries: ledgerEntries,
        ...(activeCtx ? { fileContext: activeCtx } : {}),
        ...(userProfileStr ? { userProfile: userProfileStr } : {}),
      };

      fetch("/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      })
        .then((r) => r.json())
        .then((res) => {
          const cp = res.catchPayload as CatchPayload | null;
          const fe = res.fileEdit as FileEdit | undefined;
          setMessages((prev) => [...prev, {
            id: res.messageId, role: "assistant",
            content: res.content, intentType: res.intentType, catchPayload: cp,
            ...(fe ? { fileEdit: fe } : {}),
          }]);
          if (cp) setActiveCatch(cp);
          if (res.memoryChips && res.memoryChips.length > 0) {
            setMemoryChips((prev) => {
              const merged = [...prev];
              for (const c of res.memoryChips!) {
                if (!merged.includes(c)) merged.push(c);
              }
              return merged.slice(-12);
            });
          }
        })
        .catch(() => {
          setMessages((prev) => [...prev, { role: "assistant", content: "Something went wrong. Please try again." }]);
        })
        .finally(() => setChatPending(false));
    },
    [entries, id, fileContext]
  );

  useEffect(() => {
    if (!sessionId || initialSent.current) return;
    const key = `atlas-initial-${id}`;
    const initial = sessionStorage.getItem(key);
    if (initial) {
      sessionStorage.removeItem(key);
      initialSent.current = true;
      setInput(initial);
      setTimeout(() => doSend(initial, sessionId, []), 80);
    }
  }, [sessionId, id, doSend]);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, chatPending]);

  // Close mobile panel on mobile→desktop resize
  useEffect(() => {
    if (!isMobile) setRightOpen(false);
  }, [isMobile]);

  const autoResize = () => {
    const el = textareaRef.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = Math.min(el.scrollHeight, 180) + "px";
  };

  const handleSend = () => {
    const text = input.trim();
    if (!text || !sessionId || chatPending) return;
    const messageText = attachedFile ? `${text}\n[Attached: ${attachedFile.name}]` : text;
    const current = messages;
    setInput("");
    setAttachedFile(null);
    if (textareaRef.current) { textareaRef.current.style.height = "auto"; }
    doSend(messageText, sessionId, current);
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); handleSend(); }
  };

  const handlePark = useCallback(
    (content: string) => {
      if (!sessionId) return;
      const title = content.replace(/\n/g, " ").slice(0, 80).trim();
      createEntry.mutate(
        { projectId: id, data: { title, summary: content.slice(0, 500), status: "parked", severity: "parked", mode: "think", sessionId } },
        { onSuccess: () => queryClient.invalidateQueries({ queryKey: getListEntriesQueryKey(id, {}) }) }
      );
    },
    [id, sessionId, createEntry, queryClient]
  );

  const handleCommit = useCallback(
    (content: string) => {
      if (!sessionId) return;
      const title = content.replace(/\n/g, " ").slice(0, 80).trim();
      createEntry.mutate(
        { projectId: id, data: { title, summary: content.slice(0, 500), status: "committed", severity: "committed", mode: "think", sessionId } },
        { onSuccess: () => queryClient.invalidateQueries({ queryKey: getListEntriesQueryKey(id, {}) }) }
      );
    },
    [id, sessionId, createEntry, queryClient]
  );

  const handleVoiceTranscript = useCallback((text: string) => {
    setInput((prev) => (prev ? `${prev} ${text}` : text));
    setTimeout(() => autoResize(), 0);
  }, []);

  const { listening: voiceListening, toggle: toggleVoice, isSupported: voiceSupported } =
    useVoiceInput(handleVoiceTranscript);

  const handleCatchProceed = (msgId?: number) => {
    setMessages((prev) => prev.map((m) => m.id === msgId ? { ...m, catchResolved: true } : m));
    setActiveCatch(null);
    queryClient.invalidateQueries({ queryKey: getListEntriesQueryKey(id, {}) });
  };

  const handleCatchAdjust = (msgId?: number) => {
    setMessages((prev) => prev.map((m) => m.id === msgId ? { ...m, catchResolved: true } : m));
    setActiveCatch(null);
    textareaRef.current?.focus();
  };

  const dismissChip = useCallback((chip: string) => {
    setMemoryChips((prev) => prev.filter((c) => c !== chip));
  }, []);

  const onResizeMouseDown = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    resizing.current = true;
    lastX.current = e.clientX;
    document.body.style.cursor = "col-resize";
    document.body.style.userSelect = "none";

    const onMove = (ev: MouseEvent) => {
      if (!resizing.current) return;
      const dx = ev.clientX - lastX.current;
      lastX.current = ev.clientX;
      setChatWidth((w) => {
        const next = Math.max(320, Math.min(window.innerWidth * 0.68, w + dx));
        try { localStorage.setItem("atlas-chat-w", String(Math.round(next))); } catch {}
        return next;
      });
    };
    const onUp = () => {
      resizing.current = false;
      document.body.style.cursor = "";
      document.body.style.userSelect = "";
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("mouseup", onUp);
    };
    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", onUp);
  }, []);

  const hasInput = input.trim().length > 0;
  const entryCount = entries?.length ?? 0;

  return (
    <div style={{ height: "100vh", display: "flex", flexDirection: "column", background: "var(--atlas-bg)", overflow: "hidden" }}>

      {/* ── Header ── */}
      <div
        style={{
          height: 46, flexShrink: 0,
          display: "flex", alignItems: "center", justifyContent: "space-between",
          padding: "0 18px",
          borderBottom: "1px solid var(--atlas-border)",
          background: "rgba(12,10,9,0.92)",
          backdropFilter: "blur(12px)",
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
          <button
            onClick={() => setLocation("/")}
            style={{ background: "transparent", border: "none", cursor: "pointer", padding: 0, display: "flex" }}
          >
            <AtlasLogo small />
          </button>
          {project && (
            <>
              <span style={{ color: "rgba(37,34,32,0.9)", fontSize: 16, userSelect: "none" }}>/</span>
              <span style={{ fontSize: 13, color: "rgba(231,229,228,0.55)", fontWeight: 500, maxWidth: 200, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                {project.name}
              </span>
            </>
          )}
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
          {/* Panel toggle — opens Ledger/Files/Preview; visible on mobile, also on desktop for future use */}
          {isMobile && (
            <button
              onClick={() => setRightOpen(true)}
              aria-label="Open workspace panel"
              style={{
                width: 30, height: 30, borderRadius: 8,
                background: "transparent",
                border: "1px solid var(--atlas-border)",
                color: "var(--atlas-muted)",
                cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center",
                transition: "all 180ms ease", flexShrink: 0, position: "relative",
              }}
              onMouseEnter={(e) => { e.currentTarget.style.borderColor = "rgba(201,162,76,0.3)"; e.currentTarget.style.color = "var(--atlas-fg)"; }}
              onMouseLeave={(e) => { e.currentTarget.style.borderColor = "var(--atlas-border)"; e.currentTarget.style.color = "var(--atlas-muted)"; }}
            >
              <svg width="15" height="15" viewBox="0 0 20 20" fill="none">
                <rect x="2" y="2" width="16" height="16" rx="2" stroke="currentColor" strokeWidth="1.3" />
                <path d="M9 2v16" stroke="currentColor" strokeWidth="1.1" strokeDasharray="1.5 2" />
                <path d="M12 7h4M12 10h4M12 13h3" stroke="currentColor" strokeWidth="1.1" strokeLinecap="round" />
              </svg>
              {entryCount > 0 && (
                <span style={{
                  position: "absolute", top: -4, right: -4,
                  width: 14, height: 14, borderRadius: "50%",
                  background: "var(--atlas-ember)",
                  display: "flex", alignItems: "center", justifyContent: "center",
                  fontSize: 8, fontFamily: "var(--app-font-mono)",
                  color: "var(--atlas-fg)", fontWeight: 600,
                }}>
                  {entryCount > 9 ? "9+" : entryCount}
                </span>
              )}
            </button>
          )}
          {sessionId && (
            <span style={{ fontFamily: "var(--app-font-mono)", fontSize: 9.5, letterSpacing: "0.12em", textTransform: "uppercase", color: "rgba(120,113,108,0.35)" }}>
              Session active
            </span>
          )}
          {/* Profile button */}
          <button
            onClick={() => setShowProfile(true)}
            title="Your profile"
            style={{
              width: 28, height: 28, borderRadius: "50%",
              background: "rgba(201,162,76,0.1)",
              border: "1px solid rgba(201,162,76,0.2)",
              color: "var(--atlas-gold)", cursor: "pointer",
              display: "flex", alignItems: "center", justifyContent: "center",
              fontSize: 11, fontFamily: "var(--app-font-mono)", fontWeight: 600,
              flexShrink: 0, transition: "all 160ms ease",
            }}
            onMouseEnter={(e) => { e.currentTarget.style.background = "rgba(201,162,76,0.18)"; e.currentTarget.style.borderColor = "rgba(201,162,76,0.45)"; }}
            onMouseLeave={(e) => { e.currentTarget.style.background = "rgba(201,162,76,0.1)"; e.currentTarget.style.borderColor = "rgba(201,162,76,0.2)"; }}
          >
            {(() => { const n = loadProfile().name; return n ? n[0].toUpperCase() : "P"; })()}
          </button>
        </div>
      </div>

      {/* ── Two-pane body ── */}
      <div style={{ flex: 1, display: "flex", overflow: "hidden", position: "relative" }}>

        {/* Left: Chat */}
        <div
          style={{
            width: isMobile ? "100%" : chatWidth,
            minWidth: isMobile ? 0 : 300,
            flexShrink: 0,
            display: "flex",
            flexDirection: "column",
            background: "var(--atlas-bg)",
            overflow: "hidden",
          }}
        >
          {/* Messages */}
          <div style={{ flex: 1, overflowY: "auto", padding: "28px 22px 12px" }} className="scrollbar-none">
            {messages.length === 0 && !chatPending && (
              <div style={{ textAlign: "center", padding: "72px 20px" }}>
                <div style={{ fontSize: 22, fontWeight: 300, color: "rgba(231,229,228,0.3)", marginBottom: 8, letterSpacing: "-0.01em" }}>
                  {project ? project.name : "Ready."}
                </div>
                <div style={{ fontSize: 12, color: "rgba(120,113,108,0.45)" }}>
                  What are we working through today?
                </div>
              </div>
            )}

            {messages.map((msg, i) =>
              msg.role === "user" ? (
                <UserBubble key={i} content={msg.content} />
              ) : (
                <AssistantBubble
                  key={i}
                  message={msg}
                  projectId={id}
                  sessionId={sessionId || 0}
                  linkedRepo={linkedRepo}
                  onCatchProceed={() => handleCatchProceed(msg.id)}
                  onCatchAdjust={() => handleCatchAdjust(msg.id)}
                  onPark={handlePark}
                  onCommit={handleCommit}
                />
              )
            )}

            {chatPending && (
              <div className="atlas-bubble-in" style={{ marginBottom: 24 }}>
                <div style={{ fontFamily: "var(--app-font-mono)", fontSize: 9, letterSpacing: "0.12em", textTransform: "uppercase", color: "var(--atlas-gold)", opacity: 0.35, marginBottom: 8 }}>
                  Atlas
                </div>
                <div className="atlas-think-dots"><span /><span /><span /></div>
              </div>
            )}

            <div ref={bottomRef} />
          </div>

          {/* Mobile panel toggle — floats above input, reachable one-handed */}
          {isMobile && (
            <div style={{ position: "relative", height: 0, flexShrink: 0 }}>
              <button
                onClick={() => setRightOpen(v => !v)}
                aria-label={rightOpen ? "Close panel" : "Open panel"}
                style={{
                  position: "absolute", bottom: 10, right: 14,
                  width: 32, height: 32, borderRadius: 9,
                  background: rightOpen
                    ? "rgba(201,162,76,0.14)"
                    : "rgba(28,25,23,0.88)",
                  border: `1px solid ${rightOpen ? "rgba(201,162,76,0.45)" : "var(--atlas-border)"}`,
                  backdropFilter: "blur(10px)",
                  color: rightOpen ? "var(--atlas-gold)" : "var(--atlas-muted)",
                  cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center",
                  transition: "all 160ms ease", zIndex: 10,
                  boxShadow: "0 2px 12px rgba(0,0,0,0.35)",
                }}
              >
                {rightOpen ? (
                  <svg width="13" height="13" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round">
                    <path d="M3 3l10 10M13 3L3 13" />
                  </svg>
                ) : (
                  <svg width="14" height="14" viewBox="0 0 20 20" fill="none">
                    <rect x="2" y="2" width="16" height="16" rx="2" stroke="currentColor" strokeWidth="1.3" />
                    <path d="M9 2v16" stroke="currentColor" strokeWidth="1.1" strokeDasharray="1.5 2" />
                    <path d="M12 7h4M12 10h4M12 13h3" stroke="currentColor" strokeWidth="1.1" strokeLinecap="round" />
                  </svg>
                )}
              </button>
            </div>
          )}

          {/* Memory chips — what Atlas is tracking this session */}
          <MemoryChips chips={memoryChips} onDismiss={dismissChip} />

          {/* Input */}
          <div style={{ padding: "10px 14px 14px", flexShrink: 0 }}>
            {/* Hidden file input */}
            <input
              ref={fileInputRef}
              type="file"
              style={{ display: "none" }}
              onChange={(e) => {
                const file = e.target.files?.[0] ?? null;
                setAttachedFile(file);
                e.target.value = "";
              }}
            />

            {/* Attachment pill */}
            {attachedFile && (
              <div
                style={{
                  display: "flex", alignItems: "center", gap: 6, marginBottom: 6,
                  padding: "4px 10px", borderRadius: 6, width: "fit-content",
                  background: "rgba(201,162,76,0.07)",
                  border: "1px solid rgba(201,162,76,0.2)",
                }}
              >
                <svg width="11" height="11" viewBox="0 0 16 16" fill="none">
                  <path d="M13 7.5l-5.5 5.5a4 4 0 01-5.66-5.66l6-6a2.5 2.5 0 013.54 3.54l-6 6a1 1 0 01-1.42-1.42l5.5-5.5" stroke="rgba(201,162,76,0.8)" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round" />
                </svg>
                <span style={{ fontSize: 10, fontFamily: "var(--app-font-mono)", color: "rgba(201,162,76,0.7)", letterSpacing: "0.05em", maxWidth: 200, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                  {attachedFile.name}
                </span>
                <button
                  onClick={() => setAttachedFile(null)}
                  style={{ background: "transparent", border: "none", cursor: "pointer", color: "rgba(120,113,108,0.6)", fontSize: 13, lineHeight: 1, padding: "0 0 0 2px" }}
                >
                  ×
                </button>
              </div>
            )}

            <div className="atlas-input-shell" style={{ padding: "13px 15px" }}>
              <div style={{ position: "relative" }}>
                {!hasInput && (
                  <div
                    aria-hidden
                    style={{
                      position: "absolute", top: 0, left: 0,
                      color: "var(--atlas-muted)", fontSize: 14, lineHeight: 1.6,
                      opacity: 0.5, pointerEvents: "none",
                      fontFamily: "var(--app-font-sans)",
                    }}
                  >
                    Say it plainly…
                  </div>
                )}
                <textarea
                  ref={textareaRef}
                  value={input}
                  onChange={(e) => { setInput(e.target.value); autoResize(); }}
                  onKeyDown={handleKeyDown}
                  rows={2}
                  style={{
                    width: "100%", background: "transparent", border: "none", outline: "none",
                    color: "var(--atlas-fg)", fontSize: 14, lineHeight: 1.6,
                    resize: "none", fontFamily: "var(--app-font-sans)",
                    position: "relative", zIndex: 1,
                    minHeight: 46, maxHeight: 180, overflowY: "hidden", display: "block",
                  }}
                />
              </div>

              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginTop: 10 }}>
                {/* Left: paperclip */}
                <button
                  onClick={() => fileInputRef.current?.click()}
                  title="Attach file"
                  style={{
                    width: 30, height: 30, borderRadius: 7,
                    background: "transparent", border: "none",
                    color: attachedFile ? "var(--atlas-gold)" : "var(--atlas-muted)",
                    cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center",
                    opacity: attachedFile ? 1 : 0.4, transition: "opacity 160ms ease",
                    flexShrink: 0,
                  }}
                  onMouseEnter={(e) => (e.currentTarget.style.opacity = "1")}
                  onMouseLeave={(e) => { if (!attachedFile) e.currentTarget.style.opacity = "0.4"; }}
                >
                  <svg width="14" height="14" viewBox="0 0 16 16" fill="none">
                    <path d="M13 7.5l-5.5 5.5a4 4 0 01-5.66-5.66l6-6a2.5 2.5 0 013.54 3.54l-6 6a1 1 0 01-1.42-1.42l5.5-5.5" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round" />
                  </svg>
                </button>

                <span style={{ fontFamily: "var(--app-font-mono)", fontSize: 9, letterSpacing: "0.06em", color: "var(--atlas-muted)", opacity: 0.3 }}>
                  {isMobile ? "Tap to send" : "Enter · Shift+Enter for newline"}
                </span>

                {/* Right: mic + send */}
                <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                  {voiceSupported && (
                    <button
                      onClick={toggleVoice}
                      title={voiceListening ? "Stop listening" : "Voice input"}
                      className={voiceListening ? "atlas-voice-active" : ""}
                      style={{
                        width: 32, height: 32, borderRadius: 8,
                        background: voiceListening ? "var(--atlas-ember)" : "rgba(37,34,32,0.6)",
                        border: `1px solid ${voiceListening ? "var(--atlas-ember)" : "var(--atlas-border)"}`,
                        color: voiceListening ? "var(--atlas-fg)" : "var(--atlas-muted)",
                        cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center",
                        transition: "all 180ms ease", flexShrink: 0,
                      }}
                    >
                      <svg width="13" height="13" viewBox="0 0 16 16" fill="none">
                        <rect x="5" y="1" width="6" height="9" rx="3" stroke="currentColor" strokeWidth="1.3" />
                        <path d="M2 8a6 6 0 0012 0" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" />
                        <line x1="8" y1="14" x2="8" y2="16" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" />
                      </svg>
                    </button>
                  )}
                  <button
                    className="atlas-send-btn"
                    onClick={handleSend}
                    disabled={!hasInput || chatPending || !sessionId}
                    style={{
                      width: 38, height: 38,
                      background: hasInput && !chatPending && sessionId ? "var(--atlas-ember)" : "rgba(37,34,32,0.7)",
                      border: hasInput ? "none" : "1px solid var(--atlas-border)",
                      boxShadow: hasInput && !chatPending ? "0 0 16px -3px rgba(146,64,14,0.5)" : "none",
                      opacity: chatPending ? 0.5 : 1,
                    }}
                  >
                    <svg viewBox="0 0 20 20" width={13} height={13}
                      fill={hasInput ? "var(--atlas-fg)" : "none"}
                      stroke={hasInput ? "var(--atlas-fg)" : "var(--atlas-muted)"}
                      strokeWidth={1.5} strokeLinecap="round" strokeLinejoin="round">
                      <path d="M2.5 10L17 3 13 17l-3.5-5.5z" />
                      <path d="M17 3 9.5 11.5" />
                    </svg>
                  </button>
                </div>
              </div>
            </div>
          </div>
        </div>

        {/* Desktop: resize handle + right panel */}
        {!isMobile && (
          <>
            <div
              className="atlas-resize-handle"
              onMouseDown={onResizeMouseDown}
              onDoubleClick={() => setChatWidth(Math.floor(window.innerWidth * 0.5))}
              title="Drag · double-click for 50/50"
            />
            <div style={{ flex: 1, minWidth: 240, overflow: "hidden" }}>
              <RightPanel
                projectId={id}
                entries={entries || []}
                activeCatch={activeCatch}
                onFileContext={setFileContext}
              />
            </div>
          </>
        )}

        {/* Mobile: overlay panel */}
        {isMobile && rightOpen && (
          <div
            style={{ position: "fixed", inset: 0, zIndex: 50, display: "flex", justifyContent: "flex-end" }}
          >
            {/* Backdrop — hidden in fullscreen */}
            {!rightFullscreen && (
              <div
                onClick={() => setRightOpen(false)}
                style={{
                  position: "absolute", inset: 0,
                  background: "rgba(0,0,0,0.6)",
                  backdropFilter: "blur(2px)",
                }}
              />
            )}
            {/* Sheet — slide in from right; expands to full when fullscreen */}
            <div
              onTouchStart={(e) => { touchStartX.current = e.touches[0].clientX; }}
              onTouchEnd={(e) => {
                if (rightFullscreen) return;
                const dx = e.changedTouches[0].clientX - touchStartX.current;
                if (dx > 60) setRightOpen(false);
              }}
              style={{
                position: "relative", zIndex: 1,
                width: rightFullscreen ? "100vw" : "88vw",
                maxWidth: rightFullscreen ? "none" : 420,
                height: "100%",
                animation: "atlas-slide-in-right 220ms cubic-bezier(0.4,0,0.2,1) both",
                transition: "width 220ms ease, max-width 220ms ease",
              }}
            >
              <RightPanel
                projectId={id}
                entries={entries || []}
                activeCatch={activeCatch}
                onClose={() => { setRightOpen(false); setRightFullscreen(false); }}
                fullscreen={rightFullscreen}
                onToggleFullscreen={() => setRightFullscreen((f) => !f)}
                onFileContext={setFileContext}
              />
            </div>
          </div>
        )}
      </div>

      {/* User Profile Panel */}
      {showProfile && <UserProfilePanel onClose={() => setShowProfile(false)} />}

    </div>
  );
}
