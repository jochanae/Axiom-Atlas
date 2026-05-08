import { useLocation } from "wouter";
import type { CSSProperties } from "react";

const mono: CSSProperties = { fontFamily: "var(--app-font-mono)" };
const sans: CSSProperties = { fontFamily: "var(--app-font-sans)" };

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section style={{ marginBottom: 40 }}>
      <div style={{ ...mono, fontSize: 10, letterSpacing: "0.18em", textTransform: "uppercase", color: "var(--atlas-gold)", opacity: 0.7, marginBottom: 10 }}>
        {title}
      </div>
      <div style={{ ...sans, fontSize: 14, color: "var(--atlas-fg)", opacity: 0.8, lineHeight: 1.75 }}>
        {children}
      </div>
    </section>
  );
}

export default function Privacy() {
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
          Privacy Policy
        </span>
      </header>

      {/* Body */}
      <main style={{ flex: 1, maxWidth: 680, margin: "0 auto", padding: "48px 24px 80px", width: "100%" }}>

        <h1 style={{ ...sans, fontSize: 28, fontWeight: 600, color: "var(--atlas-fg)", marginBottom: 8, lineHeight: 1.2 }}>
          Privacy Policy
        </h1>
        <p style={{ ...mono, fontSize: 10, letterSpacing: "0.12em", color: "var(--atlas-muted)", marginBottom: 48 }}>
          EFFECTIVE DATE: JANUARY 1, 2025 · INTO INNOVATIONS LLC
        </p>

        <Section title="01 // What We Collect">
          <p style={{ marginBottom: 12 }}>When you use Atlas, we collect:</p>
          <ul style={{ paddingLeft: 20, display: "flex", flexDirection: "column", gap: 8 }}>
            <li><strong style={{ color: "var(--atlas-fg)" }}>Account data</strong> — your name and profile information you choose to provide</li>
            <li><strong style={{ color: "var(--atlas-fg)" }}>Project data</strong> — project names, descriptions, and session content you create</li>
            <li><strong style={{ color: "var(--atlas-fg)" }}>Decision entries</strong> — committed decisions, parked ideas, and override history</li>
            <li><strong style={{ color: "var(--atlas-fg)" }}>Chat messages</strong> — your conversations with Atlas, including AI responses</li>
            <li><strong style={{ color: "var(--atlas-fg)" }}>Usage data</strong> — how you interact with the application (page views, feature usage)</li>
          </ul>
        </Section>

        <Section title="02 // What We Don't Collect">
          <p style={{ marginBottom: 12 }}>We do not collect:</p>
          <ul style={{ paddingLeft: 20, display: "flex", flexDirection: "column", gap: 6 }}>
            <li>Payment information (handled by our payment processor)</li>
            <li>Biometric data</li>
            <li>Data from your device beyond what your browser reports</li>
            <li>Data from third-party sites or apps</li>
          </ul>
        </Section>

        <Section title="03 // How We Use Your Data">
          <p style={{ marginBottom: 12 }}>We use your data to:</p>
          <ul style={{ paddingLeft: 20, display: "flex", flexDirection: "column", gap: 6 }}>
            <li>Provide and improve the Atlas service</li>
            <li>Power the AI features, including the Decision Catch Engine</li>
            <li>Maintain your decision history and session continuity</li>
            <li>Send you service-related communications (no marketing without consent)</li>
            <li>Diagnose technical issues and improve reliability</li>
          </ul>
        </Section>

        <Section title="04 // AI & Your Data">
          Your chat messages are sent to third-party AI providers (currently Anthropic) to generate responses. These providers process your messages under their own privacy policies. We do not permit them to use your data to train their models. Chat history is stored in our database so Atlas can maintain context between sessions.
        </Section>

        <Section title="05 // Data Storage">
          Your data is stored in a PostgreSQL database hosted in the United States. We use industry-standard encryption in transit (TLS) and at rest. We retain your data as long as your account is active. You may request export or deletion of your data at any time.
        </Section>

        <Section title="06 // Data Sharing">
          <p style={{ marginBottom: 12 }}>We do not sell your data. We share it only with:</p>
          <ul style={{ paddingLeft: 20, display: "flex", flexDirection: "column", gap: 6 }}>
            <li><strong style={{ color: "var(--atlas-fg)" }}>Service providers</strong> — hosting, database, and AI providers necessary to run Atlas</li>
            <li><strong style={{ color: "var(--atlas-fg)" }}>Legal requirements</strong> — when required by law or to protect our rights</li>
          </ul>
        </Section>

        <Section title="07 // Your Rights">
          <p style={{ marginBottom: 12 }}>You have the right to:</p>
          <ul style={{ paddingLeft: 20, display: "flex", flexDirection: "column", gap: 6 }}>
            <li>Access the personal data we hold about you</li>
            <li>Correct inaccurate data</li>
            <li>Request deletion of your account and all associated data</li>
            <li>Export your data in a portable format</li>
            <li>Opt out of non-essential communications</li>
          </ul>
          <p style={{ marginTop: 12 }}>
            To exercise any of these rights, contact us at{" "}
            <a href="mailto:privacy@intoinnovations.com" style={{ color: "var(--atlas-gold)", textDecoration: "none" }}>
              privacy@intoinnovations.com
            </a>
            .
          </p>
        </Section>

        <Section title="08 // Cookies & Local Storage">
          Atlas uses browser localStorage to store your theme preference, profile information, and GitHub token. No cross-site tracking cookies are used. We may use session cookies for authentication purposes only.
        </Section>

        <Section title="09 // Changes to This Policy">
          We may update this Privacy Policy from time to time. When we do, we will update the effective date above and notify you if the changes are material. Continued use of Atlas after changes constitutes your acceptance of the updated policy.
        </Section>

        <Section title="10 // Contact">
          Questions about your privacy?{" "}
          <a href="mailto:privacy@intoinnovations.com" style={{ color: "var(--atlas-gold)", textDecoration: "none" }}>
            privacy@intoinnovations.com
          </a>
        </Section>

      </main>

      {/* Footer */}
      <footer style={{ borderTop: "1px solid var(--atlas-border)", padding: "20px 24px", display: "flex", gap: 24, justifyContent: "center" }}>
        {[
          { label: "Terms", href: "/terms" },
          { label: "Help & FAQ", href: "/help" },
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
