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
}: {
  message: ChatMessage;
  projectId: number;
  sessionId: number;
  onCatchProceed: () => void;
  onCatchAdjust: () => void;
}) {
  return (
    <div className="atlas-bubble-in" style={{ display: "flex", justifyContent: "flex-start", marginBottom: 24 }}>
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
      </div>
    </div>
  );
}

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
                display: "-webkit-box", WebkitLineClamp: 2, WebkitBoxOrient: "vertical", overflow: "hidden",
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

function RightCanvas({
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
    <div style={{ height: "100%", display: "flex", flexDirection: "column", background: "var(--atlas-surface-alt)", borderLeft: "1px solid var(--atlas-border)" }}>
      {/* Header */}
      <div
        style={{
          padding: "11px 14px", borderBottom: "1px solid var(--atlas-border)",
          display: "flex", alignItems: "center", justifyContent: "space-between", flexShrink: 0,
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: 7 }}>
          <div
            style={{
              width: 5, height: 5, borderRadius: "50%",
              background: "var(--atlas-gold)", opacity: entries.length > 0 ? 0.8 : 0.25,
            }}
          />
          <span
            style={{
              fontFamily: "var(--app-font-mono)", fontSize: 9.5,
              letterSpacing: "0.14em", textTransform: "uppercase",
              color: "var(--atlas-gold)", opacity: 0.65,
            }}
          >
            Decision Ledger
          </span>
          {entries.length > 0 && (
            <span
              style={{
                fontFamily: "var(--app-font-mono)", fontSize: 9,
                padding: "1px 5px", borderRadius: 3,
                background: "rgba(201,162,76,0.08)", color: "var(--atlas-gold)", opacity: 0.65,
              }}
            >
              {entries.length}
            </span>
          )}
        </div>
        <button
          onClick={() => setShowAdd(!showAdd)}
          style={{
            fontFamily: "var(--app-font-mono)", fontSize: 9.5,
            letterSpacing: "0.1em", textTransform: "uppercase",
            color: "var(--atlas-muted)", background: "transparent", border: "none",
            cursor: "pointer", opacity: 0.55, transition: "opacity 160ms ease",
          }}
          onMouseEnter={(e) => (e.currentTarget.style.opacity = "1")}
          onMouseLeave={(e) => (e.currentTarget.style.opacity = "0.55")}
        >
          + Add
        </button>
      </div>

      {/* Active catch indicator */}
      {activeCatch && (
        <div
          style={{
            margin: "10px 12px 0", padding: "8px 11px", borderRadius: 7,
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
        <div style={{ padding: "10px 12px", borderBottom: "1px solid var(--atlas-border)" }}>
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
      <div style={{ flex: 1, overflowY: "auto", padding: "12px" }}>
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
    </div>
  );
}

export default function Workspace() {
  const { projectId } = useParams();
  const [, setLocation] = useLocation();
  const id = Number(projectId);
  const queryClient = useQueryClient();

  const [input, setInput] = useState("");
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [sessionId, setSessionId] = useState<number | null>(null);
  const [activeCatch, setActiveCatch] = useState<CatchPayload | null>(null);
  const [chatWidth, setChatWidth] = useState(() => {
    try { return parseInt(localStorage.getItem("atlas-chat-w") || "0") || 520; } catch { return 520; }
  });

  const bottomRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const resizing = useRef(false);
  const lastX = useRef(0);
  const initialSent = useRef(false);

  const { data: project } = useGetProject(id, { query: { enabled: !!id, queryKey: getGetProjectQueryKey(id) } });
  const { data: sessions, isLoading: sessionsLoading } = useListSessions(id, {
    query: { enabled: !!id, queryKey: getListSessionsQueryKey(id) },
  });
  const { data: entries } = useListEntries(id, {}, { query: { enabled: !!id, queryKey: getListEntriesQueryKey(id, {}) } });
  const createSession = useCreateSession();
  const sendMessage = useSendMessage();

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

  const autoResize = () => {
    const el = textareaRef.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = Math.min(el.scrollHeight, 180) + "px";
  };

  const handleSend = () => {
    const text = input.trim();
    if (!text || !sessionId || sendMessage.isPending) return;
    const current = messages;
    setInput("");
    if (textareaRef.current) { textareaRef.current.style.height = "auto"; }
    doSend(text, sessionId, current);
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); handleSend(); }
  };

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
      <div style={{ flex: 1, display: "flex", overflow: "hidden" }}>

        {/* Left: Chat */}
        <div
          style={{
            width: chatWidth, minWidth: 300, flexShrink: 0,
            display: "flex", flexDirection: "column",
            background: "var(--atlas-bg)", overflow: "hidden",
          }}
        >
          {/* Messages */}
          <div style={{ flex: 1, overflowY: "auto", padding: "28px 22px 12px" }}>
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
                <span style={{ fontFamily: "var(--app-font-mono)", fontSize: 9, letterSpacing: "0.06em", color: "var(--atlas-muted)", opacity: 0.3 }}>
                  Enter · Shift+Enter for newline
                </span>
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

        {/* Resize handle */}
        <div
          className="atlas-resize-handle"
          onMouseDown={onResizeMouseDown}
          onDoubleClick={() => setChatWidth(Math.floor(window.innerWidth * 0.5))}
          title="Drag · double-click for 50/50"
        />

        {/* Right: Living canvas */}
        <div style={{ flex: 1, minWidth: 240, overflow: "hidden" }}>
          <RightCanvas projectId={id} entries={entries || []} activeCatch={activeCatch} />
        </div>
      </div>
    </div>
  );
}
