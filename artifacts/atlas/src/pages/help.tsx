import { useState } from "react";
import { useLocation } from "wouter";
import type { CSSProperties } from "react";

const mono: CSSProperties = { fontFamily: "var(--app-font-mono)" };
const sans: CSSProperties = { fontFamily: "var(--app-font-sans)" };

const FAQS: { q: string; a: string }[] = [
  {
    q: "What is Axiom?",
    a: "Axiom is a decision enforcement and strategic thinking partner for founders and builders. It helps you track the commitments you make, catch you when you're about to contradict yourself, and maintain a permanent record of every choice that shapes your projects.",
  },
  {
    q: "What is the Decision Catch Engine?",
    a: "When you say something in the chat that contradicts a committed decision, Axiom intercepts with a structured catch card. It shows you the tension, lets you proceed anyway (with a reason logged), or adjust your direction. Every override is recorded in your Decision Ledger so you can see your reasoning over time.",
  },
  {
    q: "What is the Decision Ledger?",
    a: "The Ledger is a live record of all committed decisions for a project. Entries are categorized as Committed (locked in), In Tension (flagged by a catch), or Overridden (consciously changed). You can view the full Ledger from the workspace right panel, or navigate to it directly from the side menu.",
  },
  {
    q: "What is the Parking Lot?",
    a: "The Parking Lot holds ideas and decisions that aren't ready to commit to yet. You can park something from a catch card or manually from the Ledger. Parked items can be resumed (moved back to chat), committed directly, or deleted.",
  },
  {
    q: "What is Nexus?",
    a: "Nexus is your cross-project strategic command space — the cognitive layer where you think across all your projects without being scoped to any single one. It has a persistent Living Thread (conversation that carries over between sessions) and a Global Ledger (read-only view of committed decisions across every project). Access it from the Projects drawer, the ↑ Nexus button in any workspace header, or the center node on the Master Map.",
  },
  {
    q: "How does Atlas remember things between sessions?",
    a: "Atlas uses three memory layers: (1) Project Memory — a running log of facts Atlas learns about your project, stored in the database and injected into every chat. (2) Your User Profile — name, stack, and project notes stored in your browser's local storage. (3) AI Memory Protocol — during sessions, Atlas emits structured memory facts that are automatically saved and recalled next time.",
  },
  {
    q: "What is the Master Map?",
    a: "The Master Map (/map) is the satellite view of your entire Atlas ecosystem. Nexus sits at the center as the anchor hub, and all your projects orbit around it as satellite nodes. Node glow intensity reflects recent activity — bright means actively worked on, dim means dormant. Tap any node to open its workspace or jump directly to its local System Map. Access it from the Projects drawer or directly from Nexus.",
  },
  {
    q: "What is the System Map?",
    a: "The System Map is the street view — a technical blueprint for a single project. It shows the architecture of your project (auth, database, API routes, state, UI, and business logic) as interconnected nodes. It lives inside each Atlas workspace under the Map tab. The Master Map is your satellite view of all projects; the System Map is your ground-level view of one.",
  },
  {
    q: "How do I link a GitHub repository?",
    a: "In the workspace, open the Files tab and enter your GitHub personal access token. Once connected, you can browse your repos, open files into chat context, and link a specific repo to a project. Your token is stored locally in your browser and never sent to our servers beyond what's needed to call the GitHub API.",
  },
  {
    q: "What is Think Freely?",
    a: "Think Freely is a scratchpad mode — a space to write without Atlas's decision enforcement active. It's useful for brainstorming, drafting, or thinking out loud before you're ready to commit to anything.",
  },
  {
    q: "What is the Guard Report?",
    a: "The Guard Report gives you a structural audit of your project's decision health — how many commits you've made, how many tensions have been flagged, and how your override rate looks over time. It's a diagnostic view, not a judgment.",
  },
  {
    q: "How do I delete a project?",
    a: "Open the project workspace, then open the side menu (folder icon in the top-left). From there you can rename or delete the project. Deletion is permanent and removes all sessions, decisions, and chat history for that project.",
  },
  {
    q: "Is my data private?",
    a: "Yes. Your projects, sessions, and decisions are private to your account. We do not sell your data or use it to train AI models. See our Privacy Policy for full details.",
  },
  {
    q: "How do I contact support?",
    a: "Email us at support@intoinnovations.com. We typically respond within one business day.",
  },
];

function FaqItem({ q, a }: { q: string; a: string }) {
  const [open, setOpen] = useState(false);
  return (
    <div
      style={{
        borderBottom: "1px solid var(--atlas-border)",
        overflow: "hidden",
      }}
    >
      <button
        onClick={() => setOpen((v) => !v)}
        style={{
          width: "100%", display: "flex", alignItems: "center", justifyContent: "space-between",
          padding: "16px 0", gap: 16,
          background: "transparent", border: "none", cursor: "pointer", textAlign: "left",
        }}
      >
        <span style={{ ...sans, fontSize: 14, fontWeight: 500, color: "var(--atlas-fg)", lineHeight: 1.4 }}>
          {q}
        </span>
        <svg
          width="14" height="14" viewBox="0 0 24 24" fill="none"
          stroke="var(--atlas-muted)" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round"
          style={{ flexShrink: 0, transition: "transform 200ms ease", transform: open ? "rotate(180deg)" : "rotate(0deg)" }}
        >
          <path d="M6 9l6 6 6-6" />
        </svg>
      </button>
      {open && (
        <div style={{ ...sans, fontSize: 14, color: "var(--atlas-fg)", opacity: 0.75, lineHeight: 1.75, paddingBottom: 16 }}>
          {a}
        </div>
      )}
    </div>
  );
}

export default function Help() {
  const [, setLocation] = useLocation();

  return (
    <div style={{ minHeight: "100dvh", background: "var(--atlas-bg)", display: "flex", flexDirection: "column" }}>

      {/* Header */}
      <header style={{
        display: "flex", alignItems: "center", gap: 12,
        padding: "16px 24px",
        borderBottom: "1px solid var(--atlas-border)",
        flexShrink: 0,
      }}>
        <button
          onClick={() => setLocation("/")}
          style={{ background: "transparent", border: "none", cursor: "pointer", color: "var(--atlas-muted)", display: "flex", alignItems: "center", gap: 6, padding: 0 }}
        >
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
            <path d="M19 12H5M12 5l-7 7 7 7" />
          </svg>
          <span style={{ ...mono, fontSize: 10, letterSpacing: "0.12em", textTransform: "uppercase" }}>Back</span>
        </button>
        <div style={{ width: 1, height: 16, background: "var(--atlas-border)" }} />
        <span style={{ ...mono, fontSize: 10, letterSpacing: "0.18em", textTransform: "uppercase", color: "var(--atlas-gold)", opacity: 0.7 }}>
          Help & FAQ
        </span>
      </header>

      {/* Body */}
      <main style={{ flex: 1, maxWidth: 680, margin: "0 auto", padding: "48px 24px 80px", width: "100%" }}>

        <h1 style={{ ...sans, fontSize: 28, fontWeight: 600, color: "var(--atlas-fg)", marginBottom: 8, lineHeight: 1.2 }}>
          Help & FAQ
        </h1>
        <p style={{ ...sans, fontSize: 14, color: "var(--atlas-muted)", marginBottom: 48, lineHeight: 1.6 }}>
          Answers to common questions about Atlas. Can't find what you need?{" "}
          <a href="mailto:support@intoinnovations.com" style={{ color: "var(--atlas-gold)", textDecoration: "none" }}>
            Contact us
          </a>
          .
        </p>

        <div>
          {FAQS.map((item) => (
            <FaqItem key={item.q} q={item.q} a={item.a} />
          ))}
        </div>

        {/* Contact CTA */}
        <div style={{
          marginTop: 48, padding: "24px", borderRadius: 12,
          border: "1px solid var(--atlas-border)",
          background: "rgba(28,25,23,0.6)",
        }}>
          <div style={{ ...mono, fontSize: 10, letterSpacing: "0.18em", textTransform: "uppercase", color: "var(--atlas-gold)", opacity: 0.7, marginBottom: 10 }}>
            Still need help?
          </div>
          <p style={{ ...sans, fontSize: 14, color: "var(--atlas-fg)", opacity: 0.75, marginBottom: 16, lineHeight: 1.6 }}>
            Email our support team and we'll get back to you within one business day.
          </p>
          <a
            href="mailto:support@intoinnovations.com"
            style={{
              display: "inline-flex", alignItems: "center", gap: 8,
              padding: "10px 20px", borderRadius: 8,
              background: "rgba(201,162,76,0.1)", border: "1px solid rgba(201,162,76,0.3)",
              color: "var(--atlas-gold)", textDecoration: "none",
              ...mono, fontSize: 11, letterSpacing: "0.08em",
            }}
          >
            support@intoinnovations.com
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
              <path d="M5 12h14M12 5l7 7-7 7" />
            </svg>
          </a>
        </div>

      </main>

      {/* Footer */}
      <footer style={{ borderTop: "1px solid var(--atlas-border)", padding: "20px 24px", display: "flex", gap: 24, justifyContent: "center" }}>
        {[
          { label: "Terms", href: "/terms" },
          { label: "Privacy", href: "/privacy" },
          { label: "Home", href: "/" },
        ].map(({ label, href }) => (
          <a key={href} href={href} style={{ ...mono, fontSize: 10, letterSpacing: "0.1em", color: "var(--atlas-muted)", textDecoration: "none", opacity: 0.6 }}>
            {label}
          </a>
        ))}
      </footer>

    </div>
  );
}
