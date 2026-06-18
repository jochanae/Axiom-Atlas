// QuickActionV2 — "Inline Edge" (Option B).
// Founder-shaped quick action surface. Replaces the technical launcher with
// a single glass card: intent toggle (Decide/Build/Think) + project chip
// live inside the top edge of the card, divided by a hairline. Active
// intent gets a gold underline. Card lights a gold focus ring on focus.
//
// Zero branch/path/file/model UI — routing happens downstream.
// On submit: seeds sessionStorage with intent+prompt and routes the user
// into the chosen project workspace, where the conversation continues.

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useLocation } from "wouter";
import { X, ChevronDown, Paperclip, ArrowRight } from "lucide-react";
import type { QuickEditProjectOption } from "./QuickEditRow";

type Intent = "decide" | "build" | "think";

const INTENT_PLACEHOLDERS: Record<Intent, string[]> = {
  decide: [
    "Decide if pricing belongs above the fold…",
    "Decide whether to ship the v2 onboarding now…",
    "Decide if we keep the trial or move to freemium…",
  ],
  build: [
    "Build the landing page hero…",
    "Build a settings panel for notifications…",
    "Build the empty state for first-time users…",
  ],
  think: [
    "Think through onboarding friction…",
    "Think through what 'done' means for the MVP…",
    "Think through why activation is dropping…",
  ],
};

interface Props {
  projects: QuickEditProjectOption[];
  defaultProjectId: number;
  defaultProjectName: string;
  onClose?: () => void;
}

export function QuickActionV2({
  projects,
  defaultProjectId,
  defaultProjectName,
  onClose,
}: Props) {
  const [, setLocation] = useLocation();
  const [intent, setIntent] = useState<Intent>("decide");
  const [projectId, setProjectId] = useState(defaultProjectId);
  const [projectMenuOpen, setProjectMenuOpen] = useState(false);
  const [prompt, setPrompt] = useState("");
  const [focused, setFocused] = useState(false);
  const [attachments, setAttachments] = useState<File[]>([]);
  const [placeholderIdx, setPlaceholderIdx] = useState(0);
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const textareaRef = useRef<HTMLTextAreaElement | null>(null);

  const activeProjectName = useMemo(
    () => projects.find((p) => p.id === projectId)?.name ?? defaultProjectName,
    [projects, projectId, defaultProjectName]
  );

  // Reset placeholder rotation when intent flips
  useEffect(() => {
    setPlaceholderIdx(0);
    const list = INTENT_PLACEHOLDERS[intent];
    if (list.length <= 1) return;
    const t = setInterval(() => {
      setPlaceholderIdx((i) => (i + 1) % list.length);
    }, 4200);
    return () => clearInterval(t);
  }, [intent]);

  const submit = useCallback(() => {
    if (!prompt.trim()) return;
    const payload = {
      intent,
      prompt: prompt.trim(),
      attachments: attachments.map((f) => f.name),
      origin: "quick-action-v2",
    };
    try {
      sessionStorage.setItem(
        `atlas:quickaction:resume:${projectId}`,
        JSON.stringify(payload)
      );
    } catch {}
    setLocation(`/project/${projectId}?resume=quickaction`);
  }, [intent, prompt, attachments, projectId, setLocation]);

  const activePlaceholder = INTENT_PLACEHOLDERS[intent][placeholderIdx];
  const canSubmit = prompt.trim().length > 0;

  return (
    <div style={{ position: "relative" }}>
      {/* Card */}
      <div
        style={{
          position: "relative",
          background:
            "linear-gradient(180deg, rgba(255,255,255,0.025), rgba(255,255,255,0.012))",
          backdropFilter: "blur(18px) saturate(120%)",
          WebkitBackdropFilter: "blur(18px) saturate(120%)",
          border: focused
            ? "1px solid rgba(201,162,76,0.45)"
            : "1px solid var(--atlas-border)",
          borderRadius: 14,
          padding: "10px 12px 10px",
          boxShadow: focused
            ? "0 0 0 1px rgba(201,162,76,0.22), 0 0 32px -10px rgba(201,162,76,0.35), 0 20px 40px -24px rgba(0,0,0,0.6)"
            : "0 1px 0 rgba(255,255,255,0.03) inset, 0 20px 40px -24px rgba(0,0,0,0.6)",
          transition: "border-color 200ms ease, box-shadow 200ms ease",
        }}
      >
        {/* Top chip row — chips INSIDE the card, hairline divider below */}
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: 8,
            flexWrap: "wrap",
            paddingBottom: 10,
            borderBottom: "1px solid var(--atlas-border)",
          }}
        >
          {/* Intent toggle — flat pills with gold underline on active */}
          <div
            role="tablist"
            aria-label="Intent"
            style={{ display: "inline-flex", gap: 12, paddingLeft: 2 }}
          >
            {(["decide", "build", "think"] as Intent[]).map((i) => {
              const active = intent === i;
              return (
                <button
                  key={i}
                  type="button"
                  role="tab"
                  aria-selected={active}
                  onClick={() => setIntent(i)}
                  style={{
                    position: "relative",
                    background: "transparent",
                    border: 0,
                    padding: "4px 0",
                    cursor: "pointer",
                    fontFamily: "var(--app-font-mono)",
                    fontSize: 10.5,
                    letterSpacing: "0.12em",
                    textTransform: "uppercase",
                    fontWeight: active ? 500 : 400,
                    color: active ? "var(--atlas-fg)" : "var(--atlas-muted)",
                    opacity: active ? 1 : 0.7,
                    transition: "color 160ms ease, opacity 160ms ease",
                  }}
                >
                  {i}
                  {active && (
                    <span
                      aria-hidden
                      style={{
                        position: "absolute",
                        left: 0,
                        right: 0,
                        bottom: -6,
                        height: 1.5,
                        background: "var(--atlas-gold)",
                        boxShadow: "0 0 8px rgba(201,162,76,0.55)",
                        borderRadius: 1,
                      }}
                    />
                  )}
                </button>
              );
            })}
          </div>

          <div style={{ flex: 1 }} />

          {/* Project chip */}
          <div style={{ position: "relative" }}>
            <button
              type="button"
              onClick={() =>
                projects.length > 1 && setProjectMenuOpen((v) => !v)
              }
              style={{
                display: "inline-flex",
                alignItems: "center",
                gap: 6,
                padding: "4px 9px",
                borderRadius: 999,
                background: "rgba(255,255,255,0.03)",
                border: "1px solid var(--atlas-border)",
                color: "var(--atlas-fg)",
                fontFamily: "var(--app-font-mono)",
                fontSize: 10.5,
                letterSpacing: "0.04em",
                cursor: projects.length > 1 ? "pointer" : "default",
                transition: "border-color 140ms ease",
              }}
              aria-label="Switch project"
            >
              <span style={{ opacity: 0.5 }}>↳</span>
              <span>{activeProjectName}</span>
              {projects.length > 1 && (
                <ChevronDown size={10} strokeWidth={2} style={{ opacity: 0.55 }} />
              )}
            </button>
            {projectMenuOpen && projects.length > 1 && (
              <div
                style={{
                  position: "absolute",
                  top: "calc(100% + 6px)",
                  right: 0,
                  zIndex: 40,
                  minWidth: 180,
                  maxHeight: 220,
                  overflowY: "auto",
                  background: "#0b0b0e",
                  backgroundImage:
                    "linear-gradient(180deg, rgba(255,255,255,0.03), rgba(255,255,255,0.01))",
                  border: "1px solid var(--atlas-border)",
                  borderRadius: 8,
                  padding: 4,
                  boxShadow:
                    "0 14px 36px rgba(0,0,0,0.6), 0 0 0 1px rgba(0,0,0,0.4)",
                }}
              >
                {projects.map((p) => (
                  <button
                    key={p.id}
                    type="button"
                    onClick={() => {
                      setProjectId(p.id);
                      setProjectMenuOpen(false);
                    }}
                    style={{
                      display: "block",
                      width: "100%",
                      textAlign: "left",
                      padding: "6px 8px",
                      background:
                        p.id === projectId
                          ? "rgba(201,162,76,0.08)"
                          : "transparent",
                      border: "none",
                      borderRadius: 4,
                      color: "var(--atlas-fg)",
                      fontFamily: "var(--app-font-mono)",
                      fontSize: 11,
                      cursor: "pointer",
                    }}
                  >
                    {p.name}
                  </button>
                ))}
              </div>
            )}
          </div>

          {/* Close (only when launcher dismissable) */}
          {onClose && (
            <button
              type="button"
              onClick={onClose}
              aria-label="Close quick action"
              style={{
                background: "transparent",
                border: 0,
                color: "var(--atlas-muted)",
                cursor: "pointer",
                opacity: 0.55,
                padding: 2,
                display: "inline-flex",
              }}
            >
              <X size={13} />
            </button>
          )}
        </div>

        {/* Textarea + rotating placeholder */}
        <div style={{ position: "relative", marginTop: 4 }}>
          {!prompt && (
            <div
              aria-hidden
              style={{
                position: "absolute",
                inset: "10px 8px auto 8px",
                pointerEvents: "none",
                color: "var(--atlas-muted)",
                opacity: 0.7,
                fontFamily: "var(--app-font-sans)",
                fontSize: 14,
                lineHeight: 1.55,
                transition: "opacity 280ms ease",
              }}
              key={`${intent}-${placeholderIdx}`}
            >
              {activePlaceholder}
            </div>
          )}
          <textarea
            ref={textareaRef}
            value={prompt}
            onChange={(e) => setPrompt(e.target.value)}
            onFocus={() => setFocused(true)}
            onBlur={() => setFocused(false)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
                e.preventDefault();
                submit();
              }
            }}
            rows={3}
            style={{
              width: "100%",
              resize: "none",
              background: "transparent",
              border: 0,
              outline: 0,
              color: "var(--atlas-fg)",
              fontFamily: "var(--app-font-sans)",
              fontSize: 14,
              lineHeight: 1.55,
              letterSpacing: "-0.005em",
              padding: "10px 8px 8px",
              minHeight: 72,
            }}
          />
        </div>

        {/* Attachment chips */}
        {attachments.length > 0 && (
          <div style={{ display: "flex", flexWrap: "wrap", gap: 5, padding: "0 4px 6px" }}>
            {attachments.map((f, i) => (
              <span
                key={`${f.name}-${i}`}
                style={{
                  display: "inline-flex",
                  alignItems: "center",
                  gap: 4,
                  padding: "3px 7px",
                  borderRadius: 4,
                  background: "rgba(99,102,241,0.08)",
                  border: "1px solid rgba(99,102,241,0.25)",
                  color: "rgba(165,180,252,0.95)",
                  fontFamily: "var(--app-font-mono)",
                  fontSize: 10,
                }}
              >
                <Paperclip size={9} />
                {f.name}
                <button
                  type="button"
                  onClick={() =>
                    setAttachments((prev) => prev.filter((_, j) => j !== i))
                  }
                  aria-label={`Remove ${f.name}`}
                  style={{
                    background: "transparent",
                    border: 0,
                    padding: 0,
                    color: "inherit",
                    cursor: "pointer",
                    opacity: 0.75,
                    display: "inline-flex",
                  }}
                >
                  <X size={9} />
                </button>
              </span>
            ))}
          </div>
        )}

        {/* Action row */}
        <div
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            paddingTop: 8,
            marginTop: 4,
            borderTop: "1px solid var(--atlas-border)",
          }}
        >
          <button
            type="button"
            onClick={() => fileInputRef.current?.click()}
            aria-label="Attach files"
            style={{
              width: 28,
              height: 28,
              borderRadius: 7,
              display: "inline-flex",
              alignItems: "center",
              justifyContent: "center",
              background: "transparent",
              border: "1px solid transparent",
              color: "var(--atlas-muted)",
              cursor: "pointer",
              transition: "color 140ms ease, border-color 140ms ease, background 140ms ease",
            }}
            onMouseEnter={(e) => {
              e.currentTarget.style.color = "var(--atlas-fg)";
              e.currentTarget.style.borderColor = "var(--atlas-border)";
              e.currentTarget.style.background = "rgba(255,255,255,0.03)";
            }}
            onMouseLeave={(e) => {
              e.currentTarget.style.color = "var(--atlas-muted)";
              e.currentTarget.style.borderColor = "transparent";
              e.currentTarget.style.background = "transparent";
            }}
          >
            <Paperclip size={14} strokeWidth={1.75} />
          </button>
          <input
            ref={fileInputRef}
            type="file"
            multiple
            hidden
            onChange={(e) => {
              const files = Array.from(e.target.files ?? []);
              if (files.length) setAttachments((prev) => [...prev, ...files]);
              e.target.value = "";
            }}
          />

          <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
            <span
              style={{
                fontFamily: "var(--app-font-mono)",
                fontSize: 9.5,
                letterSpacing: "0.14em",
                textTransform: "uppercase",
                color: "var(--atlas-muted)",
                opacity: 0.55,
              }}
            >
              ⌘ + ⏎
            </span>
            <button
              type="button"
              onClick={submit}
              disabled={!canSubmit}
              aria-label="Execute quick action"
              style={{
                width: 30,
                height: 30,
                borderRadius: "50%",
                border: "1px solid rgba(201,162,76,0.55)",
                background: canSubmit
                  ? "linear-gradient(180deg, rgba(201,162,76,0.25), rgba(201,162,76,0.10))"
                  : "rgba(201,162,76,0.06)",
                color: canSubmit ? "var(--atlas-gold)" : "rgba(201,162,76,0.4)",
                cursor: canSubmit ? "pointer" : "not-allowed",
                display: "inline-flex",
                alignItems: "center",
                justifyContent: "center",
                transition: "background 180ms ease, color 180ms ease, box-shadow 180ms ease",
              }}
              onMouseEnter={(e) => {
                if (!canSubmit) return;
                e.currentTarget.style.background = "var(--atlas-gold)";
                e.currentTarget.style.color = "var(--atlas-bg)";
                e.currentTarget.style.boxShadow =
                  "0 0 22px -4px rgba(201,162,76,0.55)";
              }}
              onMouseLeave={(e) => {
                if (!canSubmit) return;
                e.currentTarget.style.background =
                  "linear-gradient(180deg, rgba(201,162,76,0.25), rgba(201,162,76,0.10))";
                e.currentTarget.style.color = "var(--atlas-gold)";
                e.currentTarget.style.boxShadow = "none";
              }}
            >
              <ArrowRight size={13} strokeWidth={2} />
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
