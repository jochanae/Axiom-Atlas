import { useEffect, useState, type CSSProperties, type FormEvent, type ReactNode } from "react";
import { useLocation } from "wouter";
import { useQueryClient } from "@tanstack/react-query";
import { getListProjectsQueryKey } from "@workspace/api-client-react";
import { useRequireAuth } from "@/hooks/useAuth";

const intents = [
  { id: "idea", label: "I have an idea to build", icon: "💡", desc: "Start from scratch and structure your thinking" },
  { id: "founder", label: "I'm building a product", icon: "🚀", desc: "Manage decisions, sprints, and momentum" },
  { id: "agency", label: "I run projects for clients", icon: "🏢", desc: "Multi-project oversight and delivery" },
  { id: "power", label: "I manage multiple products", icon: "⚡", desc: "Portfolio intelligence across everything you're building" },
  { id: "technical", label: "I vibe code and need structure", icon: "⌨️", desc: "AI-assisted building with decision accountability" },
];

function intentToUserType(id: string): "idea" | "building" | "clients" | "portfolio" | null {
  if (id === "idea") return "idea";
  if (id === "founder" || id === "technical") return "building";
  if (id === "agency") return "clients";
  if (id === "power") return "portfolio";
  return null;
}

const shellStyle: CSSProperties = {
  minHeight: "100svh",
  background: "var(--atlas-bg)",
  color: "var(--atlas-fg)",
  display: "flex",
  alignItems: "center",
  justifyContent: "center",
  padding: "32px 20px",
  boxSizing: "border-box",
};

const panelStyle: CSSProperties = {
  width: "100%",
  maxWidth: 720,
  display: "flex",
  flexDirection: "column",
  alignItems: "center",
  textAlign: "center",
};

const monoStyle: CSSProperties = {
  fontFamily: "var(--app-font-mono)",
  letterSpacing: "0.14em",
  textTransform: "uppercase",
};

function PrimaryButton({
  children,
  disabled,
  onClick,
  type = "button",
}: {
  children: ReactNode;
  disabled?: boolean;
  onClick?: () => void;
  type?: "button" | "submit";
}) {
  return (
    <button
      type={type}
      disabled={disabled}
      onClick={onClick}
      style={{
        marginTop: 28,
        minWidth: 190,
        border: "1px solid var(--atlas-gold)",
        background: disabled ? "var(--atlas-surface-alt)" : "var(--atlas-gold)",
        color: disabled ? "var(--atlas-muted)" : "var(--atlas-bg)",
        borderRadius: 999,
        padding: "13px 22px",
        fontSize: 12,
        fontWeight: 800,
        cursor: disabled ? "not-allowed" : "pointer",
        ...monoStyle,
      }}
    >
      {children}
    </button>
  );
}

export default function OnboardingPage() {
  const { isLoading } = useRequireAuth();
  const [, setLocation] = useLocation();
  const queryClient = useQueryClient();
  const [step, setStep] = useState(() => {
    try {
      const stored = Number(localStorage.getItem("axiom_onboarding_step") ?? "1");
      return stored >= 1 && stored <= 3 ? stored : 1;
    } catch {
      return 1;
    }
  });
  const [selectedIntent, setSelectedIntent] = useState(() => {
    try {
      return localStorage.getItem("axiom_user_intent") ?? "";
    } catch {
      return "";
    }
  });
  const [projectName, setProjectName] = useState("");
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    try { localStorage.setItem("axiom_onboarding_step", String(step)); } catch {}
  }, [step]);

  const chooseIntent = (id: string) => {
    setSelectedIntent(id);
    try {
      localStorage.setItem("axiom_user_intent", id);
      const userType = intentToUserType(id);
      if (userType) localStorage.setItem("axiom_user_type", userType);
    } catch {}
  };

  const createProject = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const name = projectName.trim();
    if (!name || creating) return;
    setCreating(true);
    setError(null);
    try {
      const res = await fetch("/api/projects", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ name }),
      });
      const data = await res.json() as { id?: number; error?: string; message?: string };
      if (!res.ok || !data.id) throw new Error(data.error ?? data.message ?? "Project creation failed.");
      try { localStorage.setItem("axiom_onboarding_step", "4"); } catch {}
      await queryClient.invalidateQueries({ queryKey: getListProjectsQueryKey() });
      setLocation(`/project/${data.id}?onboarding=true`);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Project creation failed.");
    } finally {
      setCreating(false);
    }
  };

  if (isLoading) return <div style={shellStyle} />;

  if (step === 1) {
    return (
      <main style={shellStyle}>
        <section style={panelStyle}>
          <div style={{ ...monoStyle, color: "var(--atlas-gold)", fontSize: 11, marginBottom: 18 }}>
            Axiom
          </div>
          <h1 style={{ margin: 0, fontFamily: "Georgia, var(--app-font-serif)", fontSize: "clamp(42px, 9vw, 76px)", fontWeight: 400, lineHeight: 1.02, color: "var(--atlas-fg)" }}>
            Welcome to Axiom.
          </h1>
          <p style={{ margin: "18px 0 0", maxWidth: 520, color: "var(--atlas-muted)", fontSize: "clamp(16px, 3vw, 20px)", lineHeight: 1.6 }}>
            The system that holds your thinking accountable.
          </p>
          <PrimaryButton onClick={() => setStep(2)}>Get Started →</PrimaryButton>
        </section>
      </main>
    );
  }

  if (step === 2) {
    return (
      <main style={shellStyle}>
        <section style={{ ...panelStyle, maxWidth: 860 }}>
          <div style={{ ...monoStyle, color: "var(--atlas-gold)", fontSize: 10, marginBottom: 12 }}>
            Step 2
          </div>
          <h1 style={{ margin: 0, fontSize: "clamp(30px, 6vw, 48px)", fontWeight: 300, letterSpacing: "-0.03em", color: "var(--atlas-fg)" }}>
            What brings you here?
          </h1>
          <div style={{ width: "100%", display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))", gap: 12, marginTop: 30 }}>
            {intents.map((intent) => {
              const active = selectedIntent === intent.id;
              return (
                <button
                  key={intent.id}
                  type="button"
                  onClick={() => chooseIntent(intent.id)}
                  style={{
                    minHeight: 148,
                    padding: "18px 16px",
                    textAlign: "left",
                    borderRadius: 16,
                    border: active ? "2px solid var(--atlas-gold)" : "1px solid var(--atlas-border)",
                    background: active ? "var(--atlas-surface-alt)" : "var(--atlas-surface)",
                    color: "var(--atlas-fg)",
                    cursor: "pointer",
                    display: "flex",
                    flexDirection: "column",
                    gap: 10,
                  }}
                >
                  <span style={{ fontSize: 26, lineHeight: 1 }}>{intent.icon}</span>
                  <span style={{ fontSize: 15, fontWeight: 700, lineHeight: 1.35 }}>{intent.label}</span>
                  <span style={{ fontSize: 12.5, color: "var(--atlas-muted)", lineHeight: 1.55 }}>{intent.desc}</span>
                </button>
              );
            })}
          </div>
          <PrimaryButton disabled={!selectedIntent} onClick={() => selectedIntent && setStep(3)}>This is me →</PrimaryButton>
        </section>
      </main>
    );
  }

  return (
    <main style={shellStyle}>
      <section style={panelStyle}>
        <div style={{ ...monoStyle, color: "var(--atlas-gold)", fontSize: 10, marginBottom: 12 }}>
          Step 3
        </div>
        <h1 style={{ margin: 0, fontSize: "clamp(30px, 6vw, 52px)", fontWeight: 300, letterSpacing: "-0.03em", color: "var(--atlas-fg)" }}>
          Name your first project.
        </h1>
        <p style={{ margin: "12px 0 28px", color: "var(--atlas-muted)", fontSize: 16, lineHeight: 1.6 }}>
          This is where your first sprint of thinking will live.
        </p>
        <form onSubmit={createProject} style={{ width: "100%", maxWidth: 560, display: "flex", flexDirection: "column", alignItems: "center" }}>
          <input
            value={projectName}
            onChange={(event) => setProjectName(event.target.value)}
            placeholder="What are you building?"
            autoFocus
            style={{
              width: "100%",
              border: "none",
              borderBottom: "1px solid var(--atlas-border)",
              background: "var(--atlas-bg)",
              color: "var(--atlas-fg)",
              outline: "none",
              textAlign: "center",
              fontSize: "clamp(24px, 6vw, 42px)",
              fontWeight: 300,
              padding: "14px 4px",
              boxSizing: "border-box",
            }}
          />
          <p style={{ margin: "16px 0 0", color: "var(--atlas-muted)", fontSize: 12.5 }}>
            You can add more projects anytime.
          </p>
          {error && <p style={{ margin: "18px 0 0", color: "var(--atlas-ember)", fontSize: 12.5 }}>{error}</p>}
          <PrimaryButton type="submit" disabled={!projectName.trim() || creating}>
            {creating ? "Creating…" : "Create Project →"}
          </PrimaryButton>
        </form>
      </section>
    </main>
  );
}
