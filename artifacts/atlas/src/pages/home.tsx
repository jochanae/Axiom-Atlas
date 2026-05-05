import { useState, useRef, useEffect, useCallback } from "react";
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
import { BelowFoldDashboard } from "../components/BelowFoldDashboard";
import { extractApiErrorMessage } from "../lib/atlas-utils";

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
    <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
      <svg width="18" height="18" viewBox="0 0 20 20" fill="none" aria-hidden>
        <circle cx="10" cy="10" r="8" stroke="#C9A24C" strokeWidth="1.2" />
        <circle cx="10" cy="10" r="3.2" stroke="#C9A24C" strokeWidth="0.9" />
        <line x1="10" y1="2" x2="10" y2="18" stroke="#C9A24C" strokeWidth="0.7" strokeDasharray="1.8 2.4" />
        <line x1="2" y1="10" x2="18" y2="10" stroke="#C9A24C" strokeWidth="0.7" strokeDasharray="1.8 2.4" />
      </svg>
      <span
        style={{
          fontFamily: "var(--app-font-sans)",
          fontSize: 13,
          fontWeight: 500,
          letterSpacing: "0.14em",
          color: "var(--atlas-fg)",
          textTransform: "uppercase",
          opacity: 0.88,
        }}
      >
        Atlas
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
      <ProjectThumbnail name={project.name} id={project.id} />

      <div style={{ minWidth: 0, flex: 1 }}>
        <div
          style={{
            fontSize: 13,
            fontWeight: 500,
            color: hov ? "var(--atlas-fg)" : "rgba(231,229,228,0.78)",
            whiteSpace: "nowrap",
            overflow: "hidden",
            textOverflow: "ellipsis",
            marginBottom: project.description ? 3 : 0,
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
            }}
          >
            {project.description}
          </div>
        )}
      </div>

      <div style={{ display: "flex", alignItems: "center", gap: 10, flexShrink: 0 }}>
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

// ── HomeProfileSheet ─────────────────────────────────────────────────────────
function HomeProfileSheet({ onClose }: { onClose: () => void }) {
  const [name, setName] = useState(() => {
    try { const r = localStorage.getItem("atlas-user-profile"); return r ? JSON.parse(r).name ?? "" : ""; } catch { return ""; }
  });
  const [photoUrl, setPhotoUrl] = useState(() => {
    try { const r = localStorage.getItem("atlas-user-profile"); return r ? JSON.parse(r).photoUrl ?? "" : ""; } catch { return ""; }
  });
  const [saved, setSaved] = useState(false);
  const sMono: React.CSSProperties = { fontFamily: "var(--app-font-mono)" };

  const save = () => {
    try {
      const raw = localStorage.getItem("atlas-user-profile");
      const existing = raw ? JSON.parse(raw) : {};
      localStorage.setItem("atlas-user-profile", JSON.stringify({ ...existing, name, photoUrl }));
    } catch {}
    setSaved(true);
    setTimeout(() => { setSaved(false); onClose(); }, 700);
  };

  return (
    <div style={{ position: "fixed", inset: 0, zIndex: 200, display: "flex", alignItems: "flex-end", justifyContent: "center" }}>
      <div onClick={onClose} style={{ position: "absolute", inset: 0, background: "rgba(0,0,0,0.55)", backdropFilter: "blur(4px)" }} />
      <div style={{
        position: "relative", zIndex: 1, width: "100%", maxWidth: 480,
        background: "var(--atlas-surface)", borderRadius: "16px 16px 0 0",
        borderTop: "1px solid var(--atlas-border)", padding: "20px 20px 36px",
        display: "flex", flexDirection: "column", gap: 14,
        boxShadow: "0 -8px 40px rgba(0,0,0,0.5)",
      }}>
        <div style={{ width: 36, height: 4, borderRadius: 2, background: "rgba(255,255,255,0.12)", margin: "0 auto 4px" }} />
        <div style={{ fontSize: 12, ...sMono, letterSpacing: "0.1em", color: "var(--atlas-fg)", opacity: 0.7 }}>YOUR PROFILE</div>
        {photoUrl && (
          <div style={{ display: "flex", justifyContent: "center" }}>
            <img src={photoUrl} alt="" style={{ width: 56, height: 56, borderRadius: "50%", objectFit: "cover", border: "2px solid rgba(201,162,76,0.3)" }} />
          </div>
        )}
        <div style={{ display: "flex", flexDirection: "column", gap: 5 }}>
          <label style={{ fontSize: 9, ...sMono, letterSpacing: "0.1em", color: "var(--atlas-muted)", opacity: 0.55, textTransform: "uppercase" }}>Name</label>
          <input value={name} onChange={(e) => setName(e.target.value)} placeholder="Your name"
            style={{ padding: "8px 10px", borderRadius: 6, background: "var(--atlas-surface-alt)", border: "1px solid var(--atlas-border)", color: "var(--atlas-fg)", fontSize: 13, outline: "none", ...sMono }}
            onFocus={(e) => (e.currentTarget.style.borderColor = "rgba(201,162,76,0.35)")}
            onBlur={(e) => (e.currentTarget.style.borderColor = "var(--atlas-border)")} />
        </div>
        <div style={{ display: "flex", flexDirection: "column", gap: 5 }}>
          <label style={{ fontSize: 9, ...sMono, letterSpacing: "0.1em", color: "var(--atlas-muted)", opacity: 0.55, textTransform: "uppercase" }}>Photo URL</label>
          <input value={photoUrl} onChange={(e) => setPhotoUrl(e.target.value)} placeholder="Paste your Google profile photo URL"
            style={{ padding: "8px 10px", borderRadius: 6, background: "var(--atlas-surface-alt)", border: "1px solid var(--atlas-border)", color: "var(--atlas-fg)", fontSize: 11, outline: "none", ...sMono }}
            onFocus={(e) => (e.currentTarget.style.borderColor = "rgba(201,162,76,0.35)")}
            onBlur={(e) => (e.currentTarget.style.borderColor = "var(--atlas-border)")} />
          <div style={{ fontSize: 9, ...sMono, color: "var(--atlas-muted)", opacity: 0.4 }}>Right-click your Google photo → Copy image address</div>
        </div>
        <button onClick={save} style={{
          marginTop: 4, padding: "11px", borderRadius: 8, border: "none",
          background: saved ? "rgba(52,211,153,0.15)" : "var(--atlas-ember)",
          color: saved ? "#34d399" : "var(--atlas-fg)",
          fontSize: 11, ...sMono, letterSpacing: "0.1em", textTransform: "uppercase", cursor: "pointer",
        }}>
          {saved ? "Saved ✓" : "Save"}
        </button>
      </div>
    </div>
  );
}

// ── Home ─────────────────────────────────────────────────────────────────────
export default function Home() {
  const [input, setInput] = useState("");
  const [createError, setCreateError] = useState<string | null>(null);
  const [attachedFile, setAttachedFile] = useState<File | null>(null);
  const [showProfile, setShowProfile] = useState(false);
  const [showDrawer, setShowDrawer] = useState(false);
  const [isListening, setIsListening] = useState(false);
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

  const navigateToProject = useCallback(
    (projectId: number) => {
      if (input.trim()) {
        sessionStorage.setItem(`atlas-initial-${projectId}`, input.trim());
      }
      setLocation(`/project/${projectId}`);
    },
    [input, setLocation]
  );

  const handleSubmit = useCallback(() => {
    const firstProject = projects?.[0];
    if (firstProject) {
      navigateToProject(firstProject.id);
    } else {
      setCreateError(null);
      createProject.mutate(
        { data: { name: "My Project" } },
        {
          onSuccess: (p) => {
            queryClient.invalidateQueries({ queryKey: getListProjectsQueryKey() });
            navigateToProject(p.id);
          },
          onError: (err) => {
            setCreateError(extractApiErrorMessage(err));
          },
        }
      );
    }
  }, [projects, navigateToProject, createProject, queryClient]);


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
  const loading = createProject.isPending;

  return (
    <div
      style={{
        height: "100vh",
        background: "var(--atlas-bg)",
        display: "flex",
        flexDirection: "column",
        overflowY: "auto",
        overflowX: "hidden",
      }}
    >
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
              color: "rgba(120,113,108,0.45)", cursor: "pointer",
              display: "flex", alignItems: "center", justifyContent: "center",
              transition: "color 160ms ease", flexShrink: 0,
            }}
            onMouseEnter={(e) => (e.currentTarget.style.color = "var(--atlas-gold)")}
            onMouseLeave={(e) => (e.currentTarget.style.color = "rgba(120,113,108,0.45)")}
          >
            <svg width="16" height="16" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round">
              <rect x="2" y="2" width="16" height="16" rx="2.5" />
              <path d="M7 2v16" />
              <path d="M10 7h5M10 10h5M10 13h4" />
            </svg>
          </button>
          <AtlasLogo />
        </div>

        {/* Right side: timestamp + user menu */}
        <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
          <InlineTimestamp />
          <UserMenuDropdown onOpenProfile={() => setShowProfile(true)} />
        </div>
      </div>

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
          <div style={{ minHeight: "calc(100svh - 50px - env(safe-area-inset-bottom, 0px))", display: "flex", flexDirection: "column", justifyContent: "center", position: "relative", paddingBottom: 72 }}>

          {/* Greeting */}
          <div style={{ textAlign: "center", marginBottom: 24 }}>
            <h1
              style={{
                fontSize: 30,
                fontWeight: 300,
                color: "var(--atlas-fg)",
                letterSpacing: "-0.025em",
                lineHeight: 1.2,
                opacity: 0.85,
                margin: "0 0 10px",
              }}
            >
              Where were we.
            </h1>
            <p
              style={{
                fontSize: 13,
                color: "var(--atlas-muted)",
                opacity: 0.55,
                margin: 0,
                fontStyle: "italic",
              }}
            >
              I'm here. What's on your mind?
            </p>
          </div>

          {/* Ambient bloom spinner */}
          <div
            style={{
              display: "flex",
              justifyContent: "center",
              margin: "18px 0 26px",
            }}
          >
            <LoadingSpinner size="sm" color="atlas" />
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
                disabled={loading}
                style={{
                  width: 40, height: 40, flexShrink: 0,
                  background: hasInput && !loading ? "var(--atlas-ember)" : "var(--atlas-surface-alt)",
                  border: hasInput ? "none" : "1px solid var(--atlas-border)",
                  boxShadow: hasInput && !loading ? "0 0 18px -3px rgba(146,64,14,0.55)" : "none",
                  opacity: loading ? 0.5 : 1,
                }}
              >
                {loading ? (
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
      <div style={{ display: "flex", flexDirection: "column", alignItems: "center", padding: "0 24px" }}>
        <BelowFoldDashboard
          projects={(projects ?? []).map((p: Project) => ({
            id: p.id,
            name: p.name,
            description: p.description,
            updatedAt: p.createdAt,
          }))}
          onOpenProject={navigateToProject}
          onOpenLedger={() => {
            const p = projects?.[0];
            if (p) setLocation(`/ledger/${p.id}`);
          }}
          onOpenParking={() => setLocation("/parking")}
          parkedCount={0}
          committedCount={0}
        />
      </div>

      {showProfile && <HomeProfileSheet onClose={() => setShowProfile(false)} />}

      {/* Projects Drawer (slide-in menu) */}
      <ProjectsDrawer
        open={showDrawer}
        onClose={() => setShowDrawer(false)}
        projects={(projects ?? []).map((p: Project) => ({ id: p.id, name: p.name, description: p.description }))}
        onOpenProject={navigateToProject}
        onNewProject={() => { setShowDrawer(false); }}
        onOpenLedger={(id) => setLocation(`/ledger/${id}`)}
        onOpenParking={() => setLocation("/parking")}
        userLabel={(() => { try { const r = localStorage.getItem("atlas-user-profile"); return r ? JSON.parse(r).name || null : null; } catch { return null; } })()}
      />
    </div>
  );
}
