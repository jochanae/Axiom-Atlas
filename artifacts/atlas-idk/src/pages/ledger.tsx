import {
  useState,
  useMemo,
  useCallback,
  useEffect,
  useRef,
  type ReactNode,
  type RefObject,
} from "react";
import { Session, updateEntry, createEntry } from "@workspace/api-client-react";
import { toast } from "sonner";
import { useParams, useLocation, useSearch, Link } from "wouter";
import { buildReopenChain } from "../components/EntryCard";
import {
  useListEntries,
  useListProjects,
  useUpdateEntry,
  useCreateEntry,
  getListEntriesQueryKey,
} from "@workspace/api-client-react";
import type { Entry, Project } from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import { LoadingSpinner } from "../components/ui/loading-spinner";
import { FooterAuditLine } from "../components/FooterAuditLine";
import { ThreadAnchor } from "../components/ThreadAnchor";
import { DecisionLedgerGrouped } from "../components/DecisionLedgerGrouped";
import { AddEntryDialog } from "../components/AddEntryDialog";
import { EditEntryDialog } from "../components/EditEntryDialog";
import { relativeTime, formatCost } from "../lib/atlas-utils";
import { usePullToRefresh } from "@/hooks/usePullToRefresh";

/* ─── Category inference ─────────────────────────────────────────── */

type Category = "structure" | "aesthetic" | "logic" | "general";

const CATEGORY_CONFIG: Record<Category, { label: string; color: string }> = {
  structure: { label: "STRUCTURE", color: "var(--phosphor)" },
  aesthetic: { label: "AESTHETIC", color: "var(--accent-gold)" },
  logic:     { label: "LOGIC",     color: "var(--ember)" },
  general:   { label: "GENERAL",   color: "var(--muted-text)" },
};

function inferCategory(entry: Entry): Category {
  const t = (entry.title + " " + (entry.summary ?? "")).toLowerCase();
  const touched = (entry.touched ?? []).join(" ").toLowerCase();
  if (/blueprint|template|layout|component|route|page|scaffold|wireframe/i.test(t) || /\.tsx|\.jsx|routes\/|components\//i.test(touched)) return "structure";
  if (/design|theme|css|style|color|font|animation|visual|ui kit/i.test(t) || /\.css|styles|tailwind/i.test(touched)) return "aesthetic";
  if (/api|connector|function|edge|database|logic|hook|server|migration|query/i.test(t) || /\.server\.|functions\/|supabase\//i.test(touched)) return "logic";
  return "general";
}

/* ─── Session grouping ───────────────────────────────────────────── */

interface SessionGroup { key: string; label: string; dateLabel: string; entries: Entry[] }

function groupBySession(entries: Entry[]): SessionGroup[] {
  const map = new Map<string, Entry[]>();
  for (const entry of entries) {
    const dt = new Date(entry.createdAt);
    const dateStr = dt.toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric" });
    const hour = dt.getHours();
    const period = hour < 12 ? "Morning" : hour < 17 ? "Afternoon" : "Evening";
    const key = `${dateStr}-${period}`;
    if (!map.has(key)) map.set(key, []);
    map.get(key)!.push(entry);
  }
  return Array.from(map.entries()).map(([key, entries]) => {
    const dt = new Date(entries[0].createdAt);
    const dateStr = dt.toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric" });
    const hour = dt.getHours();
    const period = hour < 12 ? "Morning" : hour < 17 ? "Afternoon" : "Evening";
    const timeStr = dt.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" });
    return { key, label: `${period} Build — ${timeStr}`, dateLabel: dateStr, entries };
  });
}

/* ─── Filter types ───────────────────────────────────────────────── */

type CategoryFilter = "all" | Category;
type SeverityFilter = "all" | "committed" | "blocker" | "parked" | "neutral";
type VerbFilter = "all" | "new" | "bug" | "perf" | "note" | "wip" | "audit" | "merge" | "plan" | "axiom_import";
type DateFilter = "all" | "today" | "week" | "month";

/* ─── Main component ─────────────────────────────────────────────── */

export default function Ledger() {
  const { projectId: projectIdStr } = useParams<{ projectId: string }>();
  const projectId = Number(projectIdStr) || null;
  const isAllProjects = !projectId;
  const [, setLocation] = useLocation();
  const queryClient = useQueryClient();
  const ptrContainerRef = useRef<HTMLDivElement>(null);
  const {
    pulling: ptr_pulling,
    distance: ptr_distance,
    refreshing: ptr_refreshing,
  } = usePullToRefresh(
    async () => {
      await queryClient.invalidateQueries();
    },
    true,
    ptrContainerRef,
  );

  const [categoryFilter, setCategoryFilter] = useState<CategoryFilter>("all");
  const [expanded, setExpanded] = useState<number | null>(null);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [busyId, setBusyId] = useState<number | null>(null);
  const [editEntry, setEditEntry] = useState<Entry | null>(null);
  const [editSaving, setEditSaving] = useState(false);
  const [searchOpen, setSearchOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");
  const [severityFilter, setSeverityFilter] = useState<SeverityFilter>("all");
  const [verbFilter, setVerbFilter] = useState<VerbFilter>("all");
  const [dateFilter, setDateFilter] = useState<DateFilter>("all");
  const [filtersExpanded, setFiltersExpanded] = useState(false);
  const [allEntries, setAllEntries] = useState<(Entry & { projectName?: string })[]>([]);
  const [allEntriesLoading, setAllEntriesLoading] = useState(false);

  const search = useSearch();
  const { data: projectEntries = [], isLoading: projectEntriesLoading } = useListEntries(projectId ?? 0, {}, { query: { enabled: !!projectId, queryKey: getListEntriesQueryKey(projectId ?? 0) } });

  useEffect(() => {
    if (!isAllProjects) return;
    setAllEntriesLoading(true);
    fetch("/api/entries/all", { credentials: "include" })
      .then(r => r.ok ? r.json() : [])
      .then((data: (Entry & { projectName?: string })[]) => setAllEntries(data))
      .catch(() => setAllEntries([]))
      .finally(() => setAllEntriesLoading(false));
  }, [isAllProjects]);

  const entries = isAllProjects ? allEntries : projectEntries;
  const isLoading = isAllProjects ? allEntriesLoading : projectEntriesLoading;
  // Full lookup for walking supersedesId chains in EntryRow
  const allEntriesById = useMemo(() => new Map(entries.map((e: Entry) => [e.id, e])), [entries]);
  const { data: projects = [] } = useListProjects();

  // Auto-expand and scroll to an entry from ?expand=<id>, then clear the param
  useEffect(() => {
    if (isLoading || entries.length === 0) return;
    const params = new URLSearchParams(search);
    const expandId = Number(params.get("expand"));
    if (!expandId) return;
    const entry = entries.find((e) => e.id === expandId);
    if (!entry) return;
    setExpanded(expandId);
    requestAnimationFrame(() => {
      const el = document.querySelector(`[data-entry-id="${expandId}"]`);
      if (el) el.scrollIntoView({ behavior: "smooth", block: "center" });
    });
    // Remove the param so re-renders / data refreshes don't retrigger
    setLocation(`/ledger/${projectId}`, { replace: true });
  }, [isLoading, entries.length, search]);

  const invalidate = useCallback(() => {
    queryClient.invalidateQueries({ queryKey: getListEntriesQueryKey(projectId ?? 0) });
  }, [queryClient, projectId]);

  const updateEntry = useUpdateEntry({ mutation: { onSuccess: invalidate } });
  const createEntry = useCreateEntry({ mutation: { onSuccess: invalidate } });

  const project = projects.find((p: Project) => p.id === projectId);

  /* ─── Filtered list (only committed shown in timeline) ─── */
  const filtered = useMemo(() => {
    const now = Date.now();
    return entries.filter((e: Entry) => {
      if (e.status !== "committed") return false;
      if (categoryFilter !== "all" && inferCategory(e) !== categoryFilter) return false;
      if (severityFilter !== "all" && e.severity !== severityFilter) return false;
      if (verbFilter !== "all" && e.verb !== verbFilter) return false;
      if (dateFilter !== "all") {
        const age = now - new Date(e.createdAt).getTime();
        const day = 86400000;
        if (dateFilter === "today" && age > day) return false;
        if (dateFilter === "week" && age > 7 * day) return false;
        if (dateFilter === "month" && age > 30 * day) return false;
      }
      if (searchQuery.trim()) {
        const q = searchQuery.toLowerCase();
        const match = e.title.toLowerCase().includes(q) || (e.summary ?? "").toLowerCase().includes(q) || (e.details ?? "").toLowerCase().includes(q);
        if (!match) return false;
      }
      return true;
    });
  }, [entries, categoryFilter, severityFilter, verbFilter, dateFilter, searchQuery]);

  const groups = useMemo(() => groupBySession(filtered), [filtered]);
  const mostRecent = entries.find((e: Entry) => e.status === "committed");

  // Compani import summary
  const companiEntries = useMemo(() => entries.filter((e: Entry) => e.verb === "axiom_import"), [entries]);
  const lastCompaniImport = companiEntries[0] ?? null;

  // IDs of committed entries that currently have an active draft successor
  const activeReopenIds = useMemo(() => {
    const ids = new Set<number>();
    for (const e of entries) {
      if ((e.status === "draft" || e.status === "parked") && e.supersedesId != null) {
        ids.add(e.supersedesId);
      }
    }
    return ids;
  }, [entries]);

  /* ─── Actions ─── */
  const handleReopen = async (entry: Entry) => {
    setBusyId(entry.id);
    try {
      await createEntry.mutateAsync({
        projectId: entry.projectId,
        data: {
          title: entry.title,
          summary: entry.summary,
          details: entry.details,
          status: "draft",
          severity: "neutral",
          verb: entry.verb ?? null,
          buildId: entry.buildId ?? null,
          touched: entry.touched ?? null,
          supersedesId: entry.id,
        },
      });
    } finally {
      setBusyId(null);
    }
  };

  const handleArchive = async (entry: Entry) => {
    setBusyId(entry.id);
    try {
      await updateEntry.mutateAsync({ id: entry.id, data: { status: "archived" } });
    } finally {
      setBusyId(null);
    }
  };

  const handleEditSave = async (id: number, data: { title: string; summary: string | null; details: string | null; buildId: string | null; touched: string[] | null; costOfLesson: number | null }) => {
    setEditSaving(true);
    try {
      await updateEntry.mutateAsync({ id, data });
    } finally {
      setEditSaving(false);
    }
  };

  const committedCount = entries.filter((e: Entry) => e.status === "committed").length;
  const pullToRefreshIndicator = (ptr_pulling || ptr_refreshing) && (
    <div
      style={{
        position: "fixed",
        top: 0,
        left: 0,
        right: 0,
        zIndex: 100,
        display: "flex",
        justifyContent: "center",
        alignItems: "flex-end",
        height: Math.min(ptr_distance, 72) + 16,
        pointerEvents: "none",
      }}
    >
      <div
        style={{
          width: 26,
          height: 26,
          borderRadius: "50%",
          border: "1.5px solid rgba(201,162,76,0.25)",
          borderTopColor:
            ptr_distance >= 96 || ptr_refreshing
              ? "var(--atlas-gold)"
              : "rgba(201,162,76,0.5)",
          opacity: Math.min(ptr_distance / 60, 1),
          animation: ptr_refreshing ? "ptr-spin 700ms linear infinite" : "none",
          transform: ptr_refreshing
            ? "none"
            : `rotate(${Math.min((ptr_distance / 96) * 270, 270)}deg)`,
        }}
      />
    </div>
  );

  // ── Global view branches to its own layout ─────────────────────────
  if (isAllProjects) {
    return (
      <GlobalDecisionsView
        allEntries={allEntries}
        projects={projects}
        isLoading={allEntriesLoading}
        pullToRefreshIndicator={pullToRefreshIndicator}
        pullToRefreshContainerRef={ptrContainerRef}
      />
    );
  }

  return (
    <div
      ref={ptrContainerRef}
      style={{
        position: "relative",
        height: "100dvh",
        background: "transparent",
        color: "var(--foreground)",
        paddingBottom: 80,
        overflowY: "auto",
      }}
    >
      {pullToRefreshIndicator}
      <style>{`@keyframes ptr-spin { to { transform: rotate(360deg); } }`}</style>
      <FooterAuditLine />

      {/* ─── Header ─── */}
      <header style={{ padding: "14px 18px 12px", borderBottom: "1px solid var(--border)", background: "var(--background)" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 4 }}>
          <button
            type="button"
            onClick={() => setLocation(project ? `/project/${projectId}` : "/")}
            style={{ fontFamily: "var(--font-mono)", fontSize: 10, letterSpacing: "0.14em", textTransform: "uppercase" as const, color: "var(--muted-text)", background: "transparent", border: "none", padding: 0, cursor: "pointer" }}
          >
            ← Workspace
          </button>
          <Link
            href="/parking"
            style={{ fontFamily: "var(--font-mono)", fontSize: 10, letterSpacing: "0.14em", textTransform: "uppercase" as const, color: "var(--accent-gold)", textDecoration: "none" }}
          >
            Parking Lot →
          </Link>
          <Link
            href="/compass"
            style={{ fontFamily: "var(--font-mono)", fontSize: 10, letterSpacing: "0.14em", textTransform: "uppercase" as const, color: "var(--phosphor)", textDecoration: "none", marginLeft: "auto" }}
          >
            Compass →
          </Link>
        </div>

        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
          <div>
            <h1 style={{ fontSize: 20, fontWeight: 600, letterSpacing: "-0.01em", margin: 0, lineHeight: 1.2 }}>
              Ledger
              {project && <span style={{ fontSize: 13, fontWeight: 400, color: "var(--muted-text)", marginLeft: 10 }}>{project.name}</span>}
            </h1>
            <p style={{ fontFamily: "var(--font-mono)", fontSize: 10, color: "var(--muted-text)", margin: "4px 0 0", letterSpacing: "0.06em" }}>
              {committedCount} committed · Locked record
            </p>
          </div>

          {/* Project switcher */}
          {projects.length > 0 && (
            <select
              value={projectId ?? ""}
              onChange={(e) => e.target.value ? setLocation(`/ledger/${e.target.value}`) : setLocation("/ledger")}
              style={{ background: "var(--surface-alt)", border: "1px solid var(--border)", borderRadius: 6, padding: "5px 10px", fontFamily: "var(--font-mono)", fontSize: 10, color: "var(--muted-text)", outline: "none", cursor: "pointer", marginRight: 8 }}
            >
              <option value="">All Projects</option>
              {projects.map((p: Project) => <option key={p.id} value={p.id}>{p.name}</option>)}
            </select>
          )}

          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
            {/* Copy all */}
            <button
              onClick={() => {
                const text = filtered.map(e =>
                  `[${(e as any).projectName ?? ""}] ${e.title}${e.summary ? "\n" + e.summary : ""}`
                ).join("\n\n");
                navigator.clipboard.writeText(text).catch(() => {});
                toast("Copied to clipboard");
              }}
              style={{ background: "transparent", border: "1px solid var(--atlas-border)", borderRadius: 6, padding: "4px 10px", fontSize: 10, fontFamily: "var(--app-font-mono)", color: "var(--atlas-muted)", cursor: "pointer", letterSpacing: "0.06em" }}
            >
              COPY ALL
            </button>

            {/* Export markdown */}
            <button
              onClick={() => {
                const lines = [`# Decision Ledger\n_${new Date().toLocaleDateString()}_\n`];
                const byProject: Record<string, typeof filtered> = {};
                for (const e of filtered) {
                  const name = (e as any).projectName ?? "General";
                  if (!byProject[name]) byProject[name] = [];
                  byProject[name].push(e);
                }
                for (const [proj, entries] of Object.entries(byProject)) {
                  lines.push(`## ${proj}`);
                  for (const e of entries) {
                    lines.push(`- **${e.title}**${e.summary ? " — " + e.summary : ""}`);
                  }
                  lines.push("");
                }
                const blob = new Blob([lines.join("\n")], { type: "text/markdown" });
                const url = URL.createObjectURL(blob);
                const a = document.createElement("a");
                a.href = url;
                a.download = `axiom-ledger-${new Date().toISOString().slice(0, 10)}.md`;
                a.click();
                URL.revokeObjectURL(url);
              }}
              style={{ background: "transparent", border: "1px solid var(--atlas-border)", borderRadius: 6, padding: "4px 10px", fontSize: 10, fontFamily: "var(--app-font-mono)", color: "var(--atlas-muted)", cursor: "pointer", letterSpacing: "0.06em" }}
            >
              EXPORT
            </button>

            <button
              onClick={() => setSearchOpen((v) => !v)}
              aria-label="Search ledger"
              style={{ width: 36, height: 36, borderRadius: 8, background: searchOpen ? "var(--surface-alt)" : "transparent", border: searchOpen ? "1px solid var(--accent-gold)" : "1px solid var(--border)", display: "flex", alignItems: "center", justifyContent: "center", color: searchOpen ? "var(--accent-gold)" : "var(--muted-text)", cursor: "pointer", transition: "all 160ms ease" }}
            >
              <svg viewBox="0 0 16 16" width={14} height={14} stroke="currentColor" fill="none" strokeWidth={1.5}>
                <circle cx="6.5" cy="6.5" r="4" /><path d="M10 10l3.5 3.5" strokeLinecap="round" />
              </svg>
            </button>
            <button
              onClick={() => setDialogOpen(true)}
              style={{ padding: "7px 14px", fontSize: 10, fontWeight: 600, fontFamily: "var(--font-mono)", letterSpacing: "0.1em", textTransform: "uppercase" as const, background: "var(--ember)", color: "var(--background)", border: "none", borderRadius: 4, cursor: "pointer" }}
            >
              + Add
            </button>
          </div>
        </div>
      </header>

      {/* ─── Search bar ─── */}
      {searchOpen && (
        <div style={{ padding: "8px 18px", borderBottom: "1px solid var(--border)", background: "var(--surface)" }}>
          <input
            autoFocus
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder="Search decisions..."
            style={{ width: "100%", background: "var(--surface-alt)", border: "1px solid var(--border)", borderRadius: 6, padding: "8px 12px", fontSize: 13, color: "var(--foreground)", outline: "none", fontFamily: "var(--font-sans)" }}
          />
        </div>
      )}

      {/* ─── Category filter pills ─── */}
      <div style={{ padding: "10px 18px", display: "flex", gap: 6, overflowX: "auto", scrollbarWidth: "none" as const, borderBottom: "1px solid var(--border)" }}>
        {(["all", "structure", "aesthetic", "logic", "general"] as const).map((cat) => {
          const isActive = categoryFilter === cat;
          const cfg = cat === "all" ? { label: "ALL", color: "var(--foreground)" } : CATEGORY_CONFIG[cat];
          return (
            <button
              key={cat}
              onClick={() => setCategoryFilter(cat)}
              style={{ flexShrink: 0, padding: "4px 12px", borderRadius: 14, border: `1px solid ${isActive ? cfg.color : "var(--border)"}`, background: isActive ? `color-mix(in oklab, ${cfg.color} 12%, transparent)` : "transparent", fontFamily: "var(--font-mono)", fontSize: 9.5, letterSpacing: "0.1em", textTransform: "uppercase" as const, color: isActive ? cfg.color : "var(--muted-text)", cursor: "pointer", transition: "all 160ms ease" }}
            >
              {cfg.label}
            </button>
          );
        })}
        <button
          onClick={() => setFiltersExpanded((v) => !v)}
          style={{ flexShrink: 0, marginLeft: "auto", padding: "4px 10px", borderRadius: 14, border: filtersExpanded ? "1px solid var(--accent-gold)" : "1px solid var(--border)", background: filtersExpanded ? "color-mix(in oklab, var(--accent-gold) 10%, transparent)" : "transparent", fontFamily: "var(--font-mono)", fontSize: 9.5, letterSpacing: "0.1em", textTransform: "uppercase" as const, color: filtersExpanded ? "var(--accent-gold)" : "var(--muted-text)", cursor: "pointer", transition: "all 160ms ease" }}
        >
          ⚙ {(severityFilter !== "all" || verbFilter !== "all" || dateFilter !== "all") ? "●" : ""}
        </button>
      </div>

      {/* ─── Advanced filters ─── */}
      {filtersExpanded && (
        <div style={{ padding: "8px 18px 10px", borderBottom: "1px solid var(--border)", display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center" }}>
          <FilterSelect label="Severity" value={severityFilter} onChange={(v) => setSeverityFilter(v as SeverityFilter)} options={[{ value: "all", label: "All" }, { value: "committed", label: "Committed" }, { value: "blocker", label: "Flagged" }, { value: "parked", label: "Parked" }, { value: "neutral", label: "Neutral" }]} />
          <FilterSelect label="Verb" value={verbFilter} onChange={(v) => setVerbFilter(v as VerbFilter)} options={[{ value: "all", label: "All" }, { value: "new", label: "New" }, { value: "bug", label: "Bug" }, { value: "perf", label: "Perf" }, { value: "note", label: "Note" }, { value: "wip", label: "WIP" }, { value: "audit", label: "Audit" }, { value: "merge", label: "Merge" }, { value: "plan", label: "Plan" }, { value: "axiom_import", label: "Compani" }]} />
          <FilterSelect label="Date" value={dateFilter} onChange={(v) => setDateFilter(v as DateFilter)} options={[{ value: "all", label: "All time" }, { value: "today", label: "Today" }, { value: "week", label: "This week" }, { value: "month", label: "This month" }]} />
          {(severityFilter !== "all" || verbFilter !== "all" || dateFilter !== "all") && (
            <button onClick={() => { setSeverityFilter("all"); setVerbFilter("all"); setDateFilter("all"); }} style={{ fontFamily: "var(--font-mono)", fontSize: 9, letterSpacing: "0.1em", textTransform: "uppercase" as const, color: "var(--ember)", background: "none", border: "none", cursor: "pointer", padding: "4px 8px" }}>
              Reset
            </button>
          )}
        </div>
      )}

      {/* ─── ThreadAnchor ─── */}
      {!isLoading && mostRecent && (
        <ThreadAnchor
          text={mostRecent.title}
          meta={`last commit · ${relativeTime(mostRecent.createdAt)}`}
          onClick={() => {
            setExpanded(mostRecent.id);
            requestAnimationFrame(() => {
              const el = document.querySelector(`[data-entry-id="${mostRecent.id}"]`);
              if (el) el.scrollIntoView({ behavior: "smooth", block: "center" });
            });
          }}
        />
      )}

      {/* ─── Compani handoff banner ─── */}
      {!isLoading && lastCompaniImport && (
        <div
          style={{
            margin: "12px 18px 0",
            padding: "10px 14px",
            borderRadius: 8,
            border: "1px solid rgba(201,162,76,0.25)",
            background: "rgba(201,162,76,0.06)",
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            gap: 10,
          }}
        >
          <div style={{ display: "flex", alignItems: "center", gap: 10, minWidth: 0 }}>
            <svg width={14} height={14} viewBox="0 0 16 16" fill="none" stroke="var(--accent-gold)" strokeWidth="1.25" strokeLinecap="round" strokeLinejoin="round" style={{ flexShrink: 0 }}>
              <rect x="2" y="7" width="8" height="7" rx="1.25" />
              <path d="M10 3.5 H14" />
              <path d="M11.5 5.5 L14 3.5 L11.5 1.5" />
              <path d="M6 7 V5 H10" opacity="0.55" />
            </svg>
            <div style={{ minWidth: 0 }}>
              <span style={{ fontFamily: "var(--font-mono)", fontSize: 10, letterSpacing: "0.08em", textTransform: "uppercase" as const, color: "var(--accent-gold)" }}>
                Compani Blueprint
              </span>
              <span style={{ fontFamily: "var(--font-mono)", fontSize: 10, color: "var(--muted-text)", marginLeft: 8 }}>
                {companiEntries.length} decision{companiEntries.length !== 1 ? "s" : ""} imported · last sync {relativeTime(lastCompaniImport.createdAt)}
              </span>
            </div>
          </div>
          <button
            onClick={() => { setFiltersExpanded(true); setVerbFilter("axiom_import"); }}
            style={{ fontFamily: "var(--font-mono)", fontSize: 9.5, letterSpacing: "0.08em", textTransform: "uppercase" as const, color: "var(--accent-gold)", background: "rgba(201,162,76,0.1)", border: "1px solid rgba(201,162,76,0.25)", borderRadius: 5, padding: "3px 9px", cursor: "pointer", flexShrink: 0, whiteSpace: "nowrap" as const }}
          >
            View all →
          </button>
        </div>
      )}

      {/* ─── Decision Ledger Grouped overview ─── */}
      {!isLoading && entries.length > 0 && (
        <section style={{ padding: "16px 18px", borderBottom: "1px solid var(--border)", background: "var(--surface)" }}>
          <DecisionLedgerGrouped entries={entries} focusId={expanded ?? undefined} onFocus={setExpanded} />
        </section>
      )}

      {/* ─── Timeline ─── */}
      <main style={{ padding: "0 18px" }}>
        {isLoading ? (
          <div style={{ padding: "80px 0", display: "flex", justifyContent: "center" }}>
            <LoadingSpinner size="lg" />
          </div>
        ) : filtered.length === 0 ? (
          <EmptyState hasEntries={entries.length > 0} onAdd={() => setDialogOpen(true)} />
        ) : (
          <div style={{ position: "relative", paddingLeft: 20, paddingTop: 16 }}>
            {/* Gold spine */}
            <div aria-hidden style={{ position: "absolute", left: 7, top: 0, bottom: 0, width: 1, background: "linear-gradient(180deg, var(--accent-gold), color-mix(in oklab, var(--accent-gold) 20%, transparent))" }} />

            {groups.map((group) => (
              <div key={group.key} style={{ marginBottom: 24 }}>
                {/* Date header */}
                <div style={{ paddingBottom: 8, paddingTop: 4, background: "var(--background)" }}>
                  <div style={{ display: "flex", alignItems: "center", gap: 10, marginLeft: -20 }}>
                    <div style={{ width: 14, height: 14, borderRadius: "50%", background: "var(--background)", border: "2px solid var(--accent-gold)", flexShrink: 0 }} />
                    <span style={{ fontFamily: "var(--font-mono)", fontSize: 9.5, letterSpacing: "0.12em", textTransform: "uppercase" as const, color: "var(--accent-gold)" }}>{group.dateLabel}</span>
                    <span style={{ fontFamily: "var(--font-mono)", fontSize: 9, color: "var(--muted-text)" }}>·</span>
                    <span style={{ fontFamily: "var(--font-mono)", fontSize: 9, color: "var(--muted-text)", letterSpacing: "0.06em" }}>{group.label}</span>
                  </div>
                </div>

                {group.entries.map((entry) => (
                  <EntryRow
                    key={entry.id}
                    entry={entry}
                    expanded={expanded === entry.id}
                    busy={busyId === entry.id}
                    hasActiveReopen={activeReopenIds.has(entry.id)}
                    reopenChain={buildReopenChain(entry, allEntriesById)}
                    onToggle={() => setExpanded((v) => (v === entry.id ? null : entry.id))}
                    onReopen={() => handleReopen(entry)}
                    onArchive={() => handleArchive(entry)}
                    onEdit={() => setEditEntry(entry)}
                  />
                ))}
              </div>
            ))}
          </div>
        )}
      </main>

      {/* ─── Add Entry Dialog ─── */}
      {projectId && (
        <AddEntryDialog
          open={dialogOpen}
          onClose={() => setDialogOpen(false)}
          projectId={projectId}
          onCreated={invalidate}
        />
      )}

      {/* ─── Edit Entry Dialog ─── */}
      <EditEntryDialog
        open={editEntry !== null}
        onClose={() => setEditEntry(null)}
        entry={editEntry}
        onSave={handleEditSave}
        saving={editSaving}
      />
    </div>
  );
}

/* ─── Global Decisions View ──────────────────────────────────────── */

type GlobalEntry = Entry & { projectName?: string };

function GlobalDecisionsView({
  allEntries,
  projects,
  isLoading,
  pullToRefreshIndicator,
  pullToRefreshContainerRef,
}: {
  allEntries: GlobalEntry[];
  projects: Project[];
  isLoading: boolean;
  pullToRefreshIndicator?: ReactNode;
  pullToRefreshContainerRef?: RefObject<HTMLDivElement | null>;
}) {
  const [, setLocation] = useLocation();
  const [focusProjectId, setFocusProjectId] = useState<number | null>(null);
  const [categoryFilter, setCategoryFilter] = useState<CategoryFilter>("all");
  const [searchQuery, setSearchQuery] = useState("");
  const [searchOpen, setSearchOpen] = useState(false);

  // ── Stats ────────────────────────────────────────────────────────
  const committed = useMemo(
    () => allEntries
      .filter((e) => e.status === "committed")
      .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()),
    [allEntries],
  );
  const now = Date.now();
  const thisWeek = committed.filter((e) => now - new Date(e.createdAt).getTime() < 7 * 86400000);
  const flagged = committed.filter((e) => e.severity === "blocker");

  const mostActiveProject = useMemo(() => {
    const counts = new Map<string, number>();
    for (const e of committed) {
      const n = e.projectName ?? "Unknown";
      counts.set(n, (counts.get(n) ?? 0) + 1);
    }
    return [...counts.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] ?? "—";
  }, [committed]);

  // ── Per-project cards ────────────────────────────────────────────
  const projectStats = useMemo(() => {
    const projectsById = new Map(projects.map((p) => [p.id, p]));
    const byProject = new Map<number, { project: { id: number; name: string }; entries: GlobalEntry[] }>();
    for (const entry of committed) {
      const bucket = byProject.get(entry.projectId);
      if (bucket) {
        bucket.entries.push(entry);
        continue;
      }
      const project = projectsById.get(entry.projectId);
      byProject.set(entry.projectId, {
        project: {
          id: entry.projectId,
          name: project?.name ?? entry.projectName ?? `Project ${entry.projectId}`,
        },
        entries: [entry],
      });
    }
    return [...byProject.values()].map(({ project, entries: pe }) => {
      const cats = { structure: 0, aesthetic: 0, logic: 0, general: 0 };
      for (const e of pe) cats[inferCategory(e)]++;
      const total = pe.length || 1;
      return { project, count: pe.length, lastEntry: pe[0] ?? null, cats, total };
    }).sort((a, b) => new Date(b.lastEntry?.createdAt ?? 0).getTime() - new Date(a.lastEntry?.createdAt ?? 0).getTime());
  }, [committed, projects]);

  // ── Filtered stream, deduped + grouped (×N within 24h on same project+title) ──
  const stream = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    const filtered = committed.filter((e) => {
      if ((e.status as string) === "archived_duplicate") return false;
      if (focusProjectId && e.projectId !== focusProjectId) return false;
      if (categoryFilter !== "all" && inferCategory(e) !== categoryFilter) return false;
      if (q && !e.title.toLowerCase().includes(q) && !(e.summary ?? "").toLowerCase().includes(q)) return false;
      return true;
    });

    const normalize = (s: string) => s.toLowerCase().replace(/\s+/g, " ").trim();
    const DAY = 86400000;
    const groups: Array<{ key: string; lead: GlobalEntry; occurrences: GlobalEntry[] }> = [];

    for (const entry of filtered) {
      const norm = normalize(entry.title);
      const ts = new Date(entry.createdAt).getTime();
      const existing = groups.find(
        (g) =>
          g.lead.projectId === entry.projectId &&
          normalize(g.lead.title) === norm &&
          Math.abs(new Date(g.lead.createdAt).getTime() - ts) < DAY,
      );
      if (existing) existing.occurrences.push(entry);
      else groups.push({ key: `${entry.projectId}:${norm}:${entry.id}`, lead: entry, occurrences: [entry] });
    }

    return groups.slice(0, 50);
  }, [committed, focusProjectId, categoryFilter, searchQuery]);

  const STAT_TILES = [
    { label: "Total Decisions", value: committed.length, color: "var(--foreground)" },
    { label: "This Week", value: thisWeek.length, color: "var(--phosphor)" },
    { label: "Flagged", value: flagged.length, color: "var(--ember)" },
    { label: "Most Active", value: mostActiveProject, color: "var(--accent-gold)", small: true },
  ];

  return (
    <div
      ref={pullToRefreshContainerRef}
      style={{
        position: "relative",
        height: "100dvh",
        background: "transparent",
        color: "var(--foreground)",
        paddingBottom: 80,
        overflowY: "auto",
      }}
    >
      {pullToRefreshIndicator}
      <style>{`@keyframes ptr-spin { to { transform: rotate(360deg); } }`}</style>
      <FooterAuditLine />

      {/* ── Header ── */}
      <header style={{ padding: "14px 18px 12px", borderBottom: "1px solid var(--border)", background: "var(--background)" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 6 }}>
          <button
            type="button"
            onClick={() => setLocation("/")}
            style={{ fontFamily: "var(--font-mono)", fontSize: 10, letterSpacing: "0.14em", textTransform: "uppercase" as const, color: "var(--muted-text)", background: "transparent", border: "none", padding: 0, cursor: "pointer" }}
          >
            ← Home
          </button>
        </div>
        <div style={{ display: "flex", alignItems: "flex-end", justifyContent: "space-between" }}>
          <div>
            <h1 style={{ fontSize: 20, fontWeight: 600, letterSpacing: "-0.01em", margin: 0, lineHeight: 1.2 }}>
              Decisions
            </h1>
            <p style={{ fontFamily: "var(--font-mono)", fontSize: 10, color: "var(--muted-text)", margin: "3px 0 0", letterSpacing: "0.06em" }}>
              Portfolio · All Projects
            </p>
          </div>
          <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
            <button
              onClick={() => setSearchOpen((v) => !v)}
              style={{ width: 34, height: 34, borderRadius: 8, background: searchOpen ? "var(--surface-alt)" : "transparent", border: searchOpen ? "1px solid var(--accent-gold)" : "1px solid var(--border)", display: "flex", alignItems: "center", justifyContent: "center", color: searchOpen ? "var(--accent-gold)" : "var(--muted-text)", cursor: "pointer", transition: "all 160ms ease" }}
            >
              <svg viewBox="0 0 16 16" width={13} height={13} stroke="currentColor" fill="none" strokeWidth={1.5}>
                <circle cx="6.5" cy="6.5" r="4" /><path d="M10 10l3.5 3.5" strokeLinecap="round" />
              </svg>
            </button>
          </div>
        </div>
      </header>

      {/* ── Search ── */}
      {searchOpen && (
        <div style={{ padding: "8px 18px", borderBottom: "1px solid var(--border)", background: "var(--surface)" }}>
          <input
            autoFocus
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder="Search all decisions..."
            style={{ width: "100%", background: "var(--surface-alt)", border: "1px solid var(--border)", borderRadius: 6, padding: "8px 12px", fontSize: 13, color: "var(--foreground)", outline: "none", fontFamily: "var(--font-sans)", boxSizing: "border-box" as const }}
          />
        </div>
      )}

      {/* ── Stats bar ── */}
      {!isLoading && (
        <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: 0, borderBottom: "1px solid var(--border)" }}>
          {STAT_TILES.map((tile, i) => (
            <div key={i} style={{ padding: "14px 16px", borderRight: i < 3 ? "1px solid var(--border)" : "none", textAlign: "center" as const }}>
              <div style={{ fontSize: tile.small ? 12 : 22, fontWeight: 600, color: tile.color, letterSpacing: tile.small ? "-0.01em" : "-0.03em", lineHeight: 1.1, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" as const }}>
                {tile.value}
              </div>
              <div style={{ fontFamily: "var(--font-mono)", fontSize: 8.5, color: "var(--muted-text)", letterSpacing: "0.08em", textTransform: "uppercase" as const, marginTop: 4 }}>
                {tile.label}
              </div>
            </div>
          ))}
        </div>
      )}

      {/* ── Project cards ── */}
      {!isLoading && projectStats.length > 0 && (
        <section style={{ borderBottom: "1px solid var(--border)" }}>
          <div style={{ padding: "10px 18px 0", display: "flex", alignItems: "center", justifyContent: "space-between" }}>
            <span style={{ fontFamily: "var(--font-mono)", fontSize: 9, letterSpacing: "0.12em", textTransform: "uppercase" as const, color: "var(--muted-text)" }}>Projects</span>
            {focusProjectId && (
              <button
                onClick={() => setFocusProjectId(null)}
                style={{ fontFamily: "var(--font-mono)", fontSize: 9, letterSpacing: "0.08em", color: "var(--ember)", background: "none", border: "none", cursor: "pointer", padding: 0 }}
              >
                Clear filter ×
              </button>
            )}
          </div>
          <div style={{ display: "flex", gap: 10, padding: "10px 18px 14px", overflowX: "auto", scrollbarWidth: "none" as const }}>
            {projectStats.map(({ project, count, lastEntry, cats, total }) => {
              const isActive = focusProjectId === project.id;
              return (
                <button
                  key={project.id}
                  onClick={() => setFocusProjectId(isActive ? null : project.id)}
                  style={{
                    flexShrink: 0, width: 170, padding: "12px 14px", borderRadius: 10,
                    border: `1px solid ${isActive ? "var(--accent-gold)" : "var(--border)"}`,
                    background: isActive ? "color-mix(in oklab, var(--accent-gold) 8%, var(--surface))" : "var(--surface)",
                    textAlign: "left" as const, cursor: "pointer", transition: "all 160ms ease",
                    display: "flex", flexDirection: "column" as const, gap: 6,
                  }}
                >
                  {/* Project name */}
                  <div style={{ fontSize: 12, fontWeight: 600, color: isActive ? "var(--accent-gold)" : "var(--foreground)", letterSpacing: "-0.01em", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" as const }}>
                    {project.name}
                  </div>
                  {/* Decision count + last activity */}
                  <div style={{ fontFamily: "var(--font-mono)", fontSize: 9, color: "var(--muted-text)", letterSpacing: "0.06em" }}>
                    {count} decision{count !== 1 ? "s" : ""}
                    {lastEntry && <span> · {relativeTime(lastEntry.createdAt)}</span>}
                  </div>
                  {/* Category breakdown bar */}
                  <div style={{ display: "flex", height: 3, borderRadius: 2, overflow: "hidden", gap: 1 }}>
                    {(["structure", "aesthetic", "logic", "general"] as const).map((cat) => {
                      const pct = (cats[cat] / total) * 100;
                      if (pct === 0) return null;
                      return (
                        <div key={cat} style={{ height: "100%", width: `${pct}%`, background: CATEGORY_CONFIG[cat].color, opacity: 0.75, borderRadius: 2 }} />
                      );
                    })}
                  </div>
                  {/* Open per-project ledger link */}
                  <div
                    role="link"
                    onClick={(e) => { e.stopPropagation(); setLocation(`/ledger/${project.id}`); }}
                    style={{ fontFamily: "var(--font-mono)", fontSize: 8.5, color: "var(--muted-text)", letterSpacing: "0.08em", textTransform: "uppercase" as const, display: "flex", alignItems: "center", gap: 3, marginTop: 2, cursor: "pointer" }}
                  >
                    View ledger →
                  </div>
                </button>
              );
            })}
          </div>
        </section>
      )}

      {/* ── Category filter pills ── */}
      <div style={{ padding: "10px 18px", display: "flex", gap: 6, overflowX: "auto", scrollbarWidth: "none" as const, borderBottom: "1px solid var(--border)" }}>
        {(["all", "structure", "aesthetic", "logic", "general"] as const).map((cat) => {
          const isActive = categoryFilter === cat;
          const cfg = cat === "all" ? { label: "ALL", color: "var(--foreground)" } : CATEGORY_CONFIG[cat];
          return (
            <button
              key={cat}
              onClick={() => setCategoryFilter(cat)}
              style={{ flexShrink: 0, padding: "4px 12px", borderRadius: 14, border: `1px solid ${isActive ? cfg.color : "var(--border)"}`, background: isActive ? `color-mix(in oklab, ${cfg.color} 12%, transparent)` : "transparent", fontFamily: "var(--font-mono)", fontSize: 9.5, letterSpacing: "0.1em", textTransform: "uppercase" as const, color: isActive ? cfg.color : "var(--muted-text)", cursor: "pointer", transition: "all 160ms ease" }}
            >
              {cfg.label}
            </button>
          );
        })}
      </div>

      {/* ── Decision stream ── */}
      <main style={{ padding: "0 18px" }}>
        {isLoading ? (
          <div style={{ padding: "80px 0", display: "flex", justifyContent: "center" }}>
            <LoadingSpinner size="lg" />
          </div>
        ) : stream.length === 0 ? (
          <div style={{ padding: "60px 0", textAlign: "center" as const }}>
            <p style={{ fontFamily: "var(--font-mono)", fontSize: 11, color: "var(--muted-text)", letterSpacing: "0.08em" }}>
              {allEntries.length === 0 ? "No decisions yet. Make your first call in a workspace." : "No decisions match these filters."}
            </p>
          </div>
        ) : (
          <div style={{ position: "relative", paddingLeft: 20, paddingTop: 16 }}>
            {/* Gold spine */}
            <div aria-hidden style={{ position: "absolute", left: 7, top: 0, bottom: 0, width: 1, background: "linear-gradient(180deg, var(--accent-gold), color-mix(in oklab, var(--accent-gold) 20%, transparent))" }} />

            {stream.map((group) => {
              const entry = group.lead;
              const count = group.occurrences.length;
              const cat = inferCategory(entry);
              const catCfg = CATEGORY_CONFIG[cat];
              const severityColor = entry.severity === "blocker" ? "var(--ember)" : entry.severity === "committed" ? "var(--phosphor)" : entry.severity === "parked" ? "var(--accent-gold)" : "var(--muted-text)";
              const linkKey = `axiom:ledger:gh:${entry.id}`;
              const storedLink = typeof window !== "undefined" ? window.localStorage.getItem(linkKey) : null;
              return (
                <div
                  key={group.key}
                  style={{ marginBottom: 8, borderRadius: 8, border: "1px solid var(--border)", background: "transparent", padding: "11px 14px", display: "flex", flexDirection: "column" as const, gap: 5 }}
                >
                  <div style={{ display: "flex", alignItems: "flex-start", gap: 10 }}>
                    <span style={{ width: 7, height: 7, borderRadius: "50%", background: severityColor, flexShrink: 0, marginTop: 4 }} />
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                        <div style={{ fontSize: 13, fontWeight: 500, letterSpacing: "-0.01em", color: "var(--foreground)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" as const, flex: 1, minWidth: 0 }}>
                          {entry.title}
                        </div>
                        {count > 1 && (
                          <span
                            title={`Logged ${count} times within 24h`}
                            style={{ fontFamily: "var(--font-mono)", fontSize: 9, color: "var(--accent-gold)", background: "color-mix(in oklab, var(--accent-gold) 14%, transparent)", border: "0.5px solid color-mix(in oklab, var(--accent-gold) 35%, transparent)", padding: "1px 6px", borderRadius: 10, flexShrink: 0, letterSpacing: "0.04em" }}
                          >
                            ×{count}
                          </span>
                        )}
                      </div>
                      {entry.summary && (
                        <div style={{ fontSize: 11.5, color: "var(--muted-text)", marginTop: 2, lineHeight: 1.5, display: "-webkit-box", WebkitLineClamp: 2, WebkitBoxOrient: "vertical" as const, overflow: "hidden" }}>
                          {entry.summary}
                        </div>
                      )}
                    </div>
                  </div>
                  <div style={{ display: "flex", alignItems: "center", gap: 6, paddingLeft: 17, flexWrap: "wrap" as const }}>
                    {entry.projectName && (
                      <span
                        onClick={() => setFocusProjectId(entry.projectId)}
                        style={{ fontFamily: "var(--font-mono)", fontSize: 9, letterSpacing: "0.08em", color: "var(--accent-gold)", background: "color-mix(in oklab, var(--accent-gold) 10%, transparent)", border: "0.5px solid color-mix(in oklab, var(--accent-gold) 28%, transparent)", padding: "1px 7px", borderRadius: 3, textTransform: "uppercase" as const, cursor: "pointer", flexShrink: 0 }}
                      >
                        {entry.projectName}
                      </span>
                    )}
                    <span style={{ fontFamily: "var(--font-mono)", fontSize: 9, letterSpacing: "0.08em", color: catCfg.color, background: `color-mix(in oklab, ${catCfg.color} 10%, transparent)`, border: `0.5px solid color-mix(in oklab, ${catCfg.color} 25%, transparent)`, padding: "1px 7px", borderRadius: 3, textTransform: "uppercase" as const, flexShrink: 0 }}>
                      {catCfg.label}
                    </span>
                    <span style={{ fontFamily: "var(--font-mono)", fontSize: 9, color: "var(--muted-text)", letterSpacing: "0.04em", flexShrink: 0 }}>
                      {relativeTime(entry.createdAt)}
                    </span>
                    {storedLink ? (
                      <a
                        href={storedLink}
                        target="_blank"
                        rel="noreferrer noopener"
                        onClick={(e) => e.stopPropagation()}
                        style={{ fontFamily: "var(--font-mono)", fontSize: 9, letterSpacing: "0.06em", color: "var(--phosphor)", background: "color-mix(in oklab, var(--phosphor) 10%, transparent)", border: "0.5px solid color-mix(in oklab, var(--phosphor) 28%, transparent)", padding: "1px 7px", borderRadius: 3, textDecoration: "none", flexShrink: 0 }}
                      >
                        {(() => {
                          const m = storedLink.match(/commit\/([a-f0-9]{7,40})/i);
                          if (m) return `⌥ ${m[1].slice(0, 7)}`;
                          const pr = storedLink.match(/pull\/(\d+)/);
                          if (pr) return `PR #${pr[1]}`;
                          return "GitHub";
                        })()}
                      </a>
                    ) : (
                      <button
                        onClick={(e) => {
                          e.stopPropagation();
                          const url = window.prompt("Paste GitHub commit or PR URL");
                          if (url && /^https?:\/\/github\.com\//i.test(url)) {
                            window.localStorage.setItem(linkKey, url);
                            toast("Linked to GitHub");
                            setLocation(window.location.pathname);
                          } else if (url) {
                            toast("Not a valid github.com URL");
                          }
                        }}
                        style={{ fontFamily: "var(--font-mono)", fontSize: 9, letterSpacing: "0.06em", color: "var(--muted-text)", background: "transparent", border: "0.5px dashed var(--border)", padding: "1px 7px", borderRadius: 3, cursor: "pointer", flexShrink: 0 }}
                      >
                        + Link commit
                      </button>
                    )}
                  </div>
                </div>
              );
            })}

            {stream.length >= 50 && (
              <p style={{ fontFamily: "var(--font-mono)", fontSize: 10, color: "var(--muted-text)", textAlign: "center" as const, padding: "16px 0", letterSpacing: "0.06em" }}>
                Showing most recent 50 — use a project filter to see more
              </p>
            )}
          </div>
        )}
      </main>
    </div>
  );
}

/* ─── Entry row ──────────────────────────────────────────────────── */

function EntryRow({
  entry,
  expanded,
  busy,
  hasActiveReopen,
  reopenChain = [],
  onToggle,
  onReopen,
  onArchive,
  onEdit,
}: {
  entry: Entry;
  expanded: boolean;
  busy: boolean;
  hasActiveReopen?: boolean;
  reopenChain?: { id: number; title: string; projectId: number }[];
  onToggle: () => void;
  onReopen: () => void;
  onArchive: () => void;
  onEdit: () => void;
}) {
  const [chainOpen, setChainOpen] = useState(false);
  const catColor = CATEGORY_CONFIG[inferCategory(entry)].color;

  return (
    <div
      data-entry-id={entry.id}
      style={{
        marginBottom: 8,
        borderRadius: 8,
        border: `1px solid ${expanded ? "color-mix(in oklab, var(--accent-gold) 30%, transparent)" : "var(--border)"}`,
        background: expanded ? "var(--surface)" : "transparent",
        transition: "all 160ms ease",
        overflow: "hidden",
      }}
    >
      {/* Row header — always visible */}
      <div
        role="button"
        tabIndex={0}
        aria-expanded={expanded}
        onClick={onToggle}
        onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); onToggle(); } }}
        style={{ display: "flex", alignItems: "flex-start", gap: 12, padding: "12px 14px", width: "100%", cursor: "pointer", textAlign: "left" as const, color: "inherit", font: "inherit", userSelect: "none" as const }}
      >
        {/* Severity dot */}
        <span style={{ width: 7, height: 7, borderRadius: "50%", background: entry.severity === "blocker" ? "var(--ember)" : entry.severity === "committed" ? "var(--phosphor)" : entry.severity === "parked" ? "var(--accent-gold)" : "var(--muted-text)", flexShrink: 0, marginTop: 5 }} />

        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 3 }}>
            <Link
              href={`/entry/${entry.id}`}
              onClick={(e) => e.stopPropagation()}
              style={{ textDecoration: "none", fontSize: 14, fontWeight: 500, letterSpacing: "-0.01em", color: "var(--foreground)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" as const }}
            >
              {entry.title}
            </Link>
            {entry.buildId && (
              <span style={{ fontFamily: "var(--font-mono)", fontSize: 9, letterSpacing: "0.08em", color: "var(--muted-text)", flexShrink: 0, background: "var(--surface-alt)", padding: "1px 6px", borderRadius: 3 }}>
                {entry.buildId}
              </span>
            )}
            {hasActiveReopen && (
              <span style={{
                fontFamily: "var(--font-mono)", fontSize: 9, letterSpacing: "0.08em",
                color: "var(--accent-gold)", flexShrink: 0,
                background: "color-mix(in oklab, var(--accent-gold) 10%, transparent)",
                border: "1px solid color-mix(in oklab, var(--accent-gold) 28%, transparent)",
                padding: "1px 7px", borderRadius: 3, textTransform: "uppercase" as const,
              }}>
                ↩ Reopen active
              </span>
            )}
          </div>
          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <span style={{ fontFamily: "var(--font-mono)", fontSize: 9.5, color: "var(--muted-text)", letterSpacing: "0.06em" }}>{relativeTime(entry.createdAt)}</span>
            {entry.verb && (
              entry.verb === "axiom_import" ? (
                <span style={{ fontFamily: "var(--font-mono)", fontSize: 9, letterSpacing: "0.08em", color: "var(--accent-gold)", background: "rgba(201,162,76,0.1)", border: "1px solid rgba(201,162,76,0.28)", padding: "1px 6px", borderRadius: 3, textTransform: "uppercase" as const, display: "inline-flex", alignItems: "center", gap: 3 }}>
                  <svg width={8} height={8} viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
                    <rect x="2" y="7" width="8" height="7" rx="1.25" />
                    <path d="M10 3.5 H14" /><path d="M11.5 5.5 L14 3.5 L11.5 1.5" /><path d="M6 7 V5 H10" opacity="0.55" />
                  </svg>
                  Compani
                </span>
              ) : (
                <span style={{ fontFamily: "var(--font-mono)", fontSize: 9, letterSpacing: "0.08em", color: catColor, background: `color-mix(in oklab, ${catColor} 10%, transparent)`, border: `1px solid color-mix(in oklab, ${catColor} 25%, transparent)`, padding: "1px 6px", borderRadius: 3, textTransform: "uppercase" as const }}>{entry.verb}</span>
              )
            )}
            {entry.costOfLesson != null && <span style={{ fontFamily: "var(--font-mono)", fontSize: 9.5, color: "var(--ember)", letterSpacing: "0.06em" }}>{formatCost(entry.costOfLesson)}</span>}
            {entry.isViolation && <span style={{ fontFamily: "var(--font-mono)", fontSize: 9, letterSpacing: "0.08em", color: "var(--ember)", background: "rgba(146,64,14,0.12)", border: "1px solid rgba(146,64,14,0.25)", padding: "1px 6px", borderRadius: 3, textTransform: "uppercase" as const }}>shifted</span>}
          </div>
        </div>

        <span aria-hidden style={{ color: "var(--muted-text)", fontSize: 10, flexShrink: 0, marginTop: 2, transform: expanded ? "rotate(180deg)" : "none", transition: "transform 160ms ease" }}>▾</span>
      </div>

      {/* Expanded detail */}
      {expanded && (
        <div style={{ padding: "0 14px 14px", borderTop: "1px solid color-mix(in oklab, var(--accent-gold) 10%, transparent)" }}>
          {entry.summary && (
            <p style={{ fontSize: 13, lineHeight: 1.6, color: "var(--foreground)", margin: "12px 0 0", opacity: 0.85 }}>
              {entry.summary}
            </p>
          )}
          {entry.details && (
            <p style={{ fontSize: 12, lineHeight: 1.7, color: "var(--muted-text)", margin: "8px 0 0", fontStyle: "italic" as const }}>
              {entry.details}
            </p>
          )}
          {entry.touched && entry.touched.length > 0 && (
            <div style={{ marginTop: 10, display: "flex", flexWrap: "wrap", gap: 4 }}>
              {entry.touched.map((f, i) => (
                <span key={i} style={{ fontFamily: "var(--font-mono)", fontSize: 9.5, background: "var(--surface-alt)", border: "1px solid var(--border)", borderRadius: 3, padding: "2px 7px", color: "var(--muted-text)" }}>{f}</span>
              ))}
            </div>
          )}
          {entry.lockedAt && (
            <p style={{ fontFamily: "var(--font-mono)", fontSize: 9, color: "var(--muted-text)", margin: "10px 0 0", letterSpacing: "0.06em" }}>
              Locked {relativeTime(entry.lockedAt)}
            </p>
          )}

          {/* Reopen chain — shown if this committed entry itself supersedes an older one */}
          {entry.supersedesId != null && reopenChain.length > 0 && (
            <div style={{ marginTop: 12, display: "flex", flexDirection: "column", gap: 4 }}>
              <div style={{ display: "flex", alignItems: "center", gap: 6, flexWrap: "wrap" }}>
                <a
                  href={`/ledger/${reopenChain[0].projectId}?expand=${reopenChain[0].id}`}
                  onClick={(e) => e.stopPropagation()}
                  style={{
                    display: "inline-flex", alignItems: "center", gap: 5,
                    fontFamily: "var(--font-mono)", fontSize: 9.5,
                    letterSpacing: "0.08em", textTransform: "uppercase" as const,
                    color: "var(--accent-gold)", textDecoration: "none",
                    background: "color-mix(in oklab, var(--accent-gold) 8%, transparent)",
                    border: "0.5px solid color-mix(in oklab, var(--accent-gold) 25%, transparent)",
                    borderRadius: 4, padding: "3px 8px",
                  }}
                >
                  <span>↩</span> Supersedes: {reopenChain[0].title}
                </a>
                {reopenChain.length > 1 && (
                  <button
                    type="button"
                    onClick={(e) => { e.stopPropagation(); setChainOpen((v) => !v); }}
                    style={{
                      fontFamily: "var(--font-mono)", fontSize: 9,
                      letterSpacing: "0.1em", textTransform: "uppercase" as const,
                      color: "var(--muted-text)", background: "transparent",
                      border: "none", padding: "2px 0", cursor: "pointer",
                      display: "inline-flex", alignItems: "center", gap: 3,
                    }}
                  >
                    {chainOpen ? "Hide history" : `Full history (${reopenChain.length})`}
                    <span style={{ transform: chainOpen ? "rotate(180deg)" : "none", transition: "transform 140ms ease", display: "inline-block" }}>▾</span>
                  </button>
                )}
              </div>
              {chainOpen && reopenChain.length > 1 && (
                <div style={{
                  marginLeft: 4, paddingLeft: 10,
                  borderLeft: "1px solid color-mix(in oklab, var(--accent-gold) 20%, transparent)",
                  display: "flex", flexDirection: "column", gap: 4,
                }}>
                  {reopenChain.slice(1).map((ancestor, i) => (
                    <a
                      key={ancestor.id}
                      href={`/ledger/${ancestor.projectId}?expand=${ancestor.id}`}
                      onClick={(e) => e.stopPropagation()}
                      style={{
                        display: "inline-flex", alignItems: "center", gap: 5,
                        fontFamily: "var(--font-mono)", fontSize: 9.5,
                        color: `color-mix(in oklab, var(--accent-gold) ${Math.max(40, 65 - i * 15)}%, var(--muted-text))`,
                        textDecoration: "none",
                      }}
                    >
                      <span style={{ opacity: 0.5 }}>↑</span>{ancestor.title}
                    </a>
                  ))}
                </div>
              )}
            </div>
          )}

          {/* Actions */}
          <div style={{ display: "flex", justifyContent: "space-between", gap: 6, borderTop: "1px solid color-mix(in oklab, var(--accent-gold) 10%, transparent)", paddingTop: 10, marginTop: 14 }}>
            <ActionButton onClick={onEdit} disabled={busy}>Edit</ActionButton>
            <div style={{ display: "flex", gap: 6 }}>
              <ActionButton onClick={onReopen} disabled={busy}>Reopen</ActionButton>
              <ActionButton onClick={onArchive} disabled={busy}>Archive</ActionButton>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function ActionButton({ children, onClick, disabled }: { children: React.ReactNode; onClick: () => void; disabled?: boolean }) {
  return (
    <button
      type="button"
      onClick={(e) => { e.stopPropagation(); onClick(); }}
      disabled={disabled}
      style={{ fontFamily: "var(--font-mono)", fontSize: 10, letterSpacing: "0.1em", textTransform: "uppercase" as const, padding: "5px 12px", borderRadius: 4, border: "0.5px solid color-mix(in oklab, var(--accent-gold) 40%, transparent)", background: "transparent", color: "color-mix(in oklab, var(--accent-gold) 80%, var(--foreground))", cursor: disabled ? "default" : "pointer", opacity: disabled ? 0.4 : 1, transition: "all 120ms ease" }}
    >
      {children}
    </button>
  );
}

function EmptyState({ hasEntries, onAdd }: { hasEntries: boolean; onAdd: () => void }) {
  return (
    <div style={{ padding: "80px 24px", display: "flex", flexDirection: "column", alignItems: "center", textAlign: "center" }}>
      <div style={{ width: 48, height: 48, borderRadius: 4, border: "1px solid var(--border)", display: "flex", alignItems: "center", justifyContent: "center", marginBottom: 20 }}>
        <div style={{ width: 8, height: 8, background: "var(--ember)", borderRadius: 1 }} />
      </div>
      <h2 style={{ fontSize: 14, fontWeight: 500, margin: 0 }}>
        {hasEntries ? "No entries match this filter." : "The ledger is empty."}
      </h2>
      <p style={{ fontFamily: "var(--font-mono)", fontSize: 12, color: "var(--muted-text)", marginTop: 8, maxWidth: 300 }}>
        {hasEntries ? "Adjust your filters to see other committed decisions." : "Phase 1 begins with the first committed decision. Park an idea, then commit it."}
      </p>
      {!hasEntries && (
        <button
          onClick={onAdd}
          style={{ marginTop: 20, padding: "8px 18px", fontSize: 11, fontWeight: 600, fontFamily: "var(--font-mono)", letterSpacing: "0.1em", textTransform: "uppercase" as const, background: "var(--ember)", color: "var(--background)", border: "none", borderRadius: 4, cursor: "pointer" }}
        >
          Log First Decision
        </button>
      )}
    </div>
  );
}

function FilterSelect({ label, value, onChange, options }: { label: string; value: string; onChange: (v: string) => void; options: { value: string; label: string }[] }) {
  return (
    <label style={{ display: "flex", alignItems: "center", gap: 4 }}>
      <span style={{ fontFamily: "var(--font-mono)", fontSize: 9, letterSpacing: "0.1em", textTransform: "uppercase" as const, color: "var(--muted-text)" }}>{label}</span>
      <select
        value={value}
        onChange={(e) => onChange(e.target.value)}
        style={{ background: "var(--surface-alt)", border: "1px solid var(--border)", borderRadius: 6, padding: "3px 8px", fontFamily: "var(--font-mono)", fontSize: 10, color: value !== "all" ? "var(--accent-gold)" : "var(--muted-text)", outline: "none", cursor: "pointer" }}
      >
        {options.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
      </select>
    </label>
  );
}
