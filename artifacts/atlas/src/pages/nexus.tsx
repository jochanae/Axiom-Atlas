import { useState, useRef, useEffect, useCallback } from "react";
import { createPortal } from "react-dom";
import { useLocation } from "wouter";
import { useRequireAuth } from "@/hooks/useAuth";
import { ProjectsDrawer } from "../components/ProjectsDrawer";
import { UserMenuDropdown } from "../components/UserMenuDropdown";
import type { Entry } from "@workspace/api-client-react";
import {
  useGetNexusThread,
  useListProjects,
  useListEntries,
  useCreateEntry,
  getGetNexusThreadQueryKey,
  getListProjectsQueryKey,
  getListEntriesQueryKey,
} from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";

// ── Types ────────────────────────────────────────────────────────────────────
interface NexusMsg {
  role: "user" | "assistant";
  content: string;
  sentAt: string;
}

// ── Helpers ──────────────────────────────────────────────────────────────────
function loadProfile() {
  try { return JSON.parse(localStorage.getItem("atlas-user-profile") ?? "{}"); }
  catch { return {}; }
}

function getBase() {
  return (import.meta as any).env?.BASE_URL?.replace?.(/\/$/, "") ?? "";
}

// ── Global Ledger subcomponents ───────────────────────────────────────────────

function ProjectEntryGroup({ projectId, projectName, onNavigate }: {
  projectId: number;
  projectName: string;
  onNavigate: (id: number) => void;
}) {
  const [expanded, setExpanded] = useState(false);
  const { data: entries, isLoading } = useListEntries(projectId, {}, {
    query: { enabled: expanded, queryKey: getListEntriesQueryKey(projectId, {}) },
  });

  const committed = (entries ?? []).filter((e: Entry) => e.status === "committed");
  const initial = projectName.trim()[0]?.toUpperCase() ?? "?";
  const hue = (projectName.charCodeAt(0) * 37) % 360;

  return (
    <div style={{ borderBottom: "1px solid var(--atlas-border)" }}>
      <button
        type="button"
        onClick={() => setExpanded(v => !v)}
        style={{
          width: "100%", display: "flex", alignItems: "center", gap: 9,
          padding: "9px 14px", border: "none", background: "transparent",
          cursor: "pointer", textAlign: "left", transition: "background 130ms ease",
        }}
        onMouseEnter={e => { e.currentTarget.style.background = "rgba(201,162,76,0.04)"; }}
        onMouseLeave={e => { e.currentTarget.style.background = "transparent"; }}
      >
        <div style={{
          width: 26, height: 26, borderRadius: 6, flexShrink: 0,
          background: `hsl(${hue}, 22%, 20%)`, display: "flex",
          alignItems: "center", justifyContent: "center",
          fontSize: 11, fontWeight: 700, color: "var(--atlas-fg)", fontFamily: "var(--app-font-mono)",
        }}>
          {initial}
        </div>
        <span style={{ flex: 1, fontSize: 12.5, fontWeight: 500, color: "var(--atlas-fg)", fontFamily: "var(--app-font-sans)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
          {projectName}
        </span>
        <svg width="9" height="9" viewBox="0 0 12 8" fill="none" stroke="var(--atlas-muted)" strokeWidth="1.8" strokeLinecap="round"
          style={{ flexShrink: 0, opacity: 0.55, transform: expanded ? "rotate(180deg)" : "none", transition: "transform 180ms ease" }}>
          <path d="M1 1.5l5 5 5-5" />
        </svg>
      </button>

      {expanded && (
        <div style={{ padding: "0 14px 10px" }}>
          {isLoading ? (
            <div style={{ fontSize: 10.5, color: "var(--atlas-muted)", fontFamily: "var(--app-font-mono)", letterSpacing: "0.08em", opacity: 0.5, padding: "6px 0" }}>
              Loading…
            </div>
          ) : committed.length === 0 ? (
            <div style={{ fontSize: 11, color: "var(--atlas-muted)", opacity: 0.45, fontStyle: "italic", padding: "4px 0" }}>
              No committed decisions yet.
            </div>
          ) : (
            <div style={{ display: "flex", flexDirection: "column", gap: 5 }}>
              {committed.map((e: Entry) => (
                <div key={e.id} style={{
                  padding: "8px 10px", borderRadius: 7,
                  background: "rgba(201,162,76,0.03)",
                  border: "1px solid rgba(201,162,76,0.1)",
                }}>
                  <div style={{ display: "flex", alignItems: "flex-start", gap: 6 }}>
                    <span style={{ width: 5, height: 5, borderRadius: "50%", background: "var(--atlas-gold)", flexShrink: 0, marginTop: 4, opacity: 0.7 }} />
                    <span style={{ fontSize: 12, fontWeight: 500, color: "var(--atlas-fg)", lineHeight: 1.4 }}>{e.title}</span>
                  </div>
                  {e.summary && (
                    <div style={{ fontSize: 11, color: "var(--atlas-muted)", lineHeight: 1.4, marginTop: 4, paddingLeft: 11, opacity: 0.65 }}>
                      {e.summary}
                    </div>
                  )}
                </div>
              ))}
              <button
                type="button"
                onClick={() => onNavigate(projectId)}
                style={{
                  marginTop: 2, fontSize: 10.5, color: "rgba(201,162,76,0.6)", background: "transparent",
                  border: "none", cursor: "pointer", textAlign: "left", fontFamily: "var(--app-font-mono)",
                  letterSpacing: "0.04em", padding: "2px 0",
                }}
              >
                Open full ledger →
              </button>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function GlobalLedger({ projects, onNavigate }: {
  projects: { id: number; name: string }[];
  onNavigate: (id: number) => void;
}) {
  return (
    <div style={{ display: "flex", flexDirection: "column", height: "100%", overflow: "hidden" }}>
      {/* Panel header */}
      <div style={{
        flexShrink: 0, padding: "0 14px", height: 44,
        display: "flex", alignItems: "center", gap: 8,
        borderBottom: "1px solid var(--atlas-border)",
        background: "var(--atlas-surface-alt)",
      }}>
        <svg width="11" height="11" viewBox="0 0 16 16" fill="none" stroke="var(--atlas-gold)" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" style={{ flexShrink: 0, opacity: 0.75 }}>
          <rect x="2" y="2" width="12" height="12" rx="2" /><line x1="5" y1="6" x2="11" y2="6" /><line x1="5" y1="9" x2="9" y2="9" />
        </svg>
        <span style={{ fontSize: 10, fontFamily: "var(--app-font-mono)", fontWeight: 700, letterSpacing: "0.14em", textTransform: "uppercase", color: "var(--atlas-gold)", opacity: 0.85 }}>
          Global Ledger
        </span>
        <span style={{ fontSize: 9.5, fontFamily: "var(--app-font-mono)", color: "var(--atlas-muted)", opacity: 0.4, marginLeft: 2 }}>
          committed · read-only
        </span>
      </div>

      {/* Project list */}
      <div style={{ flex: 1, overflowY: "auto" }} className="scrollbar-none">
        {projects.length === 0 ? (
          <div style={{ padding: "32px 18px", textAlign: "center", fontSize: 12, color: "var(--atlas-muted)", opacity: 0.5, fontStyle: "italic" }}>
            No projects yet.
          </div>
        ) : (
          projects.map(p => (
            <ProjectEntryGroup key={p.id} projectId={p.id} projectName={p.name} onNavigate={onNavigate} />
          ))
        )}
      </div>
    </div>
  );
}

// ── Nexus page ────────────────────────────────────────────────────────────────
export default function NexusPage() {
  useRequireAuth();
  const [, setLocation] = useLocation();
  const queryClient = useQueryClient();

  const { data: thread, isLoading: threadLoading } = useGetNexusThread({
    query: { queryKey: getGetNexusThreadQueryKey() },
  });

  const { data: allProjects } = useListProjects({
    query: { queryKey: getListProjectsQueryKey() },
  });

  const createEntry = useCreateEntry();

  // ── Local chat state ──────────────────────────────────────────────────────
  const [messages, setMessages] = useState<NexusMsg[]>([]);
  const [input, setInput] = useState("");
  const [pending, setPending] = useState(false);
  const [showDrawer, setShowDrawer] = useState(false);
  const [rightOpen, setRightOpen] = useState(true);
  const abortRef = useRef<AbortController | null>(null);
  const bottomRef = useRef<HTMLDivElement | null>(null);
  const textareaRef = useRef<HTMLTextAreaElement | null>(null);
  const initialSent = useRef(false);

  const isMobile = typeof window !== "undefined" && window.innerWidth < 768;

  // Hydrate messages from the Living Thread when it loads
  useEffect(() => {
    if (!thread || messages.length > 0) return;
    setMessages(thread.map(m => ({
      role: m.role as "user" | "assistant",
      content: m.content,
      sentAt: m.createdAt,
    })));
  }, [thread]);

  // Auto-scroll to bottom
  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, pending]);

  // Fire initial message from sessionStorage (set by home page glass input)
  useEffect(() => {
    if (initialSent.current || threadLoading) return;
    const initial = sessionStorage.getItem("atlas-nexus-initial");
    if (!initial) return;
    sessionStorage.removeItem("atlas-nexus-initial");
    initialSent.current = true;
    setTimeout(() => doSend(initial), 80);
  }, [threadLoading]);

  // ── Commit to Project modal ───────────────────────────────────────────────
  const [showCommit, setShowCommit] = useState(false);
  const [commitTargetId, setCommitTargetId] = useState<number | null>(null);
  const [commitTitle, setCommitTitle] = useState("");
  const [commitSummary, setCommitSummary] = useState("");
  const [commitPending, setCommitPending] = useState(false);
  const [commitDone, setCommitDone] = useState(false);

  // ── Send ──────────────────────────────────────────────────────────────────
  const doSend = useCallback((text: string) => {
    if (!text.trim() || pending) return;
    const profile = loadProfile();
    const userProfileStr = profile.name || profile.stack
      ? `Name: ${profile.name ?? "unknown"}\nStack: ${profile.stack ?? "unknown"}`
      : "";

    setMessages(prev => [...prev, { role: "user", content: text, sentAt: new Date().toISOString() }]);
    setPending(true);

    const controller = new AbortController();
    abortRef.current = controller;

    fetch(`${getBase()}/api/nexus/chat`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      credentials: "include",
      body: JSON.stringify({
        message: text,
        ...(userProfileStr ? { userProfile: userProfileStr } : {}),
      }),
      signal: controller.signal,
    })
      .then(r => { if (!r.ok) throw new Error(`HTTP ${r.status}`); return r.json(); })
      .then(res => {
        setMessages(prev => [...prev, { role: "assistant", content: res.response, sentAt: new Date().toISOString() }]);
      })
      .catch(err => {
        if (err instanceof Error && err.name === "AbortError") return;
        setMessages(prev => [...prev, { role: "assistant", content: "Something went wrong — try again.", sentAt: new Date().toISOString() }]);
      })
      .finally(() => { setPending(false); abortRef.current = null; });
  }, [pending]);

  const handleSend = () => {
    const text = input.trim();
    if (!text || pending) return;
    setInput("");
    if (textareaRef.current) textareaRef.current.style.height = "auto";
    doSend(text);
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); handleSend(); }
  };

  const autoResize = () => {
    const el = textareaRef.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = Math.min(el.scrollHeight, 180) + "px";
  };

  const handleStop = () => { abortRef.current?.abort(); };

  const hasInput = input.trim().length > 0;
  const profile = loadProfile();
  const userLabel = profile.name || null;

  const projectList = (allProjects ?? []).map(p => ({ id: p.id, name: p.name, description: p.description, latestSnapshotScore: p.latestSnapshotScore ?? null }));

  // ── Starter prompts ───────────────────────────────────────────────────────
  const STARTERS = [
    { label: "Which of my projects needs the most clarity right now?", sub: "Cross-project audit, honest answer" },
    { label: "Pressure-test an idea I'm sitting on", sub: "I'll push back before it becomes a commitment" },
    { label: "What am I avoiding?", sub: "Surface the thing I keep not doing" },
    { label: "Help me think through a decision that spans projects", sub: "Commit it where it belongs when we land" },
  ];

  return (
    <div style={{ display: "flex", flexDirection: "column", height: "100dvh", background: "var(--atlas-bg)", fontFamily: "var(--app-font-sans)", overflow: "hidden" }}>

      {/* ── Header ── */}
      <header style={{
        flexShrink: 0, display: "flex", alignItems: "center", gap: 10,
        padding: "0 14px", height: 52,
        borderBottom: "1px solid var(--atlas-border)",
        background: "var(--atlas-surface)",
      }}>
        {/* Drawer trigger */}
        <button
          onClick={() => setShowDrawer(true)}
          style={{ width: 32, height: 32, borderRadius: 8, border: "none", background: "transparent", cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center", color: "var(--atlas-muted)", flexShrink: 0 }}
          aria-label="Open menu"
          title="Menu"
        >
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round">
            <line x1="3" y1="6" x2="21" y2="6" /><line x1="3" y1="12" x2="21" y2="12" /><line x1="3" y1="18" x2="21" y2="18" />
          </svg>
        </button>

        {/* Atlas home link */}
        <button
          onClick={() => setLocation("/home")}
          style={{ display: "flex", alignItems: "center", gap: 6, border: "none", background: "transparent", cursor: "pointer", padding: 0, flexShrink: 0 }}
          aria-label="Go home"
          title="Home"
        >
          <svg viewBox="0 0 512 512" width="22" height="22">
            <defs>
              <radialGradient id="nxpg" cx="50%" cy="50%" r="50%">
                <stop offset="0%" stopColor="#5B21B6" stopOpacity="0.35" />
                <stop offset="100%" stopColor="#0D0B09" stopOpacity="0" />
              </radialGradient>
              <radialGradient id="nxgs" cx="50%" cy="40%" r="50%">
                <stop offset="0%" stopColor="#F5D97A" />
                <stop offset="50%" stopColor="#D4AF37" />
                <stop offset="100%" stopColor="#A07820" />
              </radialGradient>
            </defs>
            <rect width="512" height="512" rx="90" fill="#0D0B09" />
            <rect width="512" height="512" rx="90" fill="url(#nxpg)" />
            <polygon points="256,110 170,402 212,402 274,172" fill="url(#nxgs)" />
            <polygon points="256,110 342,402 300,402 238,172" fill="url(#nxgs)" />
            <rect x="180" y="282" width="152" height="34" rx="5" fill="url(#nxgs)" />
          </svg>
        </button>

        {/* Identity: NEXUS (space name) + Atlas (AI persona) */}
        <div style={{ display: "flex", alignItems: "center", gap: 8, flex: 1, minWidth: 0 }}>
          <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="var(--atlas-gold)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ flexShrink: 0, opacity: 0.85 }}>
            <circle cx="12" cy="12" r="3" /><path d="M12 2v4M12 18v4M2 12h4M18 12h4" />
          </svg>
          <span style={{
            fontFamily: "'IBM Plex Mono', var(--app-font-mono)", fontSize: 11,
            fontWeight: 700, letterSpacing: "0.18em", color: "var(--atlas-gold)",
            textTransform: "uppercase",
          }}>
            NEXUS
          </span>
          <span style={{
            fontSize: 10, color: "var(--atlas-muted)", fontFamily: "var(--app-font-sans)",
            opacity: 0.45, letterSpacing: "0.04em",
          }}>
            Atlas
          </span>
        </div>

        {/* Commit to Project button */}
        {!isMobile && (
          <button
            title="Stamp a Nexus decision into a specific project's ledger"
            onClick={() => { setCommitTargetId(null); setCommitTitle(""); setCommitSummary(""); setCommitDone(false); setShowCommit(true); }}
            style={{
              display: "flex", alignItems: "center", gap: 5,
              padding: "4px 10px", borderRadius: 7,
              background: "rgba(201,162,76,0.08)", border: "1px solid rgba(201,162,76,0.22)",
              color: "var(--atlas-gold)", cursor: "pointer", fontSize: 11,
              fontFamily: "var(--app-font-mono)", fontWeight: 600, letterSpacing: "0.06em",
              transition: "background 140ms ease", whiteSpace: "nowrap", flexShrink: 0,
            }}
            onMouseEnter={(e) => { e.currentTarget.style.background = "rgba(201,162,76,0.16)"; }}
            onMouseLeave={(e) => { e.currentTarget.style.background = "rgba(201,162,76,0.08)"; }}
          >
            Commit →
          </button>
        )}

        {/* Toggle right panel */}
        {!isMobile && (
          <button
            title={rightOpen ? "Hide Global Ledger" : "Show Global Ledger"}
            onClick={() => setRightOpen(v => !v)}
            style={{
              display: "flex", alignItems: "center", gap: 4, flexShrink: 0,
              padding: "4px 9px", borderRadius: 7,
              background: rightOpen ? "rgba(201,162,76,0.08)" : "transparent",
              border: `1px solid ${rightOpen ? "rgba(201,162,76,0.25)" : "rgba(37,34,32,0.9)"}`,
              color: rightOpen ? "rgba(201,162,76,0.7)" : "var(--atlas-muted)", cursor: "pointer",
              fontSize: 9.5, fontFamily: "var(--app-font-mono)", fontWeight: 700,
              letterSpacing: "0.12em", textTransform: "uppercase",
              transition: "all 130ms ease",
            }}
            onMouseEnter={e => { e.currentTarget.style.background = "rgba(201,162,76,0.12)"; e.currentTarget.style.color = "rgba(201,162,76,0.9)"; }}
            onMouseLeave={e => {
              e.currentTarget.style.background = rightOpen ? "rgba(201,162,76,0.08)" : "transparent";
              e.currentTarget.style.color = rightOpen ? "rgba(201,162,76,0.7)" : "var(--atlas-muted)";
            }}
          >
            <svg width="11" height="11" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
              <rect x="2" y="2" width="12" height="12" rx="2" /><line x1="6" y1="2" x2="6" y2="14" />
            </svg>
            Ledger
          </button>
        )}

        {/* Return to Orbit */}
        <button
          title="Return to Master Map"
          onClick={() => setLocation("/map")}
          style={{
            display: "flex", alignItems: "center", gap: isMobile ? 0 : 5,
            padding: isMobile ? "5px 8px" : "4px 10px", borderRadius: 7, flexShrink: 0,
            background: "rgba(201,162,76,0.06)", border: "1px solid rgba(201,162,76,0.18)",
            color: "rgba(201,162,76,0.6)", cursor: "pointer",
            fontSize: 9.5, fontFamily: "var(--app-font-mono)",
            fontWeight: 700, letterSpacing: "0.18em", textTransform: "uppercase",
            transition: "all 130ms ease",
          }}
          onMouseEnter={e => { e.currentTarget.style.background = "rgba(201,162,76,0.14)"; e.currentTarget.style.color = "rgba(201,162,76,0.95)"; }}
          onMouseLeave={e => { e.currentTarget.style.background = "rgba(201,162,76,0.06)"; e.currentTarget.style.color = "rgba(201,162,76,0.6)"; }}
        >
          {isMobile ? (
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round">
              <circle cx="12" cy="12" r="10" /><ellipse cx="12" cy="12" rx="4" ry="10" /><line x1="2" y1="12" x2="22" y2="12" />
            </svg>
          ) : (
            <>
              <svg width="11" height="11" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round">
                <path d="M8 11V3M4 6l4-4 4 4" /><path d="M2 13h12" opacity="0.45" />
              </svg>
              Orbit
            </>
          )}
        </button>

        <UserMenuDropdown onOpenProfile={() => {}} />
      </header>

      {/* ── Two-pane body ── */}
      <div style={{ flex: 1, display: "flex", overflow: "hidden" }}>

        {/* ── Left pane: Living Thread ── */}
        <div style={{ flex: 1, display: "flex", flexDirection: "column", overflow: "hidden", minWidth: 0 }}>

          {/* Chat scroll area */}
          <div style={{ flex: 1, overflowY: "auto", padding: "24px 0 12px", position: "relative" }} className="scrollbar-none">

            {/* Empty state */}
            {messages.length === 0 && !pending && !threadLoading && (
              <div style={{ padding: "52px 24px 32px", display: "flex", flexDirection: "column", alignItems: "center" }}>
                <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 6 }}>
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="var(--atlas-gold)" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" style={{ opacity: 0.7 }}>
                    <circle cx="12" cy="12" r="3" /><path d="M12 2v4M12 18v4M2 12h4M18 12h4" />
                  </svg>
                  <div style={{ fontSize: 22, fontWeight: 300, color: "var(--atlas-gold)", letterSpacing: "-0.01em", opacity: 0.85 }}>
                    Nexus
                  </div>
                </div>
                <div style={{ fontSize: 12.5, color: "var(--atlas-muted)", marginBottom: 28, textAlign: "center", maxWidth: 340, lineHeight: 1.6, opacity: 0.7 }}>
                  Your cross-project thinking space. No scope, no constraints. What are we working through?
                </div>

                <div style={{ display: "flex", flexDirection: "column", gap: 8, width: "100%", maxWidth: 440 }}>
                  {STARTERS.map((s, i) => (
                    <button key={i} onClick={() => { setInput(s.label); setTimeout(() => textareaRef.current?.focus(), 0); }}
                      style={{
                        display: "flex", flexDirection: "column", alignItems: "flex-start",
                        padding: "11px 14px", borderRadius: 9, cursor: "pointer",
                        background: "rgba(201,162,76,0.03)", border: "1px solid rgba(201,162,76,0.08)",
                        textAlign: "left", transition: "all 160ms ease",
                      }}
                      onMouseEnter={e => { e.currentTarget.style.background = "rgba(201,162,76,0.07)"; e.currentTarget.style.borderColor = "rgba(201,162,76,0.18)"; }}
                      onMouseLeave={e => { e.currentTarget.style.background = "rgba(201,162,76,0.03)"; e.currentTarget.style.borderColor = "rgba(201,162,76,0.08)"; }}
                    >
                      <span style={{ fontSize: 12.5, color: "var(--atlas-fg)", opacity: 0.8, fontWeight: 500, lineHeight: 1.3 }}>{s.label}</span>
                      <span style={{ fontSize: 10.5, color: "var(--atlas-muted)", opacity: 0.5, marginTop: 2 }}>{s.sub}</span>
                    </button>
                  ))}
                </div>
              </div>
            )}

            {/* Loading indicator while thread loads */}
            {threadLoading && messages.length === 0 && (
              <div style={{ padding: "80px 24px", textAlign: "center" }}>
                <div style={{ fontSize: 11, color: "var(--atlas-muted)", fontFamily: "var(--app-font-mono)", letterSpacing: "0.1em", opacity: 0.5 }}>
                  Loading thread…
                </div>
              </div>
            )}

            {/* Message thread */}
            <div style={{ maxWidth: 720, margin: "0 auto", padding: "0 16px", display: "flex", flexDirection: "column", gap: 2 }}>
              {messages.map((msg, i) =>
                msg.role === "user" ? (
                  <div key={i} style={{ display: "flex", justifyContent: "flex-end", marginBottom: 4 }}>
                    <div style={{
                      maxWidth: "82%", padding: "10px 14px", borderRadius: "14px 14px 4px 14px",
                      background: "rgba(201,162,76,0.1)", border: "1px solid rgba(201,162,76,0.18)",
                      fontSize: 13.5, color: "var(--atlas-fg)", lineHeight: 1.55,
                      whiteSpace: "pre-wrap", wordBreak: "break-word",
                    }}>
                      {msg.content}
                    </div>
                  </div>
                ) : (
                  <div key={i} style={{ display: "flex", gap: 10, marginBottom: 8, alignItems: "flex-start" }}>
                    <div style={{
                      width: 26, height: 26, borderRadius: 7, flexShrink: 0, marginTop: 2,
                      background: "rgba(201,162,76,0.08)", border: "1px solid rgba(201,162,76,0.18)",
                      display: "flex", alignItems: "center", justifyContent: "center",
                    }}>
                      <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="var(--atlas-gold)" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
                        <circle cx="12" cy="12" r="3" /><path d="M12 2v4M12 18v4M2 12h4M18 12h4" />
                      </svg>
                    </div>
                    <div style={{
                      flex: 1, padding: "10px 14px", borderRadius: "4px 14px 14px 14px",
                      background: "var(--atlas-surface)", border: "1px solid var(--atlas-border)",
                      fontSize: 13.5, color: "var(--atlas-fg)", lineHeight: 1.65,
                      whiteSpace: "pre-wrap", wordBreak: "break-word",
                    }}>
                      {msg.content}
                    </div>
                  </div>
                )
              )}

              {/* Pending indicator */}
              {pending && (
                <div style={{ display: "flex", gap: 10, marginBottom: 8, alignItems: "flex-start" }}>
                  <div style={{
                    width: 26, height: 26, borderRadius: 7, flexShrink: 0, marginTop: 2,
                    background: "rgba(201,162,76,0.08)", border: "1px solid rgba(201,162,76,0.18)",
                    display: "flex", alignItems: "center", justifyContent: "center",
                  }}>
                    <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="var(--atlas-gold)" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
                      <circle cx="12" cy="12" r="3" /><path d="M12 2v4M12 18v4M2 12h4M18 12h4" />
                    </svg>
                  </div>
                  <div style={{ flex: 1, padding: "12px 14px", background: "var(--atlas-surface)", border: "1px solid var(--atlas-border)", borderRadius: "4px 14px 14px 14px" }}>
                    <span style={{ fontFamily: "var(--app-font-mono)", fontSize: 10, letterSpacing: "0.12em", color: "rgba(201,162,76,0.55)", animation: "nexus-dots 1.2s ease-in-out infinite" }}>
                      Thinking…
                    </span>
                  </div>
                </div>
              )}

              <div ref={bottomRef} />
            </div>
          </div>

          {/* Input bar */}
          <div style={{ flexShrink: 0, padding: "12px 16px calc(env(safe-area-inset-bottom, 0px) + 12px)", borderTop: "1px solid var(--atlas-border)", background: "var(--atlas-surface)" }}>
            <div style={{ maxWidth: 720, margin: "0 auto", position: "relative" }}>
              <div className="atlas-input-shell" style={{ display: "flex", alignItems: "flex-end", gap: 8 }}>
                <textarea
                  ref={textareaRef}
                  value={input}
                  onChange={e => { setInput(e.target.value); autoResize(); }}
                  onKeyDown={handleKeyDown}
                  placeholder="What are we working through?"
                  rows={1}
                  style={{
                    flex: 1, resize: "none", border: "none", background: "transparent",
                    color: "var(--atlas-fg)", fontSize: 13.5, fontFamily: "var(--app-font-sans)",
                    outline: "none", lineHeight: 1.55, padding: "10px 0 10px 14px",
                    maxHeight: 180, overflowY: "auto",
                  }}
                />
                {pending ? (
                  <button
                    onClick={handleStop}
                    style={{ width: 34, height: 34, borderRadius: 8, border: "none", background: "rgba(146,64,14,0.2)", color: "rgba(230,130,80,0.8)", cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0, marginBottom: 5, marginRight: 8 }}
                    title="Stop"
                  >
                    <svg width="12" height="12" viewBox="0 0 16 16" fill="currentColor"><rect x="3" y="3" width="10" height="10" rx="1" /></svg>
                  </button>
                ) : (
                  <button
                    onClick={handleSend}
                    disabled={!hasInput}
                    className="atlas-send-btn"
                    style={{ marginBottom: 5, marginRight: 8 }}
                  >
                    <svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round">
                      <path d="M2 14L14 8 2 2v4.5l8 1.5-8 1.5z" />
                    </svg>
                  </button>
                )}
              </div>
            </div>
          </div>
        </div>

        {/* ── Right pane: Global Ledger ── */}
        {!isMobile && rightOpen && (
          <div style={{
            width: 300, flexShrink: 0,
            borderLeft: "1px solid var(--atlas-border)",
            background: "var(--atlas-surface-alt)",
            display: "flex", flexDirection: "column",
            overflow: "hidden",
          }}>
            <GlobalLedger
              projects={(allProjects ?? []).map(p => ({ id: p.id, name: p.name }))}
              onNavigate={(id) => setLocation(`/ledger/${id}`)}
            />
          </div>
        )}
      </div>

      {/* Projects Drawer */}
      <ProjectsDrawer
        open={showDrawer}
        onClose={() => setShowDrawer(false)}
        projects={projectList}
        activeProjectId={null}
        onOpenProject={(id) => { setLocation(`/project/${id}`); setShowDrawer(false); }}
        onNewProject={() => { setShowDrawer(false); }}
        onOpenLedger={(id) => { setLocation(`/ledger/${id}`); setShowDrawer(false); }}
        onOpenParking={() => { setLocation("/parking"); setShowDrawer(false); }}
        userLabel={userLabel}
      />

      {/* Commit to Project modal */}
      {showCommit && createPortal(
        <>
          <div onClick={() => setShowCommit(false)} style={{ position: "fixed", inset: 0, zIndex: 9990, background: "rgba(0,0,0,0.65)", backdropFilter: "blur(4px)" }} />
          <div style={{
            position: "fixed", top: "50%", left: "50%", transform: "translate(-50%,-50%)",
            zIndex: 9991, width: "min(440px, calc(100vw - 32px))",
            background: "var(--atlas-surface)", border: "1px solid rgba(201,162,76,0.25)",
            borderRadius: 16, padding: "26px 26px 22px", boxShadow: "0 32px 80px rgba(0,0,0,0.7)",
          }}>
            <div style={{ marginBottom: 18 }}>
              <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 5 }}>
                <span style={{ width: 7, height: 7, borderRadius: "50%", background: "var(--atlas-gold)", display: "inline-block", flexShrink: 0 }} />
                <span style={{ fontSize: 10, fontFamily: "var(--app-font-mono)", fontWeight: 700, letterSpacing: "0.12em", textTransform: "uppercase" as const, color: "var(--atlas-gold)" }}>Commit to Project</span>
              </div>
              <div style={{ fontSize: 13, color: "var(--atlas-muted)", lineHeight: 1.5 }}>
                Stamp a Nexus decision into a specific project's Decision Ledger.
              </div>
            </div>

            {commitDone ? (
              <div style={{ textAlign: "center", padding: "24px 0 8px" }}>
                <div style={{ fontSize: 24, marginBottom: 8, color: "var(--atlas-gold)" }}>✓</div>
                <div style={{ fontSize: 13, color: "var(--atlas-gold)", fontFamily: "var(--app-font-mono)" }}>Decision committed to ledger.</div>
              </div>
            ) : (
              <>
                <div style={{ marginBottom: 14 }}>
                  <div style={{ fontSize: 9.5, fontFamily: "var(--app-font-mono)", color: "var(--atlas-muted)", letterSpacing: "0.1em", textTransform: "uppercase" as const, marginBottom: 7, opacity: 0.7 }}>Target project</div>
                  <div style={{ display: "flex", flexDirection: "column", gap: 4, maxHeight: 180, overflowY: "auto" }}>
                    {(allProjects ?? []).map(p => (
                      <button key={p.id} onClick={() => setCommitTargetId(p.id)} style={{
                        display: "flex", alignItems: "center", gap: 9, padding: "7px 10px", borderRadius: 7,
                        background: commitTargetId === p.id ? "rgba(201,162,76,0.1)" : "transparent",
                        border: `1px solid ${commitTargetId === p.id ? "rgba(201,162,76,0.4)" : "var(--atlas-border)"}`,
                        cursor: "pointer", textAlign: "left", transition: "all 120ms ease",
                      }}>
                        <div style={{ width: 22, height: 22, borderRadius: 5, flexShrink: 0, background: `hsl(${(p.name.charCodeAt(0) * 37) % 360}, 22%, 22%)`, display: "flex", alignItems: "center", justifyContent: "center", fontSize: 10, fontWeight: 700, color: "var(--atlas-fg)", fontFamily: "var(--app-font-mono)" }}>
                          {p.name[0]?.toUpperCase()}
                        </div>
                        <span style={{ fontSize: 12.5, color: "var(--atlas-fg)", fontFamily: "var(--app-font-sans)" }}>{p.name}</span>
                        {commitTargetId === p.id && <svg style={{ marginLeft: "auto", flexShrink: 0 }} width="12" height="12" viewBox="0 0 16 16" fill="none" stroke="var(--atlas-gold)" strokeWidth="2.4" strokeLinecap="round"><path d="M3 8l4 4 6-7" /></svg>}
                      </button>
                    ))}
                    {(allProjects ?? []).length === 0 && (
                      <div style={{ fontSize: 12, color: "var(--atlas-muted)", opacity: 0.5, padding: "8px 4px", fontStyle: "italic" }}>No projects yet. Create one first.</div>
                    )}
                  </div>
                </div>

                <div style={{ marginBottom: 11 }}>
                  <div style={{ fontSize: 9.5, fontFamily: "var(--app-font-mono)", color: "var(--atlas-muted)", letterSpacing: "0.1em", textTransform: "uppercase" as const, marginBottom: 5, opacity: 0.7 }}>Decision title</div>
                  <input
                    placeholder="e.g. Pivot IntoIQ toward lead-gen funnel"
                    value={commitTitle}
                    onChange={(e) => setCommitTitle(e.target.value)}
                    style={{ width: "100%", padding: "8px 10px", borderRadius: 7, background: "var(--atlas-surface-alt)", border: "1px solid var(--atlas-border)", color: "var(--atlas-fg)", fontSize: 12.5, fontFamily: "var(--app-font-sans)", outline: "none", boxSizing: "border-box" as const }}
                  />
                </div>

                <div style={{ marginBottom: 20 }}>
                  <div style={{ fontSize: 9.5, fontFamily: "var(--app-font-mono)", color: "var(--atlas-muted)", letterSpacing: "0.1em", textTransform: "uppercase" as const, marginBottom: 5, opacity: 0.7 }}>Summary (optional)</div>
                  <textarea
                    placeholder="Brief context or rationale…"
                    value={commitSummary}
                    onChange={(e) => setCommitSummary(e.target.value)}
                    rows={2}
                    style={{ width: "100%", padding: "8px 10px", borderRadius: 7, background: "var(--atlas-surface-alt)", border: "1px solid var(--atlas-border)", color: "var(--atlas-fg)", fontSize: 12, fontFamily: "var(--app-font-sans)", outline: "none", resize: "none" as const, boxSizing: "border-box" as const }}
                  />
                </div>

                <div style={{ display: "flex", gap: 8, justifyContent: "flex-end" }}>
                  <button onClick={() => setShowCommit(false)} style={{ padding: "7px 14px", borderRadius: 8, border: "1px solid var(--atlas-border)", background: "transparent", color: "var(--atlas-muted)", cursor: "pointer", fontSize: 12, fontFamily: "var(--app-font-mono)" }}>
                    Cancel
                  </button>
                  <button
                    disabled={!commitTargetId || !commitTitle.trim() || commitPending}
                    onClick={async () => {
                      if (!commitTargetId || !commitTitle.trim()) return;
                      setCommitPending(true);
                      try {
                        await createEntry.mutateAsync({
                          projectId: commitTargetId,
                          data: {
                            title: commitTitle.trim().slice(0, 120),
                            summary: commitSummary.trim() || `Committed from Nexus on ${new Date().toLocaleDateString()}`,
                            status: "committed",
                            severity: "committed",
                            mode: "decide",
                            sessionId: null,
                          },
                        });
                        queryClient.invalidateQueries({ queryKey: getListEntriesQueryKey(commitTargetId, {}) });
                        setCommitDone(true);
                        setTimeout(() => setShowCommit(false), 1800);
                      } catch {
                        // silent
                      } finally {
                        setCommitPending(false);
                      }
                    }}
                    style={{
                      padding: "7px 16px", borderRadius: 8, border: "none",
                      background: (!commitTargetId || !commitTitle.trim() || commitPending)
                        ? "rgba(201,162,76,0.3)"
                        : "linear-gradient(180deg, var(--atlas-gold) 0%, color-mix(in oklab, var(--atlas-gold) 75%, #6a4a18) 100%)",
                      color: "var(--atlas-bg)", cursor: (!commitTargetId || !commitTitle.trim() || commitPending) ? "not-allowed" : "pointer",
                      fontSize: 12, fontFamily: "var(--app-font-mono)", fontWeight: 700, letterSpacing: "0.06em",
                    }}
                  >
                    {commitPending ? "Saving…" : "Commit"}
                  </button>
                </div>
              </>
            )}
          </div>
        </>,
        document.body
      )}

      <style>{`
        @keyframes nexus-dots {
          0%, 100% { opacity: 0.55; }
          50% { opacity: 0.9; }
        }
      `}</style>
    </div>
  );
}
