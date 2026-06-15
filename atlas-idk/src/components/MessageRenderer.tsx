// ─────────────────────────────────────────────────────────────────────────────
// MessageRenderer.tsx
// Four rich text components recovered from commit b854dcc
// CSS variables mapped to Axiom --atlas-* tokens.
// ─────────────────────────────────────────────────────────────────────────────

import {
  Children,
  cloneElement,
  isValidElement,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import ReactMarkdown from "react-markdown";

// ── Patterns ──────────────────────────────────────────────────────────────────
const FILE_PILL_PATTERN = /(\b[\w-]+\.(?:tsx|ts|js|jsx|css|json|md|sql)\b)/gi;
const FILE_PILL_EXACT_PATTERN = /^\b[\w-]+\.(?:tsx|ts|js|jsx|css|json|md|sql)\b$/i;

// ── Helpers ───────────────────────────────────────────────────────────────────

function renderMarkdownChildren(children: ReactNode): ReactNode {
  return Children.map(children, (child) => {
    if (typeof child === "string") {
      const parts = child.split(FILE_PILL_PATTERN);
      return parts.map((part, index) =>
        FILE_PILL_EXACT_PATTERN.test(part) ? (
          <span
            key={`${part}-${index}`}
            className="rounded px-1.5 py-0.5 font-mono text-[12px]"
            style={{
              background: "var(--atlas-surface)",
              border: "0.5px solid var(--atlas-border)",
              color: "var(--atlas-muted)",
            }}
          >
            {part}
          </span>
        ) : (
          part
        ),
      );
    }
    if (isValidElement<{ children?: ReactNode }>(child)) {
      return cloneElement(child, {
        children: renderMarkdownChildren(child.props.children),
      });
    }
    return child;
  });
}

function extractText(node: ReactNode): string {
  if (node === null || node === undefined || node === false) return "";
  if (typeof node === "string" || typeof node === "number") return String(node);
  if (Array.isArray(node)) return node.map(extractText).join("");
  if (isValidElement<{ children?: ReactNode }>(node)) return extractText(node.props.children);
  return "";
}

// ── CodeBlockCard ─────────────────────────────────────────────────────────────

export function CodeBlockCard({ language, code }: { language: string; code: string }) {
  const [copied, setCopied] = useState(false);
  const [expanded, setExpanded] = useState(false);
  const PREVIEW_LINES = 8;
  const codeContent = code ?? "";
  const lines = codeContent ? codeContent.split("\n") : [];
  const lineCount = lines.length;
  const isOverflow = lineCount > PREVIEW_LINES;
  const visibleCode = !isOverflow || expanded
    ? codeContent
    : lines.slice(0, PREVIEW_LINES).join("\n");
  const hiddenCount = isOverflow && !expanded ? lineCount - PREVIEW_LINES : 0;
  const label = language ? language.toUpperCase() : "CODE";

  const onCopy = async () => {
    try {
      await navigator.clipboard.writeText(codeContent);
      setCopied(true);
      setTimeout(() => setCopied(false), 1400);
    } catch {
      // clipboard unavailable
    }
  };

  return (
    <div
      className="mb-3 overflow-hidden rounded-lg"
      style={{
        background: "var(--atlas-surface)",
        border: "0.5px solid var(--atlas-border)",
      }}
    >
      <div
        className="flex items-center justify-between px-3 py-2"
        style={{
          borderBottom: "0.5px solid var(--atlas-border)",
          background: "color-mix(in oklab, var(--atlas-gold) 4%, transparent)",
        }}
      >
        <span
          className="font-mono"
          style={{ fontSize: 10, letterSpacing: "0.12em", color: "var(--atlas-gold)" }}
        >
          {label} · {lineCount} {lineCount === 1 ? "line" : "lines"}
        </span>
        <button
          type="button"
          onClick={onCopy}
          className="inline-flex items-center gap-1 rounded px-2 py-0.5 font-mono"
          style={{
            fontSize: 10,
            letterSpacing: "0.1em",
            textTransform: "uppercase",
            background: "transparent",
            border: "0.5px solid var(--atlas-border)",
            color: copied ? "var(--atlas-gold)" : "var(--atlas-muted)",
            cursor: "pointer",
            transition: "all var(--motion-fast) var(--ease-standard)",
          }}
        >
          {copied ? "Copied" : "Copy"}
        </button>
      </div>
      <div style={{ position: "relative" }}>
        <pre
          className="overflow-x-auto p-3 font-mono text-[13px] leading-relaxed"
          style={{ margin: 0, color: "var(--atlas-fg)", background: "transparent" }}
        >
          <code>{visibleCode}</code>
        </pre>
        {isOverflow && !expanded && (
          <div
            aria-hidden
            style={{
              position: "absolute",
              left: 0, right: 0, bottom: 0, height: 36,
              pointerEvents: "none",
              background: "linear-gradient(to bottom, transparent, var(--atlas-surface))",
            }}
          />
        )}
      </div>
      {isOverflow && (
        <button
          type="button"
          onClick={() => setExpanded((v) => !v)}
          className="w-full font-mono"
          style={{
            padding: "8px 12px",
            background: "transparent",
            border: "none",
            borderTop: "0.5px solid var(--atlas-border)",
            color: "var(--atlas-gold)",
            fontSize: 10,
            letterSpacing: "0.14em",
            textTransform: "uppercase",
            cursor: "pointer",
            display: "inline-flex",
            alignItems: "center",
            justifyContent: "center",
            gap: 6,
          }}
        >
          {expanded
            ? "Collapse"
            : `Expand · +${hiddenCount} more line${hiddenCount === 1 ? "" : "s"}`}
        </button>
      )}
    </div>
  );
}

// ── MarkdownProse ─────────────────────────────────────────────────────────────

export function MarkdownProse({ content }: { content: string }) {
  return (
    <div
      className="atlas-prose"
      style={{
        color: "var(--atlas-fg)",
        maxWidth: "74ch",
        fontSize: 16,
        lineHeight: 1.85,
        letterSpacing: "-0.005em",
        overflowWrap: "anywhere",
        wordBreak: "break-word",
        minWidth: 0,
      }}
    >
      <ReactMarkdown
        components={{
          p: ({ children }) => (
            <p
              className="text-[16px]"
              style={{
                color: "var(--atlas-fg)",
                lineHeight: 1.85,
                marginBottom: "1.25em",
              }}
            >
              {renderMarkdownChildren(children)}
            </p>
          ),
          strong: ({ children }) => (
            <strong className="font-semibold" style={{ color: "var(--atlas-fg)" }}>
              {renderMarkdownChildren(children)}
            </strong>
          ),
          code: ({ children, className }) => {
            const isBlock = Boolean(className);
            if (isBlock) {
              return (
                <code
                  className={`${className ?? ""} block whitespace-pre-wrap font-mono text-[13px]`}
                  style={{ color: "var(--atlas-fg)" }}
                >
                  {children}
                </code>
              );
            }
            return (
              <code
                className="rounded px-1.5 py-0.5 font-mono text-[13px]"
                style={{
                  background: "var(--atlas-surface)",
                  color: "var(--atlas-fg)",
                  border: "0.5px solid var(--atlas-border)",
                }}
              >
                {children}
              </code>
            );
          },
          pre: ({ children }) => {
            let lang = "code";
            let raw = "";
            const childArray = Children.toArray(children);
            for (const c of childArray) {
              if (isValidElement<{ className?: string; children?: ReactNode }>(c)) {
                const cls = c.props.className ?? "";
                const m = /language-([\w+-]+)/.exec(cls);
                if (m) lang = m[1];
                raw += extractText(c.props.children);
              } else if (typeof c === "string") {
                raw += c;
              }
            }
            return <CodeBlockCard language={lang} code={raw.replace(/\n+$/, "")} />;
          },
          ul: ({ children }) => (
            <ul className="ml-4 list-disc" style={{ marginBottom: "1em", display: "flex", flexDirection: "column", gap: "0.5em" }}>{children}</ul>
          ),
          ol: ({ children }) => (
            <ol className="ml-4 list-decimal" style={{ marginBottom: "1em", display: "flex", flexDirection: "column", gap: "0.5em" }}>{children}</ol>
          ),
          li: ({ children }) => (
            <li className="text-[16px]" style={{ color: "var(--atlas-fg)", lineHeight: 1.8 }}>
              {renderMarkdownChildren(children)}
            </li>
          ),
        }}
      >
        {content}
      </ReactMarkdown>
    </div>
  );
}

// ── ArchiveSummaryCard ────────────────────────────────────────────────────────

export function ArchiveSummaryCard({
  archives,
  content,
}: {
  archives: string[];
  content: string;
}) {
  const sections = useMemo(() => {
    const out: Record<string, string> = {
      Uploaded: "",
      Touches: "",
      Drift: "",
      Question: "",
    };
    const re = /^###\s+(Uploaded|Touches|Drift|Question)\s*$/gim;
    const matches: Array<{ key: string; start: number; end: number }> = [];
    let m: RegExpExecArray | null;
    while ((m = re.exec(content)) !== null) {
      matches.push({ key: m[1], start: m.index + m[0].length, end: content.length });
    }
    for (let i = 0; i < matches.length; i++) {
      if (i + 1 < matches.length) {
        matches[i].end =
          matches[i + 1].start - matches[i + 1].key.length - 4;
      }
      out[matches[i].key] = content.slice(matches[i].start, matches[i].end).trim();
    }
    return out;
  }, [content]);

  const hasAnySection = Object.values(sections).some((v) => v.trim().length > 0);

  return (
    <div
      className="mb-3 overflow-hidden rounded-2xl"
      style={{
        background: "color-mix(in oklab, var(--atlas-gold) 3%, var(--atlas-bg))",
        border: "0.5px solid color-mix(in oklab, var(--atlas-gold) 28%, var(--atlas-border))",
        boxShadow: "0 8px 32px -16px rgba(0,0,0,0.4)",
      }}
    >
      <div
        className="flex items-center justify-between px-4 py-2.5"
        style={{
          borderBottom: "0.5px solid color-mix(in oklab, var(--atlas-gold) 18%, var(--atlas-border))",
          background: "color-mix(in oklab, var(--atlas-gold) 6%, transparent)",
        }}
      >
        <span
          className="font-mono"
          style={{
            fontSize: 10,
            letterSpacing: "0.14em",
            textTransform: "uppercase",
            color: "var(--atlas-gold)",
          }}
        >
          Context Ingestion
        </span>
        <span
          className="font-mono"
          style={{
            fontSize: 10,
            color: "var(--atlas-muted)",
            letterSpacing: "0.06em",
            maxWidth: "60%",
            overflow: "hidden",
            textOverflow: "ellipsis",
            whiteSpace: "nowrap",
          }}
        >
          {archives.join(", ")}
        </span>
      </div>
      <div className="px-4 py-4">
        {hasAnySection ? (
          <div className="space-y-4">
            {(["Uploaded", "Touches", "Drift", "Question"] as const).map((key) =>
              sections[key].trim() ? (
                <div key={key}>
                  <div
                    className="font-mono mb-1.5"
                    style={{
                      fontSize: 10,
                      letterSpacing: "0.14em",
                      textTransform: "uppercase",
                      color:
                        key === "Drift"
                          ? "color-mix(in oklab, var(--atlas-gold) 80%, #d97757)"
                          : "var(--atlas-gold)",
                    }}
                  >
                    {key}
                  </div>
                  <MarkdownProse content={sections[key]} />
                </div>
              ) : null,
            )}
          </div>
        ) : (
          <MarkdownProse content={content} />
        )}
      </div>
    </div>
  );
}

// ── StreamingMarkdown ─────────────────────────────────────────────────────────

export function StreamingMarkdown({
  content,
  speed = 30,
  onComplete,
}: {
  content: string;
  speed?: number;
  onComplete?: () => void;
}) {
  const words = useMemo(() => content.match(/\S+\s*/g) ?? [], [content]);
  const [visibleCount, setVisibleCount] = useState(0);
  const completeCalled = useRef(false);

  useEffect(() => {
    setVisibleCount(0);
    completeCalled.current = false;
  }, [content]);

  useEffect(() => {
    const total = words.length;
    if (visibleCount >= total) {
      if (!completeCalled.current) {
        completeCalled.current = true;
        onComplete?.();
      }
      return;
    }
    const lastWord = words[visibleCount - 1] ?? "";
    const jitter = speed * (0.6 + Math.random() * 0.8);
    const pause = /[.!?]\s*$/.test(lastWord) ? speed * 4 : jitter;
    const burst = Math.random() > 0.7 ? 2 : 1;
    const timer = setTimeout(() => {
      setVisibleCount((c) => Math.min(c + burst, total));
    }, pause);
    return () => clearTimeout(timer);
  }, [visibleCount, words, speed, onComplete]);

  const visibleText = words.slice(0, visibleCount).join("");
  const isDone = visibleCount >= words.length;

  return (
    <div style={{ position: "relative" }}>
      <MarkdownProse content={visibleText} />
      {!isDone && (
        <span
          style={{
            display: "inline-block",
            width: 6,
            height: 14,
            marginLeft: 2,
            background: "var(--atlas-gold)",
            borderRadius: 1,
            opacity: 0.7,
            animation: "atlas-cursor-blink 800ms steps(2) infinite",
            verticalAlign: "text-bottom",
          }}
        />
      )}
    </div>
  );
}
