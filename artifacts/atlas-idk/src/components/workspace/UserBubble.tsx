import { useState, type CSSProperties } from "react";
import { haptic } from "@/lib/long-press-tip";
import { CollapsibleMessageText } from "@/components/CollapsibleMessageText";

const ICON_TOUCH_TARGET_STYLE: CSSProperties = { minWidth: 34, minHeight: 34, padding: 6 };

function formatTimestamp(iso?: string): string {
  if (!iso) return "";
  const d = new Date(iso);
  const now = new Date();
  const diffMs = now.getTime() - d.getTime();
  const diffMin = Math.floor(diffMs / 60000);
  if (diffMin < 1) return "just now";
  if (diffMin < 60) return `${diffMin}m ago`;
  const diffH = Math.floor(diffMin / 60);
  if (diffH < 24) return `${diffH}h ago`;
  return d.toLocaleDateString("en-US", { month: "short", day: "numeric" });
}

/**
 * UserBubble — unified with home/nexus user-bubble styling.
 *
 * Visual contract (must stay in sync with src/pages/home.tsx user branch):
 *   - sans font (var(--app-font-sans)), fontSize var(--ts-body), lineHeight 1.55
 *   - gold-tinted background rgba(201,162,76,0.12) + 0.5px border
 *   - radius "12px 12px 4px 12px"
 *   - maxWidth 80%
 *   - timestamp rendered BELOW the bubble (no "YOU" chip inside)
 *
 * Workspace-only extras kept from the previous version:
 *   - collapse for long messages (> COLLAPSE_LINES rows or > COLLAPSE_CHARS chars)
 *   - hover-revealed copy + edit icon row
 */
export function UserBubble({
  content,
  sentAt,
  imageB64,
  imageMimeType,
  onCopy,
  onEdit,
}: {
  content: string;
  sentAt?: string;
  imageB64?: string;
  imageMimeType?: string;
  onCopy: () => void;
  onEdit: () => void;
}) {
  const [hov, setHov] = useState(false);
  const [copied, setCopied] = useState(false);
  const [previewOpen, setPreviewOpen] = useState(false);

  const imageUrl = imageB64
    ? `data:${imageMimeType || "image/png"};base64,${imageB64}`
    : null;

  const handleCopy = () => {
    navigator.clipboard.writeText(content).catch(() => {});
    haptic.short();
    setCopied(true);
    onCopy();
    setTimeout(() => setCopied(false), 1800);
  };

  return (
    <div
      className="atlas-bubble-in"
      style={{ display: "flex", justifyContent: "flex-end", marginBottom: 18 }}
      onMouseEnter={() => setHov(true)}
      onMouseLeave={() => setHov(false)}
    >
      <div style={{ maxWidth: "80%", display: "flex", flexDirection: "column", alignItems: "flex-end", gap: 4 }}>
        {/* Bubble — home/nexus parity */}
        <div
          style={{
            position: "relative",
            padding: "9px 13px",
            borderRadius: "12px 12px 4px 12px",
            width: "100%",
            background: "rgba(201,162,76,0.12)",
            border: "0.5px solid rgba(201,162,76,0.3)",
          }}
        >
          <CollapsibleMessageText
            fadeFromColor="rgba(201,162,76,0.12)"
            textStyle={{
              fontSize: 16,
              lineHeight: 1.55,
              color: "var(--atlas-fg)",
              fontFamily: "var(--app-font-sans)",
              whiteSpace: "pre-wrap",
              wordBreak: "break-word",
            }}
          >
            {content}
          </CollapsibleMessageText>

          {/* Committed attachment badge — paperclip + thumbnail, opens preview */}
          {imageUrl && (
            <button
              type="button"
              onClick={() => { haptic.short(); setPreviewOpen(true); }}
              aria-label="Open attached image"
              title="View attachment"
              style={{
                marginTop: 8,
                display: "inline-flex",
                alignItems: "center",
                gap: 6,
                padding: "3px 7px 3px 4px",
                borderRadius: 999,
                background: "rgba(201,162,76,0.08)",
                border: "0.5px solid rgba(201,162,76,0.25)",
                cursor: "pointer",
                color: "var(--atlas-gold)",
                fontFamily: "var(--app-font-mono)",
                fontSize: 10,
                letterSpacing: "0.06em",
                lineHeight: 1,
              }}
            >
              <img
                src={imageUrl}
                alt=""
                style={{
                  width: 22, height: 22, borderRadius: 4, objectFit: "cover",
                  flexShrink: 0, display: "block",
                }}
              />
              <svg width="10" height="10" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
                <path d="M13 7.5l-5 5a3 3 0 01-4.24-4.24l6-6a2 2 0 012.83 2.83l-6 6a1 1 0 11-1.41-1.41L9.5 5" />
              </svg>
            </button>
          )}
        </div>

        {/* Timestamp — BELOW bubble, matches home/nexus */}
        {sentAt && (
          <div
            style={{
              fontFamily: "var(--app-font-mono)",
              fontSize: "var(--ts-xs)",
              letterSpacing: "0.08em",
              color: "var(--atlas-muted)",
              opacity: 0.45,
              textTransform: "lowercase",
            }}
          >
            {formatTimestamp(sentAt)}
          </div>
        )}

        {/* Hover action row */}
        <div style={{ display: "flex", gap: 4, opacity: hov ? 1 : 0, transition: "opacity 180ms ease", justifyContent: "flex-end" }}>
          <button
            className={`atlas-icon-action${copied ? " copy-done" : ""}`}
            onClick={handleCopy}
            title={copied ? "Copied!" : "Copy"}
            aria-label="Copy message"
            style={ICON_TOUCH_TARGET_STYLE}
          >
            {copied ? (
              <svg width="12" height="12" viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><path d="M2 7l3 3 7-7" /></svg>
            ) : (
              <svg width="12" height="12" viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"><rect x="5" y="5" width="8" height="8" rx="1.5" /><path d="M9 5V3a1 1 0 00-1-1H3a1 1 0 00-1 1v5a1 1 0 001 1h2" /></svg>
            )}
          </button>
          <button className="atlas-icon-action" onClick={onEdit} title="Edit &amp; resend" aria-label="Edit message" style={ICON_TOUCH_TARGET_STYLE}>
            <svg width="11" height="11" viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
              <path d="M9.5 2.5l2 2L4 12H2v-2L9.5 2.5z" />
            </svg>
          </button>
        </div>
      </div>

      {previewOpen && imageUrl && (
        <div
          onClick={() => setPreviewOpen(false)}
          role="dialog"
          aria-modal="true"
          aria-label="Attachment preview"
          style={{
            position: "fixed", inset: 0, zIndex: 9999,
            background: "rgba(0,0,0,0.92)",
            backdropFilter: "blur(8px)",
            display: "flex", alignItems: "center", justifyContent: "center",
            padding: 16, cursor: "zoom-out",
            animation: "fadeIn 160ms ease",
          }}
        >
          <button
            type="button"
            onClick={(e) => { e.stopPropagation(); setPreviewOpen(false); }}
            aria-label="Close preview"
            style={{
              position: "absolute", top: 18, right: 18,
              width: 36, height: 36, borderRadius: 999,
              background: "rgba(255,255,255,0.08)",
              border: "0.5px solid rgba(201,162,76,0.3)",
              color: "var(--atlas-gold)",
              display: "flex", alignItems: "center", justifyContent: "center",
              cursor: "pointer",
            }}
          >
            <svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><path d="M3 3l10 10M13 3L3 13" /></svg>
          </button>
          <img
            src={imageUrl}
            alt="Attached"
            onClick={(e) => e.stopPropagation()}
            style={{
              maxWidth: "100%", maxHeight: "100%",
              objectFit: "contain",
              borderRadius: 8,
              boxShadow: "0 20px 60px rgba(0,0,0,0.6)",
              cursor: "default",
            }}
          />
        </div>
      )}
    </div>
  );
}
