import { useState } from "react";
import { Entry, updateEntry, useUpdateEntry, getListEntriesQueryKey } from "@workspace/api-client-react";
import { Link } from "wouter";
import { useQueryClient } from "@tanstack/react-query";
import { timeAgo } from "@/lib/formatters";
import { haptic } from "@/lib/long-press-tip";

export function ParkingLotEntry({ entry }: { entry: Entry }) {
  const queryClient = useQueryClient();
  const updateEntry = useUpdateEntry();
  const [done, setDone] = useState(false);
  const [expanded, setExpanded] = useState(false);
  const [showDetails, setShowDetails] = useState(false);

  const handleResolve = () => {
    if (done) return;
    updateEntry.mutate(
      { id: entry.id, data: { status: "archived" } },
      { onSuccess: () => { setDone(true); queryClient.invalidateQueries({ queryKey: getListEntriesQueryKey(entry.projectId, {}) }); } }
    );
  };

  const handleCommit = () => {
    if (done) return;
    haptic.short();
    updateEntry.mutate(
      { id: entry.id, data: { status: "committed", severity: "committed" } },
      { onSuccess: () => { setDone(true); queryClient.invalidateQueries({ queryKey: getListEntriesQueryKey(entry.projectId, {}) }); } }
    );
  };

  const modeLabel = entry.mode ? entry.mode.toUpperCase() : "NOTE";
  const typeLabel = entry.verb ? entry.verb.toUpperCase() : "INSIGHT";
  const summary = entry.summary || "";
  const sentences = summary.split(/(?<=[.!?])\s+/);
  const shortDef = sentences.slice(0, 2).join(" ") || summary;
  const context = sentences.length > 2 ? sentences.slice(2).join(" ") : "";
  const hasDetails = !!(entry.details || (entry.touched && entry.touched.length > 0));

  return (
    <div style={{ marginBottom: 2, position: "relative", opacity: done ? 0.4 : 1, transition: "opacity 300ms ease" }}>
      {/* Gold timeline vertical line */}
      {expanded && (
        <div style={{ position: "absolute", left: 5, top: 22, bottom: 14, width: 1, background: "rgba(201,162,76,0.2)" }} />
      )}

      {/* Collapsed header row */}
      <div
        onClick={() => setExpanded(v => !v)}
        style={{ display: "flex", alignItems: "center", gap: 8, padding: "8px 2px", cursor: "pointer" }}
      >
        {/* Gold dot */}
        <span style={{ width: 11, height: 11, borderRadius: "50%", background: "var(--atlas-gold)", flexShrink: 0, zIndex: 1, boxShadow: "0 0 0 3px rgba(201,162,76,0.1)", display: "inline-block" }} />
        {/* Expand caret */}
        <svg width="10" height="10" viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round"
          style={{ flexShrink: 0, color: "rgba(var(--atlas-muted-rgb),0.45)", transform: expanded ? "rotate(180deg)" : "none", transition: "transform 180ms ease" }}>
          <path d="M2 4l4 4 4-4" />
        </svg>
        {/* Title */}
        <Link
          href={`/entry/${entry.id}`}
          onClick={(e) => e.stopPropagation()}
          style={{ flex: 1, fontSize: "var(--ts-label)", color: "var(--atlas-fg)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", lineHeight: 1.4, textDecoration: "none" }}
        >
          {entry.title}
        </Link>
        {/* NOTE badge */}
        <span style={{ fontSize: "var(--ts-xs)", fontFamily: "var(--app-font-mono)", letterSpacing: "0.07em", background: "rgba(var(--atlas-muted-rgb),0.12)", color: "rgba(var(--atlas-muted-rgb),0.6)", padding: "2px 7px", borderRadius: 4, flexShrink: 0, textTransform: "uppercase" as const }}>
          NOTE
        </span>
      </div>

      {/* Source line (collapsed) */}
      {!expanded && (
        <div style={{ paddingLeft: 20, paddingBottom: 6, fontSize: "var(--ts-micro)", color: "rgba(var(--atlas-muted-rgb),0.38)", fontFamily: "var(--app-font-mono)" }}>
          chat message · {timeAgo(entry.createdAt)}
        </div>
      )}

      {/* Expanded definition card */}
      {expanded && (
        <div style={{ marginLeft: 20, marginBottom: 14, background: "var(--atlas-surface-alt)", border: "1px solid color-mix(in oklab, var(--atlas-gold) 12%, transparent)", borderRadius: 10, padding: "14px 16px" }}>
          {/* Category tags + status badge */}
          <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 10, flexWrap: "wrap" as const }}>
            <span style={{ fontSize: "var(--ts-xs)", fontFamily: "var(--app-font-mono)", letterSpacing: "0.1em", color: "rgba(var(--atlas-muted-rgb),0.45)", textTransform: "uppercase" as const }}>
              {modeLabel} · {typeLabel}
            </span>
            {entry.buildId && (
              <span style={{ fontSize: "var(--ts-xs)", fontFamily: "var(--app-font-mono)", letterSpacing: "0.06em", background: "rgba(var(--atlas-muted-rgb),0.1)", border: "0.5px solid rgba(var(--atlas-muted-rgb),0.2)", color: "rgba(var(--atlas-muted-rgb),0.65)", padding: "1px 7px", borderRadius: 10 }}>
                #{entry.buildId}
              </span>
            )}
            {entry.costOfLesson && (
              <span style={{ fontSize: "var(--ts-xs)", fontFamily: "var(--app-font-mono)", color: "rgba(var(--atlas-muted-rgb),0.55)" }}>
                cost: {entry.costOfLesson}
              </span>
            )}
            <span style={{ marginLeft: "auto", display: "flex", alignItems: "center", gap: 4, fontSize: "var(--ts-xs)", fontFamily: "var(--app-font-mono)", letterSpacing: "0.06em", background: entry.isViolation ? "rgba(239,68,68,0.08)" : "rgba(74,222,128,0.07)", border: `1px solid ${entry.isViolation ? "rgba(239,68,68,0.18)" : "rgba(74,222,128,0.18)"}`, color: entry.isViolation ? "rgba(239,68,68,0.75)" : "rgba(74,222,128,0.75)", padding: "2px 9px", borderRadius: 20, textTransform: "uppercase" as const }}>
              <span style={{ width: 5, height: 5, borderRadius: "50%", background: "currentColor", display: "inline-block" }} />
              {entry.isViolation ? "OVERRIDE" : "REVERSIBLE"}
            </span>
          </div>

          {/* Title */}
          <Link
            href={`/entry/${entry.id}`}
            onClick={(e) => e.stopPropagation()}
            style={{ display: "block", fontSize: "var(--ts-md)", fontWeight: 600, color: "var(--atlas-fg)", marginBottom: 8, lineHeight: 1.35, textDecoration: "none" }}
          >
            {entry.title}
          </Link>

          {/* Short definition (italic intro) */}
          {shortDef && (
            <div style={{ fontSize: "var(--ts-label)", color: "var(--atlas-muted)", lineHeight: 1.65, marginBottom: context ? 12 : 10, fontStyle: "italic" }}>
              {shortDef}
            </div>
          )}

          {/* WHAT IT MEANS */}
          {context && (
            <>
              <div style={{ fontSize: "var(--ts-xs)", fontFamily: "var(--app-font-mono)", letterSpacing: "0.12em", textTransform: "uppercase" as const, color: "rgba(var(--atlas-muted-rgb),0.45)", marginBottom: 5 }}>
                What it means
              </div>
              <div style={{ fontSize: "var(--ts-label)", color: "var(--atlas-muted)", lineHeight: 1.65, marginBottom: 12 }}>
                {context}
              </div>
            </>
          )}

          {/* Details toggle */}
          {hasDetails && (
            <button
              type="button"
              onClick={() => setShowDetails(v => !v)}
              style={{
                marginBottom: 10, background: "transparent", border: "none",
                cursor: "pointer", padding: 0,
                display: "flex", alignItems: "center", gap: 4,
                fontSize: "var(--ts-micro)", fontFamily: "var(--app-font-mono)", letterSpacing: "0.08em",
                color: "rgba(var(--atlas-muted-rgb),0.5)", textTransform: "uppercase" as const,
              }}
            >
              <svg width="8" height="8" viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round"
                style={{ transform: showDetails ? "rotate(180deg)" : "none", transition: "transform 160ms ease", flexShrink: 0 }}>
                <path d="M2 4l4 4 4-4" />
              </svg>
              Details
            </button>
          )}

          {/* Details panel */}
          {hasDetails && showDetails && (
            <div style={{
              marginBottom: 12,
              background: "var(--atlas-surface)",
              border: "1px solid rgba(201,162,76,0.1)",
              borderRadius: 6,
              padding: "10px 12px",
            }}>
              {entry.details && (
                <pre style={{
                  margin: 0, marginBottom: (entry.touched && entry.touched.length > 0) ? 10 : 0,
                  fontSize: "var(--ts-caption)", fontFamily: "var(--app-font-mono)",
                  color: "var(--atlas-muted)", lineHeight: 1.6,
                  whiteSpace: "pre-wrap", wordBreak: "break-word",
                }}>
                  {entry.details}
                </pre>
              )}
              {entry.touched && entry.touched.length > 0 && (
                <>
                  <div style={{ fontSize: "var(--ts-xs)", fontFamily: "var(--app-font-mono)", letterSpacing: "0.1em", textTransform: "uppercase" as const, color: "rgba(var(--atlas-muted-rgb),0.45)", marginBottom: 6 }}>
                    Touched files
                  </div>
                  <ul style={{ margin: 0, padding: 0, listStyle: "none", display: "flex", flexDirection: "column", gap: 3 }}>
                    {entry.touched.map((f, i) => (
                      <li key={i} style={{ fontSize: "var(--ts-micro)", fontFamily: "var(--app-font-mono)", color: "rgba(201,162,76,0.6)", letterSpacing: "0.03em" }}>
                        · {f}
                      </li>
                    ))}
                  </ul>
                </>
              )}
            </div>
          )}

          {/* Source */}
          <div style={{ fontSize: "var(--ts-micro)", color: "rgba(var(--atlas-muted-rgb),0.35)", fontFamily: "var(--app-font-mono)", marginBottom: 12 }}>
            chat message · {timeAgo(entry.createdAt)}
          </div>

          {/* Actions */}
          <div style={{ display: "flex", gap: 6 }}>
            <button onClick={handleResolve} disabled={done || updateEntry.isPending}
              style={{ flex: 1, padding: "7px", borderRadius: 7, fontSize: "var(--ts-micro)", fontFamily: "var(--app-font-mono)", letterSpacing: "0.06em", background: "transparent", border: "1px solid rgba(var(--atlas-muted-rgb),0.22)", color: "var(--atlas-muted)", cursor: done ? "default" : "pointer", transition: "all 150ms ease" }}
              onMouseEnter={(e) => { if (!done) e.currentTarget.style.borderColor = "rgba(var(--atlas-muted-rgb),0.5)"; }}
              onMouseLeave={(e) => { e.currentTarget.style.borderColor = "rgba(var(--atlas-muted-rgb),0.22)"; }}
            >Resolve</button>
            <button onClick={handleCommit} disabled={done || updateEntry.isPending}
              style={{ flex: 1, padding: "7px", borderRadius: 7, fontSize: "var(--ts-micro)", fontFamily: "var(--app-font-mono)", letterSpacing: "0.06em", background: "rgba(201,162,76,0.08)", border: "1px solid rgba(201,162,76,0.2)", color: "var(--atlas-gold)", cursor: done ? "default" : "pointer", transition: "all 150ms ease" }}
              onMouseEnter={(e) => { if (!done) e.currentTarget.style.background = "rgba(201,162,76,0.15)"; }}
              onMouseLeave={(e) => { e.currentTarget.style.background = "rgba(201,162,76,0.08)"; }}
            >Commit</button>
          </div>
        </div>
      )}
    </div>
  );
}
