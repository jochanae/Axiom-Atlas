import { useState } from "react";
import { useParams, Link } from "wouter";
import {
  useGetProject,
  useListEntries,
  useGetProjectSummary,
  getGetProjectQueryKey,
  getListEntriesQueryKey,
  getGetProjectSummaryQueryKey
} from "@workspace/api-client-react";

const FILTER_PILLS = ["ALL", "STRUCTURE", "AESTHETIC", "LOGIC", "GENERAL"] as const;
type FilterPill = typeof FILTER_PILLS[number];

function filterMatchesCategory(category: string | null | undefined, filter: FilterPill): boolean {
  if (filter === "ALL") return true;
  return (category ?? "GENERAL").toUpperCase() === filter;
}

export default function Ledger() {
  const { projectId } = useParams();
  const id = Number(projectId);
  const [activeFilter, setActiveFilter] = useState<FilterPill>("ALL");
  const [search, setSearch] = useState("");

  const { data: project } = useGetProject(id, { query: { enabled: !!id, queryKey: getGetProjectQueryKey(id) } });
  const { data: summary } = useGetProjectSummary(id, { query: { enabled: !!id, queryKey: getGetProjectSummaryQueryKey(id) } });
  const { data: entries } = useListEntries(id, {}, { query: { enabled: !!id, queryKey: getListEntriesQueryKey(id, {}) } });

  const allEntries = entries ?? [];
  const filtered = allEntries.filter(e =>
    filterMatchesCategory(e.mode, activeFilter) &&
    (search === "" || e.title.toLowerCase().includes(search.toLowerCase()) || e.summary?.toLowerCase().includes(search.toLowerCase()))
  );

  const committed = filtered.filter(e => e.status === "committed");
  const inTension = filtered.filter(e => e.status === "draft");
  const overridden = filtered.filter(e => e.status === "archived" || e.status === "parked");

  return (
    <div style={{ height: "100vh", background: "var(--atlas-bg)", display: "flex", flexDirection: "column", overflowY: "auto" }}>

      {/* Header / breadcrumb */}
      <header className="atlas-home-header" style={{
        position: "sticky", top: 0,
        height: 50, display: "flex", alignItems: "center",
        padding: "0 20px",
        borderBottom: "1px solid var(--atlas-glass-border)",
        zIndex: 10, flexShrink: 0,
      }}>
        <nav style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 11, fontFamily: "var(--app-font-mono)", letterSpacing: "0.06em" }}>
          <Link href="/">
            <span style={{ color: "var(--atlas-muted)", cursor: "pointer", opacity: 0.7 }}>← WORKSPACE</span>
          </Link>
          <span style={{ color: "var(--atlas-border)" }}>|</span>
          <Link href={`/project/${id}`}>
            <span style={{ color: "var(--atlas-muted)", cursor: "pointer", opacity: 0.7, textTransform: "uppercase" }}>
              {project?.name || "Project"}
            </span>
          </Link>
          <span style={{ color: "var(--atlas-border)" }}>|</span>
          <span style={{ color: "var(--atlas-gold)", opacity: 0.9, textTransform: "uppercase" }}>Ledger</span>
        </nav>
      </header>

      {/* Page body */}
      <div style={{ flex: 1, maxWidth: 860, margin: "0 auto", width: "100%", padding: "32px 24px 80px", display: "flex", flexDirection: "column", gap: 0 }}>

        {/* Title + stats */}
        <div style={{ marginBottom: 24 }}>
          <h1 style={{ margin: "0 0 4px", fontSize: 22, fontWeight: 300, color: "var(--atlas-fg)", letterSpacing: "-0.02em" }}>
            Decision Ledger
          </h1>
          <p style={{ margin: 0, fontSize: 12, color: "var(--atlas-muted)", fontFamily: "var(--app-font-mono)", opacity: 0.6 }}>
            {summary?.committedCount ?? 0} committed · {allEntries.length} total
          </p>
        </div>

        {/* Filter pills + search + add */}
        <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 24, flexWrap: "wrap" }}>
          <div style={{ display: "flex", gap: 4, flex: 1, flexWrap: "wrap" }}>
            {FILTER_PILLS.map(pill => (
              <button
                key={pill}
                type="button"
                onClick={() => setActiveFilter(pill)}
                style={{
                  padding: "5px 12px", borderRadius: 20, cursor: "pointer",
                  fontSize: 10, fontFamily: "var(--app-font-mono)", letterSpacing: "0.08em",
                  textTransform: "uppercase",
                  background: activeFilter === pill ? "var(--atlas-gold)" : "var(--atlas-surface)",
                  color: activeFilter === pill ? "var(--atlas-bg)" : "var(--atlas-muted)",
                  fontWeight: activeFilter === pill ? 600 : 400,
                  border: `1px solid ${activeFilter === pill ? "transparent" : "var(--atlas-gold-border)"}`,
                  transition: "all 160ms ease",
                }}
              >
                {pill}
              </button>
            ))}
          </div>
          <div style={{ display: "flex", gap: 8 }}>
            <input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search…"
              style={{
                padding: "5px 12px", borderRadius: 8,
                background: "var(--atlas-surface)", border: "1px solid var(--atlas-gold-border)",
                color: "var(--atlas-fg)", fontSize: 12, outline: "none",
                fontFamily: "var(--app-font-sans)", width: 140,
              }}
            />
            <button type="button" style={{
              padding: "5px 14px", borderRadius: 8, border: "1px solid var(--atlas-gold-border)",
              background: "transparent", color: "var(--atlas-gold)", fontSize: 11,
              fontFamily: "var(--app-font-mono)", letterSpacing: "0.06em", cursor: "pointer",
              transition: "all 160ms ease",
            }}
              onMouseEnter={(e) => { e.currentTarget.style.background = "rgba(201,162,76,0.08)"; }}
              onMouseLeave={(e) => { e.currentTarget.style.background = "transparent"; }}
            >
              + ADD
            </button>
          </div>
        </div>

        {/* COMMITTED section */}
        <LedgerSection
          title="COMMITTED"
          accentColor="var(--atlas-gold)"
          entries={committed}
          emptyText="No decisions locked in yet."
          renderBadge={(e) => (
            <span style={{ fontSize: 9, fontFamily: "var(--app-font-mono)", letterSpacing: "0.08em", padding: "2px 8px", borderRadius: 10, background: "rgba(201,162,76,0.12)", color: "var(--atlas-gold)", textTransform: "uppercase" }}>
              Locked record
            </span>
          )}
        />

        {/* IN TENSION section */}
        {inTension.length > 0 && (
          <LedgerSection
            title="IN TENSION"
            accentColor="var(--atlas-phosphor)"
            entries={inTension}
            emptyText=""
          />
        )}

        {/* OVERRIDDEN section */}
        {overridden.length > 0 && (
          <LedgerSection
            title="OVERRIDDEN"
            accentColor="var(--atlas-muted)"
            entries={overridden}
            emptyText=""
            dimmed
          />
        )}

        {/* Empty state */}
        {allEntries.length === 0 && (
          <div style={{ padding: "60px 0", textAlign: "center" }}>
            <p style={{ fontSize: 14, color: "var(--atlas-muted)", fontStyle: "italic", opacity: 0.6 }}>
              No decisions recorded yet. Start a session to log decisions.
            </p>
          </div>
        )}
      </div>
    </div>
  );
}

type LedgerEntry = {
  id: number;
  title: string;
  summary?: string | null;
  mode?: string | null;
  status?: string | null;
  createdAt: string;
};

function LedgerSection({
  title, accentColor, entries, emptyText, dimmed = false, renderBadge,
}: {
  title: string;
  accentColor: string;
  entries: LedgerEntry[];
  emptyText: string;
  dimmed?: boolean;
  renderBadge?: (e: LedgerEntry) => React.ReactNode;
}) {
  if (entries.length === 0 && !emptyText) return null;

  return (
    <div style={{ marginBottom: 32 }}>
      <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 12 }}>
        <div style={{ width: 3, height: 14, borderRadius: 2, background: accentColor, opacity: 0.8 }} />
        <h2 style={{ margin: 0, fontSize: 10, fontWeight: 700, fontFamily: "var(--app-font-mono)", letterSpacing: "0.14em", color: accentColor, opacity: dimmed ? 0.6 : 0.9, textTransform: "uppercase" }}>
          {title}
        </h2>
        <div style={{ flex: 1, height: 1, background: "var(--atlas-gold-border)" }} />
      </div>
      <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
        {entries.length === 0 && emptyText && (
          <p style={{ fontSize: 13, color: "var(--atlas-muted)", fontStyle: "italic", opacity: 0.6, margin: 0, padding: "8px 0" }}>{emptyText}</p>
        )}
        {entries.map(e => (
          <div
            key={e.id}
            style={{
              padding: "14px 16px", borderRadius: 10,
              background: "var(--atlas-surface)",
              border: `1px solid ${dimmed ? "var(--atlas-border)" : "var(--atlas-gold-border)"}`,
              opacity: dimmed ? 0.65 : 1,
              transition: "opacity 160ms ease",
            }}
            onMouseEnter={(el) => { (el.currentTarget as HTMLElement).style.opacity = "1"; }}
            onMouseLeave={(el) => { (el.currentTarget as HTMLElement).style.opacity = dimmed ? "0.65" : "1"; }}
          >
            <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: 12, marginBottom: e.summary ? 8 : 0 }}>
              <h3 style={{ margin: 0, fontSize: 13, fontWeight: 500, color: "var(--atlas-fg)", lineHeight: 1.4 }}>{e.title}</h3>
              {renderBadge?.(e)}
            </div>
            {e.summary && (
              <p style={{ margin: 0, fontSize: 12, color: "var(--atlas-muted)", lineHeight: 1.55, opacity: 0.8 }}>{e.summary}</p>
            )}
            <div style={{ marginTop: 10, display: "flex", alignItems: "center", gap: 8 }}>
              {e.mode && (
                <span style={{ fontSize: 9, fontFamily: "var(--app-font-mono)", letterSpacing: "0.1em", padding: "2px 8px", borderRadius: 10, background: "var(--atlas-surface-alt)", color: "var(--atlas-muted)", textTransform: "uppercase", border: "1px solid var(--atlas-border)" }}>
                  {e.mode}
                </span>
              )}
              <span style={{ fontSize: 10, color: "var(--atlas-muted)", fontFamily: "var(--app-font-mono)", opacity: 0.4 }}>
                {new Date(e.createdAt).toLocaleDateString("en-US", { month: "short", day: "numeric" })}
              </span>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
