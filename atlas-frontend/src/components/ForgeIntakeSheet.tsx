/**
 * ForgeIntakeSheet — glassmorphic bottom sheet for raw context dumps.
 *
 * Unified intake surface. Two entry paths:
 *   • Long-press on the Atlas Pulse glyph (LifecycleGlyph)
 *   • "+" menu → "Forge intake" in the chat composer
 *
 * Both open this sheet. The sheet owns the dump pad + Intake action + a
 * shortcut to the full Project DNA settings. The actual /api/forge call is
 * delegated to the parent via `onIntake` (which wraps submitForgeIntake +
 * applyForgeNodes in workspace.tsx).
 *
 * Replaces the heavy CaptureBar+intake-toggle that used to live inline in
 * the composer on mobile.
 */

import { useEffect, useRef, useState, type CSSProperties } from "react";
import { createPortal } from "react-dom";
import { X, CornerDownLeft, Settings2 } from "lucide-react";

type Props = {
  open: boolean;
  onClose: () => void;
  onIntake: (content: string) => Promise<void> | void;
  onOpenProjectDna?: () => void;
  projectName?: string | null;
};

export function ForgeIntakeSheet({ open, onClose, onIntake, onOpenProjectDna, projectName }: Props) {
  const [text, setText] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<string | null>(null);
  const textareaRef = useRef<HTMLTextAreaElement | null>(null);

  // Reset on open. Skip autofocus — on Android, autofocusing while the
  // long-press finger is still down triggers the native text-selection menu
  // (Map / Cut / Copy / Paste). User can tap the textarea to focus.
  useEffect(() => {
    if (!open) return;
    setText("");
    setError(null);
    setDone(null);
  }, [open]);

  // Esc to close.
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  // Lock body scroll while open.
  useEffect(() => {
    if (!open) return;
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => { document.body.style.overflow = prev; };
  }, [open]);

  const canSubmit = text.trim().length > 5 && !submitting;

  const submit = async () => {
    if (!canSubmit) return;
    setSubmitting(true);
    setError(null);
    try {
      await onIntake(text.trim());
      setDone("Intake → Forge");
      setText("");
      window.setTimeout(() => { setDone(null); onClose(); }, 900);
    } catch {
      setError("Forge intake failed — try a more specific dump.");
    } finally {
      setSubmitting(false);
    }
  };

  const onKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if ((e.metaKey || e.ctrlKey) && e.key === "Enter") {
      e.preventDefault();
      void submit();
    }
  };

  if (!open) return null;

  const overlay: CSSProperties = {
    position: "fixed",
    inset: 0,
    zIndex: 9999,
    background: "rgba(0,0,0,0.55)",
    backdropFilter: "blur(8px)",
    WebkitBackdropFilter: "blur(8px)",
    display: "flex",
    alignItems: "flex-end",
    justifyContent: "center",
    animation: "axiom-fade-in 180ms ease",
  };

  const sheet: CSSProperties = {
    width: "100%",
    maxWidth: 640,
    maxHeight: "85vh",
    display: "flex",
    flexDirection: "column",
    background: "rgba(var(--atlas-surface-rgb), 0.94)",
    backdropFilter: "blur(22px) saturate(140%)",
    WebkitBackdropFilter: "blur(22px) saturate(140%)",
    borderTop: "1px solid rgba(var(--atlas-gold-rgb), 0.30)",
    borderLeft: "1px solid rgba(var(--atlas-gold-rgb), 0.14)",
    borderRight: "1px solid rgba(var(--atlas-gold-rgb), 0.14)",
    borderRadius: "20px 20px 0 0",
    boxShadow: "0 -20px 60px -10px rgba(var(--atlas-gold-rgb), 0.18), 0 -8px 24px rgba(0,0,0,0.18)",
    padding: "14px 18px 18px",
    animation: "axiom-sheet-up 240ms cubic-bezier(0.2, 0.8, 0.2, 1)",
    color: "var(--atlas-fg)",
  };

  const body = (
    <div style={overlay} onClick={onClose}>
      <style>{`
        @keyframes axiom-fade-in { from { opacity: 0; } to { opacity: 1; } }
        @keyframes axiom-sheet-up { from { transform: translateY(24px); opacity: 0; } to { transform: translateY(0); opacity: 1; } }
      `}</style>
      <div style={sheet} onClick={(e) => e.stopPropagation()} role="dialog" aria-label="Forge intake">
        {/* drag handle */}
        <div style={{
          width: 36, height: 4, borderRadius: 999,
          background: "rgba(var(--atlas-gold-rgb), 0.35)",
          margin: "2px auto 12px",
        }} />

        {/* header */}
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 12 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <span style={{
              width: 7, height: 7, borderRadius: "50%",
              background: "var(--atlas-gold)",
              boxShadow: "0 0 10px rgba(201,162,76,0.7)",
              animation: "forge-pulse 2.6s ease-in-out infinite",
            }} />
            <span style={{
              fontFamily: "var(--app-font-mono)", fontSize: 10,
              letterSpacing: "0.18em", textTransform: "uppercase",
              color: "var(--atlas-gold)",
            }}>
              Forge intake{projectName ? ` · ${projectName}` : ""}
            </span>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            style={{
              width: 32, height: 32, borderRadius: 8,
              border: "1px solid rgba(var(--atlas-gold-rgb), 0.18)",
              background: "transparent", color: "rgba(var(--atlas-muted-rgb), 0.85)",
              cursor: "pointer", display: "inline-flex", alignItems: "center", justifyContent: "center",
            }}
          >
            <X size={15} />
          </button>
        </div>

        {/* hint */}
        <div style={{
          fontSize: 12, lineHeight: 1.5,
          color: "rgba(var(--atlas-muted-rgb), 0.75)",
          marginBottom: 10,
        }}>
          Paste raw context — strategy docs, transcripts, API logs. Forge extracts nodes into your Flow.
        </div>

        {/* pad */}
        <textarea
          ref={textareaRef}
          value={text}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={onKeyDown}
          placeholder="Brain dump — raw context, goals, blockers…"
          rows={8}
          style={{
            width: "100%",
            minHeight: 200,
            maxHeight: "44vh",
            resize: "vertical",
            padding: "12px 14px",
            background: "rgba(var(--atlas-bg-rgb), 0.45)",
            border: "1px solid rgba(var(--atlas-gold-rgb), 0.18)",
            borderRadius: 12,
            color: "var(--atlas-fg)",
            fontFamily: "var(--app-font-sans)",
            fontSize: 15, lineHeight: 1.55, letterSpacing: "-0.005em",
            outline: "none",
          }}
        />

        {/* feedback */}
        {error && (
          <div style={{
            marginTop: 8, fontSize: 12,
            color: "rgba(239, 68, 68, 0.95)",
            fontFamily: "var(--app-font-mono)",
          }}>{error}</div>
        )}
        {done && (
          <div style={{
            marginTop: 8, fontSize: 12,
            color: "var(--atlas-gold)",
            fontFamily: "var(--app-font-mono)",
            letterSpacing: "0.04em",
          }}>{done}</div>
        )}

        {/* actions */}
        <div style={{
          display: "flex", alignItems: "center", gap: 10,
          marginTop: 12, paddingTop: 12,
          borderTop: "1px solid rgba(var(--atlas-gold-rgb), 0.10)",
        }}>
          {onOpenProjectDna && (
            <button
              type="button"
              onClick={() => { onClose(); onOpenProjectDna(); }}
              style={{
                display: "inline-flex", alignItems: "center", gap: 6,
                padding: "8px 10px", borderRadius: 8,
                background: "transparent",
                border: "1px solid rgba(var(--atlas-gold-rgb), 0.18)",
                color: "rgba(var(--atlas-muted-rgb), 0.85)",
                fontFamily: "var(--app-font-mono)", fontSize: 10,
                letterSpacing: "0.14em", textTransform: "uppercase",
                cursor: "pointer",
              }}
            >
              <Settings2 size={13} />
              Project DNA
            </button>
          )}
          <div style={{ flex: 1 }} />
          <span style={{
            fontFamily: "var(--app-font-mono)", fontSize: 10,
            color: "rgba(var(--atlas-muted-rgb), 0.5)",
            letterSpacing: "0.12em",
          }}>
            ⌘↵
          </span>
          <button
            type="button"
            onClick={submit}
            disabled={!canSubmit}
            style={{
              display: "inline-flex", alignItems: "center", gap: 8,
              padding: "10px 16px", borderRadius: 10,
              background: canSubmit ? "var(--atlas-gold)" : "rgba(var(--atlas-gold-rgb), 0.18)",
              color: canSubmit ? "#0D0B09" : "rgba(var(--atlas-gold-rgb), 0.45)",
              border: "none",
              fontFamily: "var(--app-font-mono)", fontSize: 11,
              letterSpacing: "0.14em", textTransform: "uppercase",
              cursor: canSubmit ? "pointer" : "not-allowed",
              fontWeight: 600,
              boxShadow: canSubmit ? "0 6px 20px -8px rgba(201,162,76,0.6)" : "none",
              transition: "all 160ms",
            }}
          >
            <CornerDownLeft size={14} />
            {submitting ? "Forging…" : "Intake to Forge"}
          </button>
        </div>
      </div>
    </div>
  );

  return createPortal(body, document.body);
}

export default ForgeIntakeSheet;

/** Global event name to open the sheet from anywhere in the app. */
export const FORGE_INTAKE_OPEN_EVENT = "axiom:open-forge-intake";

/** Convenience dispatcher. */
export function openForgeIntakeSheet() {
  window.dispatchEvent(new CustomEvent(FORGE_INTAKE_OPEN_EVENT));
}
