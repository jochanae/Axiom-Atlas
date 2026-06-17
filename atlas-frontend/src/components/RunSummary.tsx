import { CheckCircle2, AlertTriangle, XCircle, GitCommit, FileText, Link as LinkIcon, ExternalLink } from "lucide-react";

export type RunStatus = "completed" | "warnings" | "failed" | "cancelled";

export type RunAction = {
  verb: string;          // e.g. "Updated", "Added", "Pushed to"
  target?: string;       // e.g. "src/app.ts", "main"
  status?: "ok" | "warn" | "fail";
};

export type RunArtifact = {
  type: "commit" | "file" | "url" | "pr";
  label: string;         // visible text, e.g. "fa20782"
  href?: string;         // optional click target
  meta?: string;         // small subtitle
};

const STATUS_META: Record<RunStatus, { label: string; color: string; bg: string; border: string; Icon: any }> = {
  completed: { label: "Completed", color: "#4ade80", bg: "rgba(74,222,128,0.08)", border: "rgba(74,222,128,0.3)", Icon: CheckCircle2 },
  warnings:  { label: "Completed with warnings", color: "#facc15", bg: "rgba(250,204,21,0.08)", border: "rgba(250,204,21,0.3)", Icon: AlertTriangle },
  failed:    { label: "Failed", color: "#f87171", bg: "rgba(248,113,113,0.08)", border: "rgba(248,113,113,0.3)", Icon: XCircle },
  cancelled: { label: "Cancelled", color: "var(--atlas-muted)", bg: "rgba(255,255,255,0.04)", border: "var(--atlas-border)", Icon: XCircle },
};

export function RunStatusBadge({ status }: { status?: RunStatus | null }) {
  if (!status) return null;
  const m = STATUS_META[status];
  if (!m) return null;
  const Icon = m.Icon;
  return (
    <span
      style={{
        display: "inline-flex", alignItems: "center", gap: 5,
        fontFamily: "var(--app-font-mono)", fontSize: 9, letterSpacing: "0.08em",
        textTransform: "uppercase",
        padding: "2px 7px", borderRadius: 3,
        background: m.bg, border: `1px solid ${m.border}`, color: m.color,
      }}
    >
      <Icon size={10} strokeWidth={2.25} />
      {m.label}
    </span>
  );
}

function ActionRow({ action }: { action: RunAction }) {
  const color =
    action.status === "fail" ? "#f87171" :
    action.status === "warn" ? "#facc15" :
    "var(--atlas-muted)";
  const dot =
    action.status === "fail" ? "✗" :
    action.status === "warn" ? "!" :
    "•";
  return (
    <div style={{ display: "flex", alignItems: "baseline", gap: 8, fontSize: 12, lineHeight: 1.55, color: "var(--atlas-fg)" }}>
      <span style={{ color, fontFamily: "var(--app-font-mono)", fontSize: 11, flexShrink: 0, width: 10, textAlign: "center" }}>{dot}</span>
      <span>
        <span style={{ color: "var(--atlas-fg)" }}>{action.verb}</span>
        {action.target && (
          <>
            {" "}
            <code style={{
              fontFamily: "var(--app-font-mono)", fontSize: 11,
              background: "var(--atlas-surface)", padding: "1px 6px", borderRadius: 3,
              color: "rgba(201,162,76,0.9)",
            }}>{action.target}</code>
          </>
        )}
      </span>
    </div>
  );
}

function ArtifactChip({ artifact }: { artifact: RunArtifact }) {
  const Icon =
    artifact.type === "commit" ? GitCommit :
    artifact.type === "file" ? FileText :
    artifact.type === "pr" ? GitCommit :
    LinkIcon;
  const inner = (
    <>
      <Icon size={11} strokeWidth={2} style={{ opacity: 0.7 }} />
      <span style={{ fontFamily: "var(--app-font-mono)", fontSize: 11 }}>{artifact.label}</span>
      {artifact.meta && (
        <span style={{ fontFamily: "var(--app-font-mono)", fontSize: 9, opacity: 0.55, marginLeft: 2 }}>{artifact.meta}</span>
      )}
      {artifact.href && <ExternalLink size={9} strokeWidth={2} style={{ opacity: 0.5 }} />}
    </>
  );
  const style: React.CSSProperties = {
    display: "inline-flex", alignItems: "center", gap: 5,
    padding: "3px 8px", borderRadius: 4,
    background: "var(--atlas-surface)", border: "1px solid var(--atlas-border)",
    color: "var(--atlas-fg)", textDecoration: "none",
    transition: "border-color 150ms, background 150ms", cursor: artifact.href ? "pointer" : "default",
  };
  if (artifact.href) {
    return (
      <a
        href={artifact.href}
        target="_blank"
        rel="noreferrer noopener"
        style={style}
        onMouseEnter={(e) => { e.currentTarget.style.borderColor = "rgba(201,162,76,0.35)"; }}
        onMouseLeave={(e) => { e.currentTarget.style.borderColor = "var(--atlas-border)"; }}
      >
        {inner}
      </a>
    );
  }
  return <span style={style}>{inner}</span>;
}

export function RunSummaryBlock({
  status,
  actions,
  artifacts,
  summary,
}: {
  status?: RunStatus | null;
  actions?: RunAction[] | null;
  artifacts?: RunArtifact[] | null;
  summary?: string | null;
}) {
  const hasActions = !!actions?.length;
  const hasArtifacts = !!artifacts?.length;
  if (!status && !hasActions && !hasArtifacts && !summary) return null;

  return (
    <div style={{
      marginTop: 10, marginBottom: 4,
      padding: "10px 12px",
      borderLeft: "2px solid var(--atlas-border)",
      background: "rgba(255,255,255,0.015)",
      borderRadius: "0 6px 6px 0",
      display: "flex", flexDirection: "column", gap: 8,
    }}>
      {(status || summary) && (
        <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
          <RunStatusBadge status={status} />
          {summary && (
            <span style={{ fontSize: 12, color: "var(--atlas-fg)", fontWeight: 500 }}>{summary}</span>
          )}
        </div>
      )}
      {hasActions && (
        <div style={{ display: "flex", flexDirection: "column", gap: 3 }}>
          {actions!.map((a, idx) => <ActionRow key={idx} action={a} />)}
        </div>
      )}
      {hasArtifacts && (
        <div style={{ display: "flex", flexWrap: "wrap", gap: 6, marginTop: 2 }}>
          {artifacts!.map((a, idx) => <ArtifactChip key={idx} artifact={a} />)}
        </div>
      )}
    </div>
  );
}
