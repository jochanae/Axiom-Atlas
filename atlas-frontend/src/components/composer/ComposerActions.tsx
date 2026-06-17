import { useEffect, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import {
  Camera,
  Paperclip,
  FolderClosed,
  Plug,
  Code2,
  History,
  Share2,
  Rocket,
  Settings,
  Layers,
  Flame,
  MoreHorizontal,
  Plus,
  ChevronDown,
  ChevronUp,
  Wand2,
} from "lucide-react";
import SketchComposerSheet from "./SketchComposerSheet";


export type ComposerMenuAction =
  | "files"
  | "mcp"
  | "connectors"
  | "code"
  | "history"
  | "share"
  | "publish"
  | "settings"
  | "forge-intake"
  | "more:forge"
  | "more:memory"
  | "more:blueprints"
  | "more:rescan"
  | "more:deep-dive"
  | "more:artifacts"
  | "more:console"
  | "more:changes";

export interface ComposerActionsProps {
  /** Append selected files (camera + attach both route here). */
  onFiles: (files: File[]) => void;
  /** Route a primary or `more:*` menu action to the host surface. */
  onMenuAction: (action: ComposerMenuAction) => void;
  /** When false, hides project-context-only items (Files/Code/Share/Publish/Connectors/Settings). */
  hasProjectContext?: boolean;
  /** Unique id-suffix so home + workspace inputs don't collide on the page. */
  scope?: string;
  /** Visual hint that an attachment is currently staged. */
  hasAttachments?: boolean;
  /** Optional trailing slot — e.g. workspace model chip — rendered between actions and Send. */
  trailing?: ReactNode;
  /** Strip the borders / chip backgrounds from + and ... buttons (used by Global Insight). */
  borderless?: boolean;
  /** When provided, shows a "Sketch" tile in the + sheet that opens a manual
   *  image-generation prompt. Receives the composed `[SKETCH:<preset>] …`
   *  prompt — wire to the host's chat send pipeline. */
  onSketch?: (prompt: string) => void;
}

type PrimaryItem = {
  id: ComposerMenuAction;
  label: string;
  icon: ReactNode;
  projectOnly?: boolean;
};

const PRIMARY_ITEMS: PrimaryItem[] = [
  { id: "forge-intake", label: "Forge intake", icon: <Flame size={18} strokeWidth={1.6} />, projectOnly: true },
  { id: "files", label: "Files", icon: <FolderClosed size={18} strokeWidth={1.6} />, projectOnly: true },
  { id: "mcp", label: "MCP", icon: <Layers size={18} strokeWidth={1.6} /> },
  { id: "connectors", label: "Connectors", icon: <Plug size={18} strokeWidth={1.6} /> },
  { id: "code", label: "Code", icon: <Code2 size={18} strokeWidth={1.6} />, projectOnly: true },
  { id: "history", label: "History", icon: <History size={18} strokeWidth={1.6} /> },
  { id: "share", label: "Share", icon: <Share2 size={18} strokeWidth={1.6} />, projectOnly: true },
  { id: "publish", label: "Publish", icon: <Rocket size={18} strokeWidth={1.6} />, projectOnly: true },
  { id: "settings", label: "Settings", icon: <Settings size={18} strokeWidth={1.6} />, projectOnly: true },
];

const MORE_ITEMS: { id: ComposerMenuAction; label: string }[] = [
  { id: "more:memory", label: "Memory" },
  { id: "more:blueprints", label: "Blueprints" },
  { id: "more:changes", label: "Changes" },
  { id: "more:artifacts", label: "Artifacts" },
  { id: "more:console", label: "Console" },
  { id: "more:deep-dive", label: "Deep Dive" },
  { id: "more:rescan", label: "Rescan Repo" },
];

// Sentinel action id used internally when Sketch is rendered as a top-of-More
// row. Not part of ComposerMenuAction because hosts don't handle it directly —
// ComposerActions intercepts it and opens SketchComposerSheet.
const SKETCH_MENU_ID = "__sketch__";

const SHEET_OVERLAY: React.CSSProperties = {
  position: "fixed",
  inset: 0,
  zIndex: 9998,
  background: "rgba(0,0,0,0.55)",
  backdropFilter: "blur(6px)",
  display: "flex",
  alignItems: "flex-end",
  justifyContent: "center",
  // Float clear of fixed bottom tab bar + device safe-area
  padding: "16px 14px calc(env(safe-area-inset-bottom, 0px) + 96px)",
  overflow: "hidden",
};

// Floating centered canvas — flex column so the inner scroll region can shrink.
const SHEET_PANEL: React.CSSProperties = {
  position: "relative",
  zIndex: 9999,
  width: "100%",
  maxWidth: 440,
  background: "color-mix(in oklab, var(--atlas-surface) 94%, transparent)",
  backdropFilter: "blur(28px) saturate(150%)",
  border: "1px solid color-mix(in oklab, var(--atlas-gold) 20%, transparent)",
  borderRadius: 22,
  boxShadow:
    "0 24px 80px rgba(0,0,0,0.65), 0 0 0 1px rgba(0,0,0,0.4), inset 0 1px 0 color-mix(in oklab, var(--atlas-gold) 12%, transparent)",
  padding: "10px 14px 14px",
  display: "flex",
  flexDirection: "column",
  minHeight: 0,
  maxHeight: "100%",
  overflow: "hidden",
};


// Inner scroll container — isolates overflow inside the floating canvas so
// the Settings row and expanded "More" items always reach the viewport.
const SHEET_SCROLL: React.CSSProperties = {
  flex: 1,
  minHeight: 0,
  overflowY: "auto",
  WebkitOverflowScrolling: "touch",
  paddingBottom: "1rem",
  margin: "0 -4px",
  paddingLeft: 4,
  paddingRight: 4,
};

const SHEET_HANDLE: React.CSSProperties = {
  width: 44,
  height: 4,
  borderRadius: 999,
  background: "rgba(201,162,76,0.35)",
  margin: "2px auto 10px",
  flexShrink: 0,
};

export function ComposerActions({
  onFiles,
  onMenuAction,
  hasProjectContext = true,
  scope = "composer",
  hasAttachments = false,
  trailing,
  borderless = false,
  onSketch,
}: ComposerActionsProps) {
  const [showPlus, setShowPlus] = useState(false);
  const [showMore, setShowMore] = useState(false);
  const [moreExpanded, setMoreExpanded] = useState(false);
  const [showSketch, setShowSketch] = useState(false);
  const portalHost = typeof document !== "undefined" ? document.body : null;


  const attachRef = useRef<HTMLInputElement>(null);
  const cameraRef = useRef<HTMLInputElement>(null);

  // Lock body scroll while a sheet is open
  useEffect(() => {
    if (!showPlus && !showMore) return;
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = prev;
    };
  }, [showPlus, showMore]);

  function pickFiles(files: FileList | null) {
    if (!files || files.length === 0) return;
    onFiles(Array.from(files));
  }

  const visiblePrimary = PRIMARY_ITEMS.filter((i) => hasProjectContext || !i.projectOnly);

  return (
    <>
      {/* Unrestricted multi-mime, multi-select native file picker */}
      <input
        ref={attachRef}
        id={`${scope}-attach-input`}
        type="file"
        accept="*/*"
        multiple
        style={{ position: "absolute", width: 1, height: 1, opacity: 0, overflow: "hidden", pointerEvents: "none" }}
        onChange={(e) => {
          pickFiles(e.target.files);
          e.target.value = "";
        }}
      />
      {/* Native camera capture */}
      <input
        ref={cameraRef}
        id={`${scope}-camera-input`}
        type="file"
        accept="image/*,video/*"
        capture="environment"
        style={{ position: "absolute", width: 1, height: 1, opacity: 0, overflow: "hidden", pointerEvents: "none" }}
        onChange={(e) => {
          pickFiles(e.target.files);
          e.target.value = "";
        }}
      />

      <button
        type="button"
        aria-label="Add attachment"
        title="Add"
        onClick={() => {
          setShowMore(false);
          setShowPlus(true);
        }}
        style={iconBtnStyle(showPlus, hasAttachments, borderless)}
      >
        <Plus size={17} strokeWidth={1.7} />
      </button>

      <button
        type="button"
        aria-label="Workspace menu"
        title="Menu"
        onClick={() => {
          setShowPlus(false);
          setMoreExpanded(false);
          setShowMore(true);
        }}
        style={iconBtnStyle(showMore, false, borderless)}
      >
        <MoreHorizontal size={17} strokeWidth={1.7} />
      </button>

      {trailing}

      {/* PLUS sheet — Camera + Attach (only two nodes) */}
      {showPlus && portalHost && createPortal(
        <div style={SHEET_OVERLAY} onClick={() => setShowPlus(false)}>
          <div
            role="dialog"
            aria-label="Attach"
            style={SHEET_PANEL}
            onClick={(e) => e.stopPropagation()}
          >
            <div style={SHEET_HANDLE} />
            <div style={SHEET_SCROLL}>
              <div
                style={{
                  display: "grid",
                  gridTemplateColumns: "1fr 1fr",
                  gap: 14,
                  margin: "4px 0",
                }}
              >
                <BigNode
                  label="Camera"
                  icon={<Camera size={36} strokeWidth={1.4} />}
                  onClick={() => {
                    setShowPlus(false);
                    cameraRef.current?.click();
                  }}
                />
                <BigNode
                  label="Attach"
                  icon={<Paperclip size={36} strokeWidth={1.4} />}
                  onClick={() => {
                    setShowPlus(false);
                    attachRef.current?.click();
                  }}
                />
              </div>

            </div>
          </div>
        </div>,
        portalHost
      )}

      {/* MORE sheet — Files, Connectors, Code, History, Share, Publish, Settings, More */}
      {showMore && portalHost && createPortal(
        <div style={SHEET_OVERLAY} onClick={() => setShowMore(false)}>
          <div
            role="dialog"
            aria-label="Workspace menu"
            style={SHEET_PANEL}
            onClick={(e) => e.stopPropagation()}
          >
            <div style={SHEET_HANDLE} />
            <div style={SHEET_SCROLL}>
              {onSketch && (
                <MenuRow
                  icon={<Wand2 size={18} strokeWidth={1.6} />}
                  label="Sketch"
                  onClick={() => {
                    setShowMore(false);
                    setTimeout(() => setShowSketch(true), 50);
                  }}
                />
              )}
              {visiblePrimary.map((item) => (
                <MenuRow
                  key={item.id}
                  icon={item.icon}
                  label={item.label}
                  onClick={() => {
                    setShowMore(false);
                    onMenuAction(item.id);
                  }}
                />
              ))}

              {/* More accordion */}
              <button
                type="button"
                onClick={() => setMoreExpanded((v) => !v)}
                aria-expanded={moreExpanded}
                style={menuRowStyle(false)}
                onPointerDown={(e) => { e.currentTarget.style.background = "rgba(201,162,76,0.06)"; }}
                onPointerUp={(e) => { e.currentTarget.style.background = "transparent"; }}
                onPointerLeave={(e) => { e.currentTarget.style.background = "transparent"; }}
              >
                <span style={{ ...iconWrapStyle, pointerEvents: "none" }}>
                  <Layers size={18} strokeWidth={1.6} />
                </span>
                <span style={{ flex: 1, textAlign: "left", pointerEvents: "none" }}>More</span>
                {moreExpanded ? (
                  <ChevronUp size={16} strokeWidth={1.6} style={{ opacity: 0.6, pointerEvents: "none" }} />
                ) : (
                  <ChevronDown size={16} strokeWidth={1.6} style={{ opacity: 0.6, pointerEvents: "none" }} />
                )}
              </button>
              {moreExpanded && (
                <div
                  style={{
                    margin: "2px 0 6px 18px",
                    borderLeft: "1px solid color-mix(in oklab, var(--atlas-gold) 16%, transparent)",
                  }}
                >
                  {MORE_ITEMS.map((m) => (
                    <button
                      key={m.id}
                      type="button"
                      onClick={() => {
                        setShowMore(false);
                        onMenuAction(m.id);
                      }}
                      style={{
                        ...menuRowStyle(false),
                        padding: "11px 14px",
                        fontSize: 13,
                        fontFamily: "var(--app-font-mono)",
                        letterSpacing: "0.06em",
                      }}
                    >
                      <span style={{ flex: 1, textAlign: "left", opacity: 0.85 }}>{m.label}</span>
                    </button>
                  ))}
                </div>
              )}
            </div>
          </div>
        </div>,
        portalHost
      )}

      {/* Manual Sketch composer (image generation) */}
      {onSketch && (
        <SketchComposerSheet
          open={showSketch}
          onClose={() => setShowSketch(false)}
          onSend={(prompt) => onSketch(prompt)}
        />
      )}
    </>
  );
}


function iconBtnStyle(active: boolean, accent: boolean, borderless = false): React.CSSProperties {
  return {
    width: 42,
    height: 42,
    minWidth: 42,
    minHeight: 42,
    maxWidth: 42,
    maxHeight: 42,
    flex: "0 0 42px",
    padding: 7,
    boxSizing: "border-box",
    borderRadius: 10,
    background: borderless && !active && !accent
      ? "transparent"
      : active
      ? "rgba(201,162,76,0.14)"
      : accent
      ? "rgba(201,162,76,0.08)"
      : "rgba(255,255,255,0.02)",
    border: borderless && !active && !accent
      ? "1px solid transparent"
      : active || accent
      ? "1px solid rgba(201,162,76,0.28)"
      : "1px solid rgba(255,255,255,0.06)",
    backdropFilter: borderless ? "none" : "blur(8px)",
    color: active || accent ? "var(--atlas-gold)" : "var(--atlas-muted)",
    cursor: "pointer",
    display: "inline-flex",
    alignItems: "center",
    justifyContent: "center",
    opacity: active || accent ? 1 : 0.8,
    transition: "all 160ms ease",
    flexShrink: 0,
    WebkitTapHighlightColor: "transparent",
  };
}

function BigNode({
  label,
  icon,
  onClick,
}: {
  label: string;
  icon: ReactNode;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      style={{
        aspectRatio: "1 / 1",
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        justifyContent: "center",
        gap: 12,
        padding: 18,
        borderRadius: 18,
        background: "color-mix(in oklab, var(--atlas-bg) 80%, transparent)",
        border: "1px solid color-mix(in oklab, var(--atlas-gold) 20%, transparent)",
        backdropFilter: "blur(14px)",
        color: "var(--atlas-gold)",
        cursor: "pointer",
        transition: "transform 160ms ease, box-shadow 160ms ease, border-color 160ms ease",
        boxShadow: "inset 0 1px 0 rgba(255,255,255,0.04)",
        WebkitTapHighlightColor: "transparent",
      }}
      onPointerDown={(e) => {
        e.currentTarget.style.transform = "scale(0.97)";
      }}
      onPointerUp={(e) => {
        e.currentTarget.style.transform = "scale(1)";
      }}
      onPointerLeave={(e) => {
        e.currentTarget.style.transform = "scale(1)";
      }}
    >
      <span
        style={{
          width: 64,
          height: 64,
          borderRadius: 16,
          display: "inline-flex",
          alignItems: "center",
          justifyContent: "center",
          background: "rgba(201,162,76,0.10)",
          border: "1px solid rgba(201,162,76,0.22)",
          boxShadow: "0 0 24px -6px rgba(201,162,76,0.35)",
        }}
      >
        {icon}
      </span>
      <span
        style={{
          fontFamily: "var(--app-font-mono)",
          fontSize: 12,
          letterSpacing: "0.14em",
          textTransform: "uppercase",
          color: "var(--atlas-fg)",
        }}
      >
        {label}
      </span>
    </button>
  );
}

const iconWrapStyle: React.CSSProperties = {
  width: 32,
  height: 32,
  borderRadius: 9,
  display: "inline-flex",
  alignItems: "center",
  justifyContent: "center",
  background: "rgba(201,162,76,0.08)",
  border: "1px solid rgba(201,162,76,0.18)",
  color: "var(--atlas-gold)",
  flexShrink: 0,
};

function menuRowStyle(_active: boolean): React.CSSProperties {
  return {
    width: "100%",
    display: "flex",
    alignItems: "center",
    gap: 12,
    padding: "13px 14px",
    background: "transparent",
    border: "none",
    borderBottom: "1px solid color-mix(in oklab, var(--atlas-gold) 8%, transparent)",
    color: "var(--atlas-fg)",
    cursor: "pointer",
    fontFamily: "var(--app-font-sans)",
    fontSize: 15,
    letterSpacing: "-0.005em",
    textAlign: "left",
    WebkitTapHighlightColor: "transparent",
  };
}

function MenuRow({
  icon,
  label,
  onClick,
}: {
  icon: ReactNode;
  label: string;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      style={menuRowStyle(false)}
      onPointerDown={(e) => {
        e.currentTarget.style.background = "rgba(201,162,76,0.06)";
      }}
      onPointerUp={(e) => {
        e.currentTarget.style.background = "transparent";
      }}
      onPointerLeave={(e) => {
        e.currentTarget.style.background = "transparent";
      }}
    >
      <span style={iconWrapStyle}>{icon}</span>
      <span style={{ flex: 1 }}>{label}</span>
    </button>
  );
}
