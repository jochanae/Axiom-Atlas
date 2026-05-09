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
import { BelowFoldDashboard } from "../components/BelowFoldDashboard";
import { InviteModal } from "../components/InviteModal";
import { extractApiErrorMessage } from "../lib/atlas-utils";
import { useAuth, useRequireAuth, isSuperAdmin } from "../hooks/useAuth";
import { useSubscription } from "../hooks/useSubscription";
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
        <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
          <label style={{ fontSize: 9, ...sMono, letterSpacing: "0.1em", color: "var(--atlas-muted)", opacity: 0.55, textTransform: "uppercase" }}>Photo</label>
          {/* Upload button */}
          <label style={{ cursor: "pointer" }}>
            <div style={{
              padding: "8px 12px", borderRadius: 6, border: "1px dashed rgba(201,162,76,0.3)",
              background: "var(--atlas-surface-alt)", display: "flex", alignItems: "center", gap: 8,
              transition: "border-color 160ms ease",
            }}
              onMouseEnter={(e) => ((e.currentTarget as HTMLElement).style.borderColor = "rgba(201,162,76,0.55)")}
              onMouseLeave={(e) => ((e.currentTarget as HTMLElement).style.borderColor = "rgba(201,162,76,0.3)")}
            >
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="rgba(201,162,76,0.65)" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" style={{ flexShrink: 0 }}>
                <rect x="3" y="3" width="18" height="18" rx="2" /><circle cx="8.5" cy="8.5" r="1.5" />
                <polyline points="21 15 16 10 5 21" />
              </svg>
              <span style={{ fontSize: 11, color: "var(--atlas-muted)", ...sMono, opacity: 0.65 }}>Upload photo from device</span>
            </div>
            <input type="file" accept="image/jpeg,image/png,image/webp,image/gif" style={{ display: "none" }}
              onChange={(e) => {
                const file = e.target.files?.[0];
                if (!file) return;
                const reader = new FileReader();
                reader.onload = (ev) => {
                  const dataUrl = ev.target?.result as string;
                  if (!dataUrl) return;
                  const img = new Image();
                  img.onload = () => {
                    const MAX = 256;
                    let w = img.width, h = img.height;
                    if (w > h) { h = Math.round(h * MAX / w); w = MAX; }
                    else { w = Math.round(w * MAX / h); h = MAX; }
                    const canvas = document.createElement("canvas");
                    canvas.width = w; canvas.height = h;
                    const ctx = canvas.getContext("2d");
                    if (ctx) { ctx.drawImage(img, 0, 0, w, h); setPhotoUrl(canvas.toDataURL("image/jpeg", 0.75)); }
                    else { setPhotoUrl(dataUrl); }
                  };
                  img.src = dataUrl;
                };
                reader.readAsDataURL(file);
              }}
            />
          </label>
          {/* Divider */}
          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <div style={{ flex: 1, height: 1, background: "var(--atlas-border)" }} />
            <span style={{ fontSize: 9, ...sMono, color: "var(--atlas-muted)", opacity: 0.35, letterSpacing: "0.06em" }}>OR</span>
            <div style={{ flex: 1, height: 1, background: "var(--atlas-border)" }} />
          </div>
          {/* URL paste */}
          <input value={photoUrl.startsWith("data:") ? "" : photoUrl} onChange={(e) => setPhotoUrl(e.target.value)} placeholder="Paste a photo URL"
            style={{ padding: "8px 10px", borderRadius: 6, background: "var(--atlas-surface-alt)", border: "1px solid var(--atlas-border)", color: "var(--atlas-fg)", fontSize: 11, outline: "none", ...sMono }}
            onFocus={(e) => (e.currentTarget.style.borderColor = "rgba(201,162,76,0.35)")}
            onBlur={(e) => (e.currentTarget.style.borderColor = "var(--atlas-border)")} />
          {photoUrl.startsWith("data:") && (
            <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
              <span style={{ fontSize: 9, ...sMono, color: "#34d399", opacity: 0.75 }}>✓ Photo uploaded</span>
              <button onClick={() => setPhotoUrl("")} style={{ background: "transparent", border: "none", cursor: "pointer", fontSize: 9, ...sMono, color: "var(--atlas-muted)", opacity: 0.45, padding: 0 }}
                onMouseEnter={(e) => (e.currentTarget.style.opacity = "0.8")}
                onMouseLeave={(e) => (e.currentTarget.style.opacity = "0.45")}>Remove</button>
            </div>
          )}
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
  const { user: authUser } = useAuth();
  useRequireAuth();
  const [showProfile, setShowProfile] = useState(false);
  const [showInvite, setShowInvite] = useState(false);
  const [showDrawer, setShowDrawer] = useState(false);
  const [showProjectsSheet, setShowProjectsSheet] = useState(false);
  const [showUpgrade, setShowUpgrade] = useState(false);
  const [isListening, setIsListening] = useState(false);
  const { isFree } = useSubscription();
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

  const handleSubmit = useCallback(() => {
    // Always create a fresh project when submitting from the home input —
    // never silently drop the user into an existing project.
    if (isFree && (projects?.length ?? 0) >= 1) {
      setShowUpgrade(true);
      return;
    }
    setCreateError(null);
    createProject.mutate(
      { data: { name: "New Project" } },
      {
        onSuccess: (p) => {
          queryClient.invalidateQueries({ queryKey: getListProjectsQueryKey() });
          navigateToProject(p.id);
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
  }, [isFree, projects, navigateToProject, createProject, queryClient]);


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
              disabled={loading}
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
                cursor: loading ? "not-allowed" : "pointer",
                color: "rgba(212,175,55,0.55)",
                fontSize: 14, lineHeight: 1, fontWeight: 300,
                flexShrink: 0, marginLeft: -4, position: "relative", zIndex: 1,
                opacity: loading ? 0.4 : 1,
                transition: "all 160ms ease",
              }}
              onMouseEnter={(e) => { if (!loading) { e.currentTarget.style.borderColor = "rgba(212,175,55,0.75)"; e.currentTarget.style.color = "#D4AF37"; } }}
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
          loading={loading}
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
          <div style={{ textAlign: "center", marginBottom: 24, position: "relative", zIndex: 1 }}>
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
          parkedCount={0}
          committedCount={0}
        />
      </div>

      {showInvite && <InviteModal onClose={() => setShowInvite(false)} />}
      {showProfile && <HomeProfileSheet onClose={() => setShowProfile(false)} />}
      {showUpgrade && <UpgradeModal onClose={() => setShowUpgrade(false)} reason="project_limit" />}

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
        userLabel={(() => { try { const r = localStorage.getItem("atlas-user-profile"); return r ? JSON.parse(r).name || null : null; } catch { return null; } })()}
      />

      {/* Fixed 5-item bottom nav — true flex row, even spacing */}
      <style>{`
        @keyframes homePurpleAtmosphere {
          0%, 100% { opacity: 0.45; }
          50%       { opacity: 1; }
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
              onClick={() => {
                const lastId = (() => { try { return localStorage.getItem("atlas-last-project") || ""; } catch { return ""; } })();
                const targetId = lastId || (projects ?? [])[0]?.id;
                if (targetId) {
                  sessionStorage.setItem("atlas-open-tab", "map");
                  setLocation(`/project/${targetId}`);
                }
              }}
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
