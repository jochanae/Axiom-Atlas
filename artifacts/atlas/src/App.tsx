import { useEffect, Component, type ReactNode } from "react";
import { Switch, Route, Router as WouterRouter } from "wouter";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
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
import GuardReport from "./pages/guard-report";
import EntryDetail from "./pages/entry-detail";
import Sessions from "./pages/sessions";
import ThinkFreely from "./pages/think-freely";
import Workshop from "./pages/workshop";
import ProjectCompass from "./pages/project-compass";
import Terms from "./pages/terms";
import Privacy from "./pages/privacy";
import Help from "./pages/help";
import Vault from "./pages/vault";
import Admin from "./pages/admin";
import ResetPassword from "./pages/reset-password";

// ── Global 401 interceptor ────────────────────────────────────────────────────
const _originalFetch = window.fetch.bind(window);
window.fetch = async (...args) => {
  const res = await _originalFetch(...args);
  if (res.status === 401) {
    const url = typeof args[0] === "string" ? args[0] : (args[0] as Request).url;
    if (url.includes("/api/") && !url.includes("/api/auth/")) {
      const base = import.meta.env.BASE_URL.replace(/\/$/, "");
      window.location.href = `${base}/login?reason=session_expired`;
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

// ── Router ────────────────────────────────────────────────────────────────────
function Router() {
  return (
    <Switch>
      <Route path="/" component={Landing} />
      <Route path="/login" component={Login} />
      <Route path="/reset-password" component={ResetPassword} />
      <Route path="/home" component={Home} />
      <Route path="/projects" component={Projects} />
      <Route path="/project/:projectId" component={Workspace} />
      <Route path="/ledger/:projectId" component={Ledger} />
      <Route path="/parking" component={ParkingLot} />
      <Route path="/guard-report" component={GuardReport} />
      <Route path="/entry/:id" component={EntryDetail} />
      <Route path="/sessions" component={Sessions} />
      <Route path="/think-freely" component={ThinkFreely} />
      <Route path="/workshop" component={Workshop} />
      <Route path="/compass" component={ProjectCompass} />
      <Route path="/terms" component={Terms} />
      <Route path="/privacy" component={Privacy} />
      <Route path="/help" component={Help} />
      <Route path="/vault" component={Vault} />
      <Route path="/admin" component={Admin} />
      <Route component={NotFound} />
    </Switch>
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
      <TooltipProvider>
        <ErrorBoundary>
          <WouterRouter base={import.meta.env.BASE_URL.replace(/\/$/, "")}>
            <Router />
          </WouterRouter>
        </ErrorBoundary>
        <Toaster />
      </TooltipProvider>
    </QueryClientProvider>
  );
}

export default App;
