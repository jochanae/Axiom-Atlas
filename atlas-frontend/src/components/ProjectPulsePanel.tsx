import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { X, Check } from "lucide-react";
import { useUpdateProject, getGetProjectQueryKey, getListProjectsQueryKey } from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import { LIFECYCLE_META, type Lifecycle } from "@/lib/lifecycle";

interface Props {
  projectId: number;
  projectName: string;
  state: Lifecycle;
  readinessScore: number | null;
  decisionCount: number | null;
  hasRepo: boolean;
  lastActivityAt: string | null;
  themes: string[];
  recentDecisions: Array<{ title: string; at?: string | null }>;
  onClose: () => void;
}

function relTime(iso: string | null): string {
  if (!iso) return "—";
  const diff = Date.now() - new Date(iso).getTime();
  const m = Math.floor(diff / 60000);
  if (m < 1) return "just now";
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  const d = Math.floor(h / 24);
  return `${d}d ago`;
}

/**
 * Read-only window into Atlas's understanding of the project.
 * Tapping the lifecycle glyph opens this. No actions, no commit buttons.
 */
export function ProjectPulsePanel(props: Props) {
  const {
    projectId, projectName, state, readinessScore, decisionCount, hasRepo,
    lastActivityAt, themes, recentDecisions, onClose,
  } = props;

  const meta = LIFECYCLE_META[state];
  const updateProject = useUpdateProject();
  const queryClient = useQueryClient();
  const [justMarked, setJustMarked] = useState(false);

  const handleMarkBuilt = () => {
    updateProject.mutate(
      { id: projectId, data: { status: "built" } as any },
      {
        onSuccess: () => {
          queryClient.invalidateQueries({ queryKey: getGetProjectQueryKey(projectId) });
          queryClient.invalidateQueries({ queryKey: getListProjectsQueryKey() });
          setJustMarked(true);
          setTimeout(() => { setJustMarked(false); onClose(); }, 900);
        },
      }
    );
  };

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [onClose]);

  // Momentum assessment from signals available
  const score = readinessScore ?? 0;
  const dCount = decisionCount ?? 0;
  const coherence = score >= 60 ? "High" : score >= 30 ? "Building" : "Early";
  const momentum =
    dCount >= 3 ? "Increasing" :
    dCount >= 1 ? "Steady" :
    "Nascent";

  const isEmpty = themes.length === 0 && recentDecisions.length === 0 && !lastActivityAt && dCount === 0;

  return createPortal(
    <div
      onClick={onClose}
      style={{
        position: "fixed", inset: 0, zIndex: 13000,
        background: "rgba(var(--atlas-bg-rgb), 0.55)",
        backdropFilter: "blur(10px)",
        WebkitBackdropFilter: "blur(10px)",
        display: "flex", alignItems: "center", justifyContent: "center",
        padding: 16,
        animation: "atlas-fade-in 180ms ease",
      }}
    >
      <style>{`
        @keyframes atlas-fade-in { from { opacity: 0 } to { opacity: 1 } }
        @keyframes atlas-pulse-rise { from { opacity: 0; transform: translateY(8px) } to { opacity: 1; transform: translateY(0) } }
      `}</style>
      <div
        role="dialog"
        aria-label={`${projectName} pulse`}
        onClick={(e) => e.stopPropagation()}
        style={{
          width: "100%", maxWidth: 420, maxHeight: "85vh", overflowY: "auto",
          background: "rgba(var(--atlas-surface-rgb), 0.96)",
          border: "1px solid rgba(var(--atlas-gold-rgb), 0.22)",
          borderRadius: 14,
          boxShadow: "0 24px 80px rgba(0,0,0,0.35), inset 0 1px 0 rgba(var(--atlas-gold-rgb), 0.06)",
          padding: 20,
          animation: "atlas-pulse-rise 240ms cubic-bezier(0.22,1,0.36,1)",
          fontFamily: "var(--app-font-sans)",
          color: "var(--atlas-fg)",
        }}
      >
        {/* Header */}
        <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", marginBottom: 14 }}>
          <div style={{ minWidth: 0, flex: 1 }}>
            <div style={{
              fontSize: 9.5, fontFamily: "var(--app-font-mono)", color: "var(--atlas-gold)",
              letterSpacing: "0.18em", textTransform: "uppercase", opacity: 0.85, marginBottom: 4,
            }}>
              Atlas Pulse
            </div>
            <div style={{
              fontSize: 17, fontWeight: 600, lineHeight: 1.2,
              display: "flex", alignItems: "center", gap: 8,
              overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap",
            }}>
              <span style={{ overflow: "hidden", textOverflow: "ellipsis" }}>{projectName}</span>
              <span style={{ color: meta.color, fontSize: 15, flexShrink: 0 }}>{meta.glyph}</span>
            </div>
          </div>
          <button
            type="button" onClick={onClose} aria-label="Close"
            style={{
              flexShrink: 0, width: 28, height: 28, borderRadius: 6,
              border: "1px solid rgba(201,162,76,0.15)", background: "transparent",
              color: "var(--atlas-muted)", cursor: "pointer",
              display: "flex", alignItems: "center", justifyContent: "center",
            }}
          >
            <X size={14} strokeWidth={1.6} />
          </button>
        </div>

        {/* Current state */}
        <Section label="Current State">
          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <span style={{ color: meta.color, fontSize: 14 }}>{meta.glyph}</span>
            <span style={{ color: "var(--atlas-fg)", fontSize: 13, fontWeight: 500 }}>{meta.label}</span>
            <span style={{ color: "var(--atlas-muted)", fontSize: 12, opacity: 0.7 }}>— {meta.description}</span>
          </div>
        </Section>

        {isEmpty ? (
          <div style={{
            marginTop: 14, padding: "14px 14px",
            background: "rgba(255,255,255,0.02)",
            border: "1px solid rgba(255,255,255,0.06)",
            borderRadius: 10,
            fontSize: 12.5, color: "var(--atlas-muted)", lineHeight: 1.55,
          }}>
            This project is brand new. Atlas hasn&apos;t gathered enough signal yet — themes and decisions will appear here as the conversation deepens.
          </div>
        ) : (
          <>
            {themes.length > 0 && (
              <Section label="Emerging Themes">
                <ul style={listStyle}>
                  {themes.slice(0, 6).map((t, i) => (
                    <li key={i} style={liStyle}>{t}</li>
                  ))}
                </ul>
              </Section>
            )}

            {recentDecisions.length > 0 && (
              <Section label="Recent Decisions">
                <ul style={listStyle}>
                  {recentDecisions.slice(0, 4).map((d, i) => (
                    <li key={i} style={liStyle}>
                      {d.title}
                      {d.at && <span style={{ color: "var(--atlas-muted)", opacity: 0.6, marginLeft: 6, fontSize: 11 }}>· {relTime(d.at)}</span>}
                    </li>
                  ))}
                </ul>
              </Section>
            )}

            <Section label="Atlas Assessment">
              <div style={{ display: "flex", flexDirection: "column", gap: 4, fontSize: 12.5 }}>
                <Row k="Coherence" v={coherence} />
                <Row k="Momentum" v={momentum} />
                {readinessScore != null && <Row k="Readiness" v={`${readinessScore}%`} />}
                {hasRepo && <Row k="Repository" v="Linked" />}
              </div>
            </Section>

            {lastActivityAt && (
              <Section label="Last Meaningful Activity">
                <span style={{ fontSize: 12.5, color: "var(--atlas-fg)", opacity: 0.85 }}>
                  {relTime(lastActivityAt)}
                </span>
              </Section>
            )}
          </>
        )}

        {/* Mark as Built — user-confirmed transition */}
        {state !== "built" && (
          <div style={{ marginTop: 18 }}>
            <button
              type="button"
              onClick={handleMarkBuilt}
              disabled={updateProject.isPending || justMarked}
              style={{
                width: "100%",
                padding: "10px 12px",
                borderRadius: 10,
                border: `1px solid ${justMarked ? "rgba(120,180,160,0.55)" : "rgba(201,162,76,0.32)"}`,
                background: justMarked ? "rgba(120,180,160,0.16)" : "rgba(201,162,76,0.10)",
                color: justMarked ? "rgba(180,220,200,0.95)" : "var(--atlas-gold)",
                cursor: updateProject.isPending ? "not-allowed" : "pointer",
                fontSize: 12.5,
                fontWeight: 600,
                fontFamily: "var(--app-font-sans)",
                letterSpacing: "0.02em",
                display: "flex", alignItems: "center", justifyContent: "center", gap: 8,
                transition: "all 180ms ease",
              }}
            >
              <Check size={14} strokeWidth={2} />
              {justMarked ? "Marked as Built" : updateProject.isPending ? "Saving…" : "Mark as Built"}
            </button>
            <div style={{ marginTop: 6, fontSize: 10.5, color: "var(--atlas-muted)", opacity: 0.6, fontFamily: "var(--app-font-mono)", lineHeight: 1.5 }}>
              Built means complete and successful. This is your call — Atlas won&apos;t make it for you.
            </div>
          </div>
        )}

        {/* Footnote — explains who decides what */}
        <div style={{
          marginTop: 16, paddingTop: 12,
          borderTop: "1px solid rgba(201,162,76,0.1)",
          fontSize: 10.5, color: "var(--atlas-muted)", opacity: 0.55,
          fontFamily: "var(--app-font-mono)", letterSpacing: "0.04em", lineHeight: 1.5,
        }}>
          Shaping and Committed are Atlas assessments — they shift automatically as evidence accrues. Built is your call.
        </div>
      </div>
    </div>,
    document.body
  );
}

function Section({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div style={{ marginTop: 14 }}>
      <div style={{
        fontSize: 9, fontFamily: "var(--app-font-mono)", color: "var(--atlas-muted)",
        letterSpacing: "0.16em", textTransform: "uppercase", opacity: 0.6, marginBottom: 6,
      }}>
        {label}
      </div>
      {children}
    </div>
  );
}

function Row({ k, v }: { k: string; v: string }) {
  return (
    <div style={{ display: "flex", justifyContent: "space-between", gap: 12 }}>
      <span style={{ color: "var(--atlas-muted)", opacity: 0.75 }}>{k}</span>
      <span style={{ color: "var(--atlas-fg)" }}>{v}</span>
    </div>
  );
}

const listStyle: React.CSSProperties = {
  listStyle: "none", padding: 0, margin: 0,
  display: "flex", flexDirection: "column", gap: 5,
};
const liStyle: React.CSSProperties = {
  fontSize: 12.5, color: "var(--atlas-fg)", opacity: 0.88, lineHeight: 1.45,
  paddingLeft: 12, position: "relative",
};
