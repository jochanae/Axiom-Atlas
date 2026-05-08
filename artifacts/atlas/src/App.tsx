import { useEffect } from "react";
import { Switch, Route, Router as WouterRouter } from "wouter";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { Toaster } from "@/components/ui/toaster";
import { TooltipProvider } from "@/components/ui/tooltip";
import NotFound from "@/pages/not-found";

import Home from "./pages/home";
import Landing from "./pages/landing";
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

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      retry: 1,
      refetchOnWindowFocus: false,
    },
  },
});

// ── Router ────────────────────────────────────────────────────────────────────
function Router() {
  return (
    <Switch>
      <Route path="/" component={Landing} />
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
      <Route component={NotFound} />
    </Switch>
  );
}

// ── App ───────────────────────────────────────────────────────────────────────
function App() {
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
          <Router />
        </WouterRouter>
        <Toaster />
      </TooltipProvider>
    </QueryClientProvider>
  );
}

export default App;
