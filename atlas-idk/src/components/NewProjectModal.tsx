import { useState, useMemo, useEffect, useRef } from "react";
import { Session, Project } from "@workspace/api-client-react";

const POETIC_NAMES = [
  "Quiet Forge", "North Star", "Slow Burn", "Open Field", "First Light",
  "Soft Launch", "Paper Trail", "Long Game", "Clean Slate", "Field Notes",
  "Wild Idea", "Bright Thread", "Small Bet", "Deep Work", "Loose Ends",
];

const DAY_NAMES = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
const MONTH_NAMES = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];

function buildSuggestions(): string[] {
  const now = new Date();
  const day = DAY_NAMES[now.getDay()];
  const month = MONTH_NAMES[now.getMonth()];
  const hour = now.getHours();
  const partOfDay = hour < 12 ? "Morning" : hour < 17 ? "Afternoon" : "Evening";
  return [
    `${day} Build`,
    `${month} Session`,
    `${partOfDay} Sketch`,
    ...POETIC_NAMES,
  ];
}

type Props = {
  open: boolean;
  onClose: () => void;
  onCreate: (name: string, githubRepo?: string) => void;
  creating?: boolean;
  error?: string | null;
};

export function NewProjectModal({ open, onClose, onCreate, creating, error }: Props) {
  const [name, setName] = useState("");
  const [showGithub, setShowGithub] = useState(false);
  const [githubRepo, setGithubRepo] = useState("");
  const suggestions = useMemo(() => buildSuggestions(), [open]);
  const idxRef = useRef(0);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (open) {
      setName("");
      setShowGithub(false);
      setGithubRepo("");
      idxRef.current = 0;
      setTimeout(() => inputRef.current?.focus(), 50);
    }
  }, [open]);

  if (!open) return null;

  const handleSparkle = () => {
    const next = suggestions[idxRef.current % suggestions.length];
    idxRef.current += 1;
    setName(next);
    inputRef.current?.focus();
  };

  const trimmed = name.trim();
  const canCreate = trimmed.length > 0 && !creating;

  const submit = (withGithub: boolean) => {
    if (!canCreate) return;
    onCreate(trimmed, withGithub && githubRepo.trim() ? githubRepo.trim() : undefined);
  };

  return (
    <div
      style={{ position: "fixed", inset: 0, zIndex: 300, display: "flex", alignItems: "center", justifyContent: "center", padding: 16 }}
      onClick={onClose}
    >
      <div style={{ position: "absolute", inset: 0, background: "rgba(0,0,0,0.65)", backdropFilter: "blur(6px)" }} />
      <div
        onClick={(e) => e.stopPropagation()}
        style={{
          position: "relative",
          width: "100%", maxWidth: 440,
          background: "var(--atlas-surface)",
          border: "1px solid var(--atlas-border)",
          borderRadius: 16,
          boxShadow: "0 24px 80px rgba(0,0,0,0.5)",
          padding: 22,
          fontFamily: "var(--app-font-sans)",
          animation: "atlas-modal-in 220ms cubic-bezier(.2,.8,.2,1) both",
        }}
      >
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 18 }}>
          <h2 style={{ margin: 0, fontSize: 15, fontWeight: 600, color: "var(--atlas-fg)", letterSpacing: "-0.01em" }}>
            New Project
          </h2>
          <button
            onClick={onClose}
            aria-label="Close"
            style={{ width: 26, height: 26, borderRadius: 8, border: "none", background: "transparent", cursor: "pointer", color: "var(--atlas-muted)", fontSize: 18, lineHeight: 1 }}
          >
            ×
          </button>
        </div>

        <label style={{ display: "block", fontSize: 11, fontWeight: 600, color: "var(--atlas-muted)", fontFamily: "var(--app-font-mono)", letterSpacing: "0.08em", textTransform: "uppercase", marginBottom: 8 }}>
          Project name
        </label>
        <div style={{ position: "relative", marginBottom: 14 }}>
          <input
            ref={inputRef}
            value={name}
            onChange={(e) => setName(e.target.value)}
            onKeyDown={(e) => { if (e.key === "Enter" && canCreate) submit(showGithub); }}
            placeholder="What are you building?"
            style={{
              width: "100%",
              padding: "10px 40px 10px 12px",
              borderRadius: 8,
              background: "var(--atlas-surface-alt)",
              border: "1px solid var(--atlas-border)",
              color: "var(--atlas-fg)",
              fontSize: 14,
              outline: "none",
              fontFamily: "var(--app-font-sans)",
            }}
            onFocus={(e) => (e.currentTarget.style.borderColor = "var(--atlas-gold)")}
            onBlur={(e) => (e.currentTarget.style.borderColor = "var(--atlas-border)")}
          />
          <button
            type="button"
            onClick={handleSparkle}
            title="Suggest a name"
            aria-label="Suggest a name"
            style={{
              position: "absolute", right: 6, top: "50%", transform: "translateY(-50%)",
              width: 28, height: 28, borderRadius: 6, border: "none",
              background: "transparent", cursor: "pointer",
              color: "var(--atlas-gold)", fontSize: 15, display: "flex", alignItems: "center", justifyContent: "center",
            }}
            onMouseEnter={(e) => (e.currentTarget.style.background = "rgba(201,162,76,0.12)")}
            onMouseLeave={(e) => (e.currentTarget.style.background = "transparent")}
          >
            ✦
          </button>
        </div>

        {/* GitHub section */}
        <button
          type="button"
          onClick={() => setShowGithub((v) => !v)}
          style={{
            display: "flex", alignItems: "center", gap: 6,
            background: "transparent", border: "none", cursor: "pointer",
            padding: "4px 0", color: "var(--atlas-muted)", fontSize: 12,
            fontFamily: "var(--app-font-sans)", marginBottom: showGithub ? 10 : 18,
          }}
        >
          <span style={{ fontSize: 10, transform: showGithub ? "rotate(90deg)" : "rotate(0)", transition: "transform 160ms", display: "inline-block" }}>▸</span>
          {showGithub ? "Hide GitHub repo" : "Add GitHub repo"}
          <span style={{ fontSize: 10, opacity: 0.6, fontFamily: "var(--app-font-mono)" }}>optional</span>
        </button>

        {showGithub && (
          <div style={{ marginBottom: 18 }}>
            <input
              value={githubRepo}
              onChange={(e) => setGithubRepo(e.target.value)}
              placeholder="owner/repo"
              style={{
                width: "100%",
                padding: "9px 12px",
                borderRadius: 8,
                background: "var(--atlas-surface-alt)",
                border: "1px solid var(--atlas-border)",
                color: "var(--atlas-fg)",
                fontSize: 13,
                outline: "none",
                fontFamily: "var(--app-font-mono)",
              }}
              onFocus={(e) => (e.currentTarget.style.borderColor = "var(--atlas-gold)")}
              onBlur={(e) => (e.currentTarget.style.borderColor = "var(--atlas-border)")}
            />
            <p style={{ margin: "6px 0 0", fontSize: 10.5, color: "var(--atlas-muted)", opacity: 0.7, fontFamily: "var(--app-font-mono)" }}>
              You can link or change this later.
            </p>
          </div>
        )}

        {error && (
          <div style={{ marginBottom: 12, padding: "8px 10px", borderRadius: 6, fontSize: 11, background: "rgba(146,64,14,0.12)", border: "0.5px solid rgba(146,64,14,0.4)", color: "var(--atlas-ember)", fontFamily: "var(--app-font-mono)" }}>
            {error}
          </div>
        )}

        <div style={{ display: "flex", gap: 8 }}>
          <button
            type="button"
            onClick={() => submit(false)}
            disabled={!canCreate}
            style={{
              flex: 1,
              padding: "10px 12px", borderRadius: 8,
              background: "transparent",
              border: "1px solid var(--atlas-border)",
              color: "var(--atlas-fg)",
              fontSize: 12, fontWeight: 600, fontFamily: "var(--app-font-sans)",
              cursor: canCreate ? "pointer" : "not-allowed",
              opacity: canCreate ? 1 : 0.45,
            }}
          >
            Start without GitHub
          </button>
          <button
            type="button"
            onClick={() => submit(showGithub)}
            disabled={!canCreate}
            style={{
              flex: 1,
              padding: "10px 12px", borderRadius: 8,
              background: "var(--atlas-gold)",
              border: "1px solid var(--atlas-gold)",
              color: "#1a1208",
              fontSize: 12, fontWeight: 700, fontFamily: "var(--app-font-mono)",
              letterSpacing: "0.08em", textTransform: "uppercase",
              cursor: canCreate ? "pointer" : "not-allowed",
              opacity: canCreate ? 1 : 0.45,
            }}
          >
            {creating ? "Creating…" : "Create Project"}
          </button>
        </div>
      </div>

      <style>{`
        @keyframes atlas-modal-in {
          from { transform: translateY(12px) scale(0.98); opacity: 0; }
          to   { transform: translateY(0) scale(1); opacity: 1; }
        }
      `}</style>
    </div>
  );
}
