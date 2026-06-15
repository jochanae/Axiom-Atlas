import { useState, useEffect, useRef } from "react";
import { createPortal } from "react-dom";
import { useGetProject, getGetProjectQueryKey, updateProject, useUpdateProject } from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import { LoadingSpinner } from "../ui/loading-spinner";
import { parseLinkedRepo } from "@/lib/githubRepo";
import { useIsMobile } from "@/hooks/useBreakpoints";

export function PreviewPanel({ projectId, sandboxCode, onSandboxConsumed, refreshTrigger, sessionId, onSwitchToFiles }: {
  projectId: number;
  sandboxCode?: string | null;
  onSandboxConsumed?: () => void;
  refreshTrigger?: number;
  sessionId?: number;
  onSwitchToFiles?: () => void;
}) {

  const queryClient = useQueryClient();
  const { data: project } = useGetProject(projectId, { query: { queryKey: getGetProjectQueryKey(projectId) } });
  const updateProject = useUpdateProject();

  // Mode toggle
  const [previewMode, setPreviewMode] = useState<"url" | "sandbox" | "stackblitz" | "generated">("url");
  const [generatedPreviewUrl, setGeneratedPreviewUrl] = useState<string | null>(null);

  useEffect(() => {
    if (!sessionId) {
      setGeneratedPreviewUrl(null);
      return;
    }
    setGeneratedPreviewUrl(`/api/preview/session/${sessionId}`);
  }, [sessionId]);

  useEffect(() => {
    if (generatedPreviewUrl) {
      setPreviewMode("generated");
    }
  }, [generatedPreviewUrl]);

  // Device switcher
  type DeviceSize = "phone" | "tablet" | "desktop";
  const [deviceSize, setDeviceSize] = useState<DeviceSize>("desktop");
  const [isLandscape, setIsLandscape] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);
  const [containerW, setContainerW] = useState(0);
  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const ro = new ResizeObserver(([e]) => setContainerW(e.contentRect.width));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  // Sandbox state
  const [sandboxInput, setSandboxInput] = useState("");
  const [sandboxRendered, setSandboxRendered] = useState<string | null>(null);
  const [sandboxExpanded, setSandboxExpanded] = useState(true);

  // ── URL mode state ──────────────────────────────────────────────────────────
  const storageKey = `atlas-preview-${projectId}`;
  const [urlInput, setUrlInput] = useState("");
  const [liveUrl, setLiveUrl] = useState("");
  const [iframeError, setIframeError] = useState(false);
  const [iframeLoading, setIframeLoading] = useState(false);
  const [detecting, setDetecting] = useState(false);
  const [detectResults, setDetectResults] = useState<Array<{ url: string; platform: string; confidence: string }>>([]);
  const [reloadKey, setReloadKey] = useState(0);
  const [savedIndicator, setSavedIndicator] = useState(false);
  // URL-mode chrome collapse + status auto-hide
  const [chromeVisible, setChromeVisible] = useState(true);
  const [statusVisible, setStatusVisible] = useState(false);
  const [deviceMenuOpen, setDeviceMenuOpen] = useState(false);
  const deviceBtnRef = useRef<HTMLButtonElement | null>(null);
  const [deviceMenuPos, setDeviceMenuPos] = useState<{ top: number; right: number } | null>(null);
  useEffect(() => {
    if (!deviceMenuOpen) return;
    const update = () => {
      const r = deviceBtnRef.current?.getBoundingClientRect();
      if (r) setDeviceMenuPos({ top: r.bottom + 4, right: window.innerWidth - r.right });
    };
    update();
    window.addEventListener("resize", update);
    window.addEventListener("scroll", update, true);
    return () => {
      window.removeEventListener("resize", update);
      window.removeEventListener("scroll", update, true);
    };
  }, [deviceMenuOpen]);
  const [detectMenuOpen, setDetectMenuOpen] = useState(false);
  const isMobile = useIsMobile();
  const [mobileFullscreen, setMobileFullscreen] = useState(false);
  useEffect(() => {
    if (!mobileFullscreen) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") setMobileFullscreen(false); };
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    window.addEventListener("keydown", onKey);
    return () => {
      document.body.style.overflow = prevOverflow;
      window.removeEventListener("keydown", onKey);
    };
  }, [mobileFullscreen]);

  // ── Devserver state ──────────────────────────────────────────────────────────
  type DsStatus = "idle" | "cloning" | "installing" | "starting" | "running" | "error";
  const [dsStatus, setDsStatus] = useState<DsStatus>("idle");
  const [dsLogs, setDsLogs] = useState<string[]>([]);
  const [dsPort, setDsPort] = useState<number | null>(null);
  const [dsErrorMsg, setDsErrorMsg] = useState<string | null>(null);
  const [dsStarting, setDsStarting] = useState(false);
  const [showEnvVars, setShowEnvVars] = useState(false);
  const [devEnvVars, setDevEnvVars] = useState<{ key: string; value: string }[]>([{ key: "", value: "" }]);
  const dsLogsEndRef = useRef<HTMLDivElement>(null);

  // Poll status while active
  useEffect(() => {
    if ((previewMode as string) !== "local" || dsStatus === "idle") return;
    const iv = setInterval(async () => {
      try {
        const r = await fetch("/api/devserver/status", { credentials: "include" });
        if (!r.ok) return;
        const d = await r.json() as { status: string; port: number | null; logs: string[]; errorMsg: string | null };
        setDsStatus(d.status as DsStatus);
        setDsLogs(d.logs);
        setDsPort(d.port);
        setDsErrorMsg(d.errorMsg);
      } catch {}
    }, 2000);
    return () => clearInterval(iv);
  }, [previewMode, dsStatus]);

  // Auto-scroll logs
  useEffect(() => {
    dsLogsEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [dsLogs]);

  const handleDsStart = async () => {
    if (!linkedRepo) return;
    setDsStarting(true);
    setDsLogs([]);
    setDsErrorMsg(null);
    const token = project?.githubToken ?? "__server__";
    const envVars = devEnvVars
      .filter(({ key }) => key.trim())
      .reduce<Record<string, string>>((acc, { key, value }) => {
        acc[key.trim()] = value;
        return acc;
      }, {});
    try {
      const r = await fetch("/api/devserver/start", {
        method: "POST",
        headers: { "Content-Type": "application/json", "x-github-token": token },
        credentials: "include",
        body: JSON.stringify({ repoFullName: linkedRepo.fullName, branch: linkedRepo.defaultBranch ?? "main", envVars }),
      });
      const d = await r.json() as { status?: string; error?: string };
      if (!r.ok) throw new Error(d.error ?? "Failed to start");
      setDsStatus((d.status ?? "cloning") as DsStatus);
    } catch (e) {
      setDsErrorMsg(e instanceof Error ? e.message : "Start failed");
      setDsStatus("error");
    } finally {
      setDsStarting(false);
    }
  };

  const handleDsStop = async () => {
    await fetch("/api/devserver/stop", { method: "POST", credentials: "include" });
    setDsStatus("idle");
    setDsLogs([]);
    setDsPort(null);
    setDsErrorMsg(null);
  };

  const DS_STAGE_LABELS: Record<DsStatus, string> = {
    idle: "Idle",
    cloning: "Cloning repo…",
    installing: "Installing dependencies…",
    starting: "Starting dev server…",
    running: "Running",
    error: "Error",
  };
  const DS_STAGE_PROGRESS: Record<DsStatus, number> = {
    idle: 0, cloning: 20, installing: 50, starting: 80, running: 100, error: 0,
  };
  const devError = dsErrorMsg;

  // Sync external refresh trigger (from push success) into local reloadKey
  const prevRefreshTrigger = useRef(refreshTrigger ?? 0);
  useEffect(() => {
    if ((refreshTrigger ?? 0) > prevRefreshTrigger.current) {
      prevRefreshTrigger.current = refreshTrigger ?? 0;
      setIframeLoading(true);
      setIframeError(false);
      setReloadKey((k) => k + 1);
    }
  }, [refreshTrigger]);
  const [autoDetected, setAutoDetected] = useState<{ url: string; platform: string } | null>(null);
  const autoDetectTriedRef = useRef<string | null>(null);

  const { data: previewProject } = useGetProject(projectId, { query: { queryKey: getGetProjectQueryKey(projectId) } });
  const linkedRepo = parseLinkedRepo(previewProject?.linkedRepo);
  // Auto-switch to StackBlitz when a repo is linked and no live URL is saved
  useEffect(() => {
    if (linkedRepo && !liveUrl) {
      setPreviewMode("stackblitz");
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [linkedRepo?.fullName]);
  const token = previewProject?.githubToken ?? null;


  // ── Sandbox handoff from chat ────────────────────────────────────────────────
  const buildSrcdoc = (code: string): string => {
    const t = code.trim();
    // Already a full HTML doc
    if (/^\s*<!DOCTYPE/i.test(t) || /^\s*<html/i.test(t)) return t;

    // Detect React/JSX: has imports from react, JSX syntax, or export default function
    const isReact = /from\s+['"]react['"]|useState|useEffect|export\s+default\s+function|export\s+default\s+class|<[A-Z][A-Za-z]*[\s/>]/.test(t);

    if (isReact) {
      // Capture which function/class was the default export before stripping
      const exportMatch = t.match(/export\s+default\s+(?:function|class)\s+([A-Z]\w*)/);
      // Also handle: export default SomeName; at end of file
      const namedExportMatch = t.match(/export\s+default\s+([A-Z]\w*)\s*;/);
      const mainComponent = exportMatch?.[1] ?? namedExportMatch?.[1];

      let processed = t
        // Strip all import lines
        .replace(/^import\s+.*?\n/gm, "")
        // Remove export default from function/class declaration
        .replace(/export\s+default\s+(function|class)\s+/g, "$1 ")
        // Remove standalone export default SomeName;
        .replace(/export\s+default\s+[A-Z]\w*\s*;\s*/g, "");

      // If we couldn't find a named export, find the last uppercase function as fallback
      const fallback = mainComponent ?? [...processed.matchAll(/function\s+([A-Z]\w*)\s*\(/g)].pop()?.[1];

      return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <script src="https://cdn.tailwindcss.com"><\/script>
  <script src="https://unpkg.com/react@18/umd/react.development.js"><\/script>
  <script src="https://unpkg.com/react-dom@18/umd/react-dom.development.js"><\/script>
  <script src="https://unpkg.com/@babel/standalone/babel.min.js"><\/script>
  <style>*, *::before, *::after { box-sizing: border-box; } body { margin: 0; padding: 0; }</style>
</head>
<body>
  <div id="root"></div>
  <script type="text/babel">
    const { useState, useEffect, useCallback, useRef, useMemo, useContext, createContext } = React;
    const useNavigate = () => () => {};
    const useLocation = () => ({ pathname: "/" });
    const useParams = () => ({});
    const Link = ({ children, to, className, style, onClick }) => (
      <a href={to ?? "#"} className={className} style={style} onClick={onClick}>{children}</a>
    );

    ${processed}

    ${fallback ? `ReactDOM.createRoot(document.getElementById("root")).render(React.createElement(${fallback}));` : ""}
  <\/script>
</body>
</html>`;
    }

    // Plain HTML
    return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <script src="https://cdn.tailwindcss.com"><\/script>
  <style>*, *::before, *::after { box-sizing: border-box; } body { margin: 0; padding: 0; }</style>
</head>
<body>
${t}
</body>
</html>`;
  };
  // Persist sandbox code per-project so generated previews survive hard refresh.
  const sandboxStorageKey = `atlas-sandbox-${projectId}`;
  useEffect(() => {
    if (!sandboxCode) return;
    setPreviewMode("sandbox");
    setSandboxInput(sandboxCode);
    setSandboxRendered(buildSrcdoc(sandboxCode));
    setSandboxExpanded(false);
    try { localStorage.setItem(sandboxStorageKey, sandboxCode); } catch {}
    onSandboxConsumed?.();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sandboxCode]);

  // Rehydrate sandbox on mount / project switch.
  useEffect(() => {
    if (sandboxCode) return; // incoming prop wins
    try {
      const saved = localStorage.getItem(sandboxStorageKey);
      if (saved) {
        setSandboxInput(saved);
        setSandboxRendered(buildSrcdoc(saved));
      }
    } catch {}
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [projectId]);


  // Sync from DB on project load / switch
  useEffect(() => {
    const dbUrl = project?.previewUrl ?? "";
    const legacyUrl = (() => { try { return localStorage.getItem(storageKey) || ""; } catch { return ""; } })();
    const resolved = dbUrl || legacyUrl;
    setUrlInput(resolved);
    setLiveUrl(resolved);
    setIframeError(false);
    setIframeLoading(!!resolved);
    setDetectResults([]);
    if (!resolved) setAutoDetected(null);
  }, [projectId, project?.previewUrl]);

  // ── Auto-detect URL when repo is linked and no URL saved yet ────────────────
  useEffect(() => {
    const repoKey = linkedRepo?.fullName ?? null;
    if (!repoKey || !token || liveUrl || detecting) return;
    if (autoDetectTriedRef.current === `${projectId}:${repoKey}`) return;
    autoDetectTriedRef.current = `${projectId}:${repoKey}`;
    const run = async () => {
      setDetecting(true);
      try {
        const res = await fetch(`/api/github/deployment?repo=${encodeURIComponent(repoKey)}`, {
          headers: { "x-github-token": token },
        });
        if (!res.ok) return;
        const data = await res.json() as {
          detected: Array<{ url: string; platform: string; confidence: string }>;
          suggestions: Array<{ url: string; platform: string; confidence: string }>;
        };
        // Surface everything as suggestions — never auto-save a URL the user
        // didn't explicitly connect. The user picks which one to apply.
        const all = [
          ...(data.detected ?? []),
          ...(data.suggestions ?? []).filter((s) => !data.detected?.find((d) => d.url === s.url)),
        ];
        if (all.length > 0) setDetectResults(all);
      } catch {}
      finally { setDetecting(false); }
    };
    run();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [linkedRepo?.fullName, token, liveUrl, projectId]);

  const normalize = (raw: string) =>
    raw.startsWith("http://") || raw.startsWith("https://") ? raw : `https://${raw}`;

  const applyUrl = (url: string) => {
    const u = normalize(url);
    setUrlInput(u);
    setLiveUrl(u);
    setIframeError(false);
    setIframeLoading(true);
    setReloadKey((k) => k + 1);
    try { localStorage.setItem(storageKey, u); } catch {}
  };

  const handleGo = () => { if (urlInput.trim()) { setAutoDetected(null); applyUrl(urlInput.trim()); } };

  const handleSaveToProject = () => {
    if (!liveUrl) return;
    updateProject.mutate(
      { id: projectId, data: { previewUrl: liveUrl } },
      {
        onSuccess: () => {
          queryClient.invalidateQueries({ queryKey: getGetProjectQueryKey(projectId) });
          setSavedIndicator(true);
          setTimeout(() => setSavedIndicator(false), 2500);
        },
      }
    );
  };

  const handleClear = () => {
    setLiveUrl(""); setUrlInput(""); setIframeError(false); setIframeLoading(false);
    setDetectResults([]); setAutoDetected(null);
    autoDetectTriedRef.current = null;
    try { localStorage.removeItem(storageKey); } catch {}
    updateProject.mutate({ id: projectId, data: { previewUrl: null } }, {
      onSuccess: () => queryClient.invalidateQueries({ queryKey: getGetProjectQueryKey(projectId) }),
    });
  };

  const handleDetect = async () => {
    if (!linkedRepo || !token) return;
    setDetecting(true);
    setDetectResults([]);
    try {
      const res = await fetch(`/api/github/deployment?repo=${encodeURIComponent(linkedRepo.fullName)}`, {
        headers: { "x-github-token": token },
      });
      if (res.ok) {
        const data = await res.json() as { detected: Array<{ url: string; platform: string; confidence: string }>; suggestions: Array<{ url: string; platform: string; confidence: string }> };
        const all = [...data.detected, ...data.suggestions.filter(s => !data.detected.find(d => d.url === s.url))];
        setDetectResults(all);
      }
    } catch {}
    setDetecting(false);
  };

  const sMono: React.CSSProperties = { fontFamily: "var(--app-font-mono)" };
  const platformColor = (p: string) => {
    if (p === "Vercel") return "var(--atlas-fg)";
    if (p === "Netlify") return "rgba(110,231,183,0.8)";
    if (p === "GitHub Pages") return "rgba(147,197,253,0.8)";
    if (p === "Replit") return "rgba(201,162,76,0.85)";
    return "var(--atlas-muted)";
  };


  // Device config — desktop renders at a real desktop width then scales down,
  // otherwise the iframe inherits the narrow panel width and the site responds
  // as mobile. Landscape on desktop = ultrawide (1920); portrait = standard 1440.
  const DEVICE_CONFIG = {
    phone:   { portrait: [390, 844],   landscape: [844, 390] },
    tablet:  { portrait: [768, 1024],  landscape: [1024, 768] },
    desktop: { portrait: [1440, 900],  landscape: [1920, 1080] },
  } as const;
  const orient = isLandscape ? "landscape" : "portrait";
  const [dW, dH] = DEVICE_CONFIG[deviceSize][orient];
  const scale = dW && containerW > 0 && containerW < dW + 24 ? (containerW - 24) / dW : 1;

  const deviceBtnStyle = (active: boolean): React.CSSProperties => ({
    display: "flex", alignItems: "center", justifyContent: "center",
    gap: 3, padding: "4px 7px", borderRadius: 4,
    background: active ? "rgba(201,162,76,0.12)" : "transparent",
    border: `1px solid ${active ? "rgba(201,162,76,0.3)" : "transparent"}`,
    color: active ? "var(--atlas-gold)" : "var(--atlas-muted)",
    fontSize: 9, fontFamily: "var(--app-font-mono)", letterSpacing: "0.04em",
    cursor: "pointer", transition: "all 140ms ease", opacity: active ? 1 : 0.5,
  });

  // Device iframe wrapper — all three sizes render at their real viewport width
  // and get scaled to fit the panel, so responsive sites render the right layout.
  const deviceWrapperStyle: React.CSSProperties = {
    flex: 1, display: "flex", alignItems: "flex-start", justifyContent: "center",
    overflow: "auto",
    padding: deviceSize === "desktop" ? "8px 6px" : "12px 8px",
    background: "rgba(0,0,0,0.18)",
  };
  const deviceInnerStyle: React.CSSProperties = {
    width: dW ?? undefined, height: dH ?? undefined,
    transform: `scale(${scale})`, transformOrigin: "top center",
    borderRadius: deviceSize === "desktop" ? 6 : 14,
    overflow: "hidden", flexShrink: 0,
    boxShadow: "0 0 0 1px rgba(255,255,255,0.07), 0 8px 32px rgba(0,0,0,0.55)",
    background: "#fff",
  };

  const iconBtn: React.CSSProperties = {
    padding: "5px 7px", borderRadius: 5, background: "transparent",
    border: "1px solid var(--atlas-border)", color: "var(--atlas-muted)",
    fontSize: 11, cursor: "pointer", flexShrink: 0, lineHeight: 1,
    opacity: 0.7, transition: "opacity 160ms ease",
  };

  // Scroll-collapse the URL chrome when user scrolls the panel
  useEffect(() => {
    const el = containerRef.current;
    if (!el || previewMode !== "url") return;
    const onScroll = () => {
      const top = el.scrollTop;
      if (top > 8) { setChromeVisible(false); setStatusVisible(false); }
      else setChromeVisible(true);
    };
    el.addEventListener("scroll", onScroll, { passive: true });
    return () => el.removeEventListener("scroll", onScroll);
  }, [previewMode, liveUrl]);

  // Reveal Row 2 whenever new status data arrives
  useEffect(() => {
    if (autoDetected || savedIndicator || detectResults.length > 0) setStatusVisible(true);
  }, [autoDetected, savedIndicator, detectResults.length]);

  // Auto-hide Row 2 after 4s
  useEffect(() => {
    if (!statusVisible) return;
    const t = window.setTimeout(() => setStatusVisible(false), 4000);
    return () => window.clearTimeout(t);
  }, [statusVisible, autoDetected, savedIndicator, detectResults.length]);

  return (
    <div style={{ flex: 1, display: "flex", flexDirection: "column", overflow: "hidden" }}>

      {/* Mode toggle */}
      <div style={{ display: "flex", borderBottom: "1px solid var(--atlas-border)", flexShrink: 0 }}>
        {(["url", "sandbox", "stackblitz"] as const).map((m) => (
          <button
            key={m}
            onClick={() => setPreviewMode(m)}
            style={{
              flex: 1, padding: "7px 0", background: "transparent", border: "none",
              borderBottom: previewMode === m ? "2px solid var(--atlas-gold)" : "2px solid transparent",
              color: previewMode === m ? "var(--atlas-gold)" : "var(--atlas-muted)",
              fontSize: 9, fontFamily: "var(--app-font-mono)", letterSpacing: "0.08em",
              textTransform: "uppercase", cursor: "pointer",
              opacity: previewMode === m ? 1 : 0.45,
              transition: "all 140ms ease",
            }}
          >
            {m === "url" ? "Live URL" : m === "sandbox" ? "Sandbox" : "StackBlitz"}
          </button>
        ))}
      </div>

      {/* Device switcher — Sandbox mode uses same popover dropdown as URL mode */}
      {previewMode === "sandbox" && (
        <div style={{ display: "flex", alignItems: "center", gap: 5, padding: "5px 8px", borderBottom: "1px solid var(--atlas-border)", flexShrink: 0, position: "relative", zIndex: 5 }}>
          <div style={{ flex: 1 }} />
          {/* Device popover (mirrors URL mode) */}
          <div style={{ flexShrink: 0 }}>
            <button ref={deviceBtnRef} onClick={() => setDeviceMenuOpen((v) => !v)} title="Device size"
              style={{ ...iconBtn, padding: "5px 8px", display: "inline-flex", alignItems: "center", gap: 4, ...sMono }}>
              <span style={{ fontSize: 9.5, letterSpacing: "0.04em", textTransform: "capitalize" }}>{deviceSize}</span>
              <span style={{ fontSize: 8, opacity: 0.7 }}>▾</span>
            </button>
          </div>

        </div>
      )}


      {/* ── URL mode ── */}
      {previewMode === "url" && (
        <>
          {/* Hairline pull-tab — only when chrome is hidden */}
          {!chromeVisible && (
            <button
              onClick={() => setChromeVisible(true)}
              aria-label="Show preview chrome"
              title="Show toolbar"
              style={{
                position: "relative", width: "100%", height: 4, padding: 0,
                border: "none", cursor: "pointer", flexShrink: 0,
                background: "linear-gradient(90deg, transparent, rgba(201,162,76,0.6), transparent)",
              }}
            />
          )}

          {/* Chrome wrapper (Row 1 + Row 2) — slides up on collapse */}
          <div
            style={{
              overflow: "hidden",
              maxHeight: chromeVisible ? 200 : 0,
              opacity: chromeVisible ? 1 : 0,
              transition: "max-height 240ms cubic-bezier(.32,.72,0,1), opacity 200ms ease",
              flexShrink: 0,
              borderBottom: chromeVisible ? "1px solid var(--atlas-border)" : "none",
            }}
          >
            {/* Row 1 — unified browser bar */}
            <div style={{ display: "flex", gap: 5, alignItems: "center", padding: "7px 10px" }}>
              <div style={{ position: "relative", flex: 1, display: "flex", alignItems: "center", minWidth: 0 }}>
                <svg width="11" height="11" viewBox="0 0 16 16" fill="none" style={{ position: "absolute", left: 8, opacity: 0.3, pointerEvents: "none" }}>
                  <circle cx="8" cy="8" r="6" stroke="var(--atlas-fg)" strokeWidth="1.4" />
                  <path d="M8 2c-2 3-2 9 0 12M2 8h12" stroke="var(--atlas-fg)" strokeWidth="1.2" strokeLinecap="round" />
                </svg>
                <input
                  value={urlInput}
                  onChange={(e) => setUrlInput(e.target.value)}
                  onKeyDown={(e) => e.key === "Enter" && handleGo()}
                  placeholder="Paste deployment URL…"
                  style={{
                    width: "100%", paddingLeft: 26, paddingRight: 8, paddingTop: 5, paddingBottom: 5,
                    borderRadius: 5, background: "var(--atlas-surface)",
                    border: "1px solid var(--atlas-border)",
                    color: "var(--atlas-fg)", fontSize: 10.5, ...sMono, outline: "none",
                    transition: "border-color 160ms ease",
                  }}
                  onFocus={(e) => (e.currentTarget.style.borderColor = "rgba(201,162,76,0.35)")}
                  onBlur={(e) => (e.currentTarget.style.borderColor = "var(--atlas-border)")}
                />
              </div>
              <button onClick={handleGo} style={{
                padding: "5px 10px", borderRadius: 5, background: "var(--atlas-ember)",
                border: "none", color: "var(--atlas-fg)", fontSize: 10, ...sMono,
                letterSpacing: "0.08em", cursor: "pointer", flexShrink: 0,
              }}>Go</button>

              {liveUrl && (
                <>
                  <button
                    onClick={() => { setIframeError(false); setIframeLoading(true); setReloadKey((k) => k + 1); }}
                    title="Reload" aria-label="Reload preview"
                    style={iconBtn}
                  >↺</button>
                  <a href={liveUrl} target="_blank" rel="noopener noreferrer" title="Open in new tab"
                    style={{ ...iconBtn, textDecoration: "none", display: "inline-flex", alignItems: "center", justifyContent: "center", ...sMono }}
                  >↗</a>
                </>
              )}

              {/* Device popover */}
              <div style={{ flexShrink: 0 }}>
                <button ref={deviceBtnRef} onClick={() => setDeviceMenuOpen((v) => !v)} title="Device size"
                  style={{ ...iconBtn, padding: "5px 8px", display: "inline-flex", alignItems: "center", gap: 4, ...sMono }}>
                  <span style={{ fontSize: 9.5, letterSpacing: "0.04em", textTransform: "capitalize" }}>{deviceSize}</span>
                  <span style={{ fontSize: 8, opacity: 0.7 }}>▾</span>
                </button>
              </div>


              {/* Fullscreen / hide chrome */}
              <button onClick={() => { if (isMobile && liveUrl) setMobileFullscreen(true); else setChromeVisible((v) => !v); }}
                title={isMobile ? "Fullscreen" : (chromeVisible ? "Hide toolbar" : "Show toolbar")}
                aria-label="Toggle fullscreen preview"
                style={iconBtn}>⛶</button>

              {liveUrl && (
                <button onClick={handleClear} title="Clear" aria-label="Clear preview"
                  style={{ ...iconBtn, fontSize: 13, opacity: 0.5 }}>×</button>
              )}
            </div>

            {/* Row 2 — status strip (auto-hides after 4s) */}
            {(autoDetected || (linkedRepo && token) || detectResults.length > 0 || (liveUrl && !autoDetected)) && (
              <div style={{
                overflow: "visible",
                maxHeight: statusVisible ? 40 : 0,
                opacity: statusVisible ? 1 : 0,
                transition: "max-height 240ms cubic-bezier(.32,.72,0,1), opacity 200ms ease",
              }}>
                <div style={{ display: "flex", gap: 6, alignItems: "center", padding: "0 10px 7px", flexWrap: "nowrap" }}>
                  {autoDetected ? (
                    <div style={{ display: "flex", alignItems: "center", gap: 5, padding: "3px 8px", borderRadius: 4, background: "rgba(134,239,172,0.06)", border: "1px solid rgba(134,239,172,0.18)", flexShrink: 0 }}>
                      <span style={{ fontSize: 8, color: "rgba(134,239,172,0.7)" }}>✓</span>
                      <span style={{ fontSize: 9, ...sMono, color: "rgba(134,239,172,0.75)", letterSpacing: "0.06em" }}>Auto-detected · {autoDetected.platform}</span>
                      <button onClick={(e) => { e.stopPropagation(); setAutoDetected(null); autoDetectTriedRef.current = null; handleDetect(); setStatusVisible(true); }}
                        title="Re-run detection"
                        style={{ background: "transparent", border: "none", color: "rgba(134,239,172,0.45)", cursor: "pointer", fontSize: 10, padding: "0 0 0 3px", lineHeight: 1 }}>↺</button>
                    </div>
                  ) : linkedRepo && token ? (
                    <button onClick={() => { handleDetect(); setStatusVisible(true); }} disabled={detecting}
                      style={{ padding: "3px 9px", borderRadius: 4, fontSize: 9.5, ...sMono, letterSpacing: "0.08em", background: detecting ? "var(--atlas-glass-bg)" : "rgba(201,162,76,0.08)", border: "1px solid rgba(201,162,76,0.2)", color: detecting ? "var(--atlas-muted)" : "var(--atlas-gold)", cursor: detecting ? "not-allowed" : "pointer", flexShrink: 0 }}>
                      {detecting ? "Detecting…" : "Auto-detect URL"}
                    </button>
                  ) : null}

                  {detectResults.length > 0 && (
                    <div style={{ position: "relative", flexShrink: 0 }}>
                      <button onClick={() => setDetectMenuOpen((v) => !v)}
                        style={{ padding: "3px 9px", borderRadius: 4, fontSize: 9.5, ...sMono, letterSpacing: "0.08em", background: "var(--atlas-glass-bg)", border: "1px solid var(--atlas-border)", color: "var(--atlas-muted)", cursor: "pointer" }}>
                        {detectResults.length} suggestion{detectResults.length === 1 ? "" : "s"} ▾
                      </button>
                      {detectMenuOpen && (
                        <>
                          <div onClick={() => setDetectMenuOpen(false)} style={{ position: "fixed", inset: 0, zIndex: 40 }} />
                          <div style={{ position: "absolute", top: "calc(100% + 4px)", left: 0, zIndex: 41, background: "var(--atlas-surface)", border: "1px solid var(--atlas-border)", borderRadius: 6, padding: 4, minWidth: 240, boxShadow: "0 10px 30px rgba(0,0,0,0.35)" }}>
                            {detectResults.slice(0, 6).map((r) => (
                              <button key={r.url} onClick={() => { applyUrl(r.url); setDetectResults([]); setDetectMenuOpen(false); setStatusVisible(true); }}
                                style={{ display: "flex", alignItems: "center", gap: 7, padding: "5px 7px", borderRadius: 4, width: "100%", textAlign: "left", background: "transparent", border: "none", cursor: "pointer" }}>
                                <span style={{ fontSize: 8.5, ...sMono, color: platformColor(r.platform), opacity: 0.9, flexShrink: 0 }}>{r.platform}</span>
                                {r.confidence === "high" && <span style={{ fontSize: 7.5, ...sMono, color: "rgba(134,239,172,0.7)", flexShrink: 0 }}>✓</span>}
                                <span style={{ flex: 1, fontSize: 9.5, ...sMono, color: "var(--atlas-fg)", opacity: 0.7, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{r.url}</span>
                              </button>
                            ))}
                          </div>
                        </>
                      )}
                    </div>
                  )}

                  {liveUrl && (
                    <button onClick={() => { handleSaveToProject(); setStatusVisible(true); }} disabled={savedIndicator || updateProject.isPending || !!autoDetected}
                      style={{ marginLeft: "auto", padding: "3px 9px", borderRadius: 4, fontSize: 9.5, ...sMono, letterSpacing: "0.08em", background: (savedIndicator || autoDetected) ? "rgba(34,197,94,0.08)" : "var(--atlas-glass-bg)", border: `1px solid ${(savedIndicator || autoDetected) ? "rgba(34,197,94,0.2)" : "var(--atlas-border)"}`, color: (savedIndicator || autoDetected) ? "rgba(134,239,172,0.8)" : "var(--atlas-muted)", cursor: (savedIndicator || autoDetected) ? "default" : "pointer", flexShrink: 0, transition: "all 160ms ease" }}>
                      {savedIndicator || autoDetected ? "✓ Saved" : project?.previewUrl === liveUrl ? "Saved" : "Save to project"}
                    </button>
                  )}
                </div>
              </div>
            )}
          </div>

          <div ref={containerRef} style={{ flex: 1, display: "flex", flexDirection: "column", overflow: "hidden" }}>
          {liveUrl && !iframeError ? (
            <div style={deviceWrapperStyle}>
              <div style={deviceInnerStyle}>
                {iframeLoading && (
                  <div style={{ position: "absolute", inset: 0, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", gap: 10, background: "var(--atlas-bg)", zIndex: 2 }}>
                    <LoadingSpinner size="sm" color="atlas" />
                    <div style={{ fontSize: 9.5, ...sMono, color: "var(--atlas-muted)", opacity: 0.4 }}>Loading preview…</div>
                  </div>
                )}
                <iframe key={`${liveUrl}-${reloadKey}`} src={liveUrl} title="Preview"
                  style={{ border: "none", width: "100%", height: "100%", display: "block", background: "#fff" }}
                  sandbox="allow-scripts allow-same-origin allow-forms allow-popups allow-popups-to-escape-sandbox"
                  onLoad={() => setIframeLoading(false)}
                  onError={() => { setIframeError(true); setIframeLoading(false); }}
                />
              </div>
            </div>
          ) : iframeError ? (
            <div style={{ flex: 1, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", padding: "32px 20px", gap: 12 }}>
              <svg width="24" height="24" viewBox="0 0 24 24" fill="none" opacity={0.18}><circle cx="12" cy="12" r="9" stroke="var(--atlas-fg)" strokeWidth="1.4" /><path d="M12 8v4M12 16h.01" stroke="var(--atlas-fg)" strokeWidth="1.5" strokeLinecap="round" /></svg>
              <div style={{ fontSize: 11.5, color: "var(--atlas-muted)", opacity: 0.5, textAlign: "center", lineHeight: 1.7 }}>This site blocks embedding.<br />Use the arrow to open it in a new tab.</div>
              <a href={liveUrl} target="_blank" rel="noopener noreferrer" style={{ padding: "6px 14px", borderRadius: 5, fontSize: 10, ...sMono, background: "rgba(201,162,76,0.1)", border: "1px solid rgba(201,162,76,0.25)", color: "var(--atlas-gold)", textDecoration: "none", letterSpacing: "0.08em" }}>Open in new tab ↗</a>
            </div>
          ) : (
            <div style={{ flex: 1, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", padding: "32px 20px", gap: 12 }}>
              <svg width="28" height="28" viewBox="0 0 28 28" fill="none" opacity={0.12}><rect x="2" y="5" width="24" height="18" rx="2" stroke="var(--atlas-fg)" strokeWidth="1.5" /><path d="M2 10h24" stroke="var(--atlas-fg)" strokeWidth="1.5" /><circle cx="6" cy="7.5" r="1" fill="var(--atlas-fg)" /><circle cx="10" cy="7.5" r="1" fill="var(--atlas-fg)" /></svg>
              <div style={{ fontSize: 11.5, color: "var(--atlas-muted)", opacity: 0.4, textAlign: "center", lineHeight: 1.8 }}>
                {detecting
                  ? <>Searching for your live deployment…</>
                  : linkedRepo
                    ? <>Click <strong style={{ color: "var(--atlas-gold)", opacity: 0.8, fontWeight: 500 }}>Auto-detect URL</strong> to find<br />your live deployment automatically.</>
                    : <>Paste your deployment URL above,<br />or link a GitHub repo in Files<br />to auto-detect it.</>
                }
              </div>
              <div style={{ fontSize: 10, color: "var(--atlas-muted)", opacity: 0.25, textAlign: "center", lineHeight: 1.7, marginTop: 4, fontFamily: "var(--app-font-mono)" }}>
                This tab previews your live app URL.<br />To browse code files, use the Files tab.
              </div>
            </div>
          )}
          </div>

          {/* Mobile fullscreen portal */}
          {mobileFullscreen && liveUrl && typeof document !== "undefined" && createPortal(
            <div style={{
              position: "fixed", inset: 0, zIndex: 99999, background: "#000",
              display: "flex", flexDirection: "column",
            }}>
              <iframe
                key={`fs-${liveUrl}-${reloadKey}`}
                src={liveUrl}
                title="Preview fullscreen"
                style={{ border: "none", flex: 1, width: "100%", background: "#fff" }}
                sandbox="allow-scripts allow-same-origin allow-forms allow-popups allow-popups-to-escape-sandbox"
              />
              <button
                onClick={() => setMobileFullscreen(false)}
                aria-label="Exit fullscreen"
                style={{
                  position: "fixed",
                  top: "calc(env(safe-area-inset-top, 0px) + 12px)",
                  right: "calc(env(safe-area-inset-right, 0px) + 12px)",
                  zIndex: 100000,
                  padding: "8px 14px", borderRadius: 999,
                  background: "rgba(0,0,0,0.65)", backdropFilter: "blur(10px)",
                  border: "1px solid rgba(201,162,76,0.35)",
                  color: "var(--atlas-gold, #c9a24c)",
                  fontSize: 12, fontFamily: "var(--app-font-mono)",
                  letterSpacing: "0.08em", cursor: "pointer",
                  display: "inline-flex", alignItems: "center", gap: 6,
                  boxShadow: "0 4px 16px rgba(0,0,0,0.4)",
                }}
              >
                <span style={{ fontSize: 14, lineHeight: 1 }}>✕</span>
                <span>EXIT</span>
              </button>
            </div>,
            document.body
          )}
        </>
      )}

      {/* ── Sandbox mode ── */}
      {previewMode === "sandbox" && (
        <div style={{ flex: 1, display: "flex", flexDirection: "column", overflow: "hidden" }}>
          {/* Code input area */}
          <div style={{ flexShrink: 0, borderBottom: "1px solid var(--atlas-border)" }}>
            <div style={{ display: "flex", alignItems: "center", gap: 6, padding: "5px 8px 0" }}>
              <button
                onClick={() => setSandboxExpanded((v) => !v)}
                style={{ display: "flex", alignItems: "center", gap: 4, background: "transparent", border: "none", cursor: "pointer", color: "var(--atlas-muted)", fontSize: 9.5, fontFamily: "var(--app-font-mono)", letterSpacing: "0.05em", padding: "0 2px", opacity: 0.65 }}
              >
                <svg width="9" height="9" viewBox="0 0 9 9" fill="none" style={{ transition: "transform 140ms ease", transform: sandboxExpanded ? "rotate(90deg)" : "rotate(0deg)" }}>
                  <path d="M2 1.5L6 4.5L2 7.5" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round" />
                </svg>
                {sandboxExpanded ? "Hide code" : "Edit code"}
              </button>
              <div style={{ flex: 1 }} />
              {sandboxRendered && (
                <button
                  onClick={() => { setSandboxInput(""); setSandboxRendered(null); setSandboxExpanded(true); }}
                  style={{ padding: "2px 7px", borderRadius: 4, background: "transparent", border: "1px solid var(--atlas-border)", color: "var(--atlas-muted)", fontSize: 9, fontFamily: "var(--app-font-mono)", cursor: "pointer", opacity: 0.45, transition: "opacity 140ms ease" }}
                  onMouseEnter={(e) => (e.currentTarget.style.opacity = "0.9")}
                  onMouseLeave={(e) => (e.currentTarget.style.opacity = "0.45")}
                >Clear</button>
              )}
            </div>
            {sandboxExpanded && (
              <div style={{ padding: "6px 8px 8px" }}>
                <textarea
                  value={sandboxInput}
                  onChange={(e) => setSandboxInput(e.target.value)}
                  placeholder="Paste HTML, CSS, or any component here…"
                  rows={6}
                  style={{
                    width: "100%", resize: "vertical", background: "var(--atlas-surface)",
                    border: "1px solid var(--atlas-border)", borderRadius: 6,
                    color: "var(--atlas-fg)", fontSize: 10.5, fontFamily: "var(--app-font-mono)",
                    lineHeight: 1.6, padding: "7px 9px", outline: "none",
                    transition: "border-color 160ms ease", boxSizing: "border-box",
                  }}
                  onFocus={(e) => (e.currentTarget.style.borderColor = "rgba(201,162,76,0.35)")}
                  onBlur={(e) => (e.currentTarget.style.borderColor = "var(--atlas-border)")}
                />
                <div style={{ display: "flex", alignItems: "center", gap: 6, marginTop: 6 }}>
                  <button
                    onClick={() => { if (sandboxInput.trim()) { setSandboxRendered(buildSrcdoc(sandboxInput)); setSandboxExpanded(false); } }}
                    disabled={!sandboxInput.trim()}
                    style={{ padding: "5px 12px", borderRadius: 5, background: sandboxInput.trim() ? "var(--atlas-ember)" : "var(--atlas-glass-bg)", border: "none", color: sandboxInput.trim() ? "var(--atlas-fg)" : "var(--atlas-muted)", fontSize: 10, fontFamily: "var(--app-font-mono)", letterSpacing: "0.08em", cursor: sandboxInput.trim() ? "pointer" : "not-allowed", transition: "all 140ms ease" }}
                  >Render</button>
                  <span style={{ fontSize: 9, fontFamily: "var(--app-font-mono)", color: "var(--atlas-muted)", opacity: 0.28 }}>React + HTML · Tailwind included</span>
                </div>
              </div>
            )}
          </div>
          {/* Sandbox preview area */}
          <div ref={containerRef} style={{ flex: 1, display: "flex", flexDirection: "column", overflow: "hidden" }}>
            {sandboxRendered ? (
              <div style={deviceWrapperStyle}>
                <div style={deviceInnerStyle}>
                  <iframe
                    key={sandboxRendered.slice(0, 80)}
                    srcDoc={sandboxRendered}
                    title="Sandbox Preview"
                    sandbox="allow-scripts allow-same-origin"
                    style={{ border: "none", width: "100%", height: "100%", display: "block", background: "#fff" }}
                  />
                </div>
              </div>
            ) : (
              <div style={{ flex: 1, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", padding: "32px 20px", gap: 12 }}>
                <svg width="28" height="28" viewBox="0 0 24 24" fill="none" opacity={0.12}>
                  <path d="M8 6l-6 6 6 6M16 6l6 6-6 6" stroke="var(--atlas-fg)" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
                </svg>
                <div style={{ fontSize: 11.5, color: "var(--atlas-muted)", opacity: 0.4, textAlign: "center", lineHeight: 1.8 }}>
                  Paste any HTML or React component above<br />and hit <strong style={{ color: "var(--atlas-gold)", opacity: 0.8, fontWeight: 500 }}>Render</strong> to preview it.
                </div>
                <div style={{ fontSize: 9.5, color: "var(--atlas-muted)", opacity: 0.22, textAlign: "center", lineHeight: 1.7, fontFamily: "var(--app-font-mono)" }}>
                  Or tap Preview on any code block in the chat<br />to send it here instantly.
                </div>
              </div>
            )}
          </div>
        </div>
      )}

      {previewMode === "generated" && generatedPreviewUrl && (
        <div style={{ flex: 1, display: "flex", flexDirection: "column", overflow: "hidden" }}>
          <div style={{ flexShrink: 0, display: "flex", alignItems: "center", gap: 8, padding: "5px 10px", borderBottom: "1px solid var(--atlas-border)", background: "var(--atlas-surface)" }}>
            <span style={{ display: "inline-flex", alignItems: "center", gap: 5, fontSize: 9.5, fontFamily: "var(--app-font-mono)", color: "var(--atlas-gold)", letterSpacing: "0.05em" }}>
              <span style={{ width: 6, height: 6, borderRadius: "50%", background: "var(--atlas-gold)", display: "inline-block", boxShadow: "0 0 6px rgba(201,162,76,0.5)" }} />
              Atlas Generated
            </span>
            <div style={{ flex: 1 }} />
            <button
              onClick={() => setPreviewMode("url")}
              style={{ background: "transparent", border: "none", cursor: "pointer", padding: "2px 6px", color: "var(--atlas-muted)", fontSize: 10, fontFamily: "var(--app-font-mono)", borderRadius: 4, opacity: 0.55, transition: "opacity 140ms" }}
              onMouseEnter={e => (e.currentTarget.style.opacity = "1")}
              onMouseLeave={e => (e.currentTarget.style.opacity = "0.55")}
            >
              Back to URL
            </button>
          </div>
          <div style={{ flex: 1, position: "relative" }}>
            <iframe
              key={generatedPreviewUrl}
              src={generatedPreviewUrl}
              title="Atlas Preview"
              sandbox="allow-scripts allow-same-origin"
              style={{ border: "none", width: "100%", height: "100%", display: "block", background: "var(--atlas-bg)" }}
            />
          </div>
        </div>
      )}

      {/* ── StackBlitz mode ── */}
      {previewMode === "stackblitz" && (
        <div style={{ flex: 1, display: "flex", flexDirection: "column", overflow: "hidden" }}>
          {!linkedRepo ? (
            <div style={{ flex: 1, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", padding: "32px 20px", gap: 12 }}>
              <svg width="26" height="26" viewBox="0 0 24 24" fill="none" opacity={0.12}>
                <path d="M9 19c-5 1.5-5-2.5-7-3m14 6v-3.87a3.37 3.37 0 0 0-.94-2.61c3.14-.35 6.44-1.54 6.44-7A5.44 5.44 0 0 0 20 4.77 5.07 5.07 0 0 0 19.91 1S18.73.65 16 2.48a13.38 13.38 0 0 0-7 0C6.27.65 5.09 1 5.09 1A5.07 5.07 0 0 0 5 4.77a5.44 5.44 0 0 0-1.5 3.78c0 5.42 3.3 6.61 6.44 7A3.37 3.37 0 0 0 9 18.13V22" stroke="var(--atlas-fg)" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
              </svg>
              <div style={{ fontSize: 11.5, color: "var(--atlas-muted)", opacity: 0.4, textAlign: "center", lineHeight: 1.8 }}>
                Link a GitHub repo in the{" "}
                <button
                  type="button"
                  onClick={() => onSwitchToFiles?.()}
                  style={{ background: "none", border: "none", padding: 0, color: "var(--atlas-gold)", opacity: 0.9, fontWeight: 600, cursor: "pointer", textDecoration: "underline", textUnderlineOffset: 3, font: "inherit" }}
                >
                  Files
                </button>{" "}
                tab to open it in StackBlitz.
              </div>
            </div>
          ) : (
            <div style={{ flex: 1, display: "flex", flexDirection: "column", overflow: "hidden", position: "relative" }}>
              {/* Top bar */}
              <div style={{ flexShrink: 0, display: "flex", alignItems: "center", gap: 8, padding: "5px 10px", borderBottom: "1px solid var(--atlas-border)", background: "var(--atlas-surface)" }}>
                <span style={{ display: "inline-flex", alignItems: "center", gap: 5, fontSize: 9.5, fontFamily: "var(--app-font-mono)", color: "rgba(52,211,153,0.8)", letterSpacing: "0.05em" }}>
                  <span style={{ width: 6, height: 6, borderRadius: "50%", background: "rgba(52,211,153,0.8)", display: "inline-block", boxShadow: "0 0 6px rgba(52,211,153,0.5)" }} />
                  StackBlitz · {linkedRepo.fullName}
                </span>
                <div style={{ flex: 1 }} />
                <a
                  href={`https://github.com/${linkedRepo.fullName}`}
                  target="_blank"
                  rel="noopener noreferrer"
                  style={{ fontSize: 9.5, fontFamily: "var(--app-font-mono)", color: "var(--atlas-muted)", opacity: 0.55, textDecoration: "none", letterSpacing: "0.04em", transition: "opacity 140ms" }}
                  onMouseEnter={e => (e.currentTarget.style.opacity = "1")}
                  onMouseLeave={e => (e.currentTarget.style.opacity = "0.55")}
                >
                  GitHub →
                </a>
              </div>
              <iframe
                key={linkedRepo.fullName}
                src={`https://stackblitz.com/github/${linkedRepo.fullName}?embed=1&theme=dark&terminalHeight=0&hideNavigation=0`}
                title={`StackBlitz — ${linkedRepo.fullName}`}
                style={{ flex: 1, border: "none", width: "100%", height: "100%", display: "block" }}
                allow="cross-origin-isolated"
              />
            </div>
          )}
        </div>
      )}
      {/* Shared device popover — portaled so it floats above iframes and isn't clipped */}
      {deviceMenuOpen && deviceMenuPos && typeof document !== "undefined" && createPortal(
        <>
          <div onClick={() => setDeviceMenuOpen(false)} style={{ position: "fixed", inset: 0, zIndex: 9998 }} />
          <div style={{
            position: "fixed", top: deviceMenuPos.top, right: deviceMenuPos.right, zIndex: 9999,
            background: "var(--atlas-surface)", border: "1px solid var(--atlas-border)",
            borderRadius: 6, padding: 4, minWidth: 140,
            boxShadow: "0 10px 30px rgba(0,0,0,0.5)",
          }}>
            {(["phone", "tablet", "desktop"] as const).map((d) => (
              <button key={d} onClick={() => { setDeviceSize(d); setDeviceMenuOpen(false); }}
                style={{ display: "flex", alignItems: "center", width: "100%", padding: "6px 8px", gap: 8, background: deviceSize === d ? "rgba(201,162,76,0.10)" : "transparent", border: "none", borderRadius: 4, color: deviceSize === d ? "var(--atlas-gold)" : "var(--atlas-fg)", fontSize: 10, ...sMono, letterSpacing: "0.05em", cursor: "pointer", textTransform: "capitalize", textAlign: "left" }}>
                {d}
              </button>
            ))}
            <div style={{ height: 1, background: "var(--atlas-border)", margin: "4px 2px" }} />
            <button onClick={() => { setIsLandscape((l) => !l); setDeviceMenuOpen(false); }}
              style={{ display: "flex", alignItems: "center", width: "100%", padding: "6px 8px", gap: 8, background: "transparent", border: "none", borderRadius: 4, color: "var(--atlas-muted)", fontSize: 10, ...sMono, letterSpacing: "0.05em", cursor: "pointer", textAlign: "left" }}>
              {isLandscape ? "→ Portrait" : "→ Landscape"}
            </button>
          </div>
        </>,
        document.body
      )}
    </div>
  );
}
