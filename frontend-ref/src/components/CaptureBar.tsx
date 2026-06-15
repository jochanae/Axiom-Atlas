/**
 * CaptureBar — unified capture surface.
 *
 * One bar, two destinations:
 *   • Park  — defers to the Parking Lot (status:"parked"). Parent owns the
 *             write via `onPark`. Atlas can analyze parked entries later.
 *   • Forge — fire-and-forget classification through /api/quick-prompt.
 *
 * Replaces the standalone QuickPromptCard and the workspace's floating
 * "{n} items" pill (the parked count now renders inline here).
 *
 * Form factor: resting single-line → expanded multi-line composer
 *   • ⌘↵ submits to the active destination
 *   • Esc collapses (unless context="modal")
 *   • Intent tags bias the Forge payload
 *   • Voice-to-text via SpeechRecognition where supported
 */

import { useEffect, useRef, useState, type CSSProperties } from "react";
import { Mic, MicOff, CornerDownLeft, X } from "lucide-react";

type Intent = "idea" | "decision" | "build" | "dump";
export type CaptureDestination = "park" | "forge" | "intake";

const INTENTS: Array<{ id: Intent; label: string; hint: string }> = [
  { id: "idea",     label: "Idea",     hint: "loose thought" },
  { id: "decision", label: "Decision", hint: "commit this" },
  { id: "build",    label: "Build",    hint: "make it real" },
  { id: "dump",     label: "Dump",     hint: "raw brain" },
];

type Props = {
  context?: "home" | "modal" | "flow";
  placeholder?: string;
  builder?: string;
  projectId?: string | null;

  /** Available destinations, in order. First entry is the default. */
  destinations?: CaptureDestination[];
  defaultDestination?: CaptureDestination;

  /** Park branch — parent performs the write (createEntry). */
  onPark?: (content: string, intent: Intent) => void;

  /** Forge branch result (after /api/quick-prompt resolves). */
  onCaptured?: (result: { intent: Intent; text: string; response: string }) => void;

  /** Intake branch — parent owns the /api/forge call (use submitForgeIntake). */
  onIntake?: (content: string, intent: Intent) => Promise<void> | void;

  /** Inline "{n} parked" chip + tap-through. */
  parkedCount?: number;
  onParkedChipClick?: () => void;

  /** Suppress inline confirmation; reset immediately. */
  inlineOnly?: boolean;
};

export function CaptureBar({
  context = "home",
  placeholder,
  builder = "Axiom",
  projectId,
  destinations = ["park", "forge"],
  defaultDestination,
  onPark,
  onCaptured,
  onIntake,
  parkedCount = 0,
  onParkedChipClick,
  inlineOnly,
}: Props) {
  const initialDest: CaptureDestination =
    defaultDestination ?? destinations[0] ?? "park";

  const [expanded, setExpanded] = useState(context === "modal");
  const [text, setText] = useState("");
  const [intent, setIntent] = useState<Intent>("idea");
  const [destination, setDestination] = useState<CaptureDestination>(initialDest);
  const [submitting, setSubmitting] = useState(false);
  const [confirmation, setConfirmation] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [listening, setListening] = useState(false);

  const inputRef = useRef<HTMLTextAreaElement | null>(null);
  const recogRef = useRef<any>(null);

  const restingPlaceholder =
    placeholder ??
    (destination === "park"
      ? "Park a thought — analyze it later…"
      : destination === "intake"
        ? "Brain dump — raw context, goals, blockers. Routes straight to Forge…"
        : context === "flow"
          ? "Brain dump — captured to Forge, won't interrupt chat…"
          : "Send to Forge — capture an idea, decision, or build intent…");

  useEffect(() => {
    const el = inputRef.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = Math.min(el.scrollHeight, 320) + "px";
  }, [text, expanded]);

  const toggleVoice = () => {
    const W: any = window;
    const Rec = W.SpeechRecognition || W.webkitSpeechRecognition;
    if (!Rec) { setError("Voice not supported in this browser."); return; }
    if (listening) { recogRef.current?.stop(); setListening(false); return; }
    const r = new Rec();
    r.continuous = true; r.interimResults = true; r.lang = "en-US";
    let base = text;
    r.onresult = (e: any) => {
      let interim = "";
      for (let i = e.resultIndex; i < e.results.length; i++) {
        const t = e.results[i][0].transcript;
        if (e.results[i].isFinal) base = (base + " " + t).trim();
        else interim += t;
      }
      setText((base + " " + interim).trim());
    };
    r.onend = () => setListening(false);
    r.onerror = () => setListening(false);
    recogRef.current = r;
    r.start();
    setListening(true);
  };

  const canSubmit = text.trim().length > 5 && !submitting;

  const finishConfirm = (label: string) => {
    if (inlineOnly) { setText(""); return; }
    const head = text.trim().split(/\s+/).slice(0, 6).join(" ");
    setConfirmation(`${label} → ${head}${text.trim().split(/\s+/).length > 6 ? "…" : ""}`);
    setText("");
    setTimeout(() => {
      setConfirmation(null);
      if (context !== "modal") setExpanded(false);
    }, 2200);
  };

  const submit = async () => {
    if (!canSubmit) return;
    setSubmitting(true);
    setError(null);
    try {
      if (destination === "park") {
        if (!onPark) throw new Error("Park destination has no handler.");
        onPark(text.trim(), intent);
        finishConfirm("Parked");
      } else if (destination === "intake") {
        if (!onIntake) throw new Error("Intake destination has no handler.");
        await onIntake(text.trim(), intent);
        finishConfirm("Intake → Forge");
      } else {
        const res = await fetch("/api/quick-prompt", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          credentials: "include",
          body: JSON.stringify({
            description: text.trim(),
            builder,
            intent,
            projectId: projectId ?? undefined,
          }),
        });
        if (!res.ok) throw new Error("capture failed");
        const response = await res.text();
        onCaptured?.({ intent, text: text.trim(), response });
        finishConfirm("Sent to Forge");
      }
    } catch {
      setError("Capture failed — try again.");
    } finally {
      setSubmitting(false);
    }
  };

  const onKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if ((e.metaKey || e.ctrlKey) && e.key === "Enter") {
      e.preventDefault(); void submit(); return;
    }
    if (e.key === "Escape" && context !== "modal") {
      e.preventDefault();
      if (!text.trim()) setExpanded(false);
      (e.target as HTMLTextAreaElement).blur();
    }
  };

  const wrap: CSSProperties = {
    width: "100%",
    maxWidth: context === "home" ? 620 : "100%",
    margin: "0 auto",
    position: "relative",
    borderRadius: 14,
    border: "1px solid rgba(var(--atlas-gold-rgb), 0.18)",
    background: "rgba(var(--atlas-bg-rgb, 13, 11, 9), 0.55)",
    backdropFilter: "blur(14px)",
    WebkitBackdropFilter: "blur(14px)",
    boxShadow: expanded
      ? "0 12px 40px -16px rgba(var(--atlas-gold-rgb), 0.35), 0 0 0 1px rgba(var(--atlas-gold-rgb), 0.10)"
      : "0 6px 22px -14px rgba(0,0,0,0.5)",
    transition: "box-shadow 220ms ease, border-color 220ms ease",
    overflow: "hidden",
  };

  const igniteFill = Math.min(1, text.trim().length / 60);
  const showDestSwitch = destinations.length > 1;

  if (confirmation) {
    return (
      <div style={{ ...wrap, padding: "18px 18px" }}>
        <div style={{
          display: "flex", alignItems: "center", gap: 12,
          fontFamily: "var(--app-font-mono)", fontSize: 13,
          color: "var(--atlas-gold)",
        }}>
          <span style={{
            width: 8, height: 8, borderRadius: "50%",
            background: "var(--atlas-gold)",
            boxShadow: "0 0 12px var(--atlas-gold)",
          }} />
          <span style={{ color: "var(--atlas-fg)", fontFamily: "var(--app-font-sans)", opacity: 0.88, letterSpacing: "0.01em" }}>
            {confirmation}
          </span>
        </div>
      </div>
    );
  }

  return (
    <div style={wrap}>
      {/* RESTING */}
      {!expanded && (
        <div style={{ display: "flex", alignItems: "stretch" }}>
          <button
            type="button"
            onClick={() => { setExpanded(true); setTimeout(() => inputRef.current?.focus(), 30); }}
            style={{
              display: "flex", alignItems: "center", gap: 12,
              flex: 1, padding: "14px 16px",
              background: "transparent", border: "none", cursor: "text",
              textAlign: "left",
              color: "rgba(var(--atlas-muted-rgb), 0.85)",
              fontFamily: "var(--app-font-sans)", fontSize: 14,
              minWidth: 0,
            }}
          >
            <span style={{
              width: 6, height: 6, borderRadius: "50%",
              background: "var(--atlas-gold)",
              animation: "forge-pulse 2.6s ease-in-out infinite",
              flexShrink: 0,
            }} />
            <span style={{ flex: 1, opacity: 0.7, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
              {restingPlaceholder}
            </span>
            <span style={{
              fontFamily: "var(--app-font-mono)", fontSize: 10,
              letterSpacing: "0.14em", textTransform: "uppercase",
              color: "rgba(var(--atlas-muted-rgb), 0.5)",
              flexShrink: 0,
            }}>
              ⌘ K
            </span>
          </button>

          {parkedCount > 0 && onParkedChipClick && (
            <button
              type="button"
              onClick={(e) => { e.stopPropagation(); onParkedChipClick(); }}
              title="Open Parking Lot"
              style={{
                display: "inline-flex", alignItems: "center", gap: 6,
                padding: "0 12px",
                background: "transparent",
                borderLeft: "1px solid rgba(var(--atlas-gold-rgb), 0.18)",
                color: "rgba(201,162,76,0.85)",
                fontFamily: "var(--app-font-mono)", fontSize: 10,
                letterSpacing: "0.12em", textTransform: "uppercase",
                cursor: "pointer", flexShrink: 0,
              }}
            >
              <span style={{
                width: 6, height: 6, borderRadius: "50%",
                background: "var(--atlas-gold)", display: "inline-block",
              }} />
              {parkedCount} parked
            </button>
          )}
        </div>
      )}

      {/* EXPANDED */}
      {expanded && (
        <div style={{ padding: "14px 14px 10px" }}>
          {showDestSwitch && (
            <div style={{ display: "flex", gap: 4, marginBottom: 10 }}>
              {destinations.map((d) => {
                const active = destination === d;
                const label = d === "park" ? "Park" : d === "intake" ? "Intake" : "Forge";
                return (
                  <button
                    key={d}
                    type="button"
                    onClick={() => setDestination(d)}
                    style={{
                      padding: "4px 11px",
                      borderRadius: 6,
                      border: `1px solid ${active ? "rgba(var(--atlas-gold-rgb), 0.55)" : "rgba(var(--atlas-gold-rgb), 0.14)"}`,
                      background: active ? "rgba(var(--atlas-gold-rgb), 0.14)" : "transparent",
                      color: active ? "var(--atlas-gold)" : "rgba(var(--atlas-muted-rgb), 0.7)",
                      fontFamily: "var(--app-font-mono)", fontSize: 10,
                      letterSpacing: "0.14em", textTransform: "uppercase",
                      cursor: "pointer", transition: "all 160ms",
                    }}
                  >
                    {label}
                  </button>
                );
              })}
              {parkedCount > 0 && onParkedChipClick && (
                <button
                  type="button"
                  onClick={onParkedChipClick}
                  style={{
                    marginLeft: "auto",
                    display: "inline-flex", alignItems: "center", gap: 6,
                    padding: "4px 10px", borderRadius: 6,
                    background: "transparent", border: "1px solid rgba(var(--atlas-gold-rgb), 0.18)",
                    color: "rgba(201,162,76,0.85)",
                    fontFamily: "var(--app-font-mono)", fontSize: 10,
                    letterSpacing: "0.12em", textTransform: "uppercase",
                    cursor: "pointer",
                  }}
                >
                  <span style={{ width: 6, height: 6, borderRadius: "50%", background: "var(--atlas-gold)" }} />
                  {parkedCount} parked
                </button>
              )}
            </div>
          )}

          <textarea
            ref={inputRef}
            value={text}
            onChange={(e) => setText(e.target.value)}
            onKeyDown={onKeyDown}
            placeholder={restingPlaceholder}
            rows={2}
            style={{
              width: "100%", resize: "none", border: "none", outline: "none",
              background: "transparent",
              color: "var(--atlas-fg)",
              fontFamily: "var(--app-font-sans)", fontSize: 15,
              lineHeight: 1.55, letterSpacing: "-0.005em",
              padding: "4px 4px 8px",
              minHeight: 60,
            }}
          />

          <div style={{
            height: 1, width: "100%",
            background: "rgba(var(--atlas-gold-rgb), 0.10)",
            position: "relative", overflow: "hidden", marginBottom: 10,
          }}>
            <div style={{
              position: "absolute", inset: 0,
              transform: `scaleX(${igniteFill})`, transformOrigin: "left",
              background: "linear-gradient(90deg, transparent, var(--atlas-gold) 60%, #FFD27A)",
              transition: "transform 240ms ease",
              boxShadow: igniteFill > 0.1 ? "0 0 10px rgba(var(--atlas-gold-rgb), 0.5)" : "none",
            }} />
          </div>

          <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
            <div style={{ display: "flex", gap: 4, flex: 1, minWidth: 0, flexWrap: "wrap" }}>
              {INTENTS.map(t => {
                const active = intent === t.id;
                return (
                  <button
                    key={t.id}
                    type="button"
                    onClick={() => setIntent(t.id)}
                    title={t.hint}
                    style={{
                      padding: "5px 10px",
                      borderRadius: 999,
                      border: `1px solid ${active ? "rgba(var(--atlas-gold-rgb), 0.55)" : "rgba(var(--atlas-gold-rgb), 0.14)"}`,
                      background: active ? "rgba(var(--atlas-gold-rgb), 0.14)" : "transparent",
                      color: active ? "var(--atlas-gold)" : "rgba(var(--atlas-muted-rgb), 0.7)",
                      fontFamily: "var(--app-font-mono)", fontSize: 10,
                      letterSpacing: "0.12em", textTransform: "uppercase",
                      cursor: "pointer", transition: "all 160ms",
                    }}
                  >
                    {t.label}
                  </button>
                );
              })}
            </div>

            <button type="button" onClick={toggleVoice} title={listening ? "Stop dictation" : "Dictate"} style={iconBtn(listening)}>
              {listening ? <MicOff size={14} /> : <Mic size={14} />}
            </button>

            <button
              type="button"
              onClick={submit}
              disabled={!canSubmit}
              style={{
                ...iconBtn(false),
                background: canSubmit ? "var(--atlas-gold)" : "rgba(var(--atlas-gold-rgb), 0.10)",
                color: canSubmit ? "#0D0B09" : "rgba(var(--atlas-gold-rgb), 0.35)",
                borderColor: "transparent",
                cursor: canSubmit ? "pointer" : "not-allowed",
                paddingInline: 10,
                gap: 6,
              }}
            >
              <CornerDownLeft size={13} />
              <span style={{ fontSize: 10, fontFamily: "var(--app-font-mono)", letterSpacing: "0.1em" }}>
                {submitting ? "…" : (destination === "park" ? "Park" : destination === "intake" ? "Intake" : "Forge")}
              </span>
            </button>

            {context !== "modal" && (
              <button type="button" onClick={() => { setText(""); setExpanded(false); }} title="Collapse" style={iconBtn(false)}>
                <X size={13} />
              </button>
            )}
          </div>

          {error && (
            <div style={{
              marginTop: 8, fontSize: 12,
              color: "rgba(239, 68, 68, 0.9)", fontFamily: "var(--app-font-mono)",
              letterSpacing: "0.04em",
            }}>
              {error}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function iconBtn(active: boolean): CSSProperties {
  return {
    display: "inline-flex", alignItems: "center", justifyContent: "center",
    height: 28, minWidth: 28,
    padding: "0 8px",
    borderRadius: 8,
    border: `1px solid ${active ? "rgba(var(--atlas-gold-rgb), 0.55)" : "rgba(var(--atlas-gold-rgb), 0.14)"}`,
    background: active ? "rgba(var(--atlas-gold-rgb), 0.14)" : "transparent",
    color: active ? "var(--atlas-gold)" : "rgba(var(--atlas-muted-rgb), 0.8)",
    cursor: "pointer", transition: "all 160ms",
  };
}

export default CaptureBar;
