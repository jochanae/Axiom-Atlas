import { useState, useRef, useEffect } from "react";

// ── localStorage helpers — exact from original ────────────────────────────────
const LS_DEFAULT = "axiom_builder_default";
const LS_FREQ    = "axiom_builder_freq";

function lsGetDefault(): string {
  try { return localStorage.getItem(LS_DEFAULT) || ""; } catch { return ""; }
}
function lsGetFreq(): Record<string, number> {
  try { const r = localStorage.getItem(LS_FREQ); return r ? JSON.parse(r) : {}; } catch { return {}; }
}
function lsSaveSelection(builder: string) {
  try {
    localStorage.setItem(LS_DEFAULT, builder);
    const freq = lsGetFreq();
    freq[builder] = (freq[builder] || 0) + 1;
    localStorage.setItem(LS_FREQ, JSON.stringify(freq));
  } catch {}
}
function lsGetTopBuilders(allOptions: string[], limit = 3): string[] {
  const freq = lsGetFreq();
  return allOptions
    .filter(b => (freq[b] || 0) > 0)
    .sort((a, b) => (freq[b] || 0) - (freq[a] || 0))
    .slice(0, limit);
}

// ── Constants — exact from original ──────────────────────────────────────────
const BUILDER_OPTIONS = [
  "Lovable", "Cursor", "Replit", "Bolt", "Windsurf",
  "v0 by Vercel", "Bubble", "FlutterFlow", "GitHub Copilot", "Other",
];

const EXAMPLE_CHIPS = [
  "Add a delete button to project cards",
  "Fix the z-index on a dropdown menu",
  "Add Google auth to my app",
  "Create a new page for user settings",
  "Make the header sticky on scroll",
];

const MAX_SIZE_MB = 5;

interface AttachedImage {
  id: string;
  base64: string;
  mediaType: string;
  preview: string;
  name: string;
}

interface Props {
  platform?: string;
  readinessScore?: number;
  activeProjectName?: string;
  onClose: () => void;
}

export function QuickPromptSheet({ platform, readinessScore = 0, activeProjectName, onClose }: Props) {
  // Detect builder from platform string (matches original detectedBuilder logic)
  const detectedFromPlatform = (): string => {
    if (!platform) return "";
    const lc = platform.toLowerCase();
    if (lc.includes("replit")) return "Replit";
    if (lc.includes("lovable")) return "Lovable";
    if (lc.includes("cursor")) return "Cursor";
    return "";
  };

  const [selectedBuilder, setSelectedBuilder] = useState<string>(() => {
    const saved = lsGetDefault();
    if (saved) return saved;
    return detectedFromPlatform();
  });
  const [showDropdown, setShowDropdown] = useState(false);
  const dropdownRef = useRef<HTMLDivElement>(null);
  const [customBuilderName, setCustomBuilderName] = useState("");
  const [input, setInput] = useState("");
  const [projectContext, setProjectContext] = useState(activeProjectName ?? "");
  const [showContext, setShowContext] = useState(false);
  const [output, setOutput] = useState<string | null>(null);
  const [isGenerating, setIsGenerating] = useState(false);
  const [copied, setCopied] = useState(false);
  const [attachedImages, setAttachedImages] = useState<AttachedImage[]>([]);
  const [lightboxSrc, setLightboxSrc] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const outputRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!output) return;
    const id = setTimeout(() => {
      outputRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
    }, 50);
    return () => clearTimeout(id);
  }, [output]);

  useEffect(() => {
    if (!showDropdown) return;
    const handler = (e: MouseEvent) => {
      if (dropdownRef.current && !dropdownRef.current.contains(e.target as Node)) {
        setShowDropdown(false);
      }
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [showDropdown]);

  const handleBuilderSelect = (builder: string) => {
    setSelectedBuilder(builder);
    lsSaveSelection(builder);
    setShowDropdown(false);
  };

  const effectiveBuilder = selectedBuilder === "Other"
    ? customBuilderName || "Other"
    : selectedBuilder;

  const fileToBase64 = (file: File): Promise<string> =>
    new Promise(resolve => {
      const reader = new FileReader();
      reader.onload = () => resolve(reader.result as string);
      reader.readAsDataURL(file);
    });

  const handleImageSelect = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(e.target.files || []).slice(0, 10 - attachedImages.length);
    const results: AttachedImage[] = [];
    for (const file of files) {
      if (file.size > MAX_SIZE_MB * 1024 * 1024) continue;
      const dataUrl = await fileToBase64(file);
      results.push({
        id: crypto.randomUUID(), base64: dataUrl.split(",")[1],
        mediaType: file.type, preview: dataUrl, name: file.name,
      });
    }
    if (results.length > 0) setAttachedImages(prev => [...prev, ...results].slice(0, 10));
    e.target.value = "";
  };

  const removeImage = (id: string) => {
    setAttachedImages(prev => prev.filter(img => img.id !== id));
  };

  const handleGenerate = async () => {
    if ((!input.trim() && attachedImages.length === 0) || isGenerating) return;
    if (!effectiveBuilder) return;
    setIsGenerating(true);
    setOutput(null);
    const baseDescription = input.trim() || "Analyze the attached image(s) and generate an appropriate prompt.";
    const fullDescription = projectContext.trim()
      ? `${baseDescription}\n\nProject context:\n${projectContext.trim()}`
      : baseDescription;
    try {
      const res = await fetch("/api/quick-prompt", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ description: fullDescription, builder: effectiveBuilder }),
      });
      if (!res.ok) throw new Error("Failed");
      const text = await res.text();
      setOutput(text);
      setAttachedImages([]);
    } catch {
      setOutput("Failed to generate prompt. Please try again.");
    } finally {
      setIsGenerating(false);
    }
  };

  const handleCopy = async () => {
    if (!output) return;
    try {
      await navigator.clipboard.writeText(output);
    } catch {
      const ta = document.createElement("textarea");
      ta.value = output;
      document.body.appendChild(ta);
      ta.select();
      document.execCommand("copy");
      document.body.removeChild(ta);
    }
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const handleRegenerate = () => { setOutput(null); handleGenerate(); };

  const canGenerate = (input.trim().length > 0 || attachedImages.length > 0) &&
    !isGenerating && effectiveBuilder.length > 0;

  return (
    <>
      {/* Backdrop */}
      <div
        style={{ position: "fixed", inset: 0, zIndex: 350, background: "rgba(0,0,0,0.55)", backdropFilter: "blur(4px)" }}
        onClick={onClose}
      />

      {/* Sheet */}
      <div style={{
        position: "fixed", left: 0, right: 0, top: 0, bottom: 0, zIndex: 360,
        background: "rgba(13,11,9,0.99)",
        border: "1px solid rgba(212,175,55,0.22)",
        borderRadius: "16px 16px 0 0",
        animation: "slideUpCb 220ms ease",
        display: "flex", flexDirection: "column",
      }}>
        {/* Drag handle */}
        <div style={{ display: "flex", justifyContent: "center", padding: "10px 0 2px" }}>
          <div style={{ width: 36, height: 4, borderRadius: 2, background: "rgba(212,175,55,0.18)" }} />
        </div>

        {/* Header */}
        <div style={{
          display: "flex", alignItems: "center", justifyContent: "space-between",
          padding: "10px 16px 12px",
          borderBottom: "1px solid rgba(212,175,55,0.10)",
        }}>
          <div style={{ display: "flex", flexDirection: "column", gap: 2 }}>
            <span style={{ fontSize: 13, fontWeight: 700, color: "#D4AF37", letterSpacing: "0.06em", fontFamily: "var(--app-font-mono)" }}>
              QUICK PROMPT
            </span>
            <span style={{ fontSize: 10, color: "rgba(120,113,108,0.6)" }}>
              Generate an optimized prompt for your builder
            </span>
          </div>
          <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
            <span style={{ fontSize: 11, fontWeight: 700, color: "#D4AF37" }}>
              {readinessScore}% READY
            </span>
            <button
              onClick={onClose}
              style={{ background: "none", border: "none", cursor: "pointer", color: "rgba(120,113,108,0.55)", fontSize: 22, lineHeight: 1, padding: "2px 0 2px 4px" }}
            >×</button>
          </div>
        </div>

        {/* Scrollable content — exact original QuickPrompt JSX */}
        <div style={{ flex: 1, overflowY: "auto", padding: "16px 16px 12px", display: "flex", flexDirection: "column", gap: 16 }}>

          {/* ── Builder dropdown — exact original ── */}
          <div>
            <p style={{ fontSize: 10, fontWeight: 700, letterSpacing: "0.15em", color: "rgba(120,113,108,0.75)", textTransform: "uppercase", marginBottom: 8, fontFamily: "var(--app-font-mono)" }}>
              Where are you building?
            </p>
            <div className="relative" ref={dropdownRef}>
              {/* Trigger */}
              <button
                type="button"
                onClick={() => setShowDropdown(v => !v)}
                style={{
                  width: "100%", display: "flex", alignItems: "center", justifyContent: "space-between",
                  background: "#0D0B09",
                  border: `1px solid ${showDropdown || selectedBuilder ? "rgba(212,175,55,0.5)" : "rgba(212,175,55,0.3)"}`,
                  borderRadius: 8, padding: "11px 14px", cursor: "pointer", transition: "border-color 180ms",
                }}
              >
                <span style={{ fontSize: 14, color: selectedBuilder ? "rgba(255,255,255,0.87)" : "rgba(255,255,255,0.35)" }}>
                  {selectedBuilder || "Select your builder..."}
                </span>
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none"
                  stroke="#D4AF37" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"
                  style={{ flexShrink: 0, transform: showDropdown ? "rotate(180deg)" : "rotate(0deg)", transition: "transform 180ms" }}>
                  <polyline points="6 9 12 15 18 9" />
                </svg>
              </button>

              {/* Dropdown panel — exact original */}
              {showDropdown && (() => {
                const topBuilders = lsGetTopBuilders(BUILDER_OPTIONS, 3);
                const lastUsed = lsGetDefault();
                const remaining = BUILDER_OPTIONS.filter(b => !topBuilders.includes(b));
                return (
                  <div style={{
                    position: "absolute", top: "calc(100% + 6px)", left: 0, right: 0,
                    zIndex: 9999, background: "#0D0B09",
                    border: "1px solid rgba(212,175,55,0.3)", borderRadius: 10,
                    overflow: "hidden", boxShadow: "0 8px 32px rgba(0,0,0,0.6)",
                  }}>
                    {topBuilders.length > 0 && (
                      <>
                        <div style={{ padding: "8px 14px 4px", fontSize: 10, fontWeight: 700, letterSpacing: "0.1em", color: "rgba(212,175,55,0.6)", textTransform: "uppercase" as const }}>
                          Your Stack
                        </div>
                        {topBuilders.map(b => {
                          const isSelected = b === selectedBuilder;
                          const isLastUsed = b === lastUsed;
                          return (
                            <button key={b} type="button" onClick={() => handleBuilderSelect(b)}
                              style={{ width: "100%", display: "flex", alignItems: "center", gap: 8, padding: "10px 14px", background: isSelected ? "rgba(212,175,55,0.12)" : "transparent", border: "none", cursor: "pointer", textAlign: "left" as const, transition: "background 120ms" }}
                              onMouseEnter={e => { if (!isSelected) (e.currentTarget as HTMLButtonElement).style.background = "rgba(255,255,255,0.04)"; }}
                              onMouseLeave={e => { (e.currentTarget as HTMLButtonElement).style.background = isSelected ? "rgba(212,175,55,0.12)" : "transparent"; }}
                            >
                              <span style={{ width: 6, height: 6, borderRadius: "50%", flexShrink: 0, background: isLastUsed ? "#D4AF37" : "transparent", border: isLastUsed ? "none" : "1px solid rgba(212,175,55,0.25)" }} />
                              <span style={{ fontSize: 13, color: isSelected ? "#D4AF37" : "rgba(255,255,255,0.87)", fontWeight: isSelected ? 600 : 400 }}>{b}</span>
                              {isSelected && (
                                <svg style={{ marginLeft: "auto", flexShrink: 0 }} width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="#D4AF37" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><polyline points="20 6 9 17 4 12" /></svg>
                              )}
                            </button>
                          );
                        })}
                        <div style={{ height: 1, background: "rgba(212,175,55,0.12)", margin: "4px 0" }} />
                      </>
                    )}
                    <div style={{ padding: "8px 14px 4px", fontSize: 10, fontWeight: 700, letterSpacing: "0.1em", color: "rgba(212,175,55,0.6)", textTransform: "uppercase" as const }}>
                      All Platforms
                    </div>
                    <div style={{ maxHeight: 220, overflowY: "auto" }}>
                      {remaining.map(b => {
                        const isSelected = b === selectedBuilder;
                        return (
                          <button key={b} type="button" onClick={() => handleBuilderSelect(b)}
                            style={{ width: "100%", display: "flex", alignItems: "center", gap: 8, padding: "10px 14px", background: isSelected ? "rgba(212,175,55,0.12)" : "transparent", border: "none", cursor: "pointer", textAlign: "left" as const, transition: "background 120ms" }}
                            onMouseEnter={e => { if (!isSelected) (e.currentTarget as HTMLButtonElement).style.background = "rgba(255,255,255,0.04)"; }}
                            onMouseLeave={e => { (e.currentTarget as HTMLButtonElement).style.background = isSelected ? "rgba(212,175,55,0.12)" : "transparent"; }}
                          >
                            <span style={{ width: 6, height: 6, borderRadius: "50%", flexShrink: 0, background: "transparent", border: "1px solid rgba(212,175,55,0.2)" }} />
                            <span style={{ fontSize: 13, color: isSelected ? "#D4AF37" : "rgba(255,255,255,0.87)", fontWeight: isSelected ? 600 : 400 }}>{b}</span>
                            {isSelected && (
                              <svg style={{ marginLeft: "auto", flexShrink: 0 }} width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="#D4AF37" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><polyline points="20 6 9 17 4 12" /></svg>
                            )}
                          </button>
                        );
                      })}
                    </div>
                  </div>
                );
              })()}
            </div>

            {/* Custom builder name for "Other" */}
            {selectedBuilder === "Other" && (
              <div style={{ marginTop: 8 }}>
                <p style={{ fontSize: 10, fontWeight: 700, letterSpacing: "0.1em", color: "#D4AF37", textTransform: "uppercase", marginBottom: 6 }}>Builder Name</p>
                <input
                  type="text" value={customBuilderName}
                  onChange={e => setCustomBuilderName(e.target.value)}
                  placeholder="Type your builder name..."
                  style={{
                    width: "100%", borderRadius: 12,
                    border: "1px solid rgba(212,175,55,0.2)",
                    background: "oklch(0.25 0.012 60)",
                    padding: "10px 12px", color: "rgba(231,229,228,0.87)",
                    fontSize: 14, outline: "none", boxSizing: "border-box" as const,
                  }}
                />
              </div>
            )}
          </div>

          {/* ── Project context collapsible — exact original ── */}
          <div>
            {!showContext ? (
              <button
                onClick={() => setShowContext(true)}
                style={{ background: "none", border: "none", cursor: "pointer", color: "#D4AF37", fontSize: 11, letterSpacing: "0.04em", fontFamily: "var(--app-font-mono)", padding: 0 }}
              >
                + Add project context (optional)
              </button>
            ) : (
              <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
                  <p style={{ fontSize: 10, fontWeight: 700, letterSpacing: "0.15em", color: "rgba(120,113,108,0.75)", textTransform: "uppercase", fontFamily: "var(--app-font-mono)" }}>
                    Project context
                  </p>
                  <button onClick={() => { setShowContext(false); setProjectContext(""); }}
                    style={{ background: "none", border: "none", cursor: "pointer", color: "rgba(120,113,108,0.55)", fontSize: 11 }}>
                    Remove
                  </button>
                </div>
                <textarea
                  value={projectContext}
                  onChange={e => setProjectContext(e.target.value)}
                  placeholder="Paste your tech stack, file structure, or any relevant context..."
                  rows={3}
                  style={{
                    width: "100%", borderRadius: 12,
                    border: "1px solid rgba(212,175,55,0.2)",
                    background: "oklch(0.25 0.012 60)",
                    padding: "10px 12px", color: "rgba(231,229,228,0.87)",
                    fontSize: 13, lineHeight: 1.6, outline: "none",
                    resize: "none", boxSizing: "border-box" as const,
                    fontFamily: "inherit",
                  }}
                />
              </div>
            )}
          </div>

          {/* ── Attached images preview — exact original ── */}
          {attachedImages.length > 0 && (
            <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
              {attachedImages.map(img => (
                <div key={img.id} style={{ position: "relative" }}>
                  <img
                    src={img.preview} alt={img.name}
                    onClick={() => setLightboxSrc(img.preview)}
                    style={{ width: 72, height: 72, objectFit: "cover", borderRadius: 8, border: "1px solid rgba(212,175,55,0.3)", cursor: "zoom-in" }}
                  />
                  <button
                    onClick={() => removeImage(img.id)}
                    style={{
                      position: "absolute", top: -6, right: -6,
                      width: 18, height: 18, borderRadius: "50%",
                      background: "#D4AF37", color: "#0D0B09",
                      border: "1px solid #D4AF37", cursor: "pointer",
                      display: "flex", alignItems: "center", justifyContent: "center",
                      fontSize: 10, fontWeight: 700, lineHeight: 1,
                    }}
                  >✕</button>
                </div>
              ))}
            </div>
          )}

          {/* ── Textarea + send button — exact original ── */}
          <div>
            <p style={{ fontSize: 10, fontWeight: 700, letterSpacing: "0.15em", color: "rgba(120,113,108,0.75)", textTransform: "uppercase", marginBottom: 8, fontFamily: "var(--app-font-mono)" }}>
              What do you need to do?
            </p>
            <div style={{ position: "relative" }}>
              <textarea
                value={input}
                onChange={e => setInput(e.target.value)}
                onKeyDown={e => { if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) handleGenerate(); }}
                placeholder="Describe what you need to do in plain language..."
                rows={4}
                style={{
                  width: "100%", borderRadius: 12,
                  border: "1px solid rgba(212,175,55,0.2)",
                  background: "oklch(0.25 0.012 60)",
                  padding: "12px 44px 12px 12px",
                  color: "rgba(231,229,228,0.87)", fontSize: 13, lineHeight: 1.6,
                  outline: "none", resize: "none", transition: "border-color 150ms",
                  boxSizing: "border-box" as const, fontFamily: "inherit",
                }}
                onFocus={e => { e.currentTarget.style.borderColor = "rgba(212,175,55,0.5)"; }}
                onBlur={e => { e.currentTarget.style.borderColor = "rgba(212,175,55,0.2)"; }}
              />
              <button
                onClick={handleGenerate}
                disabled={(!input.trim() && attachedImages.length === 0) || isGenerating}
                style={{
                  position: "absolute", bottom: 10, right: 10,
                  width: 28, height: 28, borderRadius: 8,
                  background: (!input.trim() && attachedImages.length === 0) ? "rgba(212,175,55,0.1)" : "#D4AF37",
                  border: "none", display: "flex", alignItems: "center", justifyContent: "center",
                  cursor: "pointer", transition: "background 150ms", flexShrink: 0,
                }}
              >
                <svg width="13" height="13" viewBox="0 0 24 24" fill="none"
                  stroke={(!input.trim() && attachedImages.length === 0) ? "rgba(212,175,55,0.4)" : "#0D0B09"}
                  strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                  <line x1="22" y1="2" x2="11" y2="13" />
                  <polygon points="22 2 15 22 11 13 2 9 22 2" />
                </svg>
              </button>
            </div>

            {/* Attach + hint row */}
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginTop: 8 }}>
              <button
                onClick={() => fileInputRef.current?.click()}
                style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 11, color: "rgba(107,114,128,0.7)", cursor: "pointer", background: "none", border: "none", padding: 0 }}
              >
                {attachedImages.length > 0 ? (
                  <span style={{ display: "flex", alignItems: "center", justifyContent: "center", width: 20, height: 20, borderRadius: "50%", background: "#D4AF37", color: "#0D0B09", fontSize: 10, fontWeight: 700 }}>
                    {attachedImages.length}
                  </span>
                ) : (
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M21.44 11.05l-9.19 9.19a6 6 0 01-8.49-8.49l9.19-9.19a4 4 0 015.66 5.66l-9.2 9.19a2 2 0 01-2.83-2.83l8.49-8.48" />
                  </svg>
                )}
                <span>Attach image</span>
              </button>
              <span style={{ fontSize: 10, color: "rgba(107,114,128,0.4)" }}>⌘↵ to generate</span>
            </div>
            <input ref={fileInputRef} type="file" accept="image/*" multiple onChange={handleImageSelect} style={{ display: "none" }} />

            {/* Example chips — exact original */}
            <div style={{ display: "flex", flexWrap: "wrap", gap: 6, marginTop: 8 }}>
              {EXAMPLE_CHIPS.map(chip => (
                <button
                  key={chip}
                  onClick={() => setInput(chip)}
                  style={{
                    borderRadius: 999, border: "1px solid rgba(212,175,55,0.18)",
                    background: "oklch(0.25 0.012 60)",
                    padding: "4px 10px", fontSize: 10, color: "oklch(0.50 0.01 80)",
                    cursor: "pointer", transition: "all 150ms",
                  }}
                  onMouseEnter={e => { e.currentTarget.style.borderColor = "rgba(212,175,55,0.35)"; e.currentTarget.style.color = "oklch(0.70 0.015 80)"; }}
                  onMouseLeave={e => { e.currentTarget.style.borderColor = "rgba(212,175,55,0.18)"; e.currentTarget.style.color = "oklch(0.50 0.01 80)"; }}
                >
                  {chip}
                </button>
              ))}
            </div>
          </div>

          {/* ── Generate button — exact original ── */}
          <button
            onClick={handleGenerate}
            disabled={!canGenerate}
            style={{
              width: "100%", borderRadius: 12,
              background: canGenerate ? "#D4AF37" : "rgba(212,175,55,0.12)",
              padding: "14px", fontSize: 14, fontWeight: 700,
              color: canGenerate ? "#0D0B09" : "rgba(212,175,55,0.4)",
              border: "none", cursor: canGenerate ? "pointer" : "not-allowed",
              transition: "all 150ms",
              boxShadow: canGenerate ? "0 0 20px oklch(0.76 0.12 85 / 15%)" : "none",
            }}
            onMouseEnter={e => { if (canGenerate) (e.currentTarget as HTMLButtonElement).style.boxShadow = "0 0 30px oklch(0.76 0.12 85 / 30%)"; }}
            onMouseLeave={e => { if (canGenerate) (e.currentTarget as HTMLButtonElement).style.boxShadow = "0 0 20px oklch(0.76 0.12 85 / 15%)"; }}
          >
            {isGenerating ? (
              <span style={{ display: "flex", alignItems: "center", justifyContent: "center", gap: 6 }}>
                <span style={{ width: 8, height: 8, borderRadius: "50%", background: "rgba(212,175,55,0.4)", animation: "bounce 1s infinite", animationDelay: "0ms", display: "inline-block" }} />
                <span style={{ width: 8, height: 8, borderRadius: "50%", background: "rgba(212,175,55,0.4)", animation: "bounce 1s infinite", animationDelay: "120ms", display: "inline-block" }} />
                <span style={{ width: 8, height: 8, borderRadius: "50%", background: "rgba(212,175,55,0.4)", animation: "bounce 1s infinite", animationDelay: "240ms", display: "inline-block" }} />
              </span>
            ) : "Generate Prompt →"}
          </button>

          {/* ── Output — exact original ── */}
          {output && (
            <div
              ref={outputRef}
              style={{
                borderRadius: 12, border: "1px solid rgba(212,175,55,0.35)",
                background: "oklch(0.12 0.01 60)", padding: 16,
                display: "flex", flexDirection: "column", gap: 12,
              }}
            >
              <p style={{ fontSize: 10, fontWeight: 700, letterSpacing: "0.15em", color: "#D4AF37", textTransform: "uppercase" as const }}>
                Prompt for {effectiveBuilder}
              </p>
              <pre style={{
                fontSize: 12, color: "rgba(231,229,228,0.87)",
                whiteSpace: "pre-wrap", lineHeight: 1.6, margin: 0,
                fontFamily: "'JetBrains Mono', 'Geist Mono', monospace",
              }}>
                {output}
              </pre>
              <div style={{ display: "flex", gap: 8, paddingTop: 4, borderTop: "1px solid rgba(212,175,55,0.10)" }}>
                <button
                  onClick={handleCopy}
                  style={{
                    flex: 1, borderRadius: 8, padding: "10px",
                    fontSize: 12, fontWeight: 700, cursor: "pointer",
                    border: copied ? "1px solid rgba(212,175,55,0.5)" : "none",
                    background: copied ? "rgba(212,175,55,0.2)" : "#D4AF37",
                    color: copied ? "#D4AF37" : "#0D0B09",
                    transition: "all 150ms",
                  }}
                >
                  {copied ? "Copied ✓" : "Copy Prompt"}
                </button>
                <button
                  onClick={handleRegenerate}
                  style={{
                    flex: 1, borderRadius: 8, padding: "10px",
                    fontSize: 12, fontWeight: 600, cursor: "pointer",
                    border: "1px solid rgba(212,175,55,0.3)",
                    background: "transparent", color: "#D4AF37",
                    transition: "all 150ms",
                  }}
                  onMouseEnter={e => { (e.currentTarget as HTMLButtonElement).style.background = "rgba(212,175,55,0.1)"; }}
                  onMouseLeave={e => { (e.currentTarget as HTMLButtonElement).style.background = "transparent"; }}
                >
                  Regenerate
                </button>
              </div>
            </div>
          )}
        </div>

        {/* Footer */}
        <div style={{
          display: "flex", alignItems: "center", justifyContent: "space-between",
          padding: "10px 16px", borderTop: "1px solid rgba(212,175,55,0.07)",
        }}>
          <button
            onClick={onClose}
            style={{
              display: "flex", alignItems: "center", gap: 4,
              padding: "8px 16px", borderRadius: 20,
              background: "rgba(120,113,108,0.09)", border: "1px solid rgba(120,113,108,0.2)",
              color: "rgba(120,113,108,0.75)", fontSize: 12, cursor: "pointer",
              fontFamily: "var(--app-font-mono)",
            }}
          >
            ‹ Back
          </button>
          <span style={{ fontSize: 10, color: "rgba(120,113,108,0.4)", fontFamily: "var(--app-font-mono)" }}>
            AXIOM // QUICK PROMPT
          </span>
        </div>
      </div>

      {/* Lightbox — exact original */}
      {lightboxSrc && (
        <div
          style={{ position: "fixed", inset: 0, zIndex: 99999, display: "flex", alignItems: "center", justifyContent: "center", background: "rgba(0,0,0,0.8)", backdropFilter: "blur(4px)" }}
          onClick={() => setLightboxSrc(null)}
        >
          <img
            src={lightboxSrc} alt="Preview"
            style={{ maxWidth: "90vw", maxHeight: "90vh", borderRadius: 12, objectFit: "contain", border: "1px solid rgba(212,175,55,0.4)" }}
          />
        </div>
      )}
    </>
  );
}
