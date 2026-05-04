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

const fileTree = [
  { name: "src", type: "folder", depth: 0, open: true },
  { name: "auth", type: "folder", depth: 1, open: true },
  { name: "callback.tsx", type: "file", depth: 2, active: true, lang: "tsx" },
  { name: "useSession.ts", type: "file", depth: 2, lang: "ts" },
  { name: "components", type: "folder", depth: 1, open: false },
  { name: "pages", type: "folder", depth: 1, open: false },
  { name: "lib", type: "folder", depth: 1, open: false },
  { name: "supabase.ts", type: "file", depth: 1, lang: "ts" },
  { name: "package.json", type: "file", depth: 0, lang: "json" },
  { name: "tailwind.config.ts", type: "file", depth: 0, lang: "ts" },
];

const codeLines = [
  { n: 28, t: "  const session = useSession();" },
  { n: 29, t: "" },
  { n: 30, t: "  useEffect(() => {" },
  { n: 31, t: "    const redirectTo = searchParams.get('redirectTo');" },
  { n: 32, t: "" },
  { n: 33, t: "    // BUG: session may still be loading here" },
  { n: 34, t: "    if (session.user) {", highlight: true },
  { n: 35, t: "      router.push(redirectTo ?? '/dashboard');" },
  { n: 36, t: "    }" },
  { n: 37, t: "  }, [redirectTo]);" },
  { n: 38, t: "" },
  { n: 39, t: "  // FIX: wait for session to resolve first" },
  { n: 40, t: "  if (session.isLoading) return <LoadingScreen />;", fix: true },
];

const messages = [
  {
    role: "user",
    content: "The auth redirect is broken after login — blank screen.",
  },
  {
    role: "assistant",
    content: "Found it. `callback.tsx` line 34 — `session.user` is read before loading resolves. Fix is on line 40.",
    file: "src/auth/callback.tsx",
    line: 34,
  },
];

function FileIcon({ lang }: { lang?: string }) {
  const color = lang === "tsx" || lang === "ts" ? PHOSPHOR : lang === "json" ? GOLD : MUTED;
  return (
    <svg width="12" height="12" viewBox="0 0 16 16" fill="none">
      <path d="M3 2h7l4 4v8a1 1 0 01-1 1H3a1 1 0 01-1-1V3a1 1 0 011-1z" stroke={color} strokeWidth="1.1"/>
      <path d="M10 2v4h4" stroke={color} strokeWidth="1.1" strokeLinecap="round"/>
    </svg>
  );
}

function FolderIcon({ open }: { open?: boolean }) {
  return (
    <svg width="12" height="12" viewBox="0 0 16 16" fill="none">
      <path d={open ? "M1 5h14v8a1 1 0 01-1 1H2a1 1 0 01-1-1V5z" : "M1 4h6l2 2h5a1 1 0 011 1v6a1 1 0 01-1 1H2a1 1 0 01-1-1V5a1 1 0 011-1z"} stroke={GOLD} strokeWidth="1.1" opacity="0.7"/>
    </svg>
  );
}

export function DesktopWorkspace() {
  return (
    <div style={{ width: 1280, height: 800, background: BG, display: "flex", flexDirection: "column", fontFamily: SANS, overflow: "hidden" }}>

      {/* ── Header ── */}
      <div style={{ height: 46, flexShrink: 0, display: "flex", alignItems: "center", padding: "0 16px", borderBottom: `1px solid ${BORDER}`, background: "rgba(12,10,9,0.95)", gap: 12 }}>
        {/* Logo */}
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <div style={{ width: 22, height: 22, borderRadius: 6, background: `linear-gradient(135deg, ${EMBER}, rgba(146,64,14,0.4))`, display: "flex", alignItems: "center", justifyContent: "center" }}>
            <svg width="12" height="12" viewBox="0 0 16 16" fill="none"><circle cx="8" cy="8" r="5" stroke={FG} strokeWidth="1.4"/><path d="M8 4v4l2.5 2" stroke={FG} strokeWidth="1.2" strokeLinecap="round"/></svg>
          </div>
          <span style={{ fontFamily: MONO, fontSize: 11, letterSpacing: "0.08em", color: `rgba(231,229,228,0.5)` }}>DEV</span>
        </div>

        <span style={{ color: BORDER, fontSize: 14 }}>/</span>

        {/* Project selector */}
        <div style={{ display: "flex", alignItems: "center", gap: 4, padding: "4px 10px", borderRadius: 6, border: `0.5px solid ${BORDER}`, cursor: "pointer", background: SURFACE }}>
          <div style={{ width: 5, height: 5, borderRadius: "50%", background: PHOSPHOR, boxShadow: `0 0 5px ${PHOSPHOR}` }} />
          <span style={{ fontFamily: MONO, fontSize: 11, color: FG, letterSpacing: "0.04em" }}>Compani</span>
          <svg width="10" height="10" viewBox="0 0 12 12" fill="none" style={{ marginLeft: 4 }}><path d="M3 4.5L6 7.5L9 4.5" stroke={MUTED} strokeWidth="1.3" strokeLinecap="round"/></svg>
        </div>

        {/* Branch / status */}
        <div style={{ display: "flex", alignItems: "center", gap: 6, marginLeft: 4 }}>
          <svg width="12" height="12" viewBox="0 0 16 16" fill="none"><circle cx="4" cy="4" r="2" stroke={MUTED} strokeWidth="1.2"/><circle cx="4" cy="12" r="2" stroke={MUTED} strokeWidth="1.2"/><circle cx="12" cy="4" r="2" stroke={MUTED} strokeWidth="1.2"/><path d="M4 6v4M4 6c0-1 8-1 8 0" stroke={MUTED} strokeWidth="1.2" strokeLinecap="round"/></svg>
          <span style={{ fontFamily: MONO, fontSize: 10, color: MUTED, opacity: 0.6 }}>main</span>
        </div>

        <div style={{ marginLeft: "auto", display: "flex", alignItems: "center", gap: 14 }}>
          {/* Other projects pills */}
          {projects.slice(1).map(p => (
            <span key={p} style={{ fontFamily: MONO, fontSize: 9.5, color: MUTED, opacity: 0.4, cursor: "pointer", letterSpacing: "0.04em" }}>{p}</span>
          ))}
          <div style={{ width: 1, height: 16, background: BORDER }} />
          <span style={{ fontFamily: MONO, fontSize: 9, letterSpacing: "0.1em", textTransform: "uppercase" as const, color: PHOSPHOR, opacity: 0.6 }}>Session active</span>
        </div>
      </div>

      {/* ── Body ── */}
      <div style={{ flex: 1, display: "flex", overflow: "hidden" }}>

        {/* Left: Chat */}
        <div style={{ width: 420, flexShrink: 0, display: "flex", flexDirection: "column", borderRight: `1px solid ${BORDER}`, background: BG }}>
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
                  {m.file && (
                    <div style={{ marginTop: 8, padding: "6px 10px", borderRadius: 6, background: SURFACE2, border: `0.5px solid ${BORDER}`, display: "flex", alignItems: "center", gap: 8, cursor: "pointer" }}>
                      <FileIcon lang="tsx" />
                      <span style={{ fontFamily: MONO, fontSize: 10, color: PHOSPHOR }}>{m.file}</span>
                      <span style={{ fontFamily: MONO, fontSize: 9, color: MUTED, marginLeft: "auto", opacity: 0.55 }}>line {m.line}</span>
                      <div style={{ padding: "2px 7px", borderRadius: 3, background: `rgba(201,162,76,0.12)`, border: `0.5px solid rgba(201,162,76,0.25)`, fontFamily: MONO, fontSize: 8.5, color: GOLD, letterSpacing: "0.06em" }}>
                        OPEN
                      </div>
                    </div>
                  )}
                </div>
              )
            )}

            {/* Apply fix suggestion */}
            <div style={{ padding: "10px 12px", borderRadius: 8, border: `0.5px solid rgba(201,162,76,0.22)`, background: `rgba(201,162,76,0.04)` }}>
              <div style={{ fontFamily: MONO, fontSize: 8.5, letterSpacing: "0.1em", textTransform: "uppercase" as const, color: GOLD, opacity: 0.7, marginBottom: 6 }}>Suggested fix</div>
              <div style={{ fontSize: 12, color: `rgba(231,229,228,0.75)`, lineHeight: 1.5, marginBottom: 8 }}>
                Add <code style={{ fontFamily: MONO, background: SURFACE2, padding: "1px 5px", borderRadius: 3, fontSize: 11, color: PHOSPHOR }}>if (session.isLoading) return null</code> before the redirect check.
              </div>
              <div style={{ display: "flex", gap: 6 }}>
                <div style={{ padding: "5px 12px", borderRadius: 4, background: `linear-gradient(180deg, ${GOLD}, rgba(201,162,76,0.75))`, fontFamily: MONO, fontSize: 9.5, letterSpacing: "0.08em", color: BG, cursor: "pointer", fontWeight: 600 }}>
                  Apply fix
                </div>
                <div style={{ padding: "5px 12px", borderRadius: 4, border: `0.5px solid ${BORDER}`, fontFamily: MONO, fontSize: 9.5, letterSpacing: "0.08em", color: MUTED, cursor: "pointer" }}>
                  Show diff
                </div>
              </div>
            </div>
          </div>

          {/* Input */}
          <div style={{ padding: "8px 14px 12px", flexShrink: 0, borderTop: `1px solid ${BORDER}` }}>
            <div style={{ display: "flex", alignItems: "flex-end", gap: 8, padding: "10px 12px", borderRadius: 10, background: SURFACE, border: `1px solid ${BORDER}` }}>
              <span style={{ fontSize: 13, color: MUTED, opacity: 0.4, flex: 1 }}>Say it plainly…</span>
              <div style={{ display: "flex", gap: 6, flexShrink: 0 }}>
                <div style={{ width: 30, height: 30, borderRadius: 7, border: `1px solid ${BORDER}`, display: "flex", alignItems: "center", justifyContent: "center", cursor: "pointer" }}>
                  <svg width="14" height="14" viewBox="0 0 20 20" fill="none"><circle cx="10" cy="8" r="3" stroke={MUTED} strokeWidth="1.3"/><path d="M4 18c0-3.3 2.7-6 6-6s6 2.7 6 6" stroke={MUTED} strokeWidth="1.3" strokeLinecap="round"/></svg>
                </div>
                <div style={{ width: 30, height: 30, borderRadius: 7, background: GOLD, display: "flex", alignItems: "center", justifyContent: "center", cursor: "pointer" }}>
                  <svg width="13" height="13" viewBox="0 0 16 16" fill="none"><path d="M2 14L14 8L2 2v5l8 1-8 1v5z" fill={BG}/></svg>
                </div>
              </div>
            </div>
          </div>
        </div>

        {/* Resize handle */}
        <div style={{ width: 3, flexShrink: 0, background: BORDER, cursor: "col-resize" }} />

        {/* Right: Tabs + content */}
        <div style={{ flex: 1, display: "flex", flexDirection: "column", overflow: "hidden" }}>
          {/* Tab bar */}
          <div style={{ height: 38, flexShrink: 0, display: "flex", alignItems: "stretch", borderBottom: `1px solid ${BORDER}`, background: SURFACE, paddingLeft: 8 }}>
            {[
              { label: "Files", active: false, icon: <svg width="12" height="12" viewBox="0 0 16 16" fill="none"><path d="M3 2h7l4 4v8a1 1 0 01-1 1H3a1 1 0 01-1-1V3a1 1 0 011-1z" stroke="currentColor" strokeWidth="1.2"/></svg> },
              { label: "Code", active: true, icon: <svg width="12" height="12" viewBox="0 0 16 16" fill="none"><path d="M5 4L1 8l4 4M11 4l4 4-4 4M9 2l-2 12" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round"/></svg> },
              { label: "Preview", active: false, icon: <svg width="12" height="12" viewBox="0 0 16 16" fill="none"><rect x="1" y="3" width="14" height="10" rx="1.5" stroke="currentColor" strokeWidth="1.2"/><path d="M6 7l3 2-3 2V7z" fill="currentColor"/></svg> },
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
                  transition: "all 160ms ease",
                }}
              >
                {t.icon}
                {t.label}
              </div>
            ))}
          </div>

          {/* Two-column: file tree + code viewer */}
          <div style={{ flex: 1, display: "flex", overflow: "hidden" }}>
            {/* File tree */}
            <div style={{ width: 220, flexShrink: 0, borderRight: `1px solid ${BORDER}`, overflowY: "auto", background: SURFACE, padding: "8px 0" }}>
              <div style={{ padding: "4px 10px 6px", fontFamily: MONO, fontSize: 8.5, letterSpacing: "0.12em", textTransform: "uppercase" as const, color: MUTED, opacity: 0.45 }}>
                Compani
              </div>
              {fileTree.map((f, i) => (
                <div
                  key={i}
                  style={{
                    display: "flex", alignItems: "center", gap: 6,
                    padding: `4px 10px 4px ${10 + f.depth * 14}px`,
                    background: f.active ? `rgba(6,182,212,0.07)` : "transparent",
                    borderLeft: f.active ? `2px solid ${PHOSPHOR}` : "2px solid transparent",
                    cursor: "pointer",
                  }}
                >
                  {f.type === "folder" ? <FolderIcon open={f.open} /> : <FileIcon lang={f.lang} />}
                  <span style={{ fontFamily: MONO, fontSize: 11, color: f.active ? PHOSPHOR : f.type === "folder" ? `rgba(231,229,228,0.7)` : `rgba(231,229,228,0.55)`, letterSpacing: "0.02em" }}>
                    {f.name}
                  </span>
                </div>
              ))}
            </div>

            {/* Code viewer */}
            <div style={{ flex: 1, overflowY: "auto", background: BG, padding: "12px 0" }}>
              {/* File breadcrumb */}
              <div style={{ display: "flex", alignItems: "center", gap: 6, padding: "0 16px 10px", borderBottom: `1px solid ${BORDER}`, marginBottom: 8 }}>
                <FileIcon lang="tsx" />
                <span style={{ fontFamily: MONO, fontSize: 10.5, color: PHOSPHOR, letterSpacing: "0.03em" }}>src / auth / callback.tsx</span>
                <div style={{ marginLeft: "auto", display: "flex", gap: 6 }}>
                  <div style={{ padding: "3px 8px", borderRadius: 3, background: `rgba(180,83,9,0.12)`, border: `0.5px solid rgba(180,83,9,0.3)`, fontFamily: MONO, fontSize: 8.5, color: EMBER, letterSpacing: "0.06em" }}>
                    BUG LINE 34
                  </div>
                </div>
              </div>

              {/* Code lines */}
              {codeLines.map((line) => (
                <div
                  key={line.n}
                  style={{
                    display: "flex",
                    background: line.highlight ? `rgba(180,83,9,0.12)` : line.fix ? `rgba(6,182,212,0.06)` : "transparent",
                    borderLeft: line.highlight ? `2px solid ${EMBER}` : line.fix ? `2px solid ${PHOSPHOR}` : "2px solid transparent",
                    padding: "1.5px 0",
                  }}
                >
                  <span style={{ fontFamily: MONO, fontSize: 11, color: MUTED, opacity: 0.35, width: 40, textAlign: "right" as const, paddingRight: 16, flexShrink: 0, userSelect: "none" as const }}>
                    {line.n}
                  </span>
                  <span style={{ fontFamily: MONO, fontSize: 11.5, lineHeight: 1.7, color: line.highlight ? `rgba(231,229,228,0.9)` : line.fix ? `rgba(6,182,212,0.85)` : `rgba(231,229,228,0.65)`, whiteSpace: "pre" as const }}>
                    {line.t}
                  </span>
                </div>
              ))}

              {/* Diff preview */}
              <div style={{ margin: "16px 16px 0", padding: "10px 14px", borderRadius: 8, background: SURFACE, border: `0.5px solid ${BORDER}` }}>
                <div style={{ fontFamily: MONO, fontSize: 8.5, letterSpacing: "0.1em", textTransform: "uppercase" as const, color: GOLD, opacity: 0.6, marginBottom: 8 }}>Proposed change</div>
                <div style={{ fontFamily: MONO, fontSize: 11, lineHeight: 1.8 }}>
                  <div style={{ color: "#ef4444", background: "rgba(239,68,68,0.06)", padding: "1px 8px", borderRadius: 3, marginBottom: 2 }}>
                    - if (session.user) &#123;
                  </div>
                  <div style={{ color: "#22c55e", background: "rgba(34,197,94,0.06)", padding: "1px 8px", borderRadius: 3, marginBottom: 2 }}>
                    + if (session.isLoading) return &lt;LoadingScreen /&gt;;
                  </div>
                  <div style={{ color: "#22c55e", background: "rgba(34,197,94,0.06)", padding: "1px 8px", borderRadius: 3 }}>
                    + if (session.user) &#123;
                  </div>
                </div>
                <div style={{ display: "flex", gap: 6, marginTop: 10 }}>
                  <div style={{ padding: "5px 14px", borderRadius: 4, background: `linear-gradient(180deg, ${GOLD}, rgba(201,162,76,0.75))`, fontFamily: MONO, fontSize: 9.5, letterSpacing: "0.08em", color: BG, cursor: "pointer", fontWeight: 600 }}>
                    Apply
                  </div>
                  <div style={{ padding: "5px 12px", borderRadius: 4, border: `0.5px solid ${BORDER}`, fontFamily: MONO, fontSize: 9.5, color: MUTED, cursor: "pointer" }}>
                    Discard
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
