import { useState, useRef, useEffect, useCallback } from "react";
import { useParams, useLocation } from "wouter";
import {
  useGetProject,
  useListSessions,
  useListEntries,
  useCreateSession,
  useSendMessage,
  useCreateEntry,
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

interface ChatMessage {
  id?: number;
  role: "user" | "assistant";
  content: string;
  intentType?: string | null;
  catchPayload?: CatchPayload | null;
  catchResolved?: boolean;
}

type RightTab = "ledger" | "files" | "preview";

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
    <div className="atlas-catch-card atlas-bubble-in" style={{ padding: "12px 14px", marginTop: 10 }}>
      <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 8 }}>
        <span
          style={{
            width: 6, height: 6, borderRadius: "50%",
            background: "var(--atlas-ember)",
            boxShadow: "0 0 6px rgba(146,64,14,0.7)",
            flexShrink: 0,
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
        <span
          style={{
            marginLeft: "auto",
            fontFamily: "var(--app-font-mono)", fontSize: 9,
            letterSpacing: "0.06em",
            color: "var(--atlas-muted)", opacity: 0.5,
          }}
        >
          {payload.against.title}
        </span>
      </div>

      <p style={{ margin: 0, fontSize: 13, lineHeight: 1.65, color: "var(--atlas-fg)", opacity: 0.88 }}>
        {payload.leadSentence}
      </p>

      {showReason && (
        <textarea
          autoFocus
          value={reason}
          onChange={(e) => setReason(e.target.value)}
          placeholder="One line on why — optional, but it helps later."
          rows={2}
          style={{
            marginTop: 10, width: "100%",
            background: "rgba(22,20,18,0.8)",
            border: "1px solid var(--atlas-border)",
            borderRadius: 6, padding: "8px 10px",
            fontSize: 12, color: "var(--atlas-fg)",
            fontFamily: "var(--app-font-sans)", outline: "none", resize: "none",
          }}
          onFocus={(e) => (e.currentTarget.style.borderColor = "rgba(201,162,76,0.35)")}
          onBlur={(e) => (e.currentTarget.style.borderColor = "var(--atlas-border)")}
        />
      )}

      <div style={{ display: "flex", gap: 8, alignItems: "center", marginTop: 12 }}>
        <button
          disabled={createEntry.isPending}
          onClick={handleProceed}
          style={{
            padding: "6px 13px", fontSize: 10, fontWeight: 600,
            fontFamily: "var(--app-font-mono)", letterSpacing: "0.1em",
            textTransform: "uppercase" as const,
            background: "transparent", color: "var(--atlas-ember)",
            border: "1px solid rgba(146,64,14,0.45)", borderRadius: 4,
            cursor: createEntry.isPending ? "not-allowed" : "pointer",
            opacity: createEntry.isPending ? 0.5 : 1,
            transition: "all 160ms ease",
          }}
        >
          {createEntry.isPending ? "Logging…" : showReason ? "Confirm" : "Proceed anyway"}
        </button>
        <button
          disabled={createEntry.isPending}
          onClick={() => { setShowReason(false); setReason(""); onAdjust(); }}
          style={{
            padding: "6px 13px", fontSize: 10, fontWeight: 600,
            fontFamily: "var(--app-font-mono)", letterSpacing: "0.1em",
            textTransform: "uppercase" as const,
            background: "var(--atlas-gold)", color: "#0C0A09",
            border: "none", borderRadius: 4,
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
              border: "none", cursor: "pointer", opacity: 0.65,
            }}
          >
            cancel
          </button>
        )}
      </div>
    </div>
  );
}

// ── Chat bubbles ─────────────────────────────────────────────────────────────
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

function AssistantBubble({
  message,
  projectId,
  sessionId,
  onCatchProceed,
  onCatchAdjust,
  onPark,
  onCommit,
}: {
  message: ChatMessage;
  projectId: number;
  sessionId: number;
  onCatchProceed: () => void;
  onCatchAdjust: () => void;
  onPark: (content: string) => void;
  onCommit: (content: string) => void;
}) {
  const [hov, setHov] = useState(false);
  const [parkDone, setParkDone] = useState(false);
  const [commitDone, setCommitDone] = useState(false);

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
    </div>
  );
}

// ── Ledger tab content ───────────────────────────────────────────────────────
function LedgerEntry({ entry }: { entry: Entry }) {
  const committed = entry.status === "committed";
  return (
    <div
      style={{
        padding: "9px 11px", borderRadius: 8, marginBottom: 5,
        background: committed ? "rgba(201,162,76,0.04)" : "rgba(28,25,23,0.4)",
        border: `1px solid ${committed ? "rgba(201,162,76,0.18)" : "rgba(37,34,32,0.7)"}`,
      }}
    >
      <div style={{ display: "flex", alignItems: "flex-start", gap: 8 }}>
        <div
          style={{
            width: 5, height: 5, borderRadius: "50%", marginTop: 4, flexShrink: 0,
            background: committed ? "var(--atlas-gold)" : "rgba(120,113,108,0.4)",
          }}
        />
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontSize: 12, fontWeight: 500, color: committed ? "rgba(231,229,228,0.88)" : "rgba(231,229,228,0.45)", lineHeight: 1.4 }}>
            {entry.title}
          </div>
          {entry.summary && (
            <div
              style={{
                fontSize: 11, color: "var(--atlas-muted)", lineHeight: 1.5, marginTop: 3,
                display: "-webkit-box", WebkitLineClamp: 2, WebkitBoxOrient: "vertical" as const, overflow: "hidden",
              }}
            >
              {entry.summary}
            </div>
          )}
        </div>
      </div>
    </div>
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
  const committed = entries.filter((e) => e.status === "committed");
  const parked = entries.filter((e) => e.status === "parked");
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
      {/* Active catch indicator */}
      {activeCatch && (
        <div
          style={{
            margin: "10px 12px 0", padding: "8px 11px", borderRadius: 7, flexShrink: 0,
            background: "rgba(146,64,14,0.07)", border: "1px solid rgba(146,64,14,0.28)",
          }}
        >
          <div style={{ fontFamily: "var(--app-font-mono)", fontSize: 8.5, letterSpacing: "0.12em", textTransform: "uppercase", color: "var(--atlas-ember)", marginBottom: 3, opacity: 0.85 }}>
            Catch active
          </div>
          <div style={{ fontSize: 11, color: "rgba(231,229,228,0.6)", lineHeight: 1.4 }}>
            {activeCatch.against.title}
          </div>
        </div>
      )}

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
            {committed.length > 0 && (
              <div style={{ marginBottom: 18 }}>
                <div style={{ fontFamily: "var(--app-font-mono)", fontSize: 9, letterSpacing: "0.14em", textTransform: "uppercase", color: "rgba(120,113,108,0.4)", marginBottom: 8 }}>
                  Committed
                </div>
                {committed.map((e) => <LedgerEntry key={e.id} entry={e} />)}
              </div>
            )}
            {parked.length > 0 && (
              <div>
                <div style={{ fontFamily: "var(--app-font-mono)", fontSize: 9, letterSpacing: "0.14em", textTransform: "uppercase", color: "rgba(120,113,108,0.4)", marginBottom: 8 }}>
                  Parked
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

// ── Files tab ────────────────────────────────────────────────────────────────
interface FileNode {
  name: string;
  type: "file" | "folder";
  ext?: string;
  children?: FileNode[];
}

const PLACEHOLDER_TREE: FileNode[] = [
  {
    name: "Strategy",
    type: "folder",
    children: [
      { name: "north-star.md", type: "file", ext: "md" },
      { name: "positioning.md", type: "file", ext: "md" },
    ],
  },
  {
    name: "Research",
    type: "folder",
    children: [
      { name: "customer-interviews.md", type: "file", ext: "md" },
    ],
  },
  { name: "README.md", type: "file", ext: "md" },
];

function FileIcon({ ext }: { ext?: string }) {
  const color = ext === "md" ? "#C9A24C" : ext === "ts" || ext === "tsx" ? "#60a5fa" : "rgba(120,113,108,0.7)";
  return (
    <svg width="13" height="13" viewBox="0 0 16 16" fill="none" style={{ flexShrink: 0 }}>
      <path d="M3 2h7l3 3v9a1 1 0 01-1 1H3a1 1 0 01-1-1V3a1 1 0 011-1z" stroke={color} strokeWidth="1.1" />
      <path d="M10 2v3h3" stroke={color} strokeWidth="1.1" strokeLinejoin="round" />
    </svg>
  );
}

function FolderIcon({ open }: { open?: boolean }) {
  return (
    <svg width="13" height="13" viewBox="0 0 16 16" fill="none" style={{ flexShrink: 0 }}>
      {open ? (
        <>
          <path d="M1 4h5l1.5 1.5H15v8H1V4z" stroke="rgba(201,162,76,0.6)" strokeWidth="1.1" fill="rgba(201,162,76,0.06)" />
        </>
      ) : (
        <path d="M1 4h5l1.5 1.5H15v8H1V4z" stroke="rgba(201,162,76,0.45)" strokeWidth="1.1" />
      )}
    </svg>
  );
}

function FileTreeNode({
  node,
  depth,
  selected,
  onSelect,
}: {
  node: FileNode;
  depth: number;
  selected: string | null;
  onSelect: (name: string) => void;
}) {
  const [open, setOpen] = useState(depth === 0);
  const isSelected = selected === node.name;

  if (node.type === "folder") {
    return (
      <div>
        <button
          onClick={() => setOpen((o) => !o)}
          style={{
            width: "100%", display: "flex", alignItems: "center",
            gap: 6, padding: `4px 8px 4px ${8 + depth * 14}px`,
            background: "transparent", border: "none", cursor: "pointer",
            borderRadius: 4, transition: "background 120ms ease",
          }}
          onMouseEnter={(e) => (e.currentTarget.style.background = "rgba(201,162,76,0.04)")}
          onMouseLeave={(e) => (e.currentTarget.style.background = "transparent")}
        >
          <svg width="8" height="8" viewBox="0 0 8 8" fill="none" style={{ flexShrink: 0, opacity: 0.4, transform: open ? "rotate(90deg)" : "rotate(0deg)", transition: "transform 140ms ease" }}>
            <path d="M2 1l4 3-4 3" stroke="var(--atlas-fg)" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
          <FolderIcon open={open} />
          <span style={{ fontSize: 12, color: "rgba(231,229,228,0.65)", fontFamily: "var(--app-font-sans)" }}>
            {node.name}
          </span>
        </button>
        {open && node.children?.map((child) => (
          <FileTreeNode key={child.name} node={child} depth={depth + 1} selected={selected} onSelect={onSelect} />
        ))}
      </div>
    );
  }

  return (
    <button
      onClick={() => onSelect(node.name)}
      style={{
        width: "100%", display: "flex", alignItems: "center",
        gap: 6, padding: `4px 8px 4px ${8 + depth * 14}px`,
        background: isSelected ? "rgba(201,162,76,0.08)" : "transparent",
        border: "none", cursor: "pointer", borderRadius: 4,
        transition: "background 120ms ease",
        borderLeft: isSelected ? "2px solid rgba(201,162,76,0.5)" : "2px solid transparent",
      }}
      onMouseEnter={(e) => { if (!isSelected) e.currentTarget.style.background = "rgba(255,255,255,0.03)"; }}
      onMouseLeave={(e) => { if (!isSelected) e.currentTarget.style.background = "transparent"; }}
    >
      <FileIcon ext={node.ext} />
      <span style={{ fontSize: 12, color: isSelected ? "rgba(231,229,228,0.9)" : "rgba(231,229,228,0.55)", fontFamily: "var(--app-font-sans)", textAlign: "left" }}>
        {node.name}
      </span>
    </button>
  );
}

function FilesTab() {
  const [selected, setSelected] = useState<string | null>(null);
  const [showPlaceholder] = useState(true);

  return (
    <div style={{ flex: 1, display: "flex", flexDirection: "column", overflow: "hidden" }}>
      {showPlaceholder ? (
        <>
          {/* Placeholder tree */}
          <div style={{ flex: 1, overflowY: "auto", padding: "10px 4px" }} className="scrollbar-none">
            <div style={{ padding: "0 8px 8px", display: "flex", alignItems: "center", justifyContent: "space-between" }}>
              <span style={{ fontFamily: "var(--app-font-mono)", fontSize: 9, letterSpacing: "0.14em", textTransform: "uppercase", color: "rgba(120,113,108,0.35)" }}>
                Project files
              </span>
              <span style={{ fontFamily: "var(--app-font-mono)", fontSize: 9, letterSpacing: "0.1em", color: "rgba(120,113,108,0.25)", fontStyle: "italic" }}>
                preview
              </span>
            </div>
            {PLACEHOLDER_TREE.map((node) => (
              <FileTreeNode key={node.name} node={node} depth={0} selected={selected} onSelect={setSelected} />
            ))}
          </div>
          {/* Footer */}
          <div style={{ padding: "8px 12px", borderTop: "1px solid var(--atlas-border)", flexShrink: 0 }}>
            <div style={{ fontSize: 10, color: "rgba(120,113,108,0.4)", fontFamily: "var(--app-font-mono)", textAlign: "center", lineHeight: 1.6 }}>
              File sync coming soon
            </div>
          </div>
        </>
      ) : (
        <div style={{ flex: 1, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", padding: "32px 20px", gap: 12 }}>
          <svg width="28" height="28" viewBox="0 0 28 28" fill="none" opacity={0.2}>
            <rect x="2" y="4" width="24" height="20" rx="2" stroke="var(--atlas-fg)" strokeWidth="1.5" />
            <path d="M8 10h12M8 14h8" stroke="var(--atlas-fg)" strokeWidth="1.5" strokeLinecap="round" />
          </svg>
          <div style={{ fontSize: 12, color: "var(--atlas-muted)", opacity: 0.5, textAlign: "center", lineHeight: 1.65 }}>
            No files attached to this project yet.
          </div>
          <button
            style={{
              padding: "6px 14px", borderRadius: 6,
              background: "transparent", border: "1px dashed rgba(201,162,76,0.25)",
              color: "var(--atlas-muted)", fontSize: 11,
              fontFamily: "var(--app-font-mono)", letterSpacing: "0.1em",
              textTransform: "uppercase", cursor: "pointer", opacity: 0.6,
            }}
          >
            + Attach file
          </button>
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
            Enter a URL above to preview<br />your product, site, or reference.
          </div>
        </div>
      )}
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
}: {
  projectId: number;
  entries: Entry[];
  activeCatch: CatchPayload | null;
  onClose?: () => void;
  fullscreen?: boolean;
  onToggleFullscreen?: () => void;
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
      {tab === "files" && <FilesTab />}
      {tab === "preview" && <PreviewTab projectId={projectId} />}
    </div>
  );
}

// ── Mobile FAB ───────────────────────────────────────────────────────────────
function MobileFAB({ onClick, activeTab, entryCount }: { onClick: () => void; activeTab?: RightTab; entryCount: number }) {
  const [hov, setHov] = useState(false);
  return (
    <button
      onClick={onClick}
      onMouseEnter={() => setHov(true)}
      onMouseLeave={() => setHov(false)}
      aria-label="Open workspace panel"
      style={{
        position: "fixed", bottom: 90, right: 16, zIndex: 40,
        width: 48, height: 48, borderRadius: 14,
        background: hov ? "rgba(201,162,76,0.22)" : "rgba(28,25,23,0.92)",
        border: "1px solid rgba(201,162,76,0.32)",
        backdropFilter: "blur(16px)",
        boxShadow: "0 4px 20px rgba(0,0,0,0.5)",
        cursor: "pointer",
        display: "flex", alignItems: "center", justifyContent: "center",
        transition: "all 180ms ease",
      }}
    >
      <svg width="18" height="18" viewBox="0 0 20 20" fill="none">
        <rect x="2" y="2" width="16" height="16" rx="2" stroke="#C9A24C" strokeWidth="1.3" />
        <path d="M9 2v16" stroke="#C9A24C" strokeWidth="1.1" strokeDasharray="1.5 2" />
        <path d="M12 7h4M12 10h4M12 13h3" stroke="#C9A24C" strokeWidth="1.1" strokeLinecap="round" />
      </svg>
      {entryCount > 0 && (
        <div
          style={{
            position: "absolute", top: -4, right: -4,
            width: 16, height: 16, borderRadius: "50%",
            background: "var(--atlas-ember)",
            display: "flex", alignItems: "center", justifyContent: "center",
            fontSize: 8.5, fontFamily: "var(--app-font-mono)",
            color: "var(--atlas-fg)", fontWeight: 600,
          }}
        >
          {entryCount > 9 ? "9+" : entryCount}
        </div>
      )}
    </button>
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
  const [rightOpen, setRightOpen] = useState(false);
  const [chatWidth, setChatWidth] = useState(() => {
    try { return parseInt(localStorage.getItem("atlas-chat-w") || "0") || 520; } catch { return 520; }
  });

  const [attachedFile, setAttachedFile] = useState<File | null>(null);
  const [rightFullscreen, setRightFullscreen] = useState(false);

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
  const sendMessage = useSendMessage();
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
    (text: string, sid: number, currentMessages: ChatMessage[]) => {
      const userMsg: ChatMessage = { role: "user", content: text };
      const history = currentMessages.map((m) => ({ role: m.role, content: m.content }));
      const ledgerEntries = (entries || []).map((e: Entry) => ({ id: e.id, title: e.title, status: e.status }));

      setMessages((prev) => [...prev, userMsg]);

      sendMessage.mutate(
        { data: { sessionId: sid, projectId: id, message: text, mode: "think", history, entries: ledgerEntries } },
        {
          onSuccess: (res) => {
            const cp = res.catchPayload as CatchPayload | null;
            setMessages((prev) => [...prev, {
              id: res.messageId, role: "assistant",
              content: res.content, intentType: res.intentType, catchPayload: cp,
            }]);
            if (cp) setActiveCatch(cp);
          },
          onError: () => {
            setMessages((prev) => [...prev, { role: "assistant", content: "Something went wrong. Please try again." }]);
          },
        }
      );
    },
    [entries, id, sendMessage]
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
  }, [messages, sendMessage.isPending]);

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
    if (!text || !sessionId || sendMessage.isPending) return;
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
        <div style={{ display: "flex", alignItems: "center", gap: 14 }}>
          {sessionId && (
            <span style={{ fontFamily: "var(--app-font-mono)", fontSize: 9.5, letterSpacing: "0.12em", textTransform: "uppercase", color: "rgba(120,113,108,0.35)" }}>
              Session active
            </span>
          )}
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
            {messages.length === 0 && !sendMessage.isPending && (
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
                  onCatchProceed={() => handleCatchProceed(msg.id)}
                  onCatchAdjust={() => handleCatchAdjust(msg.id)}
                  onPark={handlePark}
                  onCommit={handleCommit}
                />
              )
            )}

            {sendMessage.isPending && (
              <div className="atlas-bubble-in" style={{ marginBottom: 24 }}>
                <div style={{ fontFamily: "var(--app-font-mono)", fontSize: 9, letterSpacing: "0.12em", textTransform: "uppercase", color: "var(--atlas-gold)", opacity: 0.35, marginBottom: 8 }}>
                  Atlas
                </div>
                <div className="atlas-think-dots"><span /><span /><span /></div>
              </div>
            )}

            <div ref={bottomRef} />
          </div>

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
                        transition: "all 180ms ease",
                        flexShrink: 0,
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
                    disabled={!hasInput || sendMessage.isPending || !sessionId}
                    style={{
                      width: 38, height: 38,
                      background: hasInput && !sendMessage.isPending && sessionId ? "var(--atlas-ember)" : "rgba(37,34,32,0.7)",
                      border: hasInput ? "none" : "1px solid var(--atlas-border)",
                      boxShadow: hasInput && !sendMessage.isPending ? "0 0 16px -3px rgba(146,64,14,0.5)" : "none",
                      opacity: sendMessage.isPending ? 0.5 : 1,
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
              />
            </div>
          </div>
        )}
      </div>

      {/* Mobile FAB */}
      {isMobile && !rightOpen && (
        <MobileFAB
          onClick={() => setRightOpen(true)}
          activeTab="ledger"
          entryCount={entryCount}
        />
      )}
    </div>
  );
}
