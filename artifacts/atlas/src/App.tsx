import { useState, useEffect } from "react";
import { Switch, Route, Router as WouterRouter, useLocation } from "wouter";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { Toaster } from "@/components/ui/toaster";
import { TooltipProvider } from "@/components/ui/tooltip";
import NotFound from "@/pages/not-found";

import Home from "./pages/home";
import Projects from "./pages/projects";
import Workspace from "./pages/workspace";
import Ledger from "./pages/ledger";

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      retry: 1,
      refetchOnWindowFocus: false,
    },
  },
});

function useIsMobile() {
  const [mob, setMob] = useState(() => window.innerWidth < 768);
  useEffect(() => {
    const h = () => setMob(window.innerWidth < 768);
    window.addEventListener("resize", h);
    return () => window.removeEventListener("resize", h);
  }, []);
  return mob;
}

// ── Mini Profile Panel (used from the footer YOU button) ──────────────────────
function MiniProfilePanel({ onClose }: { onClose: () => void }) {
  const [name, setName] = useState(() => {
    try { const r = localStorage.getItem("atlas-user-profile"); return r ? JSON.parse(r).name ?? "" : ""; } catch { return ""; }
  });
  const [photoUrl, setPhotoUrl] = useState(() => {
    try { const r = localStorage.getItem("atlas-user-profile"); return r ? JSON.parse(r).photoUrl ?? "" : ""; } catch { return ""; }
  });
  const [saved, setSaved] = useState(false);

  const save = () => {
    try {
      const raw = localStorage.getItem("atlas-user-profile");
      const existing = raw ? JSON.parse(raw) : {};
      localStorage.setItem("atlas-user-profile", JSON.stringify({ ...existing, name, photoUrl }));
    } catch {}
    setSaved(true);
    setTimeout(() => { setSaved(false); onClose(); }, 700);
  };

  const sMono: React.CSSProperties = { fontFamily: "var(--app-font-mono)" };

  return (
    <div style={{ position: "fixed", inset: 0, zIndex: 200, display: "flex", alignItems: "flex-end", justifyContent: "center" }}>
      <div onClick={onClose} style={{ position: "absolute", inset: 0, background: "rgba(0,0,0,0.55)", backdropFilter: "blur(4px)" }} />
      <div style={{
        position: "relative", zIndex: 1, width: "100%", maxWidth: 460,
        background: "var(--atlas-surface)", borderRadius: "16px 16px 0 0",
        borderTop: "1px solid var(--atlas-border)",
        padding: "20px 20px 32px", display: "flex", flexDirection: "column", gap: 14,
        boxShadow: "0 -8px 40px rgba(0,0,0,0.5)",
      }}>
        {/* Handle */}
        <div style={{ width: 36, height: 4, borderRadius: 2, background: "rgba(255,255,255,0.12)", margin: "0 auto 4px" }} />
        <div style={{ fontSize: 12, ...sMono, letterSpacing: "0.1em", color: "var(--atlas-fg)", opacity: 0.7 }}>YOUR PROFILE</div>

        {/* Photo preview */}
        {photoUrl && (
          <div style={{ display: "flex", justifyContent: "center" }}>
            <img src={photoUrl} alt="" style={{ width: 56, height: 56, borderRadius: "50%", objectFit: "cover", border: "2px solid rgba(201,162,76,0.3)" }} />
          </div>
        )}

        <div style={{ display: "flex", flexDirection: "column", gap: 5 }}>
          <label style={{ fontSize: 9, ...sMono, letterSpacing: "0.1em", color: "var(--atlas-muted)", opacity: 0.55, textTransform: "uppercase" }}>Name</label>
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="Your name"
            style={{ padding: "8px 10px", borderRadius: 6, background: "rgba(12,10,9,0.7)", border: "1px solid var(--atlas-border)", color: "var(--atlas-fg)", fontSize: 13, outline: "none", ...sMono }}
            onFocus={(e) => (e.currentTarget.style.borderColor = "rgba(201,162,76,0.35)")}
            onBlur={(e) => (e.currentTarget.style.borderColor = "var(--atlas-border)")}
          />
        </div>
        <div style={{ display: "flex", flexDirection: "column", gap: 5 }}>
          <label style={{ fontSize: 9, ...sMono, letterSpacing: "0.1em", color: "var(--atlas-muted)", opacity: 0.55, textTransform: "uppercase" }}>Photo URL</label>
          <input
            value={photoUrl}
            onChange={(e) => setPhotoUrl(e.target.value)}
            placeholder="https://… your Google profile photo URL"
            style={{ padding: "8px 10px", borderRadius: 6, background: "rgba(12,10,9,0.7)", border: "1px solid var(--atlas-border)", color: "var(--atlas-fg)", fontSize: 11, outline: "none", ...sMono }}
            onFocus={(e) => (e.currentTarget.style.borderColor = "rgba(201,162,76,0.35)")}
            onBlur={(e) => (e.currentTarget.style.borderColor = "var(--atlas-border)")}
          />
          <div style={{ fontSize: 9, ...sMono, color: "var(--atlas-muted)", opacity: 0.4 }}>Right-click your Google profile photo → "Copy image address"</div>
        </div>

        <button
          onClick={save}
          style={{
            marginTop: 4, padding: "11px", borderRadius: 8, border: "none",
            background: saved ? "rgba(52,211,153,0.15)" : "var(--atlas-ember)",
            color: saved ? "#34d399" : "var(--atlas-fg)",
            fontSize: 11, ...sMono, letterSpacing: "0.1em", textTransform: "uppercase", cursor: "pointer",
          }}
        >
          {saved ? "Saved ✓" : "Save"}
        </button>
      </div>
    </div>
  );
}

// ── Mobile Footer ─────────────────────────────────────────────────────────────
function MobileFooter({ onYou }: { onYou: () => void }) {
  const [location, setLocation] = useLocation();
  const isMobile = useIsMobile();

  if (!isMobile) return null;

  const lastProject = (() => { try { return localStorage.getItem("atlas-last-project") || ""; } catch { return ""; } })();
  const isHome = location === "/" || location === "";
  const isProjects = location.startsWith("/projects");
  const isLedger = location.startsWith("/ledger");
  const isWorkspace = location.startsWith("/project");

  const active = (flag: boolean) => flag ? "rgba(201,162,76,0.9)" : "rgba(120,113,108,0.45)";
  const photoUrl = (() => {
    try { const r = localStorage.getItem("atlas-user-profile"); return r ? JSON.parse(r).photoUrl ?? "" : ""; } catch { return ""; }
  })();

  const navBtn = (content: React.ReactNode, label: string, onClick: () => void, isActive: boolean) => (
    <button
      onClick={onClick}
      style={{
        flex: 1, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center",
        gap: 4, background: "transparent", border: "none", cursor: "pointer", padding: "8px 4px",
        color: active(isActive),
      }}
    >
      {content}
      {label && <span style={{ fontSize: 8.5, fontFamily: "var(--app-font-mono)", letterSpacing: "0.1em", textTransform: "uppercase", color: active(isActive) }}>{label}</span>}
    </button>
  );

  return (
    <div style={{
      position: "fixed", bottom: 0, left: 0, right: 0, zIndex: 150,
      height: 64, display: "flex", alignItems: "center",
      background: "rgba(12,10,9,0.96)", backdropFilter: "blur(20px)",
      borderTop: "1px solid var(--atlas-border)",
      paddingBottom: "env(safe-area-inset-bottom, 0)",
    }}>
      {/* HOME */}
      {navBtn(
        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
          <path d="M3 9l9-7 9 7v11a2 2 0 01-2 2H5a2 2 0 01-2-2z" />
          <polyline points="9,22 9,12 15,12 15,22" />
        </svg>,
        "Home",
        () => setLocation("/"),
        isHome
      )}

      {/* PROJECTS */}
      {navBtn(
        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
          <path d="M22 19a2 2 0 01-2 2H4a2 2 0 01-2-2V5a2 2 0 012-2h5l2 3h9a2 2 0 012 2z" />
        </svg>,
        "Projects",
        () => setLocation("/projects"),
        isProjects
      )}

      {/* CENTER — Atlas */}
      <div style={{ flex: 1, display: "flex", alignItems: "center", justifyContent: "center" }}>
        <button
          onClick={() => setLocation("/")}
          style={{
            width: 52, height: 52, borderRadius: 16,
            background: isHome || isWorkspace ? "var(--atlas-ember)" : "rgba(28,25,23,0.9)",
            border: `1px solid ${isHome || isWorkspace ? "rgba(146,64,14,0.5)" : "rgba(201,162,76,0.2)"}`,
            boxShadow: isHome || isWorkspace ? "0 0 20px -4px rgba(146,64,14,0.6)" : "none",
            display: "flex", alignItems: "center", justifyContent: "center",
            cursor: "pointer", transition: "all 200ms ease",
            marginBottom: 8,
          }}
        >
          <svg width="22" height="22" viewBox="0 0 20 20" fill="none">
            <circle cx="10" cy="10" r="8" stroke="#C9A24C" strokeWidth="1.4" />
            <circle cx="10" cy="10" r="3.2" stroke="#C9A24C" strokeWidth="1" />
            <line x1="10" y1="2" x2="10" y2="18" stroke="#C9A24C" strokeWidth="0.8" strokeDasharray="1.8 2.4" />
            <line x1="2" y1="10" x2="18" y2="10" stroke="#C9A24C" strokeWidth="0.8" strokeDasharray="1.8 2.4" />
          </svg>
        </button>
      </div>

      {/* LEDGER */}
      {navBtn(
        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
          <path d="M4 19.5A2.5 2.5 0 016.5 17H20" />
          <path d="M6.5 2H20v20H6.5A2.5 2.5 0 014 19.5v-15A2.5 2.5 0 016.5 2z" />
          <path d="M9 7h6M9 11h6M9 15h4" strokeWidth="1.2" />
        </svg>,
        "Ledger",
        () => lastProject ? setLocation(`/ledger/${lastProject}`) : setLocation("/"),
        isLedger
      )}

      {/* YOU */}
      <button
        onClick={onYou}
        style={{
          flex: 1, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center",
          gap: 4, background: "transparent", border: "none", cursor: "pointer", padding: "8px 4px",
          color: "rgba(120,113,108,0.45)",
        }}
      >
        {photoUrl ? (
          <img src={photoUrl} alt="" style={{ width: 24, height: 24, borderRadius: "50%", objectFit: "cover", border: "1px solid rgba(201,162,76,0.3)" }} />
        ) : (
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
            <path d="M20 21v-2a4 4 0 00-4-4H8a4 4 0 00-4 4v2" />
            <circle cx="12" cy="7" r="4" />
          </svg>
        )}
        <span style={{ fontSize: 8.5, fontFamily: "var(--app-font-mono)", letterSpacing: "0.1em", textTransform: "uppercase", color: "rgba(120,113,108,0.45)" }}>You</span>
      </button>
    </div>
  );
}

// ── Router ────────────────────────────────────────────────────────────────────
function Router({ onYou }: { onYou: () => void }) {
  return (
    <>
      <Switch>
        <Route path="/" component={Home} />
        <Route path="/projects" component={Projects} />
        <Route path="/project/:projectId" component={Workspace} />
        <Route path="/ledger/:projectId" component={Ledger} />
        <Route component={NotFound} />
      </Switch>
      <MobileFooter onYou={onYou} />
    </>
  );
}

// ── App ───────────────────────────────────────────────────────────────────────
function App() {
  const [profileOpen, setProfileOpen] = useState(false);

  // Apply saved theme on mount
  useEffect(() => {
    try {
      const saved = localStorage.getItem("atlas-theme");
      if (saved === "parchment") {
        document.documentElement.dataset.theme = "parchment";
      }
    } catch {}
  }, []);

  return (
    <QueryClientProvider client={queryClient}>
      <TooltipProvider>
        <WouterRouter base={import.meta.env.BASE_URL.replace(/\/$/, "")}>
          <Router onYou={() => setProfileOpen(true)} />
        </WouterRouter>
        {profileOpen && <MiniProfilePanel onClose={() => setProfileOpen(false)} />}
        <Toaster />
      </TooltipProvider>
    </QueryClientProvider>
  );
}

export default App;
