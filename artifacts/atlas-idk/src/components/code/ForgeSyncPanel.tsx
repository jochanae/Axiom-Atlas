import { useCallback, useEffect, useMemo, useState, type CSSProperties } from "react";
import { AlertTriangle, Hammer, RefreshCw, X } from "lucide-react";
import { apiUrl } from "@/lib/api";
import type { GeneratedFile } from "@/pages/code";

type Confidence = "high" | "medium" | "low" | string;

type ProposedNodeMatch = {
  nodeLabel?: string;
  confidence?: Confidence;
  reasoning?: string;
};

type ProposedDnaLesson =
  | string
  | {
      text?: string;
      lesson?: string;
      summary?: string;
      [key: string]: unknown;
    };

type ForgeSyncChange =
  | string
  | {
      label?: string;
      description?: string;
      text?: string;
      [key: string]: unknown;
    };

type ForgeSyncResponse = {
  summary?: string;
  changes?: ForgeSyncChange[];
  proposedNodeMatch?: ProposedNodeMatch | null;
  proposedDnaLesson?: ProposedDnaLesson | null;
};

type ForgeSyncPanelProps = {
  projectId: number;
  runId: string;
  files: GeneratedFile[];
  runSummary: string;
  onClose: () => void;
};

const MONO: CSSProperties = {
  fontFamily: "var(--app-font-mono, ui-monospace, SFMono-Regular, Menlo, monospace)",
};

const liveFeedLines = [
  "[ Analyzing AST... ]",
  "[ Detecting modifications... ]",
  "[ Extracting state logic... ]",
  "[ Reconciling with strategy... ]",
];

function formatError(error: unknown) {
  return error instanceof Error ? error.message : "Forge Sync could not complete. Please try again.";
}

function responseError(status: number, statusText: string, body: string) {
  const detail = body.trim() ? ` - ${body.trim().slice(0, 220)}` : "";
  return `Forge Sync failed: ${status} ${statusText}${detail}`;
}

function formatChange(change: ForgeSyncChange, index: number) {
  if (typeof change === "string") return change;
  return change.text ?? change.description ?? change.label ?? `Change ${index + 1}`;
}

function dnaLessonText(lesson: ProposedDnaLesson) {
  if (typeof lesson === "string") return lesson;
  return lesson.text ?? lesson.lesson ?? lesson.summary ?? "A durable preference was detected.";
}

function confidenceStyle(confidence?: Confidence): CSSProperties {
  if (confidence === "high") {
    return {
      color: "#7CE3A0",
      borderColor: "rgba(124,227,160,0.32)",
      background: "rgba(124,227,160,0.08)",
    };
  }
  if (confidence === "medium") {
    return {
      color: "var(--atlas-gold)",
      borderColor: "color-mix(in oklab, var(--atlas-gold) 28%, transparent)",
      background: "rgba(230,198,135,0.08)",
    };
  }
  return {
    color: "var(--atlas-muted)",
    borderColor: "rgba(255,255,255,0.08)",
    background: "rgba(255,255,255,0.03)",
  };
}

function ProposalCard({
  title,
  children,
}: {
  title: string;
  children: React.ReactNode;
}) {
  return (
    <section className="forge-sync-card forge-sync-proposal">
      <div className="forge-sync-section-header">
        <span>{title}</span>
        <span className="forge-sync-coming-next">coming next</span>
      </div>
      <div className="forge-sync-proposal-body">{children}</div>
      <button type="button" className="forge-sync-confirm" disabled>
        Confirm
      </button>
    </section>
  );
}

export function ForgeSyncPanel({
  projectId,
  runId,
  files,
  runSummary,
  onClose,
}: ForgeSyncPanelProps) {
  const [data, setData] = useState<ForgeSyncResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(true);

  const shortRunId = useMemo(() => runId.slice(0, 8), [runId]);
  const changes = useMemo(() => data?.changes ?? [], [data?.changes]);

  const postForgeSync = useCallback(
    async (signal?: AbortSignal) => {
      setIsLoading(true);
      setError(null);

      try {
        const res = await fetch(apiUrl(`/api/projects/${projectId}/forge-sync`), {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          credentials: "include",
          signal,
          body: JSON.stringify({ runId }),
        });

        if (!res.ok) {
          const body = await res.text().catch(() => "");
          throw new Error(responseError(res.status, res.statusText, body));
        }

        const json = (await res.json()) as ForgeSyncResponse;
        setData(json);
      } catch (err) {
        if (err instanceof DOMException && err.name === "AbortError") return;
        setData(null);
        setError(formatError(err));
      } finally {
        if (!signal?.aborted) setIsLoading(false);
      }
    },
    [projectId, runId],
  );

  useEffect(() => {
    const controller = new AbortController();
    void postForgeSync(controller.signal);
    return () => controller.abort();
  }, [postForgeSync]);

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [onClose]);

  return (
    <div className="forge-sync-overlay" role="dialog" aria-modal="true" aria-labelledby="forge-sync-title">
      <style>{`
        .forge-sync-overlay {
          position: fixed;
          inset: 0;
          z-index: 80;
          display: flex;
          align-items: center;
          justify-content: flex-end;
          padding: 24px;
          background:
            radial-gradient(circle at 78% 12%, rgba(230,198,135,0.12), transparent 34%),
            rgba(4,3,8,0.62);
          backdrop-filter: blur(12px);
        }

        .forge-sync-panel {
          width: min(720px, calc(100vw - 48px));
          max-height: min(820px, calc(100dvh - 48px));
          display: flex;
          flex-direction: column;
          overflow: hidden;
          background: color-mix(in oklab, #0A0910 94%, transparent);
          border: 1px solid color-mix(in oklab, var(--atlas-gold) 20%, transparent);
          border-radius: 18px;
          box-shadow: 0 24px 80px rgba(0,0,0,0.58), 0 0 0 1px rgba(255,255,255,0.025) inset;
          backdrop-filter: blur(18px);
          animation: forge-sync-enter 220ms ease-out;
        }

        .forge-sync-header {
          display: flex;
          align-items: flex-start;
          gap: 12px;
          padding: 18px 20px 15px;
          border-bottom: 1px solid rgba(255,255,255,0.06);
          background: linear-gradient(180deg, rgba(230,198,135,0.075), rgba(230,198,135,0));
        }

        .forge-sync-icon {
          width: 34px;
          height: 34px;
          border-radius: 10px;
          display: inline-flex;
          align-items: center;
          justify-content: center;
          color: var(--atlas-gold);
          background: linear-gradient(135deg, rgba(230,198,135,0.2), rgba(230,198,135,0.055));
          border: 1px solid rgba(230,198,135,0.28);
          flex: 0 0 auto;
        }

        .forge-sync-kicker,
        .forge-sync-section-header,
        .forge-sync-coming-next,
        .forge-sync-confirm,
        .forge-sync-meta,
        .forge-sync-error-title,
        .forge-sync-retry,
        .forge-sync-empty,
        .forge-sync-confidence,
        .forge-sync-log-line {
          font-family: var(--app-font-mono, ui-monospace, SFMono-Regular, Menlo, monospace);
        }

        .forge-sync-kicker {
          margin-bottom: 4px;
          color: var(--atlas-gold);
          font-size: 10px;
          letter-spacing: 0.18em;
          text-transform: uppercase;
        }

        .forge-sync-title {
          margin: 0;
          color: var(--atlas-fg);
          font-size: 19px;
          font-weight: 600;
          letter-spacing: -0.02em;
        }

        .forge-sync-subtitle {
          margin: 6px 0 0;
          color: var(--atlas-muted);
          font-size: 12px;
          line-height: 1.55;
        }

        .forge-sync-close {
          margin-left: auto;
          width: 32px;
          height: 32px;
          display: inline-flex;
          align-items: center;
          justify-content: center;
          border-radius: 9px;
          border: 1px solid rgba(255,255,255,0.08);
          background: rgba(255,255,255,0.03);
          color: var(--atlas-muted);
          cursor: pointer;
        }

        .forge-sync-close:hover {
          color: var(--atlas-gold);
          border-color: color-mix(in oklab, var(--atlas-gold) 28%, transparent);
        }

        .forge-sync-body {
          padding: 18px 20px 22px;
          overflow: auto;
          display: grid;
          gap: 14px;
        }

        .forge-sync-card {
          border-radius: 14px;
          border: 1px solid color-mix(in oklab, var(--atlas-gold) 14%, transparent);
          background: rgba(255,255,255,0.025);
          box-shadow: 0 0 0 1px rgba(255,255,255,0.018) inset;
        }

        .forge-sync-summary {
          padding: 15px;
          background:
            radial-gradient(circle at 12% 0%, rgba(230,198,135,0.11), transparent 36%),
            rgba(230,198,135,0.035);
        }

        .forge-sync-summary p,
        .forge-sync-proposal-body p,
        .forge-sync-error p {
          margin: 0;
          color: var(--atlas-fg);
          opacity: 0.86;
          font-size: 13px;
          line-height: 1.65;
        }

        .forge-sync-section-header {
          display: flex;
          align-items: center;
          justify-content: space-between;
          gap: 10px;
          margin-bottom: 10px;
          color: var(--atlas-gold);
          font-size: 10px;
          letter-spacing: 0.16em;
          text-transform: uppercase;
        }

        .forge-sync-change-list {
          margin: 0;
          padding: 0;
          list-style: none;
          display: grid;
          gap: 8px;
        }

        .forge-sync-change-list li {
          position: relative;
          padding: 10px 12px 10px 30px;
          border: 1px solid rgba(255,255,255,0.055);
          border-radius: 10px;
          background: rgba(10,9,16,0.56);
          color: var(--atlas-fg);
          font-size: 12.5px;
          line-height: 1.5;
        }

        .forge-sync-change-list li::before {
          content: "";
          position: absolute;
          top: 16px;
          left: 13px;
          width: 6px;
          height: 6px;
          border-radius: 99px;
          background: var(--atlas-gold);
          box-shadow: 0 0 10px rgba(230,198,135,0.38);
        }

        .forge-sync-proposal {
          padding: 14px;
        }

        .forge-sync-proposal-body {
          min-height: 68px;
          display: grid;
          gap: 8px;
        }

        .forge-sync-node-line {
          display: flex;
          align-items: center;
          flex-wrap: wrap;
          gap: 8px;
        }

        .forge-sync-node-label {
          color: var(--atlas-fg);
          font-size: 14px;
          font-weight: 600;
        }

        .forge-sync-confidence {
          padding: 3px 7px;
          border-radius: 999px;
          border: 1px solid;
          font-size: 9px;
          letter-spacing: 0.12em;
          text-transform: uppercase;
        }

        .forge-sync-coming-next {
          color: var(--atlas-muted);
          font-size: 9px;
          letter-spacing: 0.12em;
          text-transform: uppercase;
        }

        .forge-sync-confirm {
          margin-top: 13px;
          padding: 7px 12px;
          border-radius: 9px;
          border: 1px solid rgba(255,255,255,0.07);
          background: rgba(255,255,255,0.035);
          color: var(--atlas-muted);
          font-size: 10px;
          letter-spacing: 0.12em;
          text-transform: uppercase;
          cursor: not-allowed;
          opacity: 0.62;
        }

        .forge-sync-meta {
          display: flex;
          flex-wrap: wrap;
          gap: 8px;
          color: var(--atlas-muted);
          font-size: 10px;
          letter-spacing: 0.06em;
        }

        .forge-sync-meta span {
          padding: 4px 8px;
          border-radius: 999px;
          border: 1px solid rgba(255,255,255,0.06);
          background: rgba(255,255,255,0.025);
        }

        .forge-sync-loading {
          min-height: 260px;
          display: flex;
          flex-direction: column;
          justify-content: center;
          gap: 12px;
        }

        .forge-sync-log-line {
          color: var(--atlas-gold);
          font-size: 12px;
          letter-spacing: 0.08em;
          opacity: 0.42;
          animation: forge-sync-pulse 1.8s ease-in-out infinite;
        }

        .forge-sync-error {
          padding: 18px;
          display: grid;
          gap: 10px;
          border-color: rgba(255,138,138,0.24);
          background: rgba(255,138,138,0.055);
        }

        .forge-sync-error-title {
          display: inline-flex;
          align-items: center;
          gap: 8px;
          color: #FF8A8A;
          font-size: 11px;
          letter-spacing: 0.14em;
          text-transform: uppercase;
        }

        .forge-sync-retry {
          width: fit-content;
          display: inline-flex;
          align-items: center;
          gap: 7px;
          padding: 7px 12px;
          border-radius: 9px;
          border: 1px solid color-mix(in oklab, var(--atlas-gold) 26%, transparent);
          background: rgba(230,198,135,0.08);
          color: var(--atlas-gold);
          font-size: 11px;
          cursor: pointer;
        }

        .forge-sync-empty {
          color: var(--atlas-muted);
          font-size: 11px;
          letter-spacing: 0.04em;
        }

        @keyframes forge-sync-enter {
          from {
            opacity: 0;
            transform: translate3d(0, 18px, 0) scale(0.985);
          }
          to {
            opacity: 1;
            transform: translate3d(0, 0, 0) scale(1);
          }
        }

        @keyframes forge-sync-pulse {
          0%, 100% {
            opacity: 0.34;
            transform: translateX(0);
          }
          45% {
            opacity: 1;
            transform: translateX(4px);
          }
        }

        @media (max-width: 768px) {
          .forge-sync-overlay {
            align-items: flex-end;
            justify-content: center;
            padding: 0;
          }

          .forge-sync-panel {
            width: 100%;
            max-height: calc(100dvh - 38px);
            border-radius: 20px 20px 0 0;
            border-left: none;
            border-right: none;
            border-bottom: none;
          }

          .forge-sync-header {
            padding: 16px;
          }

          .forge-sync-body {
            padding: 16px 16px calc(18px + env(safe-area-inset-bottom, 0px));
          }
        }
      `}</style>

      <div className="forge-sync-panel" onClick={(event) => event.stopPropagation()}>
        <header className="forge-sync-header">
          <div className="forge-sync-icon">
            <Hammer size={17} />
          </div>
          <div style={{ minWidth: 0 }}>
            <div className="forge-sync-kicker">Forge Sync</div>
            <h2 id="forge-sync-title" className="forge-sync-title">
              Reconciliation Panel
            </h2>
            <p className="forge-sync-subtitle">
              {runSummary || "Reconciling this generation run against Forge memory and Flow intent."}
            </p>
            <div className="forge-sync-meta" style={{ marginTop: 10 }}>
              <span>run {shortRunId}</span>
              <span>{files.length} file{files.length === 1 ? "" : "s"}</span>
              <span>display only</span>
            </div>
          </div>
          <button type="button" className="forge-sync-close" aria-label="Close Forge Sync" onClick={onClose}>
            <X size={16} />
          </button>
        </header>

        <div className="forge-sync-body">
          {isLoading ? (
            <div className="forge-sync-loading" aria-live="polite">
              {liveFeedLines.map((line, index) => (
                <div
                  key={line}
                  className="forge-sync-log-line"
                  style={{ animationDelay: `${index * 180}ms` }}
                >
                  {line}
                </div>
              ))}
            </div>
          ) : error ? (
            <section className="forge-sync-card forge-sync-error" role="alert">
              <div className="forge-sync-error-title">
                <AlertTriangle size={14} /> Forge Sync interrupted
              </div>
              <p>{error}</p>
              <button type="button" className="forge-sync-retry" onClick={() => { void postForgeSync(); }}>
                <RefreshCw size={12} /> Retry
              </button>
            </section>
          ) : (
            <>
              <section className="forge-sync-card forge-sync-summary">
                <div className="forge-sync-section-header">
                  <span>SYSTEM EVOLUTION DETECTED</span>
                </div>
                <p>{data?.summary || "No strategic summary returned."}</p>
              </section>

              <section className="forge-sync-card" style={{ padding: 14 }}>
                <div className="forge-sync-section-header">
                  <span>Detected changes</span>
                  <span className="forge-sync-coming-next">{changes.length}</span>
                </div>
                {changes.length ? (
                  <ul className="forge-sync-change-list">
                    {changes.map((change, index) => (
                      <li key={`${formatChange(change, index)}-${index}`}>{formatChange(change, index)}</li>
                    ))}
                  </ul>
                ) : (
                  <div className="forge-sync-empty">No changes returned by Forge Sync.</div>
                )}
              </section>

              <ProposalCard title="Proposed Flow node">
                {data?.proposedNodeMatch ? (
                  <>
                    <div className="forge-sync-node-line">
                      <span className="forge-sync-node-label">
                        {data.proposedNodeMatch.nodeLabel || "Untitled node"}
                      </span>
                      <span
                        className="forge-sync-confidence"
                        style={confidenceStyle(data.proposedNodeMatch.confidence)}
                      >
                        {data.proposedNodeMatch.confidence || "low"}
                      </span>
                    </div>
                    <p>{data.proposedNodeMatch.reasoning || "Forge Sync did not include reasoning."}</p>
                  </>
                ) : (
                  <div className="forge-sync-empty">No matching node detected.</div>
                )}
              </ProposalCard>

              <ProposalCard title="Proposed DNA lesson">
                {data?.proposedDnaLesson ? (
                  <p>{dnaLessonText(data.proposedDnaLesson)}</p>
                ) : (
                  <div className="forge-sync-empty">No durable preference detected.</div>
                )}
              </ProposalCard>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
