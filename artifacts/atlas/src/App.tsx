import { useEffect, useRef, useState, Component, type ReactNode } from "react";
import { Switch, Route, Router as WouterRouter, useLocation } from "wouter";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { LoadingSpinner } from "./components/ui/loading-spinner";
import { Toaster } from "@/components/ui/toaster";
import { TooltipProvider } from "@/components/ui/tooltip";
import NotFound from "@/pages/not-found";

import Home from "./pages/home";
import Landing from "./pages/landing";
import Login from "./pages/login";
import Projects from "./pages/projects";
import Workspace from "./pages/workspace";
import Ledger from "./pages/ledger";
import ParkingLot from "./pages/parking-lot";
import EntryDetail from "./pages/entry-detail";
import ThinkFreely from "./pages/think-freely";
import Workshop from "./pages/workshop";
import ProjectCompass from "./pages/project-compass";
import Terms from "./pages/terms";
import Privacy from "./pages/privacy";
import Help from "./pages/help";
import Vault from "./pages/vault";
import Secrets from "./pages/secrets";
import Admin from "./pages/admin";
import Dashboard from "./pages/dashboard";
import ResetPassword from "./pages/reset-password";
import MasterMap from "./pages/master-map";
import OnboardingPage from "./pages/onboarding";
import { getListProjectsQueryKey, useListProjects } from "@workspace/api-client-react";

// ── Global 401 interceptor ────────────────────────────────────────────────────
// Noisy background endpoints — a single 401 here should never boot the user.
const SILENT_401_PATTERNS = ["/api/nexus/activity", "/api/nexus/briefing", "/api/stripe/"];

let _401redirectPending = false;

// When VITE_API_URL is set (e.g. Railway backend URL), all relative /api/
// calls are automatically rewritten to hit that origin. This makes the frontend
// work correctly when deployed to a different domain (Vercel, Netlify, etc.)
// without touching any individual fetch call in the codebase.
const API_BASE = (import.meta.env.VITE_API_URL ?? "").replace(/\/$/, "");

function resolveApiUrl(input: RequestInfo | URL): RequestInfo | URL {
  if (!API_BASE) return input;
  if (typeof input === "string" && input.startsWith("/api/")) return `${API_BASE}${input}`;
  if (input instanceof URL && input.pathname.startsWith("/api/")) return new URL(`${API_BASE}${input.pathname}${input.search}`);
  if (input instanceof Request && new URL(input.url, location.origin).pathname.startsWith("/api/")) {
    return new Request(`${API_BASE}${new URL(input.url, location.origin).pathname}${new URL(input.url, location.origin).search}`, input);
  }
  return input;
}

const _originalFetch = window.fetch.bind(window);
window.fetch = async (...args) => {
  args[0] = resolveApiUrl(args[0]);
  if (API_BASE) {
    const url = typeof args[0] === "string"
      ? args[0]
      : args[0] instanceof URL
        ? args[0].toString()
        : args[0].url;
    const isApiCall = new URL(url, location.origin).pathname.startsWith("/api/");
    if (isApiCall && args[1]?.credentials === undefined) {
      args[1] = { ...(args[1] ?? {}), credentials: "include" };
    }
  }
  const res = await _originalFetch(...args);
  if (res.status === 401) {
    const url = typeof args[0] === "string" ? args[0] : (args[0] as Request).url;
    if (url.includes("/api/") && !url.includes("/api/auth/")) {
      // Skip silent/polling endpoints — they shouldn't boot the user
      const isSilent = SILENT_401_PATTERNS.some((p) => url.includes(p));
      if (!isSilent && !_401redirectPending) {
        _401redirectPending = true;
        // Wait 1.5 s and confirm the session is still gone before redirecting.
        // This prevents transient server hiccups (restart, slow DB) from kicking
        // the user out of a live conversation.
        setTimeout(async () => {
          try {
            const check = await _originalFetch(`${API_BASE}/api/auth/me`, { credentials: "include" });
            if (check.status === 401) {
              const base = import.meta.env.BASE_URL.replace(/\/$/, "");
              window.location.href = `${base}/login?reason=session_expired`;
            } else {
              _401redirectPending = false;
            }
          } catch {
            _401redirectPending = false;
          }
        }, 1500);
      }
    }
  }
  return res;
};

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      retry: 1,
      refetchOnWindowFocus: false,
    },
  },
});

// ── Error Boundary ────────────────────────────────────────────────────────────
interface ErrorBoundaryState { hasError: boolean; message: string }

class ErrorBoundary extends Component<{ children: ReactNode }, ErrorBoundaryState> {
  constructor(props: { children: ReactNode }) {
    super(props);
    this.state = { hasError: false, message: "" };
  }
  static getDerivedStateFromError(err: unknown): ErrorBoundaryState {
    return { hasError: true, message: err instanceof Error ? err.message : String(err) };
  }
  render() {
    if (!this.state.hasError) return this.props.children;
    const mono: React.CSSProperties = { fontFamily: "var(--app-font-mono)" };
    return (
      <div style={{
        position: "fixed", inset: 0, display: "flex", flexDirection: "column",
        alignItems: "center", justifyContent: "center", background: "var(--atlas-bg)",
        padding: "32px 24px", gap: 20,
      }}>
        <div style={{ fontSize: 11, ...mono, letterSpacing: "0.35em", color: "var(--atlas-gold)", opacity: 0.5, textTransform: "uppercase" }}>
          Axiom
        </div>
        <div style={{ fontSize: 22, fontWeight: 300, color: "var(--atlas-fg)", letterSpacing: "0.04em" }}>
          Something went wrong.
        </div>
        <button
          onClick={() => window.location.reload()}
          style={{
            padding: "10px 24px", borderRadius: 9, cursor: "pointer",
            background: "linear-gradient(180deg, #D4AF37 0%, #B8942A 100%)",
            border: "1px solid rgba(212,175,55,0.4)", color: "#0C0A09",
            fontSize: 11, fontWeight: 700, ...mono, letterSpacing: "0.14em", textTransform: "uppercase",
          }}
        >
          Reload
        </button>
        {this.state.message && (
          <p style={{ fontSize: 10, ...mono, color: "var(--atlas-muted)", opacity: 0.4, maxWidth: 480, textAlign: "center", lineHeight: 1.6, marginTop: 8 }}>
            {this.state.message}
          </p>
        )}
      </div>
    );
  }
}


// ── Page Transition Spinner ───────────────────────────────────────────────────
const SKIP_TRANSITION = ["/landing", "/login", "/reset-password"];

function PageTransition() {
  const [location] = useLocation();
  const [visible, setVisible] = useState(false);
  const [opacity, setOpacity] = useState(0);
  const prevLocation = useRef<string | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const show = () => {
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => {
      setOpacity(1);
      setVisible(true);
      timer.current = setTimeout(() => {
        setOpacity(0);
        timer.current = setTimeout(() => setVisible(false), 300);
      }, 400);
    }, 150);
  };

  useEffect(() => {
    // First load
    if (prevLocation.current === null) {
      if (!SKIP_TRANSITION.includes(location)) show();
      prevLocation.current = location;
      return;
    }
    // Route change
    if (prevLocation.current !== location) {
      prevLocation.current = location;
      if (!SKIP_TRANSITION.includes(location)) show();
    }
  }, [location]);

  useEffect(() => () => { if (timer.current) clearTimeout(timer.current); }, []);

  if (!visible) return null;

  return (
    <div style={{
      position: "fixed", inset: 0, zIndex: 99999,
      background: "var(--atlas-bg)",
      display: "flex", flexDirection: "column",
      alignItems: "center", justifyContent: "center", gap: 20,
      opacity, transition: opacity === 0 ? "opacity 350ms ease" : "none",
      pointerEvents: "none",
    }}>
      <LoadingSpinner size="lg" />
      <p style={{
        fontSize: 11, letterSpacing: "0.25em", textTransform: "uppercase",
        color: "rgba(201,162,76,0.5)", fontFamily: "var(--app-font-mono)", margin: 0,
      }}>
        thinking strategically
      </p>
    </div>
  );
}

// ── First-login onboarding redirect ───────────────────────────────────────────
function OnboardingGate() {
  const [location, setLocation] = useLocation();
  const shouldCheck = location !== "/" && !["/landing", "/login", "/reset-password", "/onboarding", "/terms", "/privacy", "/help"].some((path) => location.startsWith(path));
  const { data: projects, isLoading } = useListProjects(undefined, {
    query: { enabled: shouldCheck, queryKey: getListProjectsQueryKey() },
  });

  useEffect(() => {
    if (!shouldCheck || isLoading || !projects) return;
    try {
      const onboardingComplete = localStorage.getItem("axiom_onboarding_complete");
      const hasProjects = projects.length > 0;
      if (!onboardingComplete && !hasProjects) {
        setLocation("/onboarding", { replace: true });
      }
    } catch {}
  }, [isLoading, location, projects, setLocation, shouldCheck]);

  return null;
}

// ── Router ────────────────────────────────────────────────────────────────────
function Router() {
  return (
    <>
      <OnboardingGate />
      <Switch>
        <Route path="/" component={() => {
          const [, nav] = useLocation();
          useEffect(() => {
            const controller = new AbortController();
            const timeout = setTimeout(() => controller.abort(), 4000);
            fetch("/api/auth/me", { credentials: "include", signal: controller.signal })
              .then(r => r.ok ? r.json() : null)
              .then(user => nav(user?.id ? "/home" : "/landing", { replace: true }))
              .catch(() => nav("/landing", { replace: true }))
              .finally(() => clearTimeout(timeout));
          }, []);
          return null;
        }} />
        <Route path="/landing" component={Landing} />
        <Route path="/login" component={Login} />
        <Route path="/reset-password" component={ResetPassword} />
        <Route path="/onboarding" component={OnboardingPage} />
        <Route path="/home" component={Home} />
        <Route path="/projects" component={Projects} />
        <Route path="/project/:projectId" component={Workspace} />
        <Route path="/ledger" component={Ledger} />
        <Route path="/ledger/:projectId" component={Ledger} />
        <Route path="/parking" component={ParkingLot} />
        <Route path="/guard-report" component={() => { const [,nav] = useLocation(); useEffect(() => nav("/compass", { replace: true }), []); return null; }} />
        <Route path="/entry/:id" component={EntryDetail} />
        <Route path="/sessions" component={() => { const [,nav] = useLocation(); useEffect(() => nav("/dashboard", { replace: true }), []); return null; }} />
        <Route path="/think-freely" component={ThinkFreely} />
        <Route path="/workshop" component={Workshop} />
        <Route path="/compass" component={ProjectCompass} />
        <Route path="/terms" component={Terms} />
        <Route path="/privacy" component={Privacy} />
        <Route path="/help" component={Help} />
        <Route path="/vault" component={Vault} />
        <Route path="/secrets" component={Secrets} />
        <Route path="/admin" component={Admin} />
        <Route path="/dashboard" component={Dashboard} />
        <Route path="/map" component={MasterMap} />
        <Route path="/nexus" component={() => { const [,nav] = useLocation(); useEffect(() => nav("/home", { replace: true }), []); return null; }} />
        <Route component={NotFound} />
      </Switch>
    </>
  );
}

// ── App ───────────────────────────────────────────────────────────────────────
function App() {
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
      <div style={{
        position: "fixed", top: 0, left: 0, right: 0, zIndex: 9999,
        background: "#92400E", color: "#000",
        padding: "5px 12px",
        fontSize: 11, fontWeight: 600, textAlign: "center",
        fontFamily: "var(--app-font-mono, monospace)", letterSpacing: "0.04em",
        pointerEvents: "none", userSelect: "none",
      }}>
        ⚠️ OLD VERSION — build in axiomsystem.app
      </div>
      <TooltipProvider>
        <ErrorBoundary>
          <WouterRouter base={import.meta.env.BASE_URL.replace(/\/$/, "")}>
            <PageTransition />
            <Router />
          </WouterRouter>
        </ErrorBoundary>
        <Toaster />
      </TooltipProvider>
    </QueryClientProvider>
  );
}

export default App;
