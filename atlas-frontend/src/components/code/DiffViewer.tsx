// DiffViewer — premium, theme-consistent code diff renderer.
//
// Two input modes:
//   1. before + after strings → computes a line diff with collapsed context
//      and dual (old / new) line-number gutters.
//   2. items (pre-computed DiffItem[]) → renders as given; gutters fall back
//      to running counters per side. Use this when callers already have a
//      filtered/synthesised diff (e.g. AssistantBubble's previewLines).
//
// Aesthetic notes:
//   • Added lines: deep glass-green tint via --atlas-phosphor (low alpha).
//   • Removed lines: muted wine/amber-red via --atlas-ember (low alpha).
//   • Gutter is mono, dim, with a subtle inner border. No neon defaults.

import { useEffect, useMemo, useState } from "react";
import {
  collapseDiff,
  computeLineDiff,
  type DiffItem,
} from "@/components/workspace/chatShared";
import {
  langFromFilename,
  tokenizeLines,
  type HighlightedLine,
  type ShikiLang,
} from "@/lib/shikiHighlight";

export type DiffViewMode = "inline" | "split";

export interface DiffViewerProps {
  /** Optional filename shown in the header strip. Hidden if omitted. */
  filename?: string;
  /** Original file contents. Required when `items` is not provided. */
  before?: string;
  /** New file contents. Required when `items` is not provided. */
  after?: string;
  /** Pre-computed diff. Takes precedence over before/after. */
  items?: DiffItem[];
  /** Inline (default) or side-by-side split. */
  viewMode?: DiffViewMode;
  /** Show old/new line-number gutters. Defaults to true. */
  showLineNumbers?: boolean;
  /** Max body height before vertical scroll. Defaults to 320. */
  maxHeight?: number;
  /** Optional context-line window for collapsing unchanged regions. */
  contextLines?: number;
  /** Optional badge text (e.g. "New file"). */
  badge?: string;
  /** Force a language; otherwise inferred from filename. */
  language?: ShikiLang;
}

type NumberedItem =
  | { type: "added" | "removed" | "context"; line: string; oldNo: number | null; newNo: number | null }
  | { type: "ellipsis"; count: number };

function annotate(items: DiffItem[]): NumberedItem[] {
  let oldNo = 0;
  let newNo = 0;
  return items.map((it) => {
    if (it.type === "ellipsis") {
      oldNo += it.count;
      newNo += it.count;
      return { type: "ellipsis", count: it.count };
    }
    if (it.type === "added") {
      newNo += 1;
      return { type: "added", line: it.line, oldNo: null, newNo };
    }
    if (it.type === "removed") {
      oldNo += 1;
      return { type: "removed", line: it.line, oldNo, newNo: null };
    }
    oldNo += 1;
    newNo += 1;
    return { type: "context", line: it.line, oldNo, newNo };
  });
}

const ROW_PAD = "1px 8px 1px 6px";

export function DiffViewer({
  filename,
  before,
  after,
  items,
  viewMode = "inline",
  showLineNumbers = true,
  maxHeight = 320,
  contextLines = 3,
  badge,
  language,
}: DiffViewerProps) {
  const lang = language ?? langFromFilename(filename);

  const annotated = useMemo<NumberedItem[]>(() => {
    if (items && items.length > 0) return annotate(items);
    const a = before ?? "";
    const b = after ?? "";
    const diff = computeLineDiff(a, b);
    return annotate(collapseDiff(diff, contextLines));
  }, [items, before, after, contextLines]);

  // Shiki: tokenize before/after once each. Falls back to plain text when
  // unsupported (lang === "txt") or when the items mode is in use.
  const [beforeTokens, setBeforeTokens] = useState<HighlightedLine[] | null>(null);
  const [afterTokens, setAfterTokens] = useState<HighlightedLine[] | null>(null);
  useEffect(() => {
    if (items && items.length > 0) { setBeforeTokens(null); setAfterTokens(null); return; }
    let cancelled = false;
    void (async () => {
      const [bt, at] = await Promise.all([
        before ? tokenizeLines(before, lang) : Promise.resolve(null),
        after ? tokenizeLines(after, lang) : Promise.resolve(null),
      ]);
      if (cancelled) return;
      setBeforeTokens(bt);
      setAfterTokens(at);
    })();
    return () => { cancelled = true; };
  }, [before, after, lang, items]);

  const totals = useMemo(() => {
    let added = 0;
    let removed = 0;
    annotated.forEach((it) => {
      if (it.type === "added") added += 1;
      else if (it.type === "removed") removed += 1;
    });
    return { added, removed };
  }, [annotated]);

  const isNewFile = (before === undefined || before === "") && !items;

  return (
    <div
      style={{
        borderRadius: 7,
        overflow: "hidden",
        border: "1px solid var(--atlas-border)",
        background: "color-mix(in oklab, var(--atlas-bg) 92%, black 8%)",
        fontFamily: "var(--app-font-mono)",
        fontSize: 10.5,
        lineHeight: 1.55,
      }}
    >
      {(filename || badge || totals.added || totals.removed) && (
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: 10,
            padding: "7px 11px",
            background: "color-mix(in oklab, var(--atlas-bg) 80%, black 20%)",
            borderBottom: "1px solid var(--atlas-border)",
          }}
        >
          {filename && (
            <span
              style={{
                flex: 1,
                minWidth: 0,
                fontSize: 11,
                color: "var(--atlas-fg)",
                overflow: "hidden",
                textOverflow: "ellipsis",
                whiteSpace: "nowrap",
              }}
            >
              {filename}
            </span>
          )}
          {badge && (
            <span
              style={{
                fontSize: 9.5,
                letterSpacing: "0.08em",
                textTransform: "uppercase",
                padding: "2px 7px",
                borderRadius: 3,
                color: "var(--atlas-gold)",
                background: "rgba(201,162,76,0.08)",
                border: "1px solid rgba(201,162,76,0.25)",
              }}
            >
              {badge}
            </span>
          )}
          {(totals.added > 0 || totals.removed > 0) && (
            <span style={{ display: "inline-flex", gap: 8, fontSize: 10 }}>
              {totals.added > 0 && (
                <span style={{ color: "var(--atlas-phosphor)" }}>+{totals.added}</span>
              )}
              {totals.removed > 0 && (
                <span style={{ color: "var(--atlas-ember)" }}>−{totals.removed}</span>
              )}
            </span>
          )}
        </div>
      )}

      <div style={{ maxHeight, overflow: "auto" }}>
        {isNewFile && (
          <div
            style={{
              padding: "5px 10px",
              fontSize: 10,
              color: "color-mix(in oklab, var(--atlas-phosphor) 70%, var(--atlas-fg))",
              background: "color-mix(in oklab, var(--atlas-phosphor) 6%, transparent)",
              borderBottom: "1px solid color-mix(in oklab, var(--atlas-phosphor) 18%, transparent)",
            }}
          >
            New file
          </div>
        )}
        {viewMode === "inline"
          ? renderInline(annotated, showLineNumbers, beforeTokens, afterTokens)
          : renderSplit(annotated, showLineNumbers, beforeTokens, afterTokens)}
      </div>
    </div>
  );
}

function gutterCell(value: number | null | string, opts?: { dim?: boolean }) {
  return (
    <span
      style={{
        display: "inline-block",
        width: 32,
        flexShrink: 0,
        textAlign: "right",
        padding: "1px 6px 1px 0",
        color: "color-mix(in oklab, var(--atlas-muted) 80%, transparent)",
        opacity: opts?.dim ? 0.45 : 0.75,
        userSelect: "none",
        fontSize: 9.5,
      }}
    >
      {value ?? ""}
    </span>
  );
}

function renderTokenLine(
  raw: string,
  tokens: HighlightedLine | undefined,
  fallbackColor: string,
) {
  if (!tokens || tokens.length === 0) {
    return <span style={{ color: fallbackColor }}>{raw || " "}</span>;
  }
  return (
    <>
      {tokens.map((t, i) => (
        <span key={i} style={{ color: t.color ?? fallbackColor }}>{t.content}</span>
      ))}
    </>
  );
}

function tokensFor(
  item: Exclude<NumberedItem, { type: "ellipsis" }>,
  beforeTokens: HighlightedLine[] | null,
  afterTokens: HighlightedLine[] | null,
  side: "old" | "new",
): HighlightedLine | undefined {
  if (item.type === "added") return afterTokens?.[(item.newNo ?? 0) - 1];
  if (item.type === "removed") return beforeTokens?.[(item.oldNo ?? 0) - 1];
  // context — prefer the requested side
  const idx = (side === "old" ? item.oldNo : item.newNo) ?? 0;
  const src = side === "old" ? beforeTokens : afterTokens;
  return src?.[idx - 1];
}

function renderInline(
  items: NumberedItem[],
  showLineNumbers: boolean,
  beforeTokens: HighlightedLine[] | null,
  afterTokens: HighlightedLine[] | null,
) {
  return items.map((item, idx) => {
    if (item.type === "ellipsis") {
      return (
        <div
          key={`e-${idx}`}
          style={{
            padding: "3px 10px",
            background: "rgba(0,0,0,0.18)",
            color: "color-mix(in oklab, var(--atlas-muted) 60%, transparent)",
            fontSize: 9.5,
            letterSpacing: "0.04em",
            borderTop: "1px solid rgba(255,255,255,0.03)",
            borderBottom: "1px solid rgba(255,255,255,0.03)",
          }}
        >
          ···  {item.count} unchanged {item.count === 1 ? "line" : "lines"}
        </div>
      );
    }
    const added = item.type === "added";
    const removed = item.type === "removed";
    const tintBg = added
      ? "color-mix(in oklab, var(--atlas-phosphor) 10%, transparent)"
      : removed
      ? "color-mix(in oklab, var(--atlas-ember) 10%, transparent)"
      : "transparent";
    const accent = added
      ? "var(--atlas-phosphor)"
      : removed
      ? "var(--atlas-ember)"
      : "transparent";
    const fallbackFg = added
      ? "color-mix(in oklab, var(--atlas-phosphor) 55%, var(--atlas-fg))"
      : removed
      ? "color-mix(in oklab, var(--atlas-ember) 55%, var(--atlas-fg))"
      : "var(--atlas-muted)";
    const toks = tokensFor(item, beforeTokens, afterTokens, removed ? "old" : "new");
    return (
      <div
        key={`${idx}-${item.type}`}
        style={{
          display: "flex",
          alignItems: "flex-start",
          background: tintBg,
          borderLeft: `2px solid ${accent === "transparent" ? "transparent" : `color-mix(in oklab, ${accent} 60%, transparent)`}`,
        }}
      >
        {showLineNumbers && (
          <span style={{ display: "inline-flex", borderRight: "1px solid color-mix(in oklab, var(--atlas-border) 80%, transparent)" }}>
            {gutterCell(item.oldNo, { dim: !item.oldNo })}
            {gutterCell(item.newNo, { dim: !item.newNo })}
          </span>
        )}
        <span
          style={{
            width: 16,
            flexShrink: 0,
            textAlign: "center",
            color: accent === "transparent" ? "transparent" : accent,
            opacity: 0.85,
            userSelect: "none",
          }}
        >
          {added ? "+" : removed ? "−" : " "}
        </span>
        <span style={{ flex: 1, padding: ROW_PAD, whiteSpace: "pre", overflowX: "auto" }}>
          {renderTokenLine(item.line, toks, fallbackFg)}
        </span>
      </div>
    );
  });
}

function renderSplit(
  items: NumberedItem[],
  showLineNumbers: boolean,
  beforeTokens: HighlightedLine[] | null,
  afterTokens: HighlightedLine[] | null,
) {
  type Row = { left: NumberedItem | null; right: NumberedItem | null; ellipsis?: number };
  const rows: Row[] = [];
  let i = 0;
  while (i < items.length) {
    const it = items[i];
    if (it.type === "ellipsis") {
      rows.push({ left: null, right: null, ellipsis: it.count });
      i++;
      continue;
    }
    if (it.type === "context") {
      rows.push({ left: it, right: it });
      i++;
      continue;
    }
    const removed: NumberedItem[] = [];
    const added: NumberedItem[] = [];
    while (i < items.length && items[i].type === "removed") { removed.push(items[i]); i++; }
    while (i < items.length && items[i].type === "added") { added.push(items[i]); i++; }
    const len = Math.max(removed.length, added.length, 1);
    for (let k = 0; k < len; k++) {
      rows.push({ left: removed[k] ?? null, right: added[k] ?? null });
    }
  }

  const cell = (it: NumberedItem | null, side: "left" | "right") => {
    if (!it || it.type === "ellipsis") {
      return (
        <div style={{ flex: 1, minWidth: 0, display: "flex", borderLeft: "2px solid transparent" }}>
          {showLineNumbers && <span style={{ display: "inline-flex" }}>{gutterCell(null, { dim: true })}</span>}
          <span style={{ width: 16, flexShrink: 0 }} />
          <span style={{ flex: 1, padding: ROW_PAD, color: "var(--atlas-muted)", opacity: 0.3 }}> </span>
        </div>
      );
    }
    const added = it.type === "added";
    const removed = it.type === "removed";
    const tintBg = added
      ? "color-mix(in oklab, var(--atlas-phosphor) 10%, transparent)"
      : removed
      ? "color-mix(in oklab, var(--atlas-ember) 10%, transparent)"
      : "transparent";
    const accent = added
      ? "var(--atlas-phosphor)"
      : removed
      ? "var(--atlas-ember)"
      : "transparent";
    const fg = added
      ? "color-mix(in oklab, var(--atlas-phosphor) 55%, var(--atlas-fg))"
      : removed
      ? "color-mix(in oklab, var(--atlas-ember) 55%, var(--atlas-fg))"
      : "var(--atlas-muted)";
    const num = side === "left" ? it.oldNo : it.newNo;
    const toks = tokensFor(it, beforeTokens, afterTokens, side === "left" ? "old" : "new");
    return (
      <div
        style={{
          flex: 1,
          minWidth: 0,
          display: "flex",
          alignItems: "flex-start",
          background: tintBg,
          borderLeft: `2px solid ${accent === "transparent" ? "transparent" : `color-mix(in oklab, ${accent} 60%, transparent)`}`,
        }}
      >
        {showLineNumbers && (
          <span style={{ display: "inline-flex", borderRight: "1px solid color-mix(in oklab, var(--atlas-border) 80%, transparent)" }}>
            {gutterCell(num, { dim: num === null })}
          </span>
        )}
        <span style={{ width: 16, flexShrink: 0, textAlign: "center", color: accent === "transparent" ? "transparent" : accent, opacity: 0.85, userSelect: "none" }}>
          {added ? "+" : removed ? "−" : " "}
        </span>
        <span style={{ flex: 1, padding: ROW_PAD, whiteSpace: "pre", overflowX: "auto" }}>
          {renderTokenLine(it.line, toks, fg)}
        </span>
      </div>
    );
  };

  return rows.map((row, idx) => {
    if (row.ellipsis) {
      return (
        <div
          key={`e-${idx}`}
          style={{
            padding: "3px 10px",
            background: "rgba(0,0,0,0.18)",
            color: "color-mix(in oklab, var(--atlas-muted) 60%, transparent)",
            fontSize: 9.5,
            letterSpacing: "0.04em",
            borderTop: "1px solid rgba(255,255,255,0.03)",
            borderBottom: "1px solid rgba(255,255,255,0.03)",
          }}
        >
          ···  {row.ellipsis} unchanged {row.ellipsis === 1 ? "line" : "lines"}
        </div>
      );
    }
    return (
      <div key={`r-${idx}`} style={{ display: "flex", gap: 1, borderBottom: "1px solid color-mix(in oklab, var(--atlas-border) 40%, transparent)" }}>
        {cell(row.left, "left")}
        {cell(row.right, "right")}
      </div>
    );
  });
}

export default DiffViewer;
