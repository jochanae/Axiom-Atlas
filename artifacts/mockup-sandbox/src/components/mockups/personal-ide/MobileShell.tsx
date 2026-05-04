const BG = "#0C0A09";
const SURFACE = "#161412";
const SURFACE2 = "#1C1917";
const BORDER = "#252220";
const GOLD = "#C9A24C";
const EMBER = "#B45309";
const PHOSPHOR = "#06B6D4";
const MUTED = "#78716C";
const FG = "#E7E5E4";
const MONO = "'JetBrains Mono', 'Fira Code', monospace";
const SANS = "system-ui, -apple-system, sans-serif";

const projects = ["Compani", "IntoIQ", "CoinsBloom", "PresentQ", "SanctumIQ", "Atlas"];

const messages = [
  {
    role: "user",
    content: "The auth redirect is broken after login. It just hangs on a blank screen.",
  },
  {
    role: "assistant",
    content:
      "Found it. In `src/auth/callback.tsx` line 34, the `redirectTo` param is being read before the session resolves — it's always undefined on first paint.\n\nFix: await the session check before redirecting.",
    file: "src/auth/callback.tsx",
    line: 34,
  },
  {
    role: "user",
    content: "Can you apply the fix?",
  },
];

function NavIcon({ label, active, icon }: { label: string; active?: boolean; icon: React.ReactNode }) {
  return (
    <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 4, flex: 1, cursor: "pointer" }}>
      <div style={{ color: active ? GOLD : MUTED, opacity: active ? 1 : 0.6 }}>{icon}</div>
      <span style={{ fontFamily: MONO, fontSize: 9, letterSpacing: "0.08em", textTransform: "uppercase" as const, color: active ? GOLD : MUTED, opacity: active ? 1 : 0.5 }}>
        {label}
      </span>
    </div>
  );
}

export function MobileShell() {
  return (
    <div style={{ width: 390, height: 844, background: BG, display: "flex", flexDirection: "column", fontFamily: SANS, overflow: "hidden", position: "relative" }}>

      {/* Status bar */}
      <div style={{ height: 44, background: "rgba(12,10,9,0.95)", display: "flex", alignItems: "center", justifyContent: "space-between", padding: "0 18px", flexShrink: 0, borderBottom: `1px solid ${BORDER}` }}>
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <div style={{ width: 6, height: 6, borderRadius: "50%", background: PHOSPHOR, boxShadow: `0 0 6px ${PHOSPHOR}` }} />
          <span style={{ fontFamily: MONO, fontSize: 11, letterSpacing: "0.06em", color: FG, fontWeight: 500 }}>Compani</span>
          <svg width="10" height="10" viewBox="0 0 12 12" fill="none"><path d="M3 4.5L6 7.5L9 4.5" stroke={MUTED} strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round"/></svg>
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
          <span style={{ fontFamily: MONO, fontSize: 8.5, letterSpacing: "0.1em", textTransform: "uppercase" as const, color: PHOSPHOR, opacity: 0.7 }}>Live</span>
          <div style={{ width: 5, height: 5, borderRadius: "50%", background: PHOSPHOR, opacity: 0.8 }} />
        </div>
      </div>

      {/* Project selector — horizontal scroll */}
      <div style={{ height: 40, flexShrink: 0, display: "flex", alignItems: "center", gap: 6, padding: "0 14px", overflowX: "auto", borderBottom: `1px solid ${BORDER}`, background: SURFACE }}>
        {projects.map((p, i) => (
          <div
            key={p}
            style={{
              flexShrink: 0, padding: "4px 10px", borderRadius: 20,
              background: i === 0 ? `rgba(201,162,76,0.12)` : "transparent",
              border: `0.5px solid ${i === 0 ? "rgba(201,162,76,0.35)" : BORDER}`,
              fontFamily: MONO, fontSize: 10, letterSpacing: "0.05em",
              color: i === 0 ? GOLD : MUTED,
              cursor: "pointer",
              whiteSpace: "nowrap" as const,
            }}
          >
            {p}
          </div>
        ))}
      </div>

      {/* Chat messages */}
      <div style={{ flex: 1, overflowY: "auto", padding: "16px 14px 8px", display: "flex", flexDirection: "column", gap: 16 }}>
        {messages.map((m, i) =>
          m.role === "user" ? (
            <div key={i} style={{ display: "flex", justifyContent: "flex-end" }}>
              <div style={{ maxWidth: "78%", padding: "10px 13px", borderRadius: "12px 12px 3px 12px", background: `rgba(146,64,14,0.12)`, border: `1px solid rgba(146,64,14,0.22)`, fontSize: 13, lineHeight: 1.6, color: `rgba(231,229,228,0.88)` }}>
                {m.content}
              </div>
            </div>
          ) : (
            <div key={i}>
              <div style={{ fontFamily: MONO, fontSize: 8.5, letterSpacing: "0.1em", textTransform: "uppercase" as const, color: GOLD, opacity: 0.5, marginBottom: 6 }}>Atlas</div>
              <div style={{ fontSize: 13, lineHeight: 1.65, color: `rgba(231,229,228,0.85)`, whiteSpace: "pre-wrap" as const }}>{m.content}</div>
              {m.file && (
                <div style={{ marginTop: 8, padding: "6px 10px", borderRadius: 6, background: SURFACE2, border: `0.5px solid ${BORDER}`, display: "flex", alignItems: "center", gap: 8 }}>
                  <svg width="12" height="12" viewBox="0 0 16 16" fill="none"><path d="M4 2h6l4 4v8a1 1 0 01-1 1H4a1 1 0 01-1-1V3a1 1 0 011-1z" stroke={PHOSPHOR} strokeWidth="1.2"/><path d="M10 2v4h4" stroke={PHOSPHOR} strokeWidth="1.2" strokeLinecap="round"/></svg>
                  <span style={{ fontFamily: MONO, fontSize: 10, color: PHOSPHOR, letterSpacing: "0.04em" }}>{m.file}</span>
                  <span style={{ fontFamily: MONO, fontSize: 9, color: MUTED, marginLeft: "auto", opacity: 0.6 }}>:{m.line}</span>
                </div>
              )}
            </div>
          )
        )}

        {/* Thinking indicator */}
        <div>
          <div style={{ fontFamily: MONO, fontSize: 8.5, letterSpacing: "0.1em", textTransform: "uppercase" as const, color: GOLD, opacity: 0.35, marginBottom: 6 }}>Atlas</div>
          <div style={{ display: "flex", gap: 4, alignItems: "center", paddingTop: 4 }}>
            {[0, 1, 2].map(j => (
              <div key={j} style={{ width: 5, height: 5, borderRadius: "50%", background: GOLD, opacity: 0.4 + j * 0.2 }} />
            ))}
          </div>
        </div>
      </div>

      {/* Input */}
      <div style={{ padding: "8px 12px 10px", flexShrink: 0, borderTop: `1px solid ${BORDER}`, background: SURFACE }}>
        <div style={{ display: "flex", alignItems: "center", gap: 8, padding: "10px 12px", borderRadius: 10, background: SURFACE2, border: `1px solid ${BORDER}` }}>
          <svg width="15" height="15" viewBox="0 0 20 20" fill="none" style={{ flexShrink: 0, opacity: 0.35 }}>
            <path d="M4 6h12M4 10h8M4 14h5" stroke={MUTED} strokeWidth="1.5" strokeLinecap="round"/>
          </svg>
          <span style={{ fontSize: 13, color: MUTED, opacity: 0.45, flex: 1 }}>Ask Atlas anything…</span>
          <div style={{ width: 28, height: 28, borderRadius: 7, background: GOLD, display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}>
            <svg width="12" height="12" viewBox="0 0 16 16" fill="none"><path d="M2 14L14 8L2 2v5l8 1-8 1v5z" fill="#0C0A09"/></svg>
          </div>
        </div>
      </div>

      {/* Bottom nav */}
      <div style={{ height: 56, flexShrink: 0, display: "flex", alignItems: "center", padding: "0 8px", borderTop: `1px solid ${BORDER}`, background: "rgba(12,10,9,0.96)" }}>
        <NavIcon label="Chat" active icon={
          <svg width="18" height="18" viewBox="0 0 20 20" fill="none"><path d="M4 4h12v9H4z" stroke="currentColor" strokeWidth="1.3" strokeLinejoin="round"/><path d="M7 13l-3 3v-3" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round"/></svg>
        }/>
        <NavIcon label="Files" icon={
          <svg width="18" height="18" viewBox="0 0 20 20" fill="none"><path d="M5 3h7l3 3v11H5V3z" stroke="currentColor" strokeWidth="1.3" strokeLinejoin="round"/><path d="M12 3v4h3" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round"/></svg>
        }/>
        <NavIcon label="Preview" icon={
          <svg width="18" height="18" viewBox="0 0 20 20" fill="none"><rect x="2" y="4" width="16" height="12" rx="2" stroke="currentColor" strokeWidth="1.3"/><path d="M8 8l4 2.5-4 2.5V8z" fill="currentColor"/></svg>
        }/>
      </div>
    </div>
  );
}
