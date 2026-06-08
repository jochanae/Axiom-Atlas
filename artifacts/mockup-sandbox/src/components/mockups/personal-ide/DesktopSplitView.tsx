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

export function DesktopSplitView() {
  return (
    <div style={{ width: 1280, height: 800, background: BG, display: "flex", flexDirection: "column", fontFamily: SANS, overflow: "hidden" }}>

      {/* ── Header ── */}
      <div style={{ height: 46, flexShrink: 0, display: "flex", alignItems: "center", padding: "0 16px", borderBottom: `1px solid ${BORDER}`, background: "rgba(12,10,9,0.95)", gap: 12 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <div style={{ width: 22, height: 22, borderRadius: 6, background: `linear-gradient(135deg, ${EMBER}, rgba(146,64,14,0.4))`, display: "flex", alignItems: "center", justifyContent: "center" }}>
            <svg width="12" height="12" viewBox="0 0 16 16" fill="none"><circle cx="8" cy="8" r="5" stroke={FG} strokeWidth="1.4"/><path d="M8 4v4l2.5 2" stroke={FG} strokeWidth="1.2" strokeLinecap="round"/></svg>
          </div>
          <span style={{ fontFamily: MONO, fontSize: 11, letterSpacing: "0.08em", color: `rgba(231,229,228,0.5)` }}>WORKSPACE</span>
        </div>

        <span style={{ color: BORDER, fontSize: 14 }}>/</span>

        <div style={{ display: "flex", alignItems: "center", gap: 4, padding: "4px 10px", borderRadius: 6, border: `0.5px solid ${BORDER}`, cursor: "pointer", background: SURFACE }}>
          <div style={{ width: 5, height: 5, borderRadius: "50%", background: PHOSPHOR, boxShadow: `0 0 5px ${PHOSPHOR}` }} />
          <span style={{ fontFamily: MONO, fontSize: 11, color: FG, letterSpacing: "0.04em" }}>Compani</span>
        </div>

        <div style={{ marginLeft: "auto", display: "flex", alignItems: "center", gap: 14 }}>
          <span style={{ fontFamily: MONO, fontSize: 9, letterSpacing: "0.1em", textTransform: "uppercase" as const, color: PHOSPHOR, opacity: 0.6 }}>3 files changed · Login page</span>
        </div>
      </div>

      {/* ── Body: Split View ── */}
      <div style={{ flex: 1, display: "flex", overflow: "hidden" }}>

        {/* Left: Chat (40%) */}
        <div style={{ width: "40%", flexShrink: 0, display: "flex", flexDirection: "column", borderRight: `1px solid ${BORDER}`, background: BG }}>
          {/* Messages */}
          <div style={{ flex: 1, overflowY: "auto", padding: "20px 18px 10px", display: "flex", flexDirection: "column", gap: 18 }}>
            {messages.map((m, i) =>
              m.role === "user" ? (
                <div key={i} style={{ display: "flex", justifyContent: "flex-end" }}>
                  <div style={{ maxWidth: "76%", padding: "10px 14px", borderRadius: "12px 12px 3px 12px", background: "rgba(146,64,14,0.10)", border: "1px solid rgba(146,64,14,0.20)", fontSize: 13, lineHeight: 1.6, color: `rgba(231,229,228,0.85)` }}>
                    {m.content}
                  </div>
                </div>
              ) : (
                <div key={i}>
                  <div style={{ fontFamily: MONO, fontSize: 8.5, letterSpacing: "0.1em", textTransform: "uppercase" as const, color: GOLD, opacity: 0.45, marginBottom: 6 }}>Atlas</div>
                  <div style={{ fontSize: 13, lineHeight: 1.65, color: `rgba(231,229,228,0.85)` }}>{m.content}</div>
                </div>
              )
            )}
          </div>

          {/* Input */}
          <div style={{ padding: "8px 14px 12px", flexShrink: 0, borderTop: `1px solid ${BORDER}` }}>
            <div style={{ display: "flex", alignItems: "flex-end", gap: 8, padding: "10px 12px", borderRadius: 10, background: SURFACE, border: `1px solid ${BORDER}` }}>
              <span style={{ fontSize: 13, color: MUTED, opacity: 0.4, flex: 1 }}>Say it plainly…</span>
              <div style={{ width: 30, height: 30, borderRadius: 7, background: GOLD, display: "flex", alignItems: "center", justifyContent: "center", cursor: "pointer" }}>
                <svg width="13" height="13" viewBox="0 0 16 16" fill="none"><path d="M2 14L14 8L2 2v5l8 1-8 1v5z" fill={BG}/></svg>
              </div>
            </div>
          </div>
        </div>

        {/* Draggable divider */}
        <div style={{
          width: 4,
          flexShrink: 0,
          background: BORDER,
          cursor: "col-resize",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
        }}>
          <div style={{ width: 2, height: 24, borderRadius: 1, background: `rgba(120,113,108,0.5)` }} />
        </div>

        {/* Right: Visual Preview (60%) */}
        <div style={{ flex: 1, display: "flex", flexDirection: "column", overflow: "hidden", background: SURFACE }}>

          {/* Tab bar */}
          <div style={{ height: 38, flexShrink: 0, display: "flex", alignItems: "stretch", borderBottom: `1px solid ${BORDER}`, background: SURFACE, paddingLeft: 8 }}>
            {[
              { label: "Preview", active: true },
              { label: "Summary", active: false },
              { label: "Files", active: false },
            ].map(t => (
              <div
                key={t.label}
                style={{
                  display: "flex", alignItems: "center", gap: 6, padding: "0 14px",
                  borderBottom: t.active ? `2px solid ${GOLD}` : "2px solid transparent",
                  color: t.active ? GOLD : MUTED,
                  cursor: "pointer", fontSize: 11,
                  fontFamily: MONO, letterSpacing: "0.08em",
                  opacity: t.active ? 1 : 0.55,
                }}
              >
                {t.label}
              </div>
            ))}
          </div>

          {/* Preview content */}
          <div style={{ flex: 1, overflowY: "auto", padding: 20, display: "flex", flexDirection: "column", gap: 16 }}>

            {/* Rendered login page */}
            <div style={{
              borderRadius: 14,
              border: `1px solid ${BORDER}`,
              overflow: "hidden",
              background: BG,
              maxWidth: 420,
              alignSelf: "center",
              width: "100%",
            }}>
              <div style={{ padding: "32px 28px", display: "flex", flexDirection: "column", gap: 20, alignItems: "center" }}>
                <div style={{ fontSize: 22, fontWeight: 600, color: FG }}>Welcome back</div>
                <div style={{ width: "100%", display: "flex", flexDirection: "column", gap: 14 }}>
                  <div style={{ display: "flex", flexDirection: "column", gap: 5 }}>
                    <span style={{ fontSize: 12, color: MUTED, fontWeight: 500 }}>Email</span>
                    <div style={{ height: 44, borderRadius: 10, border: `1px solid ${BORDER}`, background: SURFACE2, display: "flex", alignItems: "center", padding: "0 14px" }}>
                      <span style={{ fontSize: 14, color: `rgba(231,229,228,0.4)` }}>you@example.com</span>
                    </div>
                  </div>
                  <div style={{ display: "flex", flexDirection: "column", gap: 5 }}>
                    <span style={{ fontSize: 12, color: MUTED, fontWeight: 500 }}>Password</span>
                    <div style={{ height: 44, borderRadius: 10, border: `1px solid ${BORDER}`, background: SURFACE2, display: "flex", alignItems: "center", padding: "0 14px" }}>
                      <span style={{ fontSize: 14, color: `rgba(231,229,228,0.4)` }}>••••••••</span>
                    </div>
                  </div>
                  <div style={{ height: 44, borderRadius: 10, background: `linear-gradient(180deg, ${GOLD}, rgba(201,162,76,0.8))`, display: "flex", alignItems: "center", justifyContent: "center", marginTop: 4, cursor: "pointer" }}>
                    <span style={{ fontSize: 14, fontWeight: 600, color: BG }}>Sign in</span>
                  </div>
                  <div style={{ textAlign: "center", marginTop: 4 }}>
                    <span style={{ fontSize: 12, color: MUTED }}>Forgot password?</span>
                  </div>
                </div>
              </div>
            </div>

            {/* Summary */}
            <div style={{ padding: "12px 14px", borderRadius: 10, background: `rgba(201,162,76,0.05)`, border: `0.5px solid rgba(201,162,76,0.18)` }}>
              <div style={{ fontSize: 13, color: `rgba(231,229,228,0.8)`, lineHeight: 1.5 }}>
                Built <code style={{ fontFamily: MONO, fontSize: 11, color: PHOSPHOR, background: `rgba(6,182,212,0.1)`, padding: "1px 4px", borderRadius: 3 }}>src/pages/login.tsx</code> with email/password fields, validation, and dark theme styling.
              </div>
            </div>

            {/* File list */}
            <div>
              <div style={{ fontFamily: MONO, fontSize: 8.5, letterSpacing: "0.1em", textTransform: "uppercase" as const, color: MUTED, opacity: 0.5, marginBottom: 8 }}>Files</div>
              {[
                { path: "src/pages/login.tsx", status: "created", lines: 89 },
                { path: "src/components/AuthForm.tsx", status: "created", lines: 156 },
                { path: "src/lib/auth.ts", status: "modified", lines: 45 },
              ].map((f, i) => (
                <div key={i} style={{ display: "flex", alignItems: "center", gap: 8, padding: "8px 10px", borderRadius: 6, background: SURFACE2, border: `0.5px solid ${BORDER}`, marginBottom: 6 }}>
                  <div style={{ width: 6, height: 6, borderRadius: "50%", background: f.status === "created" ? "rgba(134,239,172,0.8)" : "rgba(250,204,21,0.8)", flexShrink: 0 }} />
                  <span style={{ fontFamily: MONO, fontSize: 10.5, color: FG, letterSpacing: "0.02em" }}>{f.path}</span>
                  <span style={{ fontFamily: MONO, fontSize: 9, color: MUTED, marginLeft: "auto", opacity: 0.5 }}>{f.lines} lines</span>
                </div>
              ))}
            </div>
          </div>

          {/* Actions bar */}
          <div style={{ padding: "12px 16px", borderTop: `1px solid ${BORDER}`, display: "flex", gap: 10, background: SURFACE }}>
            <div style={{
              flex: 1,
              height: 40,
              borderRadius: 8,
              background: `linear-gradient(180deg, ${GOLD}, rgba(201,162,76,0.8))`,
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              gap: 8,
              cursor: "pointer",
            }}>
              <svg width="14" height="14" viewBox="0 0 16 16" fill="none"><path d="M2 8h12M8 2l6 6-6 6" stroke={BG} strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/></svg>
              <span style={{ fontFamily: MONO, fontSize: 11, letterSpacing: "0.06em", color: BG, fontWeight: 600 }}>SHIP IT</span>
            </div>
            <div style={{
              padding: "0 16px",
              height: 40,
              borderRadius: 8,
              border: `1px solid ${BORDER}`,
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              cursor: "pointer",
              background: "transparent",
            }}>
              <span style={{ fontFamily: MONO, fontSize: 10.5, color: MUTED, letterSpacing: "0.04em" }}>Adjust</span>
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
      </div>
    </div>
  );
}
