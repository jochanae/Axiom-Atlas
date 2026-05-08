import type React from "react";
import { useState, useEffect } from "react";
import { useParams, useLocation, Link } from "wouter";
import { useGetEntry, useListEntries, getGetEntryQueryKey, getListEntriesQueryKey } from "@workspace/api-client-react";
import type { Entry } from "@workspace/api-client-react";
import { LoadingSpinner } from "../components/ui/loading-spinner";
import { relativeTime, formatCost } from "../lib/atlas-utils";

/* ── helpers ─────────────────────────────────────────────────────── */

const SEVERITY_COLOR: Record<string, string> = {
  blocker: "var(--ember)",
  committed: "var(--phosphor)",
  parked: "var(--accent-gold)",
  neutral: "var(--muted-text)",
};

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 5 }}>
      <div style={{ fontFamily: "var(--font-mono)", fontSize: 9, letterSpacing: "0.12em", textTransform: "uppercase" as const, color: "var(--muted-text)", opacity: 0.55 }}>
        {label}
      </div>
      <div>{children}</div>
    </div>
  );
}

function Pill({ children, color = "var(--muted-text)" }: { children: React.ReactNode; color?: string }) {
  return (
    <span style={{
      display: "inline-block",
      fontFamily: "var(--font-mono)",
      fontSize: 10,
      letterSpacing: "0.08em",
      textTransform: "uppercase" as const,
      padding: "2px 8px",
      borderRadius: 4,
      background: `color-mix(in oklab, ${color} 12%, transparent)`,
      border: `1px solid color-mix(in oklab, ${color} 30%, transparent)`,
      color,
    }}>
      {children}
    </span>
  );
}

/* ── SupersedesChain ─────────────────────────────────────────────── */

function OriginLink({ entryId, projectId }: { entryId: number; projectId: number }) {
  const { data: origin } = useGetEntry(entryId, { query: { enabled: true, queryKey: getGetEntryQueryKey(entryId) } });
  if (!origin) return null;
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: 6 }}>
      <svg width="10" height="10" viewBox="0 0 16 16" fill="none" stroke="var(--accent-gold)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
        <path d="M10 3H5a2 2 0 0 0-2 2v6a2 2 0 0 0 2 2h6a2 2 0 0 0 2-2V8" />
        <path d="M15 1l-7 7" /><path d="M10 1h5v5" />
      </svg>
      <span style={{ fontFamily: "var(--font-mono)", fontSize: 10, color: "var(--muted-text)", letterSpacing: "0.06em" }}>
        Reopened from{" "}
        <Link
          href={`/entry/${origin.id}`}
          style={{ color: "var(--accent-gold)", textDecoration: "none", fontWeight: 500 }}
        >
          {origin.title}
        </Link>
        {" "}·{" "}
        <Link
          href={`/ledger/${projectId}`}
          style={{ color: "var(--muted-text)", textDecoration: "none", opacity: 0.6, fontSize: 9 }}
        >
          view ledger →
        </Link>
      </span>
    </div>
  );
}

/* ── DraftSuccessors ─────────────────────────────────────────────── */

function DraftSuccessors({ entryId, projectId }: { entryId: number; projectId: number }) {
  const { data: allEntries = [] } = useListEntries(projectId, {}, { query: { enabled: true, queryKey: getListEntriesQueryKey(projectId) } });
  const successors = (allEntries as Entry[]).filter((e) => e.supersedesId === entryId);
  if (successors.length === 0) return null;
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
      {successors.map((s) => (
        <div key={s.id} style={{ display: "flex", alignItems: "center", gap: 6 }}>
          <svg width="10" height="10" viewBox="0 0 16 16" fill="none" stroke="var(--accent-gold)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
            <path d="M5 10v-4a3 3 0 0 1 3-3h6" /><path d="M11 4l3 3-3 3" />
          </svg>
          <span style={{ fontFamily: "var(--font-mono)", fontSize: 10, color: "var(--muted-text)", letterSpacing: "0.06em" }}>
            <Pill color="var(--accent-gold)">{s.status}</Pill>{" "}
            <Link href={`/entry/${s.id}`} style={{ color: "var(--accent-gold)", textDecoration: "none", marginLeft: 4 }}>
              {s.title}
            </Link>
          </span>
        </div>
      ))}
    </div>
  );
}

/* ── Main page ───────────────────────────────────────────────────── */

export default function EntryDetail() {
  const { id: idStr } = useParams<{ id: string }>();
  const [, setLocation] = useLocation();
  const [copied, setCopied] = useState(false);
  const entryId = Number(idStr);

  function handleCopyLink() {
    const url = window.location.href;
    function fallbackCopy() {
      try {
        const el = document.createElement("input");
        el.value = url;
        document.body.appendChild(el);
        el.select();
        const ok = document.execCommand("copy");
        document.body.removeChild(el);
        if (ok) {
          setCopied(true);
          setTimeout(() => setCopied(false), 2000);
        }
      } catch {
        // copy unavailable — silently ignore
      }
    }
    if (navigator.clipboard?.writeText) {
      navigator.clipboard.writeText(url).then(() => {
        setCopied(true);
        setTimeout(() => setCopied(false), 2000);
      }).catch(fallbackCopy);
    } else {
      fallbackCopy();
    }
  }

  const { data: entry, isLoading, isError } = useGetEntry(entryId, {
    query: { enabled: !!entryId && !Number.isNaN(entryId), queryKey: getGetEntryQueryKey(entryId) },
  });

  // Keep browser tab title meaningful
  useEffect(() => {
    const prev = document.title;
    document.title = entry?.title ? `${entry.title} · Atlas Ledger` : "Entry · Atlas Ledger";
    return () => { document.title = prev; };
  }, [entry?.title]);

  const sMono: React.CSSProperties = { fontFamily: "var(--font-mono)" };

  if (isLoading) {
    return (
      <div style={{ minHeight: "100vh", display: "flex", alignItems: "center", justifyContent: "center", background: "var(--background)" }}>
        <LoadingSpinner size="lg" />
      </div>
    );
  }

  if (isError || !entry) {
    return (
      <div style={{ minHeight: "100vh", display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", gap: 16, background: "var(--background)", color: "var(--foreground)" }}>
        <div style={{ fontSize: 32, opacity: 0.2 }}>✕</div>
        <h1 style={{ margin: 0, fontSize: 16, fontWeight: 500 }}>Entry not found</h1>
        <button
          onClick={() => setLocation("/home")}
          style={{ ...sMono, fontSize: 10, letterSpacing: "0.1em", textTransform: "uppercase" as const, background: "transparent", border: "1px solid var(--border)", borderRadius: 4, color: "var(--muted-text)", padding: "6px 14px", cursor: "pointer" }}
        >
          ← Home
        </button>
      </div>
    );
  }

  const sevColor = SEVERITY_COLOR[entry.severity] ?? "var(--muted-text)";

  return (
    <div style={{ minHeight: "100vh", background: "var(--background)", color: "var(--foreground)", paddingBottom: 80 }}>

      {/* ── Sticky header / breadcrumb ── */}
      <header style={{
        position: "sticky", top: 0, zIndex: 20,
        background: "var(--background)",
        borderBottom: "1px solid var(--border)",
        padding: "12px 18px",
        display: "flex", alignItems: "center", gap: 8,
      }}>
        <button
          type="button"
          onClick={() => window.history.length > 1 ? window.history.back() : setLocation(`/ledger/${entry.projectId}`)}
          style={{ display: "flex", alignItems: "center", gap: 5, background: "transparent", border: "none", padding: 0, cursor: "pointer", color: "var(--muted-text)" }}
        >
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
            <path d="M19 12H5M12 5l-7 7 7 7" />
          </svg>
        </button>

        <nav aria-label="Breadcrumb" style={{ display: "flex", alignItems: "center", gap: 6, flex: 1, minWidth: 0 }}>
          <Link
            href="/home"
            style={{ ...sMono, fontSize: 10, letterSpacing: "0.12em", textTransform: "uppercase" as const, color: "var(--muted-text)", textDecoration: "none", opacity: 0.5 }}
          >
            Axiom
          </Link>
          <span style={{ color: "var(--border)", fontSize: 11 }}>/</span>
          <Link
            href={`/ledger/${entry.projectId}`}
            style={{ ...sMono, fontSize: 10, letterSpacing: "0.12em", textTransform: "uppercase" as const, color: "var(--muted-text)", textDecoration: "none", opacity: 0.7 }}
          >
            Ledger
          </Link>
          <span style={{ color: "var(--border)", fontSize: 11 }}>/</span>
          <span style={{ ...sMono, fontSize: 10, letterSpacing: "0.08em", color: "var(--foreground)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" as const, opacity: 0.85 }}>
            #{entry.id}
          </span>
        </nav>

        {/* Copy link button */}
        <button
          type="button"
          onClick={handleCopyLink}
          title="Copy permanent link"
          style={{
            display: "inline-flex", alignItems: "center", gap: 5,
            flexShrink: 0,
            fontFamily: "var(--font-mono)", fontSize: 9.5,
            letterSpacing: "0.08em", textTransform: "uppercase" as const,
            background: copied
              ? "color-mix(in oklab, var(--accent-gold) 12%, transparent)"
              : "transparent",
            border: `0.5px solid ${copied
              ? "color-mix(in oklab, var(--accent-gold) 35%, transparent)"
              : "var(--border)"}`,
            borderRadius: 4,
            color: copied ? "var(--accent-gold)" : "var(--muted-text)",
            padding: "4px 9px",
            cursor: "pointer",
            transition: "all 160ms ease",
          }}
        >
          {copied ? (
            <>
              <svg width="11" height="11" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
                <polyline points="2 8 6 12 14 4" />
              </svg>
              Copied!
            </>
          ) : (
            <>
              <svg width="11" height="11" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
                <rect x="5" y="5" width="9" height="9" rx="1" />
                <path d="M11 5V3a1 1 0 0 0-1-1H3a1 1 0 0 0-1 1v7a1 1 0 0 0 1 1h2" />
              </svg>
              Copy link
            </>
          )}
        </button>
      </header>

      {/* ── Body ── */}
      <main style={{ maxWidth: 740, margin: "0 auto", padding: "32px 20px" }}>

        {/* Status + severity row */}
        <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 16 }}>
          <span style={{ width: 9, height: 9, borderRadius: "50%", background: sevColor, flexShrink: 0, boxShadow: `0 0 8px -2px ${sevColor}` }} />
          <Pill color={sevColor}>{entry.status}</Pill>
          {entry.severity !== entry.status && <Pill color={sevColor}>{entry.severity}</Pill>}
          {entry.verb && <Pill>{entry.verb}</Pill>}
          {entry.isViolation && <Pill color="var(--ember)">Violation</Pill>}
          {entry.deviation && <Pill color="var(--accent-gold)">Deviation</Pill>}
          {entry.mode && <Pill color="rgba(120,200,255,0.8)">{entry.mode}</Pill>}
        </div>

        {/* Title */}
        <h1 style={{ margin: "0 0 12px", fontSize: 26, fontWeight: 600, letterSpacing: "-0.02em", lineHeight: 1.25, color: "var(--foreground)" }}>
          {entry.title}
        </h1>

        {/* Timestamps */}
        <div style={{ ...sMono, fontSize: 10, letterSpacing: "0.08em", color: "var(--muted-text)", marginBottom: 28, display: "flex", gap: 14, flexWrap: "wrap" as const }}>
          <span>Created {relativeTime(entry.createdAt)}</span>
          {entry.lockedAt && <span>· Locked {relativeTime(entry.lockedAt)}</span>}
          <span style={{ opacity: 0.4 }}>· #{entry.id}</span>
        </div>

        {/* Supersedes provenance */}
        {entry.supersedesId && (
          <OriginLink entryId={entry.supersedesId} projectId={entry.projectId} />
        )}

        {/* Divider */}
        <div style={{ height: 1, background: "var(--border)", marginBottom: 28 }} />

        {/* Summary */}
        {entry.summary && (
          <div style={{ marginBottom: 24 }}>
            <p style={{ margin: 0, fontSize: 15, lineHeight: 1.7, color: "var(--foreground)", opacity: 0.9 }}>
              {entry.summary}
            </p>
          </div>
        )}

        {/* Details */}
        {entry.details && (
          <div style={{ marginBottom: 28, padding: "14px 16px", borderRadius: 8, background: "var(--surface)", border: "1px solid var(--border)" }}>
            <div style={{ ...sMono, fontSize: 9, letterSpacing: "0.12em", textTransform: "uppercase" as const, color: "var(--muted-text)", marginBottom: 8, opacity: 0.55 }}>
              Details
            </div>
            <pre style={{ margin: 0, fontSize: 12, lineHeight: 1.75, fontFamily: "var(--font-mono)", color: "var(--foreground)", opacity: 0.85, whiteSpace: "pre-wrap", wordBreak: "break-word" as const }}>
              {entry.details}
            </pre>
          </div>
        )}

        {/* Meta grid */}
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(180px, 1fr))", gap: 20, marginBottom: 28 }}>
          {entry.buildId && (
            <Field label="Build ID">
              <span style={{ ...sMono, fontSize: 12, color: "var(--foreground)", opacity: 0.85 }}>
                {entry.buildId}
              </span>
            </Field>
          )}
          {entry.costOfLesson != null && (
            <Field label="Cost of Lesson">
              <span style={{ ...sMono, fontSize: 13, fontWeight: 600, color: "var(--ember)" }}>
                {formatCost(entry.costOfLesson)}
              </span>
            </Field>
          )}
          {entry.deviationReason && (
            <Field label="Deviation Reason">
              <span style={{ fontSize: 12, color: "var(--foreground)", opacity: 0.8 }}>
                {entry.deviationReason}
              </span>
            </Field>
          )}
        </div>

        {/* Touched files */}
        {entry.touched && entry.touched.length > 0 && (
          <div style={{ marginBottom: 28 }}>
            <div style={{ ...sMono, fontSize: 9, letterSpacing: "0.12em", textTransform: "uppercase" as const, color: "var(--muted-text)", marginBottom: 10, opacity: 0.55 }}>
              Touched Files
            </div>
            <div style={{ display: "flex", flexWrap: "wrap" as const, gap: 6 }}>
              {entry.touched.map((f, i) => (
                <span key={i} style={{ ...sMono, fontSize: 11, background: "var(--surface)", border: "1px solid var(--border)", borderRadius: 4, padding: "3px 9px", color: "var(--muted-text)", lineHeight: 1.5 }}>
                  {f}
                </span>
              ))}
            </div>
          </div>
        )}

        {/* Draft successors / reopen chain */}
        <DraftSuccessors entryId={entry.id} projectId={entry.projectId} />

        {/* Divider */}
        <div style={{ height: 1, background: "var(--border)", margin: "32px 0 24px" }} />

        {/* Navigation back */}
        <div style={{ display: "flex", gap: 10, alignItems: "center" }}>
          <Link
            href={`/ledger/${entry.projectId}`}
            style={{
              ...sMono, fontSize: 10, letterSpacing: "0.1em", textTransform: "uppercase" as const,
              padding: "7px 16px", borderRadius: 4,
              background: "transparent", border: "1px solid var(--border)",
              color: "var(--muted-text)", textDecoration: "none",
              display: "inline-block",
            }}
          >
            ← Project Ledger
          </Link>
          <Link
            href="/parking"
            style={{
              ...sMono, fontSize: 10, letterSpacing: "0.1em", textTransform: "uppercase" as const,
              padding: "7px 16px", borderRadius: 4,
              background: "transparent", border: "1px solid var(--border)",
              color: "var(--muted-text)", textDecoration: "none",
              display: "inline-block",
            }}
          >
            Parking Lot →
          </Link>
        </div>
      </main>
    </div>
  );
}
