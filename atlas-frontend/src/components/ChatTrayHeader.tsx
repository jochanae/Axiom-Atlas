import type { CSSProperties, ReactNode } from "react";

import { Project } from "@workspace/api-client-react";
/**
 * ChatTrayHeader — shared, ultra-quiet header for the Nexus Home chat tray
 * and the Project Workspace chat. One indicator per view: a tiny shield
 * icon denotes sovereign session state; readiness pill renders only when
 * provided (and only when the surface doesn't already show readiness elsewhere).
 *
 * Composition:
 *   ┌─ 32×4 grab handle ─┐
 *   │  {projectSlot}   [🛡]   [77% Ready?]   {rightSlot}  │
 */
export interface ChatTrayHeaderProps {
  /** 0-100. Hides the readiness pill when undefined. */
  readinessScore?: number;
  /** Active session sovereignty state — colors the shield. */
  active?: boolean;
  /** Optional click on the shield (e.g. toggle Global Insight mode). */
  onTrustClick?: () => void;
  /** Show the sovereignty shield. Defaults to false — only Nexus home opts in. */
  showTrust?: boolean;
  /** Project context slot — workspace passes a switcher, home leaves empty. */
  projectSlot?: ReactNode;
  /** Right-side utility cluster (vault, briefing, clear, etc.). */
  rightSlot?: ReactNode;
  /** Optional grab-handle click (collapse/minimize). */
  onGrabHandleClick?: () => void;
  style?: CSSProperties;
}

export function ChatTrayHeader({
  readinessScore,
  active = true,
  onTrustClick,
  showTrust = false,
  projectSlot,
  rightSlot,
  onGrabHandleClick,
  style,
}: ChatTrayHeaderProps) {

  return (
    <div
      className="atlas-chat-tray-header"
      style={{
        display: "flex",
        flexDirection: "column",
        background: "transparent",
        ...style,
      }}
    >
      {/* Grab handle — 32×4 pill, centered */}
      <button
        type="button"
        onClick={onGrabHandleClick}
        aria-label="Collapse tray"
        title={onGrabHandleClick ? "Drag or tap to collapse" : undefined}
        style={{
          alignSelf: "center",
          width: 32,
          height: 4,
          borderRadius: 999,
          background: "rgba(255,255,255,0.10)",
          border: "none",
          padding: 0,
          margin: "6px 0 4px",
          cursor: onGrabHandleClick ? "pointer" : "default",
          transition: "background 160ms ease",
        }}
        onMouseEnter={(e) => { e.currentTarget.style.background = "rgba(255,255,255,0.20)"; }}
        onMouseLeave={(e) => { e.currentTarget.style.background = "rgba(255,255,255,0.10)"; }}
      />

      {/* Header row */}
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: 8,
          padding: "2px 16px 6px",
          minHeight: 24,
        }}
      >
        {/* Project context slot — workspace-only */}
        {projectSlot ? (
          <div style={{ flex: 1, minWidth: 0, display: "flex", alignItems: "center" }}>
            {projectSlot}
          </div>
        ) : (
          <div style={{ flex: 1 }} />
        )}

        {/* Quiet sovereignty shield — Nexus home only */}
        {showTrust && (
          <button
            type="button"
            onClick={onTrustClick}
            aria-label={active ? "Private session active — tap to exit" : "Start private session"}
            title={active ? "Think Freely · private session active" : "Start a private session"}
            className={`
              relative inline-flex items-center justify-center w-8 h-8 rounded-lg flex-shrink-0
              transition-all duration-200 ease-out select-none
              active:scale-95 touch-manipulation
              ${active
                ? "bg-[rgba(201,162,76,0.08)] border border-[rgba(201,162,76,0.3)] text-[var(--atlas-gold)] shadow-[0_0_12px_rgba(201,162,76,0.1)]"
                : "bg-transparent border border-transparent text-stone-500/40 hover:text-stone-400 hover:bg-stone-800/30"
              }
            `}
          >
            {/* Ambient micro-glow ring when active */}
            {active && (
              <span className="absolute inset-0 rounded-lg animate-pulse bg-[rgba(201,162,76,0.03)] ring-1 ring-[rgba(201,162,76,0.2)]" />
            )}

            {active ? (
              // Secure Locked State
              <svg
                width="14"
                height="14"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2.2"
                strokeLinecap="round"
                strokeLinejoin="round"
                className="relative z-10 drop-shadow-[0_0_2px_rgba(201,162,76,0.4)]"
              >
                <rect x="3" y="11" width="18" height="11" rx="2" fill="rgba(201,162,76,0.1)" />
                <path d="M7 11V7a5 5 0 0 1 10 0v4" />
              </svg>
            ) : (
              // Unlocked / Open State
              <svg
                width="14"
                height="14"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="1.8"
                strokeLinecap="round"
                strokeLinejoin="round"
                className="relative z-10"
              >
                <rect x="3" y="11" width="18" height="11" rx="2" />
                <path d="M7 11V7a5 5 0 0 1 9.9-1" />
              </svg>
            )}
          </button>
        )}


        {/* Readiness pill — neutral, single source of truth per view */}
        {readinessScore !== undefined && (
          <span
            title={`Sovereign Readiness · ${readinessScore}%`}
            style={{
              display: "inline-flex",
              alignItems: "center",
              gap: 5,
              padding: "2px 8px",
              borderRadius: 999,
              background: "rgba(255,255,255,0.03)",
              border: "1px solid rgba(255,255,255,0.06)",
              color: "var(--atlas-muted)",
              fontFamily: "var(--app-font-mono)",
              fontSize: 9.5,
              letterSpacing: "0.08em",
              fontWeight: 500,
              lineHeight: 1,
              flexShrink: 0,
            }}
          >
            <span style={{ color: "var(--atlas-fg)", opacity: 0.8, fontWeight: 600 }}>
              {readinessScore}%
            </span>
            READY
          </span>
        )}

        {/* Right utility cluster */}
        {rightSlot && (
          <div style={{ display: "flex", alignItems: "center", gap: 2, flexShrink: 0 }}>
            {rightSlot}
          </div>
        )}
      </div>
    </div>
  );
}
