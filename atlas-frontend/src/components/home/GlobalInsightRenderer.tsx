import { useLocation } from "wouter";

type Project = { id: number; name: string };

interface Props {
  content: string;
  projects: Project[];
  onNavigate: (projectId: number) => void;
  isParchment?: boolean;
  onCreateProject?: (nameOverride?: string) => void;
}

const FILE_PATH_RE = /`([^`]*\/[^`]+\.[a-z]{2,4})`|(?<!\w)((?:src|artifacts|packages|apps)\/[\w./-]+\.(?:tsx?|jsx?|css|json|md|ts))/g;

// Matches the verbatim fallback phrase Atlas emits after workspace creation
const FOLDER_CTA_RE = /tap the folder icon \(🗂\)[^.!?\n]*/gi;

export function GlobalInsightRenderer({ content, projects, onNavigate, isParchment, onCreateProject }: Props) {
  if (!content) return null;

  void useLocation;

  const sorted = [...projects].sort((a, b) => b.name.length - a.name.length);
  const namePattern = sorted
    .map(p => p.name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"))
    .filter(Boolean)
    .join("|");

  type Segment =
    | { type: "text"; text: string }
    | { type: "project"; text: string; projectId: number }
    | { type: "file"; text: string }
    | { type: "create"; text: string };

  const segments: Segment[] = [];

  if (!namePattern) {
    segments.push({ type: "text", text: content });
  } else {
    const combined = new RegExp(`(${namePattern})`, "gi");
    const parts = content.split(combined);
    for (const part of parts) {
      const matched = sorted.find(p => p.name.toLowerCase() === part.toLowerCase());
      if (matched) {
        segments.push({ type: "project", text: part, projectId: matched.id });
      } else {
        segments.push({ type: "text", text: part });
      }
    }
  }

  // Within text segments: find folder CTA phrase first, then file paths
  const finalSegments: Segment[] = [];
  for (const seg of segments) {
    if (seg.type !== "text") { finalSegments.push(seg); continue; }

    // Pass 1: split on folder CTA phrase (only when onCreateProject is available)
    const ctaSplit: Segment[] = [];
    if (onCreateProject) {
      FOLDER_CTA_RE.lastIndex = 0;
      const text = seg.text;
      let last = 0;
      let m: RegExpExecArray | null;
      while ((m = FOLDER_CTA_RE.exec(text)) !== null) {
        if (m.index > last) ctaSplit.push({ type: "text", text: text.slice(last, m.index) });
        ctaSplit.push({ type: "create", text: m[0] });
        last = m.index + m[0].length;
      }
      if (last < text.length) ctaSplit.push({ type: "text", text: text.slice(last) });
    } else {
      ctaSplit.push(seg);
    }

    // Pass 2: file paths inside remaining text segments
    for (const sub of ctaSplit) {
      if (sub.type !== "text") { finalSegments.push(sub); continue; }
      FILE_PATH_RE.lastIndex = 0;
      const text = sub.text;
      let last = 0;
      let m: RegExpExecArray | null;
      while ((m = FILE_PATH_RE.exec(text)) !== null) {
        if (m.index > last) finalSegments.push({ type: "text", text: text.slice(last, m.index) });
        finalSegments.push({ type: "file", text: m[1] ?? m[2] });
        last = m.index + m[0].length;
      }
      if (last < text.length) finalSegments.push({ type: "text", text: text.slice(last) });
    }
  }

  const linkColor = isParchment ? "rgba(146,64,14,0.9)" : "rgba(212,175,55,0.95)";
  const fileLinkColor = isParchment ? "rgba(100,80,14,0.75)" : "rgba(180,160,80,0.8)";

  return (
    <span style={{ whiteSpace: "pre-wrap", wordBreak: "break-word" }}>
      {finalSegments.map((seg, i) => {
        if (seg.type === "project") {
          return (
            <span
              key={i}
              role="link"
              tabIndex={0}
              onClick={() => onNavigate(seg.projectId)}
              onKeyDown={(e) => { if (e.key === "Enter") onNavigate(seg.projectId); }}
              style={{
                color: linkColor,
                textDecoration: "underline",
                textDecorationStyle: "dotted",
                textUnderlineOffset: "3px",
                cursor: "pointer",
                fontWeight: 500,
                WebkitTapHighlightColor: "transparent",
              }}
            >
              {seg.text}
            </span>
          );
        }
        if (seg.type === "create") {
          return (
            <span
              key={i}
              role="link"
              tabIndex={0}
              onClick={() => onCreateProject?.()}
              onKeyDown={(e) => { if (e.key === "Enter") onCreateProject?.(); }}
              title="Open workspace"
              style={{
                color: linkColor,
                textDecoration: "underline",
                textDecorationStyle: "solid",
                textUnderlineOffset: "3px",
                cursor: "pointer",
                fontWeight: 600,
                WebkitTapHighlightColor: "transparent",
              }}
            >
              {seg.text}
            </span>
          );
        }
        if (seg.type === "file") {
          return (
            <span
              key={i}
              style={{
                color: fileLinkColor,
                fontFamily: "var(--app-font-mono)",
                fontSize: "0.88em",
                background: isParchment ? "rgba(180,83,9,0.06)" : "rgba(212,175,55,0.07)",
                borderRadius: 4,
                padding: "1px 4px",
                cursor: "default",
              }}
            >
              {seg.text}
            </span>
          );
        }
        return <span key={i}>{seg.text}</span>;
      })}
    </span>
  );
}
