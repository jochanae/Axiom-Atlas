import { useState, useRef, useEffect, useCallback } from "react";
import { createPortal } from "react-dom";
import { useLocation } from "wouter";
import { LoadingSpinner } from "../components/ui/loading-spinner";
import {
  useListProjects,
  useCreateProject,
  getListProjectsQueryKey,
} from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import type { Project } from "@workspace/api-client-react";
import { ProjectsDrawer } from "../components/ProjectsDrawer";
import { UserMenuDropdown } from "../components/UserMenuDropdown";
import { AccountHubPanel } from "../components/AccountHubPanel";
import { BelowFoldDashboard } from "../components/BelowFoldDashboard";
import { TheForge } from "../components/TheForge";
import { InviteModal } from "../components/InviteModal";
import { extractApiErrorMessage } from "../lib/atlas-utils";
import { useAuth, useRequireAuth, isSuperAdmin } from "../hooks/useAuth";
import { useSubscription } from "../hooks/useSubscription";
import { usePullToRefresh } from "../hooks/usePullToRefresh";
import { toast } from "sonner";
import { UpgradeModal } from "../components/UpgradeModal";
import { CompactReadinessRing, computeScoreFromNodeState } from "../components/ReadinessRing";

const PLACEHOLDERS = [
  "What are we actually trying to solve here…",
  "What decision do you keep circling back to…",
  "Where did the last session leave things…",
  "What's the constraint you haven't named yet…",
  "What would have to be true for this to work…",
];

// ── Typewriter hook ──────────────────────────────────────────────────────────
function useTypewriter(phrases: string[]) {
  const [display, setDisplay] = useState("");
  const state = useRef({ phraseIdx: 0, charIdx: 0, phase: "typing" as "typing" | "erasing" });
  const phrasesRef = useRef(phrases);
  phrasesRef.current = phrases;

  useEffect(() => {
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
          // fully typed — hold 2 s then erase
          timer = setTimeout(() => {
            s.phase = "erasing";
            tick();
          }, 2000);
        }
      } else {
        // erasing
        if (s.charIdx > 0) {
          s.charIdx--;
          setDisplay(phrase.slice(0, s.charIdx));
          timer = setTimeout(tick, 22);
        } else {
          // fully erased — pause then type next
          s.phraseIdx = (s.phraseIdx + 1) % phrasesRef.current.length;
          s.phase = "typing";
          timer = setTimeout(tick, 200);
        }
      }
    }

    timer = setTimeout(tick, 900); // initial delay before first char
    return () => clearTimeout(timer);
  }, []);

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
        fontSize: 10,
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
          fontSize: 12,
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
          fontSize: 15,
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
        background: hov ? "rgba(201,162,76,0.04)" : "rgba(28,25,23,0.55)",
        border: `1px solid ${hov ? "rgba(201,162,76,0.28)" : "rgba(37,34,32,0.9)"}`,
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
            fontSize: 13,
            fontWeight: 500,
            color: hov ? "var(--atlas-fg)" : "rgba(231,229,228,0.78)",
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
              fontSize: 11,
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
              fontSize: 10,
              fontFamily: "var(--app-font-mono)",
              color: "rgba(74,222,128,0.65)",
              letterSpacing: "0.02em",
              whiteSpace: "nowrap",
              overflow: "hidden",
              textOverflow: "ellipsis",
              maxWidth: 140,
            }}>
              {(() => {
                try {
                  const r = JSON.parse(project.linkedRepo);
                  const full = typeof r === "string" ? r : (r.fullName ?? project.linkedRepo);
                  return full.includes("/") ? full.split("/")[1] : full;
                } catch {
                  return project.linkedRepo.includes("/") ? project.linkedRepo.split("/")[1] : project.linkedRepo;
                }
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
              fontSize: 10,
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
            fontSize: 9.5,
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

// ── HomeContextBar ────────────────────────────────────────────────────────────
type HomeRepo = { fullName: string; name: string; defaultBranch: string };

const MODELS = [
  { id: "claude",     label: "Claude",     sub: "Architect · Nuance & Strategy",  available: true },
  { id: "gpt4o",      label: "GPT-4o",     sub: "Mechanic · Speed & Logic",       available: true },
  { id: "gemini",     label: "Gemini",     sub: "Strategy · Long Context",        available: true },
  { id: "perplexity", label: "Perplexity", sub: "Librarian · Live Research",      available: false },
  { id: "deepseek",   label: "DeepSeek",   sub: "Analyst · Deep Reasoning",       available: false },
];

const MODES = [
  {
    id: "strategic",
    label: "Strategic",
    sub: "Wide-lens · Connect dots across the portfolio",
    description: "Default mode. Atlas sees all your projects simultaneously and thinks at the portfolio level.",
  },
  {
    id: "audit",
    label: "Audit",
    sub: "Critical · What's working vs. what's not",
    description: "Atlas gets direct and hard-nosed. Stress-tests assumptions, flags gaps, and won't soften the assessment.",
  },
  {
    id: "deep-dive",
    label: "Deep Dive",
    sub: "Focused · Go deep on one thing",
    description: "Atlas locks onto the topic you raise and explores it thoroughly — trade-offs, edge cases, implications.",
  },
];

function ContextChip({
  icon, label, onClick, dim,
}: { icon: React.ReactNode; label: string; onClick: () => void; dim?: boolean }) {
  const [hov, setHov] = useState(false);
  return (
    <button
      onClick={onClick}
      onMouseEnter={() => setHov(true)}
      onMouseLeave={() => setHov(false)}
      style={{
        display: "inline-flex", alignItems: "center", gap: 5,
        padding: "5px 9px", borderRadius: 20,
        background: hov ? "rgba(201,162,76,0.07)" : "rgba(28,25,23,0.6)",
        border: `1px solid ${hov ? "rgba(201,162,76,0.32)" : "rgba(37,34,32,0.9)"}`,
        cursor: "pointer", transition: "all 160ms ease",
        opacity: dim ? 0.45 : 1,
      }}
    >
      <span style={{ color: "rgba(120,113,108,0.7)", lineHeight: 0, flexShrink: 0 }}>{icon}</span>
      <span style={{
        fontFamily: "var(--app-font-mono)", fontSize: 10.5,
        color: hov ? "rgba(201,162,76,0.9)" : "rgba(231,229,228,0.65)",
        letterSpacing: "0.03em", whiteSpace: "nowrap",
        maxWidth: 120, overflow: "hidden", textOverflow: "ellipsis",
        transition: "color 160ms ease",
      }}>{label}</span>
      <svg width="8" height="8" viewBox="0 0 8 8" fill="none" style={{ opacity: 0.4, flexShrink: 0 }}>
        <path d="M1.5 3L4 5.5L6.5 3" stroke="var(--atlas-fg)" strokeWidth="1.2" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
    </button>
  );
}

function HomeContextBar({
  focusLabel, model, mode, onFocusClick, onModelClick, onModeClick,
}: {
  focusLabel: string; model: string; mode: string;
  onFocusClick: () => void; onModelClick: () => void; onModeClick: () => void;
}) {
  const modelLabel = MODELS.find(m => m.id === model)?.label ?? "Claude";
  const modeLabel = MODES.find(m => m.id === mode)?.label ?? "Strategic";
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 6, marginTop: 10, flexWrap: "wrap" }}>
      <ContextChip
        onClick={onFocusClick}
        icon={
          <svg width="11" height="11" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round">
            <circle cx="8" cy="8" r="6"/><circle cx="8" cy="8" r="2.5"/>
          </svg>
        }
        label={focusLabel}
      />
      <div style={{ width: 1, height: 14, background: "rgba(37,34,32,0.9)", flexShrink: 0 }} />
      <ContextChip
        onClick={onModeClick}
        icon={
          <svg width="11" height="11" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round">
            <path d="M2 4h12M4 8h8M6 12h4"/>
          </svg>
        }
        label={modeLabel}
      />
      <div style={{ width: 1, height: 14, background: "rgba(37,34,32,0.9)", flexShrink: 0 }} />
      <ContextChip
        onClick={onModelClick}
        icon={
          <svg width="11" height="11" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round">
            <circle cx="8" cy="8" r="6"/><path d="M5.5 8.5L7 10l3-4"/>
          </svg>
        }
        label={modelLabel}
      />
    </div>
  );
}

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

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    fetch("/api/github/repos", { headers: { "x-github-token": "__server__" }, credentials: "include" })
      .then(r => r.ok ? r.json() : [])
      .then((data: any[]) => {
        if (cancelled) return;
        setRepos(data.map((r: any) => ({ fullName: r.fullName, name: r.name, defaultBranch: r.defaultBranch ?? "main" })));
        setLoading(false);
      })
      .catch(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
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
        <div style={{ width: 36, height: 4, borderRadius: 2, background: "rgba(255,255,255,0.12)", margin: "12px auto 4px" }} />
        {/* Header */}
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "8px 16px 10px" }}>
          <span style={{ fontFamily: "var(--app-font-mono)", fontSize: 10, letterSpacing: "0.14em", textTransform: "uppercase", color: "var(--atlas-gold)" }}>
            Choose Repository
          </span>
          <button onClick={onClose} style={{ background: "none", border: "none", cursor: "pointer", color: "rgba(120,113,108,0.6)", fontSize: 20, lineHeight: 1, padding: 4 }}>×</button>
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
              style={{ flex: 1, background: "transparent", border: "none", outline: "none", color: "var(--atlas-fg)", fontSize: 13, fontFamily: "var(--app-font-sans)" }}
            />
          </div>
        </div>
        {/* List */}
        <div style={{ overflowY: "auto", flex: 1, padding: "0 14px 32px" }}>
          {loading && (
            <div style={{ padding: "24px 0", textAlign: "center", fontFamily: "var(--app-font-mono)", fontSize: 11, color: "var(--atlas-muted)", opacity: 0.5 }}>
              Loading...
            </div>
          )}
          {!loading && filtered.length === 0 && (
            <div style={{ padding: "24px 0", textAlign: "center", fontFamily: "var(--app-font-mono)", fontSize: 11, color: "var(--atlas-muted)", opacity: 0.5 }}>
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
                <div style={{ fontFamily: "var(--app-font-sans)", fontSize: 12, fontWeight: 500, color: "var(--atlas-fg)", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
                  {r.name}
                </div>
                <div style={{ fontFamily: "var(--app-font-mono)", fontSize: 10, color: "var(--atlas-muted)", opacity: 0.6, marginTop: 1 }}>
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

  useEffect(() => {
    if (!repo) return;
    setLoading(true);
    fetch(`/api/github/repos/${encodeURIComponent(repo.fullName)}/branches`, {
      headers: { "x-github-token": "__server__" }, credentials: "include",
    })
      .then(r => r.ok ? r.json() : null)
      .then((data: any) => {
        const list = Array.isArray(data)
          ? data.map((b: any) => b.name ?? b)
          : [repo.defaultBranch ?? "main"];
        setBranches(list.length ? list : [repo.defaultBranch ?? "main"]);
        setLoading(false);
      })
      .catch(() => {
        setBranches([repo?.defaultBranch ?? "main"]);
        setLoading(false);
      });
  }, [repo]);

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
        <div style={{ width: 36, height: 4, borderRadius: 2, background: "rgba(255,255,255,0.12)", margin: "12px auto 4px" }} />
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "8px 16px 10px" }}>
          <span style={{ fontFamily: "var(--app-font-mono)", fontSize: 10, letterSpacing: "0.14em", textTransform: "uppercase", color: "var(--atlas-gold)" }}>
            Choose Branch
          </span>
          <button onClick={onClose} style={{ background: "none", border: "none", cursor: "pointer", color: "rgba(120,113,108,0.6)", fontSize: 20, lineHeight: 1, padding: 4 }}>×</button>
        </div>
        {!repo && (
          <div style={{ padding: "20px 16px 32px", fontFamily: "var(--app-font-mono)", fontSize: 11, color: "var(--atlas-muted)", opacity: 0.5, textAlign: "center" }}>
            Link a repository first
          </div>
        )}
        {repo && (
          <div style={{ overflowY: "auto", flex: 1, padding: "0 14px 32px" }}>
            {loading ? (
              <div style={{ padding: "20px 0", textAlign: "center", fontFamily: "var(--app-font-mono)", fontSize: 11, color: "var(--atlas-muted)", opacity: 0.5 }}>Loading...</div>
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
                <span style={{ fontFamily: "var(--app-font-sans)", fontSize: 12, fontWeight: 500, color: "var(--atlas-fg)" }}>{b}</span>
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

// ── ModePickerSheet ──────────────────────────────────────────────────────────
function ModePickerSheet({ current, onSelect, onClose }: {
  current: string; onSelect: (m: string) => void; onClose: () => void;
}) {
  const modeIcons: Record<string, React.ReactNode> = {
    "strategic": (
      <svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round">
        <circle cx="8" cy="8" r="6"/><circle cx="8" cy="8" r="2.5"/>
      </svg>
    ),
    "audit": (
      <svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round">
        <path d="M8 2v4M8 10v4M2 8h4M10 8h4"/><circle cx="8" cy="8" r="2"/>
      </svg>
    ),
    "deep-dive": (
      <svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round">
        <path d="M2 4h12M4 8h8M6 12h4"/>
      </svg>
    ),
  };
  return (
    <div style={{ position: "fixed", inset: 0, zIndex: 300, display: "flex", alignItems: "flex-end", justifyContent: "center" }}>
      <div onClick={onClose} style={{ position: "absolute", inset: 0, background: "rgba(0,0,0,0.6)", backdropFilter: "blur(4px)" }} />
      <div style={{
        position: "relative", zIndex: 1, width: "100%", maxWidth: 480,
        background: "var(--atlas-surface)", borderRadius: "16px 16px 0 0",
        borderTop: "1px solid rgba(201,162,76,0.18)",
        boxShadow: "0 -8px 40px rgba(0,0,0,0.5)",
        paddingBottom: 32,
      }}>
        <div style={{ width: 36, height: 4, borderRadius: 2, background: "rgba(255,255,255,0.12)", margin: "12px auto 4px" }} />
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "8px 16px 10px" }}>
          <span style={{ fontFamily: "var(--app-font-mono)", fontSize: 10, letterSpacing: "0.14em", textTransform: "uppercase", color: "var(--atlas-gold)" }}>
            Mode
          </span>
          <button onClick={onClose} style={{ background: "none", border: "none", cursor: "pointer", color: "rgba(120,113,108,0.6)", fontSize: 20, lineHeight: 1, padding: 4 }}>×</button>
        </div>
        <div style={{ padding: "0 14px" }}>
          {MODES.map(m => (
            <button
              key={m.id}
              onClick={() => { onSelect(m.id); onClose(); }}
              style={{
                width: "100%", textAlign: "left", padding: "12px 12px", borderRadius: 8,
                background: current === m.id ? "rgba(201,162,76,0.06)" : "transparent",
                border: `1px solid ${current === m.id ? "rgba(201,162,76,0.22)" : "transparent"}`,
                cursor: "pointer",
                display: "flex", alignItems: "flex-start", gap: 12, marginBottom: 2,
                transition: "all 140ms ease",
              }}
            >
              <div style={{
                width: 32, height: 32, borderRadius: 8, flexShrink: 0, marginTop: 1,
                background: "rgba(201,162,76,0.08)",
                border: "1px solid rgba(201,162,76,0.2)",
                display: "flex", alignItems: "center", justifyContent: "center",
                color: "rgba(201,162,76,0.75)",
              }}>
                {modeIcons[m.id]}
              </div>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontFamily: "var(--app-font-sans)", fontSize: 13, fontWeight: 500, color: "var(--atlas-fg)", marginBottom: 2 }}>
                  {m.label}
                </div>
                <div style={{ fontFamily: "var(--app-font-mono)", fontSize: 9, color: "var(--atlas-muted)", letterSpacing: "0.05em", opacity: 0.7 }}>{m.sub}</div>
                <div style={{ fontFamily: "var(--app-font-sans)", fontSize: 11, color: "var(--atlas-muted)", marginTop: 4, lineHeight: 1.5, opacity: 0.6 }}>{m.description}</div>
              </div>
              {current === m.id && (
                <svg width="12" height="12" viewBox="0 0 12 12" fill="none" style={{ marginTop: 4, flexShrink: 0 }}>
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

// ── ModelPickerSheet ──────────────────────────────────────────────────────────
function ModelPickerSheet({ current, onSelect, onClose }: {
  current: string; onSelect: (m: string) => void; onClose: () => void;
}) {
  return (
    <div style={{ position: "fixed", inset: 0, zIndex: 300, display: "flex", alignItems: "flex-end", justifyContent: "center" }}>
      <div onClick={onClose} style={{ position: "absolute", inset: 0, background: "rgba(0,0,0,0.6)", backdropFilter: "blur(4px)" }} />
      <div style={{
        position: "relative", zIndex: 1, width: "100%", maxWidth: 480,
        background: "var(--atlas-surface)", borderRadius: "16px 16px 0 0",
        borderTop: "1px solid rgba(201,162,76,0.18)",
        boxShadow: "0 -8px 40px rgba(0,0,0,0.5)",
        paddingBottom: 32,
      }}>
        <div style={{ width: 36, height: 4, borderRadius: 2, background: "rgba(255,255,255,0.12)", margin: "12px auto 4px" }} />
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "8px 16px 10px" }}>
          <span style={{ fontFamily: "var(--app-font-mono)", fontSize: 10, letterSpacing: "0.14em", textTransform: "uppercase", color: "var(--atlas-gold)" }}>
            Model
          </span>
          <button onClick={onClose} style={{ background: "none", border: "none", cursor: "pointer", color: "rgba(120,113,108,0.6)", fontSize: 20, lineHeight: 1, padding: 4 }}>×</button>
        </div>
        <div style={{ padding: "0 14px" }}>
          {MODELS.map(m => (
            <button
              key={m.id}
              disabled={!m.available}
              onClick={() => { if (m.available) { onSelect(m.id); onClose(); } }}
              style={{
                width: "100%", textAlign: "left", padding: "11px 12px", borderRadius: 8,
                background: current === m.id ? "rgba(201,162,76,0.06)" : "transparent",
                border: `1px solid ${current === m.id ? "rgba(201,162,76,0.22)" : "transparent"}`,
                cursor: m.available ? "pointer" : "default",
                display: "flex", alignItems: "center", gap: 10, marginBottom: 2,
                opacity: m.available ? 1 : 0.32,
                transition: "all 140ms ease",
              }}
            >
              <div style={{
                width: 28, height: 28, borderRadius: 8, flexShrink: 0,
                background: m.available ? "rgba(201,162,76,0.1)" : "rgba(37,34,32,0.8)",
                border: `1px solid ${m.available ? "rgba(201,162,76,0.25)" : "rgba(37,34,32,0.9)"}`,
                display: "flex", alignItems: "center", justifyContent: "center",
                fontFamily: "var(--app-font-mono)", fontSize: 9, fontWeight: 700,
                color: m.available ? "rgba(201,162,76,0.85)" : "rgba(120,113,108,0.4)",
              }}>
                {m.id === "claude" ? "C" : m.id === "gpt4o" ? "G" : m.id === "gemini" ? "Ge" : m.id === "perplexity" ? "P" : "D"}
              </div>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontFamily: "var(--app-font-sans)", fontSize: 13, fontWeight: 500, color: "var(--atlas-fg)", display: "flex", alignItems: "center", gap: 6 }}>
                  {m.label}
                  {!m.available && (
                    <span style={{ fontFamily: "var(--app-font-mono)", fontSize: 8, color: "var(--atlas-muted)", letterSpacing: "0.1em", opacity: 0.55, border: "1px solid rgba(120,113,108,0.2)", borderRadius: 3, padding: "1px 4px" }}>KEY NEEDED</span>
                  )}
                </div>
                <div style={{ fontFamily: "var(--app-font-mono)", fontSize: 9, color: "var(--atlas-muted)", letterSpacing: "0.05em", marginTop: 2, opacity: m.available ? 0.7 : 0.4 }}>{m.sub}</div>
              </div>
              {current === m.id && (
                <svg width="12" height="12" viewBox="0 0 12 12" fill="none">
                  <path d="M2 6l3 3 5-5" stroke="var(--atlas-gold)" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" />
                </svg>
              )}
            </button>
          ))}
          <div style={{ margin: "12px 0 4px", padding: "8px 12px", background: "rgba(201,162,76,0.04)", borderRadius: 6, border: "1px solid rgba(201,162,76,0.1)" }}>
            <p style={{ fontFamily: "var(--app-font-mono)", fontSize: 9, color: "var(--atlas-muted)", letterSpacing: "0.07em", margin: 0, lineHeight: 1.6 }}>
              In workspace: type <span style={{ color: "rgba(201,162,76,0.7)" }}>/deep [topic]</span> for a structured Gemini research card.
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}

function FocusPickerSheet({ current, projects, onSelect, onClose }: {
  current: number | null;
  projects: Array<{ id: number; name: string }>;
  onSelect: (id: number | null) => void;
  onClose: () => void;
}) {
  return (
    <div style={{ position: "fixed", inset: 0, zIndex: 300, display: "flex", alignItems: "flex-end", justifyContent: "center" }}>
      <div onClick={onClose} style={{ position: "absolute", inset: 0, background: "rgba(0,0,0,0.6)", backdropFilter: "blur(4px)" }} />
      <div style={{
        position: "relative", zIndex: 1, width: "100%", maxWidth: 480,
        background: "var(--atlas-surface)", borderRadius: "16px 16px 0 0",
        borderTop: "1px solid rgba(201,162,76,0.18)",
        boxShadow: "0 -8px 40px rgba(0,0,0,0.5)", paddingBottom: 32,
      }}>
        <div style={{ width: 36, height: 4, borderRadius: 2, background: "rgba(255,255,255,0.12)", margin: "12px auto 4px" }} />
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "8px 16px 10px" }}>
          <span style={{ fontFamily: "var(--app-font-mono)", fontSize: 10, letterSpacing: "0.14em", textTransform: "uppercase", color: "var(--atlas-gold)" }}>Focus</span>
          <button onClick={onClose} style={{ background: "none", border: "none", cursor: "pointer", color: "rgba(120,113,108,0.6)", fontSize: 20, lineHeight: 1, padding: 4 }}>×</button>
        </div>
        <div style={{ paddingTop: 4 }}>
          <div style={{ padding: "0 14px 16px", overflowY: "auto", maxHeight: "60dvh" }}>
            {[{ id: null, name: "All Projects", sub: "Global view across everything" }, ...projects.map(p => ({ id: p.id as number | null, name: p.name, sub: "Zoom in on this project" }))].map(item => (
              <button
                key={item.id ?? "all"}
                onClick={() => { onSelect(item.id); onClose(); }}
                style={{
                  width: "100%", textAlign: "left", padding: "11px 12px", borderRadius: 8,
                  background: current === item.id ? "rgba(201,162,76,0.06)" : "transparent",
                  border: `1px solid ${current === item.id ? "rgba(201,162,76,0.22)" : "transparent"}`,
                  cursor: "pointer", display: "flex", alignItems: "center", gap: 10, marginBottom: 2,
                  transition: "all 140ms ease",
                }}
              >
                <div style={{ width: 8, height: 8, borderRadius: "50%", background: item.id === null ? "rgba(201,162,76,0.5)" : "rgba(120,113,108,0.4)", flexShrink: 0 }} />
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontFamily: "var(--app-font-sans)", fontSize: 13, fontWeight: 500, color: "var(--atlas-fg)" }}>{item.name}</div>
                  <div style={{ fontFamily: "var(--app-font-mono)", fontSize: 9, color: "var(--atlas-muted)", opacity: 0.7, marginTop: 1 }}>{item.sub}</div>
                </div>
                {current === item.id && (
                  <svg width="12" height="12" viewBox="0 0 12 12" fill="none">
                    <path d="M2 6l3 3 5-5" stroke="var(--atlas-gold)" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round"/>
                  </svg>
                )}
              </button>
            ))}
          </div>
        </div>
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
}: {
  loading: boolean;
  onSpecMode: () => void;
  onWorkspace: () => void;
  onDismiss?: () => void;
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
          <div style={{ fontSize: 10, fontFamily: "var(--app-font-mono)", letterSpacing: "0.22em", color: "rgba(201,162,76,0.7)", textTransform: "uppercase", marginBottom: 12 }}>
            AXIOM
          </div>
          <div style={{ fontSize: 13, color: "rgba(120,113,108,0.6)", fontFamily: "var(--app-font-mono)", letterSpacing: "0.06em", lineHeight: 1.5 }}>
            Structure before speed.
          </div>
        </div>

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
            <div style={{ fontSize: 14, fontWeight: 700, fontFamily: "var(--app-font-mono)", letterSpacing: "0.04em" }}>
              Start a project →
            </div>
            <div style={{ fontSize: 10, fontWeight: 400, opacity: 0.6, marginTop: 3, fontFamily: "var(--app-font-mono)" }}>
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
            <div style={{ fontSize: 14, fontWeight: 700, fontFamily: "var(--app-font-mono)", letterSpacing: "0.04em" }}>
              Map my architecture
            </div>
            <div style={{ fontSize: 10, fontWeight: 400, opacity: 0.55, marginTop: 3, fontFamily: "var(--app-font-mono)" }}>
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
              color: "rgba(120,113,108,0.45)", fontSize: 11,
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
  const [createError, setCreateError] = useState<string | null>(null);
  const [attachedFile, setAttachedFile] = useState<File | null>(null);
  const [showDeepDiveMenu, setShowDeepDiveMenu] = useState(false);
  const [deepDiveCopied, setDeepDiveCopied] = useState(false);
  const [showQuickPrompt, setShowQuickPrompt] = useState(false);
  const { user: authUser } = useAuth();
  useRequireAuth();
  const [showProfile, setShowProfile] = useState(false);
  const [showInvite, setShowInvite] = useState(false);
  const [showDrawer, setShowDrawer] = useState(false);
  const [showProjectsSheet, setShowProjectsSheet] = useState(false);
  const [showUpgrade, setShowUpgrade] = useState(false);
  const [isListening, setIsListening] = useState(false);
  const [homeMessages, setHomeMessages] = useState<Array<{role: 'user' | 'assistant'; content: string}>>([]);
  const [isAtlasStreaming, setIsAtlasStreaming] = useState(false);
  const [copiedMsgIdx, setCopiedMsgIdx] = useState<number | null>(null);
  const [showClearConfirm, setShowClearConfirm] = useState(false);
  const [threadLoading, setThreadLoading] = useState(true);
  const [briefing, setBriefing] = useState<string | null>(null);
  const [briefingLoading, setBriefingLoading] = useState(true);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const { isFree } = useSubscription();

  // ── Home context: repo / branch / model ────────────────────────────────────
  const [homeFocus, setHomeFocus] = useState<number | null>(() => {
    try { const r = localStorage.getItem("atlas-home-context"); return r ? (JSON.parse(r).focusId ?? null) : null; } catch { return null; }
  });
  const [showFocusSheet, setShowFocusSheet] = useState(false);
  const [homeModel, setHomeModel] = useState<string>(() => {
    try { const r = localStorage.getItem("atlas-home-context"); return r ? (JSON.parse(r).model ?? "claude") : "claude"; } catch { return "claude"; }
  });
  const [showModelSheet, setShowModelSheet] = useState(false);
  const [homeMode, setHomeMode] = useState<string>(() => {
    try { const r = localStorage.getItem("atlas-home-context"); return r ? (JSON.parse(r).mode ?? "strategic") : "strategic"; } catch { return "strategic"; }
  });
  const [showModeSheet, setShowModeSheet] = useState(false);

  // Persist context to localStorage whenever it changes
  useEffect(() => {
    try { localStorage.setItem("atlas-home-context", JSON.stringify({ focusId: homeFocus, model: homeModel, mode: homeMode })); } catch {}
  }, [homeFocus, homeModel, homeMode]);
  const [, setLocation] = useLocation();
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const recognitionRef = useRef<any>(null);
  const queryClient = useQueryClient();

  const toggleVoice = useCallback(() => {
    if (isListening) {
      recognitionRef.current?.stop();
      setIsListening(false);
      return;
    }
    const SR = (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;
    if (!SR) return;
    const rec = new SR();
    rec.continuous = false;
    rec.interimResults = true;
    rec.onresult = (e: any) => {
      const t = Array.from(e.results as SpeechRecognitionResultList)
        .map((r) => (r as SpeechRecognitionResult)[0].transcript)
        .join("");
      setInput(t);
    };
    rec.onend = () => setIsListening(false);
    rec.onerror = () => setIsListening(false);
    rec.start();
    recognitionRef.current = rec;
    setIsListening(true);
  }, [isListening]);

  const placeholder = useTypewriter(PLACEHOLDERS);

  const { data: projects, isLoading } = useListProjects();
  const createProject = useCreateProject();

  useEffect(() => {
    setBriefingLoading(true);
    fetch("/api/nexus/briefing", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      credentials: "include",
      body: JSON.stringify({}),
    })
      .then(r => r.ok ? r.json() : { briefing: null })
      .then((data: any) => {
        setBriefing(data.briefing ?? null);
        setBriefingLoading(false);
      })
      .catch(() => setBriefingLoading(false));
  }, []);

  useEffect(() => {
    if (homeMessages.length === 0) return;
    const container = messagesEndRef.current?.parentElement;
    if (container) {
      container.scrollTop = container.scrollHeight;
    }
  }, [homeMessages]);

  // Load Living Thread from DB on mount
  useEffect(() => {
    fetch("/api/nexus/thread", { credentials: "include" })
      .then(r => r.ok ? r.json() : [])
      .then((msgs: Array<{ role: string; content: string }>) => {
        if (msgs.length > 0) {
          setHomeMessages(msgs.map(m => ({ role: m.role as 'user' | 'assistant', content: m.content })));
        }
      })
      .catch(() => {})
      .finally(() => setThreadLoading(false));
  }, []);

  // Pull-to-refresh
  const { pulling, distance, refreshing, threshold } = usePullToRefresh(
    useCallback(async () => {
      await queryClient.invalidateQueries({ queryKey: getListProjectsQueryKey() });
    }, [queryClient]),
  );


  const handleNewProject = useCallback((name = "New Project") => {
    if (isFree && (projects?.length ?? 0) >= 1) {
      setShowUpgrade(true);
      return;
    }
    createProject.mutate(
      { data: { name } },
      {
        onSuccess: (p) => {
          queryClient.invalidateQueries({ queryKey: getListProjectsQueryKey() });
          setLocation(`/project/${p.id}`);
        },
        onError: (err: any) => {
          const msg = extractApiErrorMessage(err);
          if (msg?.includes("PROJECT_LIMIT_REACHED") || err?.status === 402) {
            setShowUpgrade(true);
          } else {
            setCreateError(msg ?? "Failed to create project");
          }
        },
      }
    );
  }, [isFree, projects, createProject, queryClient, setLocation]);

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

  const navigateToProject = useCallback(
    (projectId: number) => {
      if (input.trim()) {
        sessionStorage.setItem(`atlas-initial-${projectId}`, input.trim());
      }
      setLocation(`/project/${projectId}`);
    },
    [input, setLocation]
  );

  const handleSubmit = useCallback(async () => {
    const text = input.trim();
    if (!text || isLoading) return;
    setInput("");
    setHomeMessages(prev => [...prev, { role: 'user', content: text }]);
    setIsAtlasStreaming(true);
    try {
      const res = await fetch("/api/nexus/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ message: text, model: homeModel, focusProjectId: homeFocus, mode: homeMode }),
      });
      if (!res.ok) throw new Error("No response");
      const data = await res.json() as { reply?: string; message?: string };
      const replyText = (data as any).response ?? (data as any).reply ?? (data as any).message ?? "";
      setHomeMessages(prev => [...prev, { role: 'assistant', content: replyText }]);
    } catch {
      const target = projects?.at(-1);
      if (target) {
        try { sessionStorage.setItem(`atlas-initial-${target.id}`, text); } catch {}
        setLocation(`/project/${target.id}`);
      } else {
        handleNewProject();
      }
    } finally {
      setIsAtlasStreaming(false);
    }
  }, [input, isLoading, homeModel, homeFocus, projects, setLocation, handleNewProject]);


  const handleClearThread = useCallback(async () => {
    await fetch("/api/nexus/thread", { method: "DELETE", credentials: "include" }).catch(() => {});
    setHomeMessages([]);
    setShowClearConfirm(false);
    toast("Conversation cleared");
  }, []);

  const handleDownloadThread = useCallback(() => {
    if (homeMessages.length === 0) return;
    const lines = homeMessages
      .map(m => `## ${m.role === 'user' ? 'You' : 'Atlas'}\n${m.content}`)
      .join("\n\n---\n\n");
    const blob = new Blob([`# Atlas Conversation\n${new Date().toLocaleDateString()}\n\n---\n\n${lines}`], { type: "text/markdown" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `atlas-${new Date().toISOString().slice(0, 10)}.md`;
    a.click();
    URL.revokeObjectURL(url);
  }, [homeMessages]);

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      if (input.trim()) handleSubmit();
    }
  };

  const autoResize = () => {
    const el = textareaRef.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = Math.min(el.scrollHeight, 160) + "px";
  };

  const hasInput = input.trim().length > 0;

  return (
    <div
      className="atlas-home-bg"
      style={{
        height: "100vh",
        backgroundColor: "var(--atlas-bg)",
        display: "flex",
        flexDirection: "column",
        overflowY: "auto",
        overflowX: "hidden",
      }}
    >
      {/* Pull-to-refresh indicator */}
      <div style={{
        position: "fixed", top: 0, left: 0, right: 0, zIndex: 9000,
        display: "flex", alignItems: "center", justifyContent: "center",
        height: 48, pointerEvents: "none",
        transform: `translateY(${Math.min(distance - 48, 0)}px)`,
        transition: pulling ? "none" : "transform 320ms ease, opacity 320ms ease",
        opacity: refreshing ? 1 : Math.min(distance / threshold, 1),
      }}>
        <div style={{
          display: "flex", alignItems: "center", gap: 8,
          background: "rgba(28,25,23,0.92)", border: "1px solid rgba(201,162,76,0.25)",
          borderRadius: 20, padding: "5px 12px",
          backdropFilter: "blur(12px)", boxShadow: "0 4px 16px rgba(0,0,0,0.4)",
        }}>
          <div style={{
            width: 14, height: 14, borderRadius: "50%",
            border: "1.5px solid rgba(201,162,76,0.2)",
            borderTopColor: "rgba(201,162,76,0.8)",
            animation: refreshing ? "spin 0.8s linear infinite" : "none",
            transform: refreshing ? undefined : `rotate(${(distance / threshold) * 270}deg)`,
          }} />
          <span style={{ fontSize: 10, fontFamily: "var(--app-font-mono)", color: "rgba(201,162,76,0.7)", letterSpacing: "0.1em" }}>
            {refreshing ? "Refreshing…" : distance >= threshold ? "Release" : "Pull to refresh"}
          </span>
        </div>
      </div>

      {/* Header */}
      <div
        className="atlas-home-header"
        style={{
          position: "sticky",
          top: 0,
          height: 50,
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          padding: "0 24px",
          borderBottom: "1px solid var(--atlas-glass-border)",
          boxShadow: "var(--atlas-home-header-shadow)",
          zIndex: 10,
          flexShrink: 0,
        }}
      >
        {/* Left side: menu icon + logo */}
        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
          <button
            title="Menu"
            onClick={() => setShowDrawer(true)}
            style={{
              width: 28, height: 28, borderRadius: 7,
              background: "transparent", border: "none",
              color: "rgba(201,162,76,0.55)", cursor: "pointer",
              display: "flex", alignItems: "center", justifyContent: "center",
              transition: "color 160ms ease", flexShrink: 0,
            }}
            onMouseEnter={(e) => (e.currentTarget.style.color = "var(--atlas-gold)")}
            onMouseLeave={(e) => (e.currentTarget.style.color = "rgba(201,162,76,0.55)")}
          >
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#D4AF37" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M22 19a2 2 0 01-2 2H4a2 2 0 01-2-2V5a2 2 0 012-2h5l2 3h9a2 2 0 012 2z" />
            </svg>
          </button>
          <AtlasLogo />
        </div>

        {/* Center: timestamp absolutely centered */}
        <div style={{ position: "absolute", left: "50%", transform: "translateX(-50%)", pointerEvents: "none" }}>
          <InlineTimestamp />
        </div>

        {/* Right side: avatar pair */}
        <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
          <div style={{ display: "none" }} />
          {/* Avatar + invite/new-project as overlapping pair (avatar in front) */}
          <div style={{ position: "relative", display: "flex", alignItems: "center" }}>
            <UserMenuDropdown onOpenProfile={() => setShowProfile(true)} />
            <button
              title={isSuperAdmin(authUser) ? "Invite someone" : "New project"}
              disabled={isLoading}
              onClick={() => {
                if (isSuperAdmin(authUser)) {
                  setShowInvite(true);
                } else {
                  handleNewProject("New Project");
                }
              }}
              style={{
                width: 26, height: 26, borderRadius: "22%",
                border: "1px dashed rgba(212,175,55,0.45)",
                background: "transparent",
                display: "flex", alignItems: "center", justifyContent: "center",
                cursor: isLoading ? "not-allowed" : "pointer",
                color: "rgba(212,175,55,0.55)",
                fontSize: 14, lineHeight: 1, fontWeight: 300,
                flexShrink: 0, marginLeft: -4, position: "relative", zIndex: 1,
                opacity: isLoading ? 0.4 : 1,
                transition: "all 160ms ease",
              }}
              onMouseEnter={(e) => { if (!isLoading) { e.currentTarget.style.borderColor = "rgba(212,175,55,0.75)"; e.currentTarget.style.color = "#D4AF37"; } }}
              onMouseLeave={(e) => { e.currentTarget.style.borderColor = "rgba(212,175,55,0.45)"; e.currentTarget.style.color = "rgba(212,175,55,0.55)"; }}
            >
              +
            </button>
          </div>
        </div>
      </div>

      {/* First-run overlay — new users with no projects, once per session */}
      {showOverlay && (
        <FirstRunOverlay
          loading={isLoading}
          onSpecMode={() => {
            createProject.mutate({ data: { name: "My Project" } }, {
              onSuccess: (p) => {
                dismissOverlay();
                queryClient.invalidateQueries({ queryKey: getListProjectsQueryKey() });
                sessionStorage.setItem("atlas-open-tab", "map");
                setLocation(`/project/${p.id}`);
              },
            });
          }}
          onWorkspace={() => {
            createProject.mutate({ data: { name: "My Project" } }, {
              onSuccess: (p) => {
                dismissOverlay();
                queryClient.invalidateQueries({ queryKey: getListProjectsQueryKey() });
                setLocation(`/project/${p.id}`);
              },
            });
          }}
          onDismiss={dismissOverlay}
        />
      )}

      {/* Main content */}
      <div
        style={{
          flex: 1,
          display: "flex",
          justifyContent: "center",
          padding: "0 24px",
        }}
      >
        <div style={{ width: "100%", maxWidth: 560 }}>
          {/* Hero — fills the viewport above the mobile nav, content vertically centered */}
          <div style={{ minHeight: "calc(100svh - 50px - env(safe-area-inset-bottom, 0px))", display: "flex", flexDirection: "column", justifyContent: "center", position: "relative", paddingBottom: 120 }}>

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

          {/* Greeting */}
          <div style={{ textAlign: "center", marginBottom: 24, marginTop: 32, position: "relative", zIndex: 1, minHeight: 80 }}>
            {homeMessages.length > 0 ? null : briefingLoading ? (
              <>
                <h1 style={{ fontSize: 30, fontWeight: 300, color: "var(--atlas-fg)", letterSpacing: "-0.025em", lineHeight: 1.2, opacity: 0.85, margin: "0 0 10px" }}>
                  Where were we.
                </h1>
                <p style={{ fontSize: 13, color: "var(--atlas-muted)", opacity: 0.55, margin: 0, fontStyle: "italic" }}>
                  I'm here. What's on your mind?
                </p>
              </>
            ) : briefing ? (
              <div style={{
                animation: "briefingReveal 800ms cubic-bezier(0.4,0,0.2,1) forwards",
                opacity: 0,
              }}>
                {(() => {
                  const sentences = briefing.split(/(?<=[.!?])\s+/);
                  const status = sentences[0] ?? "";
                  const nextMove = sentences.slice(1).join(" ");
                  return (
                    <>
                      <p style={{
                        fontSize: 17,
                        fontWeight: 300,
                        color: "var(--atlas-fg)",
                        opacity: 0.9,
                        margin: "0 0 16px",
                        lineHeight: 1.6,
                        fontFamily: "var(--app-font-sans)",
                        letterSpacing: "-0.01em",
                      }}>
                        {status}
                      </p>
                      {nextMove && (
                        <p style={{
                          fontSize: 13,
                          color: "var(--atlas-gold)",
                          filter: "opacity(0.65)",
                          margin: 0,
                          fontStyle: "italic",
                          fontFamily: "var(--app-font-sans)",
                          lineHeight: 1.5,
                          animation: "briefingReveal 800ms cubic-bezier(0.4,0,0.2,1) 400ms forwards",
                          opacity: 0,
                        }}>
                          {nextMove}
                        </p>
                      )}
                    </>
                  );
                })()}
              </div>
            ) : (
              <>
                <h1 style={{ fontSize: 30, fontWeight: 300, color: "var(--atlas-fg)", letterSpacing: "-0.025em", lineHeight: 1.2, opacity: 0.85, margin: "0 0 10px" }}>
                  Where were we.
                </h1>
                <p style={{ fontSize: 13, color: "var(--atlas-muted)", opacity: 0.55, margin: 0, fontStyle: "italic" }}>
                  I'm here. What's on your mind?
                </p>
              </>
            )}
          </div>

          {/* Chat thread */}
          <div style={{ margin: "18px 0 26px", minHeight: 60 }}>
            {homeMessages.length === 0 && !isAtlasStreaming && !threadLoading ? null : homeMessages.length === 0 && !isAtlasStreaming ? (
              <div style={{ display: "flex", justifyContent: "center" }}>
                <LoadingSpinner size="sm" color="atlas" />
              </div>
            ) : (
              <>
                {/* Chat action bar */}
                <div style={{ display: "flex", alignItems: "center", justifyContent: "flex-end", gap: 2, borderBottom: "1px solid var(--atlas-border)", background: "rgba(0,0,0,0.15)", paddingRight: 6, height: 26, flexShrink: 0, marginBottom: 6 }}>
                  {showClearConfirm ? (
                    <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                      <span style={{ fontSize: 10, fontFamily: "var(--app-font-mono)", color: "rgba(239,68,68,0.65)", letterSpacing: "0.04em" }}>Clear conversation?</span>
                      <button
                        onClick={handleClearThread}
                        style={{ background: "rgba(239,68,68,0.1)", border: "1px solid rgba(239,68,68,0.3)", borderRadius: 4, padding: "3px 9px", fontSize: 10, color: "rgba(252,165,165,0.9)", cursor: "pointer", fontFamily: "var(--app-font-mono)", letterSpacing: "0.06em" }}
                      >
                        Clear
                      </button>
                      <button
                        onClick={() => setShowClearConfirm(false)}
                        style={{ background: "transparent", border: "none", padding: "3px 6px", fontSize: 11, color: "var(--atlas-muted)", cursor: "pointer" }}
                      >
                        Cancel
                      </button>
                    </div>
                  ) : (
                    <>
                      <button
                        title="Download conversation"
                        onClick={handleDownloadThread}
                        style={{ background: "transparent", border: "none", padding: "3px 5px", cursor: "pointer", opacity: 0.35, color: "var(--atlas-muted)", lineHeight: 1, transition: "opacity 140ms" }}
                        onMouseEnter={e => (e.currentTarget.style.opacity = "0.75")}
                        onMouseLeave={e => (e.currentTarget.style.opacity = "0.35")}
                      >
                        <svg width="13" height="13" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round">
                          <path d="M8 2v9M5 8l3 3 3-3"/><path d="M2 14h12"/>
                        </svg>
                      </button>
                      <button
                        title="Clear conversation"
                        onClick={() => setShowClearConfirm(true)}
                        style={{ background: "transparent", border: "none", padding: "3px 5px", cursor: "pointer", opacity: 0.35, color: "var(--atlas-muted)", lineHeight: 1, transition: "opacity 140ms" }}
                        onMouseEnter={e => (e.currentTarget.style.opacity = "0.75")}
                        onMouseLeave={e => (e.currentTarget.style.opacity = "0.35")}
                      >
                        <svg width="13" height="13" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round">
                          <path d="M3 4h10M6 4V2h4v2M13 4l-.867 9.143A2 2 0 0110.138 15H5.862a2 2 0 01-1.995-1.857L3 4"/>
                        </svg>
                      </button>
                    </>
                  )}
                </div>

                {/* Messages */}
                <div style={{ display: "flex", flexDirection: "column", gap: 10, maxHeight: "min(50vh, 300px)", overflowY: "auto", paddingRight: 4 }}>
                  {homeMessages.map((msg, i) => (
                    <div key={i} style={{ display: "flex", flexDirection: msg.role === 'user' ? "row-reverse" : "row", alignItems: "flex-end", gap: 5, animation: "fadeIn 250ms ease forwards" }}>
                      <div style={{
                        maxWidth: "82%", padding: "9px 13px", borderRadius: msg.role === 'user' ? "12px 12px 4px 12px" : "12px 12px 12px 4px",
                        background: msg.role === 'user' ? "rgba(201,162,76,0.12)" : "rgba(28,25,23,0.8)",
                        border: `0.5px solid ${msg.role === 'user' ? "rgba(201,162,76,0.3)" : "rgba(37,34,32,0.9)"}`,
                        fontSize: 13, lineHeight: 1.55, color: "var(--atlas-fg)",
                        fontFamily: "var(--app-font-sans)",
                      }}>
                        {msg.role === 'assistant' && msg.content === "" && isAtlasStreaming ? (
                          <span style={{ opacity: 0.4, fontStyle: "italic", fontSize: 11 }}>Atlas is thinking…</span>
                        ) : msg.role === 'assistant' ? (
                          <span dangerouslySetInnerHTML={{ __html: msg.content.replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>').replace(/\*(.*?)\*/g, '<em>$1</em>') }} />
                        ) : msg.content}
                      </div>
                      {/* Copy button — Atlas bubbles only */}
                      {msg.role === 'assistant' && msg.content && (
                        <button
                          title={copiedMsgIdx === i ? "Copied!" : "Copy"}
                          onClick={() => {
                            navigator.clipboard.writeText(msg.content).catch(() => {});
                            setCopiedMsgIdx(i);
                            setTimeout(() => setCopiedMsgIdx(prev => prev === i ? null : prev), 1800);
                          }}
                          style={{
                            background: "transparent", border: "none", padding: "3px", cursor: "pointer",
                            opacity: copiedMsgIdx === i ? 0.9 : 0.28,
                            color: copiedMsgIdx === i ? "var(--atlas-gold)" : "var(--atlas-muted)",
                            lineHeight: 1, flexShrink: 0, transition: "opacity 140ms, color 140ms",
                            marginBottom: 3,
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
                    </div>
                  ))}
                  <div ref={messagesEndRef} />
                </div>
              </>
            )}
          </div>

          {/* Input shell */}
          <div className="atlas-input-shell" style={{ padding: "18px 20px 14px" }}>
            {/* Hidden file input */}
            <input
              ref={fileInputRef}
              type="file"
              accept="image/jpeg,image/png,image/gif,image/webp,application/pdf,.txt,.md,.csv,.json"
              style={{ display: "none" }}
              onChange={(e) => {
                const file = e.target.files?.[0] ?? null;
                setAttachedFile(file);
                e.target.value = "";
              }}
            />

            {/* Attached file pill */}
            {attachedFile && (
              <div style={{
                display: "flex", alignItems: "center", gap: 6, marginBottom: 8,
                padding: "4px 10px", borderRadius: 6, width: "fit-content",
                background: "rgba(201,162,76,0.07)", border: "1px solid rgba(201,162,76,0.2)",
              }}>
                <svg width="11" height="11" viewBox="0 0 16 16" fill="none">
                  <path d="M13 7.5l-5.5 5.5a4 4 0 01-5.66-5.66l6-6a2.5 2.5 0 013.54 3.54l-6 6a1 1 0 01-1.42-1.42l5.5-5.5" stroke="rgba(201,162,76,0.8)" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round" />
                </svg>
                <span style={{ fontSize: 10, fontFamily: "var(--app-font-mono)", color: "rgba(201,162,76,0.7)", letterSpacing: "0.05em", maxWidth: 200, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                  {attachedFile.name}
                </span>
                <button onClick={() => setAttachedFile(null)} style={{ background: "transparent", border: "none", cursor: "pointer", color: "rgba(120,113,108,0.6)", fontSize: 13, lineHeight: 1, padding: "0 0 0 2px" }}>×</button>
              </div>
            )}

            <div style={{ position: "relative" }}>
              {!hasInput && (
                <div
                  aria-hidden
                  style={{
                    position: "absolute",
                    top: 0,
                    left: 0,
                    right: 44,
                    zIndex: 2,
                    color: "var(--atlas-muted)",
                    fontSize: 15,
                    lineHeight: 1.55,
                    opacity: 0.65,
                    pointerEvents: "none",
                    whiteSpace: "nowrap",
                    overflow: "hidden",
                    textOverflow: "ellipsis",
                    fontFamily: "var(--app-font-sans)",
                  }}
                >
                  {placeholder}
                  <span className="atlas-cursor" />
                </div>
              )}
              <textarea
                ref={textareaRef}
                value={input}
                onChange={(e) => { setInput(e.target.value); autoResize(); if (createError) setCreateError(null); }}
                onKeyDown={handleKeyDown}
                rows={2}
                style={{
                  width: "100%",
                  background: "transparent",
                  border: "none",
                  outline: "none",
                  color: "var(--atlas-fg)",
                  fontSize: 15,
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

            {/* Bottom action bar */}
            <div style={{ display: "flex", alignItems: "center", marginTop: 12, gap: 2 }}>
              {/* + button — opens file picker */}
              <button
                title="Add file"
                onClick={() => fileInputRef.current?.click()}
                style={{
                  width: 32, height: 32, borderRadius: 8, background: "transparent", border: "none",
                  color: "rgba(120,113,108,0.45)", cursor: "pointer",
                  display: "flex", alignItems: "center", justifyContent: "center",
                  transition: "color 160ms ease", flexShrink: 0,
                }}
                onMouseEnter={(e) => (e.currentTarget.style.color = "var(--atlas-fg)")}
                onMouseLeave={(e) => (e.currentTarget.style.color = "rgba(120,113,108,0.45)")}
              >
                <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round">
                  <path d="M8 2v12M2 8h12" />
                </svg>
              </button>

              {/* Paperclip */}
              <button
                title="Attach file"
                onClick={() => fileInputRef.current?.click()}
                style={{
                  width: 32, height: 32, borderRadius: 8, background: "transparent", border: "none",
                  color: attachedFile ? "var(--atlas-gold)" : "rgba(120,113,108,0.45)", cursor: "pointer",
                  display: "flex", alignItems: "center", justifyContent: "center",
                  transition: "color 160ms ease", flexShrink: 0,
                }}
                onMouseEnter={(e) => { if (!attachedFile) e.currentTarget.style.color = "var(--atlas-fg)"; }}
                onMouseLeave={(e) => { if (!attachedFile) e.currentTarget.style.color = "rgba(120,113,108,0.45)"; }}
              >
                <svg width="15" height="15" viewBox="0 0 16 16" fill="none">
                  <path d="M13 7.5l-5.5 5.5a4 4 0 01-5.66-5.66l6-6a2.5 2.5 0 013.54 3.54l-6 6a1 1 0 01-1.42-1.42l5.5-5.5" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round" />
                </svg>
              </button>

              {/* Deep Dive button */}
              <div style={{ position: "relative", flexShrink: 0 }}>
                <button
                  onClick={() => setShowDeepDiveMenu(v => !v)}
                  title="Deep Dive — send this conversation to ChatGPT, Perplexity or Gemini"
                  style={{
                    width: 32, height: 32, borderRadius: 8,
                    background: showDeepDiveMenu ? "rgba(201,162,76,0.1)" : "transparent",
                    border: showDeepDiveMenu ? "1px solid rgba(201,162,76,0.25)" : "none",
                    color: showDeepDiveMenu ? "var(--atlas-gold)" : "rgba(120,113,108,0.45)",
                    cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center",
                    transition: "color 160ms ease, background 160ms ease",
                  }}
                  onMouseEnter={e => (e.currentTarget.style.color = "var(--atlas-fg)")}
                  onMouseLeave={e => { if (!showDeepDiveMenu) e.currentTarget.style.color = "rgba(120,113,108,0.45)"; }}
                >
                  <svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round">
                    <circle cx="8" cy="6" r="4" />
                    <path d="M8 10v5M5 13h6" />
                    <path d="M5.5 4.5L3 2M10.5 4.5L13 2" />
                  </svg>
                </button>
                {showDeepDiveMenu && (
                  <>
                  <div onClick={() => setShowDeepDiveMenu(false)} style={{ position: "fixed", inset: 0, zIndex: 59 }} />
                  <div
                    className="atlas-popover"
                    style={{ position: "absolute", bottom: "calc(100% + 8px)", left: 0, zIndex: 60, minWidth: 210 }}
                  >
                    <div style={{ fontSize: 9, fontFamily: "var(--app-font-mono)", letterSpacing: "0.12em", textTransform: "uppercase", color: "rgba(201,162,76,0.5)", padding: "4px 10px 6px", borderBottom: "1px solid rgba(201,162,76,0.08)", marginBottom: 4 }}>
                      Deep Dive
                    </div>
                    {([
                      { id: "chatgpt",    label: "ChatGPT",    sub: "Context auto-fills" },
                      { id: "perplexity", label: "Perplexity", sub: "Context auto-fills" },
                      { id: "gemini",     label: "Gemini",     sub: deepDiveCopied ? "Copied — paste when it opens" : "Copies context, paste once" },
                    ] as const).map(p => (
                      <button
                        key={p.id}
                        onClick={() => {
                          const recentMsgs = homeMessages.slice(-5).map((m: {role: string; content: string}) => `${m.role === "user" ? "Me" : "Atlas"}: ${m.content}`).join("\n\n");
                          const current = input.trim();
                          const ctx = [current ? `My question: ${current}` : "", recentMsgs].filter(Boolean).join("\n\n---\n\n").slice(0, 2000);
                          const encoded = encodeURIComponent(ctx);
                          setShowDeepDiveMenu(false);
                          if (p.id === "chatgpt") {
                            window.open(`https://chatgpt.com/?q=${encoded}`, "_blank");
                          } else if (p.id === "perplexity") {
                            window.open(`https://www.perplexity.ai/search?q=${encoded}`, "_blank");
                          } else {
                            navigator.clipboard.writeText(ctx).catch(() => {});
                            setDeepDiveCopied(true);
                            setTimeout(() => setDeepDiveCopied(false), 3000);
                            toast("Opening Gemini", {
                              description: "Your context is copied — just paste it when you arrive.",
                              duration: 4000,
                            });
                            setTimeout(() => window.open("https://gemini.google.com", "_blank"), 2500);
                          }
                        }}
                        style={{
                          display: "block", width: "100%", textAlign: "left",
                          background: "transparent", border: "none",
                          padding: "7px 10px", borderRadius: 5, cursor: "pointer",
                          transition: "background 120ms ease",
                        }}
                        onMouseEnter={e => (e.currentTarget.style.background = "rgba(201,162,76,0.07)")}
                        onMouseLeave={e => (e.currentTarget.style.background = "transparent")}
                      >
                        <div style={{ fontSize: 12, color: "var(--atlas-fg)", fontWeight: 500 }}>{p.label}</div>
                        <div style={{ fontSize: 10, color: "var(--atlas-muted)", marginTop: 1, fontFamily: "var(--app-font-mono)" }}>{p.sub}</div>
                      </button>
                    ))}
                  </div>
                  </>
                )}
              </div>

              {/* Center hint */}
              <div style={{ flex: 1, display: "flex", justifyContent: "center", pointerEvents: "none" }}>
                <span style={{
                  fontFamily: "var(--app-font-mono)", fontSize: 10.5,
                  letterSpacing: "0.05em", color: "rgba(120,113,108,0.3)",
                  userSelect: "none",
                }}>
                  type / for shortcuts
                </span>
              </div>

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
                <div className="atlas-waveform" style={{ color: "var(--atlas-gold)" }}>
                  <span /><span /><span />
                </div>
              </button>

              {/* Send */}
              <button
                className="atlas-send-btn"
                onClick={handleSubmit}
                disabled={isLoading}
                style={{
                  width: 40, height: 40, flexShrink: 0,
                  background: hasInput && !isLoading ? "var(--atlas-ember)" : "var(--atlas-surface-alt)",
                  border: hasInput ? "none" : "1px solid var(--atlas-border)",
                  boxShadow: hasInput && !isLoading ? "0 0 18px -3px rgba(146,64,14,0.55)" : "none",
                  opacity: isLoading ? 0.5 : 1,
                }}
              >
                {isLoading ? (
                  <LoadingSpinner size="sm" color="ember" />
                ) : (
                  <svg viewBox="0 0 20 20" width={13} height={13}
                    fill={hasInput ? "var(--atlas-fg)" : "none"}
                    stroke={hasInput ? "var(--atlas-fg)" : "var(--atlas-muted)"}
                    strokeWidth={1.5} strokeLinecap="round" strokeLinejoin="round"
                  >
                    <path d="M2.5 10L17 3 13 17l-3.5-5.5z" />
                    <path d="M17 3 9.5 11.5" />
                  </svg>
                )}
              </button>
            </div>
          </div>

          {/* Repo / Branch / Model context bar */}
          <HomeContextBar
            focusLabel={homeFocus ? (projects?.find(p => p.id === homeFocus)?.name ?? "Project") : "All Projects"}
            model={homeModel}
            mode={homeMode}
            onFocusClick={() => setShowFocusSheet(true)}
            onModeClick={() => setShowModeSheet(true)}
            onModelClick={() => setShowModelSheet(true)}
          />

          {/* Inline create error */}
          {createError && (
            <div style={{
              marginTop: 8, padding: "6px 12px", borderRadius: 5, fontSize: 11,
              background: "rgba(146,64,14,0.1)",
              border: "0.5px solid rgba(146,64,14,0.35)",
              color: "var(--atlas-ember)",
              fontFamily: "var(--app-font-mono)",
              lineHeight: 1.4,
            }}>
              {createError}
            </div>
          )}

          {/* Scroll cue — pinned to bottom of hero */}
          <div aria-hidden style={{ position: "absolute", bottom: 20, left: 0, right: 0, textAlign: "center", pointerEvents: "none" }}>
            <div style={{ fontSize: 8.5, fontFamily: "var(--app-font-mono)", letterSpacing: "0.22em", textTransform: "uppercase", color: "var(--atlas-muted)", opacity: 0.28 }}>
              ↓ scroll for your workspace
            </div>
          </div>
          </div>{/* end hero */}

        </div>
      </div>

      {/* Below-the-fold: Recent Activity / Discovery section */}
      <div style={{ display: "flex", flexDirection: "column", alignItems: "center", padding: "0 24px", paddingBottom: 120 }}>
        <BelowFoldDashboard
          projects={(projects ?? []).map((p: Project) => ({
            id: p.id,
            name: p.name,
            description: p.description,
            updatedAt: p.createdAt,
            latestSnapshotScore: p.latestSnapshotScore ?? null,
          }))}
          onOpenProject={navigateToProject}
          onOpenLedger={() => {
            const p = projects?.[0];
            if (p) setLocation(`/ledger/${p.id}`);
          }}
          onOpenParking={() => setLocation("/parking")}
          onOpenQuickPrompt={() => setShowQuickPrompt(true)}
          parkedCount={0}
          committedCount={0}
        />
      </div>

      {showInvite && <InviteModal onClose={() => setShowInvite(false)} />}
      {showProfile && <AccountHubPanel onClose={() => setShowProfile(false)} />}
      {showUpgrade && <UpgradeModal onClose={() => setShowUpgrade(false)} reason="project_limit" />}

      {showFocusSheet && (
        <FocusPickerSheet
          current={homeFocus}
          projects={(projects ?? []).map(p => ({ id: p.id, name: p.name }))}
          onSelect={setHomeFocus}
          onClose={() => setShowFocusSheet(false)}
        />
      )}
      {showModeSheet && (
        <ModePickerSheet
          current={homeMode}
          onSelect={setHomeMode}
          onClose={() => setShowModeSheet(false)}
        />
      )}
      {showModelSheet && (
        <ModelPickerSheet
          current={homeModel}
          onSelect={setHomeModel}
          onClose={() => setShowModelSheet(false)}
        />
      )}

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

      {/* Projects Drawer (slide-in menu) */}
      <ProjectsDrawer
        open={showDrawer}
        onClose={() => setShowDrawer(false)}
        projects={(projects ?? []).map((p: Project) => ({ id: p.id, name: p.name, description: p.description, latestSnapshotScore: p.latestSnapshotScore ?? null }))}
        onOpenProject={navigateToProject}
        onNewProject={() => { setShowDrawer(false); handleNewProject("New Project"); }}
        onOpenLedger={(id) => setLocation(`/ledger/${id}`)}
        onOpenParking={() => setLocation("/parking")}
        onOpenQuickPrompt={() => { setShowDrawer(false); setShowQuickPrompt(true); }}
        userLabel={(() => { try { const r = localStorage.getItem("atlas-user-profile"); return r ? JSON.parse(r).name || null : null; } catch { return null; } })()}
      />

      {showQuickPrompt && (
        <TheForge
          onClose={() => setShowQuickPrompt(false)}
        />
      )}

      {/* Fixed 5-item bottom nav — true flex row, even spacing */}
      <style>{`
        @keyframes homePurpleAtmosphere {
          0%, 100% { opacity: 0.45; }
          50%       { opacity: 1; }
        }
        @keyframes fadeIn { from { opacity: 0; transform: translateY(6px); } to { opacity: 1; transform: translateY(0); } }
        @keyframes briefingReveal {
          from { opacity: 0; transform: translateY(8px); }
          to   { opacity: 1; transform: translateY(0); }
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
      `}</style>
      <div style={{ position: "fixed", bottom: 0, left: 0, right: 0, zIndex: 100, overflow: "visible" }}>
        {/* Arch SVG — visual layer only */}
        <svg
          style={{ position: "absolute", bottom: 0, left: 0, width: "100%", height: 76, overflow: "visible", pointerEvents: "none" }}
          preserveAspectRatio="none"
          viewBox="0 0 390 64"
        >
          <path
            d="M0,0 L148,0 C163,0 172,22 195,22 C218,22 227,0 242,0 L390,0 L390,64 L0,64 Z"
            fill="var(--atlas-nav-arch-fill)"
          />
          <path
            d="M0,0.5 L148,0.5 C163,0.5 172,22 195,22 C218,22 227,0.5 242,0.5 L390,0.5"
            fill="none"
            stroke="rgba(212,175,55,0.2)"
            strokeWidth="1"
            vectorEffect="non-scaling-stroke"
          />
        </svg>

        {/* 5-item flex row — interaction layer */}
        <div style={{
          position: "relative",
          display: "flex",
          alignItems: "center",
          height: 64,
          paddingBottom: "max(env(safe-area-inset-bottom), 6px)",
          zIndex: 1,
        }}>

          {/* HOME — active/gold */}
          <button
            onClick={() => window.scrollTo({ top: 0, behavior: "smooth" })}
            style={{ flex: 1, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", gap: 3, background: "none", border: "none", cursor: "pointer", padding: "6px 0" }}
          >
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="rgba(212,175,55,0.9)" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
              <path d="M3 9l9-7 9 7v11a2 2 0 01-2 2H5a2 2 0 01-2-2z" />
              <polyline points="9,22 9,12 15,12 15,22" />
            </svg>
            <span style={{ fontSize: 8, fontFamily: "var(--app-font-mono)", letterSpacing: "0.1em", textTransform: "uppercase", color: "rgba(212,175,55,0.9)", fontWeight: 700 }}>Home</span>
          </button>

          {/* PROJECTS */}
          <button
            onClick={() => setShowProjectsSheet(true)}
            style={{ flex: 1, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", gap: 3, background: "none", border: "none", cursor: "pointer", padding: "6px 0" }}
          >
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="rgba(120,113,108,0.55)" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
              <path d="M22 19a2 2 0 01-2 2H4a2 2 0 01-2-2V5a2 2 0 012-2h5l2 3h9a2 2 0 012 2z" />
            </svg>
            <span style={{ fontSize: 8, fontFamily: "var(--app-font-mono)", letterSpacing: "0.1em", textTransform: "uppercase", color: "rgba(120,113,108,0.55)" }}>Projects</span>
          </button>

          {/* CENTER — AXIOM raised button → Spec Mode */}
          <div style={{ flex: 1, display: "flex", alignItems: "center", justifyContent: "center" }}>
            <button
              title="Spec Mode"
              className="atlas-home-center-btn"
              style={{
                width: 56, height: 56, borderRadius: "50%",
                border: "2px solid #D4AF37",
                display: "flex", alignItems: "center", justifyContent: "center",
                cursor: "pointer", marginTop: -26,
                animation: "homeAxiomPulse 2.5s ease-in-out infinite",
                flexShrink: 0,
              }}
              onClick={() => setLocation(projects && projects.length > 0 ? `/project/${projects[0]?.id}` : "/projects")}
            >
              <svg viewBox="0 0 512 512" width="40" height="40">
                <defs>
                  <radialGradient id="hnpg" cx="50%" cy="50%" r="50%">
                    <stop offset="0%" stopColor="#5B21B6" stopOpacity="0.35" />
                    <stop offset="100%" stopColor="#0D0B09" stopOpacity="0" />
                  </radialGradient>
                  <radialGradient id="hngs" cx="50%" cy="40%" r="50%">
                    <stop offset="0%" stopColor="#F5D97A" />
                    <stop offset="50%" stopColor="#D4AF37" />
                    <stop offset="100%" stopColor="#A07820" />
                  </radialGradient>
                </defs>
                <rect width="512" height="512" rx="90" fill="#0D0B09" />
                <rect width="512" height="512" rx="90" fill="url(#hnpg)" />
                <polygon points="256,110 170,402 212,402 274,172" fill="url(#hngs)" />
                <polygon points="256,110 342,402 300,402 238,172" fill="url(#hngs)" />
                <rect x="180" y="282" width="152" height="34" rx="5" fill="url(#hngs)" />
              </svg>
            </button>
          </div>

          {/* LEDGER */}
          <button
            onClick={() => {
              const p = (projects ?? [])[0];
              if (p) setLocation(`/ledger/${p.id}`);
            }}
            style={{ flex: 1, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", gap: 3, background: "none", border: "none", cursor: "pointer", padding: "6px 0" }}
          >
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="rgba(120,113,108,0.55)" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
              <path d="M4 19.5A2.5 2.5 0 016.5 17H20" />
              <path d="M6.5 2H20v20H6.5A2.5 2.5 0 014 19.5v-15A2.5 2.5 0 016.5 2z" />
              <path d="M9 7h6M9 11h6M9 15h4" strokeWidth="1.2" />
            </svg>
            <span style={{ fontSize: 8, fontFamily: "var(--app-font-mono)", letterSpacing: "0.1em", textTransform: "uppercase", color: "rgba(120,113,108,0.55)" }}>Ledger</span>
          </button>

          {/* YOU */}
          <button
            onClick={() => setShowProfile(true)}
            style={{ flex: 1, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", gap: 3, background: "none", border: "none", cursor: "pointer", padding: "6px 0" }}
          >
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="rgba(120,113,108,0.55)" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
              <path d="M20 21v-2a4 4 0 00-4-4H8a4 4 0 00-4 4v2" />
              <circle cx="12" cy="7" r="4" />
            </svg>
            <span style={{ fontSize: 8, fontFamily: "var(--app-font-mono)", letterSpacing: "0.1em", textTransform: "uppercase", color: "rgba(120,113,108,0.55)" }}>You</span>
          </button>

        </div>
      </div>
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
          <span style={{ fontFamily: "var(--app-font-mono)", fontSize: 11, fontWeight: 700, letterSpacing: "0.12em", textTransform: "uppercase", color: "var(--atlas-gold)" }}>
            Projects
          </span>
          <button
            onClick={onClose}
            style={{ background: "none", border: "none", cursor: "pointer", color: "rgba(120,113,108,0.6)", fontSize: 20, lineHeight: 1, padding: 4 }}
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
                <span style={{ fontSize: 28, color: "rgba(212,175,55,0.45)", lineHeight: 1 }}>+</span>
              </div>
              <div style={{ padding: "10px 12px 12px" }}>
                <p style={{ margin: 0, fontFamily: "var(--app-font-sans)", fontSize: 12, fontWeight: 600, color: "rgba(212,175,55,0.7)" }}>New Project</p>
                <p style={{ margin: "3px 0 0", fontFamily: "var(--app-font-mono)", fontSize: 9, color: "rgba(120,113,108,0.5)", letterSpacing: "0.05em" }}>Start fresh</p>
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
                    background: "none", border: "1px solid rgba(255,255,255,0.06)", borderRadius: 14,
                    cursor: "pointer", padding: 0, overflow: "hidden", textAlign: "left",
                    transition: "border-color 160ms, transform 120ms",
                  }}
                  onMouseEnter={(e) => { e.currentTarget.style.borderColor = "rgba(212,175,55,0.3)"; e.currentTarget.style.transform = "scale(1.02)"; }}
                  onMouseLeave={(e) => { e.currentTarget.style.borderColor = "rgba(255,255,255,0.06)"; e.currentTarget.style.transform = "scale(1)"; }}
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
                    <div style={{ position: "absolute", top: 8, right: 8, fontFamily: "var(--app-font-mono)", fontSize: 9, fontWeight: 700, letterSpacing: "0.08em", color: "rgba(255,255,255,0.5)" }}>
                      {initials}
                    </div>
                  </div>
                  <div style={{ padding: "10px 12px 12px" }}>
                    <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8, marginBottom: 2 }}>
                      <p style={{ margin: 0, fontFamily: "var(--app-font-sans)", fontSize: 12, fontWeight: 600, color: "var(--atlas-fg)", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis", flex: 1, minWidth: 0 }}>
                        {p.name}
                      </p>
                      <CompactReadinessRing score={p.latestSnapshotScore ?? 0} />
                    </div>
                    <p style={{ margin: 0, fontFamily: "var(--app-font-mono)", fontSize: 9, color: "var(--atlas-muted)", letterSpacing: "0.05em", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
                      {p.description ?? "No description"}
                    </p>
                  </div>
                </button>
              );
            })}

          </div>
        </div>
      </div>
    </>
  );
}
