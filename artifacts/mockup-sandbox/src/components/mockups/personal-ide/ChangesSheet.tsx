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

const messages = [
  {
    role: "user",
    content: "Build a login page with email and password",
  },
  {
    role: "assistant",
    content: "Done. Built a login page with email/password fields, validation, and a clean dark design.",
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

export function ChangesSheet() {
  return (
    <div style={{ width: 390, height: 844, background: BG, display: "flex", flexDirection: "column", fontFamily: SANS, overflow: "hidden", position: "relative" }}>

      {/* Status bar */}
      <div style={{ height: 44, background: "rgba(12,10,9,0.95)", display: "flex", alignItems: "center", justifyContent: "space-between", padding: "0 18px", flexShrink: 0, borderBottom: `1px solid ${BORDER}` }}>
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <div style={{ width: 6, height: 6, borderRadius: "50%", background: PHOSPHOR, boxShadow: `0 0 6px ${PHOSPHOR}` }} />
          <span style={{ fontFamily: MONO, fontSize: 11, letterSpacing: "0.06em", color: FG, fontWeight: 500 }}>Compani</span>
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
          <span style={{ fontFamily: MONO, fontSize: 8.5, letterSpacing: "0.1em", textTransform: "uppercase" as const, color: PHOSPHOR, opacity: 0.7 }}>Live</span>
        </div>
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
            </div>
          )
        )}
      </div>

      {/* ── CHANGES SHEET ── */}
      <div style={{
        position: "absolute",
        bottom: 56,
        left: 0,
        right: 0,
        maxHeight: "65%",
        background: SURFACE,
        borderTop: `1px solid ${BORDER}`,
        borderRadius: "16px 16px 0 0",
        boxShadow: "0 -8px 32px rgba(0,0,0,0.5)",
        display: "flex",
        flexDirection: "column",
        overflow: "hidden",
        zIndex: 10,
      }}>
        {/* Drag handle */}
        <div style={{ display: "flex", justifyContent: "center", padding: "8px 0 4px" }}>
          <div style={{ width: 36, height: 4, borderRadius: 2, background: `rgba(120,113,108,0.4)` }} />
        </div>

        {/* Header */}
        <div style={{ padding: "0 16px 10px", display: "flex", alignItems: "center", justifyContent: "space-between" }}>
          <div>
            <div style={{ fontFamily: MONO, fontSize: 8.5, letterSpacing: "0.1em", textTransform: "uppercase" as const, color: GOLD, opacity: 0.7 }}>3 files changed</div>
            <div style={{ fontSize: 14, fontWeight: 500, color: FG, marginTop: 2 }}>Login page</div>
          </div>
          <div style={{ display: "flex", gap: 6 }}>
            <span style={{ fontFamily: MONO, fontSize: 9, color: MUTED, opacity: 0.6 }}>Just now</span>
          </div>
        </div>

        {/* Scrollable content */}
        <div style={{ flex: 1, overflowY: "auto", padding: "0 16px 12px" }}>
          {/* Summary */}
          <div style={{ padding: "10px 12px", borderRadius: 8, background: `rgba(201,162,76,0.06)`, border: `0.5px solid rgba(201,162,76,0.2)`, marginBottom: 12 }}>
            <div style={{ fontSize: 12, color: `rgba(231,229,228,0.8)`, lineHeight: 1.5 }}>
              Built <code style={{ fontFamily: MONO, fontSize: 11, color: PHOSPHOR, background: `rgba(6,182,212,0.1)`, padding: "1px 4px", borderRadius: 3 }}>src/pages/login.tsx</code> with email/password fields, validation, and dark theme styling.
            </div>
          </div>

          {/* Visual Preview */}
          <div style={{ marginBottom: 12 }}>
            <div style={{ fontFamily: MONO, fontSize: 8.5, letterSpacing: "0.1em", textTransform: "uppercase" as const, color: MUTED, opacity: 0.5, marginBottom: 8 }}>Preview</div>
            <div style={{
              borderRadius: 12,
              border: `1px solid ${BORDER}`,
              overflow: "hidden",
              background: BG,
            }}>
              {/* Rendered login page preview */}
              <div style={{ padding: "24px 20px", display: "flex", flexDirection: "column", gap: 16, alignItems: "center" }}>
                <div style={{ fontSize: 20, fontWeight: 600, color: FG }}>Welcome back</div>
                <div style={{ width: "100%", display: "flex", flexDirection: "column", gap: 12 }}>
                  <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
                    <span style={{ fontSize: 11, color: MUTED, fontWeight: 500 }}>Email</span>
                    <div style={{ height: 40, borderRadius: 8, border: `1px solid ${BORDER}`, background: SURFACE2, display: "flex", alignItems: "center", padding: "0 12px" }}>
                      <span style={{ fontSize: 13, color: `rgba(231,229,228,0.4)` }}>you@example.com</span>
                    </div>
                  </div>
                  <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
                    <span style={{ fontSize: 11, color: MUTED, fontWeight: 500 }}>Password</span>
                    <div style={{ height: 40, borderRadius: 8, border: `1px solid ${BORDER}`, background: SURFACE2, display: "flex", alignItems: "center", padding: "0 12px" }}>
                      <span style={{ fontSize: 13, color: `rgba(231,229,228,0.4)` }}>••••••••</span>
                    </div>
                  </div>
                  <div style={{ height: 40, borderRadius: 8, background: `linear-gradient(180deg, ${GOLD}, rgba(201,162,76,0.8))`, display: "flex", alignItems: "center", justifyContent: "center", marginTop: 4 }}>
                    <span style={{ fontSize: 13, fontWeight: 600, color: BG }}>Sign in</span>
                  </div>
                  <div style={{ textAlign: "center", marginTop: 4 }}>
                    <span style={{ fontSize: 11, color: MUTED }}>Forgot password?</span>
                  </div>
                </div>
              </div>
            </div>
          </div>

          {/* File list (collapsible) */}
          <div>
            <div style={{ fontFamily: MONO, fontSize: 8.5, letterSpacing: "0.1em", textTransform: "uppercase" as const, color: MUTED, opacity: 0.5, marginBottom: 8 }}>Files</div>
            {[
              { path: "src/pages/login.tsx", status: "created", lines: 89 },
              { path: "src/components/AuthForm.tsx", status: "created", lines: 156 },
              { path: "src/lib/auth.ts", status: "modified", lines: 45 },
            ].map((f, i) => (
              <div key={i} style={{ display: "flex", alignItems: "center", gap: 8, padding: "8px 10px", borderRadius: 6, background: SURFACE2, border: `0.5px solid ${BORDER}`, marginBottom: 6 }}>
                <div style={{
                  width: 6, height: 6, borderRadius: "50%",
                  background: f.status === "created" ? "rgba(134,239,172,0.8)" : "rgba(250,204,21,0.8)",
                  flexShrink: 0,
                }} />
                <span style={{ fontFamily: MONO, fontSize: 10.5, color: FG, letterSpacing: "0.02em" }}>{f.path}</span>
                <span style={{ fontFamily: MONO, fontSize: 9, color: MUTED, marginLeft: "auto", opacity: 0.5 }}>{f.lines} lines</span>
              </div>
            ))}
          </div>
        </div>

        {/* Actions */}
        <div style={{ padding: "10px 16px 14px", borderTop: `1px solid ${BORDER}`, display: "flex", gap: 8, background: SURFACE }}>
          <div style={{
            flex: 1,
            height: 40,
            borderRadius: 8,
            background: `linear-gradient(180deg, ${GOLD}, rgba(201,162,76,0.8))`,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            gap: 6,
            cursor: "pointer",
          }}>
            <svg width="14" height="14" viewBox="0 0 16 16" fill="none"><path d="M2 8h12M8 2l6 6-6 6" stroke={BG} strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/></svg>
            <span style={{ fontFamily: MONO, fontSize: 10.5, letterSpacing: "0.06em", color: BG, fontWeight: 600 }}>SHIP IT</span>
          </div>
          <div style={{
            width: 40,
            height: 40,
            borderRadius: 8,
            border: `1px solid ${BORDER}`,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            cursor: "pointer",
            background: "transparent",
          }}>
            <svg width="14" height="14" viewBox="0 0 16 16" fill="none"><path d="M4 4l8 8M12 4l-8 8" stroke={MUTED} strokeWidth="1.3" strokeLinecap="round"/></svg>
          </div>
        </div>
      </div>

      {/* Bottom nav */}
      <div style={{ height: 56, flexShrink: 0, display: "flex", alignItems: "center", padding: "0 8px", borderTop: `1px solid ${BORDER}`, background: "rgba(12,10,9,0.96)", zIndex: 20 }}>
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
