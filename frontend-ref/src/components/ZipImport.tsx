// ZIP drag-and-drop import for Atlas workspace
// Parses a ZIP archive client-side, lets the user select files,
// and assembles the contents as a fileContext string for the chat API.

export interface ZipEntry {
  path: string;
  content: string;
  lines: number;
  selected: boolean;
}

// ── Filtering helpers ────────────────────────────────────────────────────────

const SKIP_RE = [
  /node_modules\//,
  /\.git\//,
  /(^|\/)dist\//,
  /(^|\/)build\//,
  /(^|\/)\.next\//,
  /(^|\/)\.nuxt\//,
  /(^|\/)coverage\//,
  /\.DS_Store/,
  /package-lock\.json$/,
  /pnpm-lock\.yaml$/,
  /yarn\.lock$/,
  /\.min\.js$/,
  /\.map$/,
  /\.ico$/,
  /\.png$/,
  /\.jpe?g$/,
  /\.gif$/,
  /\.webp$/,
  /\.svg$/,
  /\.woff2?$/,
  /\.ttf$/,
  /\.eot$/,
];

const TEXT_EXTS = new Set([
  "ts","tsx","js","jsx","mjs","cjs",
  "json","jsonc","json5",
  "css","scss","sass","less","styl",
  "html","htm",
  "md","mdx","txt","env","example","gitignore",
  "yaml","yml","toml","ini","cfg",
  "py","rb","go","rs","java","c","cpp","h","hpp","cs","php","swift","kt",
  "sh","bash","zsh","fish","ps1",
  "sql","graphql","gql",
  "prisma","vue","svelte","astro",
  "xml","csv",
]);

const TEXT_NAMES = new Set(["Makefile","Dockerfile","Procfile","Gemfile","Rakefile",".env",".envrc"]);

function isText(path: string) {
  const name = path.split("/").pop() ?? "";
  if (TEXT_NAMES.has(name)) return true;
  const dot = name.lastIndexOf(".");
  if (dot < 0) return false;
  return TEXT_EXTS.has(name.slice(dot + 1).toLowerCase());
}

function shouldSkip(path: string) {
  return SKIP_RE.some((r) => r.test(path));
}

// Max lines per file — larger files are truncated to keep context manageable
const MAX_LINES_PER_FILE = 300;
// Max total chars — we warn and trim after this
const MAX_TOTAL_CHARS = 60_000;

// ── ZIP parser ────────────────────────────────────────────────────────────────

export async function parseZip(file: File): Promise<{ entries: ZipEntry[]; truncated: boolean }> {
  const JSZip = (await import("jszip")).default;
  const zip = await JSZip.loadAsync(file);

  const results: ZipEntry[] = [];

  await Promise.all(
    Object.keys(zip.files).map(async (rawPath) => {
      // Strip leading component that's often the ZIP root folder name
      const path = rawPath.replace(/^[^/]+\//, "");
      if (!path) return;
      const entry = zip.files[rawPath];
      if (entry.dir) return;
      if (shouldSkip(path)) return;
      if (!isText(path)) return;
      try {
        const raw = await entry.async("text");
        const lines = raw.split("\n");
        const truncated = lines.length > MAX_LINES_PER_FILE;
        const content = truncated ? lines.slice(0, MAX_LINES_PER_FILE).join("\n") + "\n… (truncated)" : raw;
        results.push({ path, content, lines: lines.length, selected: true });
      } catch {
        // binary or encoding error — skip silently
      }
    })
  );

  results.sort((a, b) => a.path.localeCompare(b.path));

  // Check total size
  const totalChars = results.reduce((s, e) => s + e.content.length, 0);
  return { entries: results, truncated: totalChars > MAX_TOTAL_CHARS };
}

export function assembleContext(zipName: string, entries: ZipEntry[]): string | null {
  const selected = entries.filter((e) => e.selected);
  if (selected.length === 0) return null;
  const blocks = selected.map((e) => `=== ${e.path} (${e.lines} lines) ===\n${e.content}`);
  return `[ZIP: ${zipName} — ${selected.length} file${selected.length === 1 ? "" : "s"}]\n\n${blocks.join("\n\n")}`;
}

// ── ZipDragOverlay ────────────────────────────────────────────────────────────

export function ZipDragOverlay({ visible }: { visible: boolean }) {
  if (!visible) return null;
  return (
    <div
      style={{
        position: "absolute", inset: 0, zIndex: 300,
        background: "var(--atlas-surface)",
        backdropFilter: "blur(6px)",
        display: "flex", flexDirection: "column",
        alignItems: "center", justifyContent: "center", gap: 16,
        border: "2px dashed rgba(201,162,76,0.5)",
        borderRadius: 12, pointerEvents: "none",
        animation: "atlas-bubble-in 180ms ease both",
      }}
    >
      <div style={{
        width: 56, height: 56, borderRadius: 14,
        background: "rgba(201,162,76,0.08)", border: "1px solid rgba(201,162,76,0.3)",
        display: "flex", alignItems: "center", justifyContent: "center",
      }}>
        <svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="rgba(201,162,76,0.9)" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
          <path d="M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4" />
          <polyline points="17 8 12 3 7 8" />
          <line x1="12" y1="3" x2="12" y2="15" />
        </svg>
      </div>
      <div style={{ fontFamily: "var(--app-font-mono)", fontSize: 13, color: "rgba(201,162,76,0.9)", letterSpacing: "0.06em", textTransform: "uppercase" }}>
        Drop ZIP to load project
      </div>
      <div style={{ fontSize: 11, color: "rgba(120,113,108,0.6)", fontFamily: "var(--app-font-sans)" }}>
        Text files will be read into context
      </div>
    </div>
  );
}

// ── ZipPanel ─────────────────────────────────────────────────────────────────

interface ZipPanelProps {
  zipName: string;
  entries: ZipEntry[];
  truncated: boolean;
  onToggle: (path: string) => void;
  onSelectAll: () => void;
  onDeselectAll: () => void;
  onClear: () => void;
}

export function ZipPanel({ zipName, entries, truncated, onToggle, onSelectAll, onDeselectAll, onClear }: ZipPanelProps) {
  const selected = entries.filter((e) => e.selected).length;
  const total = entries.length;
  const [expanded, setExpanded] = useState(false);

  return (
    <div style={{
      margin: "0 0 8px 0",
      borderRadius: 8, border: "1px solid rgba(201,162,76,0.22)",
      background: "rgba(201,162,76,0.04)",
      overflow: "hidden",
    }}>
      {/* Header row */}
      <div style={{ display: "flex", alignItems: "center", gap: 8, padding: "8px 10px" }}>
        <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="rgba(201,162,76,0.8)" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
          <path d="M21 16V8a2 2 0 00-1-1.73l-7-4a2 2 0 00-2 0l-7 4A2 2 0 003 8v8a2 2 0 001 1.73l7 4a2 2 0 002 0l7-4A2 2 0 0021 16z" />
        </svg>
        <span style={{ flex: 1, fontSize: 11, fontWeight: 600, fontFamily: "var(--app-font-mono)", color: "rgba(201,162,76,0.85)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
          {zipName}
        </span>
        <span style={{
          fontSize: 9.5, fontFamily: "var(--app-font-mono)", letterSpacing: "0.06em",
          background: "rgba(201,162,76,0.1)", border: "1px solid rgba(201,162,76,0.2)",
          padding: "2px 7px", borderRadius: 10,
          color: selected > 0 ? "rgba(201,162,76,0.85)" : "rgba(120,113,108,0.5)",
        }}>
          {selected}/{total} files
        </span>
        <button
          onClick={() => setExpanded((v) => !v)}
          style={{ background: "transparent", border: "none", cursor: "pointer", padding: "2px 4px", color: "rgba(120,113,108,0.5)", display: "flex", alignItems: "center" }}
        >
          <svg width="12" height="12" viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round">
            <path d={expanded ? "M2 8l4-4 4 4" : "M2 4l4 4 4-4"} />
          </svg>
        </button>
        <button
          onClick={onClear}
          title="Remove ZIP from context"
          style={{ background: "transparent", border: "none", cursor: "pointer", padding: "2px 4px", color: "rgba(120,113,108,0.5)", display: "flex", alignItems: "center" }}
        >
          <svg width="12" height="12" viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round">
            <path d="M2 2l10 10M12 2L2 12" />
          </svg>
        </button>
      </div>

      {/* Truncation warning */}
      {truncated && (
        <div style={{ padding: "0 10px 6px", fontSize: 10, color: "rgba(251,146,60,0.7)", fontFamily: "var(--app-font-mono)" }}>
          ⚠ Some large files were truncated to 300 lines
        </div>
      )}

      {/* Expanded file list */}
      {expanded && (
        <div style={{ borderTop: "1px solid rgba(201,162,76,0.12)" }}>
          {/* Bulk actions */}
          <div style={{ display: "flex", gap: 8, padding: "6px 10px", borderBottom: "1px solid rgba(201,162,76,0.08)" }}>
            <button onClick={onSelectAll} style={bulkBtn}>All</button>
            <button onClick={onDeselectAll} style={bulkBtn}>None</button>
          </div>
          {/* File list — scrollable */}
          <div style={{ maxHeight: 180, overflowY: "auto", WebkitOverflowScrolling: "touch" }}>
            {entries.map((e) => (
              <label key={e.path} style={{ display: "flex", alignItems: "center", gap: 8, padding: "4px 10px", cursor: "pointer" }}
                onMouseEnter={(ev) => (ev.currentTarget.style.background = "rgba(201,162,76,0.04)")}
                onMouseLeave={(ev) => (ev.currentTarget.style.background = "transparent")}
              >
                <input
                  type="checkbox"
                  checked={e.selected}
                  onChange={() => onToggle(e.path)}
                  style={{ width: 12, height: 12, accentColor: "var(--atlas-gold)", flexShrink: 0 }}
                />
                <span style={{ flex: 1, fontSize: 10.5, fontFamily: "var(--app-font-mono)", color: e.selected ? "var(--atlas-fg)" : "rgba(120,113,108,0.4)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                  {e.path}
                </span>
                <span style={{ fontSize: 9.5, color: "rgba(120,113,108,0.4)", fontFamily: "var(--app-font-mono)", flexShrink: 0 }}>
                  {e.lines}L
                </span>
              </label>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

const bulkBtn: React.CSSProperties = {
  background: "transparent",
  border: "1px solid rgba(201,162,76,0.15)",
  borderRadius: 5, padding: "2px 8px",
  fontSize: 9.5, fontFamily: "var(--app-font-mono)",
  color: "rgba(201,162,76,0.6)",
  cursor: "pointer",
  letterSpacing: "0.06em",
};

// ── React import (needed for JSX) ─────────────────────────────────────────────
import { useState } from "react";
import type React from "react";
