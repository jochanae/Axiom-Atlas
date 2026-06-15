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

export default function Terms() {
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
          Terms of Service
        </span>
      </header>

      {/* Body */}
      <main style={{ flex: 1, maxWidth: 680, margin: "0 auto", padding: "48px 24px 80px", width: "100%" }}>

        <h1 style={{ ...sans, fontSize: 28, fontWeight: 600, color: "var(--atlas-fg)", marginBottom: 8, lineHeight: 1.2 }}>
          Terms of Service
        </h1>
        <p style={{ ...mono, fontSize: 10, letterSpacing: "0.12em", color: "var(--atlas-muted)", marginBottom: 48 }}>
          LAST UPDATED: MAY 6, 2026 · INTO INNOVATIONS LLC
        </p>

        <Section title="01 // Acceptance">
          By accessing or using Atlas, you agree to be bound by these Terms of Service. If you do not agree to these terms, do not use the service. These terms constitute a binding legal agreement between you and Into Innovations LLC.
        </Section>

        <Section title="02 // Description of Service">
          Atlas is a strategic thinking partner designed for founders and builders. It helps you track commitments, notice when direction shifts, and maintain a structured record of the choices that shape your projects. Atlas is a thinking aid — not a substitute for professional legal, financial, or business advice.
        </Section>

        <Section title="03 // User Accounts">
          You must create an account to use Atlas. You are responsible for maintaining the confidentiality of your login credentials and for all activities that occur under your account. You must notify us immediately of any unauthorized use of your account at{" "}
          <a href="mailto:support@intoinnovations.com" style={{ color: "var(--atlas-gold)", textDecoration: "none" }}>support@intoinnovations.com</a>.
        </Section>

        <Section title="04 // Your Data">
          <p style={{ marginBottom: 12 }}>You own your data. Projects, sessions, chat messages, and decision entries you create in Atlas belong to you. We do not sell, rent, or share your personal data with third parties for marketing purposes.</p>
          <p>We retain your data as long as your account is active. You may request deletion of your account and all associated data at any time by contacting us.</p>
        </Section>

        <Section title="05 // Acceptable Use">
          <p style={{ marginBottom: 12 }}>You agree not to use Atlas to:</p>
          <ul style={{ paddingLeft: 20, display: "flex", flexDirection: "column", gap: 6 }}>
            <li>Violate any applicable law or regulation</li>
            <li>Transmit harmful, offensive, or illegal content</li>
            <li>Attempt to gain unauthorized access to our systems</li>
            <li>Reverse engineer or attempt to extract the source code of the service</li>
            <li>Use the service in any way that could damage, disable, or impair it</li>
          </ul>
        </Section>

        <Section title="06 // AI Features">
          Atlas uses large language models to provide strategic guidance and decision logging functionality. AI responses are generated automatically and may occasionally be incorrect or incomplete. You are responsible for verifying any AI-generated output before acting on it. We do not guarantee the accuracy, reliability, or suitability of AI responses for any particular purpose.
        </Section>

        <Section title="07 // Subscription & Payments">
          Certain features of Atlas may require a paid subscription. Pricing, billing cycles, and tier benefits will be communicated at the point of purchase. Refund policies will be outlined in the subscription agreement presented at the time of payment. We reserve the right to change pricing with reasonable notice to existing subscribers.
        </Section>

        <Section title="08 // Intellectual Property">
          The Atlas platform, including its design, code, and branding, is the intellectual property of Into Innovations LLC. You may not copy, modify, or distribute any part of the platform without our express written permission. Your content remains yours.
        </Section>

        <Section title="09 // Disclaimer of Warranties">
          Atlas is provided "as is" and "as available" without any warranties of any kind, express or implied. We do not warrant that the service will be uninterrupted, error-free, or free of harmful components. Your use of the service is at your own risk.
        </Section>

        <Section title="10 // Limitation of Liability">
          To the fullest extent permitted by law, Into Innovations LLC shall not be liable for any indirect, incidental, special, consequential, or punitive damages arising from your use of or inability to use Atlas, even if we have been advised of the possibility of such damages.
        </Section>

        <Section title="11 // Termination">
          We reserve the right to suspend or terminate your account at our discretion if you violate these terms or engage in conduct we determine to be harmful to other users or the platform. You may terminate your account at any time by contacting support. Upon termination, your right to use Atlas ceases immediately.
        </Section>

        <Section title="12 // Changes to Terms">
          We may update these Terms of Service from time to time. When we do, we will update the date above. Continued use of Atlas after changes constitutes your acceptance of the updated terms.
        </Section>

        <Section title="13 // Contact">
          Questions about these terms? Contact us at{" "}
          <a href="mailto:legal@intoinnovations.com" style={{ color: "var(--atlas-gold)", textDecoration: "none" }}>
            legal@intoinnovations.com
          </a>
          .
        </Section>

      </main>

      {/* Footer */}
      <footer style={{ borderTop: "1px solid var(--atlas-border)", padding: "20px 24px", display: "flex", gap: 24, justifyContent: "center" }}>
        {[
          { label: "Privacy", href: "/privacy" },
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
