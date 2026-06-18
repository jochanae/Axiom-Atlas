import { useRef, useState, type CSSProperties, type Dispatch, type MouseEvent, type PointerEvent, type SetStateAction } from "react";
import { Play } from "lucide-react";

export type UnifiedSubheaderTab = "chat" | "changes" | "blueprints" | "artifacts" | "console";
export type UnifiedSubheaderMenuAction = "files" | "memory" | "connections" | "forge" | "rescan-repo";

type UnifiedSubheaderProps = {
  activeTab: UnifiedSubheaderTab;
  onTabChange: (tab: UnifiedSubheaderTab) => void;
  hasProject: boolean;
  isMobile: boolean;
  topOffset?: number;
  showWorkspaceMenu?: boolean;
  showLaunchWhenNoProject?: boolean;
  onMenuAction?: (action: UnifiedSubheaderMenuAction) => void;
  onLaunch?: () => void;
  projectStatus?: string;
  onManifest?: () => void;
  manifestLoading?: boolean;
  hasConversation?: boolean;
  expanded?: boolean;
  onExpandedChange?: Dispatch<SetStateAction<boolean>>;
};

const TABS: Array<{ id: UnifiedSubheaderTab; label: string; ariaLabel: string }> = [
  { id: "changes", label: "CHANGES", ariaLabel: "View changes" },
  { id: "blueprints", label: "BLUEPRINTS", ariaLabel: "Open blueprints" },
  { id: "artifacts", label: "ARTIFACTS", ariaLabel: "Open artifacts" },
  { id: "console", label: "CONSOLE", ariaLabel: "Open console" },
];


function tabButtonStyle(active: boolean, isMobile: boolean): CSSProperties {
  return {
    position: "relative",
    padding: "6px 2px 10px",
    background: "transparent",
    border: "none",
    color: active ? "var(--atlas-fg)" : "var(--atlas-muted)",
    fontSize: isMobile ? 11 : 12,
    fontFamily: "var(--app-font-sans)",
    fontWeight: active ? 700 : 500,
    letterSpacing: "0.18em",
    textTransform: "uppercase",
    cursor: "pointer",
    transition: "color 200ms ease, opacity 200ms ease",
    display: "flex",
    alignItems: "center",
    gap: 6,
    opacity: active ? 1 : 0.55,
    whiteSpace: "nowrap",
  };
}

export function UnifiedSubheader({
  activeTab,
  onTabChange,
  hasProject,
  isMobile,
  topOffset = 50,
  showWorkspaceMenu = false,
  showLaunchWhenNoProject = false,
  onLaunch,
  projectStatus,
  onManifest,
  manifestLoading = false,
  hasConversation = true,
  expanded: controlledExpanded,
  onExpandedChange,
}: UnifiedSubheaderProps) {
  const [internalExpanded, setInternalExpanded] = useState(false);
  const expanded = controlledExpanded ?? internalExpanded;
  const setExpanded = onExpandedChange ?? setInternalExpanded;
  const [launchHover, setLaunchHover] = useState(false);
  const [launchActive, setLaunchActive] = useState(false);
  const [manifestHover, setManifestHover] = useState(false);
  const longPressTimer = useRef<number | null>(null);
  const longPressFired = useRef(false);

  const clearLongPress = () => {
    if (longPressTimer.current) {
      clearTimeout(longPressTimer.current);
      longPressTimer.current = null;
    }
  };

  const handleLaunchPointerDown = () => {
    setLaunchActive(true);
    longPressFired.current = false;
    clearLongPress();
    if (!hasProject) return;
    longPressTimer.current = window.setTimeout(() => {
      longPressFired.current = true;
      // Long-press always toggles the subheader (expand ↔ collapse)
      setExpanded((v) => !v);
      try { navigator.vibrate?.(40); } catch { /* ignore */ }
    }, 450);
  };

  const handleLaunchPointerUp = () => {
    setLaunchActive(false);
    clearLongPress();
  };

  const handleLaunchPointerCancel = () => {
    setLaunchActive(false);
    clearLongPress();
  };

  const handleLaunchPointerLeave = (e: PointerEvent<HTMLButtonElement>) => {
    if (e.pointerType === "mouse") {
      setLaunchActive(false);
      clearLongPress();
    }
  };

  const handleLaunchMouseLeave = () => {
    setLaunchHover(false);
    setLaunchActive(false);
  };

  const handleLaunchClick = (e: MouseEvent<HTMLButtonElement>) => {
    if (longPressFired.current) {
      e.preventDefault();
      e.stopPropagation();
      longPressFired.current = false;
      return;
    }
    // Tap always launches preview, regardless of expanded state
    onLaunch?.();
  };

  const selectTab = (tab: UnifiedSubheaderTab) => {
    onTabChange(tab);
  };

  const showRow = expanded && hasProject;
  const showLaunchButton = showWorkspaceMenu && (hasProject || showLaunchWhenNoProject);
  const showManifestButton = hasProject && projectStatus !== "archived";
  const showActionBar = showLaunchButton || showManifestButton;
  const launchTitle = hasProject
    ? expanded
      ? "Tap to launch · long-press to hide tabs"
      : "Tap to launch · long-press to show tabs"
    : "Open workspace";
  const launchAriaLabel = hasProject
    ? expanded
      ? "Launch full screen (long-press to hide tabs)"
      : "Launch full screen (long-press to show tabs)"
    : "Open workspace";


  return (
    <div
      className={`atlas-unified-subheader atlas-unified-subheader--${expanded ? "expanded" : "collapsed"}`}
      style={{
        marginTop: topOffset,
        flexShrink: 0,
        position: "relative",
        zIndex: 20,
        width: "100%",
        background: "transparent",
        transition: "margin-top 240ms ease",
      }}
    >
      {/* Collapsible tab row — slides up and out of DOM flow when collapsed.
          When collapsed but the action bar is showing, we still reserve enough
          vertical space so the absolutely-positioned Manifest/Launch pills don't
          overlay the chat content below. */}
      <div
        style={{
          maxHeight: showRow ? 56 : showActionBar ? 36 : 0,
          overflow: "hidden",
          transition: "max-height 240ms ease",
        }}
        aria-hidden={!showRow}
      >
        <div
          className="atlas-app-header-row"
          style={{
            display: "flex",
            alignItems: "center",
            gap: 10,
            padding: isMobile ? "8px 16px 6px" : "10px 22px 8px",
          }}
        >
          <nav
            aria-label="Workspace sections"
            className="scrollbar-none"
            style={{
              display: "flex",
              alignItems: "center",
              gap: isMobile ? 16 : 22,
              minWidth: 0,
              overflowX: "auto",
              overflowY: "hidden",
              WebkitOverflowScrolling: "touch",
              scrollbarWidth: "none",
              flex: 1,
            }}
          >
            {TABS.map((tab) => {
              const active = activeTab === tab.id;
              return (
                <button
                  key={tab.id}
                  type="button"
                  onClick={() => selectTab(tab.id)}
                  aria-label={tab.ariaLabel}
                  style={tabButtonStyle(active, isMobile)}
                  onMouseEnter={(event) => {
                    if (!active) event.currentTarget.style.opacity = "0.85";
                  }}
                  onMouseLeave={(event) => {
                    if (!active) event.currentTarget.style.opacity = "0.55";
                  }}
                >
                  {tab.label}
                  {active && (
                    <span
                      aria-hidden
                      style={{
                        position: "absolute",
                        bottom: 2,
                        left: "50%",
                        transform: "translateX(-50%)",
                        width: 3,
                        height: 3,
                        borderRadius: "50%",
                        background: "var(--atlas-gold)",
                        boxShadow: "0 0 6px rgba(201,162,76,0.6)",
                      }}
                    />
                  )}
                </button>
              );
            })}
          </nav>

        </div>
      </div>

      {/* Play button — pinned. Tap = primary (launch when collapsed, collapse when expanded).
          Long-press = secondary (expand when collapsed, launch when expanded). Icon rotates 90° when expanded. */}
      {showActionBar && (
        <div
          style={{
            position: "absolute",
            top: 4,
            right: isMobile ? 16 : 22,
            zIndex: 2,
            display: "flex",
            alignItems: "center",
            gap: 8,
          }}
        >
          {showManifestButton && (
            <button
              type="button"
              onClick={onManifest}
              disabled={manifestLoading}
              onMouseEnter={() => setManifestHover(true)}
              onMouseLeave={() => setManifestHover(false)}
              title="Manifest First Artifact"
              aria-label="Manifest First Artifact"
              style={{
                background: manifestHover && !manifestLoading
                  ? "color-mix(in oklab, #C9A24C 10%, transparent)"
                  : "transparent",
                border: `1px solid ${manifestHover && !manifestLoading ? "rgba(201,162,76,0.42)" : "rgba(201,162,76,0.22)"}`,
                borderRadius: 8,
                padding: isMobile ? "5px 8px" : "5px 10px",
                cursor: manifestLoading ? "not-allowed" : "pointer",
                color: manifestLoading ? "color-mix(in oklab, #C9A24C 42%, var(--atlas-muted))" : "#C9A24C",
                opacity: manifestLoading ? 0.55 : manifestHover ? 1 : 0.86,
                lineHeight: 1,
                display: "inline-flex",
                alignItems: "center",
                justifyContent: "center",
                transition: "background 160ms ease, color 160ms ease, border-color 160ms ease, opacity 160ms ease",
                WebkitTapHighlightColor: "transparent",
                boxShadow: manifestHover && !manifestLoading ? "0 0 12px rgba(201,162,76,0.18)" : "none",
                touchAction: "manipulation",
                fontSize: isMobile ? 10 : 11,
                fontFamily: "var(--app-font-mono)",
                fontWeight: 600,
                letterSpacing: "0.08em",
                textTransform: "uppercase",
                whiteSpace: "nowrap",
              }}
            >
              {isMobile ? "Manifest" : "Manifest First Artifact"}
            </button>
          )}
          {showLaunchButton && (
            <button
              type="button"
              onClick={handleLaunchClick}
              onPointerDown={handleLaunchPointerDown}
              onPointerUp={handleLaunchPointerUp}
              onPointerLeave={handleLaunchPointerLeave}
              onPointerCancel={handleLaunchPointerCancel}
              onMouseEnter={() => setLaunchHover(true)}
              onMouseLeave={handleLaunchMouseLeave}
              title={launchTitle}
              aria-label={launchAriaLabel}
              aria-expanded={expanded}
              style={{
                background: launchActive
                  ? "color-mix(in oklab, var(--atlas-gold) 18%, transparent)"
                  : launchHover
                  ? "color-mix(in oklab, var(--atlas-gold) 10%, transparent)"
                  : "transparent",
                border: `1px solid ${launchHover || launchActive ? "color-mix(in oklab, var(--atlas-gold) 38%, transparent)" : "transparent"}`,
                borderRadius: 8,
                padding: "5px 6px",
                cursor: "pointer",
                color: launchHover || launchActive ? "var(--atlas-gold)" : "color-mix(in oklab, var(--atlas-gold) 70%, var(--atlas-muted))",
                opacity: launchHover || launchActive ? 1 : 0.85,
                lineHeight: 0,
                display: "inline-flex",
                alignItems: "center",
                justifyContent: "center",
                transition: "background 160ms ease, color 160ms ease, border-color 160ms ease, opacity 160ms ease",
                WebkitTapHighlightColor: "transparent",
                boxShadow: launchHover || launchActive ? "0 0 12px rgba(201,162,76,0.25)" : "none",
                touchAction: "manipulation",
              }}
            >
              <span
                style={{
                  display: "inline-flex",
                  transition: "transform 200ms cubic-bezier(.32,.72,0,1)",
                  transform: expanded ? "rotate(90deg)" : "rotate(0deg)",
                }}
              >
                <Play size={15} strokeWidth={2} fill="currentColor" aria-hidden />
              </span>
            </button>
          )}
        </div>
      )}
    </div>
  );
}
