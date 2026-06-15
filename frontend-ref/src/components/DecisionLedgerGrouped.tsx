import { useMemo } from "react";
import { Entry } from "@workspace/api-client-react";
import { relativeTime } from "../lib/atlas-utils";

export interface DecisionLedgerGroupedProps {
  entries: Entry[];
  focusId?: number;
  onFocus?: (id: number) => void;
}

interface GroupedEntries {
  committed: Entry[];
  inTension: Entry[];
  overridden: Entry[];
}

function groupEntries(entries: Entry[]): GroupedEntries {
  const childrenOf = new Map<number, Entry[]>();
  for (const e of entries) {
    if (e.supersedesId != null) {
      const arr = childrenOf.get(e.supersedesId) ?? [];
      arr.push(e);
      childrenOf.set(e.supersedesId, arr);
    }
  }

  const committed: Entry[] = [];
  const inTension: Entry[] = [];
  const overridden: Entry[] = [];

  for (const e of entries) {
    if (e.status !== "committed") continue;
    const children = childrenOf.get(e.id) ?? [];
    const hasDeviation = children.some(
      (c) => c.deviation === true && c.status === "committed",
    );
    const hasUnresolvedChild = children.some(
      (c) => c.catchAgainstId === e.id && c.status !== "committed",
    );

    if (hasDeviation) overridden.push(e);
    else if (hasUnresolvedChild) inTension.push(e);
    else committed.push(e);
  }

  return { committed, inTension, overridden };
}

export function DecisionLedgerGrouped({ entries, focusId, onFocus }: DecisionLedgerGroupedProps) {
  const groups = useMemo(() => groupEntries(entries), [entries]);

  const scrollTo = (id: number) => {
    if (onFocus) onFocus(id);
    requestAnimationFrame(() => {
      const el = document.querySelector(`[data-entry-id="${id}"]`);
      if (el) el.scrollIntoView({ behavior: "smooth", block: "center" });
    });
  };

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 18 }}>
      <Group label="Committed" accent="var(--phosphor)" entries={groups.committed} focusId={focusId} onSelect={scrollTo} emptyHint="Nothing locked in yet." />
      <Group label="In Tension" accent="var(--ember)" entries={groups.inTension} focusId={focusId} onSelect={scrollTo} emptyHint="No open tensions." />
      <Group label="Overridden" accent="var(--muted-text)" entries={groups.overridden} focusId={focusId} onSelect={scrollTo} emptyHint="Nothing overridden." />
    </div>
  );
}

interface GroupProps {
  label: string;
  accent: string;
  entries: Entry[];
  focusId?: number;
  onSelect: (id: number) => void;
  emptyHint: string;
}

function Group({ label, accent, entries, focusId, onSelect, emptyHint }: GroupProps) {
  return (
    <section>
      <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 8, padding: "0 2px" }}>
        <span aria-hidden style={{ width: 6, height: 6, borderRadius: 999, background: accent }} />
        <span style={{ fontFamily: "var(--font-mono)", fontSize: 10, letterSpacing: "0.14em", textTransform: "uppercase" as const, color: accent }}>
          {label}
        </span>
        <span style={{ fontFamily: "var(--font-mono)", fontSize: 10, letterSpacing: "0.06em", color: "var(--muted-text)", marginLeft: "auto" }}>
          {entries.length}
        </span>
      </div>

      {entries.length === 0 ? (
        <div style={{ fontSize: 12, fontStyle: "italic" as const, color: "var(--muted-text)", padding: "6px 2px" }}>
          {emptyHint}
        </div>
      ) : (
        <ul style={{ listStyle: "none", margin: 0, padding: 0, display: "flex", flexDirection: "column", gap: 4 }}>
          {entries.map((e) => (
            <li key={e.id}>
              <button
                type="button"
                data-entry-id={e.id}
                onClick={() => onSelect(e.id)}
                style={{
                  display: "flex",
                  alignItems: "baseline",
                  gap: 8,
                  padding: "8px 10px",
                  borderRadius: 6,
                  background: focusId === e.id ? "var(--surface-alt)" : "transparent",
                  border: focusId === e.id ? `1px solid ${accent}` : "1px solid transparent",
                  width: "100%",
                  textAlign: "left" as const,
                  cursor: "pointer",
                  font: "inherit",
                  color: "inherit",
                  transition: "all 140ms ease",
                }}
              >
                <span style={{ fontSize: 13, color: "var(--foreground)", flex: 1, minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" as const, letterSpacing: "-0.005em" }}>
                  {e.title}
                </span>
                <span style={{ fontFamily: "var(--font-mono)", fontSize: 9.5, letterSpacing: "0.06em", color: "var(--muted-text)", flexShrink: 0 }}>
                  {relativeTime(e.createdAt)}
                </span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
