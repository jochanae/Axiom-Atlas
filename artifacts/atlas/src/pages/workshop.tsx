import { useLocation } from "wouter";
import { useListProjects } from "@workspace/api-client-react";

export default function Workshop() {
  const [, setLocation] = useLocation();
  const { data: projects = [] } = useListProjects();

  const tools: { icon: React.ReactNode; label: string; desc: string; soon?: boolean }[] = [
    {
      icon: <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round"><path d="M12 20h9" /><path d="M16.5 3.5a2.121 2.121 0 013 3L7 19l-4 1 1-4L16.5 3.5z" /></svg>,
      label: "Decision Editor",
      desc: "Manually create and refine ledger entries outside of chat.",
      soon: true,
    },
    {
      icon: <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="10" /><line x1="2" y1="12" x2="22" y2="12" /><path d="M12 2a15.3 15.3 0 014 10 15.3 15.3 0 01-4 10 15.3 15.3 0 01-4-10 15.3 15.3 0 014-10z" /></svg>,
      label: "Context Builder",
      desc: "Structure what Atlas knows before a session — goals, constraints, prior decisions.",
      soon: true,
    },
    {
      icon: <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round"><polyline points="16 18 22 12 16 6" /><polyline points="8 6 2 12 8 18" /></svg>,
      label: "Diff Review",
      desc: "Compare proposed decisions against committed ones. Spot contradictions before they land.",
      soon: true,
    },
    {
      icon: <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round"><path d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8z" /><polyline points="14 2 14 8 20 8" /><line x1="16" y1="13" x2="8" y2="13" /><line x1="16" y1="17" x2="8" y2="17" /><polyline points="10 9 9 9 8 9" /></svg>,
      label: "Session Exporter",
      desc: "Export a full session transcript with ledger entries attached.",
      soon: true,
    },
    {
      icon: <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round"><polygon points="12 2 2 7 12 12 22 7 12 2" /><polyline points="2 17 12 22 22 17" /><polyline points="2 12 12 17 22 12" /></svg>,
      label: "Bulk Import",
      desc: "Seed a new project's ledger from a doc, spec, or prior decisions list.",
      soon: true,
    },
  ];

  return (
    <div style={{ minHeight: "100dvh", background: "var(--atlas-bg)", color: "var(--atlas-fg)", display: "flex", flexDirection: "column", paddingBottom: 80 }}>

      {/* Header */}
      <header style={{
        position: "sticky", top: 0, zIndex: 20,
        background: "var(--atlas-bg)", borderBottom: "1px solid var(--atlas-border)",
        backdropFilter: "blur(12px)", flexShrink: 0,
      }}>
        <div style={{ padding: "10px 16px 10px", display: "flex", alignItems: "center", gap: 8 }}>
          <button
            type="button"
            onClick={() => setLocation("/")}
            style={{ fontFamily: "var(--app-font-mono)", fontSize: 9, letterSpacing: "0.14em", textTransform: "uppercase", color: "var(--atlas-muted)", background: "transparent", border: "none", padding: 0, cursor: "pointer", opacity: 0.7 }}
          >
            ← Home
          </button>
        </div>
        <div style={{ padding: "0 16px 14px" }}>
          <h1 style={{ fontSize: 20, fontWeight: 600, letterSpacing: "-0.02em", margin: 0, color: "var(--atlas-fg)" }}>Workshop</h1>
          <p style={{ fontFamily: "var(--app-font-mono)", fontSize: 10, color: "var(--atlas-muted)", margin: "4px 0 0", letterSpacing: "0.06em", opacity: 0.6 }}>
            Power tools for working outside the chat
          </p>
        </div>
      </header>

      <main style={{ padding: "16px" }}>
        {/* Active project context pill */}
        {projects.length > 0 && (
          <div style={{
            marginBottom: 18, padding: "7px 12px",
            background: "color-mix(in oklab, var(--atlas-gold) 8%, transparent)",
            border: "1px solid rgba(201,162,76,0.2)", borderRadius: 8,
            display: "flex", alignItems: "center", gap: 8,
          }}>
            <span style={{ width: 5, height: 5, borderRadius: "50%", background: "var(--atlas-gold)", flexShrink: 0, display: "inline-block" }} />
            <span style={{ fontFamily: "var(--app-font-mono)", fontSize: 10, color: "var(--atlas-gold)", opacity: 0.8, letterSpacing: "0.06em" }}>
              {projects.length} project{projects.length !== 1 ? "s" : ""} in workspace
            </span>
          </div>
        )}

        {/* Tool grid */}
        <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
          {tools.map((tool) => (
            <div
              key={tool.label}
              style={{
                padding: "14px 16px",
                borderRadius: 10,
                background: "var(--atlas-surface)",
                border: "1px solid var(--atlas-border)",
                display: "flex", alignItems: "flex-start", gap: 14,
                opacity: tool.soon ? 0.65 : 1,
              }}
            >
              <span style={{ color: "var(--atlas-muted)", opacity: 0.7, flexShrink: 0, marginTop: 2 }}>{tool.icon}</span>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 4 }}>
                  <span style={{ fontSize: 13.5, fontWeight: 600, color: "var(--atlas-fg)", letterSpacing: "-0.01em" }}>{tool.label}</span>
                  {tool.soon && (
                    <span style={{ fontFamily: "var(--app-font-mono)", fontSize: 8.5, letterSpacing: "0.12em", color: "var(--atlas-muted)", opacity: 0.6, border: "1px solid var(--atlas-border)", padding: "1px 6px", borderRadius: 4 }}>SOON</span>
                  )}
                </div>
                <p style={{ fontSize: 12, color: "var(--atlas-muted)", margin: 0, lineHeight: 1.6, opacity: 0.75 }}>{tool.desc}</p>
              </div>
            </div>
          ))}
        </div>
      </main>
    </div>
  );
}
