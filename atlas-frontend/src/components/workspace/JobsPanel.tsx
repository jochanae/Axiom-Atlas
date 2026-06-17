import { useCallback, useEffect, useMemo, useState } from "react";
import { timeAgo } from "@/lib/formatters";

type JobStatus = "queued" | "running" | "completed" | "failed";
type JobType = "scan" | "selfmap" | "blueprint";

type Job = {
  id: number | string;
  type: JobType;
  status: JobStatus;
  createdAt: string;
  output?: {
    summary?: string;
  } | string | null;
  outputSummary?: string | null;
  summary?: string | null;
  error?: string | null;
  errorMessage?: string | null;
  message?: string | null;
};

type JobsPanelProps = {
  projectId: number;
};

const STATUS_STYLES: Record<JobStatus, { color: string; className?: string }> = {
  queued: { color: "#f59e0b" },
  running: { color: "#3b82f6", className: "atlas-pulse-dot" },
  completed: { color: "#22c55e" },
  failed: { color: "#ef4444" },
};

function getOutputSummary(job: Job) {
  if (typeof job.output === "string") return job.output;
  return job.output?.summary ?? job.outputSummary ?? job.summary ?? null;
}

function getErrorMessage(job: Job) {
  return job.error ?? job.errorMessage ?? job.message ?? null;
}

export function JobsPanel({ projectId }: JobsPanelProps) {
  const [jobs, setJobs] = useState<Job[]>([]);
  const [loading, setLoading] = useState(false);
  const [runningType, setRunningType] = useState<JobType | null>(null);
  const [error, setError] = useState<string | null>(null);

  const hasActiveJobs = useMemo(
    () => jobs.some((job) => job.status === "queued" || job.status === "running"),
    [jobs]
  );

  const loadJobs = useCallback(async () => {
    setError(null);

    try {
      const res = await fetch(`/api/jobs?projectId=${projectId}`, {
        credentials: "include",
      });

      if (!res.ok) throw new Error(`HTTP ${res.status}`);

      const data = await res.json();
      setJobs(Array.isArray(data) ? data : data?.jobs ?? []);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not load jobs");
      setJobs([]);
    }
  }, [projectId]);

  useEffect(() => {
    setLoading(true);
    void loadJobs().finally(() => setLoading(false));
  }, [loadJobs]);

  useEffect(() => {
    if (!hasActiveJobs) return;

    const intervalId = window.setInterval(() => {
      void loadJobs();
    }, 3000);

    return () => window.clearInterval(intervalId);
  }, [hasActiveJobs, loadJobs]);

  const runJob = async (type: "scan" | "selfmap") => {
    setRunningType(type);
    setError(null);

    try {
      const body =
        type === "scan"
          ? { type: "scan", projectId, input: { projectId } }
          : { type: "selfmap", input: {} };

      const res = await fetch("/api/jobs", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify(body),
      });

      if (!res.ok) throw new Error(`HTTP ${res.status}`);

      await loadJobs();
    } catch (err) {
      setError(err instanceof Error ? err.message : `Could not run ${type}`);
    } finally {
      setRunningType(null);
    }
  };

  return (
    <div
      style={{
        display: "flex",
        flexDirection: "column",
        gap: 14,
        flex: 1,
        minHeight: 0,
        padding: 16,
        background: "var(--atlas-surface)",
        color: "var(--atlas-fg)",
        fontFamily: "var(--app-font-mono)",
        overflowY: "auto",
      }}
    >
      <div
        style={{
          border: "1px solid var(--atlas-border)",
          borderRadius: 12,
          padding: 14,
          background: "var(--atlas-surface)",
        }}
      >
        <div
          style={{
            color: "var(--atlas-gold)",
            fontSize: 12,
            fontWeight: 700,
            letterSpacing: "0.08em",
            marginBottom: 6,
            textTransform: "uppercase",
          }}
        >
          Jobs
        </div>
        <div style={{ color: "var(--atlas-muted)", fontSize: 11 }}>
          Run and monitor project background jobs.
        </div>
      </div>

      <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
        <button
          type="button"
          disabled={runningType !== null}
          onClick={() => void runJob("scan")}
          style={{
            border: "1px solid var(--atlas-gold)",
            borderRadius: 999,
            padding: "8px 12px",
            background: "transparent",
            color: "var(--atlas-gold)",
            cursor: runningType !== null ? "not-allowed" : "pointer",
            fontFamily: "var(--app-font-mono)",
            fontSize: 11,
            fontWeight: 700,
            letterSpacing: "0.08em",
            opacity: runningType !== null ? 0.55 : 1,
            textTransform: "uppercase",
          }}
        >
          {runningType === "scan" ? "Starting..." : "Run Scan"}
        </button>
        <button
          type="button"
          disabled={runningType !== null}
          onClick={() => void runJob("selfmap")}
          style={{
            border: "1px solid var(--atlas-border)",
            borderRadius: 999,
            padding: "8px 12px",
            background: "transparent",
            color: "var(--atlas-fg)",
            cursor: runningType !== null ? "not-allowed" : "pointer",
            fontFamily: "var(--app-font-mono)",
            fontSize: 11,
            fontWeight: 700,
            letterSpacing: "0.08em",
            opacity: runningType !== null ? 0.55 : 1,
            textTransform: "uppercase",
          }}
        >
          {runningType === "selfmap" ? "Starting..." : "Run Selfmap"}
        </button>
      </div>

      {error && (
        <div
          style={{
            border: "1px solid var(--atlas-border)",
            borderRadius: 10,
            padding: 10,
            color: "var(--atlas-gold)",
            fontSize: 11,
          }}
        >
          {error}
        </div>
      )}

      <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
        {loading ? (
          <div style={{ color: "var(--atlas-muted)", fontSize: 11 }}>Loading jobs...</div>
        ) : jobs.length === 0 ? (
          <div style={{ color: "var(--atlas-muted)", fontSize: 11 }}>No jobs yet.</div>
        ) : (
          jobs.map((job) => {
            const statusStyle = STATUS_STYLES[job.status];
            const outputSummary = getOutputSummary(job);
            const errorMessage = getErrorMessage(job);

            return (
              <div
                key={job.id}
                style={{
                  border: "1px solid var(--atlas-border)",
                  borderRadius: 10,
                  padding: 12,
                  background: "var(--atlas-surface)",
                }}
              >
                <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 6 }}>
                  <span
                    className={statusStyle.className}
                    style={{
                      width: 8,
                      height: 8,
                      borderRadius: 999,
                      background: statusStyle.color,
                      flexShrink: 0,
                    }}
                  />
                  <span
                    style={{
                      color: "var(--atlas-fg)",
                      fontSize: 12,
                      fontWeight: 700,
                      letterSpacing: "0.08em",
                      textTransform: "uppercase",
                    }}
                  >
                    {job.type}
                  </span>
                  <span
                    style={{
                      color: "var(--atlas-muted)",
                      fontSize: 10,
                      letterSpacing: "0.08em",
                      textTransform: "uppercase",
                    }}
                  >
                    {job.status}
                  </span>
                  <span style={{ flex: 1 }} />
                  <span style={{ color: "var(--atlas-muted)", fontSize: 10 }}>
                    {timeAgo(job.createdAt)}
                  </span>
                </div>

                {job.status === "completed" && outputSummary && (
                  <div style={{ color: "var(--atlas-muted)", fontSize: 11, lineHeight: 1.55 }}>
                    {outputSummary}
                  </div>
                )}
                {job.status === "failed" && errorMessage && (
                  <div style={{ color: "#ef4444", fontSize: 11, lineHeight: 1.55 }}>
                    {errorMessage}
                  </div>
                )}
              </div>
            );
          })
        )}
      </div>
    </div>
  );
}
