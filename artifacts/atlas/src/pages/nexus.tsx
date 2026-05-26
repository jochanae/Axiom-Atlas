import { useState, useRef, useEffect, useCallback } from "react";
import { useLocation } from "wouter";
import { useRequireAuth } from "@/hooks/useAuth";
import { ProjectsDrawer } from "../components/ProjectsDrawer";
import { UserMenuDropdown } from "../components/UserMenuDropdown";
import type { Entry } from "@workspace/api-client-react";
import {
  useGetNexusThread,
  useListProjects,
  useListEntries,
  useClearNexusThread,
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

function ProjectEntryGroup({ projectId, projectName, onNavigate, onCountReady, searchTerm }: {
  projectId: number;
  projectName: string;
  onNavigate: (id: number) => void;
  onCountReady?: (projectId: number, count: number) => void;
  searchTerm?: string;
}) {
  const [expanded, setExpanded] = useState(false);
  const { data: entries, isLoading } = useListEntries(projectId, {}, {
    query: { queryKey: getListEntriesQueryKey(projectId, {}) },
  });

  const committed = (entries ?? []).filter((e: Entry) => e.status === "committed");
  const q = searchTerm?.trim().toLowerCase() ?? "";
  const visible = q
    ? committed.filter(e =>
        e.title.toLowerCase().includes(q) ||
        (e.summary ?? "").toLowerCase().includes(q)
      )
    : committed;
  const initial = projectName.trim()[0]?.toUpperCase() ?? "?";
  const hue = (projectName.charCodeAt(0) * 37) % 360;

  // Report count upward once loaded
  useEffect(() => {
    if (entries !== undefined && onCountReady) {
      onCountReady(projectId, committed.length);
    }
  }, [entries, committed.length, projectId, onCountReady]);

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
        {committed.length > 0 && (
          <span style={{
            fontSize: 9, fontFamily: "var(--app-font-mono)", fontWeight: 700,
            color: "rgba(201,162,76,0.55)", letterSpacing: "0.06em",
            background: "rgba(201,162,76,0.07)", borderRadius: 4,
            padding: "1px 5px", flexShrink: 0,
          }}>
            {committed.length}
          </span>
        )}
        {isLoading && (
          <span style={{ fontSize: 9, color: "var(--atlas-muted)", opacity: 0.4, flexShrink: 0, fontFamily: "var(--app-font-mono)" }}>…</span>
        )}
        <svg width="9" height="9" viewBox="0 0 12 8" fill="none" stroke="var(--atlas-muted)" strokeWidth="1.8" strokeLinecap="round"
          style={{ flexShrink: 0, opacity: 0.55, transform: expanded ? "rotate(180deg)" : "none", transition: "transform 180ms ease", marginLeft: 2 }}>
          <path d="M1 1.5l5 5 5-5" />
        </svg>
      </button>

      {(expanded || (q && visible.length > 0)) && (
        <div style={{ padding: "0 14px 10px" }}>
          {isLoading ? (
            <div style={{ fontSize: 10.5, color: "var(--atlas-muted)", fontFamily: "var(--app-font-mono)", letterSpacing: "0.08em", opacity: 0.5, padding: "6px 0" }}>
              Loading…
            </div>
          ) : visible.length === 0 ? (
            <div style={{ fontSize: 11, color: "var(--atlas-muted)", opacity: 0.45, fontStyle: "italic", padding: "4px 0" }}>
              {q ? "No matches." : "No committed decisions in this project yet."}
            </div>
          ) : (
            <div style={{ display: "flex", flexDirection: "column", gap: 5 }}>
              {visible.map((e: Entry) => (
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
  const [counts, setCounts] = useState<Record<number, number>>({});
  const [search, setSearch] = useState("");

  const handleCountReady = useCallback((projectId: number, count: number) => {
    setCounts(prev => {
      if (prev[projectId] === count) return prev;
      return { ...prev, [projectId]: count };
    });
  }, []);

  const totalCommitted = Object.values(counts).reduce((sum, n) => sum + n, 0);
  const countsLoaded = Object.keys(counts).length === projects.length;

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
        {/* Total committed count badge — always shown once counts are loaded */}
        {countsLoaded && (
          <span style={{
            fontSize: 9, fontFamily: "var(--app-font-mono)", fontWeight: 700,
            color: "rgba(201,162,76,0.75)", background: "rgba(201,162,76,0.1)",
            border: "1px solid rgba(201,162,76,0.22)", borderRadius: 5,
            padding: "1px 6px", letterSpacing: "0.04em", flexShrink: 0,
          }}>
            {totalCommitted}
          </span>
        )}
        <span style={{ fontSize: 9.5, fontFamily: "var(--app-font-mono)", color: "var(--atlas-muted)", opacity: 0.4, marginLeft: "auto" }}>
          read-only
        </span>
      </div>

      {/* Search input */}
      <div style={{ flexShrink: 0, padding: "6px 10px", borderBottom: "1px solid var(--atlas-border)" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 6, background: "rgba(255,255,255,0.03)", border: "1px solid var(--atlas-border)", borderRadius: 7, padding: "5px 9px" }}>
          <svg width="10" height="10" viewBox="0 0 16 16" fill="none" stroke="var(--atlas-muted)" strokeWidth="1.6" strokeLinecap="round"><circle cx="6.5" cy="6.5" r="4.5"/><path d="M10.5 10.5l3 3"/></svg>
          <input
            type="text"
            placeholder="Search decisions…"
            value={search}
            onChange={e => setSearch(e.target.value)}
            style={{
              flex: 1, background: "transparent", border: "none", outline: "none",
              fontSize: 11, color: "var(--atlas-fg)", fontFamily: "var(--app-font-sans)",
            }}
          />
          {search && (
            <button onClick={() => setSearch("")} style={{ background: "transparent", border: "none", cursor: "pointer", color: "var(--atlas-muted)", fontSize: 13, lineHeight: 1, padding: 0, opacity: 0.6 }}>×</button>
          )}
        </div>
      </div>

      {/* Project list */}
      <div style={{ flex: 1, overflowY: "auto" }} className="scrollbar-none">
        {projects.map(p => (
          <ProjectEntryGroup key={p.id} projectId={p.id} projectName={p.name} onNavigate={onNavigate} onCountReady={handleCountReady} searchTerm={search} />
        ))}
        {/* Global empty state: shown when all project counts are in and none have commits */}
        {countsLoaded && totalCommitted === 0 && (
          <div style={{ padding: "32px 18px", textAlign: "center", fontSize: 12, color: "var(--atlas-muted)", opacity: 0.5, fontStyle: "italic" }}>
            No committed decisions yet across your projects.
          </div>
        )}
      </div>
    </div>
  );
}

// ── Nexus page ────────────────────────────────────────────────────────────────
export default function NexusPage() {
  useRequireAuth();
  const [, setLocation] = useLocation();

  const { data: thread, isLoading: threadLoading } = useGetNexusThread({
    query: { queryKey: getGetNexusThreadQueryKey() },
  });

  const { data: allProjects } = useListProjects(undefined, {
    query: { queryKey: getListProjectsQueryKey() },
  });

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
  const [copiedIdx, setCopiedIdx] = useState<number | null>(null);
  const [showClearConfirm, setShowClearConfirm] = useState(false);
  const [clearing, setClearing] = useState(false);
  const queryClient = useQueryClient();
  const clearThread = useClearNexusThread();

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
    { label: "Which of my projects needs the most clarity right now?", sub: "Cross-project audit, honest answer", iconD: "M12 2L2 7l10 5 10-5-10-5zM2 12l10 5 10-5M2 17l10 5 10-5" },
    { label: "Pressure-test an idea I'm sitting on", sub: "I'll push back before it becomes a commitment", iconD: "M13 10V3L4 14h7v7l9-11h-7z" },
    { label: "What am I avoiding?", sub: "Surface the thing I keep not doing", iconD: "M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8zM12 9v3m0 4h.01" },
    { label: "Help me think through a decision that spans projects", sub: "Commit it where it belongs when we land", iconD: "M6 3v12M18 9a3 3 0 00-3-3H9a3 3 0 000 6h6a3 3 0 010 6H6" },
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
            textTransform: "uppercase", display: "inline-flex",
          }}>
            {"NEXUS".split("").map((ch, i) => (
              <span key={i} style={{
                display: "inline-block",
                animation: "nexus-letter-in 0.45s cubic-bezier(0.22,1,0.36,1) both",
                animationDelay: `${i * 0.07}s`,
              }}>{ch}</span>
            ))}
          </span>
          <span style={{
            fontSize: 10, color: "var(--atlas-muted)", fontFamily: "var(--app-font-sans)",
            opacity: 0.45, letterSpacing: "0.04em",
          }}>
            Atlas
          </span>
        </div>

        {/* Toggle right panel */}
        {!isMobile && (
          <button
            title={rightOpen ? "Hide Global Ledger" : "Show Global Ledger"}
            onClick={() => setRightOpen(v => !v)}
            style={{
              display: "flex", alignItems: "center", gap: 4, flexShrink: 0,
              padding: "4px 9px", borderRadius: 7,
              background: rightOpen ? "rgba(201,162,76,0.08)" : "transparent",
              border: `1px solid ${rightOpen ? "rgba(201,162,76,0.25)" : "var(--atlas-surface)"}`,
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

          {/* Thread sub-header: clear thread button when there are messages */}
          {messages.length > 0 && (
            <div style={{ flexShrink: 0, display: "flex", alignItems: "center", justifyContent: "flex-end", padding: "4px 16px", borderBottom: "1px solid var(--atlas-surface)" }}>
              {showClearConfirm ? (
                <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                  <span style={{ fontSize: 10.5, color: "var(--atlas-muted)", fontFamily: "var(--app-font-mono)", opacity: 0.7 }}>Erase the Living Thread?</span>
                  <button
                    onClick={async () => {
                      setClearing(true);
                      try {
                        await clearThread.mutateAsync();
                        setMessages([]);
                        queryClient.invalidateQueries({ queryKey: getGetNexusThreadQueryKey() });
                      } finally {
                        setClearing(false);
                        setShowClearConfirm(false);
                      }
                    }}
                    disabled={clearing}
                    style={{ fontSize: 10, fontFamily: "var(--app-font-mono)", fontWeight: 700, color: "var(--atlas-ember)", background: "transparent", border: "none", cursor: "pointer", padding: "1px 6px", letterSpacing: "0.06em" }}
                  >
                    {clearing ? "Clearing…" : "Yes, clear"}
                  </button>
                  <button onClick={() => setShowClearConfirm(false)} style={{ fontSize: 10, fontFamily: "var(--app-font-mono)", color: "var(--atlas-muted)", background: "transparent", border: "none", cursor: "pointer", padding: "1px 4px", opacity: 0.6 }}>
                    Cancel
                  </button>
                </div>
              ) : (
                <button
                  onClick={() => setShowClearConfirm(true)}
                  style={{ fontSize: 10, fontFamily: "var(--app-font-mono)", color: "var(--atlas-muted)", background: "transparent", border: "none", cursor: "pointer", padding: "3px 0", opacity: 0.45, letterSpacing: "0.06em", transition: "opacity 130ms ease" }}
                  onMouseEnter={e => { e.currentTarget.style.opacity = "0.8"; }}
                  onMouseLeave={e => { e.currentTarget.style.opacity = "0.45"; }}
                >
                  × clear thread
                </button>
              )}
            </div>
          )}

          {/* Chat scroll area */}
          <div style={{ flex: 1, overflowY: "auto", padding: "24px 0 12px", position: "relative" }} className="scrollbar-none">

            {/* Empty state — cinematic */}
            {messages.length === 0 && !pending && !threadLoading && (
              <div style={{ padding: "48px 20px 32px", display: "flex", flexDirection: "column", alignItems: "center", position: "relative" }}>

                {/* Atmospheric glow — behind everything */}
                <div style={{
                  position: "absolute", top: 0, left: "50%", transform: "translateX(-50%)",
                  width: "70%", height: 220,
                  background: "radial-gradient(ellipse at 50% 30%, rgba(91,33,182,0.09) 0%, transparent 70%)",
                  pointerEvents: "none", filter: "blur(12px)",
                }} />

                {/* Header */}
                <div style={{ textAlign: "center", marginBottom: 32, position: "relative" }}>
                  <div style={{ display: "flex", alignItems: "center", justifyContent: "center", gap: 10, marginBottom: 10 }}>
                    <div style={{
                      width: 38, height: 38, borderRadius: 10, flexShrink: 0,
                      background: "rgba(201,162,76,0.07)", border: "1px solid rgba(201,162,76,0.18)",
                      display: "flex", alignItems: "center", justifyContent: "center",
                      boxShadow: "0 0 24px rgba(201,162,76,0.08)",
                    }}>
                      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="var(--atlas-gold)" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
                        <circle cx="12" cy="12" r="3" /><path d="M12 2v4M12 18v4M2 12h4M18 12h4" />
                      </svg>
                    </div>
                    <div style={{
                      fontSize: 30, fontWeight: 300, letterSpacing: "0.14em",
                      color: "var(--atlas-gold)", display: "inline-flex",
                    }}>
                      {"NEXUS".split("").map((ch, i) => (
                        <span key={i} style={{
                          display: "inline-block",
                          animation: "nexus-letter-in 0.5s cubic-bezier(0.22,1,0.36,1) both",
                          animationDelay: `${0.08 + i * 0.07}s`,
                        }}>{ch}</span>
                      ))}
                    </div>
                  </div>

                  <div style={{
                    fontSize: 9, fontFamily: "var(--app-font-mono)", color: "var(--atlas-muted)",
                    opacity: 0.45, letterSpacing: "0.28em", textTransform: "uppercase", marginBottom: 14,
                  }}>
                    Operational Oversight
                  </div>

                  <div style={{
                    width: 48, height: 1, margin: "0 auto",
                    background: "linear-gradient(90deg, transparent, rgba(201,162,76,0.35), transparent)",
                  }} />
                </div>

                {/* Module cards — 2-col grid */}
                <div style={{
                  display: "grid",
                  gridTemplateColumns: "repeat(2, 1fr)",
                  gap: 8,
                  width: "100%",
                  maxWidth: 500,
                }}>
                  {STARTERS.map((s, i) => (
                    <button key={i}
                      onClick={() => { setInput(s.label); setTimeout(() => textareaRef.current?.focus(), 0); }}
                      style={{
                        display: "flex", flexDirection: "column", alignItems: "flex-start",
                        padding: "13px 13px", borderRadius: 12, cursor: "pointer",
                        background: "rgba(201,162,76,0.02)", border: "1px solid rgba(201,162,76,0.09)",
                        textAlign: "left", transition: "all 180ms ease", gap: 9,
                      }}
                      onMouseEnter={e => {
                        e.currentTarget.style.background = "rgba(201,162,76,0.06)";
                        e.currentTarget.style.borderColor = "rgba(201,162,76,0.22)";
                        e.currentTarget.style.boxShadow = "0 0 20px rgba(201,162,76,0.06)";
                      }}
                      onMouseLeave={e => {
                        e.currentTarget.style.background = "rgba(201,162,76,0.02)";
                        e.currentTarget.style.borderColor = "rgba(201,162,76,0.09)";
                        e.currentTarget.style.boxShadow = "none";
                      }}
                    >
                      {/* Card icon */}
                      <div style={{
                        width: 28, height: 28, borderRadius: 7, flexShrink: 0,
                        background: "rgba(201,162,76,0.07)", border: "1px solid rgba(201,162,76,0.15)",
                        display: "flex", alignItems: "center", justifyContent: "center",
                      }}>
                        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="var(--atlas-gold)" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" style={{ opacity: 0.8 }}>
                          <path d={s.iconD} />
                        </svg>
                      </div>
                      {/* Card text */}
                      <div>
                        <div style={{ fontSize: 11.5, color: "var(--atlas-fg)", opacity: 0.82, fontWeight: 500, lineHeight: 1.45, marginBottom: 4 }}>{s.label}</div>
                        <div style={{ fontSize: 9.5, color: "var(--atlas-muted)", opacity: 0.5, fontFamily: "var(--app-font-mono)", letterSpacing: "0.04em" }}>{s.sub}</div>
                      </div>
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
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{
                        padding: "10px 14px", borderRadius: "4px 14px 14px 14px",
                        background: "var(--atlas-surface)", border: "1px solid var(--atlas-border)",
                        fontSize: 13.5, color: "var(--atlas-fg)", lineHeight: 1.65,
                        whiteSpace: "pre-wrap", wordBreak: "break-word",
                      }}>
                        {msg.content}
                      </div>
                      {/* Copy button */}
                      <button
                        title="Copy message"
                        onClick={() => {
                          navigator.clipboard.writeText(msg.content).then(() => {
                            setCopiedIdx(i);
                            setTimeout(() => setCopiedIdx(null), 1600);
                          });
                        }}
                        style={{
                          marginTop: 5, marginLeft: 2, display: "inline-flex", alignItems: "center",
                          gap: 4, padding: "2px 7px", borderRadius: 5, border: "none",
                          background: "transparent", cursor: "pointer",
                          color: copiedIdx === i ? "rgba(201,162,76,0.85)" : "rgba(120,113,108,0.5)",
                          fontSize: 10, fontFamily: "var(--app-font-mono)", letterSpacing: "0.05em",
                          transition: "color 150ms ease",
                        }}
                        onMouseEnter={e => { if (copiedIdx !== i) e.currentTarget.style.color = "rgba(201,162,76,0.6)"; }}
                        onMouseLeave={e => { if (copiedIdx !== i) e.currentTarget.style.color = "rgba(120,113,108,0.5)"; }}
                      >
                        {copiedIdx === i ? (
                          <>
                            <svg width="10" height="10" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round"><path d="M3 8l4 4 6-7"/></svg>
                            copied
                          </>
                        ) : (
                          <>
                            <svg width="10" height="10" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
                              <rect x="5" y="5" width="8" height="9" rx="1.5"/><path d="M11 5V3.5A1.5 1.5 0 009.5 2h-6A1.5 1.5 0 002 3.5v9A1.5 1.5 0 003.5 14H5"/>
                            </svg>
                            copy
                          </>
                        )}
                      </button>
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

      <style>{`
        @keyframes nexus-dots {
          0%, 100% { opacity: 0.55; }
          50% { opacity: 0.9; }
        }
        @keyframes nexus-letter-in {
          from { opacity: 0; transform: translateY(6px); }
          to   { opacity: 1; transform: translateY(0); }
        }
      `}</style>
    </div>
  );
}
